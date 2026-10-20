# Santander Cycles · London's mobility network

**UCL Complex Networks — reproducible Transport for London open-data project.**

Model docking stations as nodes and completed cycle-hire journeys as **directed, weighted origin–destination (OD) edges**. Explore a published static atlas or produce a standalone interactive HTML map, with inbound/outbound flows and a station matching quality report. **Lines connect origins and destinations; they are not inferred GPS cycling routes.**

## Explore the atlas

**[Open London, by bike →](https://aleetreny.github.io/santander-cycles-network/)**

A static, responsive network explorer with **801 available stations**, **857,151 mapped journeys** and **212,532 directed connections**, based on **1–31 May 2026**. May is the newest complete dated month found in TfL's public archive at build time (20 October 2026). This is a pinned study, not live traffic. Both endpoints are matched for **99.32%** of valid journeys.

- Click a station or search a street/area to see its busiest outgoing and incoming connections.
- Read every connection as a count of recorded trips, its share of departures/arrivals, average trips per observed day and median hire time. Numbered coloured pins match the ranked route list; clicking a connection keeps the origin selected.
- Compare weekdays/weekends, morning (07–10), daytime (10–16), evening (16–19), night (19–07) or all hours, for all bikes, classic bikes or electric bikes.
- Narrow displayed links by straight-line dock distance, within/across-community connections and minimum trip count; display totals or daily averages. Link filters do not change the denominator used for route shares.
- Rank stations by activity or distinct neighbours. Colour the map by four weighted Louvain communities.
- Read **The study** for hub concentration, daily rhythms, communities, a static station-removal experiment, coverage and limitations.
- Download all station coordinates, full weighted OD edges, unmatched station names, metrics and source checksums from the study.

The map displays only the strongest 80 non-return links initially; the slider changes visual density only. All available current stations remain on the map. Counts and graph measures always use the complete selected network.

### Rebuild the published dataset

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-study.txt
python -m cycles.publish --year 2026 --month 5
python -m cycles.atlas              # compact views and lazy station detail
python3 -m http.server 4173 --directory site
```

The 45 interactive slices load a small overview first and fetch one station’s routes on selection. The full edge CSV remains downloadable; the browser never needs to load it or the legacy full-network JSON to draw the atlas. Canvas station markers are reused across interactions, and the study module loads only when opened.

The monthly publisher discovers overlapping dated extracts, downloads just those files, captures current stations, normalizes and deduplicates records, checks that every calendar date is present, and exports nine day/time network slices. `--export-only` reuses downloaded, prepared inputs and the local station snapshot. A fresh API snapshot may change matches; the shipped `site/data/stations.csv` preserves the exact coordinates used for this release. Source byte sizes, ETags, SHA-256 hashes, snapshot time, settings and package versions are recorded in `site/data/meta.json`.

```bash
pip install -r requirements-dev.txt
pytest -q                         # includes published-data conservation checks
npm install
npx playwright install chromium
npm run check
npm run test:browser              # with the local HTTP server running
```

Browser checks cover desktop/mobile layouts, explicit route units and denominators, numbered pins, route selection that preserves the origin, bike/time/day filters, display-only link filters, daily rates, play/pause, reduced motion, study presets and retry after a failed detail fetch. Data checks conserve every arrival and departure across all 45 slices. Screenshots go to ignored `artifacts/`. Set `ATLAS_URL` to test another deployment.

### Publish

Pushing changes under `site/` to `main` triggers `.github/workflows/pages.yml`. GitHub Pages uses the **GitHub Actions** source. It uploads the static `site/` folder; no API keys, application server or build step are needed. The separate check workflow runs the Python regression tests. Journey aggregates are deliberately versioned; raw extracts (~144 MB for this month) and processed Parquet stay ignored locally. No automatic data refresh is configured.

Map tiles are provided by OpenStreetMap and need an internet connection. Leaflet and fonts are self-hosted, with their licence files in `site/`. This is an independent educational project, not an official TfL or Santander product.

## Data sources

- [TfL historical cycle hire journey CSVs](https://cycling.data.tfl.gov.uk/) — weekly/fortnightly extracts from September 2015. Direct public S3 listing: `https://s3-eu-west-1.amazonaws.com/cycling.data.tfl.gov.uk/?list-type=2&prefix=usage-stats/` (no authentication).
- [TfL BikePoint Unified API](https://api.tfl.gov.uk/BikePoint) — current station coordinates, docking capacity, current availability. Not a historic inventory.

TfL attribution: **Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016; Geomni UK Map data © and database rights 2019.** See [TfL transport-data terms](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service). Data copyright/licence remains with original owners. Code herein is MIT-licensed.

## Quick start (macOS/Linux; Python 3.10+)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m cycles inventory       # discover every historical CSV and print download size
python -m cycles fetch --limit 2 # pilot: get two TfL CSVs (use `fetch` to get ALL)
python -m cycles stations        # save BikePoint JSON snapshot and station CSV
python -m cycles prepare --limit 2  # standardize to compressed Parquet
python -m cycles network         # build OD graph across every prepared file
python -m cycles map --top 150   # create outputs/network_map.html
open outputs/network_map.html
```

### Download the entire available historical archive

```bash
python -m cycles inventory
python -m cycles fetch --workers 3
python -m cycles stations
python -m cycles prepare
python -m cycles network --year 2025
python -m cycles map --top 200
```

`python -m cycles all --year 2025` runs the entire pipeline. **Estimate the storage from `inventory` first.** Downloads are idempotent and size-checked against S3 listing. Raw CSV/ZIP files, converted Parquet and generated maps are ignored by Git; they stay on your computer. The source manifest lists download URLs, byte sizes and publication dates. The primary source is refreshed by rerunning `inventory` and `fetch`. If a source CSV is replaced without changing size, delete that file and rerun, or verify the published ETag manually.

Useful options: `network --year 2026 --month 9 --day-type weekday`; `network --start-hour 7 --end-hour 10 --day-type weekday` for morning commute; `network --bike-model ELECTRIC` (model only available in newer extracts); `map --top 80 --min-journeys 30`.

## Project layout

```text
cycles/acquire.py      S3 public XML inventory, concurrent downloads, BikePoint API snapshots
cycles/prepare.py      CSV schema adaptation (2015–2026), timestamp cleanup, Parquet
cycles/network.py      de-duplicated directed OD aggregation, station geocoding, QA
cycles/viz.py          standalone Folium HTML (map tiles need internet)
cycles/__main__.py     CLI
requirements.txt       locked major ranges
tests/                 schema and API regression tests
data/                  runtime data (ignored by git)
outputs/               OD edges, nodes, QA report, HTML network map (ignored by git)
```

## Key methodological caveats

1. **Publication lag:** the newest journey extracts may be several weeks behind current time, while BikePoint is live.
2. **Station history:** stations may be closed, renamed or relocated. The current BikePoint snapshot cannot accurately geolocate every historical station. Join by ID *and* name when possible, else by unique normalized name; unmatched nodes remain in `nodes.csv` and are explicitly excluded from maps. Inspect `outputs/quality.txt` and quantify the missing share before publishing.
3. **Schemas change:** old `Rental Id/Duration/Bike Id/...` and new `Number/Total duration (ms)/Bike model/...` are harmonized, but previously unseen columns should raise a visible error.
4. **Duplicates:** some historical extracts overlap. `network` de-duplicates valid trip identifiers before OD aggregation. Some records without IDs have only a conservative composite fallback.
5. **Time:** timestamp strings are interpreted as local London wall time without forced timezone conversion. DST-transition times need extra care in hour-of-day studies.
6. **Bias:** a recorded journey is a hire, not an individual person. OD edges are not street-level GPS paths. Redistribution by operators and dockless cycling are not represented as normal customer journeys.
7. **Scale:** the complete archive can occupy many gigabytes. Prefer year-specific network aggregations and avoid importing every trip into an in-memory pandas DataFrame. DuckDB reads columnar Parquet files and does the group-by itself.

## Research options

- **Core:** directed station-level network; in/out strength and hub hierarchy, degree distributions, edge-weight heterogeneity.
- **Temporal:** compare months, weekdays/weekends and commuting peaks via `--start-hour/--end-hour`.
- **Advanced:** Leiden/Louvain communities, weighted betweenness, flow persistence, nestedness, null-model comparisons, network resilience.

This first version creates a useful map; **it does not yet claim to answer a publishable research question or reconstruct historical bike movements perfectly**. Confirm the station matching coverage and choose a precise hypothesis before drawing causal conclusions.

## Status

The project includes scripts and regression tests. The full TfL journey archive is **not bundled in GitHub or the downloadable project ZIP**; download it from TfL by running the supplied pipeline. This is deliberate: GitHub is unsuitable for multi-GB raw datasets. Public source files are not mirrored here.
