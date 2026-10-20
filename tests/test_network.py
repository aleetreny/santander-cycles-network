import pandas as pd
from cycles.network import geolocate


def test_geolocate_reports_missing(tmp_path):
    p=tmp_path/'data/stations';p.mkdir(parents=True)
    pd.DataFrame([{'station_id':'1','name':'River Street, Clerkenwell','lat':51.53,'lon':-0.11},
                  {'station_id':'2','name':'Green Park, Mayfair','lat':51.5,'lon':-0.14}]).to_csv(p/'stations_latest.csv',index=False)
    raw=pd.DataFrame([{'start_station_id':'100','end_station_id':'2','start_station':'River Street, Clerkenwell',
                      'end_station':'Green Park, Mayfair','journeys':10,'avg_duration_s':900},
                      {'start_station_id':'999','end_station_id':'2','start_station':'Historical Station (closed)',
                      'end_station':'Green Park, Mayfair','journeys':20,'avg_duration_s':1000}])
    nodes,edges=geolocate(tmp_path,raw)
    assert edges.start_lat.notna().sum()==1
    assert nodes.lat.isna().sum()==1
    assert '33.3%' in (tmp_path/'outputs'/'quality.txt').read_text()
