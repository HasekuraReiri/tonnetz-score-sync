/* ==========================================================================
   app-light.js — 浅色总谱同步控制器
   MusicXML / MXL → 原谱总谱 + Tonnetz + 实时演奏 + 总谱视频
   不再有钢琴简化谱、移调报告、MP3 预渲染、和弦卡片等附加流程。
   ========================================================================== */

import { parseMusicXML } from './musicxml.js';
import { readMxl } from './zip.js';
import { analyzeScore } from './analysis.js';
import { LivePlayer } from './live.js';
import { FullStage, fmtTime } from './fullstage.js';

const $ = sel => document.querySelector(sel);
const app = {
  score: null, analysis: null, playback: null,
  stage: null, ctx: null, master: null, livePlayer: null,
  duration: 0, offset: 0, startedAt: 0, playing: false,
  busy: false, recording: null, userSeeking: false,
  volume: 0.8, filename: '',
};

function toast(msg, err = false, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, ms);
}

/* ------------------------------------------------------------- time map */

function installTimeMap(score) {
  const raw = (score.tempos || []).filter(t => Number.isFinite(t.bpm) && t.bpm > 0)
    .slice().sort((a, b) => a.beat - b.beat);
  const list = [];
  for (const t of raw) {
    const b = Math.max(0, t.beat);
    const last = list[list.length - 1];
    if (!last || b > last.beat + 1e-6) list.push({ beat: b, bpm: t.bpm });
    else last.bpm = t.bpm;
  }
  if (!list.length) list.push({ beat: 0, bpm: 120 });
  if (list[0].beat > 1e-6) list.unshift({ beat: 0, bpm: list[0].bpm });
  const beats = list.map(x => x.beat);
  const bpms = list.map(x => x.bpm);
  const secs = new Array(list.length).fill(0);
  for (let i = 1; i < list.length; i++) {
    secs[i] = secs[i - 1] + (beats[i] - beats[i - 1]) * 60 / bpms[i - 1];
  }
  const beatToSec = beat => {
    beat = Math.max(0, Number(beat) || 0);
    let lo = 0, hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid] <= beat + 1e-9) lo = mid; else hi = mid - 1;
    }
    return secs[lo] + (beat - beats[lo]) * 60 / bpms[lo];
  };
  const secToBeat = sec => {
    sec = Math.max(0, Number(sec) || 0);
    let lo = 0, hi = secs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (secs[mid] <= sec + 1e-9) lo = mid; else hi = mid - 1;
    }
    return beats[lo] + (sec - secs[lo]) * bpms[lo] / 60;
  };
  score.beatToSeconds = beatToSec;
  score.secondsToBeat = secToBeat;
  score.totalSeconds = Math.max(1, beatToSec(score.totalBeats) + 0.25);
  return { beatToSec, secToBeat };
}

/* ------------------------------------------------------------- playback */

function buildPlayback(score) {
  const notes = [];
  for (let pi = 0; pi < score.parts.length; pi++) {
    const part = score.parts[pi];
    const bass = /bass|contrabass|cello|timpani|bassoon/i.test(`${part.name} ${part.instrument}`);
    for (const e of part.events) {
      if (!Number.isFinite(e.midi) || e.durBeats < 0.04) continue;
      notes.push({
        startBeat: e.startBeat,
        durBeats: e.durBeats,
        midi: e.midi,
        velocity: bass ? 0.68 : 0.55,
      });
    }
  }
  notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  return { notes, totalSeconds: score.totalSeconds, totalBeats: score.totalBeats };
}

/* --------------------------------------------------------------- audio */

function ensureAudio() {
  if (app.ctx) return app.ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('当前浏览器不支持 Web Audio');
  app.ctx = new Ctx();
  app.master = app.ctx.createGain();
  app.master.gain.value = app.volume;
  app.master.connect(app.ctx.destination);
  return app.ctx;
}

function getTime() {
  if (app.playing && app.livePlayer) return Math.min(app.duration, Math.max(0, app.livePlayer.time()));
  return app.offset;
}

async function play() {
  if (!app.score) return;
  /* 已上传视频时，视频音轨就是主时钟：不再启动乐谱合成 */
  if (app.stage.video.ready) {
    const v = app.stage.video.el;
    v.muted = false;
    v.volume = app.volume;
    if (app.master) app.master.gain.value = 0;
    try { await v.play(); } catch { }
    app.playing = true;
    app.stage.setPlaying(true);
    setPlayIcon(true);
    stageHint();
    return;
  }
  if (!app.livePlayer) return;
  const ctx = ensureAudio();
  try { await ctx.resume(); } catch { }
  let from = app.offset;
  if (from >= app.duration - 0.02) from = 0;
  if (!app.livePlayer.start(from)) return;
  app.startedAt = ctx.currentTime - from;
  app.playing = true;
  app.stage.setPlaying(true);
  setPlayIcon(true);
  stageHint();
}

