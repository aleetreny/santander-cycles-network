"""Spatial network: distance decay, gravity and radiation models, and corridors that beat geography.

Doubly-constrained gravity (Wilson 1967): T_ij = a_i O_i b_j D_j f(d_ij), balancing factors from
iterative proportional fitting so every station keeps its real departures and arrivals. Only the
deterrence f is free, so the comparison isolates how distance shapes the network.
Radiation (Simini et al. Nature 2012): parameter-free, opportunities = departures within d_ij.
Goodness of fit: common part of commuters, CPC = 2 sum min(T, T') / (sum T + sum T').
"""
from __future__ import annotations
import numpy as np
from scipy import optimize
from . import Net, r
from ..geo import river_crossings
from ..trips import ROOT


def ipf(O, Dst, F, iterations=200, tol=1e-9):
    a = np.ones(len(O))
    b = np.ones(len(Dst))
    for _ in range(iterations):
        a_new = 1 / np.maximum(F @ (b * Dst), 1e-300)
        b_new = 1 / np.maximum(F.T @ (a_new * O), 1e-300)
        done = np.allclose(a_new, a, rtol=tol) and np.allclose(b_new, b, rtol=tol)
        a, b = a_new, b_new
        if done:
            break
    return (a * O)[:, None] * (b * Dst)[None, :] * F


def cpc(T, P):
    return 2 * np.minimum(T, P).sum() / (T.sum() + P.sum())


def poisson_loglik(T, P):
    m = P > 0
    return float((T[m] * np.log(P[m]) - P[m]).sum())


