// Small SVG chart kit on top of d3: every chart is responsive, has a hover layer and a data table.

const tip = document.createElement('div');
tip.className = 'tooltip';
tip.setAttribute('role', 'status');
document.body.appendChild(tip);

export function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  const left = x + 14 + r.width > window.innerWidth - 8 ? x - r.width - 14 : x + 14;
  const top = Math.min(Math.max(8, y - r.height / 2), window.innerHeight - r.height - 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
export function hideTip() { tip.classList.remove('on'); }

export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const fmt = {
  int: d3.format(',.0f'),
  k: v => (Math.abs(v) >= 1000 ? d3.format('.3~s')(v).replace('G', 'B') : d3.format(',.0f')(v)),
  pct: d3.format('.1%'),
  pct0: d3.format('.0%'),
  f1: d3.format(',.1f'),
  f2: d3.format(',.2f'),
  f3: d3.format(',.3f'),
  sig: d3.format('.3~g'),
};

// A figure: <figure class="chart"><div class="plot"></div><figcaption>…</figcaption></figure>
function frame(fig, opts, draw) {
  const plot = fig.querySelector('.plot') || fig.appendChild(Object.assign(document.createElement('div'), { className: 'plot' }));
  let lastW = 0;
  const render = () => {
    const W = Math.max(260, Math.round(plot.getBoundingClientRect().width));
    if (W === lastW) return;
    lastW = W;
    const H = typeof opts.height === 'function' ? opts.height(W) : (opts.height || Math.round(W * 0.62));
    const m = { top: 24, right: 18, bottom: 40, left: 52, ...(opts.margin || {}) };
    plot.innerHTML = '';
    const svg = d3.select(plot).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', opts.label || fig.querySelector('figcaption')?.textContent || '');
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    draw({ svg, g, W, H, w: W - m.left - m.right, h: H - m.top - m.bottom, m });
  };
  render();
  new ResizeObserver(() => render()).observe(plot);
  if (opts.table) addTable(fig, opts.table);
  return { rerender: () => { lastW = 0; render(); } };
}

export function addTable(fig, { columns, rows }) {
  if (fig.querySelector('.show-data')) return;
  const d = document.createElement('details');
  d.className = 'show-data';
  d.innerHTML = '<summary>Show the numbers</summary>';
  d.addEventListener('toggle', () => {
    if (!d.open || d.querySelector('table')) return;
    const wrap = document.createElement('div');
    wrap.className = 'datatable-wrap';
    const t = document.createElement('table');
    t.className = 'datatable';
    t.innerHTML = `<thead><tr>${columns.map(c => `<th scope="col">${c}</th>`).join('')}</tr></thead>` +
      `<tbody>${rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody>`;
    wrap.appendChild(t);
    d.appendChild(wrap);
  });
  fig.appendChild(d);
}

function scale(spec, range) {
  const s = spec.type === 'log' ? d3.scaleLog() : spec.type === 'band' ? d3.scaleBand().padding(spec.padding ?? 0.25) : d3.scaleLinear();
  s.domain(spec.domain).range(range);
  if (spec.nice && spec.type !== 'band') s.nice();
  return s;
}

function axes(g, x, y, w, h, X, Y) {
  // Accept either a d3-format specifier or a function on every axis.
  X = { ...X, format: typeof X.format === 'string' && X.type !== 'log' ? d3.format(X.format) : X.format };
  Y = { ...Y, format: typeof Y.format === 'string' && Y.type !== 'log' ? d3.format(Y.format) : Y.format };
  const xt = X.type === 'log' ? d3.axisBottom(x).ticks(Math.max(2, Math.round(w / 90)), X.format || '~s')
    : d3.axisBottom(x).ticks(X.ticks || Math.max(3, Math.round(w / 80))).tickFormat(X.format || null);
  const yt = Y.type === 'log' ? d3.axisLeft(y).ticks(Math.max(2, Math.round(h / 50)), Y.format || '~g')
    : d3.axisLeft(y).ticks(Y.ticks || Math.max(3, Math.round(h / 50))).tickFormat(Y.format || null);
  // Log axes get gridlines at powers of ten only; minor ticks would turn the grid into stripes.
  const decades = s => s.ticks().filter(v => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9);
  if (X.tickValues) xt.tickValues(X.tickValues);
  if (Y.tickValues) yt.tickValues(Y.tickValues);
  if (Y.type !== 'band') {
    const grid = d3.axisLeft(y).tickSize(-w).tickFormat('');
    if (Y.type === 'log') grid.tickValues(decades(y)); else grid.ticks(Y.ticks || Math.max(3, Math.round(h / 50)));
    g.append('g').attr('class', 'grid').call(grid);
  }
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`).call(xt.tickSizeOuter(0));
  g.append('g').attr('class', 'axis').call(yt.tickSizeOuter(0));
  if (X.label) g.append('text').attr('class', 'axis-label').attr('x', w).attr('y', h + 32).attr('text-anchor', 'end').text(X.label);
  if (Y.label) g.append('text').attr('class', 'axis-label').attr('x', -4).attr('y', -12).attr('text-anchor', 'start').text(Y.label);
}

export function legend(fig, items) {
  const el = document.createElement('div');
  el.className = 'legend';
  el.innerHTML = items.map(it => `<span><i class="${it.kind || ''}" style="background:${it.color};color:${it.color}"></i>${it.name}</span>`).join('');
  fig.insertBefore(el, fig.querySelector('.plot'));
}

// Lines (and optional points) sharing one x axis, with a crosshair tooltip.
export function lines(fig, o) {
  if (o.series.length > 1 && o.legend !== false) legend(fig, o.series.map(s => ({ name: s.name, color: s.color, kind: s.dash ? 'dash' : '' })));
  return frame(fig, o, ({ g, w, h }) => {
    const all = o.series.flatMap(s => s.points);
    const X = { nice: true, ...o.x, domain: o.x.domain || d3.extent(all, p => p[0]) };
    const Y = { nice: true, ...o.y, domain: o.y.domain || [o.y.type === 'log' ? d3.min(all, p => p[1]) : Math.min(0, d3.min(all, p => p[1])), d3.max(all, p => p[1])] };
    const x = scale(X, [0, w]), y = scale(Y, [h, 0]);
    axes(g, x, y, w, h, X, Y);
    (o.bands || []).forEach(b => g.append('rect').attr('x', x(b[0])).attr('width', x(b[1]) - x(b[0])).attr('y', 0).attr('height', h).style('fill', b[2] || 'var(--paper-2)'));
    (o.refs || []).forEach(rf => {
      if (rf.y !== undefined) g.append('line').attr('x1', 0).attr('x2', w).attr('y1', y(rf.y)).attr('y2', y(rf.y)).style('stroke', 'var(--chart-axis)').attr('stroke-dasharray', '3 3');
      if (rf.x !== undefined) g.append('line').attr('y1', 0).attr('y2', h).attr('x1', x(rf.x)).attr('x2', x(rf.x)).style('stroke', 'var(--chart-axis)').attr('stroke-dasharray', '3 3');
      if (rf.text) g.append('text').attr('class', 'lab-direct').attr('x', rf.x !== undefined ? x(rf.x) + 4 : (rf.start ? 4 : w - 2)).attr('y', rf.y !== undefined ? y(rf.y) - 5 : 10).attr('text-anchor', rf.x !== undefined || rf.start ? 'start' : 'end').text(rf.text);
    });
    for (const s of o.series) {
      const pts = s.points.filter(p => p[1] !== null && isFinite(p[1]) && (Y.type !== 'log' || p[1] > 0) && (X.type !== 'log' || p[0] > 0));
      const gen = d3.line().x(p => x(p[0])).y(p => y(p[1])).curve(s.step ? d3.curveStepAfter : (s.smooth ? d3.curveMonotoneX : d3.curveLinear));
      if (s.area) g.append('path').attr('d', d3.area().x(p => x(p[0])).y0(h).y1(p => y(p[1])).curve(s.smooth ? d3.curveMonotoneX : d3.curveLinear)(pts)).style('fill', s.color).attr('opacity', 0.1);
      if (s.band) g.append('path').attr('d', d3.area().x(p => x(p[0])).y0(p => y(p[2])).y1(p => y(p[3]))(s.band)).style('fill', s.color).attr('opacity', 0.14);
      if (!s.pointsOnly) g.append('path').attr('d', gen(pts)).style('fill', 'none').style('stroke', s.color).attr('stroke-width', s.width || 2)
        .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('stroke-dasharray', s.dash ? '5 4' : null).attr('opacity', s.opacity ?? 1);
      if (s.dots) g.append('g').selectAll('circle').data(pts).join('circle').attr('cx', p => x(p[0])).attr('cy', p => y(p[1])).attr('r', s.r || 3.2)
        .style('fill', s.color).style('stroke', 'var(--paper)').attr('stroke-width', 1.5).attr('opacity', s.dotOpacity ?? 1);
      if (s.label) {
        const last = pts[pts.length - 1];
        const at = s.labelAt ? pts.reduce((a, p) => Math.abs(p[0] - s.labelAt) < Math.abs(a[0] - s.labelAt) ? p : a, pts[0]) : last;
        g.append('text').attr('class', 'lab-direct').attr('x', x(at[0]) + (s.labelDx ?? 6)).attr('y', y(at[1]) + (s.labelDy ?? 0)).attr('dy', '0.32em')
          .attr('text-anchor', s.labelAnchor || 'start').text(s.label);
      }
    }
    (o.notes || []).forEach(nt => g.append('text').attr('class', nt.strong ? 'lab-strong' : 'lab-direct').attr('x', x(nt.x)).attr('y', y(nt.y)).attr('dy', nt.dy ?? -8)
      .attr('text-anchor', nt.anchor || 'middle').text(nt.text));
    // crosshair
    const cross = g.append('line').attr('y1', 0).attr('y2', h).style('stroke', 'var(--ink-3)').attr('stroke-width', 1).attr('opacity', 0);
    const marks = g.append('g');
    g.append('rect').attr('width', w).attr('height', h).style('fill', 'transparent')
      .on('pointermove', e => {
        const [mx] = d3.pointer(e);
        const xv = x.invert(mx);
        const rows = o.series.filter(s => !s.noTip).map(s => {
          const pts = s.points.filter(p => p[1] !== null);
          const p = pts.reduce((a, q) => (Math.abs(q[0] - xv) < Math.abs(a[0] - xv) ? q : a), pts[0]);
          return { s, p };
        });
        const px = rows[0].p[0];
        cross.attr('x1', x(px)).attr('x2', x(px)).attr('opacity', 0.5);
        marks.selectAll('circle').data(rows).join('circle').attr('cx', d => x(d.p[0])).attr('cy', d => y(d.p[1])).attr('r', 4.5)
          .style('fill', d => d.s.color).style('stroke', 'var(--paper)').attr('stroke-width', 2);
        const xs = o.x.tipFormat ? o.x.tipFormat(px) : fmt.sig(px);
        showTip(`<b>${xs}</b>` + rows.map(d => `<br><span style="color:${d.s.color}">●</span> ${d.s.name}: ${(o.y.tipFormat || fmt.sig)(d.p[1])}`).join(''), e.clientX, e.clientY);
      })
      .on('pointerleave', () => { cross.attr('opacity', 0); marks.selectAll('*').remove(); hideTip(); });
  });
}

// Scatter of individual points with per-point tooltips.
export function scatter(fig, o) {
  return frame(fig, o, ({ g, w, h }) => {
    const X = { nice: true, ...o.x, domain: o.x.domain || d3.extent(o.points, p => p.x) };
    const Y = { nice: true, ...o.y, domain: o.y.domain || d3.extent(o.points, p => p.y) };
    const x = scale(X, [0, w]), y = scale(Y, [h, 0]);
    axes(g, x, y, w, h, X, Y);
    (o.regions || []).forEach(rg => {
      g.append('rect').attr('x', x(rg.x0)).attr('width', x(rg.x1) - x(rg.x0)).attr('y', y(rg.y1)).attr('height', y(rg.y0) - y(rg.y1)).style('fill', rg.fill || 'var(--paper-2)');
      if (rg.text) g.append('text').attr('class', 'lab-direct').attr('x', x(rg.x0) + 6).attr('y', y(rg.y1) + 14).text(rg.text);
    });
    const clip = `clip-${Math.random().toString(36).slice(2)}`;
    g.append('clipPath').attr('id', clip).append('rect').attr('width', w).attr('height', h);
    (o.lines || []).forEach(L => g.append('path').attr('clip-path', `url(#${clip})`).attr('d', d3.line().x(p => x(p[0])).y(p => y(p[1]))(L.points)).style('fill', 'none').style('stroke', L.color || 'var(--ink-3)').attr('stroke-width', L.width || 1.5).attr('stroke-dasharray', L.dash ? '5 4' : null));
    const sorted = [...o.points].sort((a, b) => (a.z || 0) - (b.z || 0));
    g.append('g').selectAll('circle').data(sorted).join('circle')
      .attr('cx', p => x(p.x)).attr('cy', p => y(p.y)).attr('r', p => p.r || 3).style('fill', p => p.color || 'var(--c1)')
      .attr('opacity', p => p.opacity ?? 0.75).style('stroke', 'var(--paper)').attr('stroke-width', p => (p.r || 3) > 3.5 ? 1.5 : 0.6)
      .style('cursor', o.onClick ? 'pointer' : null)
      .on('pointermove', (e, p) => p.tip && showTip(p.tip, e.clientX, e.clientY))
      .on('pointerleave', hideTip)
      .on('click', (e, p) => o.onClick && o.onClick(p));
    (o.labels || []).forEach(L => g.append('text').attr('class', 'lab-direct').attr('x', x(L.x) + (L.dx ?? 7)).attr('y', y(L.y) + (L.dy ?? 0)).attr('dy', '0.32em').attr('text-anchor', L.anchor || 'start').text(L.text));
  });
}

