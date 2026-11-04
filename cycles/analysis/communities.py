"""Mesoscale structure: Leiden across resolutions, consensus, Infomap, null models and node roles.

Modularity communities (Leiden, Traag et al. 2019) answer "which stations exchange more trips
than expected"; Infomap (Rosvall & Bergstrom 2008) answers "where does a random cyclist stay
trapped", using direction. Agreement between two different principles is evidence the
regions are real, and a weighted null model tells how much modularity a structureless network
with the same station strengths would already show.
"""
from __future__ import annotations
import random
import igraph as ig
import infomap
import leidenalg as la
import numpy as np
from scipy.optimize import linear_sum_assignment
from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score as nmi
from . import Net, SEED, r
from .structure import to_igraph

RESOLUTIONS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]
SEEDS = 24


def leiden(g, gamma, seed):
    part = la.find_partition(g, la.RBConfigurationVertexPartition, weights='weight',
                             resolution_parameter=gamma, seed=seed, n_iterations=-1)
    return np.array(part.membership), g.modularity(part.membership, weights='weight')


def best_leiden(g, gamma, seeds=SEEDS):
    runs = [leiden(g, gamma, SEED + k) for k in range(seeds)]
    best = max(runs, key=lambda x: x[1])
    stability = np.mean([nmi(runs[a][0], runs[b][0]) for a in range(seeds) for b in range(a + 1, seeds)])
    return best[0], best[1], runs, stability


def relabel(part, ref):
    """Match labels to a reference partition by maximum overlap so colours stay stable."""
    labels = np.unique(part)
    ref_labels = np.unique(ref)
    overlap = np.array([[np.sum((part == a) & (ref == b)) for b in ref_labels] for a in labels])
    rows, cols = linear_sum_assignment(-overlap)
    mapping = {labels[i]: ref_labels[j] for i, j in zip(rows, cols)}
    nxt = ref_labels.max() + 1
    for a in labels[np.argsort(-np.bincount(part)[labels])]:
        if a not in mapping:
            mapping[a] = nxt
            nxt += 1
    return np.array([mapping[x] for x in part])


def order_by_size(part):
    sizes = np.bincount(part)
    rank = {old: new for new, old in enumerate(np.argsort(-sizes))}
    return np.array([rank[x] for x in part])


def roles(S, part):
    """Guimerà & Amaral (Nature 2005) cartography with strengths instead of degrees."""
    k = S.sum(1)
    modules = np.unique(part)
    kappa = np.stack([S[:, part == m].sum(1) for m in modules], 1)
    own = kappa[np.arange(len(part)), np.searchsorted(modules, part)]
    z = np.zeros(len(part))
    for m in modules:
        sel = part == m
        sd = own[sel].std()
        z[sel] = (own[sel] - own[sel].mean()) / (sd if sd > 0 else 1)
    with np.errstate(invalid='ignore', divide='ignore'):
        P = np.where(k > 0, 1 - ((kappa / np.maximum(k, 1e-12)[:, None]) ** 2).sum(1), 0)
    role = np.where(z < 2.5,
                    np.select([P <= 0.05, P <= 0.62, P <= 0.8], [1, 2, 3], 4),
                    np.select([P <= 0.3, P <= 0.75], [5, 6], 7))
    return z, P, role


def null_modularity(S, samples=12):
    """Leiden modularity of Poisson networks with the same expected strengths (weighted Chung-Lu)."""
    rng = np.random.default_rng(SEED)
    s = S.sum(1)
    total = s.sum()
    expected = np.outer(s, s) / total
    iu = np.triu_indices(len(S), 1)
    out = []
    for _ in range(samples):
        M = np.zeros_like(S)
        M[iu] = rng.poisson(expected[iu])
        M = M + M.T
        g = to_igraph(M, directed=False)
        out.append(max(leiden(g, 1.0, SEED + k)[1] for k in range(3)))
    return np.array(out)