function pause() {
  if (!app.playing) return;
  if (app.stage.video.ready) {
    const v = app.stage.video.el;
    v.pause();
    app.offset = app.stage.scoreTimeFromVideo(v.currentTime);
  } else {
    app.offset = getTime();
    if (app.livePlayer) app.livePlayer.stop();
  }
  app.playing = false;
  app.stage.setPlaying(false);
  setPlayIcon(false);
  app.stage.updateTime(app.offset);
  updateTransport(app.offset);
}

function finishPlayback() {
  app.playing = false;
  if (app.stage.video.ready) app.stage.video.el.pause();
  app.offset = app.duration;
  if (app.livePlayer) app.livePlayer.stop();
  app.stage.setPlaying(false);
  setPlayIcon(false);
  app.stage.updateTime(app.duration);
  updateTransport(app.duration);
  if (app.recording) stopRecording(false);
}

function seek(sec) {
  if (!app.score) return;
  if (app.recording) { toast('录制中不能拖动进度'); return; }
  const t = Math.max(0, Math.min(app.duration, Number(sec) || 0));
  if (app.stage.video.ready) {
    const v = app.stage.video.el;
    const wasPlaying = app.playing;
    v.currentTime = Math.max(0, Math.min(v.duration || 1e9, app.stage.videoTimeFromScore(t)));
    app.offset = t;
    app.stage.updateTime(t);
    updateTransport(t);
    if (wasPlaying) v.play().catch(() => { });
    return;
  }
  if (app.playing) {
    app.playing = false;
    if (app.livePlayer.start(t)) {
      app.playing = true;
      setPlayIcon(true);
    }
  } else {
    app.offset = t;
    app.stage.updateTime(t);
    updateTransport(t);
  }
}

function setPlayIcon(on) {
  const b = $('#playBtn');
  b.classList.toggle('playing', on);
  b.querySelector('.play-icon').textContent = on ? '❚❚' : '▶';
  b.setAttribute('aria-label', on ? '暂停' : '播放');
}

function updateTransport(t) {
  const total = app.duration || 0;
  $('#curTime').textContent = fmtTime(t);
  $('#durTime').textContent = fmtTime(total);
  if (!app.userSeeking) $('#seek').value = total ? Math.round(Math.max(0, Math.min(1, t / total)) * 1000) : 0;
}

function stageHint() {
  const h = $('#stageHint');
  if (h) h.classList.add('hide');
}

/* ---------------------------------------------------------------- load */

async function processText(text, filename) {
  if (app.busy) return;
  app.busy = true;
  pause();
  if (app.stage.video.ready) {
    app.stage.clearVideo();
    if (app.master) app.master.gain.value = app.volume;
  }
  app.stage.setLoading('解析总谱…');
  setStatus('loading', '解析总谱…');
  $('#playBtn').disabled = true;
  $('#videoBtn').disabled = true;
  app.recording = null;
  app.offset = 0;
  app.playing = false;
  updateTransport(0);
  try {
    const score = parseMusicXML(text, filename);
    if (!score.title || /\.mxl$/i.test(score.title)) {
      score.title = filename.replace(/\.mxl$/i, '').replace(/\.(musicxml|xml)$/i, '');
    }
    app.score = score;
    app.filename = filename;
    installTimeMap(score);
    setStatus('loading', '分析调性与和声…');
    await new Promise(r => setTimeout(r, 20));
    const analysis = analyzeScore(score);
    app.analysis = analysis;
    app.duration = score.totalSeconds;
    const playback = buildPlayback(score);
    app.playback = playback;
    const ctx = ensureAudio();
    if (app.livePlayer) app.livePlayer.dispose();
    app.livePlayer = new LivePlayer(ctx, app.master);
    app.livePlayer.setData(playback, score);
    app.stage.setData({ score, analysis, filename });
    $('#fileName').textContent = score.title || filename;
    $('#fileMeta').textContent = `${score.parts.length} 声部 · ${score.measures.length} 小节 · ${fmtTime(app.duration)} · 固定阅读线总谱`;
    $('#playBtn').disabled = false;
    $('#videoBtn').disabled = false;
    $('#shotBtn').disabled = false;
    updateTransport(0);
    setStatus('ready', '就绪');
    stageHint();
    toast('总谱已载入：' + (score.title || filename));
  } catch (e) {
    console.error(e);
    app.stage.setError(e.message || String(e));
    setStatus('error', '失败');
    toast(e.message || String(e), true, 6000);
  } finally {
    app.busy = false;
  }
}

