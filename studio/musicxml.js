/* ==========================================================================
   musicxml.js — MusicXML (score-partwise) 解析器
   输出统一的“总谱模型”：小节、速度、移调、音符事件（实音 / 记谱音高）
   ========================================================================== */

import { mod12, FIFTHS_PCS, pcName } from '../assets/js/core.js';

const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };

export const CLARINET = -2;

/* ------------------------------------------------------------ DOM utils */

function kids(node, tag) {
  if (!node) return [];
  const out = [];
  for (const c of node.children) if (!tag || c.localName === tag) out.push(c);
  return out;
}
function first(node, tag) {
  if (!node) return null;
  for (const c of node.children) if (c.localName === tag) return c;
  return null;
}
function txt(node, tag, def = '') {
  const c = first(node, tag);
  if (!c) return def;
  return (c.textContent || '').trim() || def;
}
function ival(node, tag, def = 0) {
  const v = parseFloat(txt(node, tag, ''));
  return Number.isFinite(v) ? v : def;
}
function fnum(node, tag, def = 0) {
  if (!node) return def;
  for (const c of node.children) if (c.localName === tag) {
    const v = parseFloat((c.textContent || '').trim());
    if (Number.isFinite(v)) return v;
  }
  return def;
}

/* -------------------------------------------------------- key utilities */

export function keyFromFifths(fifths, mode) {
  const f = Number.isFinite(fifths) ? fifths : 0;
  const majorTonic = FIFTHS_PCS[((f % 12) + 12) % 12];
  const m = String(mode || '').toLowerCase();
  const isMinor = m === 'minor' || m === 'aeolian';
  const tonic = isMinor ? mod12(majorTonic + 9) : majorTonic;
  return { fifths: f, mode: isMinor ? 'minor' : 'major', tonic };
}
export function keyNameFromFifths(fifths, mode) {
  const k = keyFromFifths(fifths, mode);
  const pref = fifths < 0 ? 'flat' : 'sharp';
  return `${pcName(k.tonic, pref)} ${k.mode === 'minor' ? '小调' : '大调'}`;
}
export function fifthsSign(fifths) {
  if (!fifths) return '0';
  return fifths > 0 ? `${fifths}♯` : `${-fifths}♭`;
}

export function transposeLabel(chromatic) {
  if (!chromatic) return '不移调';
  const dir = chromatic > 0 ? '↑' : '↓';
  return `${dir}${Math.abs(chromatic)} 半音`;
}

/* 把“移调半音数”换算成五度圈移动步数 */
export function fifthsShift(semitones) {
  let s = (Math.round(semitones) * 7) % 12;
  if (s > 6) s -= 12;
  if (s < -6) s += 12;
  return s;
}

/* ----------------------------------------------------- instrument heuristics */

export function inferTranspose(name = '', instrument = '') {
  const s = `${name} ${instrument}`.toLowerCase().replace(/\s+/g, ' ');
  const hasBb = /(bb|b♭|降b|b flat|in b\b)/.test(s);
  const hasEb = /(eb|e♭|降e|e flat|in e♭|in eb)/.test(s);
  const hasF = /(in f\b|f\b|f调|f 调)/.test(s);
  const hasA = /(in a\b|a调|a 调)/.test(s);

  if (/contrabass|double bass/.test(s)) return { chromatic: -12, label: '低八度', confidence: 0.4 };
  if (/piccolo/.test(s)) return { chromatic: 12, label: '高八度', confidence: 0.4 };
  if (/bass clarinet/.test(s) && hasBb) return { chromatic: -14, label: '降B 低音单簧管', confidence: 0.8 };
  if (/clarinet/.test(s) && hasA) return { chromatic: -3, label: 'A 调单簧管', confidence: 0.75 };
  if (/clarinet/.test(s) && hasBb) return { chromatic: -2, label: '降B 单簧管', confidence: 0.9 };
  if (/clarinet/.test(s)) return { chromatic: -2, label: '降B 单簧管（推测）', confidence: 0.45 };
  if (/trumpet|cornet|flugel/.test(s) && hasBb) return { chromatic: -2, label: '降B 小号', confidence: 0.85 };
  if (/trumpet/.test(s) && hasA) return { chromatic: -3, label: 'A 调小号', confidence: 0.7 };
  if (/horn|english horn/.test(s)) return { chromatic: -7, label: 'F 调圆号', confidence: hasF ? 0.8 : 0.55 };
  if (/tenor sax/.test(s)) return { chromatic: -14, label: '降B 次中音萨克斯', confidence: 0.85 };
  if (/baritone sax/.test(s)) return { chromatic: -21, label: '降E 上低音萨克斯', confidence: 0.85 };
  if (/alto sax/.test(s)) return { chromatic: -9, label: '降E 中音萨克斯', confidence: 0.85 };
  if (/soprano sax/.test(s)) return { chromatic: -2, label: '降B 高音萨克斯', confidence: 0.8 };
  if (/sax/.test(s) && hasEb) return { chromatic: -9, label: '降E 萨克斯', confidence: 0.6 };
  if (/in f\b/.test(s) && !/flute|oboe|violin/.test(s)) return { chromatic: -7, label: 'F 调乐器', confidence: 0.5 };
  if (/in eb\b|in e♭\b/.test(s)) return { chromatic: -9, label: '降E 乐器', confidence: 0.5 };
  if (/in bb\b|in b♭\b/.test(s)) return { chromatic: -2, label: '降B 乐器', confidence: 0.7 };
  return null;
}

