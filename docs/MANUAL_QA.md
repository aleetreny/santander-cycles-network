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

Published app commit `783a828` at https://aleetreny.github.io/santander-cycles-network/. Pages run `39448734794` and data checks run `39448734852` both succeeded.

Repeated the core checks by hand on the public page: + from 12→13→14→15, − back to 12, wheel 12→14→12, and drag from centre 51.515046,-0.129948 to 51.544093,-0.230198. Search/Enter opened Waterloo Station 3 with actual TfL availability and the correct September hourly profile. Both ranking modes displayed the expected first stations; Strata opened with 33% of readings without free docks.

At 390×844, searched Margery Street, opened the sheet, tested +/− and drag, and scrolled the full station statistics. Restored the normal viewport and checked the final desktop view. No browser JavaScript errors were reported. Explicitly reloaded the user's other existing tab, which had retained the old atlas, and verified the new Spanish map. Saved the public-page screenshot locally to `artifacts/simple-production.png`.


## Typical connections restored — 20 October 2026

The simple map now retains five typical routes for the selected station. The new independent graph check reconstructs every station's top five incoming/outgoing routes from the complete pinned May edge list and compares the compact export, excluding self-return trips. 21 Python tests and the JavaScript syntax check pass. The connection summary is 160,939 bytes, loaded only after a station is selected.

Manual local browser checks: Pancras Road shows five outgoing lines, five numbered pins and the exact top counts (42 trips to Bonny Street). Changing to incoming shows 43 trips from Bonny Street. Selecting a route preserves Pancras Road and the unchanged camera (zoom 12, centre 51.515000,-0.130000). Tested +/− and the mouse wheel with connections visible, map dragging and the explicit route framing button. Incoming and outgoing directions have static arrowheads. Row and pin selections highlight the matching route. Returning to all stations clears all route paths. Searching Margery then shows its own routes (30 trips to Guilford Street), with no leftover Pancras routes.

Narrow viewport test (390×844 browser override, with the user's existing browser zoom): all five numbered endpoints fit after the framing action; pressing the framing button or selecting a route row returns to the map. Incoming rows preserve the selected station. Tooltip width is bounded to 250px and wraps into readable lines rather than a narrow column. Restored the viewport afterward. No JavaScript errors reported.

Published app commit `3c5ccb8`; Pages run `39466726710` and data checks run `39466726657` succeeded. Manually verified the public Pancras Road page: five incoming lines and 43 trips from Bonny Street; route focus kept the station and zoom 12 / centre 51.515000,-0.130000. Zoom buttons cycled 12→13→14→13→12. Mouse wheel zoomed to 13, and dragging changed the centre from 51.528664,-0.133773 to 51.543399,-0.174494 without changing zoom. Outgoing mode restored the five correct destinations and 42 trips to Bonny Street. At the narrow viewport, the framing button revealed all five connections and clicking incoming pin 1 showed the exact route/count tooltip while retaining Pancras Road. Restored the viewport, explicitly reloaded the two other old tabs, and saved `artifacts/connections-production.png`. No JavaScript errors reported.

Also manually blocked only the compact route JSON locally: the route section showed an error and Reintentar, while availability remained available. Removed the network block and clicked Reintentar; the actual routes loaded successfully. No network block or viewport override remains.
