"""Temporal network: the month as 48 hourly layers, regimes, commute symmetry, station archetypes.

Flows are always expressed per day of the relevant type (19 working days, 12 weekend or
bank-holiday days), never as raw totals of unequal day counts.
"""
from __future__ import annotations
import igraph as ig
import numpy as np
from scipy.cluster.hierarchy import linkage, leaves_list
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from . import Net, SEED, r
from .structure import to_igraph

BIN_MIN = 30
BINS = 24 * 60 // BIN_MIN


def day_counts(net: Net):
    days = net.trips.groupby('day')['work'].first()
    return int(days.sum()), int((~days).sum())


def layers(net: Net):
    """Per-day OD matrices for each hour, separately for working and non-working days."""
    if 'layers' in net.cache:
        return net.cache['layers']
    t = net.trips
    n_work, n_free = day_counts(net)
    pairs = np.flatnonzero(net.W.ravel() > 0)
    lookup = np.full(net.n * net.n, -1)
    lookup[pairs] = np.arange(len(pairs))
    code = lookup[t['a'].to_numpy().astype(int) * net.n + t['b'].to_numpy().astype(int)]
    X = np.zeros((48, len(pairs)), np.float32)
    layer = t['hour'].to_numpy().astype(int) + 24 * (~t['work'].to_numpy()).astype(int)
    np.add.at(X, (layer, code), 1)
    X[:24] /= n_work
    X[24:] /= n_free
    net.cache['layers'] = (X, pairs)
    return X, pairs


def regimes(net: Net):
    X, pairs = layers(net)
    norm = X / np.linalg.norm(X, axis=1, keepdims=True)
    sim = norm @ norm.T
    dist = 1 - sim[np.triu_indices(48, 1)]
    order = leaves_list(linkage(dist, method='average'))
    # Five regimes read cleanly (night, dawn, morning commute, day, late evening).
    labels = KMeans(5, n_init=30, random_state=SEED).fit(norm).labels_
    return sim, order, labels


def archetypes(net: Net, k_range=range(4, 9)):
    """K-means on each station's normalised 24 h departure and arrival rhythm (working + free days)."""
    t = net.trips
    n_work, n_free = day_counts(net)
    feats = np.zeros((net.n, 96))
    for col, off in (('a', 0), ('b', 24)):
        for work, base, days in ((True, 0, n_work), (False, 48, n_free)):
            sub = t[t['work'] == work]
            np.add.at(feats, (sub[col].to_numpy().astype(int), base + off + sub['hour'].to_numpy().astype(int)), 1 / days)
    total = feats.sum(1)
    busy = total > 0
    shape = feats[busy] / total[busy, None]
    # Standardise each feature so quiet night hours count as much as the peaks.
    z = (shape - shape.mean(0)) / (shape.std(0) + 1e-12)
    scores = {}
    for k in k_range:
        km = KMeans(k, n_init=20, random_state=SEED).fit(z)
        scores[k] = silhouette_score(z, km.labels_)
    k_best = 6  # interpretable choice; silhouette for each k is reported alongside
    km = KMeans(k_best, n_init=50, random_state=SEED).fit(z)
    labels = np.full(net.n, -1)
    labels[busy] = km.labels_
    profiles = []
    for c in range(k_best):
        sel = labels == c
        mean = feats[sel].mean(0)
        dep_w, arr_w = mean[0:24], mean[24:48]
        dep_f, arr_f = mean[48:72], mean[72:96]
        am = (arr_w[7:10].sum() - dep_w[7:10].sum()) / max(dep_w.sum() + arr_w.sum(), 1e-9)
        pm = (arr_w[16:19].sum() - dep_w[16:19].sum()) / max(dep_w.sum() + arr_w.sum(), 1e-9)
        weekend = (dep_f.sum() + arr_f.sum()) / max(dep_w.sum() + arr_w.sum(), 1e-9)
        profiles.append({'id': c, 'stations': int(sel.sum()),
                         'amNet': r(am), 'pmNet': r(pm), 'freeToWork': r(weekend),
                         'dailyTrips': r((dep_w.sum() + arr_w.sum()) / 2, 1),
                         'work': {'dep': [r(v, 3) for v in dep_w], 'arr': [r(v, 3) for v in arr_w]},
                         'free': {'dep': [r(v, 3) for v in dep_f], 'arr': [r(v, 3) for v in arr_f]}})
    return labels, profiles, {k: r(v) for k, v in scores.items()}, feats


