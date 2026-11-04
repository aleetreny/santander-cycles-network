// The methods table at the end: what each tool answered, with the headline number it produced.
import { fmt } from './charts.js';

export function renderToolkit(data) {
  const S = data.study, d = data.derived;
  const best = S.space.models.find(m => m.name === 'river');
  const names = m => S.centrality.top[m].slice(0, 3).map(i => data.stations.columns.name[i].split(',')[0]).join(', ');
  const rows = [
    ['Directed weighted graph, null reciprocity', 'What is connected, and how symmetric is it?', 'NumPy dense matrices, igraph', `density ${fmt.pct(S.summary.density)}; ${fmt.pct0(S.summary.reciprocityWeighted)} of weight returned`, 'c1'],
    ['Heavy-tail MLE, Vuong test, Lorenz, Gini', 'Are there hubs?', 'SciPy (own Clauset–Shalizi–Newman fit)', `links log-normal (${fmt.f2(S.distributions.giniWeight)} Gini), no scale-free stations`, 'c2'],
    ['Strength–degree scaling', 'Do busy stations have heavier links?', 'SciPy regression', `s ∝ k<sup>${fmt.f2(S.distributions.strengthDegree.beta)}</sup>`, 'c2'],
    ['Disparity filter backbone', 'Which links matter locally?', 'NumPy, own implementation', `${fmt.int(d.bb3.edges)} links keep ${fmt.int(d.bb3.nodes)} stations at α = 0.001`, 'c3'],
    ['Small-world test', 'Clustered yet short?', 'igraph', `C = ${fmt.f2(S.summary.backboneClustering)} vs ${fmt.f3(S.summary.backboneClusteringRandom)} random`, 'c3'],
    ['Doubly constrained gravity, radiation', 'How much does distance explain?', 'IPF + Poisson MLE (SciPy)', `CPC ${fmt.pct0(best.cpc)}; radiation ${fmt.pct0(d.cpcRad)}`, 'c4'],
    ['River-crossing penalty', 'Is the Thames a barrier?', 'Segment intersection on OpenStreetMap geometry', `crossing ≈ ${fmt.f2(S.space.river.kmEquivalent)} km of extra riding`, 'c4'],
    ['Standardised residuals', 'Which corridors beat geography?', 'NumPy', 'student halls to campuses, park loops', 'c4'],
    ['PageRank, HITS, eigenvector', 'Who is central?', 'igraph', names('pagerank'), 'c5'],
    ['Betweenness and closeness on effective distance', 'Who sits between regions?', 'igraph, Brockmann–Helbing distance', names('betweenness'), 'c5'],
    ['Leiden, resolution sweep, seed consensus', 'Are there regions?', 'leidenalg', `${S.communities.groups.length} regions, Q = ${fmt.f3(S.communities.modularity)}`, 'c6'],
    ['Weighted configuration null model', 'Is that modularity real?', 'Poisson Chung–Lu samples', `z ≈ ${fmt.int(S.communities.nullModularity.z)}`, 'c6'],
    ['Infomap (map equation)', 'Do flow-based modules agree?', 'infomap', `NMI ${fmt.f2(S.communities.infomap.nmiLeiden)} with Leiden`, 'c6'],
    ['Guimerà–Amaral roles', 'Who bridges regions?', 'NumPy', `${S.communities.roles['6']} connector hubs`, 'c6'],
    ['Weighted rich club', 'Do top stations favour each other?', 'Opsahl et al., weight reshuffling', `${fmt.f1(d.club10)}× for the top 10`, 'c7'],
    ['Assortativity (degree, strength)', 'Do similar stations link?', 'igraph, weighted Pearson', `${fmt.f2(S.mixing.assortativity.strengthUndirected)}: neutral`, 'c7'],
    ['Directed triad census vs rewiring', 'Which patterns are over-represented?', 'igraph, 40 degree-preserving rewirings', 'reciprocal triangles z ≈ 1,000', 'c7'],
    ['Hourly multilayer similarity, k-means regimes', 'When does the network change?', 'NumPy, scikit-learn', `5 regimes; morning and evening balances r = ${fmt.f2(S.temporal.commute.stationR)}`, 'c8'],
    ['Time-resolved PageRank', 'Where is the centre at each hour?', 'igraph', 'Bank → Exhibition Road → Waterloo', 'c8'],
    ['Temporal-signature clustering', 'What kinds of station exist?', 'scikit-learn k-means, silhouette', '6 archetypes on a continuum', 'c9'],
    ['Markov chain, spectral gap', 'How fast do bikes mix?', 'NumPy eigen-decomposition', `λ₂ = ${fmt.f2(S.dynamics.markov.lambda2)}; ${fmt.f1(S.dynamics.markov.mixingRides)} rides`, 'c10'],
    ['Out-of-sample validation', 'Does the model predict real docks?', 'pandas, SciPy, BikePoint archive', `r = ${fmt.f2(S.dynamics.validation.pooledR)} on September data`, 'c10'],
    ['Trajectory reconstruction', 'Who moves the bikes?', 'pandas on 11,531 bike ids', `${fmt.int(S.dynamics.relocation.relocations)} relocations, ρ = ${fmt.f2(S.dynamics.relocation.riderVsOperator)}`, 'c11'],
    ['Targeted and random node removal', 'How fragile is it?', 'Union–find, own implementation', 'backbone breaks after ~25% busiest closed', 'c12'],
    ['Edge percolation, topological overlap', 'Do weak ties bridge?', 'Onnela et al. protocol', `overlap ${fmt.f2(d.overlapLow)} → ${fmt.f2(d.overlapHigh)}`, 'c12'],
    ['Multiplex overlap, layer comparison', 'Do e-bikes make a different network?', 'Battiston et al. measures', `${fmt.pct0(S.layerPairs['classic-electric'].backboneJaccard)} shared backbone`, 'c13'],
    ['t-SNE, force layout, spectral embedding', 'What does London look like in flow space?', 'scikit-learn, igraph, SciPy, Procrustes', `trustworthiness ${fmt.f3(S.embedding.quality.flow.trust)}`, 'c14'],
  ];
  document.getElementById('toolkit').innerHTML =
    '<thead><tr><th scope="col">Method</th><th scope="col">Question</th><th scope="col">How</th><th scope="col">Headline</th></tr></thead><tbody>' +
    rows.map(([m, q, how, res, ch]) => `<tr><td><a href="#${ch}">${m}</a></td><td>${q}</td><td>${how}</td><td>${res}</td></tr>`).join('') + '</tbody>';
}
