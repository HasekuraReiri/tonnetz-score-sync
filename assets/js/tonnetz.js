/* ==========================================================================
   tonnetz.js — 无限 Tonnetz 网格 + 五度圈
   ========================================================================== */

import {
  analyzeChord, harmonicFunction, keySpell, mod12, pcName, pcSet,
  REFERENCE_PAIRS, ROMAN, degreeOf, pcMask, nameOf,
} from './core.js';

const SQRT3 = Math.sqrt(3);
const BASE_W = 88;
const TONE_COLORS = { T: '#3b6fd4', S: '#c08a2c', D: '#b5483f' };
const NOTE_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const INK = '32,35,39';
const PAPER = '250,247,239';
const SATB_COLORS = { S: '#3457d5', A: '#2f8f7b', T: '#b07a22', B: '#b5483f' };
const SATB_KEYS = ['S', 'A', 'T', 'B'];

function rgba(rgb, a) { return `rgba(${rgb},${a})`; }
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)].join(',');
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ----------------------------------------------------------- 音级圈 */

const CHROMATIC_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const SHARP_PAIRS = { 1: ['C#', 'Db'], 3: ['D#', 'Eb'], 6: ['F#', 'Gb'], 8: ['G#', 'Ab'], 10: ['A#', 'Bb'] };
const DEGREE_FUNC = ['T', 'S', 'T', 'S', 'D', 'T', 'D'];

/**
 * 音级圈：五度圈（fifths）与十二平均律圈（chromatic）共用同一套交互。
 * 备注：十二平均律圈的点击/高亮/罗马数字/进行色点/调性着色/音名切换均与五度圈一致。
 */
