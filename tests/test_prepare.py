import pandas as pd
import pytest
from cycles.prepare import normalize_chunk
from cycles.acquire import discover, BUCKET
from unittest.mock import Mock


def test_old_schema():
    df=pd.DataFrame([{'Rental Id':'94113398','Duration':'960','Bike Id':'6800',
       'End Date':'07/01/2020 14:07','EndStation Id':'541','EndStation Name':'Green Park',
       'Start Date':'07/01/2020 13:51','StartStation Id':'164','StartStation Name':'Bayswater'}])
    got,bad=normalize_chunk(df,'old.csv')
    assert bad==0 and len(got)==1
    assert got.iloc[0].duration_seconds==960
    assert got.iloc[0].started_at.month==1
    assert got.iloc[0].start_station_id=='164'


def test_new_schema():
    df=pd.DataFrame([{'Number':'131615942','Start date':'2023/6/18 23:59','Start station number':'1106',
       'Start station':'Rampayne Street, Pimlico','End date':'2023/6/19 0:03',
       'End station number':'1087','End station':'Belgrave Road, Victoria',
       'Bike number':'56222','Bike model':'CLASSIC','Total duration (ms)':'256371'}])
    got,bad=normalize_chunk(df,'new.csv')
    assert bad==0 and len(got)==1
    assert got.iloc[0].duration_seconds==pytest.approx(256.371)
    assert got.iloc[0].started_at.month==6


def test_bad_station_is_excluded():
    df=pd.DataFrame([{'Number':'99','Start date':'2023/6/18 23:59','Start station number':'',
       'End date':'2023/6/19 0:03','End station number':'1087'}])
    got,bad=normalize_chunk(df,'test.csv')
    assert len(got)==0 and bad==1


def test_s3_listing_namespace_and_pagination():
    a='''<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Contents><Key>usage-stats/1JourneyDataExtract.csv</Key><Size>12</Size><LastModified>2026-01-01</LastModified><ETag>"abc"</ETag></Contents><NextContinuationToken>123</NextContinuationToken></ListBucketResult>'''
    b='''<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Contents><Key>usage-stats/2JourneyDataExtract.csv</Key><Size>17</Size><LastModified>2026-02-01</LastModified><ETag>"def"</ETag></Contents></ListBucketResult>'''
    session=Mock();session.get.side_effect=[Mock(content=a.encode()),Mock(content=b.encode())]
    files=discover(session=session)
    assert len(files)==2
    assert files[0]['size_bytes']==12
    assert files[1]['key'].endswith('.csv')
    assert session.get.call_count==2
