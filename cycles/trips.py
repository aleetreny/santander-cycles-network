"""Stage 1 of the study: one clean, station-matched table of May 2026 journeys.

python -m cycles.trips
Reads the prepared TfL Parquet extracts and the BikePoint station snapshot, writes
data/derived/trips.parquet and data/derived/stations.parquet plus an audit report.
"""
from __future__ import annotations
from pathlib import Path
from datetime import date
import json
import re
import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
YEAR, MONTH, DAYS = 2026, 5, 31
# England & Wales bank holidays in May 2026 behave like weekend days for cycling.
HOLIDAYS = {date(2026, 5, 4), date(2026, 5, 25)}
EARTH_KM = 6371.0088


def canonical(name) -> str:
    return re.sub(r'[^a-z0-9]', '', str(name).lower())


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    h = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.minimum(1.0, h)))


def working_day(day: date) -> bool:
    return day.weekday() < 5 and day not in HOLIDAYS


def load_stations(root: Path = ROOT) -> pd.DataFrame:
    """Current BikePoint stations whose canonical name is unique (all 801 are)."""
    frame = pd.read_csv(root / 'data/stations/stations_latest.csv', dtype={'station_id': str, 'terminal_name': str})
    frame['key'] = frame['name'].map(canonical)
    if frame['key'].duplicated().any():
        raise ValueError('Ambiguous station names in BikePoint snapshot')
    frame = frame.sort_values('station_id', key=lambda s: s.astype(int)).reset_index(drop=True)
    area = frame['name'].str.split(',').str[-1].str.strip()
    return pd.DataFrame({'id': frame['station_id'], 'name': frame['name'].str.replace(r'\s+,', ',', regex=True).str.strip(),
                         'area': area, 'lat': frame['lat'], 'lon': frame['lon'], 'docks': frame['nb_docks'].astype(int),
                         'key': frame['key']})


def build(root: Path = ROOT):
    stations = load_stations(root)
    lookup = dict(zip(stations['key'], stations.index))
    con = duckdb.connect()
    pattern = str(root / 'data/processed/**/*.parquet').replace("'", "''")
    con.execute(f'''CREATE TEMP TABLE rides AS SELECT * EXCLUDE(rn) FROM (
        SELECT *, row_number() OVER (PARTITION BY trip_id ORDER BY source_file DESC) rn
        FROM read_parquet('{pattern}', union_by_name=true)
        WHERE year(started_at)={YEAR} AND month(started_at)={MONTH})
        WHERE rn=1 AND ended_at >= started_at AND duration_seconds > 0''')
    raw = con.execute('SELECT count(*) FROM rides').fetchone()[0]
    frame = con.execute('''SELECT bike_id, bike_model, start_station, end_station, started_at, ended_at,
        duration_seconds FROM rides''').df()
    con.close()
    frame['a'] = frame['start_station'].map(canonical).map(lookup)
    frame['b'] = frame['end_station'].map(canonical).map(lookup)
    unmatched = frame[frame['a'].isna() | frame['b'].isna()]
    missing_names = pd.concat([unmatched.loc[unmatched['a'].isna(), 'start_station'],
                               unmatched.loc[unmatched['b'].isna(), 'end_station']]).value_counts()
    frame = frame.dropna(subset=['a', 'b']).copy()
    frame['a'] = frame['a'].astype(np.int16)
    frame['b'] = frame['b'].astype(np.int16)
    start = frame['started_at']
    days = start.dt.date
    trips = pd.DataFrame({
        'a': frame['a'], 'b': frame['b'], 'bike': frame['bike_id'].astype(str),
        'ebike': frame['bike_model'].eq('PBSC_EBIKE'),
        'start': start, 'end': frame['ended_at'],
        'day': start.dt.day.astype(np.int8), 'hour': start.dt.hour.astype(np.int8),
        'minute': (start.dt.hour * 60 + start.dt.minute).astype(np.int16),
        'dow': start.dt.day_of_week.astype(np.int8),
        'work': days.map(working_day).astype(bool),
        'minutes': (frame['duration_seconds'] / 60).astype(np.float32),
    })
    lat, lon = stations['lat'].to_numpy(), stations['lon'].to_numpy()
    trips['km'] = haversine_km(lat[trips['a']], lon[trips['a']], lat[trips['b']], lon[trips['b']]).astype(np.float32)
    trips = trips.sort_values(['start', 'a', 'b']).reset_index(drop=True)
    out = root / 'data/derived'
    out.mkdir(parents=True, exist_ok=True)
    trips.to_parquet(out / 'trips.parquet', index=False)
    stations.to_parquet(out / 'stations.parquet', index=False)
    calendar_days = [date(YEAR, MONTH, d) for d in range(1, DAYS + 1)]
    report = {
        'period': f'{YEAR}-{MONTH:02d}', 'calendarDays': DAYS,
        'workingDays': sum(map(working_day, calendar_days)),
        'nonWorkingDays': DAYS - sum(map(working_day, calendar_days)),
        'holidays': sorted(d.isoformat() for d in HOLIDAYS),
        'validJourneys': int(raw), 'matchedJourneys': int(len(trips)),
        'matchedShare': round(len(trips) / raw, 6), 'unmatchedJourneys': int(raw - len(trips)),
        'unmatchedNames': {k: int(v) for k, v in missing_names.items()},
        'stations': int(len(stations)), 'bikes': int(trips['bike'].nunique()),
        'ebikeJourneys': int(trips['ebike'].sum()),
        'datesObserved': int(trips['day'].nunique()),
    }
    if report['datesObserved'] != DAYS:
        raise ValueError('Incomplete month in prepared extracts')
    (out / 'trips-report.json').write_text(json.dumps(report, indent=2))
    return trips, stations, report


if __name__ == '__main__':
    print(json.dumps(build()[2], indent=2))
