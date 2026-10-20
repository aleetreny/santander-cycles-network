# Station map — manual acceptance checks

20 October 2026. Tested by operating the actual in-app browser through CUA: ordinary button clicks, wheel scrolling, coordinate drags, a coordinate click on a Canvas station and keyboard search. No programmatic map calls or scripted page state changes were used to exercise the map.

## Local page, desktop (1515 × 819)

- Repeated + clicks: zoom 12 → 13 → 14 → 15. Repeated − clicks: 15 → 14 → 13 → 12. Verified settled map and DOM-reported camera state.
- Mouse wheel over the map: 12 → 14, then back to 12. Read camera state after the zoom animation settled, rather than during a transition.
- Dragged map: centre changed from 51.521695,-0.125442 to 51.535098,-0.168786. It stayed at the new position.
- Searched Margery and pressed Enter. Opened Margery Street with bikes, free docks, total and disabled spaces, current/source timestamps, September sample counts and hourly profile. Opened the 24-row hourly table and checked values against the published data.
- Returning to the list kept the same zoom/centre. Tested both full/empty rankings: Strata first for no free docks (33% of readings), Portugal Street first for no bikes (52%). Opened Strata's station sheet.
- Ver Londres returned to the station footprint. A direct click on the visible Orchard Place marker opened its sheet without changing the camera (centre 51.501370,-0.116215).
- Temporarily blocked only BikePoint via browser development tooling, reloaded, and verified the explicit dated saved-copy state. Removed the block, clicked Actualizar disponibilidad, and verified a successful current TfL query. No network override was left in place.

## Narrow viewport (390 × 844)

- Map, controls, legend and station search fit without horizontal clipping.
- Tested + and map drag, searched Waterloo and pressed Enter. Waterloo Station 3 opened with 24-hour profile and clear units.
- Scrolled the actual page to availability, chart, busiest/quietest hours and data disclosure. No overlay covers the map or hourly statistics.
- Restored the normal viewport after testing. This is viewport/browser testing, not a claim of physical-device or multi-touch pinch testing.

## Automated data checks

20 Python tests pass, including missing/invalid capacity rejection, UTC→London month boundary, duplicate suppression, balancing hourly dates despite irregular sampling, minimum hourly coverage and published profile ranges/source hashes. JavaScript syntax check passes.

## Production

Pending deployment and the same core manual interactions on the published URL.