/* -------------------------------------------------------------- parsing */

export function parseMusicXML(text, filename = '') {
  if (typeof DOMParser === 'undefined') throw new Error('当前环境不支持 DOMParser');
  const clean = String(text || '').replace(/^\uFEFF/, '');
  if (!clean.trim()) throw new Error('文件为空。');
  const doc = new DOMParser().parseFromString(clean, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror');
  if (perr && perr.length) {
    const raw = (perr[0].textContent || '').replace(/\s+/g, ' ').slice(0, 400);
    const m = raw.match(/error on line (\d+) at column (\d+):\s*(.*?)(?:Below is|$)/i);
    const where = m ? `（第 ${m[1]} 行，第 ${m[2]} 列）` : '';
    const reason = m ? m[3].trim() : raw.slice(0, 160);
    throw new Error(`XML 格式有误${where}：${reason || '不是有效的 XML 文件'}`);
  }
  const root = doc.documentElement;
  if (!root) throw new Error('XML 没有根节点。');
  if (root.localName === 'score-timewise') throw new Error('暂不支持 timewise 格式，请在制谱软件中导出 partwise MusicXML。');
  if (root.localName !== 'score-partwise') throw new Error('这不是 MusicXML 总谱（需要 <score-partwise>）。');

  const warnings = [];
  const partList = first(root, 'part-list');
  const meta = new Map();
  for (const sp of kids(partList, 'score-part')) {
    const id = sp.getAttribute('id');
    const name = txt(sp, 'part-name', '') || txt(sp, 'part-abbreviation', '') || id;
    const instr = txt(first(sp, 'score-instrument') || sp, 'instrument-name', '');
    let midiTr = null, midiOct = 0;
    const mi = first(sp, 'midi-instrument');
    if (mi) {
      const tr = first(mi, 'transpose');
      if (tr) {
        midiTr = fnum(tr, 'chromatic', 0);
        midiOct = fnum(tr, 'octave-change', 0);
      }
    }
    meta.set(id, { id, name, instrument: instr, midiTranspose: midiTr, midiOctave: midiOct });
  }

  const partNodes = kids(root, 'part');
  if (!partNodes.length) throw new Error('没有找到任何声部（<part>）。');

  /* 第一遍：主声部的小节长度 / 全局时间轴 */
  let masterNode = partNodes[0], masterMeasures = [];
  for (const pn of partNodes) {
    const ms = kids(pn, 'measure');
    if (ms.length > masterMeasures.length) { masterNode = pn; masterMeasures = ms; }
  }
  const lengths = measureLengths(masterNode);
  if (!lengths.length) throw new Error('乐谱中没有小节。');
  const globalMeasures = [];
  let acc = 0;
  lengths.forEach((ln, i) => {
    const num = masterMeasures[i] ? masterMeasures[i].getAttribute('number') || String(i + 1) : String(i + 1);
    globalMeasures.push({
      index: i, number: num, startBeat: acc, beats: ln.beats,
      timeSig: ln.timeSig, keyFifths: ln.keyFifths, keyMode: ln.keyMode,
    });
    acc += ln.beats;
  });
  const measureStarts = globalMeasures.map(m => m.startBeat);
  const totalBeats = acc;

  const tempoEvents = [];
  const parts = [];

  for (const pn of partNodes) {
    const id = pn.getAttribute('id') || `P${parts.length + 1}`;
    const pm = meta.get(id) || { name: id, instrument: '' };
    const part = {
      id, index: parts.length, name: pm.name, instrument: pm.instrument,
      transpose: { chromatic: pm.midiTranspose || 0, octaveChange: pm.midiOctave || 0, source: pm.midiTranspose != null ? 'midi' : 'none' },
      inferredTranspose: null,
      writtenKey: null, keyChanges: [],
      staves: 1, isPiano: false, hasRepeats: false,
      events: [], writtenMin: 127, writtenMax: 0, soundingMin: 127, soundingMax: 0,
    };
    const inf = inferTranspose(pm.name, pm.instrument);
    if (inf) part.inferredTranspose = inf;
    if (/piano|pianoforte|keyboard|harpsichord|大钢琴|钢琴/i.test(`${pm.name} ${pm.instrument}`)) part.isPiano = true;

    let divisions = 1;
    let timeSig = { beats: 4, beatType: 4 };
    let keyFifths = 0, keyMode = 'major';
    let transpose = { chromatic: part.transpose.chromatic, octaveChange: part.transpose.octaveChange, source: part.transpose.source };
    let measureIdx = 0;

    for (const mn of kids(pn, 'measure')) {
      const mStart = measureStarts[measureIdx] != null
        ? measureStarts[measureIdx]
        : (globalMeasures.length ? globalMeasures[globalMeasures.length - 1].startBeat + globalMeasures[globalMeasures.length - 1].beats : 0);
      let cursor = 0;      /* in divisions */
      let lastOnset = 0;
      let maxCursor = 0;
      let measureKey = keyFifths;
      let measureTime = timeSig;

      for (const node of [...mn.children]) {
        const tag = node.localName;
        if (tag === 'attributes') {
          const divEl = first(node, 'divisions');
          if (divEl) {
            const nd = parseFloat(txt(node, 'divisions', '1')) || 1;
            if (nd !== divisions && divisions > 0) {
              const ratio = nd / divisions;
              cursor = Math.round(cursor * ratio);
              lastOnset = Math.round(lastOnset * ratio);
              maxCursor = Math.round(maxCursor * ratio);
              divisions = nd;
            } else divisions = nd;
          }
          const keyEl = first(node, 'key');
          if (keyEl) {
            const f = first(keyEl, 'fifths');
            if (f) {
              keyFifths = Math.round(parseFloat(f.textContent) || 0);
              keyMode = txt(keyEl, 'mode', keyMode) || 'major';
              measureKey = keyFifths;
              if (!part.writtenKey) part.writtenKey = { fifths: keyFifths, mode: keyMode };
              const lastKC = part.keyChanges[part.keyChanges.length - 1];
              if (!lastKC || lastKC.fifths !== keyFifths || lastKC.mode !== keyMode) {
                part.keyChanges.push({ beat: mStart, fifths: keyFifths, mode: keyMode, measure: measureIdx });
              }
            }
          }
          const timeEl = first(node, 'time');
          if (timeEl) {
            const b = parseFloat(txt(timeEl, 'beats', '4')) || 4;
            const bt = parseFloat(txt(timeEl, 'beat-type', '4')) || 4;
            timeSig = { beats: b, beatType: bt };
            measureTime = timeSig;
          }
          const trEl = first(node, 'transpose');
          if (trEl) {
            const ch = fnum(trEl, 'chromatic', 0);
            const oc = fnum(trEl, 'octave-change', 0);
            transpose = { chromatic: ch, octaveChange: oc, source: 'attributes', diatonic: fnum(trEl, 'diatonic', 0) };
            part.transpose = { chromatic: ch, octaveChange: oc, source: 'attributes' };
          }
          const stavesEl = first(node, 'staves');
          if (stavesEl) {
            const ns = Math.max(1, Math.min(8, Math.round(parseFloat(stavesEl.textContent) || 1)));
            part.staves = ns;
            const nm = `${pm.name} ${pm.instrument}`.toLowerCase();
            if (ns >= 2 || /piano|pianoforte|keyboard|harpsichord|大钢琴|钢琴/.test(nm)) part.isPiano = true;
          }
          continue;
        }

        if (tag === 'backup') {
          cursor -= fnum(node, 'duration', 0);
          if (cursor < 0) cursor = 0;
          continue;
        }
        if (tag === 'forward') {
          cursor += fnum(node, 'duration', 0);
          maxCursor = Math.max(maxCursor, cursor);
          continue;
        }
        if (tag === 'sound') {
          const t = parseFloat(node.getAttribute('tempo') || '');
          if (Number.isFinite(t) && t > 0) {
            tempoEvents.push({ beat: mStart + cursor / divisions, bpm: t, measure: measureIdx });
          }
          continue;
        }
        if (tag === 'direction') {
          const snd = first(node, 'sound');
          let tempo = snd ? parseFloat(snd.getAttribute('tempo') || '') : NaN;
          if (!Number.isFinite(tempo)) {
            const met = node.getElementsByTagName('metronome')[0];
            if (met) {
              const pm = parseFloat(txt(met, 'per-minute', ''));
              const unit = txt(met, 'beat-unit', 'quarter');
              const dots = kids(met, 'beat-unit-dot').length;
              const unitQ = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 })[unit] || 1;
              if (Number.isFinite(pm) && pm > 0) tempo = pm * unitQ * (dots ? 1.5 : 1);
            }
          }
          if (Number.isFinite(tempo) && tempo > 0) {
            tempoEvents.push({ beat: mStart + cursor / divisions, bpm: tempo, measure: measureIdx });
          }
          continue;
        }
        if (tag === 'barline') {
          if (node.getElementsByTagName('repeat').length || node.getElementsByTagName('ending').length) {
            part.hasRepeats = true;
          }
          continue;
        }
        if (tag !== 'note') continue;

        const isGrace = !!node.getElementsByTagName('grace')[0];
        if (isGrace) continue;
        if (node.getAttribute('print-object') === 'no') continue;
        if (node.getElementsByTagName('cue')[0]) continue;

        const isChord = !!first(node, 'chord');
        const isRest = !!first(node, 'rest');
        let durDiv = fnum(node, 'duration', 0);
        if (!durDiv && !isChord) {
          /* 缺失 duration 时按 type 推算 */
          const type = txt(node, 'type', 'quarter');
          const map = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
          durDiv = (map[type] || 1) * divisions;
        }
        if (durDiv <= 0) continue;

        const onsetDiv = isChord ? lastOnset : cursor;
        const startBeat = mStart + onsetDiv / divisions;
        const durBeats = durDiv / divisions;
        if (!isChord) {
          lastOnset = onsetDiv;
          cursor = onsetDiv + durDiv;
          maxCursor = Math.max(maxCursor, cursor);
        } else {
          maxCursor = Math.max(maxCursor, onsetDiv + durDiv);
        }

        if (isRest) continue;
        const pitch = first(node, 'pitch');
        if (!pitch) continue;
        const step = (txt(pitch, 'step', 'C') || 'C').toUpperCase();
        const alter = fnum(pitch, 'alter', 0);
        const octave = fnum(pitch, 'octave', 4);
        if (STEP_SEMI[step] == null) continue;
        const writtenMidi = 12 * (octave + 1) + STEP_SEMI[step] + alter;
        const soundingMidi = writtenMidi + transpose.chromatic + 12 * transpose.octaveChange;
        if (soundingMidi < 0 || soundingMidi > 127) continue;

        const ties = kids(node, 'tie');
        let tieStart = ties.some(t => t.getAttribute('type') === 'start');
        let tieStop = ties.some(t => t.getAttribute('type') === 'stop');
        const notations = first(node, 'notations');
        if (notations) {
          for (const td of kids(notations, 'tied')) {
            if (td.getAttribute('type') === 'start') tieStart = true;
            if (td.getAttribute('type') === 'stop') tieStop = true;
          }
        }
        const staff = Math.round(fnum(node, 'staff', 1));
        const voice = txt(node, 'voice', '1');

        part.events.push({
          startBeat, durBeats, midi: soundingMidi, writtenMidi,
          measureIndex: measureIdx,
          beatInMeasure: onsetDiv / divisions,
          voice, staff, tieStart, tieStop,
          partId: id,
        });
        part.writtenMin = Math.min(part.writtenMin, writtenMidi);
        part.writtenMax = Math.max(part.writtenMax, writtenMidi);
        part.soundingMin = Math.min(part.soundingMin, soundingMidi);
        part.soundingMax = Math.max(part.soundingMax, soundingMidi);
      }

      /* 补全全局小节（若某声部更长） */
      if (measureIdx >= globalMeasures.length) {
        const expected = measureTime.beats * 4 / measureTime.beatType;
        let len = maxCursor / divisions;
        if (!(len > 0)) len = expected;
        const prev = globalMeasures[globalMeasures.length - 1];
        globalMeasures.push({
          index: measureIdx, number: String(measureIdx + 1), startBeat: prev ? prev.startBeat + prev.beats : 0,
          beats: len, timeSig: measureTime, keyFifths: measureKey, keyMode,
        });
        measureStarts[measureIdx] = globalMeasures[globalMeasures.length - 1].startBeat;
      } else {
        /* 记录主声部小节的实际属性 */
        const gm = globalMeasures[measureIdx];
        gm.timeSig = gm.timeSig || measureTime;
        gm.keyFifths = measureKey;
        gm.keyMode = keyMode;
      }
      measureIdx++;
    }

    if (!part.writtenKey) part.writtenKey = { fifths: 0, mode: 'major' };
    if (part.inferredTranspose && part.transpose.source === 'none') {
      part.transpose.inferred = part.inferredTranspose;
    }
    part.events = mergeTies(part.events).sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
    part.noteCount = part.events.length;
    if (part.events.length) parts.push(part);
    else warnings.push(`声部「${part.name}」没有音符，已忽略。`);
  }

  if (!parts.length) throw new Error('所有声部都没有可播放的音符。');

  /* 速度 */
  tempoEvents.sort((a, b) => a.beat - b.beat || a.bpm - b.bpm);
  const tempos = [];
  for (const te of tempoEvents) {
    if (!tempos.length || te.beat - tempos[tempos.length - 1].beat > 0.01) tempos.push(te);
    else tempos[tempos.length - 1] = te;
  }
  if (!tempos.length) tempos.push({ beat: 0, bpm: 120, measure: 0 });
  if (tempos[0].beat > 0.01) tempos.unshift({ beat: 0, bpm: tempos[0].bpm, measure: 0 });

  const title = txt(first(root, 'work') || root, 'work-title', '') || txt(root, 'movement-title', '') || filename.replace(/\.(musicxml|xml)$/i, '') || '未命名曲目';
  const composer = txt(first(first(root, 'identification') || root, 'creator') || root, 'creator', '');
  const identification = first(root, 'identification');
  let composerName = composer;
  if (identification) {
    for (const cr of kids(identification, 'creator')) {
      if ((cr.getAttribute('type') || '') === 'composer') composerName = (cr.textContent || '').trim();
    }
  }

  const score = {
    title, composer: composerName, filename,
    parts, measures: globalMeasures.filter(m => m.index < Math.max(...parts.map(p => Math.max(...p.events.map(e => e.measureIndex + 1))))) ,
    totalBeats,
    timeSig: globalMeasures[0] ? globalMeasures[0].timeSig : { beats: 4, beatType: 4 },
    keyFifths: globalMeasures[0] ? globalMeasures[0].keyFifths || 0 : 0,
    keyMode: globalMeasures[0] ? globalMeasures[0].keyMode || 'major' : 'major',
    tempos,
    warnings,
    raw: { partCount: partNodes.length },
  };
  score.measures = globalMeasures;
  score.hasRepeats = parts.some(p => p.hasRepeats);
  if (score.hasRepeats) {
    warnings.push('检测到反复记号：当前按谱面书写顺序播放，尚未展开反复段落。');
  }
  score.totalBeats = Math.max(acc, ...parts.map(p => Math.max(0, ...p.events.map(e => e.startBeat + e.durBeats))));
  score.beatToSeconds = beat => beatToSeconds(score, beat);
  score.secondsToBeat = sec => secondsToBeat(score, sec);
  score.totalSeconds = beatToSeconds(score, score.totalBeats) + 1.2;
  if (score.measures.length) {
    score.timeSig = score.measures[0].timeSig;
  }
  return score;
}