// Horizontal bars, diverging around zero when values are negative.
export function hbars(fig, o) {
  const rowH = o.rowHeight || 24;
  return frame(fig, { ...o, height: () => o.rows.length * rowH + 40, margin: { left: o.labelWidth || 120, right: 48, top: 6, bottom: 30, ...(o.margin || {}) } }, ({ g, w, h }) => {
    const lo = Math.min(0, d3.min(o.rows, r => r.value)), hi = Math.max(0, d3.max(o.rows, r => r.value));
    const x = (o.log ? d3.scaleSymlog().constant(o.log) : d3.scaleLinear()).domain([lo, hi]).range([0, w]).nice();
    const y = d3.scaleBand().domain(o.rows.map(r => r.name)).range([0, h]).padding(0.28);
    g.append('g').attr('class', 'grid').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.round(w / 90))).tickSize(-h).tickFormat(''));
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.round(w / 90)), o.format || '~s').tickSizeOuter(0));
    g.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h).style('stroke', 'var(--chart-axis)');
    const bh = Math.min(y.bandwidth(), 18);
    g.append('g').selectAll('path').data(o.rows).join('path')
      .attr('d', r => {
        const x0 = x(0), x1 = x(r.value), top = y(r.name) + (y.bandwidth() - bh) / 2, rad = Math.min(4, Math.abs(x1 - x0));
        if (x1 >= x0) return `M${x0},${top}H${x1 - rad}Q${x1},${top} ${x1},${top + rad}V${top + bh - rad}Q${x1},${top + bh} ${x1 - rad},${top + bh}H${x0}Z`;
        return `M${x0},${top}H${x1 + rad}Q${x1},${top} ${x1},${top + rad}V${top + bh - rad}Q${x1},${top + bh} ${x1 + rad},${top + bh}H${x0}Z`;
      })
      .style('fill', r => r.color || 'var(--c1)')
      .on('pointermove', (e, r) => showTip(r.tip || `<b>${r.name}</b><br>${fmt.sig(r.value)}`, e.clientX, e.clientY))
      .on('pointerleave', hideTip);
    g.append('g').selectAll('text').data(o.rows).join('text').attr('class', 'lab-direct')
      .attr('x', -8).attr('y', r => y(r.name) + y.bandwidth() / 2).attr('dy', '0.32em').attr('text-anchor', 'end').text(r => r.label || r.name);
    g.append('g').selectAll('text').data(o.rows).join('text').attr('class', 'lab-direct')
      // Negative values are labelled just right of zero so they never collide with the row names.
      .attr('x', r => (r.value >= 0 ? x(r.value) + 5 : x(0) + 5)).attr('y', r => y(r.name) + y.bandwidth() / 2).attr('dy', '0.32em')
      .attr('text-anchor', 'start').text(r => r.valueLabel ?? (o.valueFormat || fmt.sig)(r.value));
  });
}

