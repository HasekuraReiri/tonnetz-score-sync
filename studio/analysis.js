/* ==========================================================================
   analysis.js — 移调乐器调性检查、全曲调性/调式分析、和弦分段
   思路：
   - 调性以谱面调号为锚，音高检测只在证据明显时改写；
   - 移调检查用“与全曲调式的音级契合度”判断实音/移调，而不是依赖很短声部的调性识别；
   - 和声以小节 / 半小节为单位，弱化旋律声部与短经过音。
   ========================================================================== */

import {
  MODE_DEFS, MODE_BY_ID, FIFTHS_POS, analyzeChord, harmonicFunction,
  makeKey, mod12, pcSet, nameOf,
} from '../assets/js/core.js';
import { fifthsShift, keyFromFifths, keyNameFromFifths, fifthsSign } from './musicxml.js';

/* ------------------------------------------------------------ key profiles */

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const DEGREE_WEIGHTS = [1.00, 0.30, 0.55, 0.35, 0.78, 0.46, 0.30];
const MODE_PRIOR = {
  major: 0.10, minor: 0.08, harmonicMinor: 0.02, melodicMinor: 0.0,
  harmonicMajor: -0.02, melodicMajor: -0.04,
  dorian: -0.03, phrygian: -0.04, lydian: -0.03, mixolydian: -0.03, locrian: -0.10,
};

function normalizeHist(hist) {
  const total = hist.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return { h: hist.map(() => 0), total: 0 };
  return { h: hist.map(v => Math.max(0, v) / total), total };
}
function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (!da || !db) return 0;
  return num / Math.sqrt(da * db);
}
function ksCorrelation(hist, tonic, profile) {
  const vals = [];
  for (let i = 0; i < 12; i++) vals.push(profile[mod12(i - tonic)]);
  return pearson(hist, vals);
}
function modeTemplateScore(hist, tonic, mode) {
  const scale = mode.intervals.map(i => mod12(tonic + i));
  let inside = 0, outside = 0;
  for (let pc = 0; pc < 12; pc++) {
    const h = hist[pc];
    const deg = scale.indexOf(pc);
    if (deg >= 0) inside += h * DEGREE_WEIGHTS[deg];
    else outside += h;
  }
  const tonicW = hist[tonic];
  const dominantW = hist[mod12(tonic + 7)];
  const thirdW = hist[mod12(tonic + (mode.group === 'minor' ? 3 : 4))];
  return inside + tonicW * 0.85 + dominantW * 0.30 + thirdW * 0.22 - outside * 1.15 + (MODE_PRIOR[mode.id] ?? 0);
}

export function detectKey(hist, opts = {}) {
  const { h } = normalizeHist(hist);
  const allowModes = opts.allowModes !== false;
  const candidates = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = ksCorrelation(h, tonic, MAJOR_PROFILE);
    const minor = ksCorrelation(h, tonic, MINOR_PROFILE);
    candidates.push({ tonic, modeId: 'major', score: major * 0.5 + modeTemplateScore(h, tonic, MODE_BY_ID.major) * 0.5 });
    candidates.push({ tonic, modeId: 'minor', score: minor * 0.5 + modeTemplateScore(h, tonic, MODE_BY_ID.minor) * 0.5 });
    if (allowModes) {
      for (const m of MODE_DEFS) {
        if (m.id === 'major' || m.id === 'minor') continue;
        candidates.push({ tonic, modeId: m.id, score: modeTemplateScore(h, tonic, m) });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  let best = candidates[0];
  let second = candidates[1];
  if (best && !['major', 'minor'].includes(best.modeId)) {
    const alt = candidates.find(c => c.tonic === best.tonic && (c.modeId === 'major' || c.modeId === 'minor'));
    if (alt && best.score - alt.score < 0.05) best = alt;
  }
  const margin = best && second ? Math.max(0, best.score - second.score) : 0;
  return {
    tonic: best.tonic, modeId: best.modeId, mode: MODE_BY_ID[best.modeId] || MODE_BY_ID.major,
    key: makeKey(best.tonic, best.modeId),
    confidence: Math.max(0.25, Math.min(0.99, 0.45 + margin * 5.0)),
    alternatives: candidates.slice(1, 5),
  };
}

export function keyId(key) { return `${mod12(key.tonic)}:${key.modeId}`; }
export function keyLabel(key) {
  if (!key) return '—';
  return `${nameOf(key.tonic, key.spell ? key.spell.pref : 'flat')} ${key.mode.short || key.mode.name}`;
}
export function keyFifthsOf(key) {
  let f = FIFTHS_POS[mod12(key.tonic)] ?? 0;
  if (f > 6) f -= 12;
  if (key.mode && key.mode.group === 'minor') f -= 3;
  while (f > 7) f -= 12;
  while (f < -7) f += 12;
  return f;
}
export function scaleFit(hist, key) {
  if (!key) return 0;
  let inScale = 0, total = 0;
  for (let pc = 0; pc < 12; pc++) {
    const w = Math.max(0, hist[pc]);
    total += w;
    if (key.pcs.includes(pc)) inScale += w;
  }
  return total ? inScale / total : 0;
}
export function keyDist(a, b) {
  if (!a || !b) return 12;
  let d = Math.abs((FIFTHS_POS[mod12(a.tonic)] ?? 0) - (FIFTHS_POS[mod12(b.tonic)] ?? 0));
  d = Math.min(d, 12 - d);
  const ga = a.mode ? a.mode.group : (a.modeId === 'minor' ? 'minor' : 'major');
  const gb = b.mode ? b.mode.group : (b.modeId === 'minor' ? 'minor' : 'major');
  if (Math.abs(d - 3) < 0.01 && ga !== gb) d = 0.6;
  if (ga !== gb) d += 1.6;
  if (a.modeId && b.modeId && a.modeId !== b.modeId) d += 0.35;
  return d;
}

/** 只用 24 个大小调做“最像的调”，适合逐声部展示 */
export function bestFitKey(hist, opts = {}) {
  const { h, total } = normalizeHist(hist);
  if (!total) return { key: makeKey(0, 'major'), fit: 0 };
  const modes = opts.mode ? [opts.mode] : ['major', 'minor'];
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of modes) {
      const key = makeKey(tonic, mode);
      const fit = scaleFit(h, key);
      const tonicW = h[tonic];
      const thirdW = h[mod12(tonic + (mode === 'minor' ? 3 : 4))];
      const fifthW = h[mod12(tonic + 7)];
      const score = fit + tonicW * 0.16 + thirdW * 0.05 + fifthW * 0.05;
      if (!best || score > best.score) best = { key, fit, score };
    }
  }
  return best;
}

