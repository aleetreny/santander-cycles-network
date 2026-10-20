"""Routes must retain actual directed journey counts and omit self loops."""
import json
from pathlib import Path


def test_typical_connections_match_complete_directed_journey_graph():
    root=Path(__file__).resolve().parent.parent/'site/data'
    summary=json.loads((root/'connections.json').read_text())
    stations=json.loads((root/'stations.json').read_text())
    edges=json.loads((root/'all-all.json').read_text())
    outgoing={i:[] for i in range(len(stations))};incoming={i:[] for i in range(len(stations))}
    for a,b,w in edges:
        if a!=b:
            outgoing[a].append((b,w));incoming[b].append((a,w))
    assert summary['start']=='2026-05-01' and summary['end']=='2026-05-31'
    for i,s in enumerate(stations):
        for direction,table in [('out',outgoing),('in',incoming)]:
            expected=[[stations[j]['id'],w] for j,w in sorted(table[i],key=lambda r:(-r[1],r[0]))[:5]]
            assert summary['stations'][s['id']][direction]==expected