async function loadFile(file) {
  if (!file) return;
  if (isVideoFile(file)) { uploadVideo(file); return; }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'mxl') {
      app.stage.setLoading('解压 MXL…');
      const mxl = await readMxl(await file.arrayBuffer());
      await processText(mxl.text, file.name);
    } else if (ext === 'xml' || ext === 'musicxml') {
      await processText(await file.text(), file.name);
    } else {
      toast('请选择 .mxl / .musicxml / .xml 总谱，或视频文件', true);
    }
  } catch (e) {
    app.stage.setError(e.message || String(e));
    toast(e.message || String(e), true, 5000);
  }
}

function isVideoFile(file) {
  if (!file) return false;
  return /^video\//i.test(file.type || '') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name || '');
}

async function uploadVideo(file) {
  if (!file) return;
  if (app.playing) {
    app.playing = false;
    app.stage.setPlaying(false);
    if (app.livePlayer) app.livePlayer.stop();
    setPlayIcon(false);
  }
  toast('正在分析视频开头，自动对齐…');
  try {
    const info = await app.stage.setVideoFile(file);
    const v = app.stage.video;
    v.el.muted = false;
    v.el.volume = app.volume;
    /* 视频自带音轨时，乐谱合成静音，避免两套音频叠在一起 */
    if (app.master) app.master.gain.value = 0;
    if (info.reason === 'ok') toast(`视频已对齐：裁掉开头 ${info.lead.toFixed(2)} 秒`);
    else toast('视频已载入，但没检测到明确开头；按 0 秒对齐', true);
    seek(0);
  } catch (e) {
    toast(e.message || '视频载入失败', true);
  }
}

async function loadDemo() {
  try {
    setStatus('loading', '载入测试总谱…');
    app.stage.setLoading('载入 sync (7)…');
    const url = 'samples/' + encodeURIComponent('sync (7).mxl');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`示例不可用（${res.status}）`);
    const mxl = await readMxl(await res.arrayBuffer());
    await processText(mxl.text, 'sync (7).mxl');
  } catch (e) {
    app.stage.setError(e.message || String(e));
    setStatus('error', '失败');
    toast(e.message || String(e), true, 6000);
  }
}

/* --------------------------------------------------------------- video */

function chooseMime() {
  const list = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of list) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

