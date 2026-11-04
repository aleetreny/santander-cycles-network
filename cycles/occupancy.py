"""Simple station occupancy statistics from archived TfL BikePoint observations.

python -m cycles.occupancy --month 2026-09
Archive: feregrino/london-cycles (CC-BY-SA-3.0); raw data stay in data/occupancy/.
"""
from __future__ import annotations
from pathlib import Path
import argparse,calendar,concurrent.futures as cf,hashlib,json
from datetime import date,timedelta,datetime,timezone
import pandas as pd
import requests

REPO='feregrino/london-cycles'
BASE='https://huggingface.co/datasets/'+REPO

def download(session,url,path):
    if not path.exists():
        response=session.get(url,timeout=90);response.raise_for_status();path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(response.content)
    return {'url':url,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def normalize(frame):
    """Reject impossible counters; preserve unavailable stations as missing, never zero."""
    data=frame.copy()
    for col in ['bikes','empty_docks','docks']: data[col]=pd.to_numeric(data[col],errors='coerce')
    data['utc']=pd.to_datetime(data.query_time,utc=True,errors='coerce')
    good=(data.utc.notna() & data.bikes.ge(0) & data.empty_docks.ge(0) & data.docks.gt(0)
          & (data.bikes+data.empty_docks).gt(0) & (data.bikes+data.empty_docks).le(data.docks))
    data=data.loc[good].drop_duplicates(['place_id','utc']).copy()
    data['local']=data.utc.dt.tz_convert('Europe/London')
    data['day']=data.local.dt.date
    data['source_day']=data.utc.dt.date
    data['hour']=data.local.dt.hour
    data['weekend']=data.local.dt.day_of_week.ge(5)
    data['fill']=data.bikes/(data.bikes+data.empty_docks)
    data['empty']=data.bikes.eq(0)
    data['full']=data.empty_docks.eq(0)
    return data


def profile(frame):
    """Each date has equal weight inside an hour, despite irregular collection."""
    if frame.empty:return None
    daily=frame.groupby(['day','hour']).agg(bikes=('bikes','mean'),free=('empty_docks','mean'),fill=('fill','mean'),empty=('empty','mean'),full=('full','mean'),samples=('bikes','size')).reset_index()
    hourly=daily.groupby('hour').agg(bikes=('bikes','mean'),free=('free','mean'),fill=('fill','mean'),empty=('empty','mean'),full=('full','mean'),days=('day','nunique'),samples=('samples','sum'))
    hours=[]
    for h in range(24):
        if h not in hourly.index or hourly.loc[h,'days']<3:hours.append(None);continue
        r=hourly.loc[h];hours.append([round(float(r.bikes),1),round(float(r.free),1),round(float(r['fill']),4),int(r['days']),int(r.samples)])
    return {'days':int(frame.day.nunique()),'samples':len(frame),'empty':round(float(frame['empty'].mean()),4),'full':round(float(frame['full'].mean()),4),'meanFill':round(float(daily['fill'].mean()),4),'hours':hours}


def compact_live(items,captured=None):
    result=[]
    for item in items:
        props={p['key']:p for p in item.get('additionalProperties',[])}
        def count(key):
            try:return int(props[key]['value'])
            except (KeyError,ValueError,TypeError):return None
        result.append({'id':item['id'].replace('BikePoints_',''),'name':item['commonName'],'lat':item['lat'],'lon':item['lon'],
            'bikes':count('NbBikes'),'free':count('NbEmptyDocks'),'capacity':count('NbDocks'),
            'installed':props.get('Installed',{}).get('value')=='true','locked':props.get('Locked',{}).get('value')=='true',
            'modified':max((props[k].get('modified','') for k in ('NbBikes','NbEmptyDocks') if k in props),default='')})
    return {'captured':captured or datetime.now(timezone.utc).isoformat(),'stations':result}


def build(root,month='2026-09',offline=False):
    year,mon=map(int,month.split('-'));start=date(year,mon,1);end=date(year,mon,calendar.monthrange(year,mon)[1]);cache=root/'data/occupancy';cache.mkdir(parents=True,exist_ok=True)
    session=requests.Session()
    if offline:
        manifest=json.loads((cache/'manifest.json').read_text());revision=manifest['revision']
    else:
        response=session.get('https://huggingface.co/api/datasets/'+REPO,timeout=30);response.raise_for_status();revision=response.json()['sha']
        if (cache/'manifest.json').exists():
            previous=json.loads((cache/'manifest.json').read_text())
            if previous['revision']!=revision:
                raise ValueError('Archive revision changed. Use --offline for the pinned snapshot, or move data/occupancy aside before acquiring a new revision.')
        manifest={'repository':BASE,'revision':revision,'files':[]}
    # Include the preceding UTC day, then select the exact London calendar month.
    dates=[start-timedelta(days=1)+timedelta(days=i) for i in range((end-start).days+2)]
    def get_day(d):
        rel=f'data/year={d.year}/month={d.month:02}/day={d.day:02}/part.csv'
        path=cache/f'{d}.csv';url=f'{BASE}/resolve/{revision}/{rel}'
        entry=download(session,url,path)
        if offline:
            expected=next((f for f in manifest['files'] if f['url']==url),None)
            if not expected or expected['sha256']!=entry['sha256']:raise ValueError(f'Cached source differs from pinned manifest: {path.name}')
        return path,entry
    with cf.ThreadPoolExecutor(max_workers=3) as pool: files=list(pool.map(get_day,dates))
    station_path=cache/'stations.csv';station_entry=download(session,f'{BASE}/resolve/{revision}/stations.csv',station_path)
    if offline and station_entry['sha256']!=manifest['stationReference']['sha256']:raise ValueError('Station reference differs from pinned manifest')
    source=pd.read_csv(station_path);frames=[]
    for path,entry in files:
        raw=pd.read_csv(path);frames.append(raw)
    raw=pd.concat(frames,ignore_index=True);rows=len(raw);data=normalize(raw);data=data[(data.local.dt.year==year)&(data.local.dt.month==mon)].copy()
    refs=source.copy();refs['valid_from']=pd.to_datetime(refs.valid_from).dt.date;refs['valid_to']=pd.to_datetime(refs.valid_to,errors='coerce').dt.date
    # As-of version join. Different station versions must not multiply observations.
    merged=data.merge(refs,on='place_id',how='left',suffixes=('','_station'))
    valid=merged['valid_from'].notna() & (merged['valid_from']<=merged.source_day) & (merged['valid_to'].isna() | (merged.source_day<merged['valid_to'])) & merged.installed.astype(str).str.lower().eq('true')
    data=merged.loc[valid].copy()
    assert not data.duplicated(['place_id','utc']).any(),'Station version join multiplied rows'
    observed_dates=sorted(str(d) for d in data.day.unique())
    if len(observed_dates)!=calendar.monthrange(year,mon)[1]:raise ValueError(f'Archive has only {len(observed_dates)} London dates; expected full month')
    stations={}
    for pid,frame in data.groupby('place_id'):
        sid=pid.replace('BikePoints_','')
        # Current reference is used only to label the historic station; retain historic coordinates.
        last=frame.sort_values('utc').iloc[-1]
        stations[sid]={'name':str(last.common_name),'lat':float(last.lat),'lon':float(last.lon),'all':profile(frame)}
    manifest.update({'month':month,'files':[entry for _,entry in files],'stationReference':station_entry,'rawRows':rows,'validMonthRows':len(data),'dates':observed_dates,'excludedBeforeMonthSelection':rows-len(normalize(raw))})
    (cache/'manifest.json').write_text(json.dumps(manifest,indent=2))
    output={'month':month,'start':str(start),'end':str(end),'source':BASE,'revision':revision,'licence':'CC-BY-SA-3.0','generated':datetime.now(timezone.utc).isoformat(),'observations':len(data),'stations':stations,
        'method':'Source query_time is UTC, converted to Europe/London. Duplicate station/timestamps and impossible/zero-usable-dock readings excluded. Historic coordinates joined as-of the observation date. Hourly means balance dates equally; fewer than 3 observed dates means missing, not zero. Full/empty percentages are fractions of observed readings, not exact time fractions. Locked status is absent from the archive.'}
    out=root/'site/data';out.mkdir(exist_ok=True)
    (out/'occupancy.json').write_text(json.dumps(output,separators=(',',':')))
    (out/'occupancy-provenance.json').write_text(json.dumps(manifest,indent=2))
    print('Built',len(stations),'stations,',len(data),'valid readings across',len(observed_dates),'dates',flush=True)
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--month',default='2026-09');parser.add_argument('--offline',action='store_true');args=parser.parse_args();build(Path(__file__).resolve().parent.parent,args.month,args.offline)
