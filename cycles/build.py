"""Run the whole study and write the compact JSON the site reads.

python -m cycles.build            # reuse cached chapter results where present
python -m cycles.build --fresh    # recompute every chapter (~10 min on a laptop)
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pickle
import time
from pathlib import Path
import numpy as np
from .trips import ROOT, build as build_trips
from .analysis import load, r, percentile_rank
from .analysis import backbone, structure, space, communities, temporal, flows, robustness, layers, embedding
from .geo import build as build_geo

SITE = ROOT / 'site/data'
# Readable names for the four Leiden regions, keyed by each region's busiest station.
REGIONS = {
    'Hyde Park Corner, Hyde Park': 'West: Kensington, Chelsea and Battersea',
    'Duke Street Hill, London Bridge': 'East: Shoreditch, the East End and Docklands',
    'Waterloo Station 3, Waterloo': 'Centre-south: Westminster, Waterloo and Southwark',
    'Argyle Street, Kings Cross': "Centre-north: Marylebone, Bloomsbury and Camden",
}
CACHE = ROOT / 'data/derived/cache'


def cached(name, fresh, fn):
    path = CACHE / f'{name}.pkl'
    if path.exists() and not fresh:
        return pickle.loads(path.read_bytes())
    start = time.time()
    value = fn()
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pickle.dumps(value))
    print(f'  {name}: {time.time() - start:.1f}s', flush=True)
    return value


def dump(name, obj):
    SITE.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    (SITE / name).write_text(text)
    print(f'  wrote {name}: {len(text) / 1024:.0f} KB')


def column(values, digits=4):
    v = np.asarray(values, float)
    return [None if not np.isfinite(x) else (int(x) if digits == 0 else round(float(x), digits)) for x in v]


def compass(lat, lon, lat0, lon0):
    dy, dx = lat - lat0, (lon - lon0) * np.cos(np.radians(lat0))
    angle = (np.degrees(np.arctan2(dy, dx)) + 360) % 360
    return ['East', 'North-east', 'North', 'North-west', 'West', 'South-west', 'South', 'South-east'][int(((angle + 22.5) % 360) // 45)]


def archetype_names(profiles):
    """Deterministic plain-language names from each cluster's rhythm."""
    names = {}
    remaining = list(profiles)
    for p in sorted(remaining, key=lambda p: -p['freeToWork']):
        if p['freeToWork'] > 1.05:
            names[p['id']] = ('Leisure & parks', 'Busier on weekends than on working days; trips start and end mid-afternoon.')
    rest = [p for p in profiles if p['id'] not in names]
    sinks = sorted([p for p in rest if p['amNet'] > 0.05], key=lambda p: -p['amNet'])
    if sinks:
        names[sinks[0]['id']] = ('Office core', 'Fills up 7–10 am, empties 4–7 pm; nearly silent at weekends.')
    for p in sinks[1:]:
        names[p['id']] = ('Workplaces & campuses', 'Morning arrivals, evening departures, with steady daytime and weekend use.')
    sources = sorted([p for p in rest if p['amNet'] < -0.05], key=lambda p: p['amNet'] - p['pmNet'])
    if sources:
        names[sources[0]['id']] = ('Commuter launchpads', 'Empties every morning as people ride out to work (rail termini behave like homes).')
    for p in sources[1:]:
        names[p['id']] = ('Residential streets', 'Gentle morning outflow and evening return, quieter overall.')
    for p in profiles:
        names.setdefault(p['id'], ('All-day mixers', 'Busy and balanced from morning to night: interchanges and nightlife.'))
    return names


