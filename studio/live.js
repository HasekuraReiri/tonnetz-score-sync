/* ==========================================================================
   live.js — 超长曲目的实时演奏器
   不预渲染 AudioBuffer / MP3，而是按 1.2 秒前瞻把音符调度到 Web Audio。
   适用于十分钟以上的大型曲目：打开即可播放，拖动进度后从新位置继续。
   ========================================================================== */

export class LivePlayer {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;
    this.notes = [];
    this.duration = 0;
    this.startedAt = 0;
    this.cursor = 0;
    this.timer = null;
    this.active = new Set();
    this.playing = false;
    this.lastTime = 0;
    this._tick = this._tick.bind(this);
  }

  setData(arrangement, score) {
    this.stop();
    this.duration = arrangement.totalSeconds || score.totalSeconds || 0;
    this.notes = (arrangement.notes || [])
      .map(n => ({
        t: score.beatToSeconds(n.startBeat),
        dur: Math.max(0.05, score.beatToSeconds(n.startBeat + n.durBeats) - score.beatToSeconds(n.startBeat)),
        midi: n.midi,
        vel: Math.max(0.2, Math.min(1, n.velocity || 0.7)),
      }))
      .sort((a, b) => a.t - b.t);
    this._starts = this.notes.map(n => n.t);
  }

  _lowerBound(t) {
    let lo = 0, hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].t < t - 1e-6) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  start(from) {
    this.stop();
    if (!this.ctx || !this.notes.length) return false;
    const t0 = Math.max(0, Math.min(this.duration - 0.01, Number(from) || 0));
    this.startedAt = this.ctx.currentTime - t0;
    this.cursor = this._lowerBound(t0);
    this.playing = true;
    this.lastTime = t0;
    /* 从中间开始时，把仍在小节内持续的音补上 */
    for (let i = this.cursor - 1; i >= 0 && i > this.cursor - 80; i--) {
      const n = this.notes[i];
      if (n.t + n.dur <= t0 + 0.02) break;
      if (n.t < t0 && n.t + n.dur > t0 + 0.03) this._schedule(n, t0);
    }
    this._tick();
    this.timer = setInterval(this._tick, 120);
    return true;
  }

  _tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime - this.startedAt;
    this.lastTime = Math.max(0, Math.min(this.duration, now));
    const ahead = now + 1.25;
    while (this.cursor < this.notes.length && this.notes[this.cursor].t <= ahead) {
      const n = this.notes[this.cursor++];
      if (n.t + n.dur > now + 0.02) this._schedule(n, Math.max(now, n.t));
    }
    if (now >= this.duration) {
      this.lastTime = this.duration;
      this.stop();
    }
  }

  _schedule(note, fromTime) {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const noteEnd = note.t + note.dur;
    const remain = noteEnd - fromTime;
    if (remain < 0.035) return;
    const when = Math.max(now + 0.008, this.startedAt + fromTime);
    const dur = Math.max(0.05, noteEnd - Math.max(fromTime, this.ctx.currentTime - this.startedAt));
    const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const peak = Math.min(0.16, 0.05 + note.vel * 0.12);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.06, dur));
    osc.connect(gain);
    gain.connect(this.dest);
    osc.start(when);
    osc.stop(when + Math.max(0.06, dur) + 0.03);
    this.active.add(osc);
    osc.onended = () => {
      this.active.delete(osc);
      try { gain.disconnect(); } catch { }
    };
  }

  time() {
    if (!this.playing) return this.lastTime;
    return Math.max(0, Math.min(this.duration, this.ctx.currentTime - this.startedAt));
  }

  stop() {
    if (this.playing) {
      this.lastTime = Math.max(0, Math.min(this.duration, this.ctx.currentTime - this.startedAt));
    }
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const osc of this.active) {
      try { osc.stop(); } catch { }
    }
    this.active.clear();
  }

  dispose() {
    this.stop();
    this.notes = [];
  }
}
