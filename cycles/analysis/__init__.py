"""Complex-network study of the May 2026 Santander Cycles journey graph.

Every module receives a `Net`: the station table, the clean trip table and dense
N x N matrices (N = 801 current stations, small enough to keep everything exact).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
import numpy as np
import pandas as pd
from ..trips import ROOT, haversine_km

SEED = 42


@dataclass
class Net:
    stations: pd.DataFrame
    trips: pd.DataFrame
    W: np.ndarray            # all journeys i -> j, including same-dock returns on the diagonal
    A: np.ndarray            # W without the diagonal: the directed weighted graph studied
    D: np.ndarray            # great-circle distance between docks, km
    active: np.ndarray       # stations with at least one non-loop journey
    cache: dict = field(default_factory=dict)

    @property
    def n(self):
        return len(self.stations)

    @property
    def S(self):
        """Undirected weights w_ij + w_ji, used where direction has no meaning."""
        if 'S' not in self.cache:
            self.cache['S'] = self.A + self.A.T
        return self.cache['S']

    def matrix(self, mask=None) -> np.ndarray:
        rows = self.trips if mask is None else self.trips[mask]
        out = np.zeros((self.n, self.n))
        np.add.at(out, (rows['a'].to_numpy(), rows['b'].to_numpy()), 1)
        return out


def load(root: Path = ROOT) -> Net:
    derived = root / 'data/derived'
    stations = pd.read_parquet(derived / 'stations.parquet')
    trips = pd.read_parquet(derived / 'trips.parquet')
    n = len(stations)
    W = np.zeros((n, n))
    np.add.at(W, (trips['a'].to_numpy(), trips['b'].to_numpy()), 1)
    A = W.copy()
    np.fill_diagonal(A, 0)
    lat, lon = stations['lat'].to_numpy(), stations['lon'].to_numpy()
    D = haversine_km(lat[:, None], lon[:, None], lat[None, :], lon[None, :])
    active = (A.sum(0) + A.sum(1)) > 0
    return Net(stations, trips, W, A, D, active)


def gini(values) -> float:
    x = np.sort(np.asarray(values, float))
    if x.sum() == 0:
        return 0.0
    n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum()))


def lorenz(values, points=101):
    x = np.sort(np.asarray(values, float))
    cum = np.concatenate([[0], np.cumsum(x)]) / x.sum()
    q = np.linspace(0, 1, points)
    return np.interp(q, np.linspace(0, 1, len(cum)), cum)


def ccdf(values, points=60):
    """Complementary CDF on a log grid, for log-log distribution plots."""
    x = np.asarray(values, float)
    x = x[x > 0]
    grid = np.unique(np.round(np.logspace(np.log10(x.min()), np.log10(x.max()), points), 6))
    xs = np.sort(x)
    p = 1 - np.searchsorted(xs, grid, side='left') / len(xs)
    return [[float(g), float(v)] for g, v in zip(grid, p) if v > 0]


def percentile_rank(values) -> np.ndarray:
    v = np.asarray(values, float)
    order = v.argsort().argsort()
    return order / max(len(v) - 1, 1)


def r(x, digits=4):
    """Rounded plain float for compact JSON."""
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return None
    return round(float(x), digits)
