"""Topology and weights: global statistics, heavy tails, centrality, mixing, cores, rich club, motifs.

The binary graph is a third of a complete graph (density ~0.34), so binary measures
saturate. Each result here is paired with a weighted measure or a null model, because
in this network the information lives in the weights.
"""
from __future__ import annotations
import random
import igraph as ig
import numpy as np
from scipy import stats, special, optimize
from . import Net, SEED, ccdf, gini, lorenz, r
from .backbone import backbone


def to_igraph(M: np.ndarray, directed=True) -> ig.Graph:
    i, j = np.nonzero(np.triu(M, 1) if not directed else M)
    g = ig.Graph(n=len(M), edges=list(zip(i.tolist(), j.tolist())), directed=directed)
    g.es['weight'] = M[i, j].tolist()
    return g


def effective_distance(A: np.ndarray) -> np.ndarray:
    """Brockmann & Helbing (Science 2013): d_ij = 1 - ln P_ij, P the row-normalised flow."""
    out = A.sum(1, keepdims=True)
    with np.errstate(divide='ignore', invalid='ignore'):
        P = np.where(A > 0, A / out, 0)
        return np.where(P > 0, 1 - np.log(P), 0)


# ---------- heavy-tail fitting (continuous MLE, Clauset, Shalizi & Newman 2009) ----------

def fit_tail(x: np.ndarray) -> dict:
    x = np.sort(np.asarray(x, float)[np.asarray(x) > 0])
    best = None
    for xmin in np.unique(np.quantile(x, np.linspace(0, 0.9, 46))):
        tail = x[x >= xmin]
        if len(tail) < 50:
            continue
        alpha = 1 + len(tail) / np.log(tail / xmin).sum()
        cdf = 1 - (tail / xmin) ** (1 - alpha)
        ks = np.abs(cdf - np.arange(len(tail)) / len(tail)).max()
        if best is None or ks < best[0]:
            best = (ks, xmin, alpha)
    ks, xmin, alpha = best
    tail = x[x >= xmin]
    n = len(tail)
    ll_pl = np.log(alpha - 1) - np.log(xmin) - alpha * np.log(tail / xmin)
    lam = 1 / (tail.mean() - xmin)
    ll_exp = np.log(lam) - lam * (tail - xmin)
    # Lognormal truncated at xmin, by numerical MLE.

    def nll(params):
        mu, sigma = params[0], abs(params[1]) + 1e-9
        z = (np.log(tail) - mu) / sigma
        norm = 0.5 * special.erfc((np.log(xmin) - mu) / (sigma * np.sqrt(2)))
        return -(-np.log(tail * sigma * np.sqrt(2 * np.pi)) - z ** 2 / 2 - np.log(max(norm, 1e-300))).sum()
    res = optimize.minimize(nll, [np.log(tail).mean(), np.log(tail).std()], method='Nelder-Mead')
    mu, sigma = res.x[0], abs(res.x[1])
    z = (np.log(tail) - mu) / sigma
    norm = 0.5 * special.erfc((np.log(xmin) - mu) / (sigma * np.sqrt(2)))
    ll_ln = -np.log(tail * sigma * np.sqrt(2 * np.pi)) - z ** 2 / 2 - np.log(norm)

    def vuong(l1, l2):
        d = l1 - l2
        R = d.sum()
        p = special.erfc(abs(R) / np.sqrt(2 * n * d.var())) if d.var() > 0 else 1.0
        return {'R': r(R, 1), 'p': r(p, 6)}
    return {'xmin': r(xmin, 2), 'n': int(n), 'alpha': r(alpha, 3), 'ks': r(ks, 4), 'lambda': r(lam, 5),
            'mu': r(mu, 3), 'sigma': r(sigma, 3),
            'powerVsLognormal': vuong(ll_pl, ll_ln), 'powerVsExponential': vuong(ll_pl, ll_exp),
            'lognormalVsExponential': vuong(ll_ln, ll_exp)}


# ---------- weighted mixing and cores ----------

