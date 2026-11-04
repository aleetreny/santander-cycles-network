// Every chart in the essay, drawn once its chapter comes near the viewport.
import { lines, scatter, hbars, heatmap, density, multiples, addTable, fmt, css } from './charts.js';
import { ROLE_NAMES } from './scenes.js';

// Abramowitz & Stegun 7.1.26 complementary error function (|error| < 1.5e-7).
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
}

const TRIAD_TEXT = {
  '021D': 'out-star', '021U': 'in-star', '021C': 'one-way chain', '111D': 'mutual pair + in-link', '111U': 'mutual pair + out-link',
  '030T': 'feed-forward loop', '030C': 'one-way cycle', '201': 'two mutual pairs', '120D': 'mutual + shared source',
  '120U': 'mutual + shared target', '120C': 'mutual + chain', '210': 'nearly complete', '300': 'fully reciprocal triangle',
};
const MODEL_NAMES = {
  river: 'Gravity, exponential + Thames', exponential: 'Gravity, exponential', hybrid: 'Gravity, power × exponential',
  power: 'Gravity, power law', radiation: 'Radiation',
};
const hh = h => `${String(h).padStart(2, '0')}:00`;
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const pow10 = v => { const e = Math.round(Math.log10(v)); return e === 0 ? '1' : `10${e < 0 ? '⁻' : ''}${String(Math.abs(e)).replace(/\d/g, d => SUP[d])}`; };

