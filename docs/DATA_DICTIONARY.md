# Data dictionary

`data/manifest.json`: source key, download URL, size (bytes), last modified, ETag.

`data/stations/stations_latest.csv`: `station_id` (BikePoint ID, not necessarily historical ID), `name`, `lat`, `lon`, `terminal_name`, dock capacity and available bicycles at snapshot time. Full raw JSON is timestamped.

`data/processed/**/*.parquet`: one row per journey occurrence in an original file with `trip_id`, `bike_id`, `bike_model`, `started_at`, `ended_at`, `start_station_id`, `end_station_id`, `start_station`, `end_station`, `duration_seconds`, `source_file`. Timestamps are London wall clock, timezone-naive. Duplicate trip IDs can still appear across source files; aggregation deduplicates them.

`outputs/od_edges_all.csv`: aggregate directed OD pairs, names, counts, average duration; includes unlocated stations.

`outputs/edges.csv`: the same pairs plus origin and destination coordinates (NA if unmatched).

`outputs/nodes.csv`: unique origin or destination station ID, latest-used name, coordinates when high-confidence match exists, `arrivals`, `departures`, `net_inflow`, `match_method`.

`outputs/quality.txt`: total hires counted, geocoded share of trips, and unmatched station count.
