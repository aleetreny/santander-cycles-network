# Study notes

Unit of observation: one recorded hire. Node: a current BikePoint dock, matched by normalised name (all 801 names are unique). Directed edge i → j weighted by hires. Same-dock returns (3.75%) are kept in station totals but excluded from topology. 863,014 valid hires, 857,151 matched (99.32%). Six retired or renamed docks are excluded. Calendar: 19 working days and 12 weekend or bank-holiday days (4 and 25 May count as non-working). Rates are per day of the relevant type.

## Chapters and their methods

1. Graph basics. Density, reciprocity (binary and weighted, with a Poisson configuration null), components, paths.
2. Heterogeneity. Continuous MLE tail fits with KS-optimal xmin, likelihood-ratio (Vuong) comparisons of power law, log-normal and exponential, Gini and Lorenz, strength–degree scaling.
3. Backbone. Directed disparity filter, a link kept if significant at either end. Compared with a top-m weight threshold. Small-world check on the α = 0.05 backbone.
4. Space. Doubly constrained gravity via IPF, deterrence fitted by Poisson ML (exponential, power, hybrid, exponential + river crossing). Production-constrained radiation model. Goodness of fit by CPC. Standardised Pearson residuals give over- and under-used links. River crossing: odd number of intersections between the dock-to-dock segment and the OSM Thames centre line.
5. Centrality. Weighted PageRank (d = 0.85), HITS, eigenvector on the symmetrised graph. Betweenness and closeness on effective distance 1 − ln P_ij. Kendall τ between rankings.
6. Mesoscale. Leiden (RB configuration) at γ ∈ {0.25 … 4}, 24 seeds per γ, best modularity kept, seed stability as mean pairwise NMI, labels matched across γ by Hungarian assignment. Null: Leiden on Poisson Chung–Lu graphs with the same expected strengths. Infomap: directed, two-level, 16 trials. Guimerà–Amaral roles with strengths.
7. Higher order. Opsahl weighted rich club against weight reshuffles on fixed topology. Leung–Chau weighted assortativity. Barrat clustering. Directed triad census on the α = 0.01 backbone against 40 degree-preserving rewirings, giving the significance profile.
8. Time. 48 hourly per-day layers, cosine similarity, average-linkage ordering, k-means (k = 5) regimes. Commute symmetry measured three ways: station net-balance correlation, weighted overlap with the reversed evening layer, and the fate of the 300 busiest morning links. Hourly PageRank leaders.
9. Archetypes. k-means (k = 6, 50 inits) on z-scored, size-normalised 96-dimensional rhythms. Silhouettes reported for k = 4…8.
10. Dynamics. Row-stochastic P including loops, stationary distribution, |λ2| and mixing time, total-variation decay. Validation: May working-day hourly net arrivals against the change in September weekday mean bikes, from BikePoint snapshots with each date weighted equally and at least 10 dates per hour.
11. Relocations. Consecutive hires of the same bike where the next start dock differs from the last end dock. Rider vs operator net flows compared by Spearman correlation, plus the share of rider imbalance cancelled.
12. Robustness. Static node removal by strength, betweenness, participation, distance from centre, or at random (20 orders). Journeys retained and giant component of the α = 0.001 backbone. Edge percolation weak-first vs strong-first by union–find. Topological overlap against weight.
13. Multiplex. Classic, electric, working and free layers: density, decay, reciprocity, Leiden partition and NMI to the global partition. Battiston edge overlap, backbone Jaccard, log-weight correlation on shared links.
14. Embedding. t-SNE (perplexity 35) on PCA-40 of Hellinger origin and destination profiles. Fruchterman–Reingold on the α = 0.01 backbone seeded by geography. Normalised-Laplacian eigenvectors 2–3. All Procrustes-aligned to geography. Trustworthiness and distance-rank correlation reported.

## Things deliberately not claimed

No causal effect of closures, no routes, no riders, no forecast. The occupancy check uses a different month, so its agreement is a lower bound on what a same-month test would show.