function safeName(s) {
  return String(s || 'sync').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 60);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function startRecording() {
  if (!app.score || app.busy) return;
  if (app.recording) return;
  if (!app.stage.canvas.captureStream || !window.MediaRecorder) {
    toast('当前浏览器不支持画布录制，请使用最新版 Edge/Chrome', true);
    return;
  }
  const secSel = Number($('#videoLen').value) || 60;
  const seconds = Math.min(app.duration, Math.max(5, secSel));
  if (seconds > 180) {
    if (!confirm(`将按实时速度录制 ${fmtTime(seconds)} 的 4K 视频，文件可能很大。继续？`)) return;
  }
  pause();
  app.offset = 0;
  app.stage.updateTime(0);
  const ctx = ensureAudio();
  try { await ctx.resume(); } catch { }
  const stream = app.stage.canvas.captureStream(30);
  const dest = ctx.createMediaStreamDestination();
  app.master.connect(dest);
  const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  let rec;
  try {
    rec = new MediaRecorder(mixed, {
      mimeType: chooseMime() || undefined,
      videoBitsPerSecond: 16_000_000,
      audioBitsPerSecond: 160_000,
    });
  } catch (e) {
    try { app.master.disconnect(dest); } catch { }
    toast('无法启动录制：' + e.message, true);
    return;
  }
  const chunks = [];
  const state = { rec, chunks, dest, seconds, cancelled: false, startAt: performance.now() };
  app.recording = state;
  app.stage.setRecording(true);
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  rec.onstop = () => {
    try { app.master.disconnect(dest); } catch { }
    app.recording = null;
    app.playing = false;
    app.stage.setPlaying(false);
    app.stage.setRecording(false);
    if (app.livePlayer) app.livePlayer.stop();
    $('#recordOverlay').hidden = true;
    $('#videoBtn').disabled = false;
    $('#playBtn').disabled = false;
    setPlayIcon(false);
    if (!state.cancelled && chunks.length) {
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      const ext = /mp4/i.test(rec.mimeType || '') ? 'mp4' : 'webm';
      const h = app.stage.canvas.height;
      const tag = h >= 2160 ? '4K' : h >= 1440 ? '2.5K' : '1080P';
      const name = `${safeName(app.score.title || 'sync-7')}-总谱同步-${tag}-${Math.round(seconds)}s.${ext}`;
      app.lastVideo = { blob, name };
      window.__sync.lastVideo = app.lastVideo;
      $('#saveVideoBtn').hidden = false;
      downloadBlob(blob, name);
      setStatus('ready', '视频已导出');
      toast(`视频已导出 · ${(blob.size / 1048576).toFixed(1)} MB · ${fmtTime(seconds)}`, false, 6000);
    } else if (state.cancelled) {
      toast('已取消录制');
      app.stage.updateTime(0);
      updateTransport(0);
      setStatus('ready', '就绪');
    }
  };
  rec.start(250);
  $('#recordOverlay').hidden = false;
  $('#cancelRecord').disabled = false;
  $('#recordLabel').textContent = `录制中 · 0:00 / ${fmtTime(seconds)}`;
  const spec = $('#recordSpec');
  if (spec) spec.textContent = `录制期间请保持本页在前台 · ${app.stage.canvas.width}×${app.stage.canvas.height} / 30fps`;
  $('#recordFill').style.width = '0%';
  setStatus('busy', '录制中');
  app.offset = 0;
  await play();
  const tick = () => {
    if (!app.recording) return;
    const t = getTime();
    const frac = seconds ? Math.min(1, t / seconds) : 1;
    $('#recordLabel').textContent = `录制中 · ${fmtTime(t)} / ${fmtTime(seconds)}`;
    $('#recordFill').style.width = `${frac * 100}%`;
    if (t >= seconds - 0.05) { stopRecording(false); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopRecording(cancel) {
  const rec = app.recording;
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  rec.cancelled = !!cancel;
  app.playing = false;
  app.stage.setPlaying(false);
  $('#videoBtn').disabled = true;
  $('#cancelRecord').disabled = true;
  if (app.livePlayer) app.livePlayer.stop();
  try { rec.rec.stop(); } catch { }
}

/* ---------------------------------------------------------------- UI */

function setStatus(kind, text) {
  const p = $('#statusPill');
  p.className = 'pill ' + (kind || '');
  p.textContent = text;
}

function openHelp() {
  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop" data-close="1">
      <div class="modal-card">
        <h2>总谱同步 · 使用说明</h2>
        <p>拖入 <b>.mxl / .musicxml / .xml</b> 总谱，或直接使用内置的 <b>sync (7)</b> 测试总谱。</p>
        <ol>
          <li>主体为原谱总谱：全部声部从上到下，谱面连续横向流动，蓝色阅读线固定在画面 35% 处。</li>
          <li>右侧 Tonnetz 默认只显示当前和弦多边形（默认关闭四部和声，可在顶部勾选）；和弦围成的区域加深填充。</li>
          <li>谱面下方一行显示当前和弦的前两个、当前、后两个，含功能级数、和弦组成音与时值。</li>
          <li>「上传视频」可载入本地演奏视频，自动检测有效开头、裁掉准备时间，画面放入右侧绿幕区并随谱同步。</li>
          <li>顶部可勾选「级数版本 0–11」，网格与音级圈上的音名会全部改为 0–11。</li>
          <li>播放为实时合成；导出视频默认 1920×1080，可在播放栏选择 2560×1440 或 3840×2160，含实时合成音频。</li>
        </ol>
        <p class="muted">快捷键：空格 播放/暂停 · ← → 前后 5 秒 · Esc 关闭</p>
        <div class="modal-actions"><button id="helpClose">知道了</button></div>
      </div>
    </div>`;
  $('#helpClose').onclick = () => { $('#modalRoot').innerHTML = ''; };
}

function bindUI() {
  $('#playBtn').addEventListener('click', () => {
    if (app.recording) return;
    app.playing ? pause() : play();
  });
  $('#restartBtn').addEventListener('click', () => seek(0));
  $('#seek').addEventListener('input', e => {
    app.userSeeking = true;
    const t = (Number(e.target.value) / 1000) * (app.duration || 0);
    $('#curTime').textContent = fmtTime(t);
    if (!app.playing) app.stage.updateTime(t);
  });
  $('#seek').addEventListener('change', e => {
    app.userSeeking = false;
    seek((Number(e.target.value) / 1000) * (app.duration || 0));
  });
  $('#volume').addEventListener('input', e => {
    app.volume = Number(e.target.value) / 100;
    const v = app.stage.video;
    if (v.ready && v.el) v.el.volume = app.volume;
    if (app.master) app.master.gain.value = v.ready ? 0 : app.volume;
  });
  const resSel = $('#resSel');
  if (resSel) {
    resSel.value = String(Math.round(app.stage.canvas.height));
    resSel.addEventListener('change', () => {
      const u = new URL(location.href);
      u.searchParams.set('res', resSel.value);
      location.href = u.toString();
    });
  }
  document.querySelectorAll('input[name="analysisMode"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) app.stage.setAnalysisMode(r.value); });
  });
  const namingToggle = $('#namingToggle');
  if (namingToggle) {
    namingToggle.addEventListener('change', () => {
      app.stage.setNaming(namingToggle.checked ? 'integer' : 'reference');
    });
  }
  const satbToggle = $('#satbToggle');
  if (satbToggle) {
    satbToggle.addEventListener('change', () => {
      app.stage.setSatb(satbToggle.checked);
    });
  }
  const circleFifths = $('#circleFifths');
  if (circleFifths) {
    circleFifths.addEventListener('change', () => app.stage.setCircle('fifths', circleFifths.checked));
  }
  const circleChromatic = $('#circleChromatic');
  if (circleChromatic) {
    circleChromatic.addEventListener('change', () => app.stage.setCircle('chromatic', circleChromatic.checked));
  }
  $('#videoBtn').addEventListener('click', startRecording);
  $('#saveVideoBtn').addEventListener('click', () => {
    if (!app.lastVideo) return;
    downloadBlob(app.lastVideo.blob, app.lastVideo.name);
  });
  $('#shotBtn').addEventListener('click', () => {
    if (!app.score) return;
    app.stage.canvas.toBlob(blob => {
      const h = app.stage.canvas.height;
      const tag = h >= 2160 ? '4K' : h >= 1440 ? '2.5K' : '1080P';
      if (blob) downloadBlob(blob, `${safeName(app.score.title || 'sync-7')}-总谱-${tag}.png`);
    }, 'image/png');
  });
  $('#fullBtn').addEventListener('click', () => {
    const el = $('#stageFrame');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('当前浏览器不允许全屏', true));
  });
  $('#openBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
    e.target.value = '';
  });
  $('#videoUploadBtn').addEventListener('click', () => $('#videoInput').click());
  $('#videoInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) uploadVideo(f);
    e.target.value = '';
  });
  $('#helpBtn').addEventListener('click', openHelp);
  $('#cancelRecord').addEventListener('click', () => stopRecording(true));
  $('#modalRoot').addEventListener('click', e => {
    if (e.target.dataset.close) $('#modalRoot').innerHTML = '';
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (app.recording) return;
      $('#modalRoot').innerHTML = '';
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || tag === 'a') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!app.recording) app.playing ? pause() : play();
    } else if (e.key === 'ArrowRight') {
      if (!app.recording) seek(getTime() + 5);
    } else if (e.key === 'ArrowLeft') {
      if (!app.recording) seek(getTime() - 5);
    } else if (e.key === '?') openHelp();
  });
}

/* ---------------------------------------------------------------- loop */

function loop() {
  if (app.playing) {
    let t;
    if (app.stage.video.ready) {
      t = app.stage.scoreTimeFromVideo(app.stage.video.el.currentTime);
      app.offset = t;
    } else {
      t = getTime();
    }
    app.stage.updateTime(t);
    updateTransport(t);
    if (t >= app.duration - 0.03 && !app.recording) finishPlayback();
  }
  requestAnimationFrame(loop);
}

function init() {
  const qs = new URLSearchParams(location.search);
  const outHeight = Math.max(1080, Math.min(2160, Number(qs.get('res')) || 1080));
  app.stage = new FullStage($('#stage'), {
    scale: outHeight / 1080,
    onGridZoom: z => { const el = $('#gridZoom'); if (el) el.textContent = `${Math.round(z * 100)}%`; },
  });
  /* 首次打开固定为音名版本；浏览器可能恢复上次的复选框状态，这里显式对齐 */
  const namingToggle = $('#namingToggle');
  const satbToggle = $('#satbToggle');
  const circleFifths = $('#circleFifths');
  const circleChromatic = $('#circleChromatic');
  if (namingToggle) namingToggle.checked = false;
  if (satbToggle) satbToggle.checked = false;
  if (circleFifths) circleFifths.checked = true;
  if (circleChromatic) circleChromatic.checked = false;
  app.stage.setNaming('reference');
  app.stage.setSatb(false);
  app.stage.setCircle('fifths', true);
  app.stage.setCircle('chromatic', false);
  app.stage.onVideoRequest = () => $('#videoInput').click();

  window.__sync = { app, stage: app.stage };
  bindUI();
  requestAnimationFrame(loop);
  loadDemo();
}

init();