function mergeTies(events) {
  const out = [];
  const open = new Map();
  const sorted = events.slice().sort((a, b) => a.startBeat - b.startBeat || a.writtenMidi - b.writtenMidi);
  for (const ev of sorted) {
    const key = `${ev.partId}|${ev.voice}|${ev.staff}|${ev.writtenMidi}|${ev.midi}`;
    if (ev.tieStop && open.has(key)) {
      const prev = open.get(key);
      const gap = ev.startBeat - (prev.startBeat + prev.durBeats);
      if (gap > -0.01 && gap < 0.4) {
        prev.durBeats += ev.durBeats;
        prev.tieStart = ev.tieStart;
        if (!ev.tieStart) open.delete(key);
        continue;
      }
    }
    out.push(ev);
    if (ev.tieStart) open.set(key, ev);
  }
  return out;
}

function measureLengths(partNode) {
  const out = [];
  let divisions = 1, beats = 4, beatType = 4;
  let keyFifths = 0, keyMode = 'major';
  for (const mn of kids(partNode, 'measure')) {
    let cursor = 0, maxCursor = 0, lastOnset = 0;
    let mKey = keyFifths, mMode = keyMode, mTime = { beats, beatType };
    for (const node of [...mn.children]) {
      if (node.localName === 'attributes') {
        const d = fnum(node, 'divisions', 0);
        if (d > 0) divisions = d;
        const k = first(node, 'key');
        if (k) {
          const f = first(k, 'fifths');
          if (f) { keyFifths = Math.round(parseFloat(f.textContent) || 0); mKey = keyFifths; }
          const md = txt(k, 'mode', '');
          if (md) { keyMode = md; mMode = md; }
        }
        const t = first(node, 'time');
        if (t) {
          beats = parseFloat(txt(t, 'beats', '4')) || 4;
          beatType = parseFloat(txt(t, 'beat-type', '4')) || 4;
          mTime = { beats, beatType };
        }
        continue;
      }
      if (node.localName === 'note') {
        if (node.getElementsByTagName('grace')[0]) continue;
        const dur = fnum(node, 'duration', 0);
        if (first(node, 'chord')) maxCursor = Math.max(maxCursor, lastOnset + dur);
        else {
          lastOnset = cursor;
          cursor += dur;
          maxCursor = Math.max(maxCursor, cursor);
        }
      } else if (node.localName === 'backup') {
        cursor -= fnum(node, 'duration', 0);
      } else if (node.localName === 'forward') {
        cursor += fnum(node, 'duration', 0);
        maxCursor = Math.max(maxCursor, cursor);
      }
    }
    let len = maxCursor / divisions;
    if (!(len > 0)) len = beats * 4 / beatType;
    out.push({ beats: len, timeSig: mTime, keyFifths: mKey, keyMode: mMode });
  }
  return out;
}

