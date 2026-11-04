"""The network measures on small graphs whose answers are known by hand."""
import numpy as np
import pandas as pd
import pytest
from cycles.analysis import Net, gini, lorenz, ccdf, percentile_rank
from cycles.analysis.backbone import alphas
from cycles.analysis.structure import s_core, weighted_assortativity, effective_distance, fit_tail
from cycles.analysis.space import ipf, cpc
from cycles.analysis.communities import roles, relabel
from cycles.analysis.robustness import DSU, giant
from cycles.trips import haversine_km, working_day, canonical
from datetime import date


def test_disparity_alpha_matches_closed_form():
    # Node 0 splits 10 trips as 8 / 1 / 1 over three links: alpha = (1 - p)^(k - 1).
    A = np.zeros((4, 4))
    A[0, 1], A[0, 2], A[0, 3] = 8, 1, 1
    a = alphas(A)
    # Each destination has a single in-link, which the filter always keeps.
    assert a[0, 1] == 0 and a[0, 2] == 0
    B = A.copy()
    B[1, 2] = B[3, 2] = 5  # now node 2 has three in-links; its link from 0 is judged at both ends
    b = alphas(B)
    assert b[0, 2] == pytest.approx(min((1 - 0.1) ** 2, (1 - 1 / 11) ** 2))
    assert b[2, 0] == 1.0  # no edge, never significant


def test_gini_and_lorenz_extremes():
    assert gini([5, 5, 5, 5]) == pytest.approx(0)
    assert gini([0, 0, 0, 10]) == pytest.approx(0.75)
    curve = lorenz([1, 1, 1, 1], points=5)
    assert curve == pytest.approx([0, 0.25, 0.5, 0.75, 1])


def test_ccdf_is_monotone_and_starts_at_one():
    values = np.arange(1, 1001)
    c = ccdf(values, 20)
    assert c[0][1] == pytest.approx(1.0)
    assert all(a[1] >= b[1] for a, b in zip(c, c[1:]))


def test_percentile_rank_orders():
    assert list(percentile_rank([30, 10, 20])) == [1.0, 0.0, 0.5]


def test_s_core_peels_weakest_first():
    # A heavy triangle (0, 1, 2) with a light pendant 3.
    S = np.zeros((4, 4))
    for i, j in ((0, 1), (1, 2), (0, 2)):
        S[i, j] = S[j, i] = 10
    S[2, 3] = S[3, 2] = 1
    core = s_core(S)
    assert core[3] == 1 and core[0] == core[1] == core[2] == 20


def test_weighted_assortativity_sign():
    # Big nodes only link to big nodes, small to small: positive assortativity.
    A = np.zeros((4, 4))
    A[0, 1] = A[1, 0] = 10
    A[2, 3] = A[3, 2] = 1
    s = A.sum(1)
    assert weighted_assortativity(A, s, s) == pytest.approx(1.0)


def test_effective_distance_is_short_for_dominant_links():
    A = np.array([[0, 9, 1], [1, 0, 1], [1, 1, 0]], float)
    d = effective_distance(A)
    assert d[0, 1] < d[0, 2]
    assert d[0, 1] == pytest.approx(1 - np.log(0.9))


def test_ipf_reproduces_margins():
    rng = np.random.default_rng(0)
    O, D = rng.uniform(10, 50, 6), rng.uniform(10, 50, 6)
    D *= O.sum() / D.sum()
    F = rng.uniform(0.1, 1, (6, 6))
    np.fill_diagonal(F, 0)
    P = ipf(O, D, F, iterations=500)
    assert P.sum(1) == pytest.approx(O, rel=1e-6)
    assert P.sum(0) == pytest.approx(D, rel=1e-6)


def test_common_part_of_commuters():
    T = np.array([[0, 4], [6, 0]], float)
    assert cpc(T, T) == pytest.approx(1)
    assert cpc(T, np.array([[0, 6], [4, 0]], float)) == pytest.approx(0.8)


def test_tail_fit_recovers_power_law_exponent():
    rng = np.random.default_rng(1)
    x = (1 - rng.uniform(size=20000)) ** (-1 / 1.5)  # Pareto with alpha = 2.5
    assert fit_tail(x)['alpha'] == pytest.approx(2.5, abs=0.12)


def test_roles_hub_and_connector():
    # Two dense groups; node 0 is also strongly tied to the other group.
    S = np.zeros((6, 6))
    for g in ((0, 1, 2), (3, 4, 5)):
        for i in g:
            for j in g:
                if i != j:
                    S[i, j] = 5
    S[0, 3] = S[3, 0] = 10
    part = np.array([0, 0, 0, 1, 1, 1])
    z, P, role = roles(S, part)
    assert P[0] > P[1] and P[1] == pytest.approx(0)


def test_relabel_matches_reference_labels():
    ref = np.array([0, 0, 1, 1, 2])
    part = np.array([5, 5, 7, 7, 9])
    assert list(relabel(part, ref)) == [0, 0, 1, 1, 2]


def test_union_find_giant_component():
    adj = np.zeros((5, 5), bool)
    adj[0, 1] = adj[1, 2] = adj[3, 4] = True
    adj = adj | adj.T
    assert giant(adj, np.ones(5, bool)) == 3
    alive = np.array([True, False, True, True, True])
    assert giant(adj, alive) == 2


def test_haversine_and_calendar():
    # One degree of latitude is about 111 km.
    assert haversine_km(51.0, -0.1, 52.0, -0.1) == pytest.approx(111.2, abs=0.2)
    assert not working_day(date(2026, 5, 4))     # Early May bank holiday
    assert not working_day(date(2026, 5, 9))     # Saturday
    assert working_day(date(2026, 5, 5))
    assert canonical('St. James\'s Square , St. James\'s') == canonical("St James's Square, St James's")
