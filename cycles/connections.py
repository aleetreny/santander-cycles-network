"""Export five typical routes per station from the pinned journey study.

python -m cycles.connections
No download, no change to the saved journey or occupancy data.
"""
import json
from pathlib import Path


def build(root):
    data = root / 'site/data'
    stations = json.loads((data / 'stations.json').read_text())
    meta = json.loads((data / 'meta.json').read_text())
    records = {}
    for station in stations:
        segment = json.loads((data / 'detail' / (station['id'] + '.json')).read_text())['segments']['all-all-all']
        record = {k: station[k] for k in ('name', 'lat', 'lon')}
        for direction in ('out', 'in'):
            record[direction] = [[stations[i]['id'], trips] for i, trips, _ in segment[direction]
                                 if stations[i]['id'] != station['id']][:5]
        records[station['id']] = record
    result = {'start': f"{meta['year']}-{meta['month']:02}-01",
              'end': f"{meta['year']}-{meta['month']:02}-{meta['days']:02}",
              'sources': meta['sources'], 'stations': records,
              'method': 'Top five directed non-return routes by recorded journeys, all days and bike types. Straight lines connect docks, not street routes. Pinned station matching from the journey study.'}
    target = data / 'connections.json'
    target.write_text(json.dumps(result, separators=(',', ':')))
    print(f'{len(records)} station route summaries; {target.stat().st_size:,} bytes')
    return result


if __name__ == '__main__':
    build(Path(__file__).resolve().parent.parent)