def study(net: Net) -> dict:
    idx = np.flatnonzero(net.active)
    T = net.A[np.ix_(idx, idx)]
    d = net.D[np.ix_(idx, idx)].copy()
    d = np.maximum(d, 0.05)  # docks closer than 50 m are treated as 50 m apart
    np.fill_diagonal(d, 1e6)  # self-pairs are excluded; a huge distance zeroes their deterrence
    O, Dst = T.sum(1), T.sum(0)
    off = ~np.eye(len(idx), dtype=bool)

    def fitted(kind, p):
        F = np.exp(-p * d) if kind == 'exponential' else d ** (-p)
        np.fill_diagonal(F, 0)
        return ipf(O, Dst, F)

    models = {}
    for kind, bounds in (('exponential', (0.05, 3)), ('power', (0.1, 5))):
        res = optimize.minimize_scalar(lambda p: -poisson_loglik(T[off], fitted(kind, p)[off]),
                                       bounds=bounds, method='bounded', options={'xatol': 1e-4})
        P = fitted(kind, res.x)
        models[kind] = {'param': res.x, 'P': P}
    # Exponential-power hybrid: f = d^-g exp(-b d), two parameters.

    def hybrid(params):
        g, b = params
        F = d ** (-g) * np.exp(-b * d)
        np.fill_diagonal(F, 0)
        return ipf(O, Dst, F)
    res = optimize.minimize(lambda p: -poisson_loglik(T[off], hybrid(p)[off]), [0.5, 0.5],
                            method='Nelder-Mead', options={'xatol': 1e-3, 'fatol': 1})
    models['hybrid'] = {'param': res.x, 'P': hybrid(res.x)}

    # The Thames as a barrier: exponential deterrence plus a penalty theta for crossing the river.
    cross = river_crossings(ROOT, net.stations)[np.ix_(idx, idx)]

    def with_river(params):
        b, th = params
        F = np.exp(-b * d - th * cross)
        np.fill_diagonal(F, 0)
        return ipf(O, Dst, F)
    res = optimize.minimize(lambda p: -poisson_loglik(T[off], with_river(p)[off]), [models['exponential']['param'], 0.2],
                            method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 0.5})
    models['river'] = {'param': res.x, 'P': with_river(res.x)}
    expo = models['exponential']['P']
    dd_all = net.D[np.ix_(idx, idx)]
    river_bands = []
    for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 5), (5, 8)):
        band = (dd_all >= lo) & (dd_all < hi) & off
        river_bands.append({'band': [lo, hi],
                            'cross': r(T[band & cross].sum() / expo[band & cross].sum(), 3),
                            'same': r(T[band & ~cross].sum() / expo[band & ~cross].sum(), 3),
                            'crossPairs': int((band & cross).sum())})
    river = {'beta': r(res.x[0], 4), 'theta': r(res.x[1], 4), 'kmEquivalent': r(res.x[1] / res.x[0], 3),
             'crossShare': r(cross[off].mean(), 4), 'bands': river_bands}

    # Radiation, production-constrained, opportunities = departures of stations closer to i than j.
    m = O.astype(float)
    order = np.argsort(d, axis=1)
    s = np.zeros_like(d)
    for i in range(len(idx)):
        ranked = order[i]
        cum = np.cumsum(m[ranked]) - m[ranked]   # everything strictly closer (ties ignored)
        s[i, ranked] = cum - m[i] * (ranked != i)  # exclude the origin itself
    s = np.maximum(s, 0)
    with np.errstate(divide='ignore', invalid='ignore'):
        R = (m[:, None] * Dst[None, :]) / ((m[:, None] + s) * (m[:, None] + Dst[None, :] + s))
    np.fill_diagonal(R, 0)
    R = R / R.sum(1, keepdims=True) * O[:, None]
    models['radiation'] = {'param': None, 'P': R}

    out_models = []
    for name, mod in models.items():
        P = mod['P']
        logobs, logpred = np.log(T[off][T[off] > 0]), np.log(P[off][T[off] > 0])
        out_models.append({
            'name': name, 'param': None if mod['param'] is None else [r(x, 4) for x in np.atleast_1d(mod['param'])],
            'cpc': r(cpc(T[off], P[off])), 'loglik': r(poisson_loglik(T[off], P[off]), 0),
            'logR2': r(np.corrcoef(logobs, logpred)[0, 1] ** 2),
        })
    best = max(out_models, key=lambda x: x['loglik'])
    P = models[best['name']]['P']

    # Deterrence: trips per station pair as a function of distance, versus the fitted shape.
    edges_km = np.arange(0, 10.01, 0.25)
    dd = net.D[np.ix_(idx, idx)][off]
    tt, pp = T[off], P[off]
    decay = []
    for lo, hi in zip(edges_km[:-1], edges_km[1:]):
        sel = (dd >= lo) & (dd < hi)
        if sel.sum() < 20:
            continue
        decay.append([r((lo + hi) / 2, 3), int(sel.sum()), r(tt[sel].mean(), 3), r(pp[sel].mean(), 3),
                      r((tt[sel] > 0).mean(), 4)])

    # Observed vs predicted density grid for the best model (log10 axes, pairs with predicted >= 0.1).
    sel = pp >= 0.1
    x, y = np.log10(pp[sel]), np.log10(tt[sel] + 1)
    H, xe, ye = np.histogram2d(x, y, bins=[36, 30], range=[[-1, 2.6], [0, 2.6]])
    grid = {'x': [r(v, 3) for v in xe], 'y': [r(v, 3) for v in ye], 'counts': H.astype(int).tolist()}

    # Corridors that beat geography: standardised Pearson residuals of the best gravity model.
    resid = (T - P) / np.sqrt(np.maximum(P, 1e-9))
    np.fill_diagonal(resid, -np.inf)
    cand = (T >= 40)
    flat = np.where(cand, resid, -np.inf).ravel()
    best_pairs = np.argsort(-flat)[:160]
    corridors = []
    for k in best_pairs:
        i, j = divmod(int(k), len(idx))
        corridors.append([int(idx[i]), int(idx[j]), int(T[i, j]), r(P[i, j], 1), r(resid[i, j], 1), r(net.D[idx[i], idx[j]], 3)])
    # Missing links: pairs gravity expects to be busy (and that are not neighbouring docks).
    far = net.D[np.ix_(idx, idx)] >= 0.6
    under = np.where((P >= 30) & off & far, (T - P) / np.sqrt(np.maximum(P, 1e-9)), np.inf).ravel()
    gaps = []
    for k in np.argsort(under)[:60]:
        i, j = divmod(int(k), len(idx))
        gaps.append([int(idx[i]), int(idx[j]), int(T[i, j]), r(P[i, j], 1), r((T[i, j] - P[i, j]) / np.sqrt(P[i, j]), 1), r(net.D[idx[i], idx[j]], 3)])

    # Trip lengths and straight-line speeds, all trips and by bike type.
    t = net.trips
    loops = t['a'] == t['b']
    hist_edges = np.arange(0, 12.01, 0.2)
    lengths = {}
    for key, mask in (('classic', ~t['ebike'] & ~loops), ('electric', t['ebike'] & ~loops)):
        h, _ = np.histogram(t.loc[mask, 'km'], bins=hist_edges)
        km = t.loc[mask, 'km']
        mins = t.loc[mask, 'minutes']
        speed = (km / (mins / 60))[(mins > 1) & (mins < 120)]
        lengths[key] = {'hist': (h / h.sum()).round(5).tolist(), 'median': r(km.median(), 3),
                        'mean': r(km.mean(), 3), 'p90': r(km.quantile(0.9), 3),
                        'medianMinutes': r(mins.median(), 2), 'medianSpeed': r(speed.median(), 2)}
    reach = np.zeros(net.n)
    med = t[~loops].groupby('a')['km'].median()
    reach[med.index.to_numpy()] = med.to_numpy()
    surprise = np.zeros(net.n)
    with np.errstate(invalid='ignore', divide='ignore'):
        surprise[idx] = np.where(P.sum(1) > 0, (T * np.log(np.maximum(T, 1e-12) / np.maximum(P, 1e-12))).sum(1) / np.maximum(T.sum(1), 1), 0)
    return {
        'models': out_models, 'best': best['name'], 'decay': decay, 'river': river,
        'decayFields': ['km', 'pairs', 'meanTrips', 'meanPredicted', 'shareConnected'],
        'grid': grid, 'corridors': corridors, 'gaps': gaps,
        'corridorFields': ['from', 'to', 'trips', 'predicted', 'residual', 'km'],
        'lengths': {'binKm': 0.2, **lengths},
        'node': {'reach': reach, 'surprise': surprise},
    }
