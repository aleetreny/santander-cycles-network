"""Conservation checks for the fast, lazy atlas data (all 45 slices)."""
import json
from pathlib import Path
import pytest
from cycles.atlas import bucket, distance, summarize

DATA=Path(__file__).resolve().parent.parent/'site/data'


def test_distance_and_summarize_filter_pools_are_geographic_and_weighted():
    stations=[{'lat':51.5,'lon':-.1,'community':0},
              {'lat':51.501,'lon':-.101,'community':0},
              {'lat':51.55,'lon':-.2,'community':1}]
    assert distance(stations[0],stations[0])==0
    assert bucket(distance(stations[0],stations[1]))=='short'
    assert bucket(distance(stations[0],stations[2]))=='long'
    data=summarize([(0,0,20,2),(0,1,10,4),(1,2,5,15)],stations,21)
    assert data['journeys']==35
    assert data['departures']==[30,5,0]
    assert data['arrivals']==[20,10,5]
    assert data['degree']==[1,2,1]
    assert data['links']['short-within']==[[0,1,10,4]]
    assert data['links']['long-across']==[[1,2,5,15]]
    assert data['connections']==2


@pytest.fixture(scope='module')
def views():
    paths=list((DATA/'views').glob('*.json'))
    assert len(paths)==45
    return {p.stem:json.loads(p.read_text()) for p in paths}


def test_new_views_preserve_original_published_counts(views):
    meta=json.loads((DATA/'meta.json').read_text())
    for key,stats in meta['stats'].items():
        v=views[key+'-all']
        assert v['journeys']==stats['journeys']
        assert v['connections']==stats['edges']
    for key,v in views.items():
        assert sum(v['arrivals'])==sum(v['departures'])==v['journeys']
        assert len(v['arrivals'])==meta['stations']
        assert v['days'] in (10,21,31)


def test_bike_day_and_hour_filters_partition_exactly(views):
    for day in ('all','weekday','weekend'):
        for time in ('all','am','day','pm','night'):
            for column in ('arrivals','departures'):
                full=views[f'{day}-{time}-all'][column]
                a=views[f'{day}-{time}-classic'][column]
                b=views[f'{day}-{time}-electric'][column]
                assert all(x==y+z for x,y,z in zip(full,a,b))
    for day in ('all','weekday','weekend'):
        for bike in ('all','classic','electric'):
            assert views[f'{day}-all-{bike}']['journeys']==sum(views[f'{day}-{t}-{bike}']['journeys'] for t in ('am','day','pm','night'))
    for time in ('all','am','day','pm','night'):
        for bike in ('all','classic','electric'):
            assert views[f'all-{time}-{bike}']['journeys']==views[f'weekday-{time}-{bike}']['journeys']+views[f'weekend-{time}-{bike}']['journeys']


def test_lazy_station_details_conserve_every_arrival_and_departure(views):
    stations=json.loads((DATA/'stations.json').read_text())
    assert len(list((DATA/'detail').glob('*.json')))==len(stations)
    for i,station in enumerate(stations):
        detail=json.loads((DATA/'detail'/(station['id']+'.json')).read_text())
        assert detail['id']==station['id']
        assert set(detail['segments'])==set(views)
        for key,routes in detail['segments'].items():
            for direction,column in (('out','departures'),('in','arrivals')):
                rows=routes[direction]
                assert sum(w for j,w,m in rows)==views[key][column][i]
                assert [w for j,w,m in rows]==sorted((w for j,w,m in rows),reverse=True)
                assert all(0<=j<len(stations) and w>0 and m>=0 for j,w,m in rows)


def test_worked_example_and_mixing_denominators_are_explicit():
    study=json.loads((DATA/'study.json').read_text())
    example=study['example']
    assert example['departures']==525
    assert example['route'][1]==27
    assert example['days']==21
    assert round(example['route'][1]/example['departures']*100,1)==5.1
    meta=json.loads((DATA/'meta.json').read_text())
    total=sum(map(sum,study['mixing']))
    assert total==meta['mappedJourneys']-meta['stats']['all-all']['selfLoops']
    assert 0<study['withinShare']<1
    assert sum(b['journeys'] for b in study['bikeTypes'] if b['bike']!='all')==meta['mappedJourneys']
    assert sum(study['monthlyActivity'])==2*meta['mappedJourneys']
