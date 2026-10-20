"""Normalize all known historical and modern TfL ride CSV schemas to partitioned parquet."""
import json
from pathlib import Path
import re
import zipfile
import pandas as pd

ALIASES = {
    'trip_id':['rentalid','number','journeyid','rentalnumber'],
    'bike_id':['bikeid','bikenumber'],
    'bike_model':['bikemodel'],
    'started_at':['startdate','startdatetime','starttime'],
    'ended_at':['enddate','enddatetime','endtime'],
    'start_station_id':['startstationid','startstationnumber','startdockingstationid'],
    'end_station_id':['endstationid','endstationnumber','enddockingstationid'],
    'start_station':['startstationname','startstation','startdockingstation'],
    'end_station':['endstationname','endstation','enddockingstation'],
    'duration_ms':['totaldurationms'],
    'duration_seconds':['duration','durationseconds','durationsec'],
}
REQUIRED=['trip_id','started_at','ended_at','start_station_id','end_station_id']

def key(s):return re.sub(r'[^a-z0-9]','',str(s).lower())

def normalize_chunk(frame:pd.DataFrame,source_file:str):
    keys={key(c):c for c in frame.columns}
    found={dest:next((keys[a] for a in poss if a in keys),None) for dest,poss in ALIASES.items()}
    missing=[x for x in REQUIRED if found[x] is None]
    if missing:raise ValueError(f'{source_file} missing {missing}; columns={list(frame.columns)}')
    out=pd.DataFrame(index=frame.index)
    for dest in ['trip_id','bike_id','bike_model','start_station_id','end_station_id','start_station','end_station']:
        col=found[dest]
        out[dest]=frame[col].astype('string').str.strip() if col is not None else pd.Series(pd.NA,index=frame.index,dtype='string')
    for dest in ['started_at','ended_at']:
        col=found[dest]
        # TfL timestamps are local London wall times. Keep timezone naive to avoid DST ambiguities.
        out[dest]=pd.to_datetime(frame[col],dayfirst=True,format='mixed',errors='coerce')
    if found['duration_ms']:
        out['duration_seconds']=pd.to_numeric(frame[found['duration_ms']],errors='coerce')/1000
    elif found['duration_seconds']:
        out['duration_seconds']=pd.to_numeric(frame[found['duration_seconds']],errors='coerce')
    else:
        out['duration_seconds']=(out['ended_at']-out['started_at']).dt.total_seconds()
    out['source_file']=source_file
    # Reject zero/missing station IDs and impossible timestamps. Do not assume missing/negative rides are real flows.
    valid=(out['started_at'].notna() & out['ended_at'].notna() & out['start_station_id'].notna() & out['end_station_id'].notna()
           & out['start_station_id'].ne('') & out['end_station_id'].ne('') & out['duration_seconds'].ge(0))
    return out.loc[valid].copy(),int((~valid).sum())


def _process_stream(handle,source,dirpath,chunk_size):
    n=0; dropped=0;parts=0
    for chunk in pd.read_csv(handle, dtype='string', chunksize=chunk_size,encoding='utf-8-sig',on_bad_lines='warn'):
        out,invalid=normalize_chunk(chunk,source);dropped+=invalid;n+=len(out)
        if len(out):
            out.to_parquet(dirpath/f'part_{parts:04d}.parquet',index=False,engine='pyarrow',compression='zstd')
            parts+=1
    return {'rows':n,'excluded_rows':dropped,'parts':parts}


def convert(root:Path,limit=None,chunk_size=200_000):
    manifest=root/'data'/'manifest.json'
    if not manifest.exists(): raise FileNotFoundError('Run inventory first')
    records=json.loads(manifest.read_text())['files']; records=records[:limit] if limit else records
    log=root/'data'/'processed'/'conversion_report.json'
    report=json.loads(log.read_text()) if log.exists() else {}
    for k,entry in enumerate(records,1):
        source=entry['key']; path=root/'data'/'raw'/source.removeprefix('usage-stats/')
        outdir=root/'data'/'processed'/re.sub(r'[^a-zA-Z0-9_.-]','_',path.name)
        if not path.exists():continue
        if report.get(source,{}).get('source_size_bytes')==entry['size_bytes'] and (outdir/'_SUCCESS').exists():
            continue
        outdir.mkdir(parents=True,exist_ok=True)
        for p in outdir.glob('*.parquet'):p.unlink()
        print(f'[{k}/{len(records)}] Processing {source}')
        try:
            if path.suffix.lower()=='.zip':
                with zipfile.ZipFile(path) as z:
                    csvs=[name for name in z.namelist() if name.lower().endswith('.csv')]
                    stats={'rows':0,'excluded_rows':0,'parts':0}
                    for i,name in enumerate(csvs):
                        subdir=outdir/f'zip_{i:02d}';subdir.mkdir(exist_ok=True)
                        with z.open(name) as stream:
                            chunk=_process_stream(stream,source+'/'+name,subdir,chunk_size)
                        for a in stats:stats[a]+=chunk[a]
            else:
                with path.open('rb') as stream: stats=_process_stream(stream,source,outdir,chunk_size)
            (outdir/'_SUCCESS').write_text('ok')
            report[source]={**stats,'source_size_bytes':entry['size_bytes'],'status':'ok'}
        except Exception as exc:
            report[source]={'status':'error','error':str(exc)}
            log.write_text(json.dumps(report,indent=2))
            raise
        log.write_text(json.dumps(report,indent=2))
    print('Conversion finished. Report:',log)
