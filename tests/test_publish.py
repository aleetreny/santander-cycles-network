"""Scientific invariants of the published directed, weighted graph."""
import json
from pathlib import Path
import pytest
from cycles.publish import communities, metrics, pick_sources, resilience


def test_month_sources_include_cross_month_overlap():
    files = [{'key':f'usage-stats/{name}'} for name in (
        '1JourneyDataExtract15Apr2026-02May2026.csv',
        '2JourneyDataExtract03May2026-31May2026.csv',
        '3JourneyDataExtract01Jun2026-15Jun2026.csv')]
    assert pick_sources(files,2026,5) == files[:2]
    with pytest.raises(ValueError): pick_sources(files,2025,5)


def test_strength_degree_density_and_loops_have_distinct_meanings():
    result = metrics([[0,1,10],[1,0,3],[1,2,2],[0,0,5]],4)
    assert result['journeys'] == 20
    assert result['edges'] == 3
    assert result['active'] == 3
    assert result['density'] == .5
    assert result['reciprocity'] == .6667
    assert result['selfLoops'] == 5
    assert result['largestComponent'] == 3
    assert result['topStations'][0] == 0


def test_isolated_current_station_is_not_assigned_to_a_community():
    assignment, modularity = communities([[0,1,10],[1,0,5],[1,1,1000]],3)
    assert assignment[0] == assignment[1]
    assert assignment[2] == -1
    assert modularity == 0


def test_targeted_removal_is_reproducible_and_removes_both_directions():
    edges = [[0,i,100] for i in range(1,10)] + [[i,0,50] for i in range(1,10)]
    result = resilience(edges,10)
    assert result == resilience(edges,10)
    assert result['removed'] == 1
    assert result['targetedRetained'] == 0
    assert result['randomRetained'] > 0


DATA=Path(__file__).resolve().parent.parent/'site/data'

@pytest.mark.skipif(not (DATA/'meta.json').exists(), reason='Published snapshot not built')
def test_published_snapshot_conserves_journeys_and_filter_partitions():
    meta=json.loads((DATA/'meta.json').read_text())
    stations=json.loads((DATA/'stations.json').read_text())
    assert len(stations)==meta['stations']
    assert len({s['id'] for s in stations})==len(stations)
    assert meta['mappedJourneys']+meta['unmappedJourneys']==meta['validJourneys']
    assert len(meta['daily'])==meta['days']
    assert sum(n for d,n in meta['daily'])==meta['validJourneys']
    assert meta['coverage']>.95
    for period in ('all','am','pm'):
        tables={}
        for day in ('all','weekday','weekend'):
            key=day+'-'+period
            edges=json.loads((DATA/(key+'.json')).read_text())
            assert all(0<=a<len(stations) and 0<=b<len(stations) and w>0 for a,b,w in edges)
            assert sum(w for a,b,w in edges)==meta['stats'][key]['journeys']
            assert len({(a,b) for a,b,w in edges})==len(edges)
            tables[day]={(a,b):w for a,b,w in edges}
        keys=set(tables['weekday'])|set(tables['weekend'])
        assert all(tables['all'][e]==tables['weekday'].get(e,0)+tables['weekend'].get(e,0) for e in keys)
        assert set(tables['all'])==keys
