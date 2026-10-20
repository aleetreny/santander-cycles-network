const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = new Intl.NumberFormat('es-ES');
const percent = value => value > 0 && value < .01 ? '<1%' : value > .99 && value < 1 ? '>99%' : `${Math.round(value * 100)}%`;
const clock = value => new Intl.DateTimeFormat('es-ES', {timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const stamp = value => new Intl.DateTimeFormat('es-ES', {timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const small = value => Number(value).toLocaleString('es-ES',{maximumFractionDigits:1});
const shortName = station => station.name.split(',')[0].trim();
let map, renderer, selected = null, previous = null, live = null, history = null, mode = 'current', limit = 40, isLive = false, historyFailed = false;
let connections=null, connectionsRequest=null, connectionsFailed=false, routeDirection='out', focusedRoute=null, routeLayer;
let routeObjects=[];
const markers = new Map();
let stations = [];
const requested = new URLSearchParams(location.search).get('station');

async function readJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}
function valid(s) {
  return s.installed && !s.locked && Number.isInteger(s.bikes) && Number.isInteger(s.free) && Number.isInteger(s.capacity) && s.bikes >= 0 && s.free >= 0 && s.capacity > 0 && s.bikes+s.free > 0 && s.bikes+s.free <= s.capacity;
}
function dockDistance(a,b) {
  const rad=Math.PI/180, x=(b.lat-a.lat)*rad, y=(b.lon-a.lon)*rad;
  return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(x/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(y/2)**2)));
}
function stats(s) {
  const record = history?.stations[s.id];
  return record && dockDistance(s, record) < .15 && record.all?.days >= 14 && record.all.samples >= 100 ? record.all : null;
}
function colour(s) {
  if (mode !== 'current') {
    const p=stats(s);
    if (!p) return '#93a1a9';
    const risk=p[mode];
    return risk >= .3 ? '#bf463d' : risk >= .1 ? '#9b711e' : '#237d8b';
  }
  if (!valid(s)) return '#93a1a9';
  return s.bikes===0 ? '#bf463d' : s.free===0 ? '#9b711e' : '#237d8b';
}
function tooltip(s) {
  const box=document.createElement('div');
  const content=valid(s) ? `${s.bikes} bicis · ${s.free} huecos libres` : 'Sin disponibilidad fiable';
  const p=stats(s);
  box.innerHTML=`<strong>${esc(s.name)}</strong><span>${esc(content)}</span>${mode!=='current' && p ? `<span>${percent(p[mode])} de lecturas ${mode==='empty'?'sin bicis':'sin huecos'} en septiembre</span>` : ''}`;
  return box;
}
function updateMarkers() {
  for (const s of stations) {
    let marker=markers.get(s.id);
    if (!marker) {
      marker=L.circleMarker([s.lat,s.lon],{renderer,radius:5,weight:1,color:'#fff',fillOpacity:.85})
        .bindTooltip(()=>tooltip(stations.find(x=>x.id===s.id)),{direction:'top'})
        .on('click',()=>selectStation(s.id)).addTo(map);
      markers.set(s.id,marker);
    }
    marker.setLatLng([s.lat,s.lon]);
    marker.setStyle({fillColor:colour(s),color:selected===s.id?'#203443':'#fff',weight:selected===s.id?2:1});
    marker.setRadius(selected===s.id?8:5);
  }
  for (const [id,marker] of markers) if (!stations.some(s=>s.id===id)) {map.removeLayer(marker);markers.delete(id);}
}
function initMap() {
  // No zoom listener changes the camera, layout or marker positions.
  map=L.map('map',{zoomControl:false,minZoom:2,maxZoom:19,scrollWheelZoom:true,touchZoom:true,doubleClickZoom:true,keyboard:true}).setView([51.515,-.13],12);
  L.control.zoom({position:'topright',zoomInTitle:'Acercar mapa',zoomOutTitle:'Alejar mapa'}).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  let tileErrors=0;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'})
    .on('tileerror',()=>{if(++tileErrors===4){$('map-message').textContent='No se ha podido cargar el mapa de calles. Las estaciones siguen disponibles.';$('map-message').hidden=false;}}).addTo(map);
  renderer=L.canvas({padding:.3});
  map.createPane('connections').style.zIndex='410';
  routeLayer=L.layerGroup().addTo(map);
  const report=()=>{$('map').dataset.zoom=String(map.getZoom());$('map').dataset.center=`${map.getCenter().lat.toFixed(6)},${map.getCenter().lng.toFixed(6)}`;};
  map.on('moveend',report);report();
  let width=0,height=0,frame;
  new ResizeObserver(entries=>{const r=entries[0].contentRect;if(r.width===width&&r.height===height)return;width=r.width;height=r.height;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>map.invalidateSize({pan:false}));}).observe($('map'));
  $('london').onclick=()=>map.fitBounds(stations.map(s=>[s.lat,s.lon]),{padding:[25,25]});
}
function legend() {
  $('legend').innerHTML=mode==='current'
    ? '<span><i class="empty"></i>Sin bicis</span><span><i class="normal"></i>Con bicis y huecos</span><span><i class="full"></i>Sin huecos</span>'
    : `<span><i class="normal"></i>Menos del 10%</span><span><i class="full"></i>10–30%</span><span><i class="empty"></i>Más del 30% ${mode==='empty'?'sin bicis':'sin huecos'}</span>`;
}
function renderList() {
  let ordered=stations.filter(s=>mode==='current'||stats(s));
  if (mode==='current') ordered.sort((a,b)=>a.name.localeCompare(b.name));
  else ordered.sort((a,b)=>stats(b)[mode]-stats(a)[mode]||a.name.localeCompare(b.name));
  $('list-caption').textContent=mode==='current'?'Pulsa una estación para ver sus trayectos y disponibilidad.':`Septiembre de 2026. Ordenadas por porcentaje de lecturas ${mode==='empty'?'sin bicis':'sin huecos'}.`;
  $('station-list').innerHTML=ordered.slice(0,limit).map(s=>`<li><button class="station" data-station="${esc(s.id)}"><i class="station-dot" style="--status:${colour(s)}"></i><span class="station-name">${esc(shortName(s))}<small>${esc(s.name.split(',').slice(1).join(',').trim())}</small></span><span class="station-value">${mode==='current'?(valid(s)?`${s.bikes} bicis<small>${s.free} huecos libres</small>`:'Sin datos'): `${percent(stats(s)[mode])}<small>de lecturas ${mode==='empty'?'sin bicis':'sin huecos'}</small>`}</span></button></li>`).join('');
  $('more').hidden=ordered.length<=limit;
}
function renderHistory(s) {
  const p=stats(s);
  if (historyFailed) return '<section class="history"><h3>Cómo suele estar</h3><p class="muted">No se pudo cargar el histórico. Recarga la página para reintentar.</p></section>';
  if (!history) return '<section class="history"><h3>Cómo suele estar</h3><p class="muted">Cargando el histórico de disponibilidad…</p></section>';
  if (!p) return '<section class="history"><h3>Cómo suele estar</h3><p class="muted">No hay suficientes lecturas comparables de septiembre para esta estación.</p></section>';
  const usable=p.hours.map((r,h)=>({r,h})).filter(x=>x.r);
  if (!usable.length) return '<section class="history"><h3>Cómo suele estar</h3><p class="muted">No hay suficientes lecturas por hora para esta estación.</p></section>';
  const highest=usable.reduce((a,b)=>a.r[2]>=b.r[2]?a:b);
  const lowest=usable.reduce((a,b)=>a.r[2]<=b.r[2]?a:b);
  const gains=usable.filter(x=>p.hours[(x.h+1)%24]).map(x=>({from:x.h,to:(x.h+1)%24,delta:p.hours[(x.h+1)%24][0]-x.r[0]}));
  const gain=gains.length?gains.reduce((a,b)=>a.delta>=b.delta?a:b):null;
  const spread=highest.r[2]-lowest.r[2];
  const maximum=Math.max(1,...usable.map(x=>x.r[0]));
  return `<section class="history"><h3>Cómo suele estar</h3><p class="period">Septiembre 2026 · ${p.days} días · ${number.format(p.samples)} lecturas</p><div class="history-percent"><div><strong>${percent(p.empty)}</strong><span>de las consultas, sin bicis</span></div><div><strong>${percent(p.full)}</strong><span>de las consultas, sin huecos</span></div></div><div class="hour-chart" role="img" aria-label="Bicis disponibles de media por hora de Londres. Los valores completos están en la tabla.">${p.hours.map((r,h)=>`<div class="hour-bar ${r?'':'missing'}" ${r?`title="${h}:00 · ${small(r[0])} bicis y ${small(r[1])} huecos de media · ${r[3]} días observados"`:''}><i style="--height:${r?r[0]/maximum*100:0}%"></i>${h%6===0?`<span>${String(h).padStart(2,'0')}h</span>`:''}</div>`).join('')}</div><p class="chart-label">Bicis disponibles de media en cada hora. Una barra más alta significa más bicis.</p><dl class="peak-list">${spread>=.05?`<div><dt>Más llena de media</dt><dd>${highest.h}:00 · ${small(highest.r[0])} bicis</dd></div><div><dt>Más vacía de media</dt><dd>${lowest.h}:00 · ${small(lowest.r[0])} bicis</dd></div>`:'<div><dt>Perfil por horas</dt><dd>Sin diferencias claras</dd></div>'}${gain&&gain.delta>=.5?`<div><dt>Mayor subida media</dt><dd>${gain.from}–${gain.to}h · +${small(gain.delta)} bicis</dd></div>`:''}</dl><p class="status-note">Son patrones observados, no una garantía para tu próximo viaje.</p><details class="hour-details"><summary>Ver cifras por hora</summary><table><thead><tr><th>Hora</th><th>Bicis de media</th><th>Huecos de media</th></tr></thead><tbody>${p.hours.map((r,h)=>`<tr><td>${String(h).padStart(2,'0')}:00</td><td>${r?small(r[0]):'Sin datos'}</td><td>${r?small(r[1]):'Sin datos'}</td></tr>`).join('')}</tbody></table></details></section>`;
}