// Square-cell matrix heatmap.
export function heatmap(fig, o) {
  return frame(fig, { ...o, height: W => Math.min(W, o.maxHeight || 560) * (o.aspect || 1), margin: { top: 8, right: 8, bottom: o.bottom ?? 34, left: o.left ?? 40 } }, ({ g, w, h }) => {
    const rows = o.matrix.length, cols = o.matrix[0].length;
    const size = Math.min(w / cols, h / rows);
    const cw = size, ch = size;
    const cells = [];
    o.matrix.forEach((row, i) => row.forEach((v, j) => cells.push({ i, j, v })));
    g.append('g').selectAll('rect').data(cells).join('rect')
      .attr('x', c => c.j * cw).attr('y', c => c.i * ch).attr('width', Math.max(0.5, cw - (o.gap ?? 1))).attr('height', Math.max(0.5, ch - (o.gap ?? 1)))
      .attr('rx', o.round ? 2 : 0).style('fill', c => o.color(c.v, c))
      .on('pointermove', (e, c) => o.tip && showTip(o.tip(c), e.clientX, e.clientY))
      .on('pointerleave', hideTip);
    if (o.rowLabels) g.append('g').selectAll('text').data(o.rowLabels).join('text').attr('class', 'lab-direct')
      .attr('x', -6).attr('y', (d, i) => i * ch + ch / 2).attr('dy', '0.32em').attr('text-anchor', 'end').text(d => d);
    if (o.colLabels && o.rotateCols) g.append('g').selectAll('text').data(o.colLabels).join('text').attr('class', 'lab-direct')
      .attr('transform', (d, j) => `translate(${j * cw + cw / 2 + 4},${rows * ch + 8}) rotate(-40)`).attr('text-anchor', 'end').text(d => d);
    else if (o.colLabels) g.append('g').selectAll('text').data(o.colLabels).join('text').attr('class', 'lab-direct')
      .attr('x', (d, j) => j * cw + cw / 2).attr('y', rows * ch + 14).attr('text-anchor', 'middle').text(d => d);
    if (o.cellText) g.append('g').selectAll('text').data(cells).join('text')
      .attr('x', c => c.j * cw + cw / 2).attr('y', c => c.i * ch + ch / 2).attr('dy', '0.32em').attr('text-anchor', 'middle')
      .attr('font-size', Math.min(12, cw / 3.6)).style('fill', c => o.textColor ? o.textColor(c.v) : 'var(--ink)').attr('pointer-events', 'none').text(c => o.cellText(c.v, c));
    if (o.after) o.after(g, { cw, ch, rows, cols });
  });
}

