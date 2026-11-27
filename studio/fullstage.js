/* ==========================================================================
   fullstage.js — 曲谱同步舞台（新版显示方案）
   左：原谱总谱连续横向流动，蓝色阅读线固定在宽度的 35%
   右：缩小的 Tonnetz + 当前调性与和弦 + 五度圈 / 十二平均律圈
   下：当前和弦的前两个 / 当前 / 后两个（功能级数），以及双层导航
   ========================================================================== */

import { nameOf, mod12, functionColor } from '../assets/js/core.js';
import { TonnetzView, FifthCircle } from '../assets/js/tonnetz.js';
import { keyAt, measureOfBeat } from './analysis.js';
import { NativeScore } from './nativescore.js';
import { buildSatbVoices } from './voicing.js';
import { fifthsSign } from './musicxml.js';
import { keySigFifths } from './spelling.js';

export const BASE_W = 1920;
export const BASE_H = 1080;
export const VIDEO_SCALE = 2;

const W = BASE_W, H = BASE_H;
const C = {
  bg: '#faf8f1',
  paper: '#fffdf8',
  ink: '#221f1a',
  ink2: '#3c3832',
  muted: '#7c7364',
  faint: '#9a9184',
  line: 'rgba(34,32,28,.13)',
  blue: '#287D9F',
  blueSoft: 'rgba(40,125,159,.10)',
  accent: '#b4472f',
};

const LAYOUT = {
  header: { x: 0, y: 0, w: W, h: 56 },
  score: { x: 24, y: 58, w: 1500, h: 792 },
  strip: { x: 24, y: 860, w: 1500, h: 80 },
  side: { x: 1536, y: 58, w: 360, h: 882 },
};
const GRID = { x: 1552, y: 90, w: 328, h: 246 };
const VIDEO_BOX = { x: 1552, y: 696, w: 328, h: 184 };
const READ_LINE = Math.round(W * 0.35);

const FUNC_ZH = { T: '主', S: '下属', D: '属', t: '主（平行）', s: '下属（平行）', d: '属（平行）', '?': '调外' };

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
function font(ctx, size, weight = '400', family = '"Segoe UI", "Microsoft YaHei", sans-serif') {
  ctx.font = `${weight} ${size}px ${family}`;
}
const SERIF = '"Source Han Serif SC", "Songti SC", "Georgia", serif';
function serif(ctx, size, weight = '500') { font(ctx, size, weight, SERIF); }

export function fmtTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function tonicTriad(key) {
  if (!key) return null;
  const third = key.mode && key.mode.group === 'minor' ? 3 : 4;
  return [key.tonic, mod12(key.tonic + third), mod12(key.tonic + 7)];
}
function funcColor(func) {
  if (!func) return C.muted;
  const g = String(func).toUpperCase();
  return functionColor(g);
}

export class FullStage {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = Number(opts.scale) || VIDEO_SCALE;
    canvas.width = W * this.scale;
    canvas.height = H * this.scale;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    this.data = null;
    this.score = null;
    this.analysis = null;
    this.satbVoices = null;
    this.satbData = null;
    this.state = {
      time: 0, beat: 0, measureIndex: 0, segmentIndex: 0, analysisMode: 'auto',
      segment: null, key: null, measureObj: null, status: 'empty', statusText: '载入总谱…',
      naming: 'reference', satb: false, circles: { fifths: true, chromatic: false },
    };
    this._lastKey = null;
    this._lastSeg = -1;
    this._lastNaming = '';
    this._lastSatb = null;
    this._lastCircles = '';
    this._circleKey = '';

    /* 上传视频：lead = 视频里有效演奏开始的时间（用于裁掉开头准备） */
    this.video = { el: null, url: '', name: '', lead: 0, offset: 0, ready: false, analyzing: false, reason: '', warp: null, master: false };
    this.playing = false;
    this.recording = false;
    this.onVideoRequest = null;