def burstiness(net: Net):
    """Goh & Barabási (2008) B = (sigma - mu) / (sigma + mu) of inter-departure times at each dock."""
    t = net.trips
    secs = (t['start'] - t['start'].min()).dt.total_seconds().to_numpy()
    out = np.zeros(net.n)
    a = t['a'].to_numpy()
    for i in range(net.n):
        s = np.sort(secs[a == i])
        if len(s) < 30:
            continue
        gaps = np.diff(s)
        mu, sd = gaps.mean(), gaps.std()
        out[i] = (sd - mu) / (sd + mu)
    return out


def pulse(net: Net, edges_per_bin=260):
    """Half-hour frames of a typical working and free day: station flows and the busiest links."""
    t = net.trips
    n_work, n_free = day_counts(net)
    frames = {}
    for key, work, days in (('work', True, n_work), ('free', False, n_free)):
        sub = t[(t['work'] == work) & (t['a'] != t['b'])]
        b = (sub['minute'].to_numpy() // BIN_MIN).astype(int)
        dep = np.zeros((BINS, net.n))
        arr = np.zeros((BINS, net.n))
        np.add.at(dep, (b, sub['a'].to_numpy().astype(int)), 1 / days)
        # Arrivals are binned by arrival time so a frame shows where bikes land then.
        end_min = (sub['end'].dt.hour * 60 + sub['end'].dt.minute).to_numpy()
        np.add.at(arr, ((end_min // BIN_MIN).astype(int) % BINS, sub['b'].to_numpy().astype(int)), 1 / days)
        links = []
        codes = sub['a'].to_numpy().astype(int) * net.n + sub['b'].to_numpy().astype(int)
        for k in range(BINS):
            c = codes[b == k]
            if len(c) == 0:
                links.append([])
                continue
            u, cnt = np.unique(c, return_counts=True)
            top = np.argsort(-cnt)[:edges_per_bin]
            links.append([[int(u[x] // net.n), int(u[x] % net.n), r(cnt[x] / days, 2)] for x in top])
        frames[key] = {'days': days, 'departures': np.round(dep, 2).tolist(), 'arrivals': np.round(arr, 2).tolist(),
                       'links': links, 'total': [r(v, 1) for v in dep.sum(1)]}
    return frames


def study(net: Net) -> dict:
    t = net.trips
    n_work, n_free = day_counts(net)
    hourly = {}
    for key, work, days in (('work', True, n_work), ('free', False, n_free)):
        sub = t[t['work'] == work]
        counts = np.bincount(sub['hour'], minlength=24) / days
        ebike = np.bincount(sub.loc[sub['ebike'], 'hour'], minlength=24) / days
        km = sub.groupby('hour')['km'].median().reindex(range(24)).fillna(0)
        hourly[key] = {'trips': [r(v, 1) for v in counts], 'ebike': [r(v, 1) for v in ebike],
                       'medianKm': [r(v, 3) for v in km]}
    week = np.zeros((7, 24))
    dows = t.groupby('day')['dow'].first()
    for d in range(7):
        sub = t[t['dow'] == d]
        week[d] = np.bincount(sub['hour'], minlength=24) / max((dows == d).sum(), 1)
    daily = t.groupby('day').agg(trips=('a', 'size'), work=('work', 'first'), dow=('dow', 'first'))

    sim, order, labels = regimes(net)

    # Commute symmetry: does the evening reverse the morning?  Pair-level correlations are dominated
    # by sparse one-off pairs, so the evidence is (a) station net balances, (b) weighted overlap of the
    # morning layer with the reversed evening layer, (c) what happens to the busiest morning links.
    work = t[t['work'] & (t['a'] != t['b'])]
    am = net.matrix(t['work'] & t['hour'].between(7, 9))
    pm = net.matrix(t['work'] & t['hour'].between(16, 18))
    np.fill_diagonal(am, 0)
    np.fill_diagonal(pm, 0)
    net_am, net_pm = am.sum(0) - am.sum(1), pm.sum(0) - pm.sum(1)
    A_, P_ = am / am.sum(), pm / pm.sum()
    top = np.argsort(-am.ravel(), kind='stable')[:300]
    ti, tj = np.unravel_index(top, am.shape)
    commute = {
        'stationR': r(np.corrcoef(net_am, net_pm)[0, 1]),
        'overlapReverse': r(np.minimum(A_, P_.T).sum()), 'overlapSame': r(np.minimum(A_, P_).sum()),
        'topMedianAm': r(np.median(am[ti, tj]), 1), 'topMedianBack': r(np.median(pm[tj, ti]), 1),
        'topMedianSame': r(np.median(pm[ti, tj]), 1),
        'top': [[int(a), int(b), int(am[a, b]), int(pm[b, a]), int(pm[a, b])] for a, b in zip(ti, tj)],
        'days': n_work,
    }

    # Moving centre of gravity of departures, hour by hour.
    lat, lon = net.stations['lat'].to_numpy(), net.stations['lon'].to_numpy()
    centroid = {}
    for key, wk in (('work', True), ('free', False)):
        pts = []
        for h in range(24):
            sub = work if wk else t[~t['work'] & (t['a'] != t['b'])]
            sub = sub[sub['hour'] == h]
            a = sub['a'].to_numpy().astype(int)
            b = sub['b'].to_numpy().astype(int)
            pts.append([r(lat[a].mean(), 5), r(lon[a].mean(), 5), r(lat[b].mean(), 5), r(lon[b].mean(), 5)])
        centroid[key] = pts

    # Hourly PageRank leader: which station is the network's centre at each hour of a working day.
    X, pairs = layers(net)
    leaders = []
    for h in range(24):
        M = np.zeros(net.n * net.n)
        M[pairs] = X[h]
        M = M.reshape(net.n, net.n)
        np.fill_diagonal(M, 0)
        g = to_igraph(M, directed=True)
        pr = np.array(g.pagerank(weights='weight'))
        top = np.argsort(-pr)[:3]
        leaders.append([[int(i), r(pr[i], 5)] for i in top])

    labels_a, profiles, silhouettes, feats = archetypes(net)
    burst = burstiness(net)
    n_net = np.zeros((net.n, 24))
    sub = t[t['work']]
    np.add.at(n_net, (sub['b'].to_numpy().astype(int), sub['hour'].to_numpy().astype(int)), 1 / n_work)
    np.add.at(n_net, (sub['a'].to_numpy().astype(int), sub['hour'].to_numpy().astype(int)), -1 / n_work)
    return {
        'days': {'work': n_work, 'free': n_free},
        'hourly': hourly, 'week': np.round(week, 1).tolist(),
        'daily': [[int(d), int(row.trips), bool(row.work), int(row.dow)] for d, row in daily.iterrows()],
        'similarity': {'matrix': np.round(sim, 3).tolist(), 'order': order.tolist(), 'regime': labels.tolist()},
        'commute': commute,
        'centroid': centroid, 'leaders': leaders,
        'archetypes': {'profiles': profiles, 'silhouette': silhouettes},
        'pulse': pulse(net),
        'node': {'archetype': labels_a, 'burstiness': burst, 'hourlyNet': n_net,
                 'rhythm': feats},
    }
