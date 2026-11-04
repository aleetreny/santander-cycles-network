// The instrument: one canvas that every chapter reconfigures.
// Coordinates arrive in km (x east, y north) in four aligned layouts; the instrument tweens
// between them, draws the basemap only where geography is meaningful, and animates the day.

const NIGHT = '#0d1626';
const EASE = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const DIVERGE = d3.scaleLinear().domain([-1, -0.15, 0, 0.15, 1])
  .range(['#f2a33a', '#c7853f', '#5b6880', '#3f7fc9', '#5aa8ff']).clamp(true);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarse = window.matchMedia('(pointer: coarse)');

export class Instrument {
  constructor(stage, data) {
    this.stage = stage;
    this.data = data;
    this.n = data.stations.columns.id.length;
    this.canvas = stage.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tip = stage.querySelector('.map-tip');
    this.captionEl = stage.querySelector('.caption');
    this.legendEl = stage.querySelector('.legend-box');
    this.clockEl = stage.querySelector('.clock');
    this.layouts = data.stations.layouts;
    this.pos = this.layouts.geo.map(p => p.slice());
    this.from = null;
    this.target = 'geo';
    this.morph = 1;
    this.mapAlpha = 1;
    this.cfg = {};
    this.selected = -1;
    this.hover = -1;
    this.transform = d3.zoomIdentity;
    this.particles = [];
    this.pulse = null;
    this.listeners = {};
    this.screen = new Float32Array(this.n * 2);
    this.lastTick = performance.now();
    this.needs = true;
    this.setupZoom();
    this.setupPointer();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(stage);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, value) { (this.listeners[name] || []).forEach(fn => fn(value)); }