/* ------------------------------------------------------------- histograms */

export function pitchHistogram(parts, mode = 'sounding') {
  const hist = new Array(12).fill(0);
  let total = 0;
  for (const p of parts) {
    for (const e of p.events) {
      const midi = mode === 'written' ? e.writtenMidi : e.midi;
      const w = Math.max(0.08, Math.min(8, e.durBeats));
      hist[mod12(midi)] += w;
      total += w;
    }
  }
  return { hist, total };
}
function histInRange(parts, startBeat, endBeat, mode = 'sounding') {
  const hist = new Array(12).fill(0);
  let total = 0;
  for (const p of parts) {
    for (const e of p.events) {
      const s = Math.max(e.startBeat, startBeat);
      const en = Math.min(e.startBeat + e.durBeats, endBeat);
      if (en <= s) continue;
      const midi = mode === 'written' ? e.writtenMidi : e.midi;
      const w = en - s;
      hist[mod12(midi)] += w;
      total += w;
    }
  }
  return { hist, total };
}

/* --------------------------------------------------------- melody & keys */

export function guessMelodyPart(parts) {
  if (!parts || !parts.length) return null;
  let best = null;
  for (const p of parts) {
    if (!p.events.length) continue;
    let dur = 0, sum = 0;
    for (const e of p.events) { dur += e.durBeats; sum += e.midi * e.durBeats; }
    if (!dur) continue;
    const avg = sum / dur;
    const name = `${p.name} ${p.instrument}`.toLowerCase();
    let bonus = 0;
    if (/violin|flute|oboe|voice|vocal|soprano|melody|lead|piccolo|recorder/.test(name)) bonus = 7;
    else if (/trumpet|clarinet|sax|horn/.test(name)) bonus = 3;
    else if (/cello|bass|tuba|contrabass|timpani|percussion|drum/.test(name)) bonus = -6;
    const sc = avg + bonus;
    if (!best || sc > best.sc) best = { p, sc };
  }
  return best ? best.p : parts[0];
}

function effectiveTranspose(part) {
  const t = part.transpose || {};
  if (t.source === 'attributes' || t.source === 'midi') {
    return { chromatic: (t.chromatic || 0) + 12 * (t.octaveChange || 0), declared: true, source: t.source };
  }
  return { chromatic: 0, declared: false, source: 'none' };
}
function normFifths(f) {
  while (f > 7) f -= 12;
  while (f < -7) f += 12;
  return f;
}
function keyName(fifths, mode = 'major') {
  return keyNameFromFifths(normFifths(fifths), mode === 'minor' ? 'minor' : 'major');
}

/* ------------------------------------------------------ key evidence */

/**
 * 古典调性判断的核心证据：
 * 1) 调号只确定「主音候选」（关系大小调共用一个调号），不能直接当成调式；
 * 2) 低音与强拍权重高于内声部/经过音；
 * 3) 开头与结尾的和弦（尤其低音与三音）决定主音与调式；
 * 4) 小调的导音（主音上方 11 半音）与属和弦是强证据；
 * 5) 全曲音级分布只作为辅助，不用 Krumhansl 轮廓单独拍板。
 */
function keyEvidence(score, startBeat = null, endBeat = null) {
  const hist = new Array(12).fill(0);
  const bassHist = new Array(12).fill(0);
  let total = 0, bassTotal = 0;
  const firstBeat = score.measures.length ? score.measures[0].startBeat : 0;
  const last = score.measures.length ? score.measures[score.measures.length - 1] : null;
  const lastEnd = last ? last.startBeat + last.beats : 0;
  const lo = startBeat == null ? firstBeat : startBeat;
  const hi = endBeat == null ? lastEnd : endBeat;
  /* 先求每个起音点的最低音，避免逐事件扫描其他声部 */
  const onsetMin = new Map();
  for (const p of score.parts) for (const e of p.events) {
    const k = Math.round(e.startBeat * 16) / 16;
    const cur = onsetMin.get(k);
    if (cur == null || e.midi < cur) onsetMin.set(k, e.midi);
  }
  for (const p of score.parts) {
    for (const e of p.events) {
      if (e.startBeat + e.durBeats <= lo || e.startBeat >= hi) continue;
      const s = Math.max(e.startBeat, lo);
      const en = Math.min(e.startBeat + e.durBeats, hi);
      const overlap = Math.max(0, en - s);
      if (overlap <= 0.02) continue;
      let w = Math.min(4, overlap);
      const m = score.measures[e.measureIndex] || null;
      const inBar = m ? e.startBeat - m.startBeat : e.startBeat;
      if (Math.abs(inBar - Math.round(inBar)) < 0.03) w *= 1.18;
      if (Math.abs(inBar) < 0.03) w *= 1.28;
      hist[mod12(e.midi)] += w;
      total += w;
      const k = Math.round(e.startBeat * 16) / 16;
      if (Math.abs((onsetMin.get(k) ?? e.midi) - e.midi) < 0.01) {
        bassHist[mod12(e.midi)] += w * 1.7;
        bassTotal += w * 1.7;
      }
    }
  }
  return { hist, total, bassHist, bassTotal };
}