/* --------------------------------------------------------------- time map */

export function beatToSeconds(score, beat) {
  const tempos = score.tempos && score.tempos.length ? score.tempos : [{ beat: 0, bpm: 120 }];
  let sec = 0;
  let cursor = 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i];
    const next = i + 1 < tempos.length ? tempos[i + 1] : null;
    if (beat <= t.beat) break;
    const end = next ? Math.min(beat, next.beat) : beat;
    if (end > cursor) {
      sec += (end - cursor) * (60 / t.bpm);
      cursor = end;
    }
    if (next && beat <= next.beat) break;
  }
  return sec;
}

export function secondsToBeat(score, sec) {
  const tempos = score.tempos && score.tempos.length ? score.tempos : [{ beat: 0, bpm: 120 }];
  let beat = 0;
  let elapsed = 0;
  if (sec <= 0) return 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i];
    const next = i + 1 < tempos.length ? tempos[i + 1] : null;
    const spanBeats = next ? next.beat - t.beat : Infinity;
    const spanSec = spanBeats * (60 / t.bpm);
    if (sec <= elapsed + spanSec) {
      beat = t.beat + (sec - elapsed) * t.bpm / 60;
      return beat;
    }
    elapsed += spanSec;
    beat = next ? next.beat : t.beat;
    if (!next) break;
  }
  return beat;
}

export function measureAtBeat(score, beat) {
  const ms = score.measures;
  if (!ms || !ms.length) return { index: 0, measure: null };
  let lo = 0, hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ms[mid].startBeat <= beat + 1e-6) lo = mid; else hi = mid - 1;
  }
  return { index: lo, measure: ms[lo] };
}

export function findPartMeasure(score, measureIndex) {
  return score.measures[measureIndex] || score.measures[score.measures.length - 1];
}
