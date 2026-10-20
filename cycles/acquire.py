"""TfL public S3 listing, resumable CSV acquisition, and BikePoint station snapshots."""
from __future__ import annotations
import concurrent.futures as cf
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import quote, urlencode
import xml.etree.ElementTree as ET
import requests

BUCKET = 'https://s3-eu-west-1.amazonaws.com/cycling.data.tfl.gov.uk/'
STATIONS = 'https://api.tfl.gov.uk/BikePoint'
PREFIX = 'usage-stats/'


def discover(session=None, prefix=PREFIX):
    """Use public S3 ListObjectsV2 XML; paginate until continuation token expires."""
    session = session or requests.Session()
    token = None
    found = []
    while True:
        params = {'list-type':'2', 'prefix':prefix, 'max-keys':'1000'}
        if token:
            params['continuation-token'] = token
        response = session.get(BUCKET, params=params, timeout=90)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        ns = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
        for item in root.findall('s:Contents', ns):
            def val(field):
                return item.findtext('s:'+field, default='', namespaces=ns)
            key = val('Key')
            if key.lower().endswith(('.csv','.zip')) and 'journey' in key.lower():
                found.append({'key':key, 'size_bytes':int(val('Size')), 'last_modified':val('LastModified'),
                              'etag':val('ETag').strip('"'), 'url':BUCKET+quote(key, safe='/')})
        token = root.findtext('s:NextContinuationToken', default='', namespaces=ns)
        if not token:
            break
    if not found:
        raise RuntimeError('S3 returned no journey CSV/ZIP files. Check bucket listing and filters.')
    return sorted(found, key=lambda x:x['key'])


def refresh_manifest(root:Path):
    files=discover()
    target=root/'data'/'manifest.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({'source':BUCKET, 'prefix':PREFIX, 'files':files}, indent=2))
    print(f'{len(files)} files listed, {sum(x["size_bytes"] for x in files)/1e9:.2f} GB total on TfL S3. Manifest: {target}')
    return files


def _download(entry, root:Path):
    path=(root/'data'/'raw'/entry['key'].removeprefix(PREFIX))
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size == entry['size_bytes']:
        return 'exists', entry['key']
    tmp=path.with_name(path.name+'.part')
    for retry in range(4):
        try:
            # Restart interrupted files rather than append partial content from servers without Range support.
            with requests.get(entry['url'], stream=True, timeout=(20,180)) as r:
                r.raise_for_status()
                with tmp.open('wb') as f:
                    for block in r.iter_content(chunk_size=1024*1024):
                        if block: f.write(block)
            if tmp.stat().st_size != entry['size_bytes']:
                raise IOError(f'Expected {entry["size_bytes"]} bytes, downloaded {tmp.stat().st_size}')
            os.replace(tmp,path)
            return 'downloaded',entry['key']
        except (requests.RequestException, OSError) as exc:
            if retry==3: raise RuntimeError(f'{entry["key"]}: {exc}') from exc
            time.sleep(2**retry)
    return 'failed', entry['key']


def download_all(root:Path, workers=3, limit=None):
    manifest=root/'data'/'manifest.json'
    if not manifest.exists(): raise FileNotFoundError('Run inventory first: python -m cycles inventory')
    records=json.loads(manifest.read_text())['files']
    if limit: records=records[:limit]
    print(f'Downloading/checking {len(records)} source files (max {workers} simultaneous)')
    bad=[]
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        futures={pool.submit(_download,item,root):item['key'] for item in records}
        for n,fut in enumerate(cf.as_completed(futures),start=1):
            try:status,key=fut.result(); print(f'[{n}/{len(records)}] {status}: {key}')
            except Exception as e: bad.append(str(e)); print(f'ERROR: {e}')
    if bad: raise RuntimeError(f'{len(bad)} downloads failed; rerun fetch to retry. Example: {bad[0]}')


def station_snapshot(root:Path):
    r=requests.get(STATIONS,timeout=60);r.raise_for_status();items=r.json()
    if not isinstance(items,list) or not items: raise ValueError('Unexpected BikePoint response')
    target=root/'data'/'stations';target.mkdir(parents=True,exist_ok=True)
    stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
    (target/f'bikepoint_{stamp}.json').write_text(json.dumps(items,indent=2))
    cols=['station_id','name','lat','lon','terminal_name','installed','locked','install_date_ms','removal_date_ms','temporary','nb_bikes','nb_standard_bikes','nb_e_bikes','nb_empty_docks','nb_docks']
    mapping={'TerminalName':'terminal_name','Installed':'installed','Locked':'locked','InstallDate':'install_date_ms','RemovalDate':'removal_date_ms','Temporary':'temporary', 'NbBikes':'nb_bikes','NbStandardBikes':'nb_standard_bikes','NbEBikes':'nb_e_bikes','NbEmptyDocks':'nb_empty_docks','NbDocks':'nb_docks'}
    with (target/'stations_latest.csv').open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=cols);writer.writeheader()
        for item in items:
            prop={mapping[x['key']]:x['value'] for x in item.get('additionalProperties',[]) if x.get('key') in mapping}
            row={'station_id':str(item.get('id','')).replace('BikePoints_',''),'name':item.get('commonName',''), 'lat':item.get('lat'), 'lon':item.get('lon'), **prop}
            writer.writerow({x:row.get(x,'') for x in cols})
    print(f'{len(items)} BikePoint stations saved: {target}/stations_latest.csv')