// Grid of counts (2-D histogram) drawn as cells on numeric axes.
export function density(fig, o) {
  return frame(fig, o, ({ g, w, h }) => {
    const { xEdges, yEdges, counts } = o;
    const x = d3.scaleLinear().domain([xEdges[0], xEdges[xEdges.length - 1]]).range([0, w]);
    const y = d3.scaleLinear().domain([yEdges[0], yEdges[yEdges.length - 1]]).range([h, 0]);
    const max = d3.max(counts.flat());
    const c = d3.scaleSequentialLog(d3.interpolateRgb(o.low || css('--paper-2'), o.high || css('--c1'))).domain([1, max]);
    const cells = [];
    counts.forEach((row, i) => row.forEach((v, j) => v > 0 && cells.push({ i, j, v })));
    g.append('g').selectAll('rect').data(cells).join('rect')
      .attr('x', d => x(xEdges[d.i])).attr('y', d => y(yEdges[d.j + 1]))
      .attr('width', d => x(xEdges[d.i + 1]) - x(xEdges[d.i]) + 0.5).attr('height', d => y(yEdges[d.j]) - y(yEdges[d.j + 1]) + 0.5)
      .style('fill', d => c(d.v))
      .on('pointermove', (e, d) => showTip(o.tip(d, xEdges, yEdges), e.clientX, e.clientY)).on('pointerleave', hideTip);
    const X = { ...o.x, domain: x.domain() }, Y = { ...o.y, domain: y.domain() };
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(typeof o.x.format === 'string' ? d3.format(o.x.format) : o.x.format).tickSizeOuter(0));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickFormat(typeof o.y.format === 'string' ? d3.format(o.y.format) : o.y.format).tickSizeOuter(0));
    if (X.label) g.append('text').attr('class', 'axis-label').attr('x', w).attr('y', h + 32).attr('text-anchor', 'end').text(X.label);
    if (Y.label) g.append('text').attr('class', 'axis-label').attr('x', -4).attr('y', -4).text(Y.label);
    (o.lines || []).forEach(L => g.append('path').attr('d', d3.line().x(p => x(p[0])).y(p => y(p[1]))(L.points)).style('fill', 'none').style('stroke', L.color || 'var(--ink-2)').attr('stroke-width', 1.5).attr('stroke-dasharray', L.dash ? '5 4' : null));
    (o.labels || []).forEach(L => g.append('text').attr('class', 'lab-direct').attr('x', x(L.x)).attr('y', y(L.y)).attr('text-anchor', L.anchor || 'start').text(L.text));
  });
}

