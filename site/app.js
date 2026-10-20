const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('en-GB').format(n);
const pct = (n, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette = ['#c64735','#267b76','#5e65a6','#a77723','#ac5781','#347fa5','#687c34','#86614b','#3d7596','#935d80'];
const area = (s) => s.name.includes(',') ? s.name.split(',').at(-1).trim() : 'London';
const shortName = (s) => s.name.split(',')[0];
const initial = new URLSearchParams(location.search);
const state = {day:['all','weekday','weekend'].includes(initial.get('days')) ? initial.get('days') : 'all', time:['all','am','pm'].includes(initial.get('time')) ? initial.get('time') : 'all', mode:initial.get('colour') === 'communities' ? 'communities' : 'activity', selected:null, direction:'out', limit:80, rank:'activity'};
let meta, stations, edges = [], activity = [], arrivals = [], departures = [], partners = [], map, nodes, flows, markers = [], labels = [], activeRequest = 0, tileErrors = 0;
const cache = new Map();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function readJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json();
}
function syncURL() {
  const q = new URLSearchParams();
  if (state.day !== 'all') q.set('days',state.day);
  if (state.time !== 'all') q.set('time',state.time);
  if (state.mode !== 'activity') q.set('colour',state.mode);
  if (state.selected !== null) q.set('station',stations[state.selected].id);
  history.replaceState(null,'',`${location.pathname}${q.size ? '?' + q : ''}${location.hash}`);
}
function status(message, retry = false) {
  $('map-status').textContent = message;
  if (retry) {
    const button = document.createElement('button'); button.textContent = 'Try again';
    button.onclick = () => meta ? loadSegment() : location.reload();
    $('map-status').append(' ',button);
  }
}
function initMap() {
  map = L.map('map',{zoomControl:false, minZoom:10, maxZoom:18, zoomSnap:.5, scrollWheelZoom:true, attributionControl:true});
  L.control.zoom({position:'topright'}).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  tiles.on('tileerror',() => { if (++tileErrors === 5) status('The street map is unavailable. Station locations and connections still work.'); });
  tiles.on('load',() => { if (tileErrors < 5 && edges.length) status(''); });
  map.createPane('flows'); map.getPane('flows').style.zIndex = 410;
  map.createPane('stations'); map.getPane('stations').style.zIndex = 430;
  flows = L.layerGroup().addTo(map); nodes = L.layerGroup().addTo(map);
  map.on('zoomend',resizeNodes);
  resetView();
  $('reset-view').onclick = resetView;
}
function resetView() {
  if (!stations) return;
  map.fitBounds(stations.map(s => [s.lat,s.lon]),{padding:[30,30],animate:!reduced});
}
function calculate() {
  arrivals = Array(stations.length).fill(0); departures = Array(stations.length).fill(0);
  partners = stations.map(() => new Set());
  for (const [a,b,w] of edges) {
    departures[a] += w; arrivals[b] += w;
    if (a !== b) { partners[a].add(b); partners[b].add(a); }
  }
  activity = arrivals.map((n,i) => n + departures[i]);
}
function nodeColour(i) { return state.mode === 'communities' && stations[i].community >= 0 ? palette[stations[i].community % palette.length] : '#c64735'; }
function tooltip(i) {
  const div = document.createElement('div');
  const title = document.createElement('strong'); title.textContent = stations[i].name;
  const text = document.createElement('span'); text.textContent = `${fmt(departures[i])} departures · ${fmt(arrivals[i])} arrivals`;
  div.append(title,text); return div;
}
function curve(a,b) {
  const p = stations[a], q = stations[b];
  const dx = q.lon - p.lon, dy = q.lat - p.lat;
  const bend = .10;
  const cx = (p.lon + q.lon)/2 - dy*bend*1.6;
  const cy = (p.lat + q.lat)/2 + dx*bend*.63;
  return Array.from({length:17},(_,j) => {const t=j/16;return [(1-t)**2*p.lat+2*(1-t)*t*cy+t*t*q.lat,(1-t)**2*p.lon+2*(1-t)*t*cx+t*t*q.lon];});
}
function visibleEdges() {
  let list = edges.filter(([a,b]) => a !== b);
  if (state.selected !== null) list = list.filter(([a,b]) => state.direction === 'out' ? a === state.selected : b === state.selected);
  return list.slice(0,state.limit);
}
function nodeRadius(volume, maximum) {
  const scale = Math.min(1,Math.max(.42,(map.getZoom()-9)/3));
  return (2.5+6.5*Math.sqrt(volume/maximum))*scale;
}
function resizeNodes() {
  const maximum=Math.max(1,...activity);
  markers.forEach((m,i)=>m.setRadius(state.selected===i?10:nodeRadius(activity[i],maximum)));
}
function drawMap() {
  flows.clearLayers(); nodes.clearLayers(); markers = [];
  const shown = visibleEdges(); const maxWeight = Math.max(1,...shown.map(e => e[2]));
  const neighbours = new Set(shown.flatMap(([a,b]) => [a,b]));
  for (const [a,b,w] of shown) {
    const line = L.polyline(curve(a,b),{pane:'flows',color:state.selected === null ? nodeColour(a) : '#c64735',weight:.6+3.4*Math.sqrt(w/maxWeight),opacity:state.selected === null ? .29 : .62,smoothFactor:.6});
    const div=document.createElement('div'); div.textContent=`${stations[a].name} → ${stations[b].name}: ${fmt(w)} journeys`;
    line.bindTooltip(div,{sticky:true}).addTo(flows);
    if (state.selected !== null) {
      const path = line.getElement();
      if (path) {
        const svg=path.ownerSVGElement;
        if (!svg.querySelector('#direction-arrow')) {
          const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
          defs.innerHTML='<marker id="direction-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#c64735" stroke="none"/></marker>';
          svg.prepend(defs);
        }
        path.setAttribute('marker-end','url(#direction-arrow)');
      }
    }
  }
  const maximum=Math.max(1,...activity);
  // Paint busy stations last, keeping hubs visible over nearby low-volume docks.
  const order=stations.map((_,i)=>i).sort((a,b)=>activity[a]-activity[b]);
  for (const i of order) {
    const s=stations[i], selected=state.selected===i;
    const faded=state.selected!==null && !neighbours.has(i) && !selected;
    const marker=L.circleMarker([s.lat,s.lon],{pane:'stations',radius:selected ? 10 : nodeRadius(activity[i],maximum),color:selected ? '#172c3d':'#ffffff',weight:selected ? 2.5:.85,fillColor:activity[i]===0 ? '#82929d':nodeColour(i),fillOpacity:faded ? .24: .85,opacity:faded ? .45:1});
    marker.bindTooltip(tooltip(i),{direction:'top',offset:[0,-3]}).on('click',()=>selectStation(i)).addTo(nodes);
    markers[i]=marker;
  }
  if (state.selected!==null) markers[state.selected].bringToFront();
  $('edge-caption').textContent = state.selected===null ? `${fmt(shown.length)} strongest links · all stations shown` : `${fmt(shown.length)} ${state.direction==='out'?'outgoing':'incoming'} links · arrow shows direction`;
  $('community-key').hidden = state.mode !== 'communities';
  $('activity-mode').classList.toggle('selected',state.mode==='activity');
  $('community-mode').classList.toggle('selected',state.mode==='communities');
  $('activity-mode').setAttribute('aria-pressed',String(state.mode==='activity'));
  $('community-mode').setAttribute('aria-pressed',String(state.mode==='communities'));
}
function renderSummary() {
  const stats=meta.stats[`${state.day}-${state.time}`];
  $('journey-total').textContent=fmt(stats.journeys);
  $('station-total').textContent=fmt(stations.length);
  $('connection-total').textContent=fmt(stats.edges);
  $('period-label').textContent=`1–${meta.days} ${meta.period} · snapshot`;
  $('coverage-number').textContent=pct(meta.coverage);
  $('coverage-link').title='Monthly journey matching coverage. Read the methodology.';
}
function renderRanking() {
  const score=state.rank==='degree' ? partners.map(x=>x.size) : activity;
  const ranked=stations.map((_,i)=>i).sort((a,b)=>score[b]-score[a]||a-b).slice(0,5);
  const max=Math.max(1,...score);
  $('station-ranking').innerHTML=ranked.map((i,n)=>`<li><button class="station-row" data-station="${i}"><span class="rank-index">${String(n+1).padStart(2,'0')}</span><span class="station-row-name">${esc(shortName(stations[i]))}<small>${esc(area(stations[i]))}</small></span><span class="station-row-value">${fmt(score[i])}</span><span class="station-bar" style="--share:${score[i]/max*80}%"></span></button></li>`).join('');
  $('ranking-description').textContent=state.rank==='degree' ? 'Distinct other stations, in either direction' : 'Arrivals + departures in this period';
  document.querySelector('.section-head h2').textContent=state.rank==='degree' ? 'The most connected' : 'The busiest stations';
}
function renderStation() {
  const chosen=state.selected!==null;
  $('station-panel').hidden=!chosen; $('ranking-panel').hidden=chosen;
  if (!chosen) return;
  const i=state.selected,s=stations[i];
  const routes=edges.filter(([a,b])=>a!==b&&(state.direction==='out'?a===i:b===i));
  const loops=edges.find(([a,b])=>a===i&&b===i)?.[2]||0;
  $('station-panel').innerHTML=`<button class="back-button" id="clear-station">← All stations</button><h2 class="station-title">${esc(shortName(s))}</h2><p class="station-area">${esc(area(s))} · station ${esc(s.id)}</p><div class="station-metrics"><div><strong>${fmt(departures[i])}</strong><span>departures</span></div><div><strong>${fmt(arrivals[i])}</strong><span>arrivals</span></div><div><strong>${fmt(partners[i].size)}</strong><span>other stations</span></div><div><strong>${fmt(loops)}</strong><span>same-station returns</span></div></div><div class="direction-switch" aria-label="Journey direction"><button data-direction="out" class="${state.direction==='out'?'active':''}" aria-pressed="${state.direction==='out'}">Leaving here</button><button data-direction="in" class="${state.direction==='in'?'active':''}" aria-pressed="${state.direction==='in'}">Arriving here</button></div><ol class="route-list">${routes.slice(0,6).map(([a,b,w])=>`<li><button class="route-row" data-station="${state.direction==='out'?b:a}" title="Explore this station"><span>${esc(stations[state.direction==='out'?b:a].name)}</span><strong>${fmt(w)}</strong></button></li>`).join('')}</ol><p class="station-note">${routes.length ? `Top ${Math.min(6,routes.length)} of ${fmt(routes.length)} directed connections. Numbers count recorded journeys in the selected period.` : 'No matched journeys to other stations in this period. Try every day and all hours.'}</p>`;
  $('clear-station').onclick=()=>clearStation();
}
function selectStation(i,pan=true) {
  state.selected=i; $('station-search').value=''; $('search-results').replaceChildren();
  renderStation(); drawMap();syncURL();
  if(pan) map.panTo([stations[i].lat,stations[i].lon],{animate:!reduced});
  // Bring the detail into view after choosing a map node on a narrow screen.
  if(matchMedia('(max-width:760px)').matches) $('station-panel').scrollIntoView({behavior:reduced?'instant':'smooth',block:'nearest'});
}
function clearStation() {state.selected=null;renderStation();drawMap();syncURL();}
async function loadSegment() {
  const request=++activeRequest,key=`${state.day}-${state.time}`;
  status('Loading this part of the network…');
  try {
    if(!cache.has(key)) cache.set(key,await readJSON(`./data/${key}.json`));
    if(request!==activeRequest) return;
    edges=cache.get(key);calculate();renderSummary();renderRanking();renderStation();drawMap();syncURL();status('');
    if(!edges.length) status('No journeys in this selection. Try different days or hours.');
  } catch(error) {if(request===activeRequest) status('Journey data could not be loaded. Check your connection.',true);console.error(error);}
}
function search() {
  const q=$('station-search').value.trim().toLocaleLowerCase();
  if(!q) {$('search-results').replaceChildren();return;}
  const found=stations.map((s,i)=>({s,i})).filter(({s})=>s.name.toLocaleLowerCase().includes(q)||s.id===q).slice(0,7);
  $('search-results').innerHTML=found.length ? found.map(({s,i})=>`<button class="search-result" data-station="${i}">${esc(s.name)}</button>`).join('') : '<p class="search-empty">No station found. Try a street, area or station ID.</p>';
}
function showStudy(open) {
  $('explorer').hidden=open; $('study').hidden=!open;
  $('study-tab').classList.toggle('active',open);$('map-tab').classList.toggle('active',!open);
  $('study-tab').setAttribute('aria-pressed',String(open));$('map-tab').setAttribute('aria-pressed',String(!open));
  history.replaceState(null,'',`${location.pathname}${location.search}${open?'#study':''}`);
  window.scrollTo(0,0);
  if(open) $('study').focus({preventScroll:true}); else {map.invalidateSize();$('map-tab').focus({preventScroll:true});}
}
function buildStudy() {
  const total=meta.stats['all-all'];
  const allActivity=Array(stations.length).fill(0);
  for(const [a,b,w] of cache.get('all-all')) {allActivity[a]+=w;allActivity[b]+=w;}
  labels=Array.from({length:meta.communityCount},(_,c)=>{
    const members=stations.map((s,i)=>({s,i})).filter(({s})=>s.community===c).sort((a,b)=>allActivity[b.i]-allActivity[a.i]);
    return {name:area(members[0].s),members:members.length,activity:members.reduce((n,{i})=>n+allActivity[i],0)};
  });
  $('community-key').innerHTML=labels.map((c,i)=>`<span class="community-item"><i style="background:${palette[i%palette.length]}"></i>${esc(c.name)}</span>`).join('');
  const top=total.topStations.slice(0,5);
  const hourMax=Math.max(...meta.hoursPerDay.weekday,...meta.hoursPerDay.weekend);
  const peak=meta.hoursPerDay.weekday.indexOf(Math.max(...meta.hoursPerDay.weekday));
  const peakEnd=meta.hoursPerDay.weekend.indexOf(Math.max(...meta.hoursPerDay.weekend));
  const r=meta.resilience;
  $('study').innerHTML=`<button class="back-button" id="return-map">← Back to the map</button><div class="study-top"><div><h1>What holds London’s<br>cycle network together?</h1><p class="study-lead">Every hire joins two places. Together, ${fmt(meta.mappedJourneys)} mapped journeys reveal the hubs, local neighbourhoods and daily rhythms of a shared transport network.</p></div><div class="study-stamp"><strong>${esc(meta.period)}</strong><span>${meta.days} days · ${fmt(stations.length)} stations<br>Independent complex networks project</span></div></div>
  <section class="study-section"><div><h2>Busy hubs, but no single dominant station.</h2><p class="finding">The ten busiest stations account for <strong>${pct(total.topTenShare)}</strong> of all recorded arrivals and departures.</p><p>A station’s <strong>strength</strong> counts its arrivals plus departures. Its <strong>degree</strong> counts the distinct other stations it connects to. A busy station and a well-connected station tell different stories: one handles many hires; the other reaches many places.</p><p>The strongest hub this month is <strong>${esc(stations[top[0]].name)}</strong>, with ${fmt(allActivity[top[0]])} journey endpoints. A same-station return contributes one departure and one arrival.</p></div><figure><table><caption class="sr-only">Five busiest stations by recorded arrivals and departures</caption><thead><tr><th>Station</th><th>Activity</th></tr></thead><tbody>${top.map(i=>`<tr><td>${esc(stations[i].name)}</td><td>${fmt(allActivity[i])}</td></tr>`).join('')}</tbody></table><figcaption>All matched journeys, ${esc(meta.period)}. Counting endpoints means a journey contributes to both its origin and destination.</figcaption></figure></section>
  <section class="study-section"><div><h2>The city has local networks within it.</h2><p class="finding">The network separates into <strong>${meta.communityCount} groups</strong> of stations with dense internal journey flows.</p><p>Louvain community detection groups stations by observed travel patterns, without using their coordinates. We add the two directional weights for each pair and omit same-station returns. Modularity is <strong>${meta.modularity.toFixed(3)}</strong>, a measure of within-group structure relative to a degree-based baseline.</p><p>Switch to <button class="inline-map-link" id="study-communities">Communities on the map ↗</button> to see the groups. Names below describe the area of each group’s busiest station; they are not administrative boundaries. Colours use the full-month partition even when you filter the map.</p></div><figure><table class="community-table"><caption class="sr-only">Detected communities</caption><thead><tr><th>Group centred on</th><th>Stations</th><th>Activity share</th></tr></thead><tbody>${labels.map((g,i)=>`<tr><td><span class="swatch" style="background:${palette[i%palette.length]}"></span>${esc(g.name)}</td><td>${g.members}</td><td>${pct(g.activity/(2*total.journeys))}</td></tr>`).join('')}</tbody></table><figcaption>Weighted Louvain, resolution 1, seed 42. Descriptive groups, not proof of a unique or permanent partition.</figcaption></figure></section>
  <section class="study-section"><div><h2>A different rhythm at the weekend.</h2><p class="finding">The busiest weekday start hour is <strong>${String(peak).padStart(2,'0')}:00–${String(peak+1).padStart(2,'0')}:00</strong>. At the weekend, the peak is <strong>${String(peakEnd).padStart(2,'0')}:00–${String(peakEnd+1).padStart(2,'0')}:00</strong>.</p><p>These are <strong>journeys per hour per day</strong>, so the comparison adjusts for the different number of weekdays and weekend days. The profile is consistent with different travel routines, but trip purpose is not recorded.</p><p>Use the map’s day and start-time filters to compare the actual connections. Morning covers 07:00–09:59; evening covers 16:00–18:59, in local London time. Bank holidays count as weekdays.</p></div><figure><div class="hour-chart" role="img" aria-label="Average hourly journeys per day. Weekdays peak at ${peak}:00; weekends peak at ${peakEnd}:00.">${Array.from({length:24},(_,h)=>`<div class="hour-pair" title="${h}:00 — weekday ${fmt(meta.hoursPerDay.weekday[h])}, weekend ${fmt(meta.hoursPerDay.weekend[h])}"><i style="--h:${meta.hoursPerDay.weekday[h]/hourMax*100}%"></i><i style="--h:${meta.hoursPerDay.weekend[h]/hourMax*100}%"></i>${h%6===0?`<span>${String(h).padStart(2,'0')}</span>`:''}</div>`).join('')}</div><div class="chart-key"><span><i></i>Weekday</span><span><i></i>Weekend</span></div><figcaption>Mean matched departures per day, by local start hour. Full hourly values are included in the downloadable analysis JSON.</figcaption></figure></section>
  <section class="study-section"><div><h2>What if the busiest stations disappeared?</h2><p class="finding">Removing the busiest 10% of active stations leaves <strong>${pct(r.targetedRetained)}</strong> of observed journeys with both endpoints intact. Removing the same number at random retains <strong>${pct(r.randomRetained)}</strong>, on average.</p><p>This is a simple <strong>static stress test</strong>: remove ${r.removed} stations, then count trips between the remaining stations. The targeted set is ranked once by full-month activity. The random comparison averages 100 reproducible samples.</p><p>It measures the concentration of observed demand. It does not predict lost travel: people may use another dock, change route or choose another mode. No rerouting is modelled.</p></div><figure><div class="resilience-bars"><div><div class="resilience-label"><span>Busiest stations removed</span><strong>${pct(r.targetedRetained)}</strong></div><div class="resilience-track"><i style="--share:${pct(r.targetedRetained)}"></i></div></div><div><div class="resilience-label"><span>Random stations removed</span><strong>${pct(r.randomRetained)}</strong></div><div class="resilience-track random"><i style="--share:${pct(r.randomRetained)}"></i></div></div></div><figcaption>Share of recorded journeys retained. Random sample range: ${pct(r.randomMin)}–${pct(r.randomMax)}. This range describes the 100 samples, not a confidence interval.</figcaption></figure></section>
  <section class="study-section methods" id="methods"><div><h2>How this atlas was made.</h2><p>Nodes are docking stations returned by the <a href="https://api.tfl.gov.uk/BikePoint">TfL BikePoint API</a>. A directed edge A → B exists when at least one recorded hire starts at A and ends at B. Its weight is the number of hires. These are journeys, not unique people, and the curved lines are origin–destination links, not GPS routes.</p><h3>Coverage and cleaning</h3><p>Two <a href="https://cycling.data.tfl.gov.uk/">official TfL extracts</a> cover ${meta.start} to ${meta.end}. After normalization, identifier deduplication and positive-duration/time checks, ${fmt(meta.validJourneys)} journeys remain. ${fmt(meta.mappedJourneys)} (${pct(meta.coverage,2)}) have both endpoints matched to a current station; ${fmt(meta.unmappedJourneys)} are excluded from the map and graph.</p><p>All ${fmt(stations.length)} available current stations are drawn, including those with no matched journeys in the selected period (grey). Historical station names must match an unambiguous normalized current name; matching IDs alone never override a name mismatch. Current coordinates can differ from historic locations. Station snapshot: <strong>${esc(meta.stationSnapshot)}</strong> (UTC).</p><h3>What the map leaves out</h3><p>The default shows only the 80 strongest non-return links to keep the map readable. The slider changes the displayed links; it never changes counts or network measures. Selecting a station shows its strongest incoming or outgoing links. Circle radius follows 2.5 + 6.5 × √(activity / maximum activity); its base radius keeps every station visible. Radii shrink at wider zoom levels to reduce overlap. Same-station returns stay in activity totals but are excluded from links, degree, density, reciprocity and communities.</p><h3>The graph, in numbers</h3><p>${fmt(total.active)} stations have a connection to another station. There are ${fmt(total.edges)} distinct directed links, a directed density of ${pct(total.density,2)}, and ${pct(total.reciprocity)} of directed links have a reverse link (regardless of its weight). The largest weakly connected component contains ${fmt(total.largestComponent)} stations.</p><h3>Limits of the study</h3><p>One month is a snapshot, not a seasonal trend. Weather, dock capacity, station closures, electric bikes and operator redistribution can influence the pattern. The study is descriptive: it cannot establish why someone travelled or whether a station caused demand. Exact communities depend on algorithm and resolution.</p></div><div><h2>Take the data with you.</h2><p>Compact aggregates, source checksums, analysis settings and software versions. Raw trip-level records stay with TfL.</p><div class="download-links"><a href="./data/stations.csv" download>Station coordinates + groups <span>CSV ↓</span></a><a href="./data/flows.csv" download>Full monthly directed network <span>CSV ↓</span></a><a href="./data/meta.json" download>Analysis, hours + provenance <span>JSON ↓</span></a><a href="./data/unmatched-stations.csv" download>Unmatched historical stations <span>CSV ↓</span></a><a href="https://github.com/aleetreny/santander-cycles-network">Code + reproduction instructions <span>↗</span></a></div><p>Flow CSV endpoints reference zero-based row indices in the station CSV. The website runs as a static GitHub Pages site. Map tiles need an internet connection. Journey data are a pinned snapshot, not live availability.</p><p><a href="https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service">TfL data terms</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a></p></div></section><p class="credit">Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016; Geomni UK Map data © and database rights 2019. Independent educational project; not an official TfL or Santander product. Code: MIT. Data rights remain with their owners.</p>`;
  $('return-map').onclick=()=>showStudy(false);
  $('study-communities').onclick=()=>{setMode('communities');showStudy(false);};
}
function setMode(mode) {state.mode=mode;drawMap();syncURL();}
function bindControls() {
  $('day-filter').value=state.day;$('time-filter').value=state.time;
  $('day-filter').onchange=e=>{state.day=e.target.value;loadSegment();};
  $('time-filter').onchange=e=>{state.time=e.target.value;loadSegment();};
  $('activity-mode').onclick=()=>setMode('activity');$('community-mode').onclick=()=>setMode('communities');
  $('edge-limit').oninput=e=>{state.limit=Number(e.target.value);$('edge-output').value=state.limit;drawMap();};
  $('rank-by').onchange=e=>{state.rank=e.target.value;renderRanking();};
  $('station-search').oninput=search;
  $('station-search').onkeydown=e=>{if(e.key==='Enter') {const first=$('search-results').querySelector('[data-station]');if(first){e.preventDefault();selectStation(Number(first.dataset.station));$('clear-station').focus();}}};
  document.addEventListener('keydown',e=>{if(e.key==='/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('station-search').focus();}if(e.key==='Escape'){$('search-results').replaceChildren();$('station-search').value='';}});
  document.addEventListener('click',e=>{
    const target=e.target.closest('[data-station]');if(target)selectStation(Number(target.dataset.station));
    const direction=e.target.closest('[data-direction]');if(direction){state.direction=direction.dataset.direction;renderStation();drawMap();document.querySelector(`[data-direction="${state.direction}"]`)?.focus();}
    if(!e.target.closest('.search-wrap'))$('search-results').replaceChildren();
  });
  $('legend-toggle').onclick=()=>{const open=$('legend-body').hidden;$('legend-body').hidden=!open;$('legend-toggle').textContent=open?'−':'+';$('legend-toggle').setAttribute('aria-expanded',String(open));$('legend-toggle').setAttribute('aria-label',`${open?'Collapse':'Expand'} map legend`);};
  $('study-tab').onclick=()=>showStudy(true);$('study-link').onclick=()=>showStudy(true);$('coverage-link').onclick=()=>{showStudy(true);$('methods').scrollIntoView();};$('map-tab').onclick=()=>showStudy(false);
}
async function start() {
  try {
    [meta,stations]=await Promise.all([readJSON('./data/meta.json'),readJSON('./data/stations.json')]);
    if(typeof L==='undefined')throw new Error('Map library failed to load');
    cache.set('all-all',await readJSON('./data/all-all.json'));
    initMap();bindControls();buildStudy();await loadSegment();
    const requested=stations.findIndex(s=>s.id===initial.get('station'));
    if(requested>=0)selectStation(requested);
    if(location.hash==='#study')showStudy(true);
  } catch(error) {status('The atlas could not be loaded. Check your connection and try again.',true);console.error(error);}
}
start();
