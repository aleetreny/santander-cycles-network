"""Light basemap for the site: the Thames and the large parks, projected like the stations.

Source: OpenStreetMap via Overpass (© OpenStreetMap contributors, ODbL), saved under data/osm/.
Coordinates are km east/north of the mean station position, the same frame as the layouts.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd


def simplify(points: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker."""
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    ab = b - a
    norm = np.hypot(*ab)
    if norm == 0:
        d = np.hypot(*(points - a).T)
    else:
        d = np.abs(ab[0] * (points[:, 1] - a[1]) - ab[1] * (points[:, 0] - a[0])) / norm
    k = int(np.argmax(d))
    if d[k] > tol:
        left = simplify(points[:k + 1], tol)
        right = simplify(points[k:], tol)
        return np.vstack([left[:-1], right])
    return np.vstack([a, b])


def stitch(segments):
    """Join way segments that share endpoints into rings (multipolygon outer members)."""
    segs = [list(map(tuple, s)) for s in segments if len(s) > 1]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for k, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(k)
                changed = True
                break
        rings.append(ring)
    return rings


def river_lines(root: Path, stations: pd.DataFrame):
    """Thames centre-line segments in the station km frame."""
    lat0, lon0 = stations['lat'].mean(), stations['lon'].mean()
    c = np.cos(np.radians(lat0))
    lines = []
    for e in json.loads((root / 'data/osm/london.json').read_text())['elements']:
        if e['type'] == 'way' and e.get('tags', {}).get('waterway') == 'river':
            pts = np.array([[g['lon'], g['lat']] for g in e['geometry']])
            lines.append(np.column_stack([(pts[:, 0] - lon0) * c * 111.32, (pts[:, 1] - lat0) * 110.57]))
    return lines


def river_crossings(root: Path, stations: pd.DataFrame) -> np.ndarray:
    """True where the straight line between two docks crosses the Thames an odd number of times."""
    lat0, lon0 = stations['lat'].mean(), stations['lon'].mean()
    c = np.cos(np.radians(lat0))
    P = np.column_stack([(stations['lon'] - lon0) * c * 111.32, (stations['lat'] - lat0) * 110.57])
    n = len(P)
    iu = np.triu_indices(n, 1)
    a, b = P[iu[0]], P[iu[1]]

    def ccw(x, y, z):
        return (z[..., 1] - x[..., 1]) * (y[..., 0] - x[..., 0]) > (y[..., 1] - x[..., 1]) * (z[..., 0] - x[..., 0])
    count = np.zeros(len(a), int)
    for line in river_lines(root, stations):
        for p, q in zip(line[:-1], line[1:]):
            count += (ccw(a, p, q) != ccw(b, p, q)) & (ccw(a, b, p) != ccw(a, b, q))
    out = np.zeros((n, n), bool)
    out[iu] = count % 2 == 1
    return out | out.T


def build(root: Path, out_dir: Path):
    stations = pd.read_parquet(root / 'data/derived/stations.parquet')
    lat0, lon0 = stations['lat'].mean(), stations['lon'].mean()
    c = np.cos(np.radians(lat0))

    def proj(coords):
        arr = np.array([[p[1], p[0]] for p in coords], float)   # (lon, lat)
        return np.column_stack([(arr[:, 0] - lon0) * c * 111.32, (arr[:, 1] - lat0) * 110.57])

    def pack(xy, tol=0.015):
        return np.round(simplify(xy, tol), 3).tolist()
    river, water, parks = [], [], []
    files = [root / 'data/osm/london.json', root / 'data/osm/parks2.json']
    for f in files:
        if not f.exists():
            continue
        for e in json.loads(f.read_text())['elements']:
            tags = e.get('tags', {})
            if e['type'] == 'way':
                pts = [(g['lat'], g['lon']) for g in e.get('geometry', [])]
                if len(pts) < 2:
                    continue
                xy = proj(pts)
                if tags.get('waterway') == 'river':
                    river.append(pack(xy, 0.01))
                elif tags.get('natural') == 'water':
                    water.append(pack(xy, 0.01))
                elif tags.get('leisure') == 'park':
                    parks.append({'name': tags.get('name'), 'rings': [pack(xy)]})
            elif e['type'] == 'relation' and tags.get('leisure') == 'park':
                outer = [[(g['lat'], g['lon']) for g in m.get('geometry', [])] for m in e.get('members', []) if m.get('role') == 'outer']
                rings = [pack(proj(ring)) for ring in stitch(outer) if len(ring) > 3]
                if rings:
                    parks.append({'name': tags.get('name'), 'rings': rings})
    text = json.dumps({'river': river, 'water': water, 'parks': parks,
                       'attribution': '© OpenStreetMap contributors (ODbL)'}, separators=(',', ':'))
    (out_dir / 'geo.json').write_text(text)
    print(f'  wrote geo.json: {len(text) / 1024:.0f} KB')
