// What the instrument shows at each step of the essay.
import { DIVERGE } from './instrument.js';
import { fmt } from './charts.js';

// Categorical hues stepped for the night surface (validated order; see README).
export const CAT_NIGHT = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#2f9a2f', '#e66767'];
export const ROLE_NAMES = { 1: 'Ultra-peripheral', 2: 'Peripheral', 3: 'Non-hub connector', 4: 'Non-hub kinless', 5: 'Provincial hub', 6: 'Connector hub', 7: 'Kinless hub' };
const ROLE_COLOR = { 2: '#5f7090', 3: '#199e70', 5: '#c98500', 6: '#d95926' };
const DIM = '#3b4a66';
const SEQ = d3.interpolateRgb('#24406b', '#cfe6ff');
const AMBER = d3.interpolateRgb('#3f2f1c', '#ffcf7a');

export function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (color, label, kind = '') => `<span class="key"><i class="${kind}" style="background:${color}"></i>${label}</span>`;
const ramp = (from, to, lo, hi) => `<span class="key">${lo}<span class="ramp" style="display:inline-block;background:linear-gradient(90deg,${from},${to})"></span>${hi}</span>`;

export function buildScenes(data, inst, explorer) {
  const C = data.stations.columns;
  const n = C.id.length;
  const study = data.study;
  const strength = d3.range(n).map(i => C.sOut[i] + C.sIn[i]);
  const sizeBy = (values, scale = 0.065, base = 1.2) => i => base + Math.sqrt(Math.max(0, values[i] || 0)) * scale;
  const sizeStrength = sizeBy(strength);
  const short = i => C.name[i].split(',')[0];
  const byStrength = d3.range(n).sort((a, b) => strength[b] - strength[a]);
  const tipStrength = i => `${fmt.int(strength[i])} journeys in May`;
  const topLabels = (values, k = 6) => d3.range(n).filter(i => C.active[i]).sort((a, b) => (values[b] ?? -Infinity) - (values[a] ?? -Infinity)).slice(0, k).map(i => ({ i, text: short(i) }));
  const pctRank = values => {
    const order = d3.range(n).sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0));
    const out = new Array(n);
    order.forEach((i, k) => { out[i] = k / (n - 1); });
    return out;
  };
  const groupLabels = (part, names) => {
    const ids = [...new Set(part)].filter(c => c >= 0);
    return ids.map(c => {
      const members = d3.range(n).filter(i => part[i] === c);
      const w = d3.sum(members, i => strength[i]) || 1;
      const lead = members.reduce((a, b) => (strength[b] > strength[a] ? b : a), members[0]);
      return {
        x: d3.sum(members, i => inst.layouts.geo[i][0] * strength[i]) / w,
        y: d3.sum(members, i => inst.layouts.geo[i][1] * strength[i]) / w,
        text: names ? names(c, lead) : C.area[lead], center: true, big: true, color: '#ffffff', key: CAT_NIGHT[c % 8],
        size: members.length,
      };
    }).sort((a, b) => b.size - a.size);
  };
  const regionShort = study.communities.groups.map(g => g.label.split(':')[0]);

  // ---------- scene state touched by essay controls ----------
  const state = { alpha: 2, filter: 'disparity', corr: 'over', measure: 'pagerank', res: '1.0', attack: 'strength', attackF: 4, layout: 'flow', archetype: -1 };
  const scenes = {};
  const def = (name, make) => { scenes[name] = { enter: () => { scenes.active = name; inst.set({ ...make(), selectedLinks: undefined }); } }; };
  const refresh = name => { if (scenes.active === name) scenes[name].enter(); };

  def('pulse', () => ({
    layout: 'geo', pulse: { kind: 'work', start: 16 },
    caption: 'A typical working day in May 2026',
    sub: 'Half an hour per second. Each spark is one journey.',
    legend: `<div class="row">${key('#f2a33a', 'losing bikes')}${key('#5b6880', 'balanced')}${key('#5aa8ff', 'gaining bikes')}</div>`,
    tooltip: i => {
      const f = inst.frame;
      return f ? `${fmt.f1(f.dep[i] * 2)} departures, ${fmt.f1(f.arr[i] * 2)} arrivals per hour now` : tipStrength(i);
    },
  }));

  def('graph', () => {
    const edges = data.links.heaviest.slice(0, 2500).map(([a, b, w]) => ({ a, b, w: 0.35 + Math.log(w) * 0.2, alpha: 0.14 + Math.min(0.5, w / 500), color: '#8fb4e8' }));
    return {
      layout: 'geo', edges, color: () => '#c9d6ea', size: sizeStrength, tooltip: tipStrength,
      caption: 'The 2,500 heaviest of 212,532 directed links',
      sub: 'Station size: journeys in plus out. Links curve clockwise from origin to destination.',
      legend: `<div class="row">${key('#c9d6ea', 'station, sized by journeys')}${key('#7fa6d9', 'link, width by journeys', 'line')}</div>`,
    };
  });

  const pStrength = pctRank(strength);
  def('strength', () => ({
    layout: 'geo', color: i => SEQ(pStrength[i]), size: sizeStrength, tooltip: tipStrength,
    labels: topLabels(strength, 8),
    caption: 'Station strength: journeys in plus out',
    sub: 'Busy stations exist, but none dominates. The ten busiest handle under 5% of trip ends.',
    legend: `<div class="row">${ramp(SEQ(0), SEQ(1), 'quiet', 'busy')}</div>`,
  }));

  // backbone, with the alpha slider and the naive-threshold comparison
  const bbEdges = data.links.backbone.edges; // [from, to, trips, -log10 alpha, km], sorted by trips
  def('backbone', () => {
    const cut = state.alpha;
    const kept = bbEdges.filter(e => e[3] >= cut);
    const list = state.filter === 'disparity' ? kept : data.links.heaviest.slice(0, kept.length);
    const has = new Uint8Array(n);
    for (const e of list) { has[e[0]] = 1; has[e[1]] = 1; }
    const lost = d3.range(n).filter(i => C.active[i] && !has[i]).length;
    const out = document.getElementById('backbone-readout');
    if (out) out.textContent = `${fmt.int(list.length)} links kept; ${fmt.int(d3.sum(has))} stations keep at least one, ${fmt.int(lost)} are left with none.`;
    return {
      layout: 'geo',
      edges: list.map(e => ({ a: e[0], b: e[1], w: 0.45 + Math.log(e[2]) * 0.22, alpha: Math.min(0.6, 11 / Math.sqrt(list.length)), color: state.filter === 'disparity' ? '#8fbaf0' : '#e0a35c' })),
      color: i => (has[i] ? '#e7edf6' : '#e05a4f'), alpha: i => (has[i] ? 0.9 : 0.9),
      size: i => (has[i] ? 1.6 + Math.sqrt(strength[i]) * 0.035 : 2.6), tooltip: tipStrength,
      caption: state.filter === 'disparity' ? `Disparity backbone at α = ${fmtAlpha(cut)}` : `The ${fmt.int(list.length)} heaviest links, for comparison`,
      sub: `${fmt.int(list.length)} links. Red stations have lost every link.`,
      legend: `<div class="row">${key(state.filter === 'disparity' ? '#8fbaf0' : '#e0a35c', 'kept link', 'line')}${key('#e7edf6', 'station still connected')}${key('#e05a4f', 'station cut off')}</div>`,
    };
  });

  const pReach = pctRank(C.reach);
  def('space', () => ({
    layout: 'geo', color: i => AMBER(pReach[i]), size: sizeStrength,
    tooltip: i => `median trip ${fmt.f2(C.reach[i])} km`,
    caption: 'How far riders go from each dock',
    sub: 'Median straight-line length of departures. The Thames and the parks are drawn in the background.',
    legend: `<div class="row">${ramp(AMBER(0), AMBER(1), 'short hops', 'long rides')}</div>`,
  }));

  def('corridors', () => {
    const over = state.corr === 'over';
    const list = over ? data.links.corridors.edges.slice(0, 60) : data.links.corridors.gaps.slice(0, 40);
    const mark = new Uint8Array(n);
    list.forEach(e => { mark[e[0]] = 1; mark[e[1]] = 1; });
    const maxR = d3.max(list, e => Math.abs(e[4]));
    const color = over ? '#ffb347' : '#7aa7ff';
    return {
      layout: 'geo', straight: false, additive: false,
      edges: list.map(e => ({ a: e[0], b: e[1], w: 0.8 + 3.2 * Math.abs(e[4]) / maxR, alpha: 0.85, color, arrow: true })),
      color: i => (mark[i] ? '#e7edf6' : DIM), size: i => (mark[i] ? 3 : 1.6), alpha: i => (mark[i] ? 1 : 0.6),
      labels: list.slice(0, 7).flatMap(e => [{ i: e[0], text: short(e[0]) }, { i: e[1], text: short(e[1]) }]),
      tooltip: tipStrength,
      caption: over ? 'Links far busier than size, distance and the river predict' : 'Links far quieter than predicted',
      sub: over ? 'Width: standardised residual of the gravity model. Arrows point to the destination.' : 'Pairs the model expects to be busy, which riders avoid.',
      legend: `<div class="row">${key(color, over ? 'more trips than expected' : 'fewer trips than expected', 'line')}</div>`,
    };
  });

  const measureValues = m => (m === 'strength' ? strength : C[m]);
  def('centrality', () => {
    const v = measureValues(state.measure);
    const p = pctRank(v);
    const label = document.querySelector(`#measure option[value="${state.measure}"]`)?.textContent || state.measure;
    const top = topLabels(v, 7);
    const list = document.getElementById('central-list');
    if (list) list.innerHTML = top.map(t => `<li><button class="text" data-open="${t.i}">${C.name[t.i]}</button></li>`).join('');
    return {
      layout: 'geo', color: i => SEQ(p[i]), size: i => 1.2 + p[i] ** 3 * 7.5, labels: top,
      tooltip: i => `${label}: top ${fmt.int(Math.max(1, Math.round((1 - p[i]) * 100)))}%`,
      caption: `Centrality: ${label}`, sub: 'Size and colour by rank. The seven highest are named.',
      legend: `<div class="row">${ramp(SEQ(0), SEQ(1), 'low rank', 'high rank')}</div>`,
    };
  });

  def('communities', () => {
    const isInfo = state.res === 'infomap';
    const part = isInfo ? C.infomap : data.stations.partitions[state.res];
    const k = new Set(part.filter(x => x >= 0)).size;
    const names = state.res === '1.0' || isInfo ? (c) => regionShort[c] || `Region ${c + 1}` : (c, lead) => `around ${C.area[lead]}`;
    const labels = groupLabels(part, names);
    const ro = document.getElementById('res-readout');
    const sw = study.communities.sweep.find(s => String(s.gamma) === state.res || s.gamma === +state.res);
    if (ro) ro.textContent = isInfo
      ? `Infomap: ${k} modules, compressing a random cyclist's path by ${fmt.f1(study.communities.infomap.compression * 100)}%. Agreement with Leiden: NMI ${fmt.f2(study.communities.infomap.nmiLeiden)}.`
      : `γ = ${+state.res}: ${k} regions, modularity ${fmt.f3(sw.modularity)}, seed stability (mean NMI) ${fmt.f2(sw.stability)}.`;
    return {
      layout: 'geo', color: i => CAT_NIGHT[(part[i] ?? 0) % 8], size: sizeStrength, labels,
      tooltip: i => `${isInfo ? 'Infomap module' : 'Region'} ${part[i] + 1}${C.confidence[i] < 0.8 && !isInfo ? `, uncertain (${fmt.pct0(C.confidence[i])} of seeds agree)` : ''}`,
      caption: isInfo ? `Infomap: ${k} flow modules` : `Leiden communities at γ = ${+state.res}: ${k} regions`,
      sub: 'Colour: region. Names sit at each region\'s centre of activity.',
      legend: `<div class="row">${labels.slice(0, 8).map(l => key(l.key, l.text)).join('')}</div>`,
    };
  });

  def('roles', () => ({
    layout: 'geo', color: i => ROLE_COLOR[C.role[i]] || '#5f7090', size: i => (C.role[i] >= 5 ? 2.2 : 1) + Math.sqrt(strength[i]) * 0.05,
    alpha: i => (C.role[i] >= 5 ? 1 : 0.75),
    labels: d3.range(n).filter(i => C.role[i] >= 5).sort((a, b) => strength[b] - strength[a]).map(i => ({ i, text: short(i) })),
    tooltip: i => `${ROLE_NAMES[C.role[i]] || 'Inactive'}; z = ${fmt.f2(C.withinZ[i])}, P = ${fmt.f2(C.participation[i])}`,
    caption: 'Functional roles (Guimerà and Amaral)', sub: 'Named: connector and provincial hubs.',
    legend: `<div class="row">${[2, 3, 5, 6].map(r => key(ROLE_COLOR[r], ROLE_NAMES[r])).join('')}</div>`,
  }));

  const club = new Set(data.links.club.members);
  def('club', () => ({
    layout: 'geo', additive: true,
    edges: data.links.club.edges.map(([a, b, w]) => ({ a, b, w: 0.5 + Math.log(w) * 0.35, alpha: 0.45, color: '#ffcf7a' })),
    color: i => (club.has(i) ? '#ffe2a8' : DIM), size: i => (club.has(i) ? sizeStrength(i) : 1.4), alpha: i => (club.has(i) ? 1 : 0.6),
    labels: data.links.club.members.slice(0, 10).map(i => ({ i, text: short(i) })),
    tooltip: tipStrength,
    caption: 'The rich club: the 40 busiest stations and the trips among them',
    legend: `<div class="row">${key('#ffe2a8', 'top 40 by journeys')}${key('#ffcf7a', 'trips inside the club', 'line')}</div>`,
  }));

  const pClus = pctRank(C.clustering);
  def('motifs', () => ({
    layout: 'force',
    edges: bbEdges.filter(e => e[3] >= 3).map(e => ({ a: e[0], b: e[1], w: 0.6, alpha: 0.22, color: '#9db6da' })),
    labels: topLabels(strength, 6),
    color: i => SEQ(pClus[i]), size: sizeStrength,
    tooltip: i => `weighted clustering ${fmt.f2(C.clustering[i])}`,
    caption: 'The backbone drawn as springs (force layout)',
    sub: 'Links at α = 0.001. Colour: how tightly each station\'s partners trade among themselves.',
    legend: `<div class="row">${ramp(SEQ(0), SEQ(1), 'open', 'clustered')}</div>`,
  }));

  const leaders = study.temporal.leaders;
  def('time', () => ({
    layout: 'geo', pulse: { kind: 'work', start: 16 },
    caption: 'Scrub through the day', sub: 'Use the clock. The named station has the highest PageRank in that hour.',
    legend: `<div class="row">${key('#f2a33a', 'losing bikes')}${key('#5aa8ff', 'gaining bikes')}${key('#ffd59a', 'journey', 'line')}</div>`,
    labels: (I) => {
      if (!I.pulse) return [];
      const h = Math.floor(I.pulse.t / 2) % 24;
      const lead = leaders[h][0][0];
      return [{ i: lead, text: `${short(lead)}: centre at ${String(h).padStart(2, '0')}:00`, color: '#ffffff' }];
    },
    tooltip: i => {
      const f = inst.frame;
      return f ? `${fmt.f1(f.dep[i] * 2)} departures, ${fmt.f1(f.arr[i] * 2)} arrivals per hour now` : tipStrength(i);
    },
  }));

  // Morning top links (07:00–10:00) and the same pairs' evening return (16:00–19:00).
  const sumBins = (from, to) => {
    const m = new Map();
    for (let b = from; b < to; b++) for (const [a, c, f] of data.pulse.work.links[b]) m.set(a * 10000 + c, (m.get(a * 10000 + c) || 0) + f);
    return m;
  };
  def('mirror', () => {
    const am = sumBins(14, 20), pm = sumBins(32, 38);
    const top = [...am.entries()].sort((a, b) => b[1] - a[1]).slice(0, 140);
    const edges = [];
    const mark = new Uint8Array(n);
    for (const [k2, f] of top) {
      const a = Math.floor(k2 / 10000), b = k2 % 10000;
      mark[a] = mark[b] = 1;
      edges.push({ a, b, w: 0.6 + Math.sqrt(f) * 0.45, alpha: 0.6, color: '#f2a33a' });
      const back = pm.get(b * 10000 + a);
      if (back) edges.push({ a: b, b: a, w: 0.6 + Math.sqrt(back) * 0.45, alpha: 0.6, color: '#5aa8ff' });
    }
    return {
      layout: 'geo', edges, color: i => (mark[i] ? '#e7edf6' : DIM), size: i => (mark[i] ? 2.6 : 1.3), alpha: i => (mark[i] ? 1 : 0.5),
      tooltip: tipStrength,
      caption: 'Morning out, evening back', sub: 'The 140 busiest morning links (7–10 am) and the same pairs in reverse (4–7 pm).',
      legend: `<div class="row">${key('#f2a33a', 'morning i → j', 'line')}${key('#5aa8ff', 'evening j → i', 'line')}</div>`,
    };
  });

  const arche = study.temporal.archetypes.profiles;
  def('archetypes', () => ({
    layout: 'geo', color: i => (C.archetype[i] >= 0 ? CAT_NIGHT[C.archetype[i]] : DIM), size: sizeStrength,
    alpha: i => (state.archetype < 0 || C.archetype[i] === state.archetype ? 0.95 : 0.12),
    tooltip: i => arche.find(a => a.id === C.archetype[i])?.name || '',
    caption: state.archetype < 0 ? 'Six station archetypes' : arche.find(a => a.id === state.archetype).name,
    sub: 'k-means on 24-hour departure and arrival rhythms.',
    legend: `<div class="row">${arche.map(a => `<button type="button" class="key key-btn" data-arche="${a.id}" aria-pressed="${state.archetype === a.id}"><i style="background:${CAT_NIGHT[a.id]}"></i>${a.name}</button>`).join('')}</div>`,
  }));
  inst.legendEl.addEventListener('click', e => {
    const b = e.target.closest('[data-arche]');
    if (b) scenes.highlightArchetype(state.archetype === +b.dataset.arche ? -1 : +b.dataset.arche);
  });
  scenes.highlightArchetype = (id) => { state.archetype = id; refresh('archetypes'); };

  const perDay = C.tripNet.map(v => v / 31);
  const netMax = d3.quantile(perDay.map(Math.abs).sort(d3.ascending), 0.98);
  def('drift', () => ({
    layout: 'geo', color: i => DIVERGE(perDay[i] / netMax), size: i => 1.3 + Math.sqrt(Math.abs(perDay[i])) * 0.9,
    labels: [...topLabels(perDay, 4), ...topLabels(perDay.map(v => -v), 4)],
    tooltip: i => `${perDay[i] >= 0 ? 'gains' : 'loses'} ${fmt.f1(Math.abs(perDay[i]))} bikes a day to riders`,
    caption: 'Net bikes gained or lost to riders, per day',
    sub: 'Arrivals minus departures, all of May. Size: imbalance.',
    legend: `<div class="row">${key('#f2a33a', 'riders take bikes away')}${key('#5aa8ff', 'riders leave bikes')}</div>`,
  }));

  const pStress = pctRank(C.stress);
  def('stress', () => ({
    layout: 'geo', color: i => AMBER(pStress[i]), size: i => 1.2 + pStress[i] ** 2 * 6,
    labels: topLabels(C.stress, 6),
    tooltip: i => `swing ${fmt.f1(C.swing[i])} bikes a day on ${C.docks[i]} docks${C.occEmpty[i] != null ? `; in September empty ${fmt.pct0(C.occEmpty[i])}, full ${fmt.pct0(C.occFull[i])} of the time` : ''}`,
    caption: 'Daily swing in bikes relative to dock size',
    sub: 'Largest gap between the fullest and emptiest moment of an average working day, divided by docks.',
    legend: `<div class="row">${ramp(AMBER(0), AMBER(1), 'calm', 'stressed')}</div>`,
  }));

  const vanNet = d3.range(n).map(i => C.vanGiven[i] - C.vanTaken[i]);
  const vanMax = d3.quantile(vanNet.map(Math.abs).sort(d3.ascending), 0.98);
  def('vans', () => ({
    layout: 'geo',
    edges: data.links.relocations.edges.slice(0, 260).map(([a, b, w]) => ({ a, b, w: 0.5 + Math.sqrt(w) * 0.2, alpha: 0.5, color: '#e48ad2', arrow: w > 40 })),
    color: i => DIVERGE(vanNet[i] / vanMax), size: i => 1.3 + Math.sqrt(Math.abs(vanNet[i])) * 0.2,
    tooltip: i => `operator delivered ${fmt.int(C.vanGiven[i])}, collected ${fmt.int(C.vanTaken[i])} bikes`,
    caption: 'The hidden network: bikes moved by the operator',
    sub: 'The 260 busiest relocation links in May. Station colour: net deliveries by the operator.',
    legend: `<div class="row">${key('#e48ad2', 'relocation link', 'line')}${key('#f2a33a', 'operator collects')}${key('#5aa8ff', 'operator delivers')}</div>`,
  }));

  // closures
  const active = d3.range(n).filter(i => C.active[i]);
  const lat = C.lat, lon = C.lon;
  const cLat = d3.sum(active, i => lat[i] * strength[i]) / d3.sum(active, i => strength[i]);
  const cLon = d3.sum(active, i => lon[i] * strength[i]) / d3.sum(active, i => strength[i]);
  const rnd = mulberry(42);
  const randomOrder = d3.shuffler(rnd)(active.slice());
  const orders = {
    strength: active.slice().sort((a, b) => strength[b] - strength[a]),
    betweenness: active.slice().sort((a, b) => C.betweenness[b] - C.betweenness[a]),
    participation: active.slice().sort((a, b) => C.participation[b] - C.participation[a]),
    centre: active.slice().sort((a, b) => ((lat[a] - cLat) ** 2 + ((lon[a] - cLon) * 0.62) ** 2) - ((lat[b] - cLat) ** 2 + ((lon[b] - cLon) * 0.62) ** 2)),
    random: randomOrder,
  };
  const strict = bbEdges.filter(e => e[3] >= 3);
  def('attack', () => {
    const f = study.robustness.fractions[state.attackF];
    const closed = new Uint8Array(n);
    orders[state.attack].slice(0, Math.round(f * active.length)).forEach(i => { closed[i] = 1; });
    const cur = study.robustness.attacks[state.attack];
    const ro = document.getElementById('attack-readout');
    if (ro) ro.textContent = `${fmt.pct0(f)} of stations closed: ${fmt.pct0(cur.trips[state.attackF])} of journeys still possible, largest connected backbone ${fmt.pct0(cur.giant[state.attackF])} of stations${state.attack === 'random' ? ' (mean of 20 random orders; the map shows one)' : ''}.`;
    const edges = strict.filter(e => !closed[e[0]] && !closed[e[1]]).map(e => ({ a: e[0], b: e[1], w: 0.7, alpha: 0.32, color: '#9db6da' }));
    return {
      layout: 'geo', edges, color: i => (closed[i] ? '#ff5a4a' : '#c9d6ea'), size: i => (closed[i] ? 3.2 : 1.3 + Math.sqrt(strength[i]) * 0.025),
      alpha: i => (closed[i] ? 1 : 0.8), order: [...active.filter(i => !closed[i]), ...active.filter(i => closed[i])], tooltip: i => (closed[i] ? 'closed' : tipStrength(i)),
      caption: `${fmt.pct0(f)} of stations closed`, sub: 'Strict backbone links (α = 0.001) between stations still open.',
      legend: `<div class="row">${key('#e05a4f', 'closed')}${key('#e7edf6', 'open')}${key('#9db6da', 'backbone link', 'line')}</div>`,
    };
  });

  def('weakties', () => {
    const list = bbEdges;
    const ws = list.map(e => e[2]).sort(d3.ascending);
    const lo = d3.quantile(ws, 0.33), hi = d3.quantile(ws, 0.9);
    // Weak links first, strong links drawn on top.
    const edges = [...list.filter(e => e[2] <= lo).map(e => ({ a: e[0], b: e[1], w: 0.6, alpha: 0.16, color: '#7aa7ff' })),
      ...list.filter(e => e[2] >= hi).map(e => ({ a: e[0], b: e[1], w: 1.5, alpha: 0.8, color: '#ffb347' }))];
    return {
      layout: 'geo', edges, color: () => '#c9d6ea', size: () => 1.5, tooltip: tipStrength,
      caption: 'Strong links stay local, weak links reach across',
      sub: 'Backbone at α = 0.01: its strongest tenth and its weakest third.',
      legend: `<div class="row">${key('#ffb347', 'strongest 10%', 'line')}${key('#7aa7ff', 'weakest third', 'line')}</div>`,
    };
  });

  const pE = pctRank(C.ebikeShare);
  def('layers', () => ({
    layout: 'geo', color: i => SEQ(pE[i]), size: sizeStrength, labels: topLabels(C.ebikeShare.map((v, i) => (strength[i] > 1500 ? v : 0)), 5),
    tooltip: i => `${fmt.pct0(C.ebikeShare[i])} of departures on e-bikes`,
    caption: 'Share of departures on e-bikes', sub: 'Named: highest e-bike share among stations with 1,500+ journeys.',
    legend: `<div class="row">${ramp(SEQ(0), SEQ(1), 'mostly classic', 'mostly electric')}</div>`,
  }));

  const notable = [...new Set([...topLabels(C.displacement, 6).map(l => l.i), ...byStrength.slice(0, 4)])];
  def('morph', () => ({
    layout: state.layout, color: i => CAT_NIGHT[(C.community[i] ?? 0) % 8], size: sizeStrength,
    labels: notable.map(i => ({ i, text: short(i) })),
    tooltip: i => `moved ${fmt.f1(C.displacement[i])} km from its real position in the flow map`,
    caption: { geo: 'Geography', flow: 'Flow map: stations placed by where their riders go', force: 'Force layout of the backbone', spectral: 'Spectral coordinates' }[state.layout],
    sub: 'Colours: the four Leiden regions. Same stations, same colours, different notions of near.',
    legend: `<div class="row">${study.communities.groups.map(g => key(CAT_NIGHT[g.id], regionShort[g.id])).join('')}</div>`,
  }));

  def('explorer', () => explorer.scene());

  // ---------- controls in the essay ----------
  const alpha = document.getElementById('alpha');
  alpha.addEventListener('input', () => {
    state.alpha = +alpha.value;
    document.getElementById('alpha-out').textContent = fmtAlpha(state.alpha);
    refresh('backbone');
  });
  segment('[data-filter]', 'filter', v => { state.filter = v; refresh('backbone'); });
  segment('[data-corr]', 'corr', v => { state.corr = v; renderCorridorList(); refresh('corridors'); });
  segment('[data-res]', 'res', v => { state.res = v; refresh('communities'); });
  segment('[data-layout]', 'layout', v => { state.layout = v; refresh('morph'); });
  document.getElementById('measure').addEventListener('change', e => { state.measure = e.target.value; refresh('centrality'); });
  document.getElementById('attack-kind').addEventListener('change', e => { state.attack = e.target.value; refresh('attack'); });
  const af = document.getElementById('attack-f');
  af.addEventListener('input', () => {
    state.attackF = +af.value;
    document.getElementById('attack-out').textContent = fmt.pct0(study.robustness.fractions[state.attackF]);
    refresh('attack');
  });
  document.getElementById('central-list').addEventListener('click', e => {
    const b = e.target.closest('[data-open]');
    if (b) explorer.open(+b.dataset.open, { scroll: false, select: true });
  });

  function renderCorridorList() {
    const over = state.corr === 'over';
    const list = (over ? data.links.corridors.edges : data.links.corridors.gaps).slice(0, 6);
    document.getElementById('corridor-list').innerHTML = list.map(([a, b, t, p, , km]) =>
      `<li>${C.name[a].split(',')[0]} → ${C.name[b].split(',')[0]}: <b class="num">${fmt.int(t)}</b> trips where the model expects ${fmt.f1(p)} (${fmt.f1(km)} km)</li>`).join('');
  }
  renderCorridorList();
  return scenes;
}

export function fmtAlpha(v) {
  const a = 10 ** -v;
  if (a >= 0.001) return d3.format('~g')(+a.toPrecision(2));
  const [m, e] = a.toExponential(1).split('e');
  const sup = e.replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  return m === '1.0' ? `10${sup}` : `${m} × 10${sup}`;
}

function segment(selector, name, onPick) {
  const buttons = [...document.querySelectorAll(selector)];
  buttons.forEach(b => b.addEventListener('click', () => {
    buttons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    onPick(Object.values(b.dataset)[0]);
  }));
}
