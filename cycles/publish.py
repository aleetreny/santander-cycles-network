"""Reproducible, complete-month dataset for the static network atlas.

Run: python -m cycles.publish --year 2026 --month 5
Raw trip records never leave data/. Public outputs contain station-level aggregates.
"""
from __future__ import annotations
import argparse
import calendar
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import random
import re

import duckdb
import networkx as nx
import pandas as pd
from . import acquire, prepare
from .network import canonical

SEGMENTS = [(day, period) for day in ('all', 'weekday', 'weekend') for period in ('all', 'am', 'pm')]


def pick_sources(records, year, month):
    start = datetime(year, month, 1)
    end = datetime(year, month, calendar.monthrange(year, month)[1], 23, 59, 59)
    picked = []
    for entry in records:
        m = re.search(r'Extract(\d{2}[A-Za-z]{3}\d{4})-(\d{2}[A-Za-z]{3}\d{4})', entry['key'])
        if m:
            a, b = [datetime.strptime(x, '%d%b%Y') for x in m.groups()]
            if a <= end and b >= start:
                picked.append(entry)
    if not picked:
        raise ValueError('No dated source extracts overlap the requested month')
    return picked


def metrics(edges, count):
    g = nx.DiGraph()
    for a, b, w in edges:
        if a != b:
            g.add_edge(a, b, weight=w)
    active = g.number_of_nodes()
    undirected = g.to_undirected()
    largest = len(max(nx.connected_components(undirected), key=len)) if active else 0
    strengths = [0] * count
    for a, b, w in edges:
        strengths[a] += w
        strengths[b] += w
    top = sorted(range(count), key=lambda i: (-strengths[i], i))
    return {
        'journeys': sum(e[2] for e in edges), 'active': active,
        'edges': g.number_of_edges(), 'density': round(nx.density(g), 6),
        'reciprocity': round(nx.reciprocity(g) or 0, 4) if g.number_of_edges() else 0,
        'largestComponent': largest, 'topStations': top[:10],
        'topTenShare': round(sum(strengths[i] for i in top[:10]) / max(1, sum(strengths)), 5),
        'selfLoops': sum(w for a, b, w in edges if a == b),
    }


def communities(edges, count):
    g = nx.Graph()
    for a, b, w in edges:
        if a == b:
            continue
        if g.has_edge(a, b):
            g[a][b]['weight'] += w
        else:
            g.add_edge(a, b, weight=w)
    groups = sorted(nx.community.louvain_communities(g, weight='weight', seed=42, resolution=1), key=lambda c: -len(c))
    assignment = [-1] * count
    for index, members in enumerate(groups):
        for node in members:
            assignment[node] = index
    return assignment, round(nx.community.modularity(g, groups, weight='weight'), 4)


def resilience(edges, count):
    active = sorted({n for a, b, w in edges if a != b for n in (a, b)})
    volume = [0] * count
    for a, b, w in edges:
        volume[a] += w
        volume[b] += w
    total = sum(w for a, b, w in edges)
    def retained(removed):
        return sum(w for a, b, w in edges if a not in removed and b not in removed) / max(1, total)
    k = max(1, round(len(active) * .1))
    targeted = set(sorted(active, key=lambda n: (-volume[n], n))[:k])
    rng = random.Random(42)
    samples = [retained(set(rng.sample(active, k))) for _ in range(100)]
    return {'removed': k, 'targetedRetained': round(retained(targeted), 5),
            'randomRetained': round(sum(samples) / len(samples), 5),
            'randomMin': round(min(samples), 5), 'randomMax': round(max(samples), 5), 'samples': 100}


