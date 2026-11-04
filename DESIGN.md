# Design

Two surfaces. The essay sits on cool map paper (#eef1f0, dark mode #121a27) in Newsreader, with Bricolage Grotesque for headings, numbers and UI. The instrument is always night (#0d1626): stations glow on a dark London with the Thames (#17304f) and parks (#132a26) drawn from OpenStreetMap. One bold element, the instrument. Everything around it stays quiet.

Layout: essay column min(44vw, 600px) on the left, instrument sticky on the right at full height. Under 900 px the instrument is pinned on top (46svh) and the essay scrolls beneath it. Back matter (toolkit, notes) spans the full width after the frame.

Colour jobs:
- Diverging flow: amber #f2a33a = losing bikes or departures, blue #5aa8ff = gaining bikes or arrivals, slate #5b6880 = balanced.
- Categorical (regions, archetypes, roles): validated night steps #3987e5, #d95926, #199e70, #c98500, #d55181, #2f9a2f, #9085e9. With four or more categories on the map, region names are drawn at their centres as secondary encoding.
- Sequential magnitude on night: #24406b → #cfe6ff, or amber #3f2f1c → #ffcf7a for distance and stress.
- Charts on paper use the light/dark token pairs --c1…--c6. Text never takes series colour.

Motion: one orchestrated moment, the animated working day (half an hour per second, sparks along the busiest links). Layout morphs between geography, flow space, force and spectral coordinates follow wall-clock time (1.3 s). Reduced motion: no particles, instant morphs, the clock stays paused.

Interaction: drag to pan, ⌘/Ctrl + scroll or the +/− buttons to zoom. Plain scrolling always scrolls the essay. On touch screens the map never captures scrolling. Click a station anywhere to select it, and a pill offers to open it in the explorer. Every chart has a hover layer and a "Show the numbers" table.
