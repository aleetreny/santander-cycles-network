// The station explorer: search, a card with every measure, and the station's links on the map.
import { lines, fmt, css } from './charts.js';
import { CAT_NIGHT, ROLE_NAMES } from './scenes.js';

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
const SUGGEST = ['Waterloo Station 3, Waterloo', 'Hyde Park Corner, Hyde Park', 'Queen Street 1, Bank', 'Exhibition Road, Knightsbridge', 'Great Dover Street, The Borough', 'Ackroyd Drive, Bow'];

export class Explorer {
  constructor(data, inst, version) {
    this.data = data;
    this.inst = inst;
    this.version = version;
    this.C = data.stations.columns;
    this.n = this.C.id.length;
    this.sel = -1;
    this.profiles = null;
    this.onChange = null;
    this.strength = this.C.sOut.map((v, i) => v + this.C.sIn[i]);
    this.keys = this.C.name.map((name, i) => norm(`${name} ${this.C.area[i]}`));
    this.card = document.getElementById('card');
    this.setupSearch();
    this.setupPicked();
    const sug = document.getElementById('suggest');
    sug.innerHTML = SUGGEST.map(name => this.C.name.indexOf(name)).filter(i => i >= 0)
      .map(i => `<button type="button" data-i="${i}">${this.C.name[i].split(',')[0]}</button>`).join('');
    sug.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) this.open(+b.dataset.i, { select: true }); });
    this.card.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) this.open(+b.dataset.i, { select: true }); });
  }

  async loadProfiles() {
    if (!this.profiles) {
      this.profiles = fetch(`data/profiles.json?v=${this.version['profiles.json'] || ''}`).then(r => {
        if (!r.ok) throw new Error(`profiles.json: HTTP ${r.status}`);
        return r.json();
      });
    }
    return this.profiles;
  }

  setupPicked() {
    const stage = document.getElementById('stage');
    this.picked = document.createElement('div');
    this.picked.className = 'picked';
    this.picked.hidden = true;
    stage.querySelector('.hud').appendChild(this.picked);
    this.picked.addEventListener('click', e => {
      if (e.target.closest('[data-go]')) this.open(this.sel, { scroll: true });
      if (e.target.closest('[data-close]')) this.clear();
    });
  }

  setupSearch() {
    const input = document.getElementById('search-input');
    const list = document.getElementById('search-list');
    const box = input.closest('.search');
    let items = [], active = -1;
    const close = () => { list.hidden = true; box.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const render = () => {
      const q = norm(input.value).trim();
      if (!q) { close(); return; }
      const words = q.split(/\s+/);
      items = d3.range(this.n).filter(i => this.C.active[i] && words.every(w => this.keys[i].includes(w)))
        .sort((a, b) => this.strength[b] - this.strength[a]).slice(0, 8);
      list.innerHTML = items.length
        ? items.map((i, k) => `<li role="option" id="opt-${k}" data-i="${i}" aria-selected="${k === active}">${this.C.name[i]}<span>${fmt.int(this.strength[i])} journeys</span></li>`).join('')
        : '<li role="option" aria-disabled="true">No station matches. Try a street or an area.</li>';
      list.hidden = false;
      box.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', `opt-${active}`);
    };
    input.addEventListener('input', () => { active = -1; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && items.length) { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && items.length) { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && items.length) { this.open(items[Math.max(0, active)], { select: true }); input.value = ''; close(); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('pointerdown', e => {
      const li = e.target.closest('[data-i]');
      if (!li) return;
      e.preventDefault();
      this.open(+li.dataset.i, { select: true });
      input.value = '';
      close();
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  clear(notify = true) {
    this.sel = -1;
    this.inst.select(-1);
    this.picked.hidden = true;
    this.card.innerHTML = '';
    if (notify && this.onChange) this.onChange();
  }

  async open(i, { scroll = false } = {}) {
    if (i < 0 || i >= this.n) return;
    this.sel = i;
    this.inst.select(i);
    const C = this.C;
    this.picked.innerHTML = `<span>${C.name[i]}</span><button type="button" data-go>Open in explorer</button><button type="button" data-close aria-label="Clear selection">×</button>`;
    this.picked.hidden = this.inExplorer();
    if (scroll) document.getElementById('explorer').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    try {
      const P = await this.loadProfiles();
      if (this.sel !== i) return;
      this.render(i, P);
    } catch (err) {
      console.error(err);
      this.card.innerHTML = '<p class="err">Station details could not be loaded. Check the connection and select the station again.</p>';
      this.profiles = null;
    }
    if (this.onChange) this.onChange();
  }

  inExplorer() { return document.querySelector('.step.is-active')?.dataset.scene === 'explorer'; }

  scene() {
    const C = this.C, i = this.sel;
    this.picked.hidden = true;
    if (i < 0) {
      return {
        layout: 'geo', color: () => '#c9d6ea', size: k => 1.2 + Math.sqrt(this.strength[k]) * 0.05,
        tooltip: k => `${fmt.int(this.strength[k])} journeys in May`,
        caption: 'Pick a station', sub: 'Search on the left, or click any dot.',
      };
    }
    const edges = [];
    const mark = new Set([i]);
    const resolved = this.resolved;
    if (resolved) {
      resolved.out[i].forEach(([j, w]) => { mark.add(j); edges.push({ a: i, b: j, w: 0.8 + Math.sqrt(w) * 0.32, alpha: 0.9, color: '#f2a33a', arrow: true }); });
      resolved.in[i].forEach(([j, w]) => { mark.add(j); edges.push({ a: j, b: i, w: 0.8 + Math.sqrt(w) * 0.32, alpha: 0.9, color: '#5aa8ff', arrow: true }); });
    }
    return {
      layout: 'geo', additive: false, edges,
      color: k => (k === i ? '#ffffff' : mark.has(k) ? '#e7edf6' : '#3b4a66'),
      size: k => (k === i ? 5 : mark.has(k) ? 3 : 1.4), alpha: k => (mark.has(k) ? 1 : 0.6),
      labels: [...mark].map(k => ({ i: k, text: C.name[k].split(',')[0], color: k === i ? '#ffffff' : undefined })),
      tooltip: k => `${fmt.int(this.strength[k])} journeys in May`,
      fit: resolved ? [...mark] : undefined,
      caption: C.name[i], sub: 'Top eight destinations and origins of May\'s journeys.',
      legend: `<div class="row"><span class="key"><i class="line" style="background:#f2a33a"></i>riders go to</span><span class="key"><i class="line" style="background:#5aa8ff"></i>riders come from</span></div>`,
    };
  }

  render(i, P) {
    this.resolved = P;
    const C = this.C, S = this.data.study, pct = this.data.stations.percentiles;
    const groups = S.communities.groups;
    const region = groups.find(g => g.id === C.community[i]);
    const arche = S.temporal.archetypes.profiles.find(a => a.id === C.archetype[i]);
    const days = S.temporal.days;
    const perDay = C.tripNet[i] / 31;
    const van = C.vanGiven[i] - C.vanTaken[i];
    const rank = d3.range(this.n).filter(k => this.strength[k] > this.strength[i]).length + 1;
    const bar = (label, key, note) => {
      const v = pct[key]?.[i];
      if (v == null) return '';
      return `<span>${label}</span><span class="track" role="img" aria-label="${label}: higher than ${Math.round(v * 100)}% of stations"><span class="fill" style="width:${Math.max(2, v * 100)}%"></span></span><span class="v">${note ?? `${Math.round(v * 100)}th`}</span>`;
    };
    const partner = list => list.map(([j, w]) => `<li><button type="button" data-i="${j}">${C.name[j].split(',')[0]}</button> <span class="n">${fmt.int(w)}</span></li>`).join('');
    const summary = [
      `${C.name[i].split(',')[0]} is the ${ordinal(rank)} busiest of ${S.summary.activeNodes} stations, with ${fmt.int(this.strength[i])} journeys starting or ending here in May on ${C.docks[i]} docks.`,
      region ? `Leiden places it in the ${region.label.split(':')[0].toLowerCase()} region${C.confidence[i] < 0.8 ? ` (only ${fmt.pct0(C.confidence[i])} of seeds agree, so it sits near a border)` : ''}.` : '',
      arche ? `Its daily rhythm is closest to the “${arche.name.toLowerCase()}” archetype.` : '',
      `Riders ${perDay >= 0 ? 'leave' : 'take away'} ${fmt.f1(Math.abs(perDay))} more bikes a day than they ${perDay >= 0 ? 'take' : 'bring'}; over the month the operator ${van >= 0 ? 'delivered' : 'removed'} ${fmt.int(Math.abs(van))} bikes net.`,
    ].filter(Boolean).join(' ');
    this.card.innerHTML = `
      <h3>${C.name[i]}</h3>
      <div class="where">${C.area[i]}, ${C.docks[i]} docks, BikePoint ${C.id[i]}</div>
      <div class="tags">
        ${region ? `<span><i style="background:${CAT_NIGHT[region.id]}"></i>${region.label.split(':')[0]} region</span>` : ''}
        ${arche ? `<span><i style="background:${css(['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'][arche.id])}"></i>${arche.name}</span>` : ''}
        <span>${ROLE_NAMES[C.role[i]] || ''}</span>
      </div>
      <p>${summary}</p>
      <div class="chart-title">Percentile among all stations</div>
      <div class="bars">
        ${bar('Journeys', 'strength')}
        ${bar('PageRank', 'pagerank')}
        ${bar('Betweenness', 'betweenness')}
        ${bar('Closeness', 'closeness')}
        ${bar('Cross-region reach', 'participation')}
        ${bar('Trip length', 'reach', `${fmt.f1(C.reach[i])} km`)}
        ${bar('E-bike share', 'ebikeShare', fmt.pct0(C.ebikeShare[i]))}
        ${bar('Weekend use', 'leisure', `${fmt.f2(C.leisure[i])}×`)}
        ${bar('Daily swing per dock', 'stress')}
        ${bar('Burstiness', 'burstiness', fmt.f2(C.burstiness[i]))}
      </div>
      <figure class="chart" id="x-rhythm"><div class="chart-title">Average hourly departures and arrivals</div><div class="plot"></div>
        <figcaption>Working days (${days.work}) solid, weekends and bank holidays (${days.free}) dashed.</figcaption></figure>
      ${P.occBikes[i].some(v => v != null) ? `<figure class="chart" id="x-occ"><div class="chart-title">Bikes docked on an average September weekday</div><div class="plot"></div>
        <figcaption>From BikePoint occupancy snapshots${C.occEmpty[i] != null ? `: completely empty ${fmt.pct0(C.occEmpty[i])} and completely full ${fmt.pct0(C.occFull[i])} of the time` : ''}.</figcaption></figure>` : ''}
      <div class="partners">
        <div><div class="chart-title">Riders go to</div><ol>${partner(P.out[i])}</ol></div>
        <div><div class="chart-title">Riders come from</div><ol>${partner(P.in[i])}</ol></div>
      </div>`;
    const R = P.rhythm[i];
    const hrs = (from) => R.slice(from, from + 24).map((v, h) => [h, v]);
    lines(this.card.querySelector('#x-rhythm'), {
      height: W => Math.min(220, W * 0.5), x: { domain: [0, 23], format: d => `${d}h`, tipFormat: v => `${String(v).padStart(2, '0')}:00` },
      y: { label: 'per hour', tipFormat: fmt.f1 },
      series: [
        { name: 'Departures, working day', color: css('--source'), points: hrs(0), smooth: true },
        { name: 'Arrivals, working day', color: css('--sink'), points: hrs(24), smooth: true },
        { name: 'Departures, weekend', color: css('--source'), points: hrs(48), smooth: true, dash: true, width: 1.5 },
        { name: 'Arrivals, weekend', color: css('--sink'), points: hrs(72), smooth: true, dash: true, width: 1.5 },
      ],
    });
    const occEl = this.card.querySelector('#x-occ');
    if (occEl) {
      lines(occEl, {
        height: W => Math.min(200, W * 0.45), x: { domain: [0, 23], format: d => `${d}h`, tipFormat: v => `${String(v).padStart(2, '0')}:00` },
        y: { domain: [0, Math.max(C.docks[i], d3.max(P.occBikes[i]) || 1)], label: 'bikes', tipFormat: fmt.f1 },
        refs: [{ y: C.docks[i], text: `${C.docks[i]} docks` }],
        series: [{ name: 'Mean bikes docked', color: css('--c1'), points: P.occBikes[i].map((v, h) => [h, v]).filter(p => p[1] != null), area: true, smooth: true }],
      });
    }
  }
}

function ordinal(k) {
  const s = ['th', 'st', 'nd', 'rd'], v = k % 100;
  return `${fmt.int(k)}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
