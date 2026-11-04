"""London as the bikes see it: layouts where distance means flow, not metres.

Three alternative maps of the same stations, all Procrustes-aligned to geography so they can
be morphed into one another:
- flow space: t-SNE of each station's Hellinger-transformed origin and destination profiles;
- force layout: Fruchterman-Reingold on the disparity backbone;
- spectral: the first nontrivial eigenvectors of the normalised Laplacian (Fiedler coordinates).
The normalised Laplacian spectrum also gives an independent estimate of the number of regions
through its eigengap.
"""
from __future__ import annotations
import random
import igraph as ig
import numpy as np
from scipy.linalg import orthogonal_procrustes, eigh
from scipy.spatial.distance import pdist
from scipy.stats import spearmanr
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE, trustworthiness
from . import Net, SEED, r
from .backbone import backbone
from .structure import to_igraph


def project(stations):
    lat, lon = stations['lat'].to_numpy(), stations['lon'].to_numpy()
    lat0 = np.radians(lat.mean())
    x = (lon - lon.mean()) * np.cos(lat0) * 111.32
    y = (lat - lat.mean()) * 110.57
    return np.column_stack([x, y])


def align(X, target):
    """Similarity Procrustes: rotate, reflect, scale and shift X onto target."""
    mx, mt = X.mean(0), target.mean(0)
    A, B = X - mx, target - mt
    R, _ = orthogonal_procrustes(A, B)
    scale = np.trace((A @ R).T @ B) / np.trace(A.T @ A)
    return (A @ R) * scale + mt


def study(net: Net) -> dict:
    idx = np.flatnonzero(net.active)
    geo = project(net.stations)
    G = geo[idx]
    A = net.A[np.ix_(idx, idx)]
    out_p = A / np.maximum(A.sum(1, keepdims=True), 1)
    in_p = A.T / np.maximum(A.sum(0)[:, None], 1)
    H = np.sqrt(np.hstack([out_p, in_p]))
    Z = PCA(40, random_state=SEED).fit_transform(H)
    tsne = TSNE(2, perplexity=35, init='pca', random_state=SEED, max_iter=1500).fit_transform(Z)
    flow = align(tsne, G)

    ig.set_random_number_generator(random.Random(SEED))
    B = backbone(net, 0.01)[np.ix_(idx, idx)]
    U = ((B | B.T) * (A + A.T)).astype(float)
    g = to_igraph(U, directed=False)
    layout = np.array(g.layout_fruchterman_reingold(weights=[np.log1p(w) for w in g.es['weight']], niter=2000,
                                                     seed=G.tolist()))
    force = align(layout, G)

    S = A + A.T
    d = S.sum(1)
    L = np.eye(len(S)) - S / np.sqrt(np.outer(d, d))
    vals, vecs = eigh(L)
    spectral = align(vecs[:, 1:3] / np.sqrt(d)[:, None], G)
    gaps = np.diff(vals[:16])
    eigengap = int(np.argmax(gaps[1:]) + 2)   # number of eigenvalues before the largest gap (ignoring the first)

    def quality(Y):
        return {'trust': r(trustworthiness(Z, Y, n_neighbors=10), 4),
                'geoSpearman': r(spearmanr(pdist(Y), pdist(G))[0], 4)}
    displacement = np.zeros(net.n)
    displacement[idx] = np.linalg.norm(flow - G, axis=1)

    def full(Y):
        P = geo.copy()
        P[idx] = Y
        return P
    return {
        'layouts': {'geo': np.round(geo, 4).tolist(), 'flow': np.round(full(flow), 4).tolist(),
                    'force': np.round(full(force), 4).tolist(), 'spectral': np.round(full(spectral), 4).tolist()},
        'quality': {'flow': quality(flow), 'force': quality(force), 'spectral': quality(spectral)},
        'spectrum': [r(v, 5) for v in vals[:20]], 'eigengap': eigengap,
        'node': {'displacement': displacement},
    }