export class FifthCircle {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pixelRatio = Number(opts.pixelRatio) || 0;
    this.state = {
      mode: 'fifths', naming: 'reference', key: null,
      selection: null, steps: null, activeStep: -1, compact: false,
    };
    this.hover = -1;
    this.rotExtra = 0;
    this._rotRaf = null;
    this.onPick = opts.onPick || (() => {});
    this.onHover = opts.onHover || (() => {});
    this._bind();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
    this.resize();
  }

  get mode() { return this.state.mode === 'chromatic' ? 'chromatic' : 'fifths'; }
  get tonic() { return this.state.key ? mod12(this.state.key.tonic) : 0; }
  get order() {
    const t = this.tonic;
    if (this.mode === 'chromatic') return CHROMATIC_ORDER.map((_, i) => mod12(t + i));
    const start = NOTE_ORDER.indexOf(t);
    return NOTE_ORDER.slice(start).concat(NOTE_ORDER.slice(0, start));
  }

  angle(i) { return (-90 + i * 30 + this.rotExtra) * Math.PI / 180; }
  pcAt(i) { return this.order[i]; }
  indexOfPc(pc) { return this.order.indexOf(mod12(pc)); }

  setState(s) {
    const prevMode = this.mode;
    const prevKey = this.state.key;
    this.state = { ...this.state, ...s };
    if (this.mode !== prevMode) {
      this.cancelRotation();
      this.rotExtra = 0;
      this.hover = -1;
      this.resize();
      return;
    }
    if (this._rotRaf) { this.render(); return; }
    if (prevKey && this.state.key && mod12(prevKey.tonic) !== mod12(this.state.key.tonic)) {
      let delta = this.mode === 'fifths'
        ? NOTE_ORDER.indexOf(mod12(this.state.key.tonic)) - NOTE_ORDER.indexOf(mod12(prevKey.tonic))
        : mod12(this.state.key.tonic) - mod12(prevKey.tonic);
      delta = ((delta % 12) + 12) % 12;
      if (delta > 6) delta -= 12;
      if (delta !== 0) { this.animateRotation(delta * 30); return; }
    }
    if (this.rotExtra !== 0) this.rotExtra = 0;
    this.render();
  }

  cancelRotation() {
    if (this._rotRaf) {
      cancelAnimationFrame(this._rotRaf);
      this._rotRaf = null;
    }
  }

  animateRotation(fromDeg) {
    this.cancelRotation();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.rotExtra = 0;
      this.render();
      return;
    }
    this.rotExtra = fromDeg;
    this.render();
    const start = performance.now();
    const dur = 460;
    const step = now => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      this.rotExtra = fromDeg * (1 - e);
      this.render();
      if (t < 1) {
        this._rotRaf = requestAnimationFrame(step);
      } else {
        this._rotRaf = null;
        this.rotExtra = 0;
        this.render();
      }
    };
    this._rotRaf = requestAnimationFrame(step);
  }

  resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = el.clientWidth || 280;
    const h = el.clientHeight || w;
    const dpr = this.pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.w = w; this.h = h; this.dpr = dpr;
    this.cx = w / 2; this.cy = h / 2;
    const pad = this.mode === 'chromatic' ? 44 : 12;
    this.R = Math.min(w, h) / 2 - pad;
    this.render();
  }

  sectorIndexAt(x, y) {
    const dx = x - this.cx, dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    const rMin = this.mode === 'chromatic' ? 6 : this.R * 0.52;
    const rMax = this.mode === 'chromatic' ? this.R + 34 : this.R + 4;
    if (r < rMin || r > rMax) return -1;
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    /* 扇区 i 中心在 -90 + i*30（顺时针），减去当前旋转相位 */
    const raw = (((deg + 90 - this.rotExtra) % 360) + 360) % 360;
    return Math.round(raw / 30) % 12;
  }

  _bind() {
    this.canvas.addEventListener('pointermove', ev => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      const idx = this.sectorIndexAt(x, y);
      if (idx !== this.hover) {
        this.hover = idx;
        this.render();
        this.onHover(idx >= 0 ? this.pcAt(idx) : -1, x, y);
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hover !== -1) {
        this.hover = -1;
        this.render();
        this.onHover(-1, 0, 0);
      }
    });
    this.canvas.addEventListener('click', ev => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      const idx = this.sectorIndexAt(x, y);
      if (idx >= 0) this.onPick(this.pcAt(idx), ev);
    });
  }

  render() {
    const c = this.ctx, w = this.w, h = this.h, R = this.R;
    if (!c) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const s = this.state;
    const mode = this.mode;
    const order = this.order;
    const key = s.key;
    const sel = s.selection;
    const selPcs = sel && sel.pcs ? sel.pcs : [];
    const selColor = sel && sel.color ? sel.color : '#3457d5';

    /* 外圈 */
    c.beginPath();
    c.arc(this.cx, this.cy, R, 0, Math.PI * 2);
    c.fillStyle = '#fbf8f0';
    c.fill();
    c.strokeStyle = 'rgba(32,35,39,.16)';
    c.lineWidth = 1.1;
    c.stroke();

    if (mode === 'fifths') this.drawFifthsBase(c, s, key, selPcs, selColor, order);
    else this.drawChromaticBase(c, s, key, selPcs, selColor, order);

    /* 选中音多边形 */
    if (selPcs.length >= 2) {
      const rr = mode === 'chromatic' ? (s.compact ? 0.58 : 0.74) : 0.84;
      const pts = selPcs.map(pc => {
        const i = this.indexOfPc(pc);
        if (i < 0) return null;
        const a = this.angle(i);
        return { x: this.cx + Math.cos(a) * R * rr, y: this.cy + Math.sin(a) * R * rr };
      }).filter(Boolean);
      if (pts.length >= 2) {
        const center = { x: this.cx, y: this.cy };
        pts.sort((p, q) => Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(q.y - center.y, q.x - center.x));
        c.beginPath();
        pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
        c.closePath();
        c.fillStyle = rgba(hexToRgb(selColor), 0.14);
        c.fill();
        c.strokeStyle = rgba(hexToRgb(selColor), 0.58);
        c.lineWidth = 1.6;
        c.stroke();
      }
    }

    /* 音名 */
    if (mode === 'fifths') this.drawFifthsLabels(c, s, selPcs, selColor, order);
    else this.drawChromaticLabels(c, s, selPcs, selColor, order);

    /* 进行环节色点 */
    if (s.steps && s.steps.length) {
      const rr = R - (mode === 'chromatic' ? 14 : 7);
      s.steps.forEach((st, idx) => {
        const pc = st.bass != null ? st.bass : (st.pcs && st.pcs[0]);
        if (pc == null) return;
        const i = this.indexOfPc(pc);
        if (i < 0) return;
        const a = this.angle(i);
        const active = idx === s.activeStep;
        const x = this.cx + Math.cos(a) * (active ? rr + 1 : rr);
        const y = this.cy + Math.sin(a) * (active ? rr + 1 : rr);
        c.beginPath();
        c.arc(x, y, active ? 4 : 2.4, 0, Math.PI * 2);
        c.fillStyle = st.color || '#3457d5';
        c.fill();
        if (active) { c.strokeStyle = '#fffdf8'; c.lineWidth = 1.6; c.stroke(); }
      });
    }

    /* 低音标记 */
    if (sel && sel.bass != null) {
      const i = this.indexOfPc(sel.bass);
      if (i >= 0) {
        const a = this.angle(i);
        if (mode === 'chromatic') {
          const x = this.cx + Math.cos(a) * R;
          const y = this.cy + Math.sin(a) * R;
          c.beginPath(); c.arc(x, y, 5.4, 0, Math.PI * 2);
          c.strokeStyle = selColor; c.lineWidth = 2; c.stroke();
        } else {
          const x = this.cx + Math.cos(a) * R * 0.95;
          const y = this.cy + Math.sin(a) * R * 0.95;
          c.beginPath(); c.arc(x, y, 3.4, 0, Math.PI * 2);
          c.fillStyle = selColor; c.fill();
        }
      }
    }
  }

  drawFifthsBase(c, s, key, selPcs, selColor, order) {
    const R = this.R;
    for (let i = 0; i < 12; i++) {
      const pc = order[i];
      const a0 = this.angle(i) - Math.PI / 12;
      const a1 = this.angle(i) + Math.PI / 12;
      const rIn = R * 0.54;
      const deg = key ? degreeOf(key, pc) : -1;
      let fill = 'rgba(255,253,248,0)';
      if (key && deg >= 0) {
        const letter = DEGREE_FUNC[deg] || 'T';
        fill = rgba(hexToRgb(TONE_COLORS[letter]), 0.075);
      }
      if (selPcs.includes(pc)) fill = rgba(hexToRgb(selColor), 0.2);
      if (i === this.hover) fill = rgba(INK, 0.07);
      if (key && pc === key.tonic) fill = rgba(hexToRgb(TONE_COLORS.T), 0.13);
      c.beginPath();
      c.arc(this.cx, this.cy, R - 1, a0, a1);
      c.arc(this.cx, this.cy, rIn, a1, a0, true);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
      c.strokeStyle = 'rgba(32,35,39,.09)';
      c.lineWidth = 1;
      c.stroke();

      if (key && deg >= 0) {
        const a = this.angle(i);
        c.fillStyle = 'rgba(32,35,39,.42)';
        c.font = '600 8.5px "Segoe UI", "Microsoft YaHei", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(ROMAN[deg], this.cx + Math.cos(a) * R * 0.61, this.cy + Math.sin(a) * R * 0.61);
      }
    }
  }

  drawChromaticBase(c, s, key, selPcs, selColor, order) {
    const R = this.R;
    /* 内部导引：和弦多边形所在的圈 + 极细辐线 */
    c.beginPath();
    c.arc(this.cx, this.cy, R * 0.74, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(32,35,39,.07)';
    c.lineWidth = 1;
    c.setLineDash([2, 6]);
    c.stroke();
    c.setLineDash([]);
    for (let i = 0; i < 12; i++) {
      const a = this.angle(i);
      c.beginPath();
      c.moveTo(this.cx + Math.cos(a) * R * 0.18, this.cy + Math.sin(a) * R * 0.18);
      c.lineTo(this.cx + Math.cos(a) * (R - 1), this.cy + Math.sin(a) * (R - 1));
      c.strokeStyle = 'rgba(32,35,39,.045)';
      c.lineWidth = 0.8;
      c.setLineDash([1.5, 6]);
      c.stroke();
    }
    c.setLineDash([]);

    for (let i = 0; i < 12; i++) {
      const pc = order[i];
      const a = this.angle(i);
      const deg = key ? degreeOf(key, pc) : -1;
      const isSel = selPcs.includes(pc);
      const active = i === this.hover;
      let arcColor = null, alpha = 0;
      if (key && deg >= 0) {
        arcColor = TONE_COLORS[DEGREE_FUNC[deg] || 'T'];
        alpha = 0.12;
      }
      if (isSel) { arcColor = selColor; alpha = 0.26; }
      if (active) { arcColor = INK; alpha = 0.07; }
      if (key && pc === key.tonic) { arcColor = TONE_COLORS.T; alpha = 0.2; }
      if (arcColor) {
        c.beginPath();
        c.arc(this.cx, this.cy, R - 2, a - 0.22, a + 0.22);
        c.arc(this.cx, this.cy, R - 12, a + 0.22, a - 0.22, true);
        c.closePath();
        c.fillStyle = rgba(hexToRgb(arcColor), alpha);
        c.fill();
      }

      /* 刻度 */
      c.beginPath();
      c.moveTo(this.cx + Math.cos(a) * (R + 1), this.cy + Math.sin(a) * (R + 1));
      c.lineTo(this.cx + Math.cos(a) * (R + 7), this.cy + Math.sin(a) * (R + 7));
      c.strokeStyle = active ? 'rgba(32,35,39,.55)' : 'rgba(32,35,39,.32)';
      c.lineWidth = 1;
      c.stroke();

      /* 圈上的音点 */
      const dx = this.cx + Math.cos(a) * (R - 4);
      const dy = this.cy + Math.sin(a) * (R - 4);
      c.beginPath();
      c.arc(dx, dy, isSel ? 3.8 : active ? 3.2 : 2.1, 0, Math.PI * 2);
      c.fillStyle = isSel ? selColor : active ? 'rgba(32,35,39,.8)' : 'rgba(32,35,39,.38)';
      c.fill();

      /* 罗马数字 */
      if (key && deg >= 0) {
        c.fillStyle = rgba(hexToRgb(TONE_COLORS[DEGREE_FUNC[deg] || 'T']), 0.6);
        c.font = '600 8.5px "Segoe UI", "Microsoft YaHei", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(ROMAN[deg], this.cx + Math.cos(a) * R * 0.6, this.cy + Math.sin(a) * R * 0.6);
      }
    }
  }

  drawFifthsLabels(c, s, selPcs, selColor, order) {
    const R = this.R;
    for (let i = 0; i < 12; i++) {
      const pc = order[i];
      const a = this.angle(i);
      const lx = this.cx + Math.cos(a) * R * 0.86;
      const ly = this.cy + Math.sin(a) * R * 0.86;
      const isSel = selPcs.includes(pc);
      const active = i === this.hover;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (s.naming === 'integer') {
        c.font = `${isSel ? 700 : 600} ${isSel ? 15 : 13}px "Segoe UI", sans-serif`;
        c.fillStyle = isSel ? '#fff' : 'rgba(32,35,39,.82)';
        if (isSel) {
          c.beginPath(); c.arc(lx, ly, 12, 0, Math.PI * 2); c.fillStyle = selColor; c.fill();
          c.fillStyle = '#fff';
        }
        c.fillText(String(pc), lx, ly + 0.5);
      } else {
        const pair = REFERENCE_PAIRS[pc];
        c.font = `${isSel || active ? 700 : 500} ${pair ? 10.5 : 13}px "Cambria", "Georgia", "Times New Roman", serif`;
        c.fillStyle = isSel ? '#1b1e22' : 'rgba(32,35,39,.78)';
        if (isSel) {
          c.beginPath(); c.arc(lx, ly, pair ? 15 : 12.5, 0, Math.PI * 2);
          c.fillStyle = rgba(hexToRgb(selColor), 0.16); c.fill();
        }
        if (pair) {
          c.fillText(pair[0], lx, ly - 5.5);
          c.fillStyle = isSel ? '#1b1e22' : 'rgba(32,35,39,.55)';
          c.fillText(pair[1], lx, ly + 5.5);
        } else {
          c.fillText(FLAT(pc), lx, ly + 0.5);
        }
      }
    }
  }

  drawChromaticLabels(c, s, selPcs, selColor, order) {
    const R = this.R;
    const compact = !!s.compact;
    for (let i = 0; i < 12; i++) {
      const pc = order[i];
      const a = this.angle(i);
      const rr = compact ? R * 0.74 : R + 24;
      const lx = this.cx + Math.cos(a) * rr;
      const ly = this.cy + Math.sin(a) * rr;
      const isSel = selPcs.includes(pc);
      const active = i === this.hover;
      const pair = SHARP_PAIRS[pc];
      let text, font;
      if (s.naming === 'integer') {
        text = String(pc);
        font = compact ? 11 : (active || isSel ? 15 : 13.5);
      } else if (pair && !compact) {
        text = pair[0] + '/' + pair[1];
        font = active || isSel ? 11 : 10.5;
      } else {
        text = compact ? FLAT(pc) : FLAT(pc);
        font = compact ? 10 : (active || isSel ? 15 : 14);
      }
      /* 所有音名保持水平，不随圆圈旋转 */
      c.font = `${isSel || active ? 700 : 500} ${font}px "Cambria", "Georgia", "Times New Roman", serif`;
      c.fillStyle = isSel ? '#1b1e22' : active ? '#3457d5' : 'rgba(32,35,39,.72)';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, lx, ly);
    }
  }

}

