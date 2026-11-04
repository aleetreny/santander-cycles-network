"""Multiscale backbone: the disparity filter of Serrano, Boguñá & Vespignani (PNAS 2009).

For each edge the null hypothesis is that a node's strength is split uniformly at random
among its k edges. alpha is the probability of seeing a share at least p_ij under that
null: alpha = (1 - p_ij)^(k - 1). An edge is kept if it is significant for its origin
(out-edges) or its destination (in-edges). Unlike a global weight threshold, this keeps
locally important links of quiet outer stations too.
"""
from __future__ import annotations
import numpy as np
from . import Net, r


def alphas(A: np.ndarray) -> np.ndarray:
    """Directed disparity alpha per edge (min of origin and destination test); 1 where no edge."""
    present = A > 0
    s_out, s_in = A.sum(1, keepdims=True), A.sum(0, keepdims=True)
    k_out, k_in = present.sum(1, keepdims=True), present.sum(0, keepdims=True)
    with np.errstate(divide='ignore', invalid='ignore'):
        a_out = np.where(present, (1 - A / s_out) ** np.maximum(k_out - 1, 0), 1.0)
        a_in = np.where(present, (1 - A / s_in) ** np.maximum(k_in - 1, 0), 1.0)
    # A node with a single link: that link carries all its traffic, so it is kept.
    a_out = np.where(present & (k_out == 1), 0.0, a_out)
    a_in = np.where(present & (k_in == 1), 0.0, a_in)
    return np.where(present, np.minimum(a_out, a_in), 1.0)


def backbone(net: Net, alpha=0.05) -> np.ndarray:
    if ('backbone', alpha) not in net.cache:
        a = net.cache.setdefault('alpha', alphas(net.A))
        net.cache[('backbone', alpha)] = (a < alpha) & (net.A > 0)
    return net.cache[('backbone', alpha)]


def study(net: Net) -> dict:
    A = net.A
    a = net.cache.setdefault('alpha', alphas(A))
    total_edges, total_weight = int((A > 0).sum()), A.sum()
    levels = []
    for level in (0.2, 0.1, 0.05, 0.01, 0.001, 1e-4, 1e-5, 1e-6):
        keep = (a < level) & (A > 0)
        nodes = int(((keep.sum(0) + keep.sum(1)) > 0).sum())
        # Same number of edges kept by a naive global weight threshold, for comparison.
        m = int(keep.sum())
        # Exactly the m heaviest links (ties broken by position, as the site does).
        ii, jj = np.nonzero(A)
        pick = np.argsort(-A[ii, jj], kind='stable')[:m]
        top = A[ii[pick], jj[pick]]
        naive = np.zeros_like(A, dtype=bool)
        naive[ii[pick], jj[pick]] = True
        naive_nodes = int(((naive.sum(0) + naive.sum(1)) > 0).sum())
        levels.append({'alpha': level, 'edges': m, 'edgeShare': r(m / total_edges),
                       'weightShare': r(A[keep].sum() / total_weight), 'nodes': nodes,
                       'naiveNodes': naive_nodes, 'naiveWeightShare': r(top.sum() / total_weight)})
    keep = backbone(net)
    i, j = np.nonzero(keep)
    order = np.argsort(-A[i, j])
    # Floor, not round, so a stored value never crosses a significance threshold it did not pass.
    edges = [[int(i[k]), int(j[k]), int(A[i[k], j[k]]), float(np.floor(-np.log10(max(a[i[k], j[k]], 1e-12)) * 1e4) / 1e4),
              r(net.D[i[k], j[k]], 3)] for k in order]
    return {'levels': levels, 'edges': edges,
            'edgeFields': ['from', 'to', 'trips', 'minusLog10Alpha', 'km']}
