"""Dynamics on the network: Markov drift, real bike trajectories, hidden rebalancing, and a
cross-check against an independent dataset of dock occupancy.

1. A bike is a random walker on the journey graph (row-normalised P). Its stationary
   distribution says where bikes would pile up with nobody moving them; the spectral gap says
   how many rides it takes a bike to forget where it started.
2. The journey records carry bike ids. When a bike's next hire starts at a different dock from
   where its last one ended, someone moved it: a van, a workshop or a data gap. These
   "relocations" form a second, hidden network: the operator's rebalancing.
3. Hourly net flows from May journeys predict hourly bike-count changes measured by
   BikePoint snapshots in September 2026: different month, different source.
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats
from . import Net, r
from ..trips import ROOT


def markov(net: Net) -> dict:
    idx = np.flatnonzero(net.active)
    W = net.W[np.ix_(idx, idx)]
    P = W / W.sum(1, keepdims=True)
    vals, vecs = np.linalg.eig(P.T)
    order = np.argsort(-np.abs(vals))
    pi = np.real(vecs[:, order[0]])
    pi = pi / pi.sum()
    lam2 = float(np.abs(vals[order[1]]))
    mixing = 1 / np.log(1 / lam2)
    arrivals = W.sum(0) / W.sum()
    departures = W.sum(1) / W.sum()
    full_pi = np.zeros(net.n)
    full_pi[idx] = pi
    docks = net.stations['docks'].to_numpy()[idx].astype(float)
    pressure = np.zeros(net.n)
    pressure[idx] = pi / (docks / docks.sum())
    # Empirical forgetting: total variation between a walker started at the busiest dock and pi.
    start = np.zeros(len(idx))
    start[np.argmax(W.sum(1))] = 1
    tv = []
    v = start
    for step in range(13):
        tv.append(r(0.5 * np.abs(v - pi).sum()))
        v = v @ P
    return {'lambda2': r(lam2, 5), 'mixingRides': r(mixing, 2), 'tv': tv,
            'piVsArrivals': r(stats.pearsonr(pi, arrivals)[0], 4),
            'piVsDepartures': r(stats.pearsonr(pi, departures)[0], 4),
            'node': {'stationary': full_pi, 'pressure': pressure}}


def relocations(net: Net) -> dict:
    t = net.trips[['bike', 'a', 'b', 'start', 'end', 'hour', 'work', 'ebike']].sort_values(['bike', 'start'])
    same_bike = t['bike'].to_numpy()[1:] == t['bike'].to_numpy()[:-1]
    prev_end = t['b'].to_numpy()[:-1]
    next_start = t['a'].to_numpy()[1:]
    moved = same_bike & (prev_end != next_start)
    gaps_h = (t['start'].to_numpy()[1:] - t['end'].to_numpy()[:-1]) / np.timedelta64(1, 'h')
    src, dst = prev_end[moved].astype(int), next_start[moved].astype(int)
    km = net.D[src, dst]
    R = np.zeros((net.n, net.n))
    np.add.at(R, (src, dst), 1)
    handoffs = int(same_bike.sum())
    # Hour the bike was found missing from its last dock is unknown; use the hour it reappeared.
    reappear = t['start'].dt.hour.to_numpy()[1:][moved]
    rides_per_bike = t.groupby('bike').size()
    days_active = t.groupby('bike')['start'].agg(lambda s: s.dt.day.nunique())
    taken, given = R.sum(1), R.sum(0)
    trip_net = net.A.sum(0) - net.A.sum(1)   # arrivals - departures by riders
    van_net = given - taken                  # bikes delivered - bikes collected by the operator
    busy = (taken + given + np.abs(trip_net)) > 0
    corr = stats.spearmanr(trip_net[busy], van_net[busy])[0]
    i, j = np.nonzero(R)
    order = np.argsort(-R[i, j])[:400]
    top = [[int(i[k]), int(j[k]), int(R[i[k], j[k]]), r(net.D[i[k], j[k]], 3)] for k in order]
    return {
        'handoffs': handoffs, 'relocations': int(moved.sum()), 'share': r(moved.sum() / handoffs),
        'medianKm': r(np.median(km), 3), 'medianGapHours': r(np.median(gaps_h[moved]), 2),
        'byHour': np.bincount(reappear, minlength=24).tolist(),
        'kmHist': np.histogram(km, bins=np.arange(0, 12.5, 0.5))[0].tolist(),
        'riderVsOperator': r(corr, 4),
        'balanceRecovered': r(1 - np.abs(trip_net + van_net).sum() / np.abs(trip_net).sum(), 4),
        'ridesPerBikeDay': r((rides_per_bike / days_active).median(), 2),
        'bikes': int(len(rides_per_bike)),
        'edges': top, 'edgeFields': ['from', 'to', 'relocations', 'km'],
        'node': {'vanTaken': taken, 'vanGiven': given, 'tripNet': trip_net},
    }


def occupancy_profiles(root: Path, stations: pd.DataFrame):
    """Working-day mean bikes per local hour per station, each date weighted equally."""
    cache = root / 'data/derived/occupancy-work.parquet'
    if cache.exists():
        return pd.read_parquet(cache)
    from ..occupancy import normalize
    frames = [pd.read_csv(p, dtype={'place_id': str}) for p in sorted((root / 'data/occupancy').glob('2026-*.csv'))]
    data = normalize(pd.concat(frames, ignore_index=True))
    data = data[(data['local'].dt.month == 9) & (data['local'].dt.day_of_week < 5)]
    data['id'] = data['place_id'].str.replace('BikePoints_', '', regex=False)
    daily = data.groupby(['id', 'day', 'hour']).agg(bikes=('bikes', 'mean'), fill=('fill', 'mean'),
                                                     empty=('empty', 'mean'), full=('full', 'mean')).reset_index()
    prof = daily.groupby(['id', 'hour']).agg(bikes=('bikes', 'mean'), fill=('fill', 'mean'), empty=('empty', 'mean'),
                                             full=('full', 'mean'), days=('day', 'nunique')).reset_index()
    prof.to_parquet(cache, index=False)
    return prof


def validation(net: Net, hourly_net: np.ndarray, root: Path = ROOT) -> dict:
    prof = occupancy_profiles(root, net.stations)
    pos = {sid: i for i, sid in enumerate(net.stations['id'])}
    bikes = np.full((net.n, 24), np.nan)
    fill = np.full((net.n, 24), np.nan)
    empty = np.full(net.n, np.nan)
    full = np.full(net.n, np.nan)
    prof = prof[prof['days'] >= 10]
    for sid, grp in prof.groupby('id'):
        if sid not in pos:
            continue
        i = pos[sid]
        bikes[i, grp['hour'].to_numpy()] = grp['bikes'].to_numpy()
        fill[i, grp['hour'].to_numpy()] = grp['fill'].to_numpy()
        empty[i] = grp['empty'].mean()
        full[i] = grp['full'].mean()
    # Change in mean bikes from hour h to h+1 against riders' net arrivals during hour h.
    delta = bikes[:, 1:] - bikes[:, :-1]
    pred = hourly_net[:, :-1]
    ok = np.isfinite(delta) & net.active[:, None]
    pooled = stats.pearsonr(pred[ok], delta[ok])[0]
    per_station = []
    for i in range(net.n):
        m = ok[i]
        if m.sum() >= 18 and np.std(pred[i, m]) > 0 and np.std(delta[i, m]) > 0:
            per_station.append(stats.pearsonr(pred[i, m], delta[i, m])[0])
        else:
            per_station.append(np.nan)
    per_station = np.array(per_station)
    # Slope < 1: the observed change is damped (rebalancing, full or empty docks, different month).
    slope = stats.linregress(pred[ok], delta[ok]).slope
    swing = np.zeros(net.n)
    cum = np.cumsum(hourly_net, 1)
    swing = cum.max(1) - cum.min(1)
    docks = net.stations['docks'].to_numpy().astype(float)
    stress = np.where(docks > 0, swing / docks, 0)
    has = np.isfinite(empty)
    stress_vs_problem = stats.spearmanr(stress[has & net.active], (empty + full)[has & net.active])[0]
    bins = np.linspace(-6, 6, 25)
    centers, means = [], []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = ok & (pred >= lo) & (pred < hi)
        if m.sum() > 30:
            centers.append(r((lo + hi) / 2, 2))
            means.append([r(np.mean(delta[m]), 3), r(np.percentile(delta[m], 25), 3), r(np.percentile(delta[m], 75), 3), int(m.sum())])
    return {
        'pooledR': r(pooled, 4), 'slope': r(slope, 4), 'pairs': int(ok.sum()),
        'medianStationR': r(np.nanmedian(per_station), 4),
        'stationsTested': int(np.isfinite(per_station).sum()),
        'stressVsProblems': r(stress_vs_problem, 4),
        'binned': {'x': centers, 'y': means},
        'node': {'occBikes': bikes, 'occFill': fill, 'occEmpty': empty, 'occFull': full,
                 'occR': per_station, 'swing': swing, 'stress': stress},
    }


def study(net: Net, hourly_net: np.ndarray) -> dict:
    mk = markov(net)
    rl = relocations(net)
    vd = validation(net, hourly_net)
    node = {**mk.pop('node'), **rl.pop('node'), **vd.pop('node')}
    return {'markov': mk, 'relocation': rl, 'validation': vd, 'node': node}