function FLAT(pc) {
  return ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'][mod12(pc)];
}

/* ----------------------------------------------------------- Tonnetz */

export class TonnetzView {
  constructor({ canvas, circleCanvas, app, pixelRatio }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.pixelRatio = Number(pixelRatio) || 0;
    this.circle = new FifthCircle(circleCanvas, {
      pixelRatio: this.pixelRatio,
      onPick: pc => app.toggleNote(pc),
      onHover: (idx, x, y) => app.circleHover(idx, x, y, this.circle),
    });
    this.zoom = 1;
    this.baseW = BASE_W;
    this.zoomMin = 0.42;
    this.zoomMax = 3.2;
    this.panX = 0;
    this.panY = 0;
    /* 网格跟随：只在小尺寸舞台（曲谱同步）启用；默认关闭，Lite 版保持自由平移 */
    this.autoFit = false;
    this.fitMargin = 10;
    this.homeX = 0;
    this.homeY = 0;
    this._fitKey = '';
    this.initialized = false;
    this.hover = null;
    this.drag = null;
    this.pointers = new Map();
    this._dirty = false;
    this._raf = null;
    this.embedCache = new Map();
    this.fnCache = new Map();
    this._stepBadges = [];
    this._satbAnim = null;
    this._satbRaf = null;
    this._satbStatic = null;
    this._satbHistoryMap = {};
    this._state = {
      selection: null, key: null, naming: 'reference', circleMode: 'fifths',
      steps: [], activeStep: -1, showFunctions: true, showDegrees: true, showChordNames: false,
      showSteps: true, vivid: true,
      satbMode: false, satb: null, satbDur: 1.6, satbHistory: 1,
      fnCacheKey: '',
    };
    this._bind();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
    this.resize(true);
  }

  /* ------------------------------------------------------- coordinates */

  get W() { return this.baseW * this.zoom; }
  get H() { return this.W * SQRT3 / 2; }

  latticeToScreen(a, b) {
    return { x: this.panX + (a + b / 2) * this.W, y: this.panY - b * this.H };
  }

  screenToLattice(x, y) {
    const b = (this.panY - y) / this.H;
    const a = (x - this.panX) / this.W - b / 2;
    return { a, b };
  }

  noteAt(a, b) { return mod12(7 * a + 4 * b); }

  resize(first = false) {
    const el = this.canvas.parentElement || this.canvas;
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 600;
    const dpr = this.pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.dpr = dpr;
    this.w = w; this.h = h;
    if (first || !this.initialized) {
      this.panX = w * 0.5;
      this.panY = h * 0.53;
      this.initialized = true;
    } else if (this._lastW != null) {
      this.panX += (w - this._lastW) / 2;
      this.panY += (h - this._lastH) / 2;
    }
    this._lastW = w; this._lastH = h;
    this.circle.resize();
    this.render();
  }

  setState(patch) {
    const prevKey = this._state.key;
    const prevKeyId = prevKey ? prevKey.tonic + prevKey.modeId : 'none';
    const prevNaming = this._state.naming;
    const prevSatbMode = this._state.satbMode;
    const prevSatb = this._state.satb;
    const prevActive = this._state.activeStep;
    this._state = { ...this._state, ...patch };
    const newKeyId = this._state.key ? this._state.key.tonic + this._state.key.modeId : 'none';
    if (prevKeyId !== newKeyId) this.fnCache.clear();
    if (prevNaming !== this._state.naming) this.embedCache.clear();
    this.circle.setState({
      naming: this._state.naming, key: this._state.key,
      selection: this._state.selection,
      steps: this._state.showSteps === false ? [] : this._state.steps,
      activeStep: this._state.activeStep,
      mode: this._state.circleMode,
    });
    this._syncSatb(prevSatbMode, prevSatb, prevActive);
    this.render();
  }

  /* --------------------------------------------------- four voices on grid */

  _satbIndex() {
    const n = this._state.steps ? this._state.steps.length : 0;
    const i = this._state.activeStep;
    return i >= 0 && i < n ? i : 0;
  }

  _satbSpell() {
    const idx = this._satbIndex();
    const c = this._state.satb && this._state.satb.chords ? this._state.satb.chords[idx] : null;
    if (c && c.spelling) return c.spelling;
    return this._state.key ? keySpell(this._state.key).pref : 'flat';
  }

  _satbNoteName(midi) {
    if (!Number.isFinite(midi)) return '';
    if (this._state.naming === 'integer') return String(mod12(midi));
    return `${nameOf(mod12(midi), this._satbSpell())}${Math.floor(midi / 12) - 1}`;
  }

  _satbPointsForStep(idx) {
    const s = this._state;
    if (!s.satb || !s.satb.voices || !s.steps) return null;
    const v = s.satb.voices[idx];
    const step = s.steps[idx];
    if (!v || !step || !step.pcs) return null;
    const emb = this.embedPcs(step.pcs);
    const map = {};
    for (const k of SATB_KEYS) {
      const midi = v[k];
      if (!Number.isFinite(midi)) return null;
      const pc = mod12(midi);
      let p = emb.points.find(q => q.pc === pc);
      if (!p) p = this.nearestLatticePoint(pc, 0, 0);
      map[k] = { a: p.a, b: p.b, pc, midi };
    }
    return map;
  }

  _currentSatbPositions() {
    if (this._satbAnim) {
      const t = Math.min(1, Math.max(0, (performance.now() - this._satbAnim.start) / this._satbAnim.dur));
      const e = t * t * (3 - 2 * t);
      const out = {};
      for (const k of SATB_KEYS) {
        const f = this._satbAnim.from[k];
        const to = this._satbAnim.to[k];
        if (!f || !to) continue;
        out[k] = { a: f.a + (to.a - f.a) * e, b: f.b + (to.b - f.b) * e, pc: to.pc, midi: to.midi };
      }
      return out;
    }
    if (!this._satbStatic) {
      this._satbStatic = this._satbPointsForStep(this._satbIndex());
    }
    return this._satbStatic;
  }

  _stopSatbAnimation() {
    if (this._satbRaf) cancelAnimationFrame(this._satbRaf);
    this._satbRaf = null;
    this._satbAnim = null;
  }