def weighted_assortativity(A, x_from, x_to):
    """Leung & Chau weighted Pearson correlation between an attribute at the two ends of each edge."""
    i, j = np.nonzero(A)
    w = A[i, j]
    a, b = x_from[i], x_to[j]
    ma, mb = np.average(a, weights=w), np.average(b, weights=w)
    cov = np.average((a - ma) * (b - mb), weights=w)
    return cov / np.sqrt(np.average((a - ma) ** 2, weights=w) * np.average((b - mb) ** 2, weights=w))


def s_core(S: np.ndarray) -> np.ndarray:
    """Strength-based core decomposition (Garas et al. 2012): peel the weakest node repeatedly."""
    n = len(S)
    alive = np.ones(n, bool)
    strength = S.sum(1).astype(float)
    core = np.zeros(n)
    level = 0.0
    while alive.any():
        idx = np.flatnonzero(alive)
        k = idx[np.argmin(strength[idx])]
        level = max(level, strength[k])
        core[k] = level
        alive[k] = False
        strength -= S[:, k]
    return core


def rich_club(S: np.ndarray, rng, samples=30) -> list:
    """Opsahl et al. (PRL 2008) weighted rich-club, normalised by weight reshuffling on the same topology."""
    strength = S.sum(1)
    order = np.argsort(-strength)
    iu = np.triu_indices(len(S), 1)
    weights = S[iu]
    present = weights > 0
    ranked = np.sort(weights[present])[::-1]
    nulls = [np.zeros_like(weights) for _ in range(samples)]
    for null in nulls:
        null[present] = rng.permutation(weights[present])
    out = []
    for size in (5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 500, 600):
        club = np.zeros(len(S), bool)
        club[order[:size]] = True
        inside = club[iu[0]] & club[iu[1]]
        e = int((inside & present).sum())
        if e == 0:
            continue
        phi = weights[inside].sum() / ranked[:e].sum()
        phi_null = np.mean([nl[inside].sum() / ranked[:e].sum() for nl in nulls])
        out.append({'club': size, 'edges': e, 'phi': r(phi), 'phiNull': r(phi_null), 'rho': r(phi / phi_null)})
    return out


TRIADS = ['003', '012', '102', '021D', '021U', '021C', '111D', '111U', '030T', '030C', '201', '120D', '120U', '120C', '210', '300']


def motif_profile(net: Net, rng, samples=40) -> dict:
    """Directed triad census of the significant backbone versus degree-preserving rewired copies (Milo et al. 2002)."""
    B = backbone(net, 0.01)
    keep = (B.sum(0) + B.sum(1)) > 0
    g = to_igraph(B[np.ix_(keep, keep)].astype(float), directed=True)
    real = np.array(list(g.triad_census()), float)
    nulls = []
    for k in range(samples):
        h = g.copy()
        ig.set_random_number_generator(random.Random(SEED + k))
        h.rewire(n=10 * h.ecount(), mode='simple')
        nulls.append(list(h.triad_census()))
    ig.set_random_number_generator(random.Random(SEED))
    nulls = np.array(nulls, float)
    mean, sd = nulls.mean(0), nulls.std(0)
    z = np.where(sd > 0, (real - mean) / np.where(sd > 0, sd, 1), 0)
    connected = TRIADS[3:]
    sel = [TRIADS.index(t) for t in connected]
    zc = z[sel]
    sp = zc / np.sqrt((zc ** 2).sum())
    return {'graph': {'nodes': g.vcount(), 'edges': g.ecount(), 'alpha': 0.01},
            'triads': [{'code': t, 'count': int(real[i]), 'nullMean': r(mean[i], 1), 'nullSd': r(sd[i], 2),
                        'z': r(z[i], 2), 'sp': r(s, 3)} for t, i, s in zip(connected, sel, sp)],
            'samples': samples}


