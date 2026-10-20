"""Build compact overview slices and lazy station details from the pinned study inputs.

python -m cycles.atlas
Run after cycles.publish for a fresh monthly snapshot. This does not refetch TfL.
"""
from pathlib import Path
import json
import math
import calendar
from datetime import date
import duckdb
import pandas as pd
from .network import canonical

DAYS = ('all', 'weekday', 'weekend')
TIMES = ('all', 'am', 'day', 'pm', 'night')
BIKES = ('all', 'classic', 'electric')


def distance(a, b):
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    dlat = lat2-lat1
    dlon = math.radians(b['lon']-a['lon'])
    return 6371*2*math.asin(min(1, math.sqrt(math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2)))


def bucket(km):
    return 'short' if km < 1 else 'medium' if km < 3 else 'long'


def summarize(rows, stations, day_count):
    n = len(stations)
    incoming, outgoing, neighbours = [0]*n, [0]*n, [set() for _ in stations]
    pools = {f'{d}-{c}': [] for d in ('all','short','medium','long') for c in ('all','within','across')}
    edge_count = 0
    for a,b,w,median in rows:
        outgoing[a] += w; incoming[b] += w
        if a == b: continue
        edge_count += 1
        neighbours[a].add(b); neighbours[b].add(a)
        d = bucket(distance(stations[a], stations[b]))
        c = 'within' if stations[a]['community'] == stations[b]['community'] else 'across'
        for key in (f'all-all',f'{d}-all',f'all-{c}',f'{d}-{c}'):
            if len(pools[key]) < 200: pools[key].append([a,b,w,median])
    return {'arrivals':incoming,'departures':outgoing,'degree':[len(s) for s in neighbours],
            'journeys':sum(outgoing),'connections':edge_count,'days':day_count,'links':pools}