  _startSatbAnimation(from, to) {
    this._stopSatbAnimation();
    const f = {};
    for (const k of SATB_KEYS) {
      if (!from[k] || !to[k]) continue;
      // 同音（含八度不变）不移动，直接出现在新和弦的节点上，避免假移动
      f[k] = from[k].midi === to[k].midi ? { ...to[k] } : { ...from[k] };
    }
    this._satbAnim = { from: f, to, start: performance.now(), dur: Math.max(300, Number(this._state.satbDur || 1.6) * 1000) };
    this._satbStatic = to;
    const tick = () => {
      this._satbRaf = null;
      if (!this._satbAnim) return;
      const done = performance.now() >= this._satbAnim.start + this._satbAnim.dur;
      if (done) {
        this._satbStatic = this._satbAnim.to;
        this._satbAnim = null;
        this.draw();
        return;
      }
      this.draw();
      this._satbRaf = requestAnimationFrame(tick);
    };
    this._satbRaf = requestAnimationFrame(tick);
  }

  setSatbDuration(sec) {
    this._state.satbDur = Math.max(0.3, Number(sec) || 1.6);
    if (this._satbAnim) this._satbAnim.dur = Math.max(300, this._state.satbDur * 1000);
    this.render();
  }

  _trimSatbHistory() {
    const count = Math.max(0, Math.min(6, Number(this._state.satbHistory ?? 1)));
    for (const k of SATB_KEYS) {
      const arr = this._satbHistoryMap[k];
      if (!arr) continue;
      if (count <= 0) delete this._satbHistoryMap[k];
      else if (arr.length > count) this._satbHistoryMap[k] = arr.slice(-count);
    }
  }

  _pushSatbHistory(from, to) {
    const count = Math.max(0, Math.min(6, Number(this._state.satbHistory ?? 1)));
    if (count <= 0) {
      this._satbHistoryMap = {};
      return;
    }
    for (const k of SATB_KEYS) {
      const f = from[k];
      const t = to[k];
      if (!f || !t || f.midi === t.midi) continue;
      const arr = this._satbHistoryMap[k] || (this._satbHistoryMap[k] = []);
      arr.push({ a: f.a, b: f.b, pc: f.pc, midi: f.midi });
      while (arr.length > count) arr.shift();
    }
  }

  _syncSatb(prevMode, prevSatb, prevActive) {
    const s = this._state;
    const on = !!(s.satbMode && s.satb && s.satb.voices && s.satb.voices.length && s.steps && s.steps.length);
    if (!on) {
      this._stopSatbAnimation();
      this._satbStatic = null;
    this._satbHistoryMap = {};
      return;
    }
    const dataChanged = !prevMode || prevSatb !== s.satb;
    const stepChanged = s.activeStep !== prevActive;
    this._trimSatbHistory();
    if (!dataChanged && !stepChanged) return;
    const from = this._currentSatbPositions();
    const to = this._satbPointsForStep(this._satbIndex());
    if (!to) {
      this._stopSatbAnimation();
      this._satbStatic = null;
    this._satbHistoryMap = {};
      return;
    }
    const running = this._satbAnim;
    this._stopSatbAnimation();
    const historyFrom = running ? running.to : from;
    if (dataChanged) this._satbHistoryMap = {};
    if (prevMode && historyFrom && stepChanged && !dataChanged) this._pushSatbHistory(historyFrom, to);
    if (prevMode && from && (dataChanged || stepChanged)) {
      this._startSatbAnimation(from, to);
    } else {
      this._satbStatic = to;
    }
  }

  _drawSatbHistory() {
    const history = this._satbHistoryMap;
    if (!history) return;
    const anim = this._satbAnim;
    const c = this.ctx;
    for (const k of SATB_KEYS) {
      const arr = history[k];
      if (!arr || !arr.length) continue;
      for (let i = 0; i < arr.length; i++) {
        const h = arr[i];
        if (anim && anim.from[k] && h.a === anim.from[k].a && h.b === anim.from[k].b && h.midi === anim.from[k].midi) continue;
        const p = this.latticeToScreen(h.a, h.b);
        if (p.x < -30 || p.x > this.w + 30 || p.y < -30 || p.y > this.h + 30) continue;
        const color = SATB_COLORS[k];
        const rgb = hexToRgb(color);
        const alpha = 0.28 + 0.18 * ((i + 1) / arr.length);
        c.beginPath();
        c.arc(p.x, p.y, 7.2, 0, Math.PI * 2);
        c.fillStyle = rgba(rgb, 0.04);
        c.fill();
        c.setLineDash([3, 3]);
        c.strokeStyle = rgba(rgb, alpha);
        c.lineWidth = 1.3;
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = rgba(rgb, alpha + 0.16);
        c.font = '700 7.5px "Segoe UI", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(k, p.x, p.y + 0.5);
      }
    }
  }

  _drawSatbVoices() {
    const s = this._state;
    if (!s.satbMode || !s.satb || !s.satb.voices || !s.satb.voices.length) return;
    const cur = this._currentSatbPositions();
    if (!cur) return;
    const anim = this._satbAnim;
    const groupBase = anim ? anim.to : cur;
    const groups = {};
    for (const k of SATB_KEYS) {
      const p = groupBase[k];
      if (!p) continue;
      const key = `${p.a},${p.b}`;
      (groups[key] || (groups[key] = [])).push(k);
    }
    const offsetOf = k => {
      const p = groupBase[k];
      if (!p) return { dx: 0, dy: 0 };
      const list = groups[`${p.a},${p.b}`] || [k];
      const n = list.length;
      if (n <= 1) return { dx: 0, dy: 0 };
      const i = list.indexOf(k);
      return { dx: (i - (n - 1) / 2) * 30, dy: (i % 2 ? 9 : -9) };
    };
    const spell = this._satbSpell();

    // 过去声部位置（保留原始位置）
    this._drawSatbHistory();

    // 运动轨迹（先画，压在下层）
    if (anim) {
      for (const k of SATB_KEYS) {
        const f = anim.from[k];
        const to = anim.to[k];
        if (!f || !to || f.midi === to.midi) continue;
        const a = this.latticeToScreen(f.a, f.b);
        const b = this.latticeToScreen(to.a, to.b);
        const off = offsetOf(k);
        const color = SATB_COLORS[k];
        const rgb = hexToRgb(color);
        this.ctx.beginPath(); this.ctx.moveTo(a.x, a.y); this.ctx.lineTo(b.x, b.y);
        this.ctx.strokeStyle = rgba(rgb, 0.16); this.ctx.lineWidth = 7; this.ctx.stroke();
        this.ctx.beginPath(); this.ctx.moveTo(a.x, a.y); this.ctx.lineTo(b.x, b.y);
        this.ctx.strokeStyle = rgba(rgb, 0.7); this.ctx.lineWidth = 2; this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(b.x + off.dx, b.y + off.dy, 5.2, 0, Math.PI * 2);
        this.ctx.strokeStyle = rgba(rgb, 0.55);
        this.ctx.lineWidth = 1.6;
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(a.x + off.dx, a.y + off.dy, 3.2, 0, Math.PI * 2);
        this.ctx.fillStyle = rgba(rgb, 0.35);
        this.ctx.fill();
      }
    }

    // 声部标记
    const order = ['B', 'T', 'A', 'S'];
    for (const k of order) {
      const p = cur[k];
      if (!p) continue;
      const off = offsetOf(k);
      const pt = this.latticeToScreen(p.a, p.b);
      const x = pt.x + off.dx;
      const y = pt.y + off.dy;
      if (x < -40 || x > this.w + 40 || y < -40 || y > this.h + 40) continue;
      const color = SATB_COLORS[k];
      const rgb = hexToRgb(color);
      const label = this._satbNoteName(p.midi);
      this.ctx.beginPath();
      this.ctx.arc(x, y, 10.5, 0, Math.PI * 2);
      this.ctx.fillStyle = color;
      this.ctx.fill();
      this.ctx.strokeStyle = '#fffdf8';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '700 9.5px "Segoe UI", sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(k, x, y + 0.5);

      /* 小面板里音名会与级数、和弦标签重叠，放大到一定程度才显示 */
      if (this.zoom >= 1.15) {
        this.ctx.font = '700 9.5px "Cambria", "Georgia", serif';
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = `rgba(${PAPER},.95)`;
        this.ctx.strokeText(label, x, y - 17);
        this.ctx.fillStyle = color;
        this.ctx.fillText(label, x, y - 17);
      }
    }
  }