function sonorityPcs(score, beat, window = 0.55) {
  const pcs = new Set();
  for (const p of score.parts) {
    for (const e of p.events) {
      if (e.startBeat < beat + window && e.startBeat + e.durBeats > beat + 0.03) pcs.add(mod12(e.midi));
    }
  }
  return [...pcs];
}

function modeScore(key, ev, opening, closing) {
  if (!ev.total) return 0;
  const norm = (h, pc) => (h[pc] || 0) / Math.max(1e-9, h.reduce((a, b) => a + b, 0));
  const tonic = key.tonic;
  const isMinor = key.mode && key.mode.group === 'minor';
  const third = mod12(tonic + (isMinor ? 3 : 4));
  const otherThird = mod12(tonic + (isMinor ? 4 : 3));
  const fifth = mod12(tonic + 7);
  const leading = mod12(tonic + 11);
  const scale = new Set(key.pcs);
  let outside = 0;
  for (let pc = 0; pc < 12; pc++) if (!scale.has(pc)) outside += norm(ev.hist, pc);
  const tonicW = norm(ev.hist, tonic);
  const thirdW = norm(ev.hist, third);
  const fifthW = norm(ev.hist, fifth);
  const leadW = norm(ev.hist, leading);
  const thirdQuality = norm(ev.hist, third) - norm(ev.hist, otherThird);
  const bassTonic = ev.bassTotal ? (ev.bassHist[tonic] || 0) / ev.bassTotal : 0;
  const bassFifth = ev.bassTotal ? (ev.bassHist[fifth] || 0) / ev.bassTotal : 0;
  const bassThird = ev.bassTotal ? (ev.bassHist[third] || 0) / ev.bassTotal : 0;
  let score = tonicW * 2.6 + thirdW * 1.15 + fifthW * 0.9 + leadW * 0.75
    + thirdQuality * 2.4 + bassTonic * 2.2 + bassFifth * 0.8 + bassThird * 0.7
    - outside * 1.35;
  /* 开头/结尾三和弦的三音性质 */
  const openHasMinorThird = opening.includes(mod12(tonic + 3)) && !opening.includes(mod12(tonic + 4));
  const openHasMajorThird = opening.includes(mod12(tonic + 4)) && !opening.includes(mod12(tonic + 3));
  if (isMinor && openHasMinorThird) score += 0.55;
  if (!isMinor && openHasMajorThird) score += 0.55;
  if (isMinor && openHasMajorThird) score -= 0.45;
  if (!isMinor && openHasMinorThird) score -= 0.45;
  const closeHasMinorThird = closing.includes(mod12(tonic + 3)) && !closing.includes(mod12(tonic + 4));
  const closeHasMajorThird = closing.includes(mod12(tonic + 4)) && !closing.includes(mod12(tonic + 3));
  if (isMinor && closeHasMinorThird) score += 0.35;
  if (!isMinor && closeHasMajorThird) score += 0.35;
  return score;
}

/** 在给定调号下，用证据判断关系大调还是关系小调 */
export function inferModeForKey(score, fifths, declaredMode = '') {
  const major = makeKey(keyFromFifths(fifths, 'major').tonic, 'major');
  const minor = makeKey(keyFromFifths(fifths, 'minor').tonic, 'minor');
  const openingBeat = score.measures.length ? score.measures[0].startBeat : 0;
  const openEnd = score.measures.length ? score.measures[Math.min(7, score.measures.length - 1)].startBeat + score.measures[Math.min(7, score.measures.length - 1)].beats : 0;
  const closingBeat = score.measures.length ? score.measures[Math.max(0, score.measures.length - 2)].startBeat : 0;
  const opening = sonorityPcs(score, openingBeat);
  const closing = sonorityPcs(score, closingBeat);
  const whole = keyEvidence(score);
  const openEv = keyEvidence(score, openingBeat, openEnd);
  /* 开头 8 小节的证据与全曲证据各占一半；开头决定「这首曲子从什么调开始」 */
  const combined = {
    hist: whole.hist.map((v, i) => v + openEv.hist[i] * 1.15),
    total: whole.total + openEv.total * 1.15,
    bassHist: whole.bassHist.map((v, i) => v + openEv.bassHist[i] * 1.15),
    bassTotal: whole.bassTotal + openEv.bassTotal * 1.15,
  };
  let sm = modeScore(minor, combined, opening, closing);
  let sM = modeScore(major, combined, opening, closing);
  /* 古典作品的开头低音几乎总是主音（引子可能从属音开始，但持续低音会回到主音）；
     结尾低音同样支持主音。这个证据比音级轮廓更能区分关系大小调。 */
  const bassTop = (ev) => {
    let best = -1, val = -1;
    for (let pc = 0; pc < 12; pc++) if ((ev.bassHist[pc] || 0) > val) { val = ev.bassHist[pc] || 0; best = pc; }
    return best;
  };
  const openBass = bassTop(openEv);
  const closeBass = closing.length ? bassTop(keyEvidence(score, closingBeat, closingBeat + 4)) : -1;
  if (openBass === minor.tonic) sm += 1.45;
  if (openBass === major.tonic) sM += 1.45;
  if (closeBass === minor.tonic) sm += 0.55;
  if (closeBass === major.tonic) sM += 0.55;
  let mode = sm > sM + 0.1 ? 'minor' : sM > sm + 0.1 ? 'major' : (declaredMode === 'minor' ? 'minor' : 'major');
  /* 谱面明确写 minor 时，除非大调证据压倒性更强，否则尊重原谱 */
  if (declaredMode === 'minor' && sM < sm + 0.35) mode = 'minor';
  if (declaredMode === 'major' && sm > sM + 0.12) mode = 'minor';
  return {
    mode,
    minorScore: Number(sm.toFixed(4)),
    majorScore: Number(sM.toFixed(4)),
    opening, closing,
  };
}