def run_infomap(A, idx):
    im = infomap.Infomap(directed=True, two_level=True, seed=SEED, num_trials=16, silent=True)
    sub = A[np.ix_(idx, idx)]
    for i, j in zip(*np.nonzero(sub)):
        im.add_link(int(i), int(j), float(sub[i, j]))
    im.run()
    modules = im.get_modules()
    part = np.array([modules[i] for i in range(len(idx))])
    return part, im.codelength, im.one_level_codelength


def study(net: Net) -> dict:
    ig.set_random_number_generator(random.Random(SEED))
    idx = np.flatnonzero(net.active)
    S = net.S[np.ix_(idx, idx)]
    g = to_igraph(S, directed=False)
    st = net.stations.iloc[idx].reset_index(drop=True)
    strength = S.sum(1)

    ref, q_ref, runs_ref, stab_ref = best_leiden(g, 1.0)
    ref = order_by_size(ref)
    sweep, partitions = [], {}
    for gamma in RESOLUTIONS:
        if gamma == 1.0:
            part, q, stability = ref, q_ref, stab_ref
        else:
            part, q, _, stability = best_leiden(g, gamma)
            part = relabel(part, ref)
        partitions[gamma] = part
        sweep.append({'gamma': gamma, 'communities': int(len(np.unique(part))), 'modularity': r(q),
                      'stability': r(stability), 'nmiToReference': r(nmi(part, ref))})

    # Consensus: how often each station lands with the community of its reference label (24 seeds).
    co = np.zeros(len(idx))
    for memb, _ in runs_ref:
        memb = relabel(memb, ref)
        co += memb == ref
    confidence = co / len(runs_ref)

    nulls = null_modularity(S)
    z_mod = (q_ref - nulls.mean()) / nulls.std()

    info, codelength, one_level = run_infomap(net.A, idx)
    info = relabel(order_by_size(info), ref)

    # Community portraits at the reference resolution.
    k = len(np.unique(ref))
    mixing = np.zeros((k, k))
    Ai = net.A[np.ix_(idx, idx)]
    for a in range(k):
        for b in range(k):
            mixing[a, b] = Ai[np.ix_(ref == a, ref == b)].sum()
    lat, lon = st['lat'].to_numpy(), st['lon'].to_numpy()
    groups = []
    for c in range(k):
        sel = ref == c
        areas = st.loc[sel, 'area']
        weight = {}
        for a, w in zip(areas, strength[sel]):
            weight[a] = weight.get(a, 0) + w
        name = max(weight, key=weight.get)
        within = Ai[np.ix_(sel, sel)]
        dd = net.D[np.ix_(idx[sel], idx[sel])]
        groups.append({
            'id': c, 'name': name, 'stations': int(sel.sum()),
            'trips': int(strength[sel].sum() / 2),
            'internalShare': r(within.sum() / Ai[sel].sum()),
            'meanInternalKm': r((within * dd).sum() / within.sum(), 3),
            'centre': [r(lat[sel].mean(), 5), r(lon[sel].mean(), 5)],
            'leader': int(idx[sel][np.argmax(strength[sel])]),
        })
    z, P, role = roles(S, ref)
    role_counts = {int(x): int((role == x).sum()) for x in range(1, 8)}

    def full(values, fill=-1):
        out = np.full(net.n, fill, dtype=float)
        out[idx] = values
        return out
    return {
        'sweep': sweep, 'reference': 1.0, 'modularity': r(q_ref), 'stability': r(stab_ref),
        'nullModularity': {'mean': r(nulls.mean()), 'sd': r(nulls.std(), 5), 'samples': len(nulls), 'z': r(z_mod, 1)},
        'infomap': {'modules': int(len(np.unique(info))), 'codelength': r(codelength), 'oneLevel': r(one_level),
                    'compression': r(1 - codelength / one_level),
                    'nmiLeiden': r(nmi(info, ref)), 'ariLeiden': r(adjusted_rand_score(info, ref))},
        'groups': groups, 'mixing': mixing.astype(int).tolist(), 'roles': role_counts,
        'partitions': {str(gm): full(p).astype(int).tolist() for gm, p in partitions.items()},
        'node': {'community': full(ref), 'infomap': full(info), 'confidence': full(confidence, 0),
                 'withinZ': full(z, 0), 'participation': full(P, 0), 'role': full(role, 0)},
    }