  setZoom(z, anchor) {
    const old = this.zoom;
    this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, z));
    if (anchor && old !== this.zoom) {
      this.panX = anchor.x - (anchor.x - this.panX) * (this.zoom / old);
      this.panY = anchor.y - (anchor.y - this.panY) * (this.zoom / old);
    }
    this.app.onZoom && this.app.onZoom(this.zoom);
    this.render();
  }

  zoomBy(f) {
    this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom * f));
    this.app.onZoom && this.app.onZoom(this.zoom);
    this.render();
  }

  resetView() {
    this.zoom = 1;
    this.panX = this.w * 0.5;
    this.panY = this.h * 0.53;
    this.app.onZoom && this.app.onZoom(this.zoom);
    this.render();
  }

  /* 曲谱同步舞台：载入总谱后记录「主三和弦居中」的位置作为网格原点。
     之后只有当前和弦要越界时才做最小平移，不再按和弦重新居中。 */
  setHome(x, y) {
    this.homeX = Number.isFinite(x) ? x : this.panX;
    this.homeY = Number.isFinite(y) ? y : this.panY;
    this._fitKey = '';
    return { x: this.homeX, y: this.homeY };
  }

  /* 保证当前和弦多边形完整落在网格内（留 fitMargin 边距）。
     采用「粘性」平移：只在包围盒将要越界时，沿越界方向补最小位移；
     和弦回到安全区后网格不再移动，因此主三和弦不会被反复拉回中心。 */
  _fitSelection(sel) {
    if (!this.autoFit || !sel || !this.w || !this.h) return;
    let pts = null;
    if (sel.tri) {
      const tri = this.triData(sel.tri.i, sel.tri.j, sel.tri.up);
      if (tri) pts = tri.vertices.map(([a, b]) => this.latticeToScreen(a, b));
    } else {
      const pcs = sel.pcs || (sel.chord && sel.chord.pcs);
      if (pcs && pcs.length >= 2) {
        const emb = this.embedPcs(pcs);
        pts = emb.points.map(p => this.latticeToScreen(p.a, p.b));
      }
    }
    if (!pts || pts.length < 2) return;

    const w = this.w, h = this.h;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const hull = hullOf(pts);
    const key = `${Math.round(minX * 10)},${Math.round(maxX * 10)},${Math.round(minY * 10)},${Math.round(maxY * 10)}|${w}x${h}`;
    if (key === this._fitKey) return;
    this._fitKey = key;

    /* 边距 10px；多边形描边留 2px，二音连线是 16px 粗线，端点再多留 8px */
    const lineLike = hull.length < 3 || polygonArea(hull) < 0.5;
    const M = this.fitMargin + (lineLike ? 8 : 2);
    const bw = maxX - minX, bh = maxY - minY;
    let dx = 0, dy = 0;
    if (bw > w - 2 * M) dx = w / 2 - (minX + maxX) / 2;
    else if (minX < M) dx = M - minX;
    else if (maxX > w - M) dx = (w - M) - maxX;
    if (bh > h - 2 * M) dy = h / 2 - (minY + maxY) / 2;
    else if (minY < M) dy = M - minY;
    else if (maxY > h - M) dy = (h - M) - maxY;

    /* 小于 2px 的修正忽略，避免逐帧抖动 */
    if (Math.hypot(dx, dy) < 2) return;
    this.panX += dx;
    this.panY += dy;
    this._fitKey = '';
  }

  centerOn(pc, key) {
    /* 将某个音的中心位置移到视口中心 */
    const { points } = this.embedPcs([pc]);
    if (points.length) {
      const p = points[0];
      const s = this.latticeToScreen(p.a, p.b);
      this.panX += this.w / 2 - s.x;
      this.panY += this.h / 2 - s.y;
      this.render();
    }
  }

  /* --------------------------------------------------------- hit testing */

  hitTest(x, y) {
    /* 1. sequence badges */
    for (const b of this._stepBadges) {
      if (Math.hypot(x - b.x, y - b.y) < b.r + 3) return { type: 'step', index: b.index, badge: b };
    }
    const { a, b } = this.screenToLattice(x, y);
    const ra = Math.round(a), rb = Math.round(b);
    const p = this.latticeToScreen(ra, rb);
    if (Math.hypot(x - p.x, y - p.y) < 10.5) {
      return { type: 'note', pc: this.noteAt(ra, rb), a: ra, b: rb };
    }
    const i = Math.floor(a), j = Math.floor(b);
    const s = a + b - (i + j);
    const up = s < 1;
    return { type: 'triangle', i, j, up, ...this.triData(i, j, up) };
  }

  triData(i, j, up) {
    if (up) {
      const pcs = [this.noteAt(i, j), this.noteAt(i + 1, j), this.noteAt(i, j + 1)];
      return { pcs: pcSet(pcs), root: this.noteAt(i, j), quality: 'maj', vertices: [[i, j], [i + 1, j], [i, j + 1]] };
    }
    const pcs = [this.noteAt(i + 1, j), this.noteAt(i, j + 1), this.noteAt(i + 1, j + 1)];
    return { pcs: pcSet(pcs), root: this.noteAt(i, j + 1), quality: 'min', vertices: [[i + 1, j], [i, j + 1], [i + 1, j + 1]] };
  }

  triangleHit(x, y) { return this.hitTest(x, y); }

  /* ----------------------------------------------------------- utilities */

  triadInfo(pcsKey, pcs, root, key) {
    const ck = pcsKey + '|' + (key ? key.tonic + key.modeId : 'none');
    if (this.fnCache.has(ck)) return this.fnCache.get(ck);
    const chord = analyzeChord(pcs, root, key ? key.spell : 'flat');
    const fn = key ? harmonicFunction(chord, key) : null;
    const v = { chord, fn };
    this.fnCache.set(ck, v);
    return v;
  }

  embedPcs(pcs) {
    pcs = pcSet(pcs);
    const cacheKey = pcs.join(',');
    if (this.embedCache.has(cacheKey)) return this.embedCache.get(cacheKey);
    const n = pcs.length;
    if (n === 0) return { points: [], hull: [], centroid: null, area: 0 };
    if (n === 1) {
      const p = this.nearestLatticePoint(pcs[0], 0, 0);
      const res = { points: [p], hull: [p], centroid: p, area: 0, collinear: false };
      this.embedCache.set(cacheKey, res);
      return res;
    }
    const candCount = n <= 4 ? 7 : n === 5 ? 5 : 4;
    const candidates = pcs.map(pc => this.latticeCandidates(pc, candCount));
    let best = null;
    const chosen = [];
    const limit = n <= 5 ? Infinity : 120000;
    let tested = 0;
    const cartOf = p => ({ x: p.a + p.b / 2, y: -p.b * SQRT3 / 2, a: p.a, b: p.b, pc: p.pc });
    const latticeCentroid = pts => ({
      a: pts.reduce((s, p) => s + p.a, 0) / pts.length,
      b: pts.reduce((s, p) => s + p.b, 0) / pts.length,
    });
    const rec = (idx) => {
      if (tested > limit) return;
      if (idx === n) {
        tested++;
        const pts = chosen.slice();
        const ev = evaluateEmbedding(pts.map(cartOf));
        if (!best || ev.score < best.score) best = { ...ev, points: pts, centroid: latticeCentroid(pts) };
        return;
      }
      for (const c of candidates[idx]) {
        chosen.push(c);
        rec(idx + 1);
        chosen.pop();
        if (tested > limit) return;
      }
    };
    rec(0);
    if (!best) {
      const pts = pcs.map(pc => this.nearestLatticePoint(pc, 0, 0));
      const ev = evaluateEmbedding(pts.map(cartOf));
      best = { ...ev, points: pts, centroid: latticeCentroid(pts) };
    }
    const res = { ...best, points: best.points };
    this.embedCache.set(cacheKey, res);
    return res;
  }

  latticeCandidates(pc, count = 7) {
    const list = [];
    for (let b = -5; b <= 5; b++) {
      for (let a = -6; a <= 6; a++) {
        if (this.noteAt(a, b) !== mod12(pc)) continue;
        const x = a + b / 2;
        const y = -b * SQRT3 / 2;
        list.push({ a, b, pc: mod12(pc), d: x * x + y * y });
      }
    }
    list.sort((p, q) => p.d - q.d);
    return list.slice(0, count).map(({ a, b, pc: p }) => ({ a, b, pc: p }));
  }

  nearestLatticePoint(pc, ca = 0, cb = 0) {
    let best = null;
    for (let b = -6; b <= 6; b++) {
      for (let a = -7; a <= 7; a++) {
        if (this.noteAt(a, b) !== mod12(pc)) continue;
        const x = a + b / 2 - ca, y = -b * SQRT3 / 2 - cb;
        const d = x * x + y * y;
        if (!best || d < best.d) best = { a, b, pc: mod12(pc), d };
      }
    }
    return best || { a: 0, b: 0, pc: mod12(pc), d: 0 };
  }

  /* ------------------------------------------------------------- render */

  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.draw();
    });
  }

  draw() {
    const c = this.ctx;
    if (!c) return;
    const w = this.w, h = this.h;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const s = this._state;
    const W = this.W, H = this.H;

    /* 当前和弦越界时先补最小平移，再按新视口绘制 */
    if (this.autoFit) this._fitSelection(s.selection);

    /* visible lattice range */
    const bMin = Math.floor((this.panY - h) / H) - 2;
    const bMax = Math.ceil(this.panY / H) + 2;
    const aCorners = [
      (0 - this.panX) / W - bMin / 2,
      (0 - this.panX) / W - bMax / 2,
      (w - this.panX) / W - bMin / 2,
      (w - this.panX) / W - bMax / 2,
    ];
    const aMin = Math.floor(Math.min(...aCorners)) - 2;
    const aMax = Math.ceil(Math.max(...aCorners)) + 2;

    const sel = s.selection;
    const key = s.key;
    const naming = s.naming;
    const selTri = sel && sel.tri ? sel.tri : null;
    const selColor = sel && sel.color ? sel.color : '#3457d5';
    const selRgb = hexToRgb(selColor);
    const vivid = s.vivid !== false;

    /* 1. triangle fills */
    for (let b = bMin; b <= bMax; b++) {
      for (let a = aMin; a <= aMax; a++) {
        const i = a, j = b;
        for (const up of [true, false]) {
          const tri = this.triData(i, j, up);
          if (!tri) continue;
          const pts = tri.vertices.map(([va, vb]) => this.latticeToScreen(va, vb));
          if (!this._anyVisible(pts, w, h)) continue;
          const isSelTri = selTri && selTri.i === i && selTri.j === j && selTri.up === up;
          const isHover = this.hover && this.hover.type === 'triangle' && this.hover.i === i && this.hover.j === j && this.hover.up === up;
          let fill = null;
          let fnGroup = null;
          let tonicTriad = false;
          if (key && s.showFunctions) {
            const info = this.triadInfo(tri.pcs.slice().sort((x, y) => x - y).join(','), tri.pcs, tri.root, key);
            if (info.fn && info.fn.group !== '?') {
              fnGroup = info.fn.group;
              const base = vivid ? 0.17 : 0.045;
              fill = rgba(hexToRgb(TONE_COLORS[info.fn.group]), isSelTri ? 0.26 : isHover ? 0.23 : base);
              /* 主三和弦用更深的主功能蓝，始终比同级其他和弦醒目；
                 小调只加深小三和弦，避免把同根音的大三和弦一起点亮。 */
              const wantMinor = !!(key.mode && key.mode.group === 'minor');
              tonicTriad = key && tri.root === key.tonic && info.chord
                && info.chord.quality === (wantMinor ? 'min' : 'maj');
              if (tonicTriad) fill = rgba(hexToRgb(TONE_COLORS.T), isSelTri ? 0.34 : isHover ? 0.3 : 0.3);
            }
          }
          if (!fill) {
            const base = vivid ? 0.028 : 0.012;
            fill = up ? `rgba(${INK},${isSelTri ? 0.1 : isHover ? 0.07 : base})` : `rgba(${INK},${isSelTri ? 0.1 : isHover ? 0.07 : base * 0.6})`;
          }
          if (isSelTri) fill = rgba(selRgb, 0.24);
          if (isHover && !isSelTri) fill = rgba(selRgb, 0.12);
          c.beginPath();
          c.moveTo(pts[0].x, pts[0].y);
          c.lineTo(pts[1].x, pts[1].y);
          c.lineTo(pts[2].x, pts[2].y);
          c.closePath();
          c.fillStyle = fill;
          c.fill();
          if (isSelTri) {
            c.strokeStyle = rgba(selRgb, 0.8);
            c.lineWidth = 2;
            c.stroke();
          } else if (isHover) {
            c.strokeStyle = rgba(selRgb, 0.42);
            c.lineWidth = 1.2;
            c.stroke();
          } else if (vivid && fnGroup) {
            /* 功能色单元格再描一圈细边，网格边界更清晰；主三和弦边线加深 */
            c.strokeStyle = rgba(hexToRgb(TONE_COLORS[fnGroup]), tonicTriad ? 0.72 : 0.26);
            c.lineWidth = tonicTriad ? 1.6 : 0.8;
            c.stroke();
          }
        }
      }
    }

    /* 2. edges */
    c.lineCap = 'round';
    const visible = (p1, p2) => {
      const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
      return maxX > -30 && minX < w + 30 && maxY > -30 && minY < h + 30;
    };
    /* horizontal fifths */
    c.strokeStyle = rgba(INK, vivid ? 0.42 : 0.26);
    c.lineWidth = vivid ? 1.3 : 1.15;
    c.setLineDash([]);
    for (let b = bMin; b <= bMax; b++) {
      for (let a = aMin; a <= aMax; a++) {
        const p1 = this.latticeToScreen(a, b), p2 = this.latticeToScreen(a + 1, b);
        if (!visible(p1, p2)) continue;
        c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
      }
    }
    /* major third up-right */
    c.strokeStyle = rgba(INK, vivid ? 0.27 : 0.14);
    c.lineWidth = vivid ? 1.15 : 1.05;
    for (let b = bMin; b <= bMax; b++) {
      for (let a = aMin; a <= aMax; a++) {
        const p1 = this.latticeToScreen(a, b), p2 = this.latticeToScreen(a, b + 1);
        if (!visible(p1, p2)) continue;
        c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
      }
    }
    /* minor third down-right, dotted */
    c.strokeStyle = rgba(INK, vivid ? 0.36 : 0.22);
    c.lineWidth = vivid ? 1.15 : 1.05;
    c.setLineDash([2.5, 4.5]);
    for (let b = bMin; b <= bMax; b++) {
      for (let a = aMin; a <= aMax; a++) {
        const p1 = this.latticeToScreen(a, b), p2 = this.latticeToScreen(a + 1, b - 1);
        if (!visible(p1, p2)) continue;
        c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
      }
    }
    c.setLineDash([]);

    /* 2.5 当前和弦区域先铺在底层，网格音名与级数保持清晰 */
    this._drawChordFill(c, sel, selRgb, selTri, selColor);

    /* 3. vertex dots + labels：网格只保留统一的音名，不再突出当前和弦的顶点 */
    const showLabels = this.zoom > 0.52;
    const labelFont = this.zoom < 0.75 ? 9.5 : this.zoom > 1.5 ? 13.5 : 11.5;
    for (let b = bMin; b <= bMax; b++) {
      for (let a = aMin; a <= aMax; a++) {
        const p = this.latticeToScreen(a, b);
        if (p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;
        const pc = this.noteAt(a, b);
        c.beginPath();
        c.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
        c.fillStyle = rgba(INK, 0.5);
        c.fill();
        if (showLabels) {
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          const pair = naming === 'reference' ? REFERENCE_PAIRS[pc] : null;
          const xx = p.x;
          const yy = p.y - (pair ? 17 : 11) - (labelFont - 11) * 0.4;
          const inkA = vivid ? 0.86 : 0.78;
          if (naming === 'integer') {
            c.font = `500 ${labelFont}px "Segoe UI", "Microsoft YaHei", sans-serif`;
            this._haloText(String(pc), xx, yy, `rgba(${INK},${inkA})`, false);
          } else if (pair) {
            c.font = `500 ${labelFont - 1.2}px "Cambria", "Georgia", serif`;
            this._haloText(pair[0], xx, yy - 5.4, `rgba(${INK},${inkA - 0.08})`, false);
            this._haloText(pair[1], xx, yy + 5.4, `rgba(${INK},.5)`, false);
          } else {
            c.font = `500 ${labelFont}px "Cambria", "Georgia", serif`;
            this._haloText(FLAT(pc), xx, yy, `rgba(${INK},${inkA})`, false);
          }
        }
      }
    }

    /* 4. roman numerals / chord names in triangles */
    if ((s.showDegrees || s.showChordNames) && this.zoom >= 0.62 && (key || s.showChordNames)) {
      const triFont = vivid
        ? (this.zoom >= 1.15 ? 11 : 10)
        : (this.zoom >= 1.25 ? 11 : 9);
      for (let b = bMin; b <= bMax; b++) {
        for (let a = aMin; a <= aMax; a++) {
          const i = a, j = b;
          for (const up of [true, false]) {
            const tri = this.triData(i, j, up);
            const info = this.triadInfo(tri.pcs.slice().sort((x, y) => x - y).join(','), tri.pcs, tri.root, key);
            if (!info.chord) continue;
            if (s.showChordNames) {
              const pts = tri.vertices.map(([va, vb]) => this.latticeToScreen(va, vb));
              const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
              const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
              if (cx < 10 || cx > w - 10 || cy < 10 || cy > h - 10) continue;
              c.font = `500 ${triFont}px "Cambria", "Georgia", serif`;
              c.textAlign = 'center'; c.textBaseline = 'middle';
              c.fillStyle = `rgba(${INK},.36)`;
              c.fillText(info.chord.symbol, cx, cy);
            } else if (s.showDegrees && key && info.fn && info.fn.tag === 'diatonic') {
              const pts = tri.vertices.map(([va, vb]) => this.latticeToScreen(va, vb));
              const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
              const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
              if (cx < 10 || cx > w - 10 || cy < 10 || cy > h - 10) continue;
              c.font = `600 ${triFont}px "Segoe UI", "Microsoft YaHei", sans-serif`;
              c.textAlign = 'center'; c.textBaseline = 'middle';
              c.fillStyle = rgba(hexToRgb(TONE_COLORS[info.fn.group] || '#8a8a8a'), vivid ? 0.85 : 0.55);
              c.fillText(info.fn.roman, cx, cy);
            }
          }
        }
      }
    }

    /* 5. clicked triangle label（区域已在 2.5 铺底） */
    if (selTri) {
      const tri = this.triData(selTri.i, selTri.j, selTri.up);
      if (tri) {
        const pts = tri.vertices.map(([va, vb]) => this.latticeToScreen(va, vb));
        const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
        const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
        const label = sel && sel.chord ? sel.chord.symbol : '';
        this._drawLabelPill(cx, cy, label, selColor);
      }
    }

    /* 6. sequence badges */
    this._stepBadges = [];
    if (s.steps && s.steps.length && s.showSteps !== false) {
      for (let idx = 0; idx < s.steps.length; idx++) {
        const step = s.steps[idx];
        if (!step || !step.pcs || !step.pcs.length) continue;
        const emb = this.embedPcs(step.pcs);
        if (!emb.centroid) continue;
        const p = this.latticeToScreen(emb.centroid.a, emb.centroid.b);
        if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
        const active = idx === s.activeStep;
        const col = step.color || '#3457d5';
        const rgb = hexToRgb(col);
        if (active) {
          /* 当前 step 的轮廓 */
          const pts = emb.points.map(q => this.latticeToScreen(q.a, q.b));
          const hull = hullOf(pts);
          if (hull.length >= 3) {
            c.beginPath();
            hull.forEach((q, k) => k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y));
            c.closePath();
            c.fillStyle = rgba(rgb, 0.14);
            c.fill();
            c.strokeStyle = rgba(rgb, 0.65);
            c.lineWidth = 1.6;
            c.stroke();
          }
        }
        c.beginPath();
        c.arc(p.x, p.y, active ? 13 : 8.5, 0, Math.PI * 2);
        c.fillStyle = active ? col : rgba(rgb, 0.78);
        c.fill();
        c.strokeStyle = '#fffdf8';
        c.lineWidth = active ? 2.2 : 1.6;
        c.stroke();
        c.fillStyle = '#fff';
        c.font = `${active ? 700 : 600} ${active ? 11 : 9}px "Segoe UI", sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(idx + 1), p.x, p.y + 0.5);
        this._stepBadges.push({ x: p.x, y: p.y, r: active ? 13 : 8.5, index: idx });
        if (active) {
          const label = step.label || step.chord && step.chord.symbol || '';
          if (label) this._drawLabelPill(p.x, p.y - 26, label, col, 1);
        }
      }
    }

    /* 6.5 four-part voices on the grid */
    if (s.satbMode) this._drawSatbVoices();

    /* 7. empty hint (only if nothing) */
    if (!sel && (!s.steps || !s.steps.length) && !key) {
      c.textAlign = 'center';
      c.fillStyle = 'rgba(32,35,39,.22)';
      c.font = '400 13px "Segoe UI", "Microsoft YaHei", sans-serif';
      c.fillText('点击任意三角形选择和弦，或点击音名选择音符', w / 2, h - 44);
    }
  }

  _haloText(text, x, y, color, bold) {
    const c = this.ctx;
    c.lineWidth = bold ? 3.5 : 3;
    c.strokeStyle = `rgba(${PAPER},.92)`;
    c.strokeText(text, x, y);
    c.fillStyle = color;
    c.fillText(text, x, y);
  }

  _anyVisible(pts, w, h) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return maxX > -60 && minX < w + 60 && maxY > -60 && minY < h + 60;
  }

  noteFromScreen(x, y) {
    const { a, b } = this.screenToLattice(x, y);
    return this.noteAt(Math.round(a), Math.round(b));
  }

  /* 当前和弦在网格上只铺一块区域（三角形/多边形/连线），不画顶点 */
  _drawChordFill(c, sel, selRgb, selTri, selColor) {
    if (selTri) {
      const tri = this.triData(selTri.i, selTri.j, selTri.up);
      if (!tri) return;
      const pts = tri.vertices.map(([va, vb]) => this.latticeToScreen(va, vb));
      this._drawSelectionPolygon(pts, selColor, true);
      return;
    }
    if (!sel || !sel.pcs || sel.pcs.length < 2) return;
    const emb = this.embedPcs(sel.pcs);
    const pts = emb.points.map(p => this.latticeToScreen(p.a, p.b));
    if (pts.length < 2) return;
    const hull = hullOf(pts);
    if (hull.length >= 3) {
      c.beginPath();
      hull.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
      c.closePath();
      c.fillStyle = rgba(selRgb, 0.36);
      c.fill();
      c.strokeStyle = rgba(selRgb, 0.92);
      c.lineWidth = 2.4;
      c.stroke();
    } else if (hull.length === 2) {
      c.beginPath();
      c.moveTo(hull[0].x, hull[0].y); c.lineTo(hull[1].x, hull[1].y);
      c.strokeStyle = rgba(selRgb, 0.7); c.lineWidth = 8; c.lineCap = 'round'; c.stroke();
      c.strokeStyle = rgba(selRgb, 0.22); c.lineWidth = 16; c.stroke();
    }
  }

  _drawSelectionPolygon(pts, color, strong) {
    const c = this.ctx;
    const rgb = hexToRgb(color);
    c.beginPath();
    pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
    c.closePath();
    c.fillStyle = rgba(rgb, strong ? 0.38 : 0.3);
    c.fill();
    c.strokeStyle = rgba(rgb, 0.92);
    c.lineWidth = 2.2;
    c.stroke();
  }

  _drawLabelPill(x, y, text, color, alpha = 1) {
    if (!text) return;
    const c = this.ctx;
    c.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
    const m = c.measureText(text);
    const padX = 6.5, padY = 4;
    const w = m.width + padX * 2, h = 17;
    c.save();
    c.globalAlpha = alpha;
    roundRect(c, x - w / 2, y - h / 2, w, h, 5);
    c.fillStyle = '#fffdf8';
    c.fill();
    c.strokeStyle = color;
    c.lineWidth = 1.2;
    c.stroke();
    c.fillStyle = color;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, y + 0.3);
    c.restore();
  }

  /* -------------------------------------------------------------- events */

  _bind() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', ev => {
      canvas.setPointerCapture(ev.pointerId);
      this.pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
      if (this.pointers.size === 1) {
        this.drag = { x: ev.offsetX, y: ev.offsetY, panX: this.panX, panY: this.panY, moved: false };
      } else if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        this.pinch = {
          dist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
          mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
          zoom: this.zoom,
          panX: this.panX, panY: this.panY,
        };
        this.drag = null;
      }
    });

    canvas.addEventListener('pointermove', ev => {
      const x = ev.offsetX, y = ev.offsetY;
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x, y });
      if (this.pinch && this.pointers.size >= 2) {
        const [p1, p2] = [...this.pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (this.pinch.dist > 4) {
          const ratio = d / this.pinch.dist;
          const target = Math.max(this.zoomMin, Math.min(this.zoomMax, this.pinch.zoom * ratio));
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          this.zoom = target;
          this.panX = mid.x - (this.pinch.mid.x - this.pinch.panX) * (target / this.pinch.zoom);
          this.panY = mid.y - (this.pinch.mid.y - this.pinch.panY) * (target / this.pinch.zoom);
          this.app.onZoom && this.app.onZoom(this.zoom);
          this.render();
        }
        return;
      }
      if (this.drag) {
        const dx = x - this.drag.x, dy = y - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) this.drag.moved = true;
        if (this.drag.moved) {
          this.panX = this.drag.panX + dx;
          this.panY = this.drag.panY + dy;
          this._hideTooltip();
          this.render();
        }
        return;
      }
      const hit = this.hitTest(x, y);
      const key = hit && hit.type === 'triangle' ? `${hit.type}:${hit.i}:${hit.j}:${hit.up}` :
        hit && hit.type === 'note' ? `${hit.type}:${hit.pc}` :
          hit && hit.type === 'step' ? `${hit.type}:${hit.index}` : '';
      const prevKey = this.hover ? this.hover._key : '';
      if (key !== prevKey) {
        if (hit) hit._key = key;
        this.hover = hit;
        this.render();
      }
      if (hit) {
        this._showTooltip(hit, x, y);
        canvas.style.cursor = hit.type === 'step' ? 'pointer' : 'crosshair';
      } else {
        this._hideTooltip();
        canvas.style.cursor = 'grab';
      }
    });

    const endPointer = ev => {
      if (this.pointers.has(ev.pointerId)) this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) {
        const d = this.drag;
        this.drag = null;
        if (d && !d.moved) this._click(ev.offsetX, ev.offsetY, ev);
        else if (d && d.moved) this._hideTooltip();
      }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', ev => {
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
    });

    canvas.addEventListener('wheel', ev => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      const old = this.zoom;
      const factor = Math.exp(-ev.deltaY * 0.0014);
      const z = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom * factor));
      if (z === old) return;
      this.zoom = z;
      this.panX = x - (x - this.panX) * (z / old);
      this.panY = y - (y - this.panY) * (z / old);
      this.app.onZoom && this.app.onZoom(this.zoom);
      this._hideTooltip();
      this.render();
    }, { passive: false });

    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this._hideTooltip();
      this.render();
    });
  }

  _click(x, y, ev) {
    const hit = this.hitTest(x, y);
    if (!hit) return;
    if (hit.type === 'step') { this.app.selectStep(hit.index); return; }
    if (hit.type === 'note') { this.app.toggleNote(hit.pc, ev); return; }
    if (hit.type === 'triangle') {
      this.app.selectTriad(hit);
    }
  }

  _showTooltip(hit, x, y) {
    const s = this._state;
    const naming = s.naming;
    let html = '';
    if (hit.type === 'triangle') {
      const info = this.triadInfo(hit.pcs.slice().sort((a, b) => a - b).join(','), hit.pcs, hit.root, s.key);
      const chord = info.chord;
      const fn = info.fn;
      const name = chord ? chord.symbol : '';
      html = `<div class="tt-name">${name} <span style="font-weight:400;color:#b9b3a4;font-size:9px">${hit.quality === 'maj' ? '大三和弦 ▲' : '小三和弦 ▼'}</span></div>`;
      if (fn) html += `<div class="tt-sub">${fn.roman} · ${fn.desc}</div>`;
      else html += `<div class="tt-sub">${hit.pcs.map(pc => naming === 'integer' ? pc : FLAT(pc)).join(' · ')}</div>`;
    } else if (hit.type === 'note') {
      const pc = hit.pc;
      let degTxt = '';
      if (s.key) {
        const d = degreeOf(s.key, pc);
        degTxt = d >= 0 ? ` · ${ROMAN[d]} 级` : ' · 调外音';
      }
      html = `<div class="tt-name">${naming === 'integer' ? pc : FLAT(pc)}</div><div class="tt-sub">点击加入 / 移出音集${degTxt}</div>`;
    } else if (hit.type === 'step') {
      const step = s.steps[hit.index];
      html = `<div class="tt-name">第 ${hit.index + 1} 个和弦 · ${step.label || ''}</div><div class="tt-sub">点击跳转到此环节</div>`;
    }
    this.app.showTooltip(html, x, y, this.canvas);
  }

  _hideTooltip() { this.app.hideTooltip(); }
}

/* ------------------------------------------------------------- geometry */

function hullOf(points) {
  if (points.length <= 1) return points.slice();
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

function evaluateEmbedding(points) {
  const hull = hullOf(points);
  const area = polygonArea(hull);
  let maxEdge = 0, perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = dist(points[i], points[j]);
      maxEdge = Math.max(maxEdge, d);
    }
  }
  for (let i = 0; i < hull.length; i++) {
    perimeter += dist(hull[i], hull[(i + 1) % hull.length]);
  }
  const cen = centroid(points);
  const centroidDist = Math.hypot(cen.x, cen.y);
  let score = area + perimeter * 0.06 + maxEdge * 0.04 + centroidDist * 0.03;
  if (points.length >= 3 && area < 0.05) score += 1.2;
  return { hull, area, centroid: cen, score, collinear: hull.length < 3 };
}

function mstEdges(points) {
  const n = points.length;
  const used = new Array(n).fill(false);
  const edges = [];
  used[0] = true;
  for (let e = 1; e < n; e++) {
    let best = null;
    for (let i = 0; i < n; i++) {
      if (!used[i]) continue;
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const d = dist(points[i], points[j]);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (!best) break;
    used[best.j] = true;
    edges.push([best.i, best.j]);
  }
  return edges;
}