/** 从各声部调号投票得到全曲（实音）调性；调式由证据判断，而不是只看 <mode> */
export function keyFromScoreSignatures(score) {
  const votes = new Map();
  const nonTransposing = score.parts.filter(p => effectiveTranspose(p).chromatic === 0);
  const voters = nonTransposing.length ? nonTransposing : score.parts;
  let declaredMinor = false;
  for (const p of voters) {
    const t = effectiveTranspose(p);
    const wf = p.writtenKey ? p.writtenKey.fifths : (score.keyFifths || 0);
    if (p.writtenKey && p.writtenKey.mode === 'minor') declaredMinor = true;
    const sf = normFifths(wf + (nonTransposing.length ? 0 : fifthsShift(t.chromatic)));
    const weight = Math.max(1, p.noteCount || 1);
    votes.set(sf, (votes.get(sf) || 0) + weight);
  }
  if (!votes.size) {
    const fifths = score.keyFifths || 0;
    const inf = inferModeForKey(score, fifths, score.keyMode || 'major');
    return makeKey(keyFromFifths(fifths, inf.mode).tonic, inf.mode);
  }
  const [fifths] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const inf = inferModeForKey(score, fifths, declaredMinor ? 'minor' : 'major');
  const k = keyFromFifths(fifths, inf.mode);
  const key = makeKey(k.tonic, inf.mode);
  key.evidence = inf;
  return key;
}

export function selectGlobalKey(score) {
  const notated = keyFromScoreSignatures(score);
  const all = pitchHistogram(score.parts, 'sounding');
  const fitN = scaleFit(all.hist, notated);
  const det = detectKey(all.hist);
  const fitD = scaleFit(all.hist, det.key);
  /* 谱面调号与音高一致时优先谱面，避免被属音/三音带偏 */
  if (fitD > fitN + 0.07) return { key: det.key, source: 'pitch', fit: fitD, notated, detected: det };
  const sameScale = notated.pcs.slice().sort((a, b) => a - b).join(',') === det.key.pcs.slice().sort((a, b) => a - b).join(',');
  const modalDetected = !['major', 'minor'].includes(det.key.modeId);
  if (sameScale && modalDetected) {
    const { h } = normalizeHist(all.hist);
    const wn = h[notated.tonic] || 0;
    const wd = h[det.key.tonic] || 0;
    if (wd > wn * 1.35 && wd > 0.06) return { key: det.key, source: 'pitch', fit: fitD, notated, detected: det };
  }
  return { key: notated, source: 'signature', fit: fitN, notated, detected: det };
}

/* -------------------------------------------------------- transposition */