def main(fresh=False):
    t0 = time.time()
    if fresh or not (ROOT / 'data/derived/trips.parquet').exists():
        build_trips()
    report = json.loads((ROOT / 'data/derived/trips-report.json').read_text())
    net = load()
    print('Running chapters')
    bb = cached('backbone', fresh, lambda: backbone.study(net))
    st = cached('structure', fresh, lambda: structure.study(net))
    sp = cached('space', fresh, lambda: space.study(net))
    cm = cached('communities', fresh, lambda: communities.study(net))
    tm = cached('temporal', fresh, lambda: temporal.study(net))
    fl = cached('flows', fresh, lambda: flows.study(net, tm['node']['hourlyNet']))
    rb = cached('robustness', fresh, lambda: robustness.study(net, {**st['node'], **cm['node']}))
    ly = cached('layers', fresh, lambda: layers.study(net, cm['node']['community']))
    em = cached('embedding', fresh, lambda: embedding.study(net))

    stations = net.stations
    node = {**st['node'], **sp['node'], **cm['node'], **tm['node'], **fl['node'], **ly['node'], **em['node']}

    # ---- names for regions and archetypes ----
    lat0, lon0 = stations['lat'].mean(), stations['lon'].mean()
    for g in cm['groups']:
        g['compass'] = compass(g['centre'][0], g['centre'][1], lat0, lon0)
        g['leaderName'] = stations['name'][g['leader']]
        g['label'] = REGIONS.get(g['leaderName'], f"{g['compass']} ({g['name']})")
    arche = archetype_names(tm['archetypes']['profiles'])
    for p in tm['archetypes']['profiles']:
        p['name'], p['blurb'] = arche[p['id']]

    # ---- stations.json : one column per measure ----
    strength = node['sOut'] + node['sIn']
    cols = {
        'id': stations['id'].tolist(), 'name': stations['name'].tolist(), 'area': stations['area'].tolist(),
        'lat': column(stations['lat'], 6), 'lon': column(stations['lon'], 6), 'docks': column(stations['docks'], 0),
        'active': [bool(x) for x in net.active],
        'sOut': column(node['sOut'], 0), 'sIn': column(node['sIn'], 0), 'kOut': column(node['kOut'], 0),
        'kIn': column(node['kIn'], 0), 'loops': column(node['loops'], 0),
        'pagerank': column(node['pagerank'], 6), 'hub': column(node['hub'], 5), 'authority': column(node['authority'], 5),
        'eigenvector': column(node['eigenvector'], 5), 'betweenness': column(node['betweenness'], 6),
        'closeness': column(node['closeness'], 5), 'coreness': column(node['coreness'], 0), 'score': column(node['score'], 0),
        'clustering': column(node['clustering'], 4),
        'reach': column(node['reach'], 3), 'surprise': column(node['surprise'], 4),
        'community': column(node['community'], 0), 'infomap': column(node['infomap'], 0),
        'confidence': column(node['confidence'], 3), 'withinZ': column(node['withinZ'], 3),
        'participation': column(node['participation'], 4), 'role': column(node['role'], 0),
        'archetype': column(node['archetype'], 0), 'burstiness': column(node['burstiness'], 4),
        'stationary': column(node['stationary'], 6), 'pressure': column(node['pressure'], 4),
        'vanTaken': column(node['vanTaken'], 0), 'vanGiven': column(node['vanGiven'], 0),
        'tripNet': column(node['tripNet'], 0),
        'occEmpty': column(node['occEmpty'], 4), 'occFull': column(node['occFull'], 4), 'occR': column(node['occR'], 3),
        'swing': column(node['swing'], 2), 'stress': column(node['stress'], 4),
        'ebikeShare': column(node['ebikeShare'], 4), 'leisure': column(node['leisure'], 4),
        'displacement': column(node['displacement'], 4),
    }
    pct = {k: column(percentile_rank(np.nan_to_num(np.asarray(cols[k], dtype=float))), 3)
           for k in ('pagerank', 'betweenness', 'closeness', 'eigenvector', 'hub', 'authority', 'participation',
                     'burstiness', 'stress', 'ebikeShare', 'reach', 'leisure', 'coreness')}
    pct['strength'] = column(percentile_rank(strength), 3)
    dump('stations.json', {'columns': cols, 'percentiles': pct, 'layouts': em['layouts'],
                           'partitions': cm['partitions']})

    # ---- links.json : the lines that get drawn ----
    keep = [e for e in bb['edges'] if e[3] >= 2]   # alpha < 0.01
    A = net.A
    i, j = np.nonzero(A)
    heavy = np.argsort(-A[i, j], kind='stable')[:len(keep) + 100]
    club = np.argsort(-strength)[:40]
    club_edges = [[int(a), int(b), int(A[a, b])] for a in club for b in club if A[a, b] > 0]
    dump('links.json', {
        'backbone': {'fields': bb['edgeFields'], 'edges': keep},
        'heaviest': [[int(i[k]), int(j[k]), int(A[i[k], j[k]])] for k in heavy],
        'club': {'members': [int(x) for x in club], 'edges': club_edges},
        'corridors': {'fields': sp['corridorFields'], 'edges': sp['corridors'], 'gaps': sp['gaps']},
        'relocations': {'fields': fl['relocation']['edgeFields'], 'edges': fl['relocation']['edges']},
    })

    # ---- pulse.json : half-hour frames for the animated day ----
    dump('pulse.json', {'binMinutes': temporal.BIN_MIN, **tm['pulse']})

    # ---- profiles.json : everything the station explorer shows ----
    A = net.A
    top_out = [[[int(j), int(A[i, j])] for j in np.argsort(-A[i])[:8] if A[i, j] > 0] for i in range(net.n)]
    top_in = [[[int(j), int(A[j, i])] for j in np.argsort(-A[:, i])[:8] if A[j, i] > 0] for i in range(net.n)]
    dump('profiles.json', {
        'out': top_out, 'in': top_in,
        'rhythm': np.round(node['rhythm'], 2).tolist(),
        'occBikes': [column(row, 1) for row in node['occBikes']],
        'hourlyNet': np.round(node['hourlyNet'], 2).tolist(),
    })

    # ---- study.json : every chart and number in the essay ----
    rel = {k: v for k, v in fl['relocation'].items() if k not in ('edges', 'edgeFields')}
    occ = json.loads((ROOT / 'data/occupancy/manifest.json').read_text())
    manifest = json.loads((ROOT / 'data/manifest.json').read_text())
    study = {
        'meta': {
            'generated': time.strftime('%Y-%m-%d'), 'report': report,
            'sources': {
                'journeys': [{'key': f['key'], 'bytes': f['size_bytes'], 'etag': f['etag'], 'url': f['url']} for f in manifest['files']],
                'occupancy': {'repository': occ.get('repository'), 'revision': occ.get('revision'),
                              'files': len(occ.get('files', [])), 'licence': 'CC BY-SA 3.0'},
                'stations': 'TfL BikePoint API snapshot, 20 Oct 2026',
            },
        },
        'summary': st['summary'],
        'distributions': st['distributions'],
        'centrality': st['centrality'],
        'mixing': st['mixing'], 'richClub': st['richClub'], 'motifs': st['motifs'],
        'backbone': {'levels': bb['levels']},
        'space': {k: sp[k] for k in ('models', 'best', 'decay', 'decayFields', 'grid', 'lengths', 'river')},
        'communities': {k: cm[k] for k in ('sweep', 'reference', 'modularity', 'stability', 'nullModularity',
                                           'infomap', 'groups', 'mixing', 'roles')},
        'temporal': {k: tm[k] for k in ('days', 'hourly', 'week', 'daily', 'similarity', 'commute', 'centroid',
                                        'leaders', 'archetypes')},
        'dynamics': {'markov': fl['markov'], 'relocation': rel, 'validation': fl['validation']},
        'robustness': rb,
        'layers': ly['layers'], 'layerPairs': ly['pairs'], 'ebikeByKm': ly['ebikeByKm'],
        'embedding': {'quality': em['quality'], 'spectrum': em['spectrum'], 'eigengap': em['eigengap']},
    }
    dump('study.json', study)
    build_geo(ROOT, SITE)
    # Content hashes let the page cache-bust data files after a rebuild.
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()[:10] for p in sorted(SITE.glob('*.json')) if p.name != 'version.json'}
    dump('version.json', hashes)
    print(f'Done in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fresh', action='store_true')
    main(parser.parse_args().fresh)
