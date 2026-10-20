"""Generate standalone HTML map from OD edges, showing straight OD links (not actual paths)."""
from pathlib import Path
import math
import pandas as pd
import folium


def render(root:Path, top=120, min_journeys=20):
    edges=pd.read_csv(root/'outputs'/'edges.csv')
    nodes=pd.read_csv(root/'outputs'/'nodes.csv')
    m=folium.Map(location=[51.514,-0.125],zoom_start=12,tiles='cartodbpositron',prefer_canvas=True)
    kept=edges.dropna(subset=['start_lat','start_lon','end_lat','end_lon'])
    kept=kept[(kept.journeys>=min_journeys)&(kept.source!=kept.target)].nlargest(top,'journeys')
    maxweight=max(1,int(kept.journeys.max())) if len(kept) else 1
    for _,e in kept.iterrows():
        folium.PolyLine([(e.start_lat,e.start_lon),(e.end_lat,e.end_lon)],
             weight=1+5*math.sqrt(e.journeys/maxweight),opacity=.45,color='#1565c0',
             tooltip=f'{e.start_station} → {e.end_station}: {e.journeys:,} trips').add_to(m)
    nodes=nodes.dropna(subset=['lat','lon'])
    maxvolume=max(1,int((nodes.arrivals+nodes.departures).max())) if len(nodes) else 1
    for _,n in nodes.iterrows():
        traffic=n.arrivals+n.departures
        folium.CircleMarker([n.lat,n.lon],radius=2+8*math.sqrt(traffic/maxvolume),
            color='#d97706',fill=True,fill_opacity=.65,weight=.6,
            tooltip=f'{n["name"]}: {traffic:,} trips',
            popup=f'<b>{n["name"]}</b><br>Departures: {n.departures:,}<br>Arrivals: {n.arrivals:,}<br>Net inflow: {n.net_inflow:+,}').add_to(m)
    target=root/'outputs'/'network_map.html';m.save(str(target));print('Map:',target)