def build(root):
    public = root/'site/data'
    stations = json.loads((public/'stations.json').read_text())
    meta = json.loads((public/'meta.json').read_text())
    year, month = meta['year'], meta['month']
    n = len(stations)
    names = {}
    for i,s in enumerate(stations): names.setdefault(canonical(s['name']),[]).append(i)
    con = duckdb.connect(config={'threads':'4'})
    pattern = str(root/'data/processed/**/*.parquet').replace("'", "''")
    con.execute(f'''CREATE TEMP TABLE rides AS SELECT * EXCLUDE(rn) FROM (
        SELECT *, row_number() OVER(PARTITION BY coalesce(nullif(trip_id,''),
        source_file || ':' || cast(started_at as varchar) || ':' || coalesce(bike_id,'') || ':' || start_station_id || ':' || end_station_id)
        ORDER BY source_file DESC) rn FROM read_parquet('{pattern}', union_by_name=true)
        WHERE year(started_at)={int(year)} AND month(started_at)={int(month)})
        WHERE rn=1 AND ended_at >= started_at AND duration_seconds>0''')
    pairs = con.execute('SELECT DISTINCT start_station_id,start_station FROM rides UNION SELECT DISTINCT end_station_id,end_station FROM rides').fetchall()
    mapping = [(sid,name,names.get(canonical(name),[None])[0] if len(names.get(canonical(name),[]))==1 else None) for sid,name in pairs]
    frame = pd.DataFrame(mapping,columns=['sid','name','node'])
    con.register('station_map',frame)
    con.execute('''CREATE TEMP TABLE mapped AS SELECT r.*,cast(a.node AS integer) a,cast(b.node AS integer) b
        FROM rides r JOIN station_map a ON r.start_station_id=a.sid AND r.start_station=a.name
        JOIN station_map b ON r.end_station_id=b.sid AND r.end_station=b.name
        WHERE a.node IS NOT NULL AND b.node IS NOT NULL''')
    assert con.execute('SELECT count(*) FROM mapped').fetchone()[0] == meta['mappedJourneys'], 'Pinned station matching changed'
    overview_dir = public/'views'; overview_dir.mkdir(exist_ok=True)
    detail_dir = public/'detail'; detail_dir.mkdir(exist_ok=True)
    detail = [{'id':s['id'],'segments':{}} for s in stations]
    day_counts = {day:sum(day=='all' or (date(year,month,d).weekday()<5)==(day=='weekday') for d in range(1,meta['days']+1)) for day in DAYS}
    monthly = None
    bike_study = []
    for day in DAYS:
        for time in TIMES:
            for bike in BIKES:
                cond=[]
                if day=='weekday': cond.append('dayofweek(started_at) BETWEEN 1 AND 5')
                if day=='weekend': cond.append('dayofweek(started_at) IN (0,6)')
                if time=='am': cond.append('hour(started_at)>=7 AND hour(started_at)<10')
                if time=='day': cond.append('hour(started_at)>=10 AND hour(started_at)<16')
                if time=='pm': cond.append('hour(started_at)>=16 AND hour(started_at)<19')
                if time=='night': cond.append('(hour(started_at)>=19 OR hour(started_at)<7)')
                if bike=='classic': cond.append("bike_model='CLASSIC'")
                if bike=='electric': cond.append("bike_model='PBSC_EBIKE'")
                where=' WHERE '+' AND '.join(cond) if cond else ''
                rows=[(int(a),int(b),int(w),round(float(m),1)) for a,b,w,m in con.execute('SELECT a,b,count(*) n,median(duration_seconds)/60 FROM mapped'+where+' GROUP BY 1,2 ORDER BY n DESC,a,b').fetchall()]
                key=f'{day}-{time}-{bike}'
                overview=summarize(rows,stations,day_counts[day])
                (overview_dir/(key+'.json')).write_text(json.dumps(overview,separators=(',',':')))
                for obj in detail: obj['segments'][key]={'out':[],'in':[]}
                for a,b,w,median in rows:
                    detail[a]['segments'][key]['out'].append([b,w,median])
                    detail[b]['segments'][key]['in'].append([a,w,median])
                if key=='all-all-all': monthly=rows
                if day==time=='all':
                    count,median=con.execute('SELECT count(*),median(duration_seconds)/60 FROM mapped'+where).fetchone()
                    bike_study.append({'bike':bike,'journeys':count,'medianMinutes':round(median,1)})
                print(key,overview['journeys'],flush=True)
    for obj in detail:
        (detail_dir/(obj['id']+'.json')).write_text(json.dumps(obj,separators=(',',':')))
    ccount=meta['communityCount']
    mixing=[[0]*ccount for _ in range(ccount)]
    activity=[0]*n
    for a,b,w,m in monthly:
        activity[a]+=w;activity[b]+=w
        if a!=b and stations[a]['community']>=0 and stations[b]['community']>=0:
            mixing[stations[a]['community']][stations[b]['community']]+=w
    groups=[]
    for c in range(ccount):
        members=[i for i,s in enumerate(stations) if s['community']==c]
        leader=max(members,key=lambda i:activity[i])
        groups.append({'name':stations[leader]['name'].split(',')[-1].strip(),'members':len(members),'leader':leader,'activity':sum(activity[i] for i in members)})
    sorted_activity=sorted(activity)
    gini=sum((2*(i+1)-n-1)*v for i,v in enumerate(sorted_activity))/(n*sum(activity))
    cumulative=[0]
    for value in sorted_activity: cumulative.append(cumulative[-1]+value)
    curve=[[round(i/n,5),round(cumulative[i]/cumulative[-1],5)] for i in range(0,n+1,8)]
    curve.append([1,1])
    strongest=next(row for row in monthly if row[0]!=row[1])
    reverse=next((w for a,b,w,m in monthly if a==strongest[1] and b==strongest[0]),0)
    example_index = next((i for i,s in enumerate(stations) if s['id']=='204'), groups[0]['leader'])
    example_view = json.loads((overview_dir/'weekday-all-all.json').read_text())
    example_route = next(r for r in detail[example_index]['segments']['weekday-all-all']['out'] if r[0] != example_index)
    study={'groups':groups,'mixing':mixing,'withinShare':sum(mixing[i][i] for i in range(ccount))/sum(map(sum,mixing)),
           'gini':round(gini,4),'lorenz':curve,'bikeTypes':bike_study,'monthlyActivity':activity,
           'strongestRoute':list(strongest),'strongestReverse':reverse,
           'example':{'station':example_index,'route':example_route,'departures':example_view['departures'][example_index],'days':day_counts['weekday']},
           'format':{'route':['other_station_index','trips','median_duration_minutes'],
                     'timeWindows':{'am':'07:00–09:59','day':'10:00–15:59','pm':'16:00–18:59','night':'19:00–06:59'},
                     'distance':'Great-circle distance between docks, not distance cycled',
                     'dayRates':'Trips divided by calendar days of the selected day type, including dates with zero trips',
                     'bikeTypes':'CLASSIC and PBSC_EBIKE from TfL; no unknown models in this pinned month'}}
    (public/'study.json').write_text(json.dumps(study,separators=(',',':')))
    (public/'index.json').write_text(json.dumps({'meta':meta,'stations':stations,'study':study},separators=(',',':')))
    con.close()
    return study

if __name__=='__main__': build(Path(__file__).resolve().parent.parent)
