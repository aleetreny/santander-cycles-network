"""Robustness: station closures (node attacks) and the Granovetter weak-ties test (edge percolation).

Node removal is static: a closed station's journeys are lost, not rerouted, so the curves
measure how concentrated the observed demand is, not a forecast of behaviour.
Edge percolation follows Onnela et al. (PNAS 2007): if removing the weakest links first
shatters the graph sooner than removing the strongest, weak ties are the bridges.
"""
from __future__ import annotations
import numpy as np
from . import Net, SEED, r
from .backbone import backbone

FRACTIONS = np.round(np.arange(0, 0.505, 0.025), 3)


class DSU:
    def __init__(self, n):
        self.parent = np.arange(n)
        self.size = np.ones(n, int)

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a == b:
            return False
        if self.size[a] < self.size[b]:
            a, b = b, a
        self.parent[b] = a
        self.size[a] += self.size[b]
        return True


def giant(adj: np.ndarray, alive: np.ndarray) -> int:
    idx = np.flatnonzero(alive)
    if len(idx) == 0:
        return 0
    dsu = DSU(len(adj))
    i, j = np.nonzero(np.triu(adj[np.ix_(idx, idx)], 1))
    for a, b in zip(idx[i], idx[j]):
        dsu.union(a, b)
    roots = [dsu.find(x) for x in idx]
    return int(np.bincount(roots).max())


def attack(net: Net, order: np.ndarray, B: np.ndarray):
    act = np.flatnonzero(net.active)
    n = len(act)
    total = net.A.sum()
    trips, lcc = [], []
    for f in FRACTIONS:
        alive = net.active.copy()
        alive[order[:int(round(f * n))]] = False
        kept = net.A[np.ix_(alive, alive)].sum() / total
        trips.append(r(kept))
        lcc.append(r(giant(B, alive) / n))
    return trips, lcc


def edge_percolation(net: Net, points=60):
    S = net.S
    iu = np.triu_indices(net.n, 1)
    w = S[iu]
    present = w > 0
    a, b, w = iu[0][present], iu[1][present], w[present]
    # Topological overlap O_ij = n_ij / ((k_i - 1) + (k_j - 1) - n_ij), computed on the backbone.
    B = backbone(net)
    U = (B | B.T).astype(float)
    common = (U @ U)
    k = U.sum(1)
    with np.errstate(invalid='ignore', divide='ignore'):
        overlap_b = common / ((k[:, None] - 1) + (k[None, :] - 1) - common)
    bi, bj = np.nonzero(np.triu(U, 1))
    bw = S[bi, bj]
    # Overlap rises with weight: the Granovetter signature.
    ov = np.nan_to_num(overlap_b[bi, bj])
    qs = np.quantile(bw, np.linspace(0, 1, 11))
    overlap_curve = []
    for lo, hi in zip(qs[:-1], qs[1:]):
        m = (bw >= lo) & (bw <= hi)
        overlap_curve.append([r(np.median(bw[m]), 1), r(ov[m].mean(), 4)])
    curves = {}
    for name, order_edges in (('weakFirst', np.argsort(-bw, kind='stable')), ('strongFirst', np.argsort(bw, kind='stable'))):
        # Removing edges in one order is adding them back in the reverse order.
        dsu = DSU(net.n)
        nodes = int(net.active.sum())
        sizes = []
        m = len(order_edges)
        marks = set(np.round(np.linspace(0, m, points)).astype(int))
        added = 0
        largest = 1
        record = {}
        if 0 in marks:
            record[0] = 1 / nodes
        for e in order_edges:
            x, y = bi[e], bj[e]
            if dsu.union(x, y):
                largest = max(largest, dsu.size[dsu.find(x)])
            added += 1
            if added in marks:
                record[added] = largest / nodes
        for kept in sorted(record):
            sizes.append([r(1 - kept / m, 4), r(record[kept], 4)])
        curves[name] = sizes[::-1]
    return {'overlap': overlap_curve, 'curves': curves, 'edges': int(len(bw))}


def study(net: Net, node: dict) -> dict:
    rng = np.random.default_rng(SEED)
    # Connectivity is judged on the strict backbone (alpha = 0.001): the full graph is too dense to break.
    B = backbone(net, 0.001)
    U = B | B.T
    act = np.flatnonzero(net.active)
    lat, lon = net.stations['lat'].to_numpy(), net.stations['lon'].to_numpy()
    # Distance from the strength-weighted centre: closing London from the middle outwards.
    s = net.A.sum(0) + net.A.sum(1)
    centre = np.average(lat[act], weights=s[act]), np.average(lon[act], weights=s[act])
    dist_c = (lat - centre[0]) ** 2 + ((lon - centre[1]) * np.cos(np.radians(centre[0]))) ** 2
    strategies = {
        'strength': act[np.argsort(-s[act])],
        'betweenness': act[np.argsort(-node['betweenness'][act])],
        'participation': act[np.argsort(-node['participation'][act])],
        'centre': act[np.argsort(dist_c[act])],
    }
    out = {}
    for name, order in strategies.items():
        trips, lcc = attack(net, order, U)
        out[name] = {'trips': trips, 'giant': lcc}
    rand_t, rand_g = [], []
    for k in range(20):
        trips, lcc = attack(net, rng.permutation(act), U)
        rand_t.append(trips)
        rand_g.append(lcc)
    out['random'] = {'trips': [r(v) for v in np.mean(rand_t, 0)], 'giant': [r(v) for v in np.mean(rand_g, 0)],
                     'tripsLow': [r(v) for v in np.min(rand_t, 0)], 'tripsHigh': [r(v) for v in np.max(rand_t, 0)]}
    return {'fractions': FRACTIONS.tolist(), 'attacks': out, 'percolation': edge_percolation(net)}