export function checkTransposition(score) {
  const parts = score.parts;
  const allSound = pitchHistogram(parts, 'sounding');
  const globalSel = selectGlobalKey(score);
  const concert = globalSel.key;
  const concertFifths = keyFifthsOf(concert);
  const concertMode = concert.mode.short === '小调' ? 'minor' : 'major';
  const asNotatedDet = detectKey(allSound.hist);

  const rows = [];
  const issues = [];

  for (const part of parts) {
    const tr = effectiveTranspose(part);
    const inf = part.inferredTranspose;
    const T = tr.chromatic;
    const shift = fifthsShift(T);
    const writtenKey = part.writtenKey || { fifths: 0, mode: 'major' };
    const expectedFifths = normFifths(concertFifths - shift);
    const writtenHist = pitchHistogram([part], 'written');
    const soundHist = pitchHistogram([part], 'sounding');
    const nW = normalizeHist(writtenHist.hist);
    const nS = normalizeHist(soundHist.hist);
    const fitWConcert = scaleFit(nW.h, concert);
    const fitSConcert = scaleFit(nS.h, concert);
    const expectedWrittenKey = makeKey(keyFromFifths(expectedFifths, concertMode).tonic, concertMode);
    const fitWExpected = scaleFit(nW.h, expectedWrittenKey);
    const writtenBest = bestFitKey(writtenHist.hist);
    const soundBest = bestFitKey(soundHist.hist, { mode: writtenKey.mode === 'minor' ? 'minor' : 'major' });
    const reliable = writtenHist.total >= 4 && part.noteCount >= 4;

    let pitchMode = 'n/a';
    if (T !== 0) {
      if (!reliable) pitchMode = 'ambiguous';
      else if (fitSConcert >= 0.76 && fitSConcert >= fitWConcert + 0.03) pitchMode = 'transposed';
      else if (fitWConcert >= 0.8 && fitWConcert >= fitSConcert + 0.06 && fitWExpected < fitWConcert) pitchMode = 'concert';
      else if (fitWExpected >= 0.85 && fitSConcert >= 0.7) pitchMode = 'transposed';
      else pitchMode = 'ambiguous';
    }
    const keySigBad = T !== 0 && normFifths(writtenKey.fifths) !== expectedFifths;
    let status = 'ok';
    let issue = null;

    if (T === 0 && inf && Math.abs(inf.chromatic) >= 2 && part.transpose.source === 'none') {
      status = 'warn';
      issue = {
        partId: part.id, partName: part.name, type: 'missing', severity: 'warning',
        title: '疑似未标注移调',
        detail: `声部名称/音色显示为「${inf.label}」，但谱面没有移调标记，调号按实音记谱。若原谱确为移调乐器，需要补充移调设置。`,
        before: keyName(writtenKey.fifths, writtenKey.mode), after: keyName(expectedFifths, concertMode),
        fix: '仅提示，不自动改谱',
      };
    } else if (T !== 0 && pitchMode === 'concert') {
      const actualWritten = keyFromFifths(writtenKey.fifths, writtenKey.mode);
      const targetWritten = keyFromFifths(expectedFifths, concertMode);
      let delta = mod12(targetWritten.tonic - actualWritten.tonic);
      if (delta > 6) delta -= 12;
      if (!delta) delta = 2;
      status = 'error';
      issue = {
        partId: part.id, partName: part.name, type: 'pitch', severity: 'error',
        title: '移调未作用于音高',
        detail: `该声部按实音记谱（${keyLabel(writtenBest.key)}），但乐器移调 ${T > 0 ? '+' : ''}${T} 半音，实际发声为 ${keyLabel(soundBest.key)}，与全曲 ${keyLabel(concert)} 不符。`,
        before: keyLabel(soundBest.key), after: keyLabel(concert),
        fix: `整体移 ${delta > 0 ? '+' : ''}${delta} 半音，并把调号改为 ${fifthsSign(expectedFifths)}（${keyName(expectedFifths, concertMode)}）`,
        delta, expectedFifths,
      };
    } else if (T !== 0 && keySigBad) {
      status = 'warn';
      issue = {
        partId: part.id, partName: part.name, type: 'keysig', severity: 'warning',
        title: '移调乐器调号未同步',
        detail: `声部移调 ${T > 0 ? '+' : ''}${T} 半音，记谱调号应为 ${fifthsSign(expectedFifths)}（${keyName(expectedFifths, concertMode)}），当前为 ${fifthsSign(writtenKey.fifths)}。音高本身${pitchMode === 'transposed' ? '与全曲一致' : '需要复核'}。`,
        before: fifthsSign(writtenKey.fifths), after: fifthsSign(expectedFifths),
        fix: `把该声部调号改为 ${fifthsSign(expectedFifths)}`,
        expectedFifths,
      };
    }

    if (issue) issues.push(issue);
    rows.push({
      id: part.id, name: part.name, instrument: part.instrument || '',
      transpose: T, declared: tr.declared, inferred: !tr.declared && inf ? inf.label : '',
      writtenFifths: normFifths(writtenKey.fifths),
      writtenKey: keyName(writtenKey.fifths, writtenKey.mode),
      soundingKey: T === 0 ? keyName(writtenKey.fifths, writtenKey.mode) : keyLabel(soundBest.key),
      detectedWritten: keyLabel(writtenBest.key),
      detectedSounding: keyLabel(soundBest.key),
      expectedFifths, expectedKey: keyName(expectedFifths, concertMode),
      status, pitchMode, noteCount: part.noteCount,
      fitWConcert: Number(fitWConcert.toFixed(2)),
      fitSConcert: Number(fitSConcert.toFixed(2)),
      detail: issue ? issue.detail : '调号与移调关系一致。',
    });
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warns = issues.filter(i => i.severity === 'warning').length;
  return {
    concert, concertFifths, concertName: keyLabel(concert),
    keySource: globalSel.source,
    beforeName: keyLabel(asNotatedDet.key),
    before: asNotatedDet,
    afterName: keyLabel(concert),
    rows, issues, errors, warns,
    hasIssues: issues.length > 0,
    summary: issues.length
      ? `发现 ${errors} 处音高移调错误、${warns} 处调号/移调提示；已按 ${keyLabel(concert)} 校正。`
      : `未发现移调乐器调性错误；全曲按 ${keyLabel(concert)} 分析。`,
    transposingCount: parts.filter(p => effectiveTranspose(p).chromatic !== 0).length,
  };
}

export function applyTranspositionFixes(score, check) {
  const copy = {
    ...score,
    parts: score.parts.map(p => ({
      ...p,
      transpose: { ...p.transpose },
      writtenKey: { ...p.writtenKey },
      keyChanges: (p.keyChanges || []).map(k => ({ ...k })),
      events: p.events.map(e => ({ ...e })),
    })),
    measures: score.measures.map(m => ({ ...m })),
    tempos: (score.tempos || []).map(t => ({ ...t })),
    warnings: [...(score.warnings || [])],
  };
  const applied = [];
  for (const issue of check.issues) {
    if (issue.type !== 'pitch' && issue.type !== 'keysig') continue;
    const part = copy.parts.find(p => p.id === issue.partId);
    if (!part) continue;
    if (issue.type === 'pitch') {
      const delta = Math.round(issue.delta || 0);
      for (const e of part.events) {
        e.midi += delta;
        e.writtenMidi += delta;
      }
      part.soundingMin += delta; part.soundingMax += delta;
      part.writtenMin += delta; part.writtenMax += delta;
      part.writtenKey.fifths = issue.expectedFifths;
      if (part.keyChanges.length) part.keyChanges[0].fifths = issue.expectedFifths;
      part.fixApplied = `移调 ${delta > 0 ? '+' : ''}${delta} 半音`;
      applied.push(issue);
    } else if (issue.type === 'keysig') {
      part.writtenKey.fifths = issue.expectedFifths;
      if (part.keyChanges.length) part.keyChanges[0].fifths = issue.expectedFifths;
      part.fixApplied = `调号 → ${fifthsSign(issue.expectedFifths)}`;
      applied.push(issue);
    }
  }
  copy.transpositionFix = { issues: check.issues, applied, check };
  return copy;
}

/* ------------------------------------------------------------ key timeline */

function keyTimeline(score, globalKey) {
  const measures = score.measures;
  if (!measures.length) return [{ beat: 0, key: globalKey, measure: 0 }];
  const perMeasure = [];
  for (let i = 0; i < measures.length; i++) {
    const start = measures[i].startBeat;
    const end = start + Math.max(4, measures[i].beats * 2);
    const { hist, total } = histInRange(score.parts, start, end);
    if (total < 3) { perMeasure.push(globalKey); continue; }
    const fit = scaleFit(hist, globalKey);
    if (fit >= 0.78) { perMeasure.push(globalKey); continue; }
    const best = bestFitKey(hist);
    if (best.fit > fit + 0.1 && best.fit > 0.8) perMeasure.push(best.key);
    else perMeasure.push(globalKey);
  }
  /* 只在连续两个小节都指向新调时确认转调 */
  const timeline = [{ beat: 0, key: perMeasure[0] || globalKey, measure: 0 }];
  for (let i = 1; i < perMeasure.length; i++) {
    const k = perMeasure[i];
    const cur = timeline[timeline.length - 1].key;
    if (keyId(k) === keyId(cur)) continue;
    if (i + 1 < perMeasure.length && keyId(perMeasure[i + 1]) === keyId(k)) {
      timeline.push({ beat: measures[i].startBeat, key: k, measure: i });
    }
  }
  const out = [];
  for (const t of timeline) {
    if (out.length && keyId(out[out.length - 1].key) === keyId(t.key)) continue;
    out.push(t);
  }
  return out.length ? out : [{ beat: 0, key: globalKey, measure: 0 }];
}

function keyAtBeat(timeline, beat) {
  let lo = 0, hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeline[mid].beat <= beat + 1e-6) lo = mid; else hi = mid - 1;
  }
  return timeline[lo];
}

