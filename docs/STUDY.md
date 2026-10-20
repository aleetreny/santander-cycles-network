# A simple complex networks project, with a complete research path

Research question: how do station-level journey flows organise London's Santander Cycles network, and how does this organisation vary by day type and commuting window?

Unit of observation: recorded hire, not person. Node: current docking station with matched name. Directed edge: observed origin–destination pair, weighted by number of hires. Coordinates are current, while the journey window is May 2026. Exclude unmatched endpoints from the graph and report them; keep all current nodes on the map. No GPS route reconstruction.

## Delivered core

1. **Auditable acquisition.** Two official extracts, SHA-256 checksums, fixed observation window, positive-duration and valid-time checks, identifier deduplication, complete calendar-date check, explicit unmatched endpoint audit.
2. **Graph and hubs.** In/out strength, distinct neighbours, directed density, binary reciprocity, weak connected component. Keep same-station returns in endpoint totals but exclude them from topology and community detection. Full aggregates downloadable.
3. **Time.** Nine complete network slices: every day / weekday / weekend × all hours / 07–10 / 16–19. Compare hourly profiles using journeys per day, not raw totals from unequal numbers of dates. Bank holidays remain weekdays.
4. **Communities.** Weighted Louvain on symmetrised summed flows; fixed seed 42, resolution 1. Display this full-month partition consistently in temporal views, to avoid confusing algorithm changes with travel changes.
5. **Stress test.** Static deletion of 10% of active nodes, once ranked by activity, compared with 100 seeded random deletions. Outcome is the share of observed journeys with both endpoints remaining; no rerouting prediction.
6. **Communication.** Geographic station map, restrained strongest-edge view, directional station detail, explanatory study with genuine findings, explicit dates, coverage and caveats.

## Results of this snapshot

- 863,014 valid hires; 857,151 matched (99.3206%). 5,863 hires excluded for at least one unmatched endpoint.
- 801 current stations shown; 796 with at least one non-return edge. 212,532 directed non-loop pairs.
- Directed density .335849; binary reciprocity .6595; largest weak component 796 nodes.
- 4 Louvain communities; modularity .3668. This is descriptive structure, not evidence of an optimal or unique partition.
- Top ten stations account for 4.494% of endpoint activity. Avoid an exaggerated "few hubs dominate everything" conclusion.
- Removing 80 busiest active stations retains 60.614% of observed trip weights; random removal mean 81.427% (sample range 79.249%–83.861%). No causal closure effect is estimated.

## Suggested presentation

Lead with the geographic network and explain one station's spokes. Define degree versus strength with that real station. Compare weekday and weekend time profiles. Show spatial community structure, then stress-test activity concentration. Finish with the matching audit and the limitations of one month's data.

## Extensions, deliberately outside the first release

Compare a second complete month to measure partition stability and seasonal shifts. Test modularity against degree/strength-preserving null networks and repeat Louvain over seeds/resolutions. Compare strength inequality using a Lorenz curve and Gini coefficient. Only add betweenness after defining how flow weight becomes a distance or cost. Explore dock capacity and electric-bike composition as descriptive covariates; do not claim causal effects from this observational atlas.