def study(net: Net) -> dict:
    rng = np.random.default_rng(SEED)
    A, S, act = net.A, net.S, net.active
    n_act = int(act.sum())
    present = A > 0
    edges = int(present.sum())
    k_out, k_in = present.sum(1), present.sum(0)
    s_out, s_in = A.sum(1), A.sum(0)
    recip_bin = (present & present.T).sum() / edges
    recip_w = np.minimum(A, A.T).sum() / A.sum()
    # Weighted reciprocity (Squartini et al. PRE 2013) against Poisson networks with the same expected
    # out- and in-strengths: how much flow would come back by chance alone.
    W_total = A.sum()
    expected = np.outer(s_out, s_in) / W_total
    np.fill_diagonal(expected, 0)
    expected *= W_total / expected.sum()
    null_recip = []
    for _ in range(5):
        M = rng.poisson(expected).astype(float)
        null_recip.append(np.minimum(M, M.T).sum() / M.sum())
    gd = to_igraph(A, directed=True)
    gu = to_igraph(S, directed=False)
    sub_u = gu.induced_subgraph(np.flatnonzero(act).tolist())
    sub_d = gd.induced_subgraph(np.flatnonzero(act).tolist())
    clustering_bin = sub_u.transitivity_avglocal_undirected(mode='zero')
    barrat = np.array(sub_u.transitivity_local_undirected(weights='weight', mode='zero'))
    density_u = sub_u.ecount() / (n_act * (n_act - 1) / 2)

    # --- distributions ---
    strength = s_out + s_in
    weights = A[present]
    dist = {
        'strength': ccdf(strength[act]), 'degree': ccdf((k_out + k_in)[act]),
        'weight': ccdf(weights, 50),
        'fitStrength': fit_tail(strength[act]), 'fitWeight': fit_tail(weights[weights >= 1]),
        'giniStrength': r(gini(strength[act])), 'giniWeight': r(gini(weights)),
        'lorenzStrength': [r(v) for v in lorenz(strength[act])],
        'lorenzWeight': [r(v) for v in lorenz(weights)],
    }
    sorted_w = np.sort(weights)[::-1]
    cum = np.cumsum(sorted_w) / sorted_w.sum()
    dist['edgesForHalf'] = r(np.searchsorted(cum, 0.5) / len(sorted_w))
    dist['edgesSingleTrip'] = r((weights == 1).mean())
    # s(k) ~ k^beta : super-linear beta means busy stations also carry heavier links (Barrat et al. PNAS 2004).
    k_tot = (k_out + k_in)[act]
    beta, intercept, rv, *_ = stats.linregress(np.log(k_tot), np.log(strength[act]))
    dist['strengthDegree'] = {'beta': r(beta, 3), 'r2': r(rv ** 2, 3),
                              'points': [[int(a), int(b)] for a, b in zip(k_tot, strength[act])]}

    # --- centrality ---
    idx = np.flatnonzero(act)
    ge = to_igraph(effective_distance(A[np.ix_(idx, idx)]), directed=True)

    def full(values):
        out = np.zeros(net.n)
        out[idx] = np.nan_to_num(np.asarray(values, float))
        return out
    pr = full(sub_d.pagerank(weights='weight', damping=0.85))
    hubs = full(sub_d.hub_score(weights='weight'))
    auth = full(sub_d.authority_score(weights='weight'))
    eig = full(sub_u.eigenvector_centrality(weights='weight'))
    btw = full(ge.betweenness(weights='weight', directed=True)) / ((n_act - 1) * (n_act - 2))
    # Harmonic-style closeness on effective distance: how easily flow from anywhere reaches a station.
    clo = full(ge.closeness(weights='weight', mode='in'))
    measures = {'strength': strength, 'degree': k_out + k_in, 'pagerank': pr, 'hub': hubs,
                'authority': auth, 'eigenvector': eig, 'betweenness': btw, 'closeness': clo}
    names = list(measures)
    tau = [[r(stats.kendalltau(measures[a][act], measures[b][act])[0], 3) for b in names] for a in names]
    top = {m: [int(i) for i in np.argsort(-measures[m])[:10]] for m in names}

    # --- mixing ---
    assort = {
        'degreeOutIn': r(sub_d.assortativity_degree(directed=True), 4),
        'degreeUndirected': r(sub_u.assortativity_degree(directed=False), 4),
        'strengthOutIn': r(weighted_assortativity(A, s_out, s_in), 4),
        'strengthInOut': r(weighted_assortativity(A, s_in, s_out), 4),
        'strengthUndirected': r(weighted_assortativity(S, S.sum(1), S.sum(1)), 4),
    }
    # Weighted average nearest-neighbour strength as a function of strength.
    s_u = S.sum(1)
    knn = np.where(s_u > 0, (S @ s_u) / np.where(s_u > 0, s_u, 1), 0)
    bins = np.quantile(s_u[act], np.linspace(0, 1, 13))
    knn_curve = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = act & (s_u >= lo) & (s_u <= hi)
        knn_curve.append([r(np.median(s_u[m]), 1), r(knn[m].mean(), 1)])

    # --- clustering, cores, rich club ---
    cluster_curve = []
    s_act = s_u[act]
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (s_act >= lo) & (s_act <= hi)
        cluster_curve.append([r(np.median(s_act[m]), 1), r(barrat[m].mean(), 4)])
    coreness = np.zeros(net.n)
    coreness[act] = sub_u.coreness()
    score = s_core(S)
    B = backbone(net)
    gb = to_igraph(((B | B.T) * S).astype(float), directed=False).induced_subgraph(np.flatnonzero(act).tolist())
    backbone_clustering = gb.transitivity_avglocal_undirected(mode='zero')
    p_b = gb.ecount() / (n_act * (n_act - 1) / 2)
    paths = sub_u.distances()
    finite = np.array(paths)[np.triu_indices(n_act, 1)]
    bpaths = np.array(gb.distances())[np.triu_indices(n_act, 1)]
    bpaths = bpaths[np.isfinite(bpaths)]

    summary = {
        'nodes': net.n, 'activeNodes': n_act, 'edges': edges, 'undirectedEdges': sub_u.ecount(),
        'density': r(edges / (n_act * (n_act - 1)), 5), 'journeys': int(net.W.sum()),
        'graphJourneys': int(A.sum()), 'selfLoops': int(np.trace(net.W)),
        'selfLoopShare': r(np.trace(net.W) / net.W.sum()),
        'reciprocityBinary': r(recip_bin), 'reciprocityWeighted': r(recip_w),
        'reciprocityWeightedNull': r(np.mean(null_recip)),
        'reciprocityRho': r((recip_w - np.mean(null_recip)) / (1 - np.mean(null_recip))),
        'meanDegree': r((k_out + k_in)[act].mean() / 2, 2), 'meanStrength': r(strength[act].mean() / 2, 1),
        'weakComponents': len(sub_d.connected_components('weak')),
        'strongComponents': len(sub_d.connected_components('strong')),
        'largestStrong': max(len(c) for c in sub_d.connected_components('strong')),
        'meanPath': r(finite.mean(), 3), 'diameter': int(finite.max()),
        'clusteringBinary': r(clustering_bin), 'clusteringRandom': r(density_u),
        'clusteringWeighted': r(barrat.mean()),
        'backboneEdges': int(B.sum()), 'backboneUndirectedEdges': gb.ecount(),
        'backboneClustering': r(backbone_clustering), 'backboneClusteringRandom': r(p_b, 5),
        'backboneMeanPath': r(bpaths.mean(), 3), 'backboneDiameter': int(bpaths.max()),
        'backboneRandomPath': r(np.log(n_act) / np.log(2 * gb.ecount() / n_act), 3),
        'maxCoreness': int(coreness.max()),
    }
    node = {
        'kOut': k_out, 'kIn': k_in, 'sOut': s_out, 'sIn': s_in, 'loops': np.diag(net.W),
        'pagerank': pr, 'hub': hubs, 'authority': auth, 'eigenvector': eig,
        'betweenness': btw, 'closeness': clo, 'coreness': coreness, 'score': score,
    }
    node['clustering'] = np.zeros(net.n)
    node['clustering'][act] = barrat
    return {
        'summary': summary, 'distributions': dist,
        'centrality': {'names': names, 'kendall': tau, 'top': top},
        'mixing': {'assortativity': assort, 'knn': knn_curve, 'clustering': cluster_curve},
        'richClub': rich_club(S, rng), 'motifs': motif_profile(net, rng),
        'node': node,
    }
