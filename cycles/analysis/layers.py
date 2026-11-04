"""Multiplex view: the same stations, four layers (classic / electric bikes, working / free days).

Edge overlap follows Battiston, Nicosia & Latora (PRE 2014): sum of min weights over sum of
max weights, after normalising each layer to the same total so size differences don't count.
"""
from __future__ import annotations
import numpy as np
from sklearn.metrics import normalized_mutual_info_score as nmi
from . import Net, r
from .backbone import alphas
from .communities import best_leiden
from .structure import to_igraph
from .space import ipf, poisson_loglik
from scipy import optimize


def decay_beta(T, D):
    d = np.maximum(D, 0.05)
    np.fill_diagonal(d, 1e6)
    O, Dst = T.sum(1), T.sum(0)
    off = ~np.eye(len(T), dtype=bool)

    def fit(b):
        F = np.exp(-b * d)
        np.fill_diagonal(F, 0)
        return ipf(O, Dst, F, iterations=120)
    res = optimize.minimize_scalar(lambda b: -poisson_loglik(T[off], fit(b)[off]), bounds=(0.05, 3),
                                   method='bounded', options={'xatol': 1e-3})
    return res.x


def study(net: Net, community: np.ndarray) -> dict:
    t = net.trips
    idx = np.flatnonzero(net.active)
    from .temporal import day_counts
    n_work, n_free = day_counts(net)
    defs = {
        'classic': (~t['ebike'], 31), 'electric': (t['ebike'], 31),
        'work': (t['work'], n_work), 'free': (~t['work'], n_free),
    }
    mats, out = {}, {}
    for name, (mask, days) in defs.items():
        M = net.matrix(mask)
        np.fill_diagonal(M, 0)
        M = M[np.ix_(idx, idx)]
        mats[name] = M
        g = to_igraph(M + M.T, directed=False)
        part, q, _, stab = best_leiden(g, 1.0, seeds=8)
        a = alphas(M)
        sub = t[mask & (t['a'] != t['b'])]
        out[name] = {
            'trips': int(mask.sum()), 'perDay': r(mask.sum() / days, 1), 'edges': int((M > 0).sum()),
            'density': r((M > 0).sum() / (len(idx) * (len(idx) - 1)), 4),
            'medianKm': r(sub['km'].median(), 3), 'medianMinutes': r(sub['minutes'].median(), 2),
            'reciprocity': r(np.minimum(M, M.T).sum() / M.sum()),
            'beta': r(decay_beta(M, net.D[np.ix_(idx, idx)]), 4),
            'communities': int(len(np.unique(part))), 'modularity': r(q),
            'nmiGlobal': r(nmi(part, community[idx])),
            'backboneEdges': int(((a < 0.05) & (M > 0)).sum()),
        }
        mats[name + ':bb'] = (a < 0.05) & (M > 0)

    def overlap(x, y):
        X, Y = mats[x] / mats[x].sum(), mats[y] / mats[y].sum()
        return np.minimum(X, Y).sum() / np.maximum(X, Y).sum()

    def corr(x, y):
        # On links present in both layers; over the union, presence alone dominates the correlation.
        m = (mats[x] > 0) & (mats[y] > 0)
        return np.corrcoef(np.log(mats[x][m]), np.log(mats[y][m]))[0, 1]

    def node_corr(x, y):
        a, b = mats[x].sum(0) + mats[x].sum(1), mats[y].sum(0) + mats[y].sum(1)
        return np.corrcoef(a, b)[0, 1]

    def jaccard(x, y):
        a, b = mats[x + ':bb'], mats[y + ':bb']
        return (a & b).sum() / (a | b).sum()
    pairs = {f'{x}-{y}': {'overlap': r(overlap(x, y)), 'sharedLinks': int(((mats[x] > 0) & (mats[y] > 0)).sum()),
                         'logCorr': r(corr(x, y)), 'strengthCorr': r(node_corr(x, y)), 'backboneJaccard': r(jaccard(x, y))}
             for x, y in (('classic', 'electric'), ('work', 'free'))}
    # E-bike share of trips as a function of straight-line distance.
    nl = t[t['a'] != t['b']]
    bins = np.arange(0, 10.5, 0.5)
    share = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (nl['km'] >= lo) & (nl['km'] < hi)
        if m.sum() > 200:
            share.append([r((lo + hi) / 2, 2), r(nl.loc[m, 'ebike'].mean(), 4), int(m.sum())])
    ebike_share = np.zeros(net.n)
    dep = t.groupby('a')['ebike'].mean()
    ebike_share[dep.index.to_numpy()] = dep.to_numpy()
    free_share = np.zeros(net.n)
    act = (t.groupby('a').size() + t.groupby('b').size()).reindex(range(net.n)).fillna(0)
    free = (t[~t['work']].groupby('a').size() + t[~t['work']].groupby('b').size()).reindex(range(net.n)).fillna(0)
    work = (t[t['work']].groupby('a').size() + t[t['work']].groupby('b').size()).reindex(range(net.n)).fillna(0)
    # Leisure index: free-day activity per day relative to working-day activity per day.
    with np.errstate(invalid='ignore', divide='ignore'):
        free_share = np.where(work > 0, (free / n_free) / (work / n_work), 0)
    return {'layers': out, 'pairs': pairs, 'ebikeByKm': share,
            'node': {'ebikeShare': ebike_share, 'leisure': np.asarray(free_share, float)}}