function connectionRecord(station) {
  const record=connections?.stations[station.id];
  return record && dockDistance(station,record)<.15 ? record : null;
}
function connectionPeriod() {
  return connections ? new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(connections.start+'T12:00:00Z')) : '';
}
function loadConnections() {
  if (connections || connectionsRequest) return;
  connectionsFailed=false;
  connectionsRequest=readJSON('./data/connections.json').then(data=>{connections=data;renderDetail();}).catch(()=>{connectionsFailed=true;connectionsRequest=null;renderDetail();});
}
function renderConnections(station) {
  const heading='<h3>Trayectos más habituales</h3>';
  if (connectionsFailed) return `<section class="connections">${heading}<p class="muted">No se pudieron cargar los trayectos.</p><button id="retry-connections" class="text-button">Reintentar</button></section>`;
  if (!connections) return `<section class="connections">${heading}<p class="muted">Cargando los trayectos de esta estación…</p></section>`;
  const record=connectionRecord(station);
  if (!record) return `<section class="connections">${heading}<p class="muted">No hay trayectos comparables para esta ubicación en ${connectionPeriod()}.</p></section>`;
  const rows=record[routeDirection];
  return `<section class="connections">${heading}<p class="period">Viajes registrados · ${connectionPeriod()}</p><div class="route-direction" role="group" aria-label="Sentido de los trayectos"><button data-direction="out" aria-pressed="${routeDirection==='out'}">Salen de aquí</button><button data-direction="in" aria-pressed="${routeDirection==='in'}">Llegan aquí</button></div><p class="route-caption">${routeDirection==='out'?`Desde ${esc(shortName(station))}: los cinco destinos más frecuentes.`:`Hasta ${esc(shortName(station))}: las cinco procedencias más frecuentes.`} Pulsa una fila para destacar su línea.</p><ol class="route-list">${rows.map(([id,trips],i)=>{const other=connections.stations[id];return `<li><button data-route="${esc(id)}" aria-pressed="${focusedRoute===id}"><span class="route-number">${i+1}</span><span class="route-name">${routeDirection==='out'?'A':'Desde'} ${esc(shortName(other))}<small>${esc(other.name.split(',').slice(1).join(',').trim())}</small></span><strong>${number.format(trips)}<small>viajes</small></strong></button></li>`;}).join('')}</ol>${rows.length?'<button id="show-connections" class="text-button">Ver estas conexiones en el mapa</button><p class="route-caption">Más grosor = más viajes. Las líneas unen estaciones; no son recorridos por calles.</p>':'<p class="muted">Sin viajes registrados con otras estaciones en este sentido.</p>'}</section>`;
}
function revealMap() {
  if (window.matchMedia('(max-width:800px)').matches) document.querySelector('.map-wrap').scrollIntoView({block:'start'});
}
function focusConnection(id,reveal=false) {
  focusedRoute=id;
  for (const item of routeObjects) {
    const active=id===item.id;
    item.line.setStyle({opacity:active ? .95 : .2,weight:item.weight+(active?2:0)});
    item.pin.setOpacity(active ? 1 : .5);
    item.arrow.setOpacity(active ? 1 : .3);
    item.pin.getElement()?.classList.toggle('is-focused',active);
    if(active)item.pin.openTooltip();else item.pin.closeTooltip();
  }
  document.querySelectorAll('[data-route]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.route===id)));
  if(reveal)revealMap();
}
function drawConnections() {
  routeLayer.clearLayers();routeObjects=[];$('route-key').hidden=true;
  const station=stations.find(s=>s.id===selected),record=station&&connectionRecord(station);
  if (!record) return;
  const rows=record[routeDirection];
  if (!rows.length) return;
  const maximum=Math.max(...rows.map(r=>r[1]));
  for (const [i,[id,trips]] of rows.entries()) {
    const other=connections.stations[id];
    const from=routeDirection==='out'?record:other,to=routeDirection==='out'?other:record;
    const title=`${esc(shortName(from))} → ${esc(shortName(to))} · ${number.format(trips)} viajes (${connectionPeriod()})`;
    const weight=2+4*trips/maximum;
    const line=L.polyline([[from.lat,from.lon],[to.lat,to.lon]],{pane:'connections',className:'typical-route',color:'#234f83',weight,opacity:.75}).addTo(routeLayer);
    const pin=L.marker([other.lat,other.lon],{autoPanOnFocus:false,icon:L.divIcon({className:'route-pin',html:`<span>${i+1}</span>`,iconSize:[24,24],iconAnchor:[12,12]}),title:other.name,alt:`Conexión ${i+1}: ${other.name}`}).bindTooltip(title,{direction:'top',offset:[0,-12]}).addTo(routeLayer);
    pin.getElement().setAttribute('aria-label',`Conexión ${i+1}: ${from.name} a ${to.name}, ${trips} viajes`);
    const a=map.project([from.lat,from.lon],0),b=map.project([to.lat,to.lon],0);
    const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
    const point=map.unproject(L.point(a.x+(b.x-a.x)*.62,a.y+(b.y-a.y)*.62),0);
    const arrow=L.marker(point,{interactive:false,keyboard:false,pane:'connections',icon:L.divIcon({className:'route-arrow',html:`<svg viewBox="0 0 14 14" aria-hidden="true" style="transform:rotate(${angle}deg)"><path d="M2 1L12 7L2 13L4 7Z" fill="#234f83" stroke="white" stroke-width="1.5"/></svg>`,iconSize:[16,16],iconAnchor:[8,8]})}).addTo(routeLayer);
    line.on('click',()=>focusConnection(id));pin.on('click',()=>focusConnection(id));
    routeObjects.push({id,line,pin,arrow,weight});
  }
  L.circleMarker([record.lat,record.lon],{pane:'connections',radius:8,color:'white',weight:2,fillColor:'#203443',fillOpacity:1,interactive:false}).bindTooltip(routeDirection==='out'?'Salida':'Llegada',{permanent:true,direction:'bottom',offset:[0,10],className:'route-origin'}).addTo(routeLayer);
  $('route-key').textContent=routeDirection==='out'?'Salen de la estación elegida · más grosor, más viajes':'Llegan a la estación elegida · más grosor, más viajes';
  $('route-key').hidden=false;
  if(focusedRoute && rows.some(r=>r[0]===focusedRoute))focusConnection(focusedRoute);
}

function renderDetail() {
  $('browse').hidden=selected!==null;$('detail').hidden=selected===null;
  if (selected===null) {drawConnections();return;}
  const s=stations.find(s=>s.id===selected);
  if (!s) {selected=null;renderDetail();return;}
  const okay=valid(s),inactive=!s.installed||s.locked;
  const unavailable=okay?s.capacity-s.bikes-s.free:0;
  $('detail').innerHTML=`<button id="back" class="back">← Todas las estaciones</button><h2>${esc(shortName(s))}</h2><p class="area">${esc(s.name.split(',').slice(1).join(',').trim())}</p><div class="availability"><div><strong>${okay?s.bikes:'—'}</strong><span>bicis disponibles</span></div><div><strong>${okay?s.free:'—'}</strong><span>huecos para aparcar</span></div></div>${okay?`<div class="capacity" aria-hidden="true"><i class="bikes" style="width:${s.bikes/s.capacity*100}%"></i><i class="free" style="width:${s.free/s.capacity*100}%"></i><i class="broken" style="width:${unavailable/s.capacity*100}%"></i></div><p class="status-note">${s.capacity} plazas totales${unavailable?` · ${unavailable} fuera de servicio`:''}</p>`:''}<p class="status-label ${!okay||s.bikes===0||s.free===0?'problem':''}">${inactive?'Estación cerrada o bloqueada':!okay?'TfL no ofrece disponibilidad fiable':s.bikes===0?'No hay bicis para sacar':s.free===0?'No quedan huecos para aparcar':'Hay bicis y huecos libres'}</p><p class="status-note">${isLive?'Consulta actual':'Copia guardada'} de TfL: ${stamp(live.captured)}.<br>${s.modified?`Último cambio comunicado: ${stamp(s.modified)}.`:''}</p>${renderConnections(s)}${renderHistory(s)}`;
  const retry=$('retry-connections');if(retry)retry.onclick=()=>{loadConnections();renderDetail();};
  document.querySelectorAll('[data-direction]').forEach(button=>button.onclick=()=>{routeDirection=button.dataset.direction;focusedRoute=null;renderDetail();});
  document.querySelectorAll('[data-route]').forEach(button=>button.onclick=()=>focusConnection(button.dataset.route,true));
  const show=$('show-connections');if(show)show.onclick=()=>{const record=connectionRecord(s);map.fitBounds([record,...record[routeDirection].map(([id])=>connections.stations[id])].map(p=>[p.lat,p.lon]),{padding:[45,45],maxZoom:16});revealMap();};
  drawConnections();
  $('back').onclick=()=>{previous=selected;selected=null;renderDetail();updateMarkers();historyURL();};
}
function historyURL() {const query=selected?`?station=${encodeURIComponent(selected)}`:'';window.history.replaceState(null,'',location.pathname+query);}
function selectStation(id,pan=false) {
  selected=id;focusedRoute=null;routeDirection='out';loadConnections();$('search').value='';$('results').replaceChildren();renderDetail();updateMarkers();historyURL();
  if (pan) {const s=stations.find(s=>s.id===id);map.panTo([s.lat,s.lon]);}
}
function search() {
  const value=$('search').value.trim().toLowerCase();
  if (!value) {$('results').replaceChildren();return;}
  const hits=stations.filter(s=>s.name.toLowerCase().includes(value)||s.id===value).slice(0,7);
  $('results').innerHTML=hits.length?hits.map(s=>`<button data-search="${esc(s.id)}">${esc(s.name)}</button>`).join(''):'<p>No se ha encontrado esa estación.</p>';
}
function compact(items) {
  return items.map(item=>{const p=Object.fromEntries(item.additionalProperties.map(p=>[p.key,p]));const integer=key=>p[key]&&p[key].value!==''?Number(p[key].value):null;return {id:item.id.replace('BikePoints_',''),name:item.commonName,lat:item.lat,lon:item.lon,bikes:integer('NbBikes'),free:integer('NbEmptyDocks'),capacity:integer('NbDocks'),installed:p.Installed?.value==='true',locked:p.Locked?.value==='true',modified:[p.NbBikes?.modified,p.NbEmptyDocks?.modified].filter(Boolean).sort().at(-1)||''};});
}
async function refresh() {
  $('refresh').disabled=true;$('updated').textContent='Consultando disponibilidad en TfL…';
  try {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    let response;
    try {response=await fetch('https://api.tfl.gov.uk/BikePoint',{signal:controller.signal});} finally {clearTimeout(timer);}
    if (!response.ok) throw new Error('TfL no disponible');
    const items=await response.json();if(!Array.isArray(items)||items.length<100)throw new Error('Respuesta TfL incompleta');
    stations=compact(items);live={captured:new Date().toISOString(),stations};isLive=true;
    $('updated').textContent=`TfL consultado a las ${clock(live.captured)} (Londres)`;
    updateMarkers();renderList();renderDetail();
  } catch (error) {
    isLive=false;$('updated').textContent=live?`No se pudo actualizar. Copia de ${stamp(live.captured)}.`:'No se pudo cargar TfL. Pulsa Actualizar para reintentar.';
    renderDetail();
  } finally {$('refresh').disabled=false;}
}
async function start() {
  initMap();$('refresh').onclick=refresh;
  $('order').onchange=event=>{mode=event.target.value;limit=40;legend();renderList();updateMarkers();};
  $('more').onclick=()=>{limit+=40;renderList();};
  $('search').oninput=search;
  $('search').onkeydown=event=>{if(event.key==='Enter'){const first=document.querySelector('#results [data-search]');if(first){event.preventDefault();selectStation(first.dataset.search,true);}}if(event.key==='Escape'){$('search').value='';$('results').replaceChildren();}};
  document.addEventListener('click',event=>{const item=event.target.closest('[data-station]');if(item)selectStation(item.dataset.station,true);const hit=event.target.closest('[data-search]');if(hit)selectStation(hit.dataset.search,true);if(!event.target.closest('.search'))$('results').replaceChildren();});
  const historical=readJSON('./data/occupancy.json').then(data=>{history=data;renderDetail();if(mode!=='current'){renderList();updateMarkers();}}).catch(()=>{historyFailed=true;renderDetail();});
  try {
    live=await readJSON('./data/live.json');stations=live.stations;$('updated').textContent=`Copia de TfL: ${stamp(live.captured)}. Consultando datos actuales…`;updateMarkers();renderList();if(stations.some(s=>s.id===requested))selectStation(requested);
  } catch(error) {$('updated').textContent='Cargando datos directamente de TfL…';}
  refresh();
}
start();
