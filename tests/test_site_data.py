"""The published JSON agrees with itself: every number the page quotes adds up."""
import json
import math
from pathlib import Path
import pytest

DATA = Path(__file__).resolve().parent.parent / 'site' / 'data'
pytestmark = pytest.mark.skipif(not (DATA / 'study.json').exists(), reason='site data not built')


def load(name):
    return json.loads((DATA / f'{name}.json').read_text())


def finite(obj):
    if isinstance(obj, float):
        return math.isfinite(obj)
    if isinstance(obj, dict):
        return all(finite(v) for v in obj.values())
    if isinstance(obj, list):
        return all(finite(v) for v in obj)
    return True


@pytest.fixture(scope='module')
def study():
    return load('study')


@pytest.fixture(scope='module')
def stations():
    return load('stations')


def test_every_file_is_finite_json():
    for name in ('study', 'stations', 'links', 'pulse', 'profiles', 'geo', 'version'):
        assert finite(load(name)), name


def test_journey_accounting(study, stations):
    s, rep = study['summary'], study['meta']['report']
    assert s['journeys'] == rep['matchedJourneys']
    assert s['graphJourneys'] + s['selfLoops'] == s['journeys']
    cols = stations['columns']
    assert sum(cols['sOut']) == s['graphJourneys'] == sum(cols['sIn'])
    assert sum(cols['loops']) == s['selfLoops']


def test_station_columns_have_one_value_per_station(stations):
    n = len(stations['columns']['id'])
    assert n == 801
    for key, col in stations['columns'].items():
        assert len(col) == n, key
    for name, layout in stations['layouts'].items():
        assert len(layout) == n, name
    for gamma, part in stations['partitions'].items():
        assert len(part) == n, gamma


def test_backbone_export_matches_levels(study):
    links = load('links')
    levels = {l['alpha']: l for l in study['backbone']['levels']}
    edges = links['backbone']['edges']
    assert len(edges) == levels[0.01]['edges']
    assert sum(e[3] >= 3 for e in edges) == levels[0.001]['edges']
    # The comparison list has enough of the heaviest links for every slider position.
    assert len(links['heaviest']) >= levels[0.01]['edges']


def test_operator_mirrors_riders(stations, study):
    c = stations['columns']
    # Every relocation removes one bike somewhere and adds one somewhere else.
    assert sum(c['vanTaken']) == sum(c['vanGiven']) == study['dynamics']['relocation']['relocations']
    assert sum(c['tripNet']) == 0


def test_pulse_frames_are_per_day(study):
    pulse = load('pulse')
    for kind in ('work', 'free'):
        frame = pulse[kind]
        assert len(frame['departures']) == 24 * 60 // pulse['binMinutes']
        per_day = sum(map(sum, frame['departures']))
        hourly = sum(study['temporal']['hourly'][kind]['trips'])
        # The pulse leaves out same-dock returns; the hourly curve keeps them.
        assert 0.9 * hourly < per_day <= hourly * 1.001


def test_regions_are_named_and_cover_active_stations(study, stations):
    groups = study['communities']['groups']
    assert all(':' in g['label'] for g in groups)
    active = sum(stations['columns']['active'])
    assert sum(g['stations'] for g in groups) == active


def test_validation_and_models_are_sane(study):
    v = study['dynamics']['validation']
    assert 0 < v['pooledR'] <= 1 and 0 < v['slope'] < 1.5
    models = {m['name']: m for m in study['space']['models']}
    assert models['river']['loglik'] >= models['exponential']['loglik']
    assert study['space']['river']['theta'] > 0