    this._hosts();
    this._initTonnetz();
    this.native = new NativeScore();
    this.native.onUpdate = () => { if (this.data) this.draw(); };
    this.native.load();
    this._bindStageClicks();
    this.draw();
  }

  /* ---------------------------------------------------------- offscreen */

  _hosts() {
    const wrap = (w, h) => {
      const host = document.createElement('div');
      host.style.cssText = `position:fixed;left:-20000px;top:0;width:${w}px;height:${h}px;overflow:hidden;`;
      const c = document.createElement('canvas');
      c.style.cssText = `width:${w}px;height:${h}px;display:block;`;
      host.appendChild(c);
      document.body.appendChild(host);
      return { host, canvas: c, w, h };
    };
    this.gridHost = wrap(GRID.w, GRID.h);
    this.gridCanvas = this.gridHost.canvas;
    this.deadCircle = wrap(300, 300).canvas;
    this.circleHosts = {
      fifths: wrap(160, 160),
      chromatic: wrap(160, 160),
    };
  }

  _initTonnetz() {
    this.tonnetz = new TonnetzView({
      canvas: this.gridCanvas,
      circleCanvas: this.deadCircle,
      pixelRatio: Math.max(2, this.scale),
      app: {
        onZoom: () => {}, hideTooltip: () => {}, showTooltip: () => {},
        selectStep: () => {}, toggleNote: () => {}, selectTriad: () => {},
        circleHover: () => {},
      },
    });
    this.tonnetz.zoom = 0.58;
    this.tonnetz.zoomMin = 0.5;
    this.tonnetz.zoomMax = 2;
    this.tonnetz.panX = GRID.w * 0.5;
    this.tonnetz.panY = GRID.h * 0.5;
    this.tonnetz.autoFit = true;
    this.tonnetz.fitMargin = 10;
    this.tonnetz.render();

    this.circles = {};
    for (const mode of ['fifths', 'chromatic']) {
      const { canvas } = this.circleHosts[mode];
      this.circles[mode] = new FifthCircle(canvas, { pixelRatio: Math.max(2, this.scale) });
      this.circles[mode].state.mode = mode;
      /* 小尺寸下用紧凑标注，避免音名挤在一起 */
      this.circles[mode].state.compact = true;
      this.circles[mode].resize();
    }
  }

  /* ------------------------------------------------------------ video in */

  _bindStageClicks() {
    this.canvas.addEventListener('click', ev => {
      const r = this.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (ev.clientX - r.left) * (W / r.width);
      const y = (ev.clientY - r.top) * (H / r.height);
      if (x >= VIDEO_BOX.x && x <= VIDEO_BOX.x + VIDEO_BOX.w && y >= VIDEO_BOX.y && y <= VIDEO_BOX.y + VIDEO_BOX.h) {
        if (this.onVideoRequest) this.onVideoRequest();
      }
    });
  }

  setPlaying(on) {
    this.playing = !!on;
    this._syncVideo(this.state.time);
  }

  setRecording(on) {
    this.recording = !!on;
    if (this.data) this.draw();
  }

  clearVideo() {
    const v = this.video;
    if (v.el) { try { v.el.pause(); } catch { } }
    if (v.url) { try { URL.revokeObjectURL(v.url); } catch { } }
    this.video = { el: null, url: '', name: '', lead: 0, offset: 0, ready: false, analyzing: false, reason: '', warp: null, master: false };
    if (this.data) this.draw();
  }

  /**
   * 载入本地视频并自动对齐：
   * 解码音轨 → 50ms RMS 包络 → 找到第一个持续有效的声音 → 得到需要裁掉的开头时长。
   */
  async setVideoFile(file) {
    this.clearVideo();
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.src = url;
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    await new Promise((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error('无法读取该视频（编码不受支持）'));
    }).catch(e => {
      try { URL.revokeObjectURL(url); } catch { }
      throw e;
    });
    this.video = {
      el, url, name: file.name || '视频', lead: 0, offset: 0,
      ready: true, analyzing: true, reason: '', warp: null, master: true,
    };
    el.addEventListener('seeked', () => { if (this.data) this.draw(); });
    this.draw();

    let info = { lead: 0, reason: 'no-audio' };
    try {
      info = await this._detectLead(file);
    } catch (e) {
      info = { lead: 0, reason: 'decode-failed' };
    }
    this.video.lead = Math.max(0, Number(info.lead) || 0);
    this.video.offset = 0;
    this.video.analyzing = false;
    this.video.reason = info.reason || '';
    this._syncVideo(this.state.time);
    this.draw();
    return { ...info, lead: this.video.lead, name: this.video.name, duration: el.duration || 0 };
  }

  async _detectLead(file) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return { lead: 0, reason: 'no-audio' };
    const ctx = new Ctx();
    try {
      const buf = await file.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const sr = audio.sampleRate;
      const win = Math.max(1, Math.round(sr * 0.05));
      const frames = Math.floor(ch.length / win);
      if (frames < 4) return { lead: 0, reason: 'too-short' };
      const rms = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        const base = i * win;
        for (let j = 0; j < win; j++) { const v = ch[base + j]; sum += v * v; }
        rms[i] = Math.sqrt(sum / win);
      }
      const sorted = Array.from(rms).sort((a, b) => a - b);
      const floor = sorted[Math.floor(frames * 0.15)] || 0;
      const peak = sorted[frames - 1] || 0;
      const th = Math.max(peak * 0.02, floor * 4, 0.0022);
      let idx = -1;
      for (let i = 0; i < frames - 3; i++) {
        if (rms[i] >= th && rms[i + 1] >= th * 0.55 && rms[i + 2] >= th * 0.4) { idx = i; break; }
      }
      if (idx < 0) return { lead: 0, reason: 'silent' };
      const lead = Math.max(0, (idx * win) / sr - 0.12);
      return { lead: Math.min(lead, audio.duration * 0.9), reason: 'ok', duration: audio.duration };
    } finally {
      try { await ctx.close(); } catch { }
    }
  }

  setVideoWarp(warp) {
    this.video.warp = warp || null;
    if (this.data) this.draw();
  }

  /* 视频时间（秒，相对剪辑起点）→ 总谱时间 */
  scoreTimeFromVideo(vt) {
    const w = this.video && this.video.warp;
    const v = Math.max(0, Number(vt) || 0);
    if (w && w.video && w.video.length) {
      const arr = w.video;
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid - 1; }
      if (lo >= arr.length - 1) return w.score[w.score.length - 1] || 0;
      const f = (v - arr[lo]) / Math.max(1e-6, arr[lo + 1] - arr[lo]);
      return w.score[lo] + (w.score[lo + 1] - w.score[lo]) * Math.max(0, Math.min(1, f));
    }
    return Math.max(0, v - (this.video.lead || 0));
  }

  /* 总谱时间 → 视频时间 */
  videoTimeFromScore(st) {
    const w = this.video && this.video.warp;
    const s = Math.max(0, Number(st) || 0);
    if (w && w.score && w.score.length) {
      const arr = w.score;
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= s) lo = mid; else hi = mid - 1; }
      if (lo >= arr.length - 1) return w.video[w.video.length - 1] || 0;
      const f = (s - arr[lo]) / Math.max(1e-6, arr[lo + 1] - arr[lo]);
      return w.video[lo] + (w.video[lo + 1] - w.video[lo]) * Math.max(0, Math.min(1, f));
    }
    return s + (this.video.lead || 0);
  }

  _syncVideo(t) {
    const v = this.video;
    if (!v.el || !v.ready) return;
    if (v.master) return; /* 视频为主时钟时不再反向 seek */
    const dur = v.el.duration || 0;
    const want = Math.max(0, Math.min(dur > 0 ? dur - 0.04 : 1e9, v.lead + t - v.offset));
    if (this.playing) {
      if (v.el.paused) v.el.play().catch(() => { });
      if (Math.abs(v.el.currentTime - want) > 0.45) v.el.currentTime = want;
    } else {
      if (!v.el.paused) v.el.pause();
      if (Math.abs(v.el.currentTime - want) > 0.06) v.el.currentTime = want;
    }
  }

  /* -------------------------------------------------------------- data */

  setLoading(text) {
    this.state.status = 'loading';
    this.state.statusText = text || '载入中…';
    this.draw();
  }
  setError(text) {
    this.state.status = 'error';
    this.state.statusText = text || '载入失败';
    this.draw();
  }

  setData({ score, analysis, filename }) {
    this.data = { score, analysis, filename };
    this.score = score;
    this.analysis = analysis;
    this.satbVoices = buildSatbVoices(analysis.segments);
    this.satbData = { voices: this.satbVoices };
    this.state.status = 'ready';
    this.state.time = 0;
    this.state.beat = 0;
    this.state.measureIndex = 0;
    this.state.segmentIndex = 0;
    this.state.segment = analysis.segments[0] || null;
    this.state.measureObj = score.measures[0] || null;
    this.state.key = analysis.globalKey;
    this._lastKey = null;
    this._lastSeg = -1;
    this._lastNaming = '';
    this._lastSatb = null;
    this._lastCircles = '';
    this._circleKey = '';
    this.tonnetz.zoom = 0.58;
    this.tonnetz.panX = GRID.w * 0.5;
    this.tonnetz.panY = GRID.h * 0.5;
    this._centerPcs(tonicTriad(analysis.globalKey));
    this.tonnetz.setHome();
    this._syncTonnetz(true);
    this._syncCircles(true);
    this.draw();
  }

  setNaming(mode) {
    this.state.naming = mode === 'integer' ? 'integer' : 'reference';
    this._lastNaming = '';
    this._circleKey = '';
    this._syncTonnetz();
    this._syncCircles(true);
    this.draw();
  }

  _segmentAtonal(seg = this.state.segment) {
    const mode = this.state.analysisMode || 'auto';
    if (mode === 'atonal') return true;
    if (mode === 'tonal') return false;
    return !!(seg && seg.atonal);
  }

  setAnalysisMode(mode) {
    this.state.analysisMode = mode === 'tonal' || mode === 'atonal' ? mode : 'auto';
    this._lastAtonal = null;
    this._lastNaming = '';
    this._syncTonnetz(true);
    this.draw();
  }

  setSatb(on) {
    this.state.satb = !!on;
    this._lastSatb = null;
    this._syncTonnetz();
    this.draw();
  }

  setCircle(mode, on) {
    if (mode !== 'fifths' && mode !== 'chromatic') return;
    this.state.circles[mode] = !!on;
    this._lastCircles = '';
    this.draw();
  }

  /* ------------------------------------------------------------ tonnetz */

  _centerPcs(pcs) {
    if (!pcs || !pcs.length) return;
    const emb = this.tonnetz.embedPcs(pcs);
    const pts = emb.points.map(p => this.tonnetz.latticeToScreen(p.a, p.b));
    if (!pts.length) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    this.tonnetz.panX += this.tonnetz.w / 2 - cx;
    this.tonnetz.panY += this.tonnetz.h / 2 - cy;
  }

  _syncTonnetz(force = false) {
    const seg = this.state.segment;
    const key = this.state.key;
    const atonal = this._segmentAtonal(seg);
    const naming = atonal ? 'integer' : this.state.naming;
    const satbOn = this.state.satb && !atonal;
    const segIndex = this.state.segmentIndex;

    /* 网格锚定在全曲主调：整首曲子主三和弦三角形固定不动，
       换和弦、短暂离调都不再重新居中；只有载入新总谱才重新定位。 */
    const gridKey = (this.analysis && this.analysis.globalKey) || key;
    if (!force && segIndex === this._lastSeg && naming === this._lastNaming &&
        satbOn === this._lastSatb && key === this._lastKey && atonal === this._lastAtonal) return;
    this._lastSeg = segIndex;
    this._lastNaming = naming;
    this._lastSatb = satbOn;
    this._lastKey = key;
    this._lastAtonal = atonal;

    const selPcs = seg ? (seg.chord ? seg.chord.pcs : (seg.pcs || [])) : [];
    const sel = seg && selPcs.length ? {
      pcs: selPcs,
      bass: seg.bassPc,
      chord: atonal ? { ...(seg.chord || {}), symbol: `[${selPcs.join(',')}]` } : seg.chord,
      color: atonal ? '#5f6b73' : funcColor(seg.func),
      spelling: gridKey ? gridKey.spell : 'flat',
      source: 'studio',
    } : null;
    const voice = satbOn && this.satbVoices ? this.satbVoices[segIndex] : null;
    const dur = seg ? Math.max(0.3, Math.min(8, (seg.endTime - seg.startTime) || 1.2)) : 1.2;

    this.tonnetz.setState({
      key: gridKey,
      selection: sel,
      steps: this.analysis ? this.analysis.segments : [],
      activeStep: segIndex,
      showFunctions: !atonal,
      showDegrees: !atonal,
      showChordNames: false,
      showSteps: false,
      vivid: true,
      naming,
      circleMode: 'fifths',
      satbMode: !!(voice && seg && seg.chord && !atonal),
      satb: this.satbData,
      satbDur: dur,
      satbHistory: 1,
    });
    /* 网格只锚定全曲主调，换和弦/离调都不再重新居中。 */
    if (this.tonnetz.circle) {
      this.tonnetz.circle.cancelRotation();
      this.tonnetz.circle.rotExtra = 0;
    }
    this.tonnetz.draw();
  }

  _syncCircles(force = false) {
    const key = this.state.key;
    const seg = this.state.segment;
    const naming = this.state.naming;
    const circles = this.state.circles;
    const sig = `${key ? key.tonic + ':' + key.modeId : 'none'}|${seg ? seg.startBeat : 'x'}|${naming}|${circles.fifths}|${circles.chromatic}`;
    if (!force && sig === this._circleKey) return;
    this._circleKey = sig;
    const sel = seg && seg.chord ? {
      pcs: seg.chord.pcs,
      bass: seg.bassPc,
      chord: seg.chord,
      color: funcColor(seg.func),
      spelling: key ? key.spell : 'flat',
    } : null;
    for (const mode of ['fifths', 'chromatic']) {
      const circle = this.circles[mode];
      if (!circle) continue;
      circle.cancelRotation();
      circle.state.mode = mode;
      circle.setState({
        key,
        selection: sel,
        naming,
        compact: this.state.circles.fifths && this.state.circles.chromatic,
        steps: [],
        activeStep: -1,
      });
      circle.cancelRotation();
      circle.rotExtra = 0;
      circle.render();
    }
  }

  /* -------------------------------------------------------------- time */

  updateTime(sec) {
    if (!this.score || !this.analysis) return;
    const t = Math.max(0, Math.min(this.score.totalSeconds, Number(sec) || 0));
    const beat = Math.max(0, Math.min(this.score.totalBeats, this.score.secondsToBeat(t)));
    const segments = this.analysis.segments;
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].startBeat <= beat + 1e-6) lo = mid; else hi = mid - 1;
    }
    const seg = segments[lo] || null;
    const m = measureOfBeat(this.score, beat) || this.score.measures[0];
    this.state.time = t;
    this.state.beat = beat;
    this.state.measureIndex = m ? m.index : 0;
    this.state.measureObj = m;
    this.state.segmentIndex = lo;
    this.state.segment = seg;
    this.state.key = keyAt(this.analysis, beat);
    this._syncTonnetz();
    this._syncCircles();
    this._syncVideo(t);
    this.draw();
  }

  /* -------------------------------------------------------------- draw */

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    this._drawHeader(ctx);
    if (!this.data || !this.score) {
      this._drawEmpty(ctx);
      return;
    }
    this._drawScore(ctx);
    this._drawStrip(ctx);
    this._drawSide(ctx);
    this._drawFooter(ctx);
  }

  _drawHeader(ctx) {
    const h = LAYOUT.header;
    ctx.fillStyle = '#f7f4ee';
    ctx.fillRect(0, 0, W, h.h);
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(0, h.h - 0.5); ctx.lineTo(W, h.h - 0.5); ctx.stroke();

    ctx.fillStyle = C.blue;
    ctx.fillRect(30, 22, 4, 20);
    serif(ctx, 14, '600');
    ctx.fillStyle = C.ink;
    ctx.fillText('原谱总谱', 44, 38);
    font(ctx, 8.5, '400');
    ctx.fillStyle = C.muted;
    ctx.fillText('SCORE SYNC · 固定阅读线 35%', 44, 51);

    const title = this.score ? (this.score.title || this.data.filename || '未命名总谱') : '总谱同步';
    serif(ctx, 18, '600');
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.fillText(title.length > 46 ? title.slice(0, 46) + '…' : title, W / 2, 33);
    font(ctx, 9, '400');
    ctx.fillStyle = C.muted;
    const meta = this.score
      ? `${this.score.parts.length} 声部 · ${this.score.measures.length} 小节 · ${this.score.timeSig.beats}/${this.score.timeSig.beatType} · ${fmtTime(this.score.totalSeconds)}`
      : 'MusicXML / MXL 总谱';
    ctx.fillText(meta, W / 2, 49);

    ctx.textAlign = 'right';
    font(ctx, 9, '500');
    ctx.fillStyle = C.muted;
    const key = this.state.key || (this.analysis && this.analysis.globalKey);
    const atonal = this._segmentAtonal();
    const keyText = key ? `${nameOf(key.tonic, key.spell)} ${key.mode.short}` : '—';
    ctx.fillText(atonal ? '无调性 · 音集 0–11' : key ? `当前调性 ${keyText} · 调号 ${fifthsSign(keySigFifths(key))}` : '等待载入', W - 30, 33);
    const m = this.state.measureObj;
    ctx.fillText(m ? `第 ${m.number} 小节` : '—', W - 30, 49);
    ctx.textAlign = 'left';
  }

  _drawScore(ctx) {
    const p = LAYOUT.score;
    /* 图块只对应内置示例总谱；载入其他总谱时明确提示，避免张冠李戴 */
    if (this.native && this.native.expectedBeats && this.score &&
        Math.abs(this.score.totalBeats - this.native.expectedBeats) > 1.5) {
      ctx.fillStyle = C.paper;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      serif(ctx, 18, '600');
      ctx.fillStyle = C.ink2;
      ctx.textAlign = 'center';
      ctx.fillText('该总谱的谱面图块尚未预渲染', p.x + p.w / 2, p.y + p.h / 2 - 18);
      font(ctx, 11, '400');
      ctx.fillStyle = C.muted;
      ctx.fillText('播放、和声分析与 Tonnetz 仍可用；开源演示版只为示例总谱附带图块。', p.x + p.w / 2, p.y + p.h / 2 + 12);
      ctx.fillText('生成与替换流程见 README「关于谱面图块」。', p.x + p.w / 2, p.y + p.h / 2 + 32);
      ctx.textAlign = 'left';
      return;
    }
    const ok = this.native && this.native.draw(ctx, LAYOUT.score, this.state.beat);
    if (ok) return;
    ctx.fillStyle = C.paper;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = C.line;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    font(ctx, 12, '400');
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'center';
    ctx.fillText(this.native && this.native.error ? '原生总谱图块载入失败' : '正在载入原生总谱图块…', p.x + p.w / 2, p.y + p.h / 2);
    ctx.textAlign = 'left';
  }

  _drawStrip(ctx) {
    const p = LAYOUT.strip;
    ctx.fillStyle = C.paper;
    rr(ctx, p.x, p.y, p.w, p.h, 9);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    font(ctx, 10, '600');
    ctx.fillStyle = C.ink;
    ctx.fillText('和弦进行 · 功能级数', p.x + 14, p.y + 18);
    font(ctx, 8.5, '400');
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.fillText('前两个 = 已显示 · 后两个 = 准备', p.x + p.w - 14, p.y + 18);
    ctx.textAlign = 'left';

    const segments = this.analysis ? this.analysis.segments : [];
    if (!segments.length) return;
    const cur = this.state.segmentIndex;
    const gap = 8;
    const cardW = (p.w - 28 - gap * 4) / 5;
    const cardH = 66;
    const y = p.y + 22;

    for (let k = 0; k < 5; k++) {
      const idx = cur - 2 + k;
      const x = p.x + 14 + k * (cardW + gap);
      const seg = segments[idx] || null;
      const state = idx < 0 ? 'gap' : idx >= segments.length ? 'end' : idx < cur ? 'shown' : idx === cur ? 'current' : 'next';
      this._drawChordCard(ctx, x, y, cardW, cardH, seg, state);
    }
  }

  _drawChordCard(ctx, x, y, w, h, seg, state) {
    const current = state === 'current';
    const color = seg ? funcColor(seg.func) : C.muted;
    ctx.save();
    rr(ctx, x, y, w, h, 7);
    if (current) {
      ctx.fillStyle = '#fffdf8';
      ctx.fill();
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else if (state === 'shown') {
      ctx.fillStyle = '#f6f2e8';
      ctx.fill();
      ctx.strokeStyle = 'rgba(34,32,28,.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,253,248,.55)';
      ctx.fill();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(34,32,28,.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const statusText = state === 'current' ? '当前' : state === 'shown' ? '已显示' : state === 'next' ? '准备' : state === 'gap' ? '起始' : '结束';
    font(ctx, 9.5, '600');
    ctx.fillStyle = state === 'current' ? C.blue : state === 'shown' ? '#6f8b74' : C.faint;
    ctx.textAlign = 'right';
    ctx.fillText(statusText, x + w - 10, y + 16);
    ctx.textAlign = 'left';

    if (!seg) {
      serif(ctx, 15, '500');
      ctx.fillStyle = 'rgba(34,32,28,.22)';
      ctx.textAlign = 'center';
      ctx.fillText('—', x + w / 2, y + 40);
      ctx.textAlign = 'left';
      ctx.restore();
      return;
    }

    ctx.fillStyle = color;
    rr(ctx, x + 1, y + 14, 3, h - 28, 1.5);
    ctx.fill();

    const tm = measureOfBeat(this.score, seg.startBeat);
    const atonal = this._segmentAtonal(seg);
    const notes = seg.chord ? seg.chord.pcs : (seg.pcs || []);
    const roman = atonal ? '' : (seg.roman || '—');
    const symbol = atonal ? `[${(notes || []).join(',')}]` : (seg.symbol || '—');
    const naming = atonal ? 'integer' : this.state.naming;
    const noteText = notes && notes.length
      ? notes.map(pc => naming === 'integer' ? String(pc) : nameOf(pc, this.state.key ? this.state.key.spell : 'flat')).join(' ')
      : '';
    const func = atonal ? '' : (seg.func ? String(seg.func) : '');
    const alpha = state === 'shown' ? 0.66 : 1;

    ctx.globalAlpha = alpha;
    font(ctx, 16, '700');
    ctx.fillStyle = color;
    ctx.fillText(roman, x + 12, y + 23);
    const rw = ctx.measureText(roman).width;

    if (func) {
      font(ctx, 9.5, '600');
      ctx.fillStyle = color;
      ctx.fillText(func + ' · ' + (FUNC_ZH[func] || '功能'), x + 12 + rw + 7, y + 22);
    }

    serif(ctx, 16, '600');
    let sym = symbol;
    while (sym.length > 3 && ctx.measureText(sym).width > w - 24) sym = sym.slice(0, -1);
    const symW = ctx.measureText(sym).width;
    ctx.fillStyle = C.ink;
    ctx.fillText(sym, x + 12, y + 45);

    if (noteText) {
      font(ctx, 9.5, '400');
      ctx.fillStyle = C.muted;
      const nx = x + 12 + Math.min(w * 0.46, symW + 8);
      const room = x + w - 10 - nx;
      let txt = noteText;
      while (txt.length > 2 && ctx.measureText(txt).width > room) txt = txt.slice(0, -2);
      if (txt.trim()) ctx.fillText(txt, nx, y + 44.5);
    }

    font(ctx, 9.5, '400');
    ctx.fillStyle = C.muted;
    const dur = Math.max(0.1, (seg.endTime - seg.startTime) || 0);
    ctx.fillText((tm ? '第 ' + tm.number + ' 小节' : '') + (dur ? ' · ' + dur.toFixed(1) + 's' : ''), x + 12, y + 61);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawSide(ctx) {
    const p = LAYOUT.side;
    ctx.fillStyle = C.paper;
    rr(ctx, p.x, p.y, p.w, p.h, 10);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    font(ctx, 9.5, '600');
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.fillText('TONNETZ · 音网', p.x + 16, p.y + 22);
    font(ctx, 8.5, '500');
    ctx.textAlign = 'right';
    const gk = this.analysis ? this.analysis.globalKey : this.state.key;
    const lk = this.state.key;
    const drift = lk && gk && (lk.tonic !== gk.tonic || lk.modeId !== gk.modeId);
    ctx.fillStyle = drift || this.state.naming === 'integer' ? C.blue : C.faint;
    ctx.fillText(drift ? `锚定 ${nameOf(gk.tonic, gk.spell)} ${gk.mode.short}`
      : this.state.naming === 'integer' ? '级数 0–11' : '音名', p.x + p.w - 16, p.y + 22);
    ctx.textAlign = 'left';

    /* 网格 */
    const g = GRID;
    ctx.save();
    rr(ctx, g.x, g.y, g.w, g.h, 8);
    ctx.clip();
    ctx.fillStyle = '#fbf8f0';
    ctx.fillRect(g.x, g.y, g.w, g.h);
    this.tonnetz.draw();
    ctx.drawImage(this.gridCanvas, 0, 0, this.gridCanvas.width, this.gridCanvas.height, g.x, g.y, g.w, g.h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(34,32,28,.22)';
    ctx.lineWidth = 1.2;
    rr(ctx, g.x, g.y, g.w, g.h, 8);
    ctx.stroke();

    /* 调性 */
    const key = this.state.key;
    let y = g.y + g.h + 24;
    const atonalSide = this._segmentAtonal();
    font(ctx, 8.5, '600');
    ctx.fillStyle = C.muted;
    ctx.fillText(atonalSide ? '分析模式' : '当前调性', p.x + 16, y - 8);
    serif(ctx, 20, '600');
    ctx.fillStyle = C.ink;
    ctx.fillText(atonalSide ? '无调性' : key ? `${nameOf(key.tonic, key.spell)} ${key.mode.short}` : '—', p.x + 16, y + 14);
    font(ctx, 9, '400');
    ctx.fillStyle = C.muted;
    ctx.fillText(atonalSide ? '音集显示 · 0–11' : key ? key.mode.name : '', p.x + 17, y + 28);
    if (!atonalSide && key) {
      font(ctx, 8.5, '600');
      ctx.fillStyle = C.blue;
      ctx.textAlign = 'right';
      ctx.fillText(`调号 ${fifthsSign(keySigFifths(key))}`, p.x + p.w - 16, y + 10);
      ctx.textAlign = 'left';
    }

    /* 当前和弦 */
    y += 56;
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(p.x + 16, y - 12); ctx.lineTo(p.x + p.w - 16, y - 12); ctx.stroke();
    const seg = this.state.segment;
    const atonal = this._segmentAtonal(seg);
    font(ctx, 8.5, '600');
    ctx.fillStyle = C.muted;
    ctx.fillText(atonal ? '当前音集' : '当前和弦', p.x + 16, y + 2);
    const chordPcs = seg ? (seg.chord ? seg.chord.pcs : (seg.pcs || [])) : [];
    if (seg && (seg.chord || chordPcs.length)) {
      serif(ctx, atonal ? 20 : 26, '600');
      ctx.fillStyle = C.ink;
      const sym = atonal ? `[${chordPcs.join(',')}]` : seg.symbol;
      ctx.fillText(sym, p.x + 16, y + 30);
      if (atonal) {
        font(ctx, 9, '500');
        ctx.fillStyle = '#5f6b73';
        ctx.fillText('音集 · 无调性', p.x + 16, y + 44);
      } else {
        const symW = ctx.measureText(sym).width;
        font(ctx, 10.5, '700');
        ctx.fillStyle = funcColor(seg.func);
        ctx.fillText(seg.roman || '', p.x + 20 + symW, y + 30);
        font(ctx, 9, '500');
        ctx.fillStyle = funcColor(seg.func);
        const f = seg.func ? String(seg.func) : '';
        ctx.fillText(f ? `${f} · ${FUNC_ZH[f] || '功能'}` : '', p.x + 16, y + 44);
      }
      font(ctx, 8.5, '400');
      ctx.fillStyle = C.muted;
      const m = this.state.measureObj;
      const dur = Math.max(0.1, (seg.endTime - seg.startTime) || 0);
      ctx.fillText(m ? `第 ${m.number} 小节 · 持续 ${dur.toFixed(1)}s` : '', p.x + 16, y + 57);
    } else {
      serif(ctx, 24, '500');
      ctx.fillStyle = 'rgba(34,32,28,.28)';
      ctx.fillText('—', p.x + 16, y + 30);
      font(ctx, 8.5, '400');
      ctx.fillStyle = C.muted;
      ctx.fillText('休止 / 音型片段', p.x + 16, y + 48);
    }

    /* 音级圈（缩小，给下方绿幕视频让位） */
    const cf = this.state.circles.fifths;
    const cc = this.state.circles.chromatic;
    const cy0 = 500;
    font(ctx, 8.5, '600');
    ctx.fillStyle = C.muted;
    ctx.fillText('音级圈', p.x + 16, cy0 - 14);
    font(ctx, 8, '400');
    ctx.textAlign = 'right';
    ctx.fillStyle = C.faint;
    ctx.fillText(cf && cc ? '五度圈 + 12 平均律圈' : cf ? '五度圈' : cc ? '12 平均律圈' : '未显示（可在上方勾选）', p.x + p.w - 16, cy0 - 14);
    ctx.textAlign = 'left';

    const choices = [];
    if (cf) choices.push('fifths');
    if (cc) choices.push('chromatic');
    if (!choices.length) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(34,32,28,.16)';
      rr(ctx, p.x + 16, cy0, p.w - 32, 150, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      font(ctx, 9, '400');
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      ctx.fillText('勾选「五度圈」或「12 平均律圈」后显示', p.x + p.w / 2, cy0 + 75);
      ctx.textAlign = 'left';
    } else if (choices.length === 1) {
      const mode = choices[0];
      const size = 160;
      const x = p.x + (p.w - size) / 2;
      this._blitCircle(ctx, mode, x, cy0, size, false);
    } else {
      const size = 152;
      const gap = 8;
      const total = size * 2 + gap;
      const x0 = p.x + (p.w - total) / 2;
      this._blitCircle(ctx, 'fifths', x0, cy0 + 2, size, true);
      this._blitCircle(ctx, 'chromatic', x0 + size + gap, cy0 + 2, size, true);
    }

    /* 绿幕视频区 */
    if (!this.recording) {
      font(ctx, 8.5, '600');
      ctx.fillStyle = C.muted;
      ctx.fillText('绿幕视频', p.x + 16, VIDEO_BOX.y - 8);
      font(ctx, 8, '400');
      ctx.textAlign = 'right';
      const v = this.video;
      ctx.fillStyle = v.analyzing ? C.blue : v.ready ? '#2f7d4f' : C.faint;
      ctx.fillText(v.analyzing ? '分析视频开头…' : v.ready ? `已对齐 · 裁头 ${v.lead.toFixed(2)}s` : '未上传（点击绿幕区上传）', p.x + p.w - 16, VIDEO_BOX.y - 8);
      ctx.textAlign = 'left';
    }
    this._drawVideoArea(ctx);

    /* 页脚信息 */
    font(ctx, 8, '400');
    ctx.fillStyle = C.faint;
    ctx.fillText(`${this.score.parts.length} 声部 · ${this.score.measures.length} 小节 · ${fmtTime(this.score.totalSeconds)}`, p.x + 16, p.y + p.h - 14);
    ctx.textAlign = 'right';
    ctx.fillText(`♩=${Math.round(this.score.tempos[0]?.bpm || 120)}`, p.x + p.w - 16, p.y + p.h - 14);
    ctx.textAlign = 'left';
  }

  _blitCircle(ctx, mode, x, y, size, showLabel = true) {
    const circle = this.circles[mode];
    if (!circle) return;
    ctx.drawImage(circle.canvas, 0, 0, circle.canvas.width, circle.canvas.height, x, y, size, size);
    if (showLabel) {
      font(ctx, 8, '500');
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      ctx.fillText(mode === 'fifths' ? '五度圈' : '12 平均律圈', x + size / 2, y + size + 11);
      ctx.textAlign = 'left';
    }
    const key = this.state.key;
    if (key) {
      font(ctx, 7.5, '400');
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      ctx.fillText(nameOf(key.tonic, key.spell), x + size / 2, y + size / 2 - 1);
      ctx.fillText('主音', x + size / 2, y + size / 2 + 9);
      ctx.textAlign = 'left';
    }
  }

  _drawVideoArea(ctx) {
    const b = VIDEO_BOX;
    const v = this.video;
    const rad = this.recording ? 0 : 8;
    ctx.save();
    rr(ctx, b.x, b.y, b.w, b.h, rad);
    ctx.fillStyle = '#00b140';
    ctx.fill();
    ctx.clip();
    if (v.ready && v.el && v.el.readyState >= 2 && v.el.videoWidth) {
      const vw = v.el.videoWidth, vh = v.el.videoHeight;
      const s = Math.max(b.w / vw, b.h / vh);
      const dw = vw * s, dh = vh * s;
      ctx.drawImage(v.el, b.x + (b.w - dw) / 2, b.y + (b.h - dh) / 2, dw, dh);
    } else {
      /* 录制时保持纯绿幕，方便后期抠像；预览时才显示占位文字 */
      if (!this.recording) {
        ctx.textAlign = 'center';
        font(ctx, 12, '700');
        ctx.fillStyle = 'rgba(255,255,255,.94)';
        ctx.fillText('绿幕视频区', b.x + b.w / 2, b.y + b.h / 2 - 8);
        font(ctx, 8.5, '400');
        ctx.fillStyle = 'rgba(255,255,255,.82)';
        ctx.fillText('点击上传 · 自动裁掉开头准备', b.x + b.w / 2, b.y + b.h / 2 + 10);
        font(ctx, 8, '400');
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillText('16 : 9 · Chroma Green', b.x + b.w / 2, b.y + b.h / 2 + 26);
        ctx.textAlign = 'left';
      }
    }
    /* 底部状态条 */
    if (v.ready && !this.recording) {
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.fillRect(b.x, b.y + b.h - 20, b.w, 20);
      font(ctx, 8, '500');
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      let label = v.analyzing ? '分析视频开头…' : `${v.name} · 裁头 ${v.lead.toFixed(2)}s`;
      while (label.length > 6 && ctx.measureText(label).width > b.w - 16) label = label.slice(0, -2);
      ctx.fillText(label, b.x + 8, b.y + b.h - 6);
    }
    ctx.restore();
    if (!this.recording) {
      ctx.strokeStyle = v.ready ? 'rgba(34,32,28,.32)' : 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1.2;
      rr(ctx, b.x, b.y, b.w, b.h, rad);
      ctx.stroke();
    }
  }

  _drawFooter(ctx) {
    font(ctx, 8.5, '400');
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.fillText(`${this.score.parts.length} 声部 · ${this.score.measures.length} 小节 · ${fmtTime(this.score.totalSeconds)} · 原生 Verovio 总谱`, 24, 972);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.faint;
    ctx.fillText('固定阅读线 35% · 连续横向流动', 1896, 972);
    ctx.textAlign = 'left';
  }

  _drawEmpty(ctx) {
    const p = LAYOUT.score;
    ctx.fillStyle = C.paper;
    rr(ctx, p.x, p.y, p.w, p.h, 10); ctx.fill();
    ctx.strokeStyle = C.line; ctx.stroke();
    serif(ctx, 16, '400');
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'center';
    ctx.fillText(this.state.statusText || '载入总谱…', p.x + p.w / 2, p.y + p.h / 2);
    ctx.textAlign = 'left';
  }
}

