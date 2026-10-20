"""Availability cannot be inferred from journey counts or missing readings."""
import json
from pathlib import Path
import pandas as pd
from cycles.occupancy import normalize, profile, compact_live


def readings(rows):
    return pd.DataFrame([dict(place_id='BikePoints_1',query_time=t,bikes=b,empty_docks=f,docks=d) for t,b,f,d in rows])


def test_missing_and_impossible_docks_are_not_empty_or_full():
    frame=normalize(readings([
        ('2026-09-01 12:00',0,0,20),('2026-09-01 12:01',-1,10,20),
        ('2026-09-01 12:02',10,11,20),('2026-09-01 12:03',None,10,20),
        ('2026-09-01 12:04',0,10,20),('2026-09-01 12:05',10,0,20),
        ('2026-09-01 12:05',10,0,20)]))
    assert len(frame)==2
    assert frame['empty'].sum()==1 and frame['full'].sum()==1


def test_utc_boundary_is_converted_to_london_month_and_hour():
    row=normalize(readings([('2026-08-31 23:10',5,5,10)])).iloc[0]
    assert str(row.day)=='2026-09-01' and row.hour==0
    assert str(row.source_day)=='2026-08-31'


def test_hourly_mean_balances_dates_despite_irregular_polling():
    frame=normalize(readings([
        ('2026-09-01 11:00',0,10,10),('2026-09-01 11:01',0,10,10),
        ('2026-09-01 11:02',0,10,10),('2026-09-02 11:00',6,4,10),
        ('2026-09-03 11:00',6,4,10)]))
    p=profile(frame)
    assert p['hours'][12][:2]==[4.0,6.0]
    assert p['empty']==.6  # explicitly a reading fraction, not fraction of time
    assert p['hours'][11] is None  # absent hour never becomes zero
    assert profile(frame.iloc[:3])['hours'][12] is None # insufficient dates


def test_live_missing_counter_remains_missing():
    p=compact_live([{'id':'BikePoints_1','commonName':'Test','lat':51.5,'lon':-.1,
        'additionalProperties':[{'key':'NbBikes','value':'not available'}]}])
    assert p['stations'][0]['bikes'] is None
    assert p['stations'][0]['free'] is None


def test_published_availability_has_full_month_and_valid_ranges():
    root=Path(__file__).resolve().parent.parent/'site/data'
    d=json.loads((root/'occupancy.json').read_text())
    source=json.loads((root/'occupancy-provenance.json').read_text())
    assert d['observations']==sum(s['all']['samples'] for s in d['stations'].values())
    assert len(source['dates'])==30 and len(source['files'])==31
    assert source['revision']==d['revision'] and d['licence']=='CC-BY-SA-3.0'
    assert all(len(f['sha256'])==64 for f in source['files'])
    for s in d['stations'].values():
        p=s['all'];assert 0<=p['empty']<=1 and 0<=p['full']<=1
        assert p['empty']+p['full']<=1.0001
        assert len(p['hours'])==24
        for h in p['hours']:
            if h: assert h[0]>=0 and h[1]>=0 and 0<=h[2]<=1 and h[3]>=3
