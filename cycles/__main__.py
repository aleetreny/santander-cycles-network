"""Usage: python -m cycles {inventory,fetch,stations,prepare,trips,build,all}."""
import argparse
from pathlib import Path
from . import acquire, prepare


def main():
    p = argparse.ArgumentParser(description='Santander Cycles complex-network study')
    p.add_argument('command', choices=['inventory', 'fetch', 'stations', 'prepare', 'trips', 'build', 'all'])
    p.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument('--limit', type=int, help='Number of CSV files, for a first smoke test')
    p.add_argument('--workers', type=int, default=3)
    p.add_argument('--fresh', action='store_true', help='Recompute every chapter instead of reusing the cache')
    a = p.parse_args()
    root = a.root.resolve()
    if a.command in ('inventory', 'all'):
        acquire.refresh_manifest(root)
    if a.command in ('fetch', 'all'):
        acquire.download_all(root, workers=a.workers, limit=a.limit)
    if a.command in ('stations', 'all'):
        acquire.station_snapshot(root)
    if a.command in ('prepare', 'all'):
        prepare.convert(root, limit=a.limit)
    if a.command in ('trips', 'all'):
        from .trips import build
        build(root)
    if a.command in ('build', 'all'):
        from .build import main as build_site
        build_site(a.fresh or a.command == 'all')


if __name__ == '__main__':
    main()
