# Data dictionary

## Inputs (ignored by git)

- `data/raw/*.csv`, `data/processed/**/*.parquet`: TfL journey extracts and their normalised Parquet (`trip_id`, `bike_id`, `bike_model`, `started_at`, `ended_at`, `start_station_id`, `end_station_id`, `start_station`, `end_station`, `duration_seconds`, `source_file`). London wall-clock times.
- `data/stations/stations_latest.csv`: BikePoint snapshot (id, name, lat, lon, docks…).
- `data/occupancy/*.csv`: BikePoint occupancy readings, September 2026 (`query_time`, `place_id`, `bikes`, `empty_docks`, `docks`), plus `manifest.json` with the pinned revision and hashes.
- `data/derived/trips.parquet`: one row per matched hire: `a`, `b` (station index), `bike`, `ebike`, `start`, `end`, `day`, `hour`, `minute`, `dow`, `work`, `minutes`, `km`. `stations.parquet`, `trips-report.json` and `cache/*.pkl` hold the chapter results.

## Committed

- `data/osm/*.json`: OpenStreetMap Thames and park geometry (ODbL).
- `site/data/study.json`: every chart and quoted number, by chapter (`summary`, `distributions`, `centrality`, `mixing`, `richClub`, `motifs`, `backbone`, `space`, `communities`, `temporal`, `dynamics`, `robustness`, `layers`, `layerPairs`, `ebikeByKm`, `embedding`, `meta`).
- `site/data/stations.json`: `columns` (one array per measure, 801 entries in station order), `percentiles`, `layouts` (geo / flow / force / spectral, km), `partitions` (Leiden membership per γ; −1 = inactive).
- `site/data/links.json`: `backbone` (α < 0.01: from, to, trips, ⌊−log₁₀ α⌋ to 4 dp, km), `heaviest`, `club`, `corridors` (edges and gaps with model predictions and residuals), `relocations`.
- `site/data/pulse.json`: half-hour frames for a typical working and free day: departures and arrivals per station per day, and the busiest links per frame.
- `site/data/profiles.json`: per station, the top 8 partners each way, the 96-value rhythm, September mean bikes by hour, and hourly net flow.
- `site/data/geo.json`: projected, simplified basemap. `version.json`: content hashes for cache busting.