export function drawFigures(data, inst, explorer, scenes) {
  const S = data.study, C = data.stations.columns, n = C.id.length;
  const col = name => css(name);
  const strength = d3.range(n).map(i => C.sOut[i] + C.sIn[i]);
  const regionShort = S.communities.groups.map(g => g.label.split(':')[0]);
  const draws = {
    'fig-ccdf': fig => {
      const d = S.distributions;
      const fitLine = (fit, N, xmax) => {
        const x0 = fit.xmin, pts = [];
        const norm = erfc((Math.log(x0) - fit.mu) / (fit.sigma * Math.SQRT2));
        for (let k = 0; k <= 40; k++) {
          const x = x0 * (xmax / x0) ** (k / 40);
          pts.push([x, (fit.n / N) * erfc((Math.log(x) - fit.mu) / (fit.sigma * Math.SQRT2)) / norm]);
        }
        return pts.filter(p => p[1] > 1e-6);
      };
      const sMax = d.strength[d.strength.length - 1][0], wMax = d.weight[d.weight.length - 1][0];
      lines(fig, {
        height: W => Math.min(360, W * 0.7), margin: { left: 62 }, x: { type: 'log', label: 'journeys', tipFormat: v => `${fmt.int(v)} journeys or more` }, y: { type: 'log', label: 'share at or above', domain: [1e-6, 1], format: v => d3.format('~%')(v), tipFormat: v => d3.format('.2~%')(v) },
        series: [
          { name: 'Stations (strength)', color: col('--c1'), points: d.strength, label: 'stations', labelDx: -60, labelDy: -12 },
          { name: 'Station log-normal fit', color: col('--c1'), points: fitLine(d.fitStrength, S.summary.activeNodes, sMax), dash: true, width: 1.5, noTip: true },
          { name: 'Links (weight)', color: col('--c2'), points: d.weight, label: 'links' },
          { name: 'Link log-normal fit', color: col('--c2'), points: fitLine(d.fitWeight, S.summary.edges, wMax), dash: true, width: 1.5, noTip: true },
        ],
        table: { columns: ['Journeys ≥', 'Share of stations'], rows: d.strength.map(p => [fmt.int(p[0]), d3.format('.3~%')(p[1])]) },
      });
    },
    'fig-lorenz': fig => {
      const d = S.distributions, q = d.lorenzStrength.map((_, k) => k / (d.lorenzStrength.length - 1));
      lines(fig, {
        height: W => Math.min(320, W * 0.66), x: { label: 'share of stations or links, quietest first', format: d3.format('.0%'), tipFormat: d3.format('.0%'), domain: [0, 1] },
        y: { label: 'share of journeys', format: d3.format('.0%'), tipFormat: d3.format('.1%'), domain: [0, 1] },
        series: [
          { name: `Stations (Gini ${fmt.f2(d.giniStrength)})`, color: col('--c1'), points: q.map((x, k) => [x, d.lorenzStrength[k]]), label: 'stations', labelAt: 0.75, labelDx: 6, labelDy: 8 },
          { name: `Links (Gini ${fmt.f2(d.giniWeight)})`, color: col('--c2'), points: q.map((x, k) => [x, d.lorenzWeight[k]]), label: 'links', labelAt: 0.82, labelDx: 6, labelDy: 6 },
          { name: 'Perfect equality', color: col('--ink-3'), points: [[0, 0], [1, 1]], dash: true, width: 1, noTip: true },
        ],
      });
    },
    'fig-sk': fig => {
      const pts = S.distributions.strengthDegree.points.filter(p => p[0] > 0 && p[1] > 0);
      const lx = pts.map(p => Math.log(p[0])), ly = pts.map(p => Math.log(p[1]));
      const mx = d3.mean(lx), my = d3.mean(ly);
      const beta = d3.sum(lx, (x, k) => (x - mx) * (ly[k] - my)) / d3.sum(lx, x => (x - mx) ** 2);
      const k0 = d3.min(pts, p => p[0]), k1 = d3.max(pts, p => p[0]);
      const at = (b, k) => Math.exp(my + b * (Math.log(k) - mx));
      scatter(fig, {
        height: W => Math.min(340, W * 0.7),
        x: { type: 'log', label: 'partners (in + out degree)', format: '~s' }, y: { type: 'log', label: 'journeys (strength)', format: '~s' },
        points: pts.map((p, k) => ({ x: p[0], y: p[1], r: 2.4, opacity: 0.55, color: col('--c1') })),
        lines: [{ points: [[k0, at(beta, k0)], [k1, at(beta, k1)]], dash: true, color: col('--c2'), width: 2 },
          { points: [[k0, at(1, k0)], [k1, at(1, k1)]], dash: true, color: col('--ink-3'), width: 1 }],
        labels: [{ x: k1, y: at(beta, k1), text: `β = ${fmt.f2(beta)}`, anchor: 'end', dx: -4, dy: -12 }],
      });
    },
    'fig-backbone': fig => {
      const L = S.backbone.levels, act = S.summary.activeNodes;
      lines(fig, {
        height: W => Math.min(300, W * 0.6),
        x: { type: 'log', domain: [0.2, 1e-6], label: 'α, stricter to the right', format: pow10, tickValues: [0.1, 0.01, 1e-3, 1e-4, 1e-5, 1e-6], tipFormat: v => `α = ${d3.format('~g')(v)}` },
        y: { domain: [0, 1], format: d3.format('.0%'), label: 'stations kept', tipFormat: d3.format('.1%') },
        series: [
          { name: 'Disparity filter', color: col('--c1'), points: L.map(l => [l.alpha, l.nodes / act]), dots: true, label: 'disparity filter', labelAt: 1e-4, labelDx: 8, labelDy: -10 },
          { name: 'Heaviest links only', color: col('--c2'), points: L.map(l => [l.alpha, l.naiveNodes / act]), dots: true, label: 'weight threshold', labelAt: 1e-4, labelDx: -8, labelDy: 14, labelAnchor: 'end' },
        ],
        table: { columns: ['α', 'Links', 'Share of trips', 'Stations (disparity)', 'Stations (threshold)'], rows: L.map(l => [d3.format('~g')(l.alpha), fmt.int(l.edges), fmt.pct(l.weightShare), fmt.int(l.nodes), fmt.int(l.naiveNodes)]) },
      });
    },
    'fig-lengths': fig => {
      const Lg = S.space.lengths, bin = Lg.binKm;
      const pts = h => h.map((v, k) => [(k + 0.5) * bin, v]).filter(p => p[0] <= 10);
      lines(fig, {
        height: W => Math.min(280, W * 0.55), x: { label: 'km between docks', domain: [0, 10], tipFormat: v => `${fmt.f1(v - bin / 2)}–${fmt.f1(v + bin / 2)} km` },
        y: { label: 'share of hires', format: d3.format('.0%'), tipFormat: d3.format('.1%') },
        series: [
          { name: `Classic (median ${fmt.f2(Lg.classic.median)} km)`, color: col('--c1'), points: pts(Lg.classic.hist), area: true, smooth: true, label: 'classic', labelAt: 1.6, labelDy: -10 },
          { name: `Electric (median ${fmt.f2(Lg.electric.median)} km)`, color: col('--c2'), points: pts(Lg.electric.hist), area: true, smooth: true, label: 'electric', labelAt: 4.2, labelDy: -8 },
        ],
      });
    },
    'fig-decay': fig => {
      const d = S.space.decay;
      lines(fig, {
        height: W => Math.min(300, W * 0.6), x: { label: 'km between docks', tipFormat: v => `${fmt.f2(v)} km` }, y: { type: 'log', label: 'journeys per pair in May', tipFormat: fmt.f2 },
        series: [
          { name: 'Observed', color: col('--c1'), points: d.map(r => [r[0], r[2]]), pointsOnly: true, dots: true, r: 3.5 },
          { name: 'Best gravity model', color: col('--c2'), points: d.map(r => [r[0], r[3]]), width: 2, label: 'model', labelDy: -10, labelDx: -30 },
        ],
        table: { columns: ['km', 'Station pairs', 'Mean trips', 'Model', 'Pairs used'], rows: d.map(r => [fmt.f2(r[0]), fmt.int(r[1]), fmt.f2(r[2]), fmt.f2(r[3]), fmt.pct0(r[4])]) },
      });
    },
    'fig-models': fig => {
      const rows = [...S.space.models].sort((a, b) => b.cpc - a.cpc).map(m => ({
        name: m.name, label: MODEL_NAMES[m.name] || m.name, value: m.cpc, color: m.name === 'radiation' ? col('--ink-3') : col('--c1'),
        valueLabel: fmt.pct0(m.cpc), tip: `<b>${MODEL_NAMES[m.name]}</b><br>CPC ${fmt.f3(m.cpc)}<br>log-likelihood ${fmt.int(m.loglik)}${m.param ? `<br>parameters ${m.param.map(fmt.f3).join(', ')}` : ''}`,
      }));
      hbars(fig, { rows, labelWidth: 196, format: '.0%' });
    },
    'fig-kendall': fig => {
      const names = { strength: 'Strength', degree: 'Degree', pagerank: 'PageRank', hub: 'Hub', authority: 'Authority', eigenvector: 'Eigenvector', betweenness: 'Betweenness', closeness: 'Closeness' };
      const lab = S.centrality.names.map(k => names[k]);
      const c = d3.scaleLinear().domain([0.4, 1]).range([col('--paper-2'), col('--c1')]).clamp(true);
      heatmap(fig, {
        matrix: S.centrality.kendall, rowLabels: lab, colLabels: lab, rotateCols: true, left: 82, bottom: 70, maxHeight: 460, gap: 2, round: true,
        color: v => c(v), cellText: v => fmt.f2(v).replace(/^0/, ''), textColor: v => (v > 0.78 ? '#fff' : col('--ink')),
        tip: cl => `<b>${lab[cl.i]} vs ${lab[cl.j]}</b><br>Kendall τ = ${fmt.f3(cl.v)}`,
      });
    },
    'fig-sweep': fig => {
      const sw = S.communities.sweep.filter(s => s.gamma > 0.3);
      lines(fig, {
        height: W => Math.min(280, W * 0.55), x: { type: 'log', domain: [0.4, 5], nice: false, label: 'resolution γ', format: '~g', tipFormat: v => `γ = ${v}` }, y: { domain: [0, 0.45], label: 'modularity Q', tipFormat: fmt.f3 },
        series: [{ name: 'Modularity', color: col('--c1'), points: sw.map(s => [s.gamma, s.modularity]), dots: true }],
        notes: sw.map(s => ({ x: s.gamma, y: s.modularity, text: `${s.communities}`, dy: -10 })),
        table: { columns: ['γ', 'Regions', 'Modularity', 'Seed stability (NMI)', 'NMI to γ = 1'], rows: S.communities.sweep.map(s => [s.gamma, s.communities, fmt.f3(s.modularity), fmt.f2(s.stability), fmt.f2(s.nmiToReference)]) },
      });
    },
    'fig-mixing': fig => {
      const M = S.communities.mixing.map(row => { const t = d3.sum(row); return row.map(v => v / t); });
      const c = d3.scaleLinear().domain([0, 0.75]).range([col('--paper-2'), col('--c1')]).clamp(true);
      heatmap(fig, {
        matrix: M, rowLabels: regionShort, colLabels: regionShort.map(s => s.replace('Centre-', 'C. ')), left: 96, bottom: 24, maxHeight: 380, aspect: 0.8, gap: 3, round: true,
        color: v => c(v), cellText: v => fmt.pct0(v), textColor: v => (v > 0.45 ? '#fff' : col('--ink')),
        tip: cl => `<b>${regionShort[cl.i]} → ${regionShort[cl.j]}</b><br>${fmt.pct(cl.v)} of trips starting in ${regionShort[cl.i].toLowerCase()}`,
      });
    },
    'fig-roles': fig => {
      const roleColor = { 2: col('--ink-3'), 3: col('--c3'), 5: col('--c4'), 6: col('--c2') };
      const pts = d3.range(n).filter(i => C.active[i]).map(i => ({
        x: C.participation[i], y: C.withinZ[i], r: C.role[i] >= 5 ? 4.5 : 2.6, color: roleColor[C.role[i]] || col('--ink-3'), z: C.role[i],
        opacity: C.role[i] >= 5 ? 0.95 : 0.55, i,
        tip: `<b>${C.name[i]}</b><br>${ROLE_NAMES[C.role[i]]}<br>z = ${fmt.f2(C.withinZ[i])}, P = ${fmt.f2(C.participation[i])}`,
      }));
      const zMax = Math.ceil(d3.max(pts, p => p.y)), zMin = Math.floor(d3.min(pts, p => p.y));
      legendRoles(fig, roleColor);
      scatter(fig, {
        height: W => Math.min(360, W * 0.72), x: { domain: [0, 0.8], label: 'participation P: how evenly trips spread across regions', format: d3.format('.1f') },
        y: { domain: [zMin, zMax], label: 'within-region strength z', nice: false }, points: pts,
        regions: [{ x0: 0, x1: 0.8, y0: 2.5, y1: zMax, fill: col('--paper-2'), text: 'hubs (z ≥ 2.5)' }],
        lines: [{ points: [[0.3, 2.5], [0.3, zMax]], color: col('--rule'), width: 1 }, { points: [[0.62, zMin], [0.62, 2.5]], color: col('--rule'), width: 1 }],
        onClick: p => explorer.open(p.i, { scroll: true, select: true }),
        table: { columns: ['Role', 'Stations'], rows: Object.entries(S.communities.roles).filter(([, v]) => v > 0).map(([k, v]) => [ROLE_NAMES[k], v]) },
      });
    },
    'fig-club': fig => {
      const rc = S.richClub;
      lines(fig, {
        height: W => Math.min(280, W * 0.55), x: { type: 'log', label: 'club size: top stations by journeys', format: '~s', tipFormat: v => `top ${v} stations` },
        y: { domain: [0, Math.ceil(d3.max(rc, c => c.rho))], label: 'ratio to null', tipFormat: v => `${fmt.f2(v)}×` },
        refs: [{ y: 1, text: 'no rich-club effect', start: true }],
        series: [{ name: 'Weighted rich-club ratio', color: col('--c1'), points: rc.map(c => [c.club, c.rho]), dots: true }],
        table: { columns: ['Club size', 'Links inside', 'φ observed', 'φ null', 'Ratio'], rows: rc.map(c => [c.club, fmt.int(c.edges), fmt.f3(c.phi), fmt.f3(c.phiNull), fmt.f2(c.rho)]) },
      });
    },
    'fig-motifs': fig => {
      const rows = S.motifs.triads.map(t => ({
        name: t.code, label: `${t.code} ${TRIAD_TEXT[t.code]}`, value: t.sp, color: t.sp >= 0 ? col('--c1') : col('--c2'), valueLabel: fmt.f2(t.sp),
        tip: `<b>${t.code}: ${TRIAD_TEXT[t.code]}</b><br>observed ${fmt.int(t.count)}<br>rewired ${fmt.f1(t.nullMean)} ± ${fmt.f1(t.nullSd)}<br>z = ${fmt.f1(t.z)}`,
      }));
      hbars(fig, { rows, labelWidth: 200, format: '.1f', rowHeight: 22 });
      addTable(fig, { columns: ['Triad', 'Observed', 'Rewired mean', 'z'], rows: S.motifs.triads.map(t => [`${t.code} ${TRIAD_TEXT[t.code]}`, fmt.int(t.count), fmt.f1(t.nullMean), fmt.f1(t.z)]) });
    },
    'fig-hourly': fig => {
      const H = S.temporal.hourly;
      lines(fig, {
        height: W => Math.min(280, W * 0.55), x: { domain: [0, 23], label: 'hour of day', format: d => `${d}h`, tipFormat: v => `${hh(v)}–${hh(v + 1)}` },
        y: { label: 'journeys started per hour', format: '~s', tipFormat: fmt.int },
        series: [
          { name: 'Working day', color: col('--c1'), points: H.work.trips.map((v, h) => [h, v]), smooth: true, label: 'working day', labelAt: 18, labelDx: 8, labelDy: -4 },
          { name: 'Weekend or holiday', color: col('--c2'), points: H.free.trips.map((v, h) => [h, v]), smooth: true, label: 'weekend', labelAt: 13, labelDy: -14, labelDx: -10 },
        ],
      });
    },
    'fig-sim': fig => {
      const M = S.temporal.similarity.matrix;
      // Colour by rank among off-diagonal cells, so mid-range similarities stay distinguishable.
      const off = M.flatMap((row, i) => row.filter((_, j) => j !== i)).sort(d3.ascending);
      const c = d3.scaleLinear().domain([d3.quantile(off, 0.05), d3.quantile(off, 0.97)]).range([col('--paper-2'), col('--c1')]).clamp(true);
      const name = k => `${k < 24 ? 'working day' : 'weekend'} ${hh(k % 24)}`;
      heatmap(fig, {
        matrix: M, color: v => c(v), gap: 0, left: 34, bottom: 30, maxHeight: 520,
        tip: cl => `<b>${name(cl.i)} vs ${name(cl.j)}</b><br>cosine similarity ${fmt.f2(cl.v)}`,
        after: (g, { cw, ch }) => {
          const ticks = [0, 6, 12, 18, 24, 30, 36, 42];
          g.append('g').selectAll('text').data(ticks).join('text').attr('class', 'lab-direct').attr('x', -5).attr('y', k => k * ch + ch / 2).attr('dy', '0.32em').attr('text-anchor', 'end').text(k => `${k % 24}h`);
          g.append('g').selectAll('text').data(ticks).join('text').attr('class', 'lab-direct').attr('y', 48 * ch + 14).attr('x', k => k * cw + cw / 2).attr('text-anchor', 'middle').text(k => `${k % 24}h`);
          g.append('line').attr('x1', 24 * cw).attr('x2', 24 * cw).attr('y1', 0).attr('y2', 48 * ch).style('stroke', col('--paper')).attr('stroke-width', 2);
          g.append('line').attr('y1', 24 * ch).attr('y2', 24 * ch).attr('x1', 0).attr('x2', 48 * cw).style('stroke', col('--paper')).attr('stroke-width', 2);
          g.append('text').attr('class', 'lab-strong').attr('x', 12 * cw).attr('y', 48 * ch + 28).attr('text-anchor', 'middle').text('working days');
          g.append('text').attr('class', 'lab-strong').attr('x', 36 * cw).attr('y', 48 * ch + 28).attr('text-anchor', 'middle').text('weekends');
        },
      });
    },
    'fig-mirror': fig => {
      const T = S.temporal.commute.top;
      const name = i => C.name[i].split(',')[0];
      const pts = [];
      T.forEach(([a, b, am, back, same]) => {
        pts.push({ x: am, y: back + 0.5, r: 3, color: col('--sink'), opacity: 0.7, z: 1, tip: `<b>${name(a)} → ${name(b)}</b><br>morning ${fmt.int(am)}<br>evening back ${fmt.int(back)}` });
        pts.push({ x: am, y: same + 0.5, r: 2.4, color: col('--ink-3'), opacity: 0.5, z: 0, tip: `<b>${name(a)} → ${name(b)}</b><br>morning ${fmt.int(am)}<br>evening, same way ${fmt.int(same)}` });
      });
      const hi = d3.max(T, t => Math.max(t[2], t[3])) * 1.2;
      const leg = document.createElement('div');
      leg.className = 'legend';
      leg.innerHTML = `<span><i class="dot" style="background:${col('--sink')}"></i>evening trips back, j → i</span><span><i class="dot" style="background:${col('--ink-3')}"></i>evening trips the same way, i → j</span>`;
      fig.insertBefore(leg, fig.querySelector('.plot'));
      scatter(fig, {
        height: W => Math.min(340, W * 0.75), x: { type: 'log', domain: [d3.min(T, t => t[2]) * 0.9, hi], label: 'morning trips i → j, May', format: '~s' },
        y: { type: 'log', domain: [0.5, hi], label: 'evening trips (+0.5 so zero shows)', format: v => (v < 1 ? '0' : d3.format('~s')(v)) }, points: pts,
        lines: [{ points: [[0.5, 0.5], [hi, hi]], dash: true, color: col('--ink-3'), width: 1 }],
        table: { columns: ['Morning link', 'Morning', 'Evening back', 'Evening same way'], rows: T.slice(0, 40).map(t => [`${name(t[0])} → ${name(t[1])}`, t[2], t[3], t[4]]) },
      });
    },
    'arche-grid': el => {
      const P = S.temporal.archetypes.profiles;
      const cat = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];
      multiples(el, P.map(p => ({
        title: `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col(cat[p.id])};margin-right:6px"></span>${p.name} <span class="muted" style="font-weight:400">${p.stations}</span>`,
        note: p.blurb,
        series: [
          { name: 'Departures', color: col('--source'), points: p.work.dep.map((v, h) => [h, v]), smooth: true },
          { name: 'Arrivals', color: col('--sink'), points: p.work.arr.map((v, h) => [h, v]), smooth: true },
        ],
        onHover: on => scenes.highlightArchetype(on ? p.id : -1),
      })), { min: 210, height: 112, shared: true, x: { domain: [0, 23], ticks: 4, format: d => `${d}h`, tipFormat: v => hh(v) }, y: { ticks: 3, tipFormat: v => `${fmt.f1(v)} per hour` } });
      const leg = document.createElement('div');
      leg.className = 'legend';
      leg.innerHTML = `<span><i style="background:${col('--source')}"></i>departures per station per hour, working days</span><span><i style="background:${col('--sink')}"></i>arrivals</span>`;
      el.parentNode.insertBefore(leg, el);
    },
    'fig-mixing-time': fig => {
      const tv = S.dynamics.markov.tv;
      lines(fig, {
        height: W => Math.min(240, W * 0.5), x: { label: 'rides', domain: [0, tv.length - 1], tipFormat: v => `after ${v} rides` }, y: { domain: [0, 1], label: 'total variation distance', tipFormat: fmt.f2 },
        series: [{ name: 'Distance from long-run distribution', color: col('--c1'), points: tv.map((v, k) => [k, v]), dots: true }],
      });
    },
    'fig-validation': fig => {
      const v = S.dynamics.validation.binned;
      const pts = v.x.map((x, k) => [x, v.y[k][0], v.y[k][1], v.y[k][2]]);
      lines(fig, {
        height: W => Math.min(320, W * 0.68), x: { label: 'riders\' net arrivals that hour, May (trips)', domain: [-6, 6], tipFormat: x => `${fmt.f2(x - 0.25)} to ${fmt.f2(x + 0.25)} trips` },
        y: { label: 'change in bikes docked, September', domain: [-6, 6], tipFormat: fmt.f2 },
        series: [
          { name: 'Observed change (mean)', color: col('--c1'), points: pts.map(p => [p[0], p[1]]), band: pts, dots: true },
          { name: 'Perfect agreement', color: col('--ink-3'), points: [[-6, -6], [6, 6]], dash: true, width: 1, noTip: true },
        ],
        notes: [{ x: 0.6, y: -4.6, text: `fitted slope ${fmt.f2(S.dynamics.validation.slope)}`, anchor: "start", dy: 0 }],
        table: { columns: ['Net arrivals (May)', 'Mean change (Sept)', '25th pct', '75th pct', 'Station-hours'], rows: v.x.map((x, k) => [fmt.f2(x), fmt.f2(v.y[k][0]), fmt.f2(v.y[k][1]), fmt.f2(v.y[k][2]), fmt.int(v.y[k][3])]) },
      });
    },
    'fig-vans': fig => {
      const pts = d3.range(n).filter(i => C.active[i]).map(i => ({
        x: C.tripNet[i], y: C.vanGiven[i] - C.vanTaken[i], r: 2.8, opacity: 0.6, color: col('--c1'), i,
        tip: `<b>${C.name[i]}</b><br>riders: ${C.tripNet[i] >= 0 ? '+' : ''}${fmt.int(C.tripNet[i])}<br>operator: ${C.vanGiven[i] - C.vanTaken[i] >= 0 ? '+' : ''}${fmt.int(C.vanGiven[i] - C.vanTaken[i])}`,
      }));
      const ext = d3.max(pts, p => Math.max(Math.abs(p.x), Math.abs(p.y)));
      scatter(fig, {
        height: W => Math.min(340, W * 0.75), x: { domain: [-ext, ext], label: 'riders\' net arrivals, May', format: '~s' }, y: { domain: [-ext, ext], label: 'operator\'s net deliveries', format: '~s' },
        points: pts, lines: [{ points: [[-ext, ext], [ext, -ext]], dash: true, color: col('--ink-3'), width: 1 }],
        labels: [{ x: -ext * 0.92, y: ext * 0.62, text: 'dashed: perfect mirror', dx: 0 }],
        onClick: p => explorer.open(p.i, { scroll: true, select: true }),
      });
    },
    'fig-van-hours': fig => {
      const b = S.dynamics.relocation.byHour;
      lines(fig, {
        height: W => Math.min(220, W * 0.45), x: { domain: [0, 23], label: 'hour bike reappeared', format: d => `${d}h`, tipFormat: v => `${hh(v)}–${hh(v + 1)}` },
        y: { label: 'relocated bikes, all May', format: '~s', tipFormat: fmt.int },
        series: [{ name: 'Relocations', color: col('--c5'), points: b.map((v, h) => [h, v]), area: true, smooth: true }],
      });
    },
    'fig-attack': fig => {
      const R = S.robustness, f = R.fractions;
      const spec = [['strength', 'Busiest first', '--c2'], ['betweenness', 'Highest betweenness', '--c1'], ['participation', 'Most cross-region', '--c3'], ['centre', 'Centre outwards', '--c4'], ['random', 'Random (mean of 20)', '--ink-3']];
      lines(fig, {
        height: W => Math.min(300, W * 0.6), x: { domain: [0, 0.5], label: 'share of stations closed', format: d3.format('.0%'), tipFormat: d3.format('.1%') },
        y: { domain: [0, 1], label: 'largest connected share', format: d3.format('.0%'), tipFormat: d3.format('.0%') },
        series: spec.map(([k, name, c]) => ({ name, color: col(c), points: f.map((x, j) => [x, R.attacks[k].giant[j]]), dash: k === 'random' })),
        table: { columns: ['Closed', ...spec.map(s => `${s[1]}: journeys kept`)], rows: f.map((x, j) => [fmt.pct0(x), ...spec.map(s => fmt.pct0(R.attacks[s[0]].trips[j]))]) },
      });
    },
    'fig-percolation': fig => {
      const P = S.robustness.percolation.curves;
      lines(fig, {
        height: W => Math.min(280, W * 0.55), x: { domain: [0, 1], label: 'share of backbone links removed', format: d3.format('.0%'), tipFormat: d3.format('.0%') },
        y: { domain: [0, 1], label: 'largest connected share', format: d3.format('.0%'), tipFormat: d3.format('.1%') },
        series: [
          { name: 'Weakest links removed first', color: col('--c2'), points: P.weakFirst.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0]), label: 'weakest first', labelAt: 0.9, labelDx: -10, labelDy: 14, labelAnchor: 'end' },
          { name: 'Strongest links removed first', color: col('--c1'), points: P.strongFirst.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0]), label: 'strongest first', labelAt: 0.9, labelDx: -10, labelDy: -14, labelAnchor: 'end' },
        ],
      });
    },
    'layer-table': el => {
      const L = S.layers;
      const cols = [['classic', 'Classic'], ['electric', 'Electric'], ['work', 'Weekdays'], ['free', 'Weekends']];
      const rows = [
        ['Journeys per day', k => fmt.int(L[k].perDay)], ['Links used', k => fmt.int(L[k].edges)], ['Median distance', k => `${fmt.f2(L[k].medianKm)} km`],
        ['Distance decay per km', k => fmt.f2(L[k].beta)], ['Trip weight returned', k => fmt.pct0(L[k].reciprocity)],
        ['Leiden regions', k => L[k].communities], ['Modularity', k => fmt.f2(L[k].modularity)], ['Agreement with all-trip regions (NMI)', k => fmt.f2(L[k].nmiGlobal)],
      ];
      el.classList.add('layers');
      el.innerHTML = `<thead><tr><td></td>${cols.map(c => `<th scope="col">${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(([name, f]) => `<tr><td>${name}</td>${cols.map(c => `<td>${f(c[0])}</td>`).join('')}</tr>`).join('')}</tbody>`;
    },
    'fig-ebike': fig => {
      const e = S.ebikeByKm;
      lines(fig, {
        height: W => Math.min(240, W * 0.5), x: { label: 'km between docks', tipFormat: v => `${fmt.f2(v - 0.25)}–${fmt.f2(v + 0.25)} km` }, y: { domain: [0, 0.6], label: 'e-bike share', format: d3.format('.0%'), tipFormat: d3.format('.1%') },
        series: [{ name: 'E-bike share', color: col('--c2'), points: e.map(r => [r[0], r[1]]), dots: true }],
      });
    },
    'fig-spectrum': fig => {
      const sp = S.embedding.spectrum;
      lines(fig, {
        height: W => Math.min(240, W * 0.5), x: { domain: [1, sp.length], label: 'eigenvalue index', tipFormat: v => `λ${v}` }, y: { domain: [0, 1], label: 'eigenvalue', tipFormat: fmt.f3 },
        series: [{ name: 'Eigenvalue', color: col('--c1'), points: sp.map((v, k) => [k + 1, v]), dots: true, pointsOnly: true }],
        notes: [{ x: 2.5, y: (sp[1] + sp[2]) / 2, text: 'largest gap', anchor: 'start', dy: 4, strong: true }],
      });
    },
  };

  // Draw each figure as it approaches the viewport; a failure stays contained to its figure.
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      try { draws[e.target.id](e.target); } catch (err) {
        console.error(e.target.id, err);
        e.target.insertAdjacentHTML('beforeend', '<p class="err">This chart could not be drawn.</p>');
      }
    }
  }, { rootMargin: '600px 0px' });
  Object.keys(draws).forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
}

function legendRoles(fig, colors) {
  const el = document.createElement('div');
  el.className = 'legend';
  el.innerHTML = [2, 3, 5, 6].map(r => `<span><i class="dot" style="background:${colors[r]}"></i>${ROLE_NAMES[r]}</span>`).join('');
  fig.insertBefore(el, fig.querySelector('.plot'));
}
