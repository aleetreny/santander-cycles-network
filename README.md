# Santander Cycles · London's mobility network

**UCL Complex Networks — reproducible Transport for London open-data project.**

Model docking stations as nodes and completed cycle-hire journeys as **directed, weighted origin–destination (OD) edges**. Explore a published static atlas or produce a standalone interactive HTML map, with inbound/outbound flows and a station matching quality report. **Lines connect origins and destinations; they are not inferred GPS cycling routes.**

## Open the station map

**[Londres en bici →](https://aleetreny.github.io/santander-cycles-network/)**

The published interface is deliberately simple: one map, a station search and a station sheet. Drag the map, zoom with the mouse wheel or +/−, and select a station. Selecting a marker never resets the camera. Search centres the chosen station without changing zoom.

- **Current availability:** bikes to hire, free docking spaces, unavailable docks and TfL timestamps. The browser requests BikePoint directly. If that request fails, it clearly labels the dated saved copy; it never calls that copy live.
- **Typical availability:** September 2026, 30 London dates, 2,272,425 usable archived BikePoint readings. Each station shows its empty/full reading fractions, hourly mean bikes/free docks, fullest/emptiest average hour and largest increase between adjacent hourly means.
- **Two useful rankings:** stations most often observed without bikes, and stations most often observed without free docks. These are observed-reading percentages, not exact time percentages.

Selecting a station shows its **five typical outgoing or incoming connections** as straight lines, with arrowheads, numbered endpoint pins and explicit recorded-trip counts. Thicker lines mean more trips. These use the pinned **May 2026** journey study; they are not current traffic or street routes. Click a line or row to highlight it without switching station or changing the camera; the framing button is an explicit camera action. No animations, community controls or study overlays. The original network research pipeline and its frozen May 2026 exports remain in the repository for reproducibility. They are excluded from the Pages artifact.

### Run and verify

```bash
python3 -m http.server 4173 --directory site
npm run check
pip install -r requirements-dev.txt
pytest -q
```

Open `http://127.0.0.1:4173/`. The user-facing interactions are verified manually in the browser; see [manual QA](docs/MANUAL_QA.md). The older `tests/browser.cjs` targets the retired network interface and is retained only as historical research tooling; it is not a check of the current page.

### Rebuild availability statistics

```bash
pip install -r requirements-study.txt
python -m cycles.occupancy --month 2026-09
# Compact typical routes from the existing pinned journey exports:
python -m cycles.connections
# Reuse the same downloaded files and pinned source revision:
python -m cycles.occupancy --month 2026-09 --offline
```

The exporter includes the preceding UTC day, selects the exact London calendar month, rejects impossible counters and zero usable docks, deduplicates station/timestamp readings, and joins versioned station references by UTC source date. Hourly means give each observed date equal weight. Hours with fewer than three observed dates remain missing. The UI requires at least 14 dates and 100 readings, and a historic location within 150 m of the current station. The archive lacks historical locked status; this limitation is visible in the source disclosure.

Inputs remain ignored under `data/occupancy/`. Outputs include source URLs, the pinned Hugging Face revision, SHA-256 hashes, raw/retained row counts and all observed dates. Availability data and derived statistics are **CC BY-SA 3.0**, attributed to TfL and Francisco Feregrino. Code is MIT.

`site/data/live.json` is a dated fallback, not an automatic collector. It is generated with `cycles.occupancy.compact_live` from a real BikePoint response. Current data are requested whenever the page opens and when **Actualizar disponibilidad** is pressed. No background scheduler is configured.

### Publish

Pushing `site/` changes to `main` triggers `.github/workflows/pages.yml`. Pages stages only the current page, its assets and the availability/compact connection JSON files; it does not upload legacy journey exports. No backend or API keys are needed. Map tiles need an internet connection. Leaflet and fonts are self-hosted with their licences.

## Data sources

- [TfL historical cycle hire journey CSVs](https://cycling.data.tfl.gov.uk/) — weekly/fortnightly extracts from September 2015. Direct public S3 listing: `https://s3-eu-west-1.amazonaws.com/cycling.data.tfl.gov.uk/?list-type=2&prefix=usage-stats/` (no authentication).
- [Availability archive: feregrino/london-cycles](https://huggingface.co/datasets/feregrino/london-cycles) — versioned TfL station observations; CC BY-SA 3.0.
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