  // ---------- geometry ----------
  resize() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    const geo = this.layouts.geo;
    const xs = geo.map(p => p[0]), ys = geo.map(p => p[1]);
    const [x0, x1] = d3.extent(xs), [y0, y1] = d3.extent(ys);
    const small = r.width < 600;
    const padTop = small ? 44 : 84, padBottom = small ? 56 : 104, padX = small ? 14 : 36;
    const s = Math.min((r.width - 2 * padX) / (x1 - x0), (r.height - padTop - padBottom) / (y1 - y0));
    this.base = {
      s, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
      ox: r.width / 2, oy: padTop + (r.height - padTop - padBottom) / 2,
    };
    this.zoom.extent([[0, 0], [r.width, r.height]]).translateExtent([[-r.width, -r.height], [2 * r.width, 2 * r.height]]);
    this.draw();   // resizing clears the canvas; repaint now rather than on the next frame
  }

  project(x, y) {
    const b = this.base, t = this.transform;
    const sx = b.ox + (x - b.cx) * b.s, sy = b.oy - (y - b.cy) * b.s;
    return [t.x + t.k * sx, t.y + t.k * sy];
  }

  setupZoom() {
    this.zoom = d3.zoom().scaleExtent([0.7, 14])
      .filter(e => {
        if (e.type === 'wheel') return e.ctrlKey || e.metaKey;
        if (e.type.startsWith('touch')) return false;   // touch: buttons only, so the page still scrolls
        return !e.button;
      })
      .on('zoom', e => { this.transform = e.transform; this.request(); });
    d3.select(this.canvas).call(this.zoom);
    if (coarse.matches) this.canvas.style.touchAction = 'pan-y';
  }

  zoomBy(f) {
    const sel = d3.select(this.canvas).transition().duration(reduceMotion.matches ? 0 : 320);
    if (this.selected >= 0) {
      const [x, y] = this.project(...this.pos[this.selected]);
      this.zoom.scaleBy(sel, f, [x, y]);
    } else this.zoom.scaleBy(sel, f);
  }
  resetView() {
    this.fitted = null;
    d3.select(this.canvas).transition().duration(reduceMotion.matches ? 0 : 400).call(this.zoom.transform, d3.zoomIdentity);
  }

  // Frame a set of stations (in the target layout), leaving room for the caption and legend.
  fitTo(indices) {
    const key = indices.join(',');
    if (!indices.length || key === this.fitted || !this.base) return;
    this.fitted = key;
    const L = this.layouts[this.target];
    const b = this.base;
    const pts = indices.map(i => [b.ox + (L[i][0] - b.cx) * b.s, b.oy - (L[i][1] - b.cy) * b.s]);
    const [x0, x1] = d3.extent(pts, p => p[0]), [y0, y1] = d3.extent(pts, p => p[1]);
    const small = this.w < 600, top = small ? 50 : 90, bottom = small ? 60 : 110, side = small ? 40 : 90;
    const k = Math.max(1, Math.min(6, (this.w - 2 * side) / Math.max(x1 - x0, 1), (this.h - top - bottom) / Math.max(y1 - y0, 1)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const t = d3.zoomIdentity.translate(this.w / 2 - k * cx, top + (this.h - top - bottom) / 2 - k * cy).scale(k);
    d3.select(this.canvas).transition().duration(reduceMotion.matches ? 0 : 600).call(this.zoom.transform, t);
  }

  setupPointer() {
    const pick = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = -1, bd = 14 * 14;
      for (let i = 0; i < this.n; i++) {
        if (this.cfg.pickable && !this.cfg.pickable(i)) continue;
        const dx = this.screen[2 * i] - mx, dy = this.screen[2 * i + 1] - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return [best, mx, my];
    };
    this.canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const [i, mx, my] = pick(e);
      if (i !== this.hover) { this.hover = i; this.request(); }
      this.canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
      if (i >= 0) this.showTip(i, mx, my); else this.tip.style.display = 'none';
    });
    this.canvas.addEventListener('pointerleave', () => { this.hover = -1; this.tip.style.display = 'none'; this.request(); });
    let down = null;
    this.canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    this.canvas.addEventListener('click', e => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; // it was a drag
      const [i, mx, my] = pick(e);
      if (i >= 0) {
        this.emit('select', i);
        if (e.pointerType !== 'mouse') this.showTip(i, mx, my);
      } else {
        this.tip.style.display = 'none';
        this.emit('select', -1);
      }
    });
  }

  showTip(i, mx, my) {
    const S = this.data.stations.columns;
    const extra = this.cfg.tooltip ? this.cfg.tooltip(i) : '';
    this.tip.innerHTML = `<b>${S.name[i]}</b>${extra ? '<br>' + extra : ''}`;
    this.tip.style.display = 'block';
    const flip = mx > this.w - 280;
    this.tip.style.left = `${mx}px`;
    this.tip.style.top = `${Math.min(Math.max(my, 40), this.h - 40)}px`;
    this.tip.style.transform = flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)';
  }

  // ---------- configuration ----------
  set(cfg) {
    this.cfg = cfg;
    const layout = cfg.layout || 'geo';
    if (layout !== this.target) {
      this.from = this.pos.map(p => p.slice());
      this.target = layout;
      this.morph = reduceMotion.matches ? 1 : 0;
      this.morphStart = performance.now();
      if (this.morph === 1) this.pos = this.layouts[layout].map(p => p.slice());
    }
    this.captionEl.innerHTML = cfg.caption ? `${cfg.caption}${cfg.sub ? `<small>${cfg.sub}</small>` : ''}` : '';
    this.canvas.setAttribute('aria-label', (cfg.caption || 'Network map').replace(/<[^>]+>/g, ''));
    this.legendEl.innerHTML = cfg.legend || '';
    // Only the explorer frames the camera itself; leaving it restores the full view.
    if (cfg.fit) this.fitTo(cfg.fit);
    else if (this.fitted) this.resetView();
    this.prepareEdges();
    if (cfg.pulse) this.startPulse(cfg.pulse); else this.stopPulse();
    this.request();
  }

  update(partial) { this.set({ ...this.cfg, ...partial }); }

  prepareEdges() {
    // Sort edges by colour so the canvas changes state as rarely as possible.
    const edges = this.cfg.edges || [];
    this.edgeGroups = d3.groups(edges, e => e.color || '#7fa6d9');
  }

  select(i) { this.selected = i; this.request(); }

  request() { this.needs = true; }

  // ---------- the day in motion ----------
  startPulse(opt) {
    const P = this.data.pulse;
    if (!P) return;
    const kind = opt.kind || 'work';
    const restart = !this.pulse || this.pulse.kind !== kind;
    this.pulse = {
      kind, t: restart ? (this.pulse ? this.pulse.t : opt.start ?? 16) : this.pulse.t,
      playing: this.pulse ? this.pulse.playing : !reduceMotion.matches,
      speed: 1.1, spawnAcc: new Map(),
    };
    if (restart) this.particles = [];
    this.clockEl.classList.add('on');
    this.syncClock();
  }
  stopPulse() {
    if (!this.pulse) return;
    this.pulse = null;
    this.particles = [];
    this.clockEl.classList.remove('on');
  }
  setPulseTime(t) { if (this.pulse) { this.pulse.t = t; this.particles = []; this.syncClock(); this.request(); } }
  setPulseKind(kind) { if (this.pulse) { this.startPulse({ kind }); this.emit('pulsekind', kind); } }
  togglePlay(force) {
    if (!this.pulse) return;
    this.pulse.playing = force ?? !this.pulse.playing;
    this.syncClock();
  }
  syncClock() {
    if (!this.pulse) return;
    const t = this.pulse.t;
    const mins = Math.floor(t * this.data.pulse.binMinutes);
    const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
    this.clockEl.querySelector('.time').textContent = `${hh}:${mm}`;
    const slider = this.clockEl.querySelector('input');
    if (document.activeElement !== slider) slider.value = t.toFixed(2);
    const play = this.clockEl.querySelector('[data-act=play]');
    play.setAttribute('aria-label', this.pulse.playing ? 'Pause the day' : 'Play the day');
    play.innerHTML = this.pulse.playing
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>';
    this.clockEl.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === this.pulse.kind)));
    this.clockEl.querySelector('.daykind').textContent = this.pulse.kind === 'work'
      ? `typical working day, mean of ${this.data.pulse.work.days}` : `typical weekend or holiday, mean of ${this.data.pulse.free.days}`;
  }

  pulseFrame() {
    // Interpolated departures/arrivals per station at the current clock time.
    const P = this.data.pulse[this.pulse.kind];
    const bins = P.departures.length;
    const t = this.pulse.t, b0 = Math.floor(t) % bins, b1 = (b0 + 1) % bins, f = t - Math.floor(t);
    const dep = new Float32Array(this.n), arr = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      dep[i] = P.departures[b0][i] * (1 - f) + P.departures[b1][i] * f;
      arr[i] = P.arrivals[b0][i] * (1 - f) + P.arrivals[b1][i] * f;
    }
    return { dep, arr, links: P.links[b0] };
  }

  tickPulse(dt) {
    const p = this.pulse;
    if (p.playing) {
      p.t = (p.t + dt * p.speed) % this.data.pulse.work.departures.length;
      this.syncClock();
    }
    const frame = this.pulseFrame();
    this.frame = frame;
    if (reduceMotion.matches || !p.playing) return;
    // Spawn: one particle per ~0.9 trips per half hour on a link, per simulated second.
    const max = this.w < 600 ? 1400 : 4200;
    for (const [a, b, flow] of frame.links) {
      const key = a * 10000 + b;
      const acc = (p.spawnAcc.get(key) || Math.random()) + flow * dt * 1.5;
      const k = Math.floor(acc);
      p.spawnAcc.set(key, acc - k);
      for (let s = 0; s < k && this.particles.length < max; s++) {
        this.particles.push({ a, b, age: 0, life: 1.2 + Math.random() * 0.5 });
      }
    }
    for (const q of this.particles) q.age += dt;
    this.particles = this.particles.filter(q => q.age < q.life);
  }

  // ---------- drawing ----------
  loop(now) {
    // Transitions follow wall-clock time, so a slow or throttled device still lands on time.
    const real = Math.max(0, (now - this.lastTick) / 1000);
    const dt = Math.min(0.05, real);
    this.lastTick = now;
    let animating = false;
    if (this.morph < 1) {
      this.morph = Math.min(1, (now - this.morphStart) / 1300);
      const e = EASE(this.morph), to = this.layouts[this.target];
      for (let i = 0; i < this.n; i++) {
        this.pos[i][0] = this.from[i][0] + (to[i][0] - this.from[i][0]) * e;
        this.pos[i][1] = this.from[i][1] + (to[i][1] - this.from[i][1]) * e;
      }
      animating = true;
    }
    const wantMap = this.target === 'geo' && this.cfg.basemap !== false ? 1 : 0;
    if (Math.abs(this.mapAlpha - wantMap) > 0.01) {
      this.mapAlpha += (wantMap - this.mapAlpha) * (1 - Math.exp(-real * 5));
      animating = true;
    } else this.mapAlpha = wantMap;
    if (this.pulse) {
      this.tickPulse(dt);
      animating = animating || this.pulse.playing;
    }
    if (animating || this.needs) {
      this.needs = false;
      this.draw();
    }
    requestAnimationFrame(this.loop);
  }

  curve(ax, ay, bx, by, bend) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay;
    return [mx - dy * bend, my + dx * bend];
  }

  draw() {
    const ctx = this.ctx, dpr = this.dpr, k = this.transform.k;
    if (!this.base) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = NIGHT;
    ctx.fillRect(0, 0, this.w, this.h);
    for (let i = 0; i < this.n; i++) {
      const [x, y] = this.project(this.pos[i][0], this.pos[i][1]);
      this.screen[2 * i] = x; this.screen[2 * i + 1] = y;
    }
    if (this.mapAlpha > 0.01) this.drawBasemap();
    // Marks are tuned for a ~820 px map; narrower maps (phones) get proportionally finer marks.
    const ns = Math.min(1.15, Math.max(0.55, this.w / 820));
    const zk = Math.sqrt(k) * ns;

    // edges
    const edgeAlpha = this.cfg.edgeAlpha ?? 0.5;
    const bend = this.cfg.straight ? 0 : 0.16;
    // Additive blending only where it reads as glow (few links); dense layers would saturate to white.
    ctx.globalCompositeOperation = this.cfg.additive ? 'lighter' : 'source-over';
    ctx.lineCap = 'round';
    for (const [color, edges] of this.edgeGroups || []) {
      ctx.strokeStyle = color;
      for (const e of edges) {
        const ax = this.screen[2 * e.a], ay = this.screen[2 * e.a + 1];
        const bx = this.screen[2 * e.b], by = this.screen[2 * e.b + 1];
        ctx.globalAlpha = (e.alpha ?? edgeAlpha) * (e.a === this.selected || e.b === this.selected || this.selected < 0 || !this.cfg.dimOthers ? 1 : 0.25);
        ctx.lineWidth = (e.w || 1) * zk;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        if (bend) {
          const [cx, cy] = this.curve(ax, ay, bx, by, bend);
          ctx.quadraticCurveTo(cx, cy, bx, by);
        } else ctx.lineTo(bx, by);
        ctx.stroke();
        if (e.arrow) this.arrowHead(ax, ay, bx, by, bend, (e.w || 1) * zk);
      }
    }

    // particles of the moving day
    if (this.pulse && this.particles.length) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffe1ad';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (const q of this.particles) {
        const t = q.age / q.life, t0 = Math.max(0, t - 0.12);
        const ax = this.screen[2 * q.a], ay = this.screen[2 * q.a + 1];
        const bx = this.screen[2 * q.b], by = this.screen[2 * q.b + 1];
        const [cx, cy] = this.curve(ax, ay, bx, by, 0.16);
        const pt = s => [(1 - s) * (1 - s) * ax + 2 * (1 - s) * s * cx + s * s * bx, (1 - s) * (1 - s) * ay + 2 * (1 - s) * s * cy + s * s * by];
        const [x0, y0] = pt(t0), [x1, y1] = pt(t);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }

    // nodes
    ctx.globalCompositeOperation = 'source-over';
    const color = this.cfg.color, size = this.cfg.size, alpha = this.cfg.alpha;
    const frame = this.pulse ? this.frame : null;
    const order = this.cfg.order || null;
    const idx = order || d3.range(this.n);
    for (const i of idx) {
      if (!this.data.stations.columns.active[i] && !this.cfg.showInactive) continue;
      let r, fill, a = 1;
      if (frame) {
        const act = frame.dep[i] + frame.arr[i];
        r = 1.2 + Math.sqrt(act) * 1.55;
        fill = DIVERGE((frame.arr[i] - frame.dep[i]) / (act + 0.6));
        a = act < 0.05 ? 0.35 : 0.95;
      } else {
        r = size ? size(i) : 2.4;
        fill = color ? color(i) : '#8fa3c4';
        a = alpha ? alpha(i) : 0.92;
      }
      if (a <= 0.001 || r <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(this.screen[2 * i], this.screen[2 * i + 1], Math.max(0.8, r * zk), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // rings for hover and selection
    for (const [i, c, w] of [[this.hover, 'rgba(231,237,246,0.8)', 1.5], [this.selected, '#ffffff', 2.2]]) {
      if (i < 0) continue;
      const r = (frame ? 1.2 + Math.sqrt(frame.dep[i] + frame.arr[i]) * 1.55 : (size ? size(i) : 2.4)) * zk;
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(this.screen[2 * i], this.screen[2 * i + 1], Math.max(r, 3) + 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // labels: placed at a station or at layout coordinates; greedy collision avoidance
    const labels = typeof this.cfg.labels === 'function' ? this.cfg.labels(this) : (this.cfg.labels || []);
    if (labels.length) {
      ctx.textBaseline = 'middle';
      const boxes = [];
      for (const L of labels) {
        const px = (this.w < 600 ? 11 : 12.5) * (L.big ? 1.25 : 1);
        ctx.font = `${L.big ? 700 : 600} ${px}px "Bricolage Grotesque", system-ui, sans-serif`;
        let x, y;
        if (L.i !== undefined) { x = this.screen[2 * L.i]; y = this.screen[2 * L.i + 1]; }
        else[x, y] = this.project(L.x, L.y);
        const text = L.text, tw = ctx.measureText(text).width;
        const dx = L.center ? -tw / 2 : 8;
        const box = [x + dx - 3, y - 9, tw + 6, 18];
        if (box[0] < 4 || box[0] + box[2] > this.w - 4 || y < 50 || y > this.h - 40) continue;
        if (boxes.some(b => !(box[0] > b[0] + b[2] || box[0] + box[2] < b[0] || box[1] > b[1] + b[3] || box[1] + box[3] < b[1]))) continue;
        boxes.push(box);
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(13,22,38,0.92)';
        ctx.strokeText(text, x + dx, y);
        ctx.fillStyle = L.color || '#e7edf6';
        ctx.fillText(text, x + dx, y);
      }
    }
  }

  arrowHead(ax, ay, bx, by, bend, w) {
    const ctx = this.ctx;
    const [cx, cy] = bend ? this.curve(ax, ay, bx, by, bend) : [ax, ay];
    const ang = Math.atan2(by - cy, bx - cx);
    const L = 5 + w * 1.6;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - L * Math.cos(ang - 0.42), by - L * Math.sin(ang - 0.42));
    ctx.lineTo(bx - L * Math.cos(ang + 0.42), by - L * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  drawBasemap() {
    const ctx = this.ctx, g = this.data.geo, k = this.transform.k;
    if (!g) return;
    ctx.globalAlpha = this.mapAlpha;
    ctx.globalCompositeOperation = 'source-over';
    const path = (pts, close) => {
      ctx.beginPath();
      pts.forEach((p, j) => {
        const [x, y] = this.project(p[0], p[1]);
        if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      if (close) ctx.closePath();
    };
    ctx.fillStyle = '#132a26';
    for (const park of g.parks) for (const ring of park.rings) { path(ring, true); ctx.fill(); }
    ctx.fillStyle = '#17304f';
    for (const poly of g.water) { path(poly, true); ctx.fill(); }
    ctx.strokeStyle = '#17304f';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, 0.2 * this.base.s * k);
    for (const line of g.river) { path(line, false); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
}