// Small multiples of the same mini line chart, each with its own title.
export function multiples(container, items, o) {
  container.innerHTML = '';
  container.style.display = 'grid';
  container.style.gridTemplateColumns = `repeat(auto-fill, minmax(${o.min || 150}px, 1fr))`;
  container.style.gap = '14px 18px';
  const yMax = o.shared ? d3.max(items.flatMap(it => it.series.flatMap(s => s.points.map(p => p[1])))) : null;
  for (const it of items) {
    const fig = document.createElement('figure');
    fig.className = 'chart';
    fig.style.margin = '0';
    fig.innerHTML = `<div class="chart-title" style="font-size:.9rem">${it.title}</div><div class="plot"></div>${it.note ? `<figcaption>${it.note}</figcaption>` : ''}`;
    if (it.onHover) {
      fig.addEventListener('pointerenter', () => it.onHover(true));
      fig.addEventListener('pointerleave', () => it.onHover(false));
      fig.tabIndex = 0;
      fig.addEventListener('focus', () => it.onHover(true));
      fig.addEventListener('blur', () => it.onHover(false));
    }
    container.appendChild(fig);
    lines(fig, { height: o.height || 120, margin: { left: 30, bottom: 24, right: 8, top: 8 }, legend: false, x: { ...o.x }, y: { ...o.y, domain: yMax ? [0, yMax] : o.y.domain }, series: it.series });
  }
}