/* --------------------------------------------------------------- harmony */

function activeAt(events, t) {
  const pcs = new Set();
  let bass = 127, top = -1, count = 0;
  for (const e of events) {
    if (e.startBeat <= t + 1e-6 && e.startBeat + e.durBeats > t + 1e-6) {
      pcs.add(mod12(e.midi));
      if (e.midi < bass) bass = e.midi;
      if (e.midi > top) top = e.midi;
      count++;
    }
  }
  return { pcs: [...pcs].sort((a, b) => a - b), bass: bass < 127 ? bass : null, top: top >= 0 ? top : null, count };
}

/**
 * 在 [start,end) 内按重叠时长加权，弱化旋律与短经过音，得到和声骨架。
 * melodySet 只包含「旋律声部每个发声音高的最高音」，钢琴谱中左手低音
 * 仍按正常权重参与和声，避免整只手被当成旋律而削弱。
 */
/** 调内音级三和弦：在音阶上隔级叠置。 */
function diatonicTriad(key, idx) {
  const s = key && key.pcs;
  if (!s || s.length < 7) return null;
  return pcSet([s[idx % 7], s[(idx + 2) % 7], s[(idx + 4) % 7]]);
}

/**
 * 少于三个音时，用调内三和弦补全。
 * 古典作品里大量单音 / 双音片段其实是省略音的主、属或下属和弦；
 * 直接当成「音集」既不专业，也会把调性段落误判成无调性。
 */
function completeSonority(pcs, bassPc, key) {
  if (!key || pcs.length >= 3) return pcs;
  const cands = [];
  for (let i = 0; i < 7; i++) {
    const t = diatonicTriad(key, i);
    if (!t) continue;
    if (!pcs.every(pc => t.includes(pc))) continue;
    let score = pcs.length * 10 + (bassPc != null && t.includes(bassPc) ? 6 : 0) + (bassPc === t[0] ? 6 : 0);
    if (i === 0) score += 2.5;
    cands.push({ t, score });
  }
  if (cands.length) {
    cands.sort((a, b) => b.score - a.score);
    return cands[0].t;
  }
  if (bassPc != null) {
    const deg = key.pcs.indexOf(bassPc);
    if (deg >= 0) return diatonicTriad(key, deg);
  }
  return pcs;
}

