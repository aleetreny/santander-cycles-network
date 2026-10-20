"""Directed OD graph aggregation and geographic matching with transparency about missing nodes."""
from pathlib import Path
import re
import pandas as pd


def canonical(s):return re.sub(r'[^a-z0-9]','',str(s).lower())

def aggregate(root:Path,year=None,month=None,day_type='all',bike_model=None,start_hour=None,end_hour=None):
    try:import duckdb
    except ImportError as e:raise RuntimeError('Install dependencies: pip install -r requirements.txt') from e
    patterns=str(root/'data'/'processed'/'**'/'*.parquet')
    if not list((root/'data'/'processed').rglob('*.parquet')):raise FileNotFoundError('No Parquet found. Run fetch then prepare.')
    predicates=['started_at IS NOT NULL','end_station_id IS NOT NULL','start_station_id IS NOT NULL']
    params=[]
    if year:predicates.append('YEAR(started_at) = ?');params.append(int(year))
    if month:predicates.append('MONTH(started_at) = ?');params.append(int(month))
    if day_type=='weekday':predicates.append('DAYOFWEEK(started_at) BETWEEN 1 AND 5') # DuckDB 0=Sunday
    elif day_type=='weekend':predicates.append('DAYOFWEEK(started_at) IN (0,6)')
    if start_hour is not None:predicates.append('HOUR(started_at) >= ?');params.append(int(start_hour))
    if end_hour is not None:predicates.append('HOUR(started_at) < ?');params.append(int(end_hour))
    if bike_model:predicates.append('LOWER(bike_model) LIKE ?');params.append('%'+bike_model.lower()+'%')
    where=' AND '.join(predicates)
    # Do not silently aggregate duplicate journeys across overlapping TfL extracts.
    # id-less records use source_file and record fields as a conservative surrogate.
    query=f"""
       WITH filtered AS (
         SELECT trip_id, source_file, started_at, start_station_id, end_station_id,
                start_station, end_station, bike_id, duration_seconds
         FROM read_parquet('{patterns}', union_by_name=true)
         WHERE {where}
       ), unique_rides AS (
         SELECT * EXCLUDE (rn) FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(trip_id,''), source_file || ':' || CAST(started_at AS VARCHAR) || ':' ||
                       COALESCE(bike_id,'') || ':' || start_station_id || ':' || end_station_id)
                ORDER BY source_file DESC
            ) rn FROM filtered
         ) WHERE rn=1
       )
       SELECT start_station_id, end_station_id,
              MODE(start_station) AS start_station, MODE(end_station) AS end_station,
              COUNT(*) AS journeys, AVG(duration_seconds) AS avg_duration_s
       FROM unique_rides
       GROUP BY 1,2
       ORDER BY journeys DESC
    """
    conn=duckdb.connect(config={'threads':'4'})
    conn.execute("SET temp_directory = '" + str(root/'data'/'processed'/'duckdb_tmp').replace("'", "''") + "'")
    raw=conn.execute(query,params).df()
    conn.close()
    target=root/'outputs';target.mkdir(exist_ok=True)
    raw.to_csv(target/'od_edges_all.csv',index=False)
    return geolocate(root,raw)


def geolocate(root:Path,raw:pd.DataFrame):
    path=root/'data'/'stations'/'stations_latest.csv'
    if not path.exists():raise FileNotFoundError('Run stations first.')
    current=pd.read_csv(path,dtype={'station_id':str,'terminal_name':str})
    name_index={}
    for _,r in current.iterrows():
        key=canonical(r['name']);name_index.setdefault(key,[]).append(r)
    id_index={str(r['station_id']):r for _,r in current.iterrows()}
    # Only name+matching or unambiguous name fallback, avoid mismatched ID join across schema eras.
    def match(sid,name):
        namekey=canonical(name)
        byid=id_index.get(str(sid))
        if byid is not None and canonical(byid['name'])==namekey:return byid,'id_and_name'
        candidates=name_index.get(namekey,[])
        if len(candidates)==1:return candidates[0],'unique_name'
        return None,'unmatched'
    nodes={}
    for _,r in raw.iterrows():
        for prefix in ('start','end'):
            sid=str(r[f'{prefix}_station_id']);name=str(r[f'{prefix}_station'])
            if sid not in nodes:
                place,method=match(sid,name)
                nodes[sid]={'station_id':sid,'name':name,'lat':place['lat'] if place is not None else None,
                            'lon':place['lon'] if place is not None else None,'match_method':method}
    ndf=pd.DataFrame(nodes.values())
    indegree=raw.groupby('end_station_id')['journeys'].sum()
    outdegree=raw.groupby('start_station_id')['journeys'].sum()
    ndf['arrivals']=ndf.station_id.map(indegree).fillna(0).astype('int64')
    ndf['departures']=ndf.station_id.map(outdegree).fillna(0).astype('int64')
    ndf['net_inflow']=ndf.arrivals-ndf.departures
    target=root/'outputs';target.mkdir(exist_ok=True)
    ndf.to_csv(target/'nodes.csv',index=False)
    out=raw.rename(columns={'start_station_id':'source','end_station_id':'target'}).copy()
    loc=ndf.set_index('station_id')
    for endpoint,prefix in [('source','start'),('target','end')]:
        out[prefix+'_lat']=out[endpoint].map(loc['lat']);out[prefix+'_lon']=out[endpoint].map(loc['lon'])
    out.to_csv(target/'edges.csv',index=False)
    total=int(raw['journeys'].sum());mapped=int(out.loc[out[['start_lat','start_lon','end_lat','end_lon']].notna().all(axis=1),'journeys'].sum())
    (target/'quality.txt').write_text(f'Journeys counted: {total:,}\nBoth endpoints geocoded: {mapped:,} ({mapped/max(1,total):.1%})\nHistorical nodes lacking current coordinates: {ndf.lat.isna().sum()} / {len(ndf)}\nNote: unmatched historic/removed stations are not displayed on map. See nodes.csv.\n')
    print((target/'quality.txt').read_text())
    return ndf,out
