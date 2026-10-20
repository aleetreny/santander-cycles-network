# Simple station map

Map left, 350px station column right. On a phone the map comes first, with the station sheet below. Public Sans, white background, thin separators. Standard OpenStreetMap street geography. Teal means bikes and docks available, red no bikes, ochre no docks; grey means unavailable or unreliable data.

Use normal Leaflet camera behaviour. No selection-driven zoom, zoom callbacks that reposition the camera, moving overlay cards or layout changes on marker selection. A search result may centre its station. Resize invalidation happens only when the map dimensions actually change.

Every number has a unit: bikes, free docks, total spaces, readings or a clearly labelled percentage of observed consultations. A small 24-hour bar chart shows mean available bikes with a plain explanation and an optional table. Fullest/emptiest average hours and the largest mean increase are shown with actual counts.

Focus states, keyboard search, reduced motion, loading/error states and honest fallback timestamps are required. Keep the screen simple; methodological detail stays in a small disclosure.