function harmonyForRange(parts, melodySet, start, end, key) {
  const hist = new Array(12).fill(0);
  const bassCandidates = [];
  let total = 0;
  const melodyWeight = 0.72;
  for (const p of parts) {
    for (const e of p.events) {
      const s = Math.max(e.startBeat, start);
      const en = Math.min(e.startBeat + e.durBeats, end);
      if (en <= s + 1e-6) continue;
      const overlap = en - s;
      let w = Math.min(2.4, overlap) * (melodySet && melodySet.has(e) ? melodyWeight : 1);
      if (e.durBeats < 0.4) w *= 0.4;
      if (e.durBeats < 0.18) w *= 0.45;
      if (e.midi < 52) w *= 1.5;
      if (e.midi < 45) w *= 1.2;
      hist[mod12(e.midi)] += w;
      total += w;
      if (e.startBeat < start + 0.55) bassCandidates.push(e.midi);
    }
  }
  if (!total) return null;
  const maxW = Math.max(...hist);
  if (!(maxW > 0)) return null;
  const ranked = hist.map((w, pc) => ({ pc, w })).sort((a, b) => b.w - a.w);
  /* 只保留能达到主权重 30% 的音，最多五个：避免把经过音、辅助音
     堆成六音「音集」，也避免同时留下同根音的大三度与小三度。 */
  let keep = ranked.filter(x => x.w >= maxW * 0.3).slice(0, 5).map(x => x.pc);
  const bassMidi = bassCandidates.length ? Math.min(...bassCandidates) : null;
  const bassPc = bassMidi != null ? mod12(bassMidi) : null;
  if (bassPc != null && !keep.includes(bassPc) && keep.length < 5 && hist[bassPc] >= maxW * 0.12) keep.push(bassPc);
  let pcs = pcSet(keep);
  pcs = completeSonority(pcs, bassPc, key);
  if (!pcs.length) return null;
  let chord = analyzeChord(pcs, bassPc, key ? key.spell : 'flat');

  /* 五音以上的叠置多半是经过音堆积：先解决同名大小三度冲突，
     再去掉权重很低的调外经过音，避免 F♭9♯9 这类不专业的记号。 */
  const extras = chord && chord.template ? pcs.length - chord.template.intervals.length : 0;
  if (pcs.length >= 4 && (!chord.found || extras >= 2 || pcs.length >= 5)) {
    let trim = keep.slice();
    for (const root of keep) {
      const m3 = mod12(root + 3), M3 = mod12(root + 4);
      if (trim.includes(m3) && trim.includes(M3)) {
        const drop = hist[m3] >= hist[M3] ? M3 : m3;
        trim = trim.filter(pc => pc !== drop);
      }
    }
    if (key) {
      const weak = trim.filter(pc => !key.pcs.includes(pc) && hist[pc] < maxW * 0.45);
      const rest = trim.filter(pc => !weak.includes(pc));
      if (rest.length >= 2) trim = rest;
    }
    const pcs2 = pcSet(trim);
    if (pcs2.length >= 2 && pcs2.length < pcs.length) {
      const c2 = analyzeChord(pcs2, bassPc, key ? key.spell : 'flat');
      if (c2 && (c2.found || pcs2.length >= 3)) { pcs = pcs2; chord = c2; }
    }
  }
  const keptWeight = pcs.reduce((s, pc) => s + hist[pc], 0);

  /* 三音「音集」多半是骨架音 + 经过音：去掉最弱的一个，再按调内三和弦补全。 */
  if (chord && chord.quality === 'set' && pcs.length >= 3) {
    const weakest = pcs.slice().sort((a, b) => hist[a] - hist[b])[0];
    if (hist[weakest] < maxW * 0.55) {
      const rest = completeSonority(pcSet(pcs.filter(pc => pc !== weakest)), bassPc, key);
      const c2 = analyzeChord(rest, bassPc, key ? key.spell : 'flat');
      if (c2 && c2.found) { pcs = rest; chord = c2; }
    }
  }

  /* 古典和声简化：附加音 / 色彩音明显弱于和弦骨架时，还原成三和弦或七和弦，
     避免把经过音写成 add9♯11 这类现代流行记号。 */
  if (chord && chord.found && chord.template && pcs.length > 3) {
    const coreInts = chord.template.intervals.slice();
    const corePcs = coreInts.map(i => mod12(chord.root + i));
    if (corePcs.every(pc => pcs.includes(pc))) {
      const coreW = corePcs.reduce((s, pc) => s + hist[pc], 0);
      const extras = pcs.filter(pc => !corePcs.includes(pc));
      const extraW = extras.reduce((s, pc) => s + hist[pc], 0);
      const addInt = ['add9', 'add11', 'madd9', 'madd11', 'sixNine', 'm6nine'].includes(chord.quality)
        ? coreInts.find(i => i === 2 || i === 5 || i === 9) : null;
      const weakAdd = addInt != null && hist[mod12(chord.root + addInt)] < coreW * 0.5;
      if ((extras.length && extraW < coreW * 0.45) || weakAdd) {
        const reduced = weakAdd ? coreInts.filter(i => i !== addInt) : coreInts;
        const pcs2 = pcSet(reduced.map(i => mod12(chord.root + i)));
        const c2 = analyzeChord(pcs2, bassPc, key ? key.spell : 'flat');
        if (c2 && c2.found && pcs2.length >= 3) { pcs = pcs2; chord = c2; }
      }
    }
  }
  return {
    chord, pcs, bassMidi, bassPc, support: keptWeight / total,
    startBeat: start, endBeat: end,
  };
}

function isSubset(a, b) {
  const sb = new Set(b || []);
  return (a || []).every(x => sb.has(x));
}

function melodyEventSet(part) {
  const set = new Set();
  if (!part) return set;
  const byOnset = new Map();
  for (const e of part.events) {
    const k = Math.round(e.startBeat * 8) / 8;
    const cur = byOnset.get(k);
    if (!cur || e.midi > cur.midi) byOnset.set(k, e);
  }
  for (const e of byOnset.values()) set.add(e);
  return set;
}

function measureSegments(score, analysisKey, parts, melodySet) {
  const out = [];
  for (const m of score.measures) {
    const start = m.startBeat, end = m.startBeat + m.beats, mid = start + m.beats / 2;
    const key = analysisKey(start);
    const whole = harmonyForRange(parts, melodySet, start, end, key);
    if (!whole) {
      out.push({ startBeat: start, endBeat: end, chord: null, pcs: [], bassPc: null, support: 0 });
      continue;
    }
    let pieces = null;
    if (m.beats >= 2) {
      const h1 = harmonyForRange(parts, melodySet, start, mid, key);
      const h2 = harmonyForRange(parts, melodySet, mid, end, key);
      if (h1 && h2 && h1.chord && h2.chord) {
        const rootsDiffer = h1.chord.root !== h2.chord.root || h1.chord.quality !== h2.chord.quality;
        const subset = isSubset(h1.pcs, whole.pcs) || isSubset(h2.pcs, whole.pcs);
        if (rootsDiffer && !subset && (h1.support + h2.support) / 2 > whole.support + 0.04) {
          pieces = [
            { ...h1, startBeat: start, endBeat: mid },
            { ...h2, startBeat: mid, endBeat: end },
          ];
        }
      }
    }
    if (!pieces) pieces = [{ ...whole, startBeat: start, endBeat: end }];
    out.push(...pieces);
  }
  return out;
}

