/* ==========================================================================
   nativescore.js — 原生 Verovio 总谱（score-sync-video 方案）
   排版、符头、符尾、连线、力度与谱号全部来自 Verovio 原生 SVG 的
   预先栅格化图块；页面只做平铺、裁切、阅读线与声部标签，不再用
   Canvas 重画任何音符。
   ========================================================================== */

const TILE_W = 3350;
const TILE_H = 1770;

export class NativeScore {
  constructor(opts = {}) {
    this.base = opts.base || 'score-data/sync7';
    this.ready = false;
    this.error = null;
    this.manifest = null;
    this.timing = null;
    this.staves = null;
    this.images = new Map();
    this.loading = new Set();
    this.onUpdate = null;
    this._pending = 0;
  }

  async load() {
    try {
      const [manifest, timing, staves] = await Promise.all([
        fetch(`${this.base}/tiles/manifest.json`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${this.base}/timing.json`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${this.base}/staves.json`, { cache: 'no-store' }).then(r => r.json()),
      ]);
      this.manifest = manifest;
      this.timing = timing;
      this.staves = staves;
      this.expectedBeats = timing.q.length ? timing.q[timing.q.length - 1] : 0;
      this.ready = true;
      this._preload(0);
      this._preload(1);
      if (this.onUpdate) this.onUpdate();
    } catch (e) {
      this.error = e;
      console.error('原生总谱载入失败', e);
    }
  }

  _tilePath(file) { return `${this.base}/tiles/${file}`; }

  _preload(i) {
    if (!this.manifest || i < 0 || i >= this.manifest.tiles.length) return;
    if (this.images.has(i) || this.loading.has(i)) return;
    this.loading.add(i);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.loading.delete(i);
      this.images.set(i, img);
      if (this.onUpdate) this.onUpdate();
    };
    img.onerror = () => {
      this.loading.delete(i);
      this.images.set(i, null);
    };
    img.src = this._tilePath(this.manifest.tiles[i].file);
  }

  xForBeat(beat) {
    const q = this.timing.q;
    const x = this.timing.x;
    if (!q.length) return 0;
    const b = Math.max(0, Number(beat) || 0);
    let lo = 0, hi = q.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (q[mid] <= b + 1e-9) lo = mid; else hi = mid - 1;
    }
    if (lo >= q.length - 1) return x[x.length - 1];
    const f = (b - q[lo]) / Math.max(1e-9, q[lo + 1] - q[lo]);
    return x[lo] + (x[lo + 1] - x[lo]) * Math.max(0, Math.min(1, f));
  }

  _tileIndexForX(scoreX) {
    const tiles = this.manifest.tiles;
    let lo = 0, hi = tiles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tiles[mid].x0 <= scoreX + 1) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  draw(ctx, rect, beat) {
    if (!this.ready) return false;
    const scoreX = this.xForBeat(beat);
    const idx = this._tileIndexForX(scoreX);
    this._preload(idx - 1);
    this._preload(idx);
    this._preload(idx + 1);

    const m = this.manifest;
    const pxPerUnit = rect.w / m.viewW;
    const lineX = rect.x + rect.w * 0.35;
    const labelW = Math.round(rect.w * 0.12);
    const scoreLeft = rect.x + labelW;

    ctx.save();
    ctx.beginPath();
    ctx.rect(scoreLeft, rect.y, rect.w - labelW, rect.h);
    ctx.clip();
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    const drawTile = (i) => {
      const img = this.images.get(i);
      if (!img) return;
      const t = m.tiles[i];
      const left = lineX - (scoreX - t.x0) * pxPerUnit;
      if (left > rect.x + rect.w || left + rect.w < rect.x) return;
      ctx.drawImage(img, left, rect.y, rect.w, rect.h);
    };
    drawTile(idx - 1);
    drawTile(idx);
    drawTile(idx + 1);
    ctx.restore();

    /* 左侧固定声部名栏：盖住滚入的谱面，保证标签永远清晰 */
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(rect.x, rect.y, labelW, rect.h);
    ctx.strokeStyle = 'rgba(32,35,39,.12)';
    ctx.beginPath();
    ctx.moveTo(scoreLeft - 0.5, rect.y);
    ctx.lineTo(scoreLeft - 0.5, rect.y + rect.h);
    ctx.stroke();

    /* 声部名固定在左侧，不随谱面滚动 */
    const labelRight = scoreLeft - 6;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.staves.length; i++) {
      const s = this.staves[i];
      const staffY = 400 + i * (720 + 500);
      const y = rect.y + ((staffY - m.viewY) / m.viewH) * rect.h;
      ctx.font = '500 9px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(34,32,28,.76)';
      let label = s.label || s.id;
      while (ctx.measureText(label).width > labelRight - rect.x - 8 && label.length > 4) label = label.slice(0, -2);
      ctx.fillText(label, labelRight, y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    /* 蓝色固定阅读线 */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(lineX, rect.y + 8);
    ctx.lineTo(lineX, rect.y + rect.h - 8);
    ctx.strokeStyle = 'rgba(40,125,159,.94)';
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lineX, rect.y + 7, 2.3, 0, Math.PI * 2);
    ctx.fillStyle = '#287D9F';
    ctx.fill();
    ctx.restore();

    return true;
  }
}