def export(root, year, month):
    out = root / 'site' / 'data'
    out.mkdir(parents=True, exist_ok=True)
    stations = pd.read_csv(root / 'data/stations/stations_latest.csv', dtype={'station_id': str}).sort_values('station_id').reset_index(drop=True)
    current = []
    names = {}
    for i, row in stations.iterrows():
        current.append({'id': row.station_id, 'name': row['name'], 'lat': round(float(row.lat), 6), 'lon': round(float(row.lon), 6)})
        names.setdefault(canonical(row['name']), []).append(i)
    ids = {s['id']: i for i, s in enumerate(current)}
    def match(sid, name):
        candidates = names.get(canonical(name), [])
        if sid in ids and ids[sid] in candidates:
            return ids[sid]
        return candidates[0] if len(candidates) == 1 else None
    con = duckdb.connect(config={'threads': '4'})
    pattern = str(root / 'data/processed/**/*.parquet').replace("'", "''")
    con.execute(f"""CREATE TEMP TABLE monthly AS SELECT * FROM read_parquet('{pattern}', union_by_name=true)
        WHERE year(started_at)={int(year)} AND month(started_at)={int(month)}""")
    raw_count = con.execute('SELECT count(*) FROM monthly').fetchone()[0]
    # The same rental can appear in overlapping extracts. Keep one, deterministically.
    con.execute("""CREATE TEMP TABLE rides AS SELECT * EXCLUDE(rn) FROM (
        SELECT *, row_number() OVER(PARTITION BY coalesce(nullif(trip_id,''),
        source_file || ':' || cast(started_at as varchar) || ':' || coalesce(bike_id,'') || ':' || start_station_id || ':' || end_station_id)
        ORDER BY source_file DESC) rn FROM monthly)
        WHERE rn=1 AND ended_at >= started_at AND duration_seconds > 0""")
    valid_count = con.execute('SELECT count(*) FROM rides').fetchone()[0]
    days = con.execute('SELECT cast(started_at as date) AS day,count(*) AS n FROM rides GROUP BY 1 ORDER BY 1').fetchall()
    expected = calendar.monthrange(year, month)[1]
    if len(days) != expected:
        raise ValueError(f'Incomplete month: {len(days)} dates, expected {expected}')
    base = con.execute('SELECT DISTINCT start_station_id,start_station FROM rides UNION SELECT DISTINCT end_station_id,end_station FROM rides').fetchall()
    mapping = [(str(sid), str(name), match(str(sid), name)) for sid, name in base]
    mapdf = pd.DataFrame(mapping, columns=['sid', 'name', 'node'])
    con.register('station_map', mapdf)
    con.execute('''CREATE TEMP TABLE mapped AS SELECT r.*,cast(a.node as integer) AS a,cast(b.node as integer) AS b
        FROM rides r LEFT JOIN station_map a ON r.start_station_id=a.sid AND r.start_station=a.name
        LEFT JOIN station_map b ON r.end_station_id=b.sid AND r.end_station=b.name''')
    matched = con.execute('SELECT count(*) FROM mapped WHERE a IS NOT NULL AND b IS NOT NULL').fetchone()[0]
    # Missing historic endpoints are audited, never assigned a nearby station.
    unmatched = con.execute('''SELECT station_id,station_name,sum(n) AS n FROM (
        SELECT start_station_id AS station_id,start_station AS station_name,count(*) AS n FROM mapped WHERE a IS NULL GROUP BY 1,2
        UNION ALL SELECT end_station_id,end_station,count(*) FROM mapped WHERE b IS NULL GROUP BY 1,2)
        GROUP BY 1,2 ORDER BY 3 DESC''').df()
    unmatched.to_csv(out / 'unmatched-stations.csv', index=False)
    stats = {}
    all_edges = []
    for day, period in SEGMENTS:
        conditions = ['a IS NOT NULL', 'b IS NOT NULL']
        if day == 'weekday': conditions.append('dayofweek(started_at) BETWEEN 1 AND 5')
        if day == 'weekend': conditions.append('dayofweek(started_at) IN (0,6)')
        if period == 'am': conditions.append('hour(started_at) >= 7 AND hour(started_at) < 10')
        if period == 'pm': conditions.append('hour(started_at) >= 16 AND hour(started_at) < 19')
        edges = [list(row) for row in con.execute('SELECT a,b,count(*) n FROM mapped WHERE ' + ' AND '.join(conditions) + ' GROUP BY 1,2 ORDER BY n DESC,a,b').fetchall()]
        key = day + '-' + period
        (out / (key + '.json')).write_text(json.dumps(edges, separators=(',', ':')))
        stats[key] = metrics(edges, len(current))
        if day == period == 'all': all_edges = edges
    assignment, modularity = communities(all_edges, len(current))
    for i, node in enumerate(current): node['community'] = assignment[i]
    hours = {}
    for day in ('weekday', 'weekend'):
        cond = 'BETWEEN 1 AND 5' if day == 'weekday' else 'IN (0,6)'
        row = dict(con.execute(f'SELECT hour(started_at),count(*) FROM mapped WHERE a IS NOT NULL AND b IS NOT NULL AND dayofweek(started_at) {cond} GROUP BY 1').fetchall())
        n_days = sum((d[0].weekday() < 5) == (day == 'weekday') for d in days)
        hours[day] = [round(row.get(i, 0) / n_days, 2) for i in range(24)]
    snapshot_files = sorted((root / 'data/stations').glob('bikepoint_*.json'))
    captured = snapshot_files[-1].stem.replace('bikepoint_', '')
    manifest = json.loads((root / 'data/manifest.json').read_text())
    sources = []
    for entry in manifest['files']:
        path = root / 'data/raw' / entry['key'].removeprefix(acquire.PREFIX)
        sources.append({**entry, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    metadata = {'year': year, 'month': month, 'period': f'{calendar.month_name[month]} {year}',
        'start': f'{year}-{month:02}-01', 'end': f'{year}-{month:02}-{expected}', 'days': expected,
        'generated': datetime.now(timezone.utc).isoformat(), 'stationSnapshot': captured,
        'stations': len(current), 'rawNormalizedRows': raw_count, 'validJourneys': valid_count,
        'mappedJourneys': matched, 'unmappedJourneys': valid_count-matched,
        'coverage': round(matched / max(1,valid_count), 6), 'unmatchedStationNames': len(unmatched),
        'stats': stats, 'modularity': modularity, 'communityCount': max(assignment)+1,
        'hoursPerDay': hours, 'daily': [[str(d), n] for d,n in days],
        'resilience': resilience(all_edges, len(current)), 'sources': sources,
        'method': {'communities':'NetworkX Louvain; symmetrised summed weights; resolution 1; seed 42; self-loops excluded',
                   'filters':'Local London start time. AM 07:00–09:59; PM 16:00–18:59. Weekends Saturday/Sunday (bank holidays remain weekdays).',
                   'strength':'Arrivals + departures; a return to the same station contributes twice. Degree excludes self-loops.',
                   'resilience':'Static deletion of 10% of active stations; share of observed trips whose endpoints remain. Random: 100 seed-42 samples. No rerouting or causal forecast.'},
        'versions': {'networkx':nx.__version__, 'duckdb':duckdb.__version__, 'pandas':pd.__version__}}
    (out / 'stations.json').write_text(json.dumps(current, separators=(',', ':')))
    (out / 'meta.json').write_text(json.dumps(metadata, indent=2))
    pd.DataFrame(current).to_csv(out / 'stations.csv', index=False)
    pd.DataFrame(all_edges, columns=['source_index','target_index','journeys']).to_csv(out / 'flows.csv', index=False)
    con.close()
    print(json.dumps({k:v for k,v in metadata.items() if k in ('period','stations','validJourneys','mappedJourneys','coverage','communityCount','modularity')}, indent=2))
    return metadata


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--year', type=int, default=2026)
    p.add_argument('--month', type=int, default=5, choices=range(1,13))
    p.add_argument('--export-only', action='store_true', help='Reuse downloaded and prepared sources and station snapshot')
    a = p.parse_args()
    root = Path(__file__).resolve().parent.parent
    if not a.export_only:
        records = pick_sources(acquire.discover(), a.year, a.month)
        (root/'data').mkdir(exist_ok=True)
        (root/'data/manifest.json').write_text(json.dumps({'files':records}, indent=2))
        acquire.download_all(root, workers=2)
        acquire.station_snapshot(root)
        prepare.convert(root)
    export(root, a.year, a.month)

if __name__ == '__main__': main()
