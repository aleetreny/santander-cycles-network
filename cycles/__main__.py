"""Usage: python -m cycles {inventory,fetch,stations,prepare,network,map,all}."""
import argparse
from pathlib import Path
from . import acquire,prepare,network,viz

def main():
    p=argparse.ArgumentParser(description='Santander Cycles reproducible OD network pipeline')
    p.add_argument('command',choices=['inventory','fetch','stations','prepare','network','map','all'])
    p.add_argument('--root',type=Path,default=Path(__file__).resolve().parent.parent)
    p.add_argument('--limit',type=int,help='Number of CSV files, for a first smoke test')
    p.add_argument('--workers',type=int,default=3)
    p.add_argument('--year',type=int)
    p.add_argument('--month',type=int)
    p.add_argument('--day-type',choices=['all','weekday','weekend'],default='all')
    p.add_argument('--bike-model',help='Model substring, e.g. ELECTRIC. Only for recent extracts.')
    p.add_argument('--start-hour',type=int,choices=range(24),metavar='0..23')
    p.add_argument('--end-hour',type=int,choices=range(1,25),metavar='1..24')
    p.add_argument('--top',type=int,default=120)
    p.add_argument('--min-journeys',type=int,default=20)
    a=p.parse_args();root=a.root.resolve()
    if a.command in ('inventory','all'):acquire.refresh_manifest(root)
    if a.command in ('fetch','all'):acquire.download_all(root,workers=a.workers,limit=a.limit)
    if a.command in ('stations','all'):acquire.station_snapshot(root)
    if a.command in ('prepare','all'):prepare.convert(root,limit=a.limit)
    if a.command in ('network','all'):network.aggregate(root,a.year,a.month,a.day_type,a.bike_model,a.start_hour,a.end_hour)
    if a.command in ('map','all'):viz.render(root,a.top,a.min_journeys)
if __name__=='__main__':main()