function attachHarmony(score, analysisKey, pieces) {
  const segments = [];
  for (const p of pieces) {
    const key = analysisKey(p.startBeat);
    const chord = p.chord;
    let fnKey = key;
    if (chord && key && key.mode && key.mode.group === 'minor') {
      const leading = mod12(key.tonic + 11);
      if (!key.pcs.includes(leading) && chord.pcs.includes(leading)) {
        /* 自然小调记谱中用导音构成的 V7 / vii°7，按和声小调理解功能 */
        fnKey = makeKey(key.tonic, 'harmonicMinor');
      }
    }
    const fn = chord ? harmonicFunction(chord, fnKey) : null;
    const keyPcs = fnKey ? fnKey.pcs : [];
    const chordPcs = (chord && chord.pcs) ? chord.pcs : (p.pcs || []);
    const inKey = chordPcs.length ? chordPcs.filter(pc => keyPcs.includes(pc)).length / chordPcs.length : 0;
    const functional = !!(fn && fn.group !== '?');
    /* 无调性只在“既无功能、又不是三度叠置、且调外音达到三个”时成立。
       古典作品里的那不勒斯、增六、副属等变化和弦仍有明确功能，
       不能因为音集对不上调式就判成无调性。 */
    const chromatic = chordPcs.filter(pc => !keyPcs.includes(pc)).length;
    const atonal = !functional && !!chord && chord.quality === 'set' && inKey < 0.5 && chromatic >= 3;
    /* 副导七和弦按目标调的导音拼写（C 小调里 vii°/V 应写作 F♯dim，而不是 G♭dim） */
    let symbol = chord ? chord.symbol : '—';
    if (chord && fn && /^vii[°ø]?\//.test(fn.roman)) {
      const sharp = analyzeChord(chord.pcs, p.bassPc, 'sharp');
      if (sharp) symbol = sharp.symbol;
    }
    segments.push({
      startBeat: p.startBeat, endBeat: p.endBeat, durBeats: p.endBeat - p.startBeat,
      startTime: score.beatToSeconds(p.startBeat), endTime: score.beatToSeconds(p.endBeat),
      pcs: p.pcs || [], bass: p.bassMidi, bassPc: p.bassPc,
      chord, fn, key, keyId: keyId(key),
      symbol,
      roman: fn ? fn.roman : '',
      func: fn ? fn.func : '',
      tag: fn ? fn.tag : '',
      desc: fn ? fn.desc : '休止 / 音型片段',
      support: p.support ? Number(p.support.toFixed(2)) : 0,
      inKey: Number(inKey.toFixed(2)),
      functional,
      atonal,
    });
  }
  const merged = [];
  for (const s of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.symbol === s.symbol && keyId(prev.key) === keyId(s.key) && Math.abs(prev.endBeat - s.startBeat) < 0.02) {
      prev.endBeat = s.endBeat; prev.endTime = s.endTime; prev.durBeats = prev.endBeat - prev.startBeat;
      continue;
    }
    merged.push(s);
  }
  const clean = [];
  for (const s of merged) {
    const prev = clean[clean.length - 1];
    if (prev && s.durBeats < 0.999 && s.symbol === '—') {
      prev.endBeat = s.endBeat; prev.endTime = s.endTime; prev.durBeats = prev.endBeat - prev.startBeat;
      continue;
    }
    clean.push(s);
  }
  return clean;
}

export function analyzeScore(score) {
  const sel = selectGlobalKey(score);
  const globalKey = sel.key;
  const timeline = keyTimeline(score, globalKey);
  const keyAt = beat => keyAtBeat(timeline, beat).key;
  const melodyPart = guessMelodyPart(score.parts);
  const melodySet = melodyEventSet(melodyPart);
  const parts = score.parts;
  const pieces = measureSegments(score, keyAt, parts, melodySet);
  const segments = attachHarmony(score, keyAt, pieces);

  const events = parts.flatMap(p => p.events);
  let maxPoly = 0;
  const step = 0.5;
  for (let t = 0; t <= score.totalBeats; t += step) {
    let c = 0;
    for (const e of events) if (e.startBeat <= t && e.startBeat + e.durBeats > t) c++;
    if (c > maxPoly) maxPoly = c;
  }

  const diatonic = segments.filter(s => s.tag === 'diatonic').length;
  const chromatic = segments.filter(s => s.tag && s.tag !== 'diatonic').length;
  const chordDur = {};
  for (const s of segments) {
    if (!s.chord || s.symbol === '—') continue;
    chordDur[s.symbol] = (chordDur[s.symbol] || 0) + s.durBeats;
  }
  const topChords = Object.entries(chordDur).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([symbol, beats]) => ({ symbol, beats: Number(beats.toFixed(1)) }));
  const totalNotes = parts.reduce((s, p) => s + p.noteCount, 0);
  const density = totalNotes / Math.max(1, score.totalBeats);
  const hint = (parts.length >= 5 || maxPoly >= 6) ? 'duo' : 'piano';
  const complexity = parts.length * 0.45 + maxPoly * 0.35 + density * 0.18;

  return {
    globalKey, globalDet: { ...sel.detected, confidence: sel.source === 'signature' ? 0.92 : sel.detected.confidence },
    keySource: sel.source,
    timeline,
    segments,
    melodyPart: melodyPart ? { id: melodyPart.id, name: melodyPart.name, instrument: melodyPart.instrument } : null,
    melodySet,
    stats: {
      parts: parts.length, totalNotes, maxPoly,
      density: Number(density.toFixed(2)),
      chordSegments: segments.length, diatonic, chromatic,
      diatonicRatio: segments.length ? Number((diatonic / segments.length).toFixed(2)) : 0,
      keyChanges: Math.max(0, timeline.length - 1),
      topChords, complexity: Number(complexity.toFixed(2)), hint,
      durationSec: score.totalSeconds,
    },
    summary: {
      key: keyLabel(globalKey), mode: globalKey.mode.name,
      keySignature: fifthsSign(keyFifthsOf(globalKey)),
      keyConfidence: sel.source === 'signature' ? 0.92 : sel.detected.confidence,
      chordCount: segments.filter(s => s.symbol !== '—').length,
      modulation: timeline.length > 1
        ? timeline.map(t => `${keyLabel(t.key)} @ 第 ${(score.measures[t.measure] || { number: '?' }).number} 小节`).join(' → ')
        : '全曲单一调性',
    },
  };
}

export function segmentAtBeat(analysis, beat) {
  const segs = analysis.segments;
  if (!segs.length) return null;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].startBeat <= beat + 1e-6) lo = mid; else hi = mid - 1;
  }
  return segs[lo];
}
export function keyAt(analysis, beat) { return keyAtBeat(analysis.timeline, beat).key; }
export function measureOfBeat(score, beat) {
  const ms = score.measures;
  if (!ms.length) return null;
  let lo = 0, hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ms[mid].startBeat <= beat + 1e-6) lo = mid; else hi = mid - 1;
  }
  return ms[lo];
}

