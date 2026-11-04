import { Instrument } from './instrument.js';
import { fmt } from './charts.js';
import { buildScenes } from './scenes.js';
import { drawFigures } from './figures.js';
import { Explorer } from './explorer.js';
import { renderToolkit } from './toolkit.js';

const files = ['study', 'stations', 'links', 'geo'];

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const formats = {
  int: v => fmt.int(Math.round(v)),
  pct0: v => d3.format('.0%')(v),
  pct1: v => d3.format('.1%')(v),
  f0: v => d3.format(',.0f')(v),
  f1: v => d3.format(',.1f')(v),
  f2: v => d3.format(',.2f')(v),
  f3: v => d3.format(',.3f')(v),
  km: v => `${d3.format(',.1f')(v)} km`,
  p: v => (v < 0.001 ? 'p < .001' : `p = ${d3.format('.3f')(v).replace(/^0/, '')}`),
};

async function fetchJSON(name, version) {
  const res = await fetch(`data/${name}.json?v=${version || ''}`);
  if (!res.ok) throw new Error(`${name}.json: HTTP ${res.status}`);
  return res.json();
}

// Numbers quoted in the text that need a little arithmetic first.
function derive(data) {
  const { study, links } = data;
  const level = a => study.backbone.levels.find(l => Math.abs(l.alpha - a) < a * 1e-6);
  const heavy = links.heaviest.slice(0, 2500);
  const expo = study.space.models.find(m => m.name === 'exponential');
  const rad = study.space.models.find(m => m.name === 'radiation');
  const t300 = study.motifs.triads.find(t => t.code === '300');
  const ov = study.robustness.percolation.overlap;
  return {
    heavyShown: heavy.length,
    heavyShare: d3.sum(heavy, e => e[2]) / study.summary.graphJourneys,
    bb3: level(0.001),
    pathRatio: study.summary.backboneMeanPath / study.summary.backboneRandomPath,
    betaExp: expo.param[0], cpcExp: expo.cpc, halfKm: Math.LN2 / expo.param[0], cpcRad: rad.cpc,
    riverShort: study.space.river.bands[0],
    club10: study.richClub.find(c => c.club === 10).rho,
    t300,
    sil6: study.temporal.archetypes.silhouette['6'],
    overlapLow: ov[0][1], overlapHigh: ov[ov.length - 1][1],
  };
}

function bind(data) {
  const scope = { ...data.study, derived: data.derived };
  document.querySelectorAll('[data-v]').forEach(el => {
    const v = get(scope, el.dataset.v);
    if (v === undefined || v === null) { console.warn('Missing value', el.dataset.v); return; }
    const f = formats[el.dataset.f] || (x => x);
    el.textContent = typeof v === 'number' ? f(v) : v;
  });
  const gen = document.getElementById('generated');
  if (gen) gen.textContent = `Study generated ${data.study.meta.generated}.`;
}

function scrolly(inst, scenes) {
  const steps = [...document.querySelectorAll('[data-scene]')];
  let current = null;
  const activate = (step) => {
    if (!step || step === current) return;
    current?.classList.remove('is-active');
    current = step;
    step.classList.add('is-active');
    const scene = scenes[step.dataset.scene];
    if (scene) scene.enter();
  };
  // A step is active while it crosses a line 40% down the viewport (below the map on phones).
  const pick = () => {
    const narrow = window.innerWidth <= 900;
    const stageH = narrow ? document.getElementById('stage').getBoundingClientRect().height : 0;
    const line = stageH + (window.innerHeight - stageH) * (narrow ? 0.3 : 0.42);
    let best = steps[0];
    for (const s of steps) {
      const r = s.getBoundingClientRect();
      if (r.top <= line) best = s;
    }
    activate(best);
  };
  // Throttle to one check per 60 ms, always followed by a trailing check after scrolling stops.
  let last = 0, trailing = null;
  window.addEventListener('scroll', () => {
    const now = performance.now();
    clearTimeout(trailing);
    trailing = setTimeout(pick, 80);
    if (now - last > 60) { last = now; pick(); }
  }, { passive: true });
  window.addEventListener('resize', pick);
  pick();
  return { refresh: () => { const s = current; current = null; activate(s); }, current: () => current };
}

function wireHud(inst) {
  const stage = document.getElementById('stage');
  stage.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    const z = b.dataset.zoom;
    if (z === 'in') inst.zoomBy(1.6); else if (z === 'out') inst.zoomBy(1 / 1.6); else inst.resetView();
  }));
  const clock = stage.querySelector('.clock');
  clock.querySelector('[data-act=play]').addEventListener('click', () => inst.togglePlay());
  const slider = clock.querySelector('input');
  slider.addEventListener('input', () => { inst.togglePlay(false); inst.setPulseTime(+slider.value); });
  clock.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => inst.setPulseKind(b.dataset.kind)));
}

async function main() {
  const stage = document.getElementById('stage');
  const loading = stage.querySelector('.loading');
  try {
    const version = await fetchJSON('version').catch(() => ({}));
    const [study, stations, links, geo] = await Promise.all(files.map(f => fetchJSON(f, version[`${f}.json`])));
    const data = { study, stations, links, geo, version, pulse: null };
    data.derived = derive(data);
    bind(data);
    // The animated day is the heaviest file: start it right after the rest is on screen.
    data.pulse = await fetchJSON('pulse', version['pulse.json']);
    const inst = new Instrument(stage, data);
    loading.hidden = true;
    window.__instrument = inst;   // handy for inspecting the map from the console
    wireHud(inst);
    const explorer = new Explorer(data, inst, version);
    const scenes = buildScenes(data, inst, explorer);
    const scroller = scrolly(inst, scenes);
    explorer.onChange = () => { if (scroller.current()?.dataset.scene === 'explorer') scenes.explorer.enter(); };
    inst.on('select', i => {
      if (i < 0) { explorer.clear(); return; }
      explorer.open(i, { scroll: false });
    });
    drawFigures(data, inst, explorer, scenes);
    renderToolkit(data);
    if (location.hash === '#explorer') document.getElementById('explorer').scrollIntoView();
  } catch (err) {
    console.error(err);
    loading.hidden = false;
    loading.textContent = 'The data could not be loaded. Reload the page to try again.';
    const note = document.createElement('p');
    note.className = 'err';
    note.textContent = `The study data did not load (${err.message}). Reload the page; if you opened the file directly, serve the site folder over HTTP instead.`;
    document.querySelector('.opening').appendChild(note);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
