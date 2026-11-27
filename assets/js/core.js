/* ==========================================================================
   core.js — 乐理内核：音名、和弦识别、音集理论、调性与功能、输入解析
   ========================================================================== */

export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const INTEGER_NAMES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
/* 参考图：黑键以“降/升”双拼写显示 */
export const REFERENCE_PAIRS = {
  1: ['Db', 'C#'], 3: ['Eb', 'D#'], 6: ['Gb', 'F#'], 8: ['Ab', 'G#'], 10: ['Bb', 'A#'],
};
export const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
};
export const FIFTHS_POS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: 7, 8: 8, 3: 9, 10: 10, 5: 11 };
export const FIFTHS_PCS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export const MODE_DEFS = [
  { id: 'major', name: '自然大调 · Ionian', short: '大调', group: 'major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: '自然小调 · Aeolian', short: '小调', group: 'minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonicMinor', name: '和声小调', short: '和声小调', group: 'minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodicMinor', name: '旋律小调（上行）', short: '旋律小调', group: 'minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'harmonicMajor', name: '和声大调', short: '和声大调', group: 'major', intervals: [0, 2, 4, 5, 7, 8, 11] },
  { id: 'melodicMajor', name: '旋律大调（下行）', short: '旋律大调', group: 'major', intervals: [0, 2, 4, 5, 7, 8, 10] },
  { id: 'dorian', name: '多利亚 · Dorian', short: '多利亚', group: 'modal', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: '弗里几亚 · Phrygian', short: '弗里几亚', group: 'modal', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: '利底亚 · Lydian', short: '利底亚', group: 'modal', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: '混合利底亚 · Mixolydian', short: '混合利底亚', group: 'modal', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: '洛克利亚 · Locrian', short: '洛克利亚', group: 'modal', intervals: [0, 1, 3, 5, 6, 8, 10] },
];
export const MODE_BY_ID = Object.fromEntries(MODE_DEFS.map(m => [m.id, m]));

/* ---------------------------------------------------------------- utils */

export const mod12 = n => ((n % 12) + 12) % 12;
export const pcSet = arr => [...new Set(arr.map(mod12))].sort((a, b) => a - b);
export const pcMask = pcs => pcs.reduce((m, pc) => m | (1 << mod12(pc)), 0);
export const maskToPcs = mask => {
  const out = [];
  for (let i = 0; i < 12; i++) if (mask & (1 << i)) out.push(i);
  return out;
};

export function noteToPc(str) {
  if (str == null) return null;
  let s = String(str).trim()
    .replace(/♭/g, 'b').replace(/♯/g, '#')
    .replace(/𝄫/g, 'bb').replace(/𝄪/g, '##');
  s = s.replace(/[0-9-]+$/, '');
  s = s.charAt(0).toUpperCase() + s.slice(1).replace(/^([A-G])b/, '$1b').replace(/^([A-G])#/, '$1#');
  if (NOTE_TO_PC[s] == null) return null;
  return NOTE_TO_PC[s];
}

export function parseNoteToken(token) {
  const m = String(token).trim().match(/^([A-Ga-g])([#b]{0,2})(-?\d)?$/);
  if (!m) return null;
  const pc = noteToPc(m[1] + m[2]);
  if (pc == null) return null;
  return { pc, octave: m[3] != null ? Number(m[3]) : null };
}

export function pcName(pc, spelling = 'flat') {
  pc = mod12(pc);
  if (spelling === 'integer') return String(pc);
  if (spelling === 'sharp') return SHARP_NAMES[pc];
  if (spelling === 'reference' && REFERENCE_PAIRS[pc]) return REFERENCE_PAIRS[pc][0];
  return FLAT_NAMES[pc];
}

/* 音名拼写：接受 'flat' | 'sharp' | {pref, map} */
export function nameOf(pc, spelling = 'flat') {
  pc = mod12(pc);
  if (spelling && typeof spelling === 'object') {
    if (spelling.map && spelling.map[pc] != null) return spelling.map[pc];
    return pcName(pc, spelling.pref || 'flat');
  }
  return pcName(pc, spelling);
}

export function pairName(pc) {
  const p = REFERENCE_PAIRS[mod12(pc)];
  return p ? p.slice() : [FLAT_NAMES[mod12(pc)], null];
}

export function midiFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteWithOctave(midi) {
  const pc = mod12(midi);
  return FLAT_NAMES[pc] + (Math.floor(midi / 12) - 1);
}

/* ------------------------------------------------------------- templates */

const T = (id, suffix, zh, intervals, tier = 5) => ({ id, suffix, zh, intervals, tier });

export const CHORD_TEMPLATES = [
  T('maj', '', '大三和弦', [0, 4, 7], 1),
  T('min', 'm', '小三和弦', [0, 3, 7], 1),
  T('dim', 'dim', '减三和弦', [0, 3, 6], 1),
  T('aug', 'aug', '增三和弦', [0, 4, 8], 1),
  T('sus2', 'sus2', '挂二和弦', [0, 2, 7], 1),
  T('sus4', 'sus4', '挂四和弦', [0, 5, 7], 1),
  T('power', '5', '五度强力和弦', [0, 7], 2),
  T('maj7', 'maj7', '大七和弦', [0, 4, 7, 11], 2),
  T('dom7', '7', '属七和弦', [0, 4, 7, 10], 2),
  T('min7', 'm7', '小七和弦', [0, 3, 7, 10], 2),
  T('m7b5', 'm7♭5', '半减七和弦', [0, 3, 6, 10], 2),
  T('dim7', 'dim7', '减七和弦', [0, 3, 6, 9], 2),
  T('mM7', 'mMaj7', '小大七和弦', [0, 3, 7, 11], 3),
  T('aug7', '7♯5', '增七和弦', [0, 4, 8, 10], 3),
  T('7sus4', '7sus4', '属七挂四', [0, 5, 7, 10], 3),
  T('7b5', '7♭5', '属七降五', [0, 4, 6, 10], 4),
  T('six', '6', '大六和弦', [0, 4, 7, 9], 3),
  T('m6', 'm6', '小六和弦', [0, 3, 7, 9], 3),
  T('sixNine', '6/9', '六九和弦', [0, 2, 4, 7, 9], 4),
  T('m6nine', 'm6/9', '小六九和弦', [0, 2, 3, 7, 9], 5),
  T('add9', 'add9', '加九和弦', [0, 2, 4, 7], 3),
  T('madd9', 'm(add9)', '小加九和弦', [0, 2, 3, 7], 4),
  T('add11', 'add11', '加十一和弦', [0, 4, 5, 7], 4),
  T('madd11', 'm(add11)', '小加十一和弦', [0, 3, 5, 7], 5),
  T('maj9', 'maj9', '大九和弦', [0, 2, 4, 7, 11], 3),
  T('dom9', '9', '属九和弦', [0, 2, 4, 7, 10], 3),
  T('min9', 'm9', '小九和弦', [0, 2, 3, 7, 10], 3),
  T('dom7b9', '7♭9', '属七降九', [0, 1, 4, 7, 10], 4),
  T('dom7s9', '7♯9', '属七升九', [0, 3, 4, 7, 10], 4),
  T('dom7s11', '7♯11', '属七升十一', [0, 4, 6, 7, 10], 4),
  T('dom7b13', '7♭13', '属七降十三', [0, 4, 7, 8, 10], 4),
  T('dom9sus4', '9sus4', '九挂四', [0, 2, 5, 7, 10], 4),
  T('maj7s11', 'maj7♯11', '大七升十一', [0, 4, 6, 7, 11], 4),
  T('dom11', '11', '属十一和弦', [0, 2, 4, 5, 7, 10], 5),
  T('dom13', '13', '属十三和弦', [0, 2, 4, 7, 9, 10], 5),
  T('min11', 'm11', '小十一和弦', [0, 2, 3, 5, 7, 10], 5),
  T('maj13', 'maj13', '大十三和弦', [0, 2, 4, 7, 9, 11], 5),
  T('m7add11', 'm7add11', '小七加十一', [0, 2, 3, 5, 7, 10], 6),
];

const TEMPLATE_BY_ID = Object.fromEntries(CHORD_TEMPLATES.map(t => [t.id, t]));

/* --------------------------------------------------------------- spelling */

export function majorFifths(tonic) {
  return FIFTHS_POS[mod12(tonic)] ?? 0;
}

export function keySignature(tonic) {
  const f = majorFifths(tonic);
  return f <= 6 ? { sharps: f, flats: 0 } : { sharps: 0, flats: 12 - f };
}

export function keyPrefersSharps(tonic) {
  const sig = keySignature(tonic);
  return sig.sharps > sig.flats;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function relativeMajorOf(key) {
  const target = key.pcs.slice().sort((a, b) => a - b).join(',');
  for (let t = 0; t < 12; t++) {
    const pcs = [0, 2, 4, 5, 7, 9, 11].map(i => mod12(t + i)).sort((a, b) => a - b).join(',');
    if (pcs === target) return t;
  }
  return key.mode && key.mode.group === 'minor' ? mod12(key.tonic + 3) : key.tonic;
}

function accidentalStr(d) {
  if (!d) return '';
  return d > 0 ? '#'.repeat(d) : 'b'.repeat(-d);
}

/**
 * 为某个调式生成“按音级字母拼写”的映射，例如 A 和声小调 → A B C D E F G#。
 * 返回 { pref, map, tonicName }，可直接传给 analyzeChord 作为 spelling。
 */
export function keySpell(key) {
  const rel = relativeMajorOf(key);
  const pref = keyPrefersSharps(rel) ? 'sharp' : 'flat';
  const tonicName = pcName(key.tonic, pref);
  const start = LETTERS.indexOf(tonicName.charAt(0));
  const map = {};
  key.pcs.forEach((pc, i) => {
    if (start < 0) return;
    const letter = LETTERS[(start + i) % 7];
    let diff = mod12(pc - LETTER_PC[letter]);
    if (diff > 6) diff -= 12;
    if (Math.abs(diff) <= 2) map[pc] = letter + accidentalStr(diff);
    else map[pc] = pcName(pc, pref);
  });
  return { pref, map, tonicName };
}

export function keySpelling(key) {
  if (!key) return 'flat';
  return keySpell(key).pref;
}

/* ------------------------------------------------------------- chord model */

function intervalsFrom(root, pcs) {
  return pcSet(pcs.map(pc => mod12(pc - root)));
}

function matchTemplate(intervals) {
  const key = intervals.join(',');
  for (const t of CHORD_TEMPLATES) {
    if (t.intervals.join(',') === key) return t;
  }
  return null;
}

function partialTemplate(intervals) {
  let best = null;
  for (const t of CHORD_TEMPLATES) {
    if (t.intervals.length >= intervals.length) continue;
    if (!t.intervals.every(x => intervals.includes(x))) continue;
    const extras = intervals.filter(x => !t.intervals.includes(x));
    if (extras.length > 1) continue;
    if (extras.some(x => ![1, 2, 5, 9, 6, 8, 3, 10].includes(x))) continue;
    const score = t.intervals.length * 10 - extras.length * 3 - t.tier * 0.1;
    if (!best || score > best.score) best = { t, extras, score };
  }
  return best;
}

function extensionSuffix(extras, tpl) {
  const names = [];
  const hasSeventh = tpl && (tpl.intervals.includes(10) || tpl.intervals.includes(11));
  for (const x of extras) {
    if (x === 2) names.push('add9');
    else if (x === 5) names.push('add11');
    else if (x === 9) names.push('add13');
    else if (x === 1) names.push('♭9');
    else if (x === 3) names.push('♯9');
    else if (x === 6) names.push('♯11');
    else if (x === 8) names.push('♭13');
    else if (x === 10 || x === 11) {
      /* 已经是七和弦时不再追加第二个七音，避免出现 maj77 / 77 */
      if (hasSeventh) continue;
      names.push('7');
    } else names.push('+' + x);
  }
  return names.join('');
}

/**
 * 识别和弦：给定音集与低音，推断根音、性质、标准记号与转位。
 * @param {number[]} pcs
 * @param {number|null} bassPc
 * @param {'flat'|'sharp'} spelling
 */
export function analyzeChord(pcs, bassPc = null, spelling = 'flat') {
  pcs = pcSet(pcs);
  if (!pcs.length) return null;
  if (bassPc != null) bassPc = mod12(bassPc);
  let best = null;

  for (const root of pcs) {
    const ints = intervalsFrom(root, pcs);
    const exact = matchTemplate(ints);
    if (exact) {
      let score = 1000 - exact.tier * 2 + Math.min(ints.length, 6) * 2;
      if (root === bassPc) score += 60;
      if (exact.id === 'maj' || exact.id === 'min' || exact.id === 'dim' || exact.id === 'aug') score += 4;
      if (!best || score > best.score) best = { root, tpl: exact, ints, score, extras: [] };
    } else {
      const part = partialTemplate(ints);
      if (part) {
        let score = 600 + part.t.intervals.length * 6 - part.extras.length * 8 - part.t.tier;
        if (root === bassPc) score += 40;
        if (!best || score > best.score) {
          best = { root, tpl: part.t, ints, score, extras: part.extras };
        }
      }
    }
  }

  if (!best) {
    /* 无法归入三度叠置：以低音（或最低音）为参照 */
    const root = bassPc != null && pcs.includes(bassPc) ? bassPc : pcs[0];
    const ints = intervalsFrom(root, pcs);
    const name = spelling === 'integer' ? `{${pcs.join(',')}}` : `${nameOf(root, spelling)} [${pcs.map(p => nameOf(p, spelling)).join(' ')}]`;
    return {
      found: false, root, pcs, bass: bassPc, intervals: ints,
      quality: 'set', qualityZh: '音集', suffix: '', symbol: name,
      inversion: -1, inversionName: '', template: null,
      display: name, label: name,
    };
  }

  const { root, tpl, extras } = best;
  let suffix = tpl.suffix;
  let rest = extras;
  if (tpl.id === 'power') {
    /* 强五和弦不叠加 add9/add13 之类的色彩记号 */
    if (extras.includes(10)) suffix = '7';
    rest = [];
  }
  if (rest.length) suffix += extensionSuffix(rest, tpl);
  const rootName = nameOf(root, spelling);
  const slash = bassPc != null && bassPc !== root ? `/${nameOf(bassPc, spelling)}` : '';
  const symbol = rootName + suffix + slash;

  const chordTones = rootPositionOrder(pcs, root);
  let inversion = -1;
  let inversionName = '';
  if (bassPc != null && chordTones.includes(bassPc)) {
    inversion = chordTones.indexOf(bassPc);
    if (inversion > 0) inversionName = inversion === 1 ? '第一转位' : inversion === 2 ? '第二转位' : inversion === 3 ? '第三转位' : `第${inversion + 1}转位`;
  }

  return {
    found: true, root, pcs, bass: bassPc, intervals: best.ints,
    quality: tpl.id, qualityZh: tpl.zh, suffix, symbol,
    inversion, inversionName, template: tpl,
    display: symbol, label: symbol,
    rootName,
  };
}

function rootPositionOrder(pcs, root) {
  return [...pcs].sort((a, b) => mod12(a - root) - mod12(b - root));
}

export function chordTonesByRoot(pcs, root) {
  return rootPositionOrder(pcSet(pcs), root);
}

/* ------------------------------------------------------------ set theory */

export function normalForm(pcs) {
  pcs = pcSet(pcs);
  if (pcs.length < 2) return pcs.slice();
  const n = pcs.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    const rot = pcs.slice(i).concat(pcs.slice(0, i));
    const span = mod12(rot[n - 1] - rot[0]);
    const transposed = rot.map(x => mod12(x - rot[0]));
    if (!best || span < best.span || (span === best.span && compareArrays(transposed, best.transposed) < 0)) {
      best = { span, transposed, rotation: rot };
    }
  }
  return best.rotation;
}

function compareArrays(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function primeForm(pcs) {
  pcs = pcSet(pcs);
  if (pcs.length < 2) return pcs.slice();
  const nf = normalForm(pcs);
  const nf0 = nf.map(x => mod12(x - nf[0]));
  const inv = nf0.map(x => mod12(-x));
  const invNf = normalForm(inv);
  const inv0 = invNf.map(x => mod12(x - invNf[0]));
  return compareArrays(nf0, inv0) <= 0 ? nf0 : inv0;
}

export function intervalVector(pcs) {
  pcs = pcSet(pcs);
  const vec = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < pcs.length; i++) {
    for (let j = i + 1; j < pcs.length; j++) {
      let d = Math.abs(pcs[i] - pcs[j]);
      if (d > 6) d = 12 - d;
      if (d >= 1 && d <= 6) vec[d - 1]++;
    }
  }
  return vec;
}

export function setInfo(pcs) {
  pcs = pcSet(pcs);
  const nf = normalForm(pcs);
  const pf = primeForm(pcs);
  const iv = intervalVector(pcs);
  return {
    pcs,
    mask: pcMask(pcs),
    normal: nf,
    prime: pf,
    iv,
    ivString: `<${iv.join('')}>`,
    normalString: `(${nf.join(',')})`,
    primeString: `(${pf.join(',')})`,
    cardinality: pcs.length,
  };
}

/* ------------------------------------------------------------ keys & funcs */

export function makeKey(tonic, modeId = 'major') {
  const mode = MODE_BY_ID[modeId] || MODE_BY_ID.major;
  const t = mod12(tonic);
  const pcs = mode.intervals.map(i => mod12(t + i));
  const key = {
    tonic: t, modeId: mode.id, mode, pcs,
    scale: pcs,
    sig: keySignature(t),
  };
  key.spell = keySpell(key);
  key.spelling = key.spell.pref;
  return key;
}

export function scaleNames(key, spelling) {
  const sp = spelling || key.spell || keySpell(key);
  return key.pcs.map(pc => nameOf(pc, sp));
}

export function degreeOf(key, pc) {
  return key.pcs.findIndex(x => x === mod12(pc));
}

const ROMAN_SUFFIX = { maj7: 'M7', dom7: '7', min7: '7', m7b5: 'ø7', dim7: '°7', mM7: 'M7', aug7: '7♯5', '7sus4': '7sus4', six: '6', m6: '6' };

function romanForDegree(key, chord, degreeIdx) {
  const base = ROMAN[degreeIdx] || String(degreeIdx + 1);
  const tpl = chord.template || {};
  let numeral = base;
  const isMinorish = ['min', 'dim', 'm7b5', 'dim7', 'min7', 'min9', 'm6', 'mM7', 'madd9', 'madd11', 'm6nine'].includes(tpl.id);
  if (isMinorish) numeral = base.toLowerCase();
  if (tpl.id === 'dim' || tpl.id === 'dim7') numeral += '°';
  if (tpl.id === 'm7b5') numeral += 'ø';
  if (tpl.id === 'aug' || tpl.id === 'aug7') numeral += '+';
  let ext = '';
  if (['maj7', 'dom7', 'min7', 'm7b5', 'dim7', 'mM7', 'aug7', '7sus4', 'six', 'm6'].includes(tpl.id)) {
    ext = ROMAN_SUFFIX[tpl.id] || '7';
    if (tpl.id === 'maj7') ext = 'M7';
    else if (tpl.id === 'dom7') ext = '7';
    else if (tpl.id === 'min7') ext = '7';
    else if (tpl.id === 'm7b5') ext = '7';
    else if (tpl.id === 'dim7') ext = '7';
    else if (tpl.id === 'mM7') ext = 'M7';
    else if (tpl.id === 'aug7') ext = '7';
    else if (tpl.id === '7sus4') ext = '7sus4';
    else if (tpl.id === 'six') ext = '6';
    else if (tpl.id === 'm6') ext = '6';
  } else if (chord.intervals && chord.intervals.length >= 5) {
    ext = String(chord.intervals.length + 2);
  }
  return numeral + ext;
}

const DEGREE_FUNC = ['T', 'S', 'T', 'S', 'D', 'T', 'D'];

function funcCase(letter, chord) {
  if (!letter) return null;
  const minorish = ['min', 'dim', 'dim7', 'm7b5', 'min7', 'mM7', 'm6', 'madd9', 'madd11'].includes(chord.quality);
  if (letter === '?') return '?';
  return minorish ? letter.toLowerCase() : letter;
}

/**
 * 相对某调的功能分析
 * @returns {{roman:string, func:string, group:'T'|'S'|'D'|'?', desc:string, tag:string, degree:number}}
 */
export function harmonicFunction(chord, key) {
  if (!chord || !key) return null;
  const root = chord.root;
  const scale = key.pcs;
  const spelling = key.spell || keySpell(key);
  const rootName = nameOf(root, spelling);
  const deg = degreeOf(key, root);
  const diatonicPcs = scale;

  /* 1. 调内和弦 */
  if (deg >= 0 && chord.pcs.every(pc => diatonicPcs.includes(pc))) {
    const roman = romanForDegree(key, chord, deg);
    const letter = DEGREE_FUNC[deg] || '?';
    const func = funcCase(letter, chord);
    const descMap = { T: '主功能', S: '下属功能', D: '属功能' };
    return {
      roman, func, group: letter, degree: deg + 1, tag: 'diatonic',
      desc: `${descMap[letter]} · ${key.mode.short} ${ROMAN[deg]} 级${chord.inversion > 0 ? ' · ' + chord.inversionName : ''}`,
    };
  }

  /* 2. 副属 / 副导 */
  for (let i = 0; i < scale.length; i++) {
    const target = scale[i];
    const targetRoman = ROMAN[i];
    if (mod12(root - target) === 7 && ['maj', 'dom7', 'dom9', 'aug7', '7b9', '7s9', '7s11', '7b13', 'six'].includes(chord.quality)) {
      return {
        roman: `V/${targetRoman}`, func: 'D', group: 'D', degree: i + 1, tag: 'secondary',
        desc: `副属和弦 · 解决到 ${targetRoman} 级 ${nameOf(target, spelling)}`,
      };
    }
    if (mod12(target - root) === 1 && ['dim', 'dim7', 'm7b5'].includes(chord.quality)) {
      return {
        roman: `vii°/${targetRoman}`, func: 'd', group: 'D', degree: i + 1, tag: 'secondary',
        desc: `副导七和弦 · 解决到 ${targetRoman} 级 ${nameOf(target, spelling)}`,
      };
    }
  }

  /* 3. 同主音大小调借用 */
  const parallelScales = [
    { name: '同主音小调', key: makeKey(key.tonic, 'minor') },
    { name: '同主音大调', key: makeKey(key.tonic, 'major') },
  ];
  for (const p of parallelScales) {
    if (p.key.pcs.join() === key.pcs.join()) continue;
    if (chord.pcs.every(pc => p.key.pcs.includes(pc))) {
      const d = degreeOf(p.key, root);
      if (d >= 0) {
        const roman0 = romanForDegree(p.key, chord, d);
        const letter = DEGREE_FUNC[d];
        return {
          roman: roman0, func: funcCase(letter, chord), group: letter, degree: d + 1, tag: 'borrowed',
          desc: `借用 · ${p.name}的 ${ROMAN[d]} 级${chord.inversion > 0 ? ' · ' + chord.inversionName : ''}`,
        };
      }
    }
  }

  /* 4. 那不勒斯 / 变化和弦 */
  if (mod12(root - key.tonic) === 1 && ['maj', 'six', 'maj7'].includes(chord.quality)) {
    return {
      roman: '♭II (N)', func: 's', group: 'S', degree: 2, tag: 'chromatic',
      desc: '那不勒斯和弦 · 降二级大三和弦，常作下属功能',
    };
  }
  if (deg >= 0) {
    const roman = ROMAN[deg];
    return {
      roman, func: funcCase(DEGREE_FUNC[deg], chord), group: DEGREE_FUNC[deg], degree: deg + 1,
      tag: 'chromatic',
      desc: `调内级数上的变化和弦 · ${rootName} 为 ${roman} 级${chord.inversion > 0 ? ' · ' + chord.inversionName : ''}`,
    };
  }

  /* 5. 完全调外：按与主音的五度关系给出方向 */
  const fifth = FIFTHS_POS[mod12(root - key.tonic)] ?? 0;
  return {
    roman: rootName, func: '?', group: '?', degree: 0, tag: 'chromatic',
    desc: `调外和弦 · 根音 ${rootName} 距主音 ${mod12(root - key.tonic)} 个半音${fifth < 6 ? '（属方向）' : '（下属方向）'}`,
  };
}

export function functionColor(group) {
  if (group === 'T') return '#3b6fd4';
  if (group === 'S') return '#c08a2c';
  if (group === 'D') return '#b5483f';
  return '#8a8a8a';
}

/* ------------------------------------------------------------ input parser */

const QUALITY_MAP = new Map();
function addQ(names, ints) { for (const n of names) QUALITY_MAP.set(n, ints); }
addQ(['', 'maj', 'major', 'M', '大三', '大三和弦'], [0, 4, 7]);
addQ(['m', 'min', 'minor', '-', '小三', '小三和弦'], [0, 3, 7]);
addQ(['dim', 'o', '°', '减三', '减三和弦'], [0, 3, 6]);
addQ(['aug', '+', '增三', '增三和弦'], [0, 4, 8]);
addQ(['sus2', '挂二'], [0, 2, 7]);
addQ(['sus4', 'sus', '挂四'], [0, 5, 7]);
addQ(['5', 'power', '强五'], [0, 7]);
addQ(['maj7', 'M7', 'Maj7', 'Δ7', '△7', '大七', '大大七'], [0, 4, 7, 11]);
addQ(['7', 'dom7', '属七', '属七和弦'], [0, 4, 7, 10]);
addQ(['m7', 'min7', '-7', '小七'], [0, 3, 7, 10]);
addQ(['m7b5', 'min7b5', 'ø7', 'ø', 'half-dim7', 'halfdim7', '半减七'], [0, 3, 6, 10]);
addQ(['dim7', '°7', 'o7', '减七'], [0, 3, 6, 9]);
addQ(['mM7', 'mMaj7', 'minmaj7', '小大七'], [0, 3, 7, 11]);
addQ(['aug7', '7#5', '+7', '增七'], [0, 4, 8, 10]);
addQ(['7sus4', '7sus'], [0, 5, 7, 10]);
addQ(['7b5', '7-5'], [0, 4, 6, 10]);
addQ(['6', 'maj6', 'M6'], [0, 4, 7, 9]);
addQ(['m6', 'min6', '-6'], [0, 3, 7, 9]);
addQ(['6/9', '69'], [0, 2, 4, 7, 9]);
addQ(['m6/9', 'm69'], [0, 2, 3, 7, 9]);
addQ(['add9'], [0, 2, 4, 7]);
addQ(['madd9', 'm(add9)'], [0, 2, 3, 7]);
addQ(['add11'], [0, 4, 5, 7]);
addQ(['madd11', 'm(add11)'], [0, 3, 5, 7]);
addQ(['maj9', 'M9', 'Δ9'], [0, 2, 4, 7, 11]);
addQ(['9', 'dom9', '属九'], [0, 2, 4, 7, 10]);
addQ(['m9', 'min9', '小九'], [0, 2, 3, 7, 10]);
addQ(['7b9', '7-9'], [0, 1, 4, 7, 10]);
addQ(['7#9', '7+9'], [0, 3, 4, 7, 10]);
addQ(['7#11', '7+11'], [0, 4, 6, 7, 10]);
addQ(['7b13', '7-13'], [0, 4, 7, 8, 10]);
addQ(['maj7#11', 'M7#11'], [0, 4, 6, 7, 11]);
addQ(['9sus4'], [0, 2, 5, 7, 10]);
addQ(['11'], [0, 2, 4, 5, 7, 10]);
addQ(['m11', 'min11'], [0, 2, 3, 5, 7, 10]);
addQ(['13'], [0, 2, 4, 7, 9, 10]);
addQ(['maj13', 'M13'], [0, 2, 4, 7, 9, 11]);
addQ(['m7add11'], [0, 2, 3, 5, 7, 10]);

function qualityIntervals(suffix) {
  let s = String(suffix || '').trim()
    .replace(/\s+/g, '')
    .replace(/♭/g, 'b').replace(/♯/g, '#')
    .replace(/[（]/g, '(').replace(/[）)]/g, ')')
    .replace(/^[·・]/, '');
  if (QUALITY_MAP.has(s)) return QUALITY_MAP.get(s);
  const low = s.toLowerCase();
  if (QUALITY_MAP.has(low)) return QUALITY_MAP.get(low);
  /* 简单组合：maj/m + add9/11/13 等 */
  const m = low.match(/^(maj|m)?7(b9|#9|#11|b13|b5|#5)?$/);
  if (m) {
    const base = m[1] === 'm' ? [0, 3, 7, 10] : [0, 4, 7, 10];
    const alt = m[2];
    const map = { b9: 1, '#9': 3, '#11': 6, b13: 8, b5: 6, '#5': 8 };
    if (!alt) return base;
    if (alt === 'b5' || alt === '#5') return m[1] === 'm' ? [0, 3, 6, 10] : [0, 4, (alt === 'b5' ? 6 : 8), 10];
    return [...base, map[alt]];
  }
  return null;
}
function parseChordSymbol(str, spelling) {
  let s = str.trim()
    .replace(/♭/g, 'b').replace(/♯/g, '#')
    .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
    .replace(/\s+/g, '');
  if (!s) return null;
  let bass = null;
  /* 分离斜杠低音；注意 6/9 和弦 */
  const slashMatch = s.match(/^(.*?)(?:\/([A-Ga-g][#b]?))$/);
  if (slashMatch) {
    s = slashMatch[1];
    bass = noteToPc(slashMatch[2]);
  }
  const m = s.match(/^([A-Ga-g])([#b]{0,2})(.*)$/);
  if (!m) return null;
  const rootPc = noteToPc(m[1] + m[2]);
  if (rootPc == null) return null;
  let suffix = m[3] || '';
  suffix = suffix.replace(/^[·・]/, '');
  const ints = qualityIntervals(suffix);
  if (!ints) return null;
  const pcs = ints.map(i => mod12(rootPc + i));
  const chord = analyzeChord(pcs, bass != null ? bass : rootPc, spelling);
  /* 保留用户输入时的根音拼写（例如 F#dim7 不强行改成 Gbdim7） */
  const typedRoot = m[1].toUpperCase() + (m[2] || '').replace(/^b/, 'b').replace(/^#/, '#');
  if (chord && chord.root === rootPc) {
    chord.rootName = typedRoot;
    const slashName = bass != null && bass !== rootPc
      ? '/' + (slashMatch ? slashMatch[2].charAt(0).toUpperCase() + slashMatch[2].slice(1) : (chord.symbol.split('/')[1] || ''))
      : '';
    chord.symbol = typedRoot + chord.suffix + slashName;
    chord.display = chord.symbol;
    chord.label = chord.symbol;
  }
  return {
    kind: 'chord', pcs, bass: bass != null ? bass : rootPc,
    root: rootPc, symbol: chord.symbol, chord,
    raw: str,
  };
}

function parseNoteList(tokens, spelling) {
  const parsed = tokens.map(parseNoteToken).filter(Boolean);
  if (parsed.length < 1 || parsed.length !== tokens.length) return null;
  const pcs = pcSet(parsed.map(p => p.pc));
  let bass = null;
  const withOct = parsed.filter(p => p.octave != null);
  if (withOct.length) {
    withOct.sort((a, b) => a.octave - b.octave);
    bass = withOct[0].pc;
  }
  const chord = pcs.length >= 2 ? analyzeChord(pcs, bass, spelling) : null;
  return { kind: pcs.length === 1 ? 'note' : 'set', pcs, bass, chord, raw: null };
}

export function parseInput(raw, spelling = 'flat') {
  let str = String(raw || '').trim();
  if (!str) return { ok: false, error: '请输入和弦、音符或音集。' };
  str = str.replace(/[，、；;]/g, ',').replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/♭/g, 'b').replace(/♯/g, '#').replace(/[−–—]/g, '-');

  /* 音集：[0,2,4] / {0,2,4} / 0 2 4 5 9 */
  const bracketed = str.match(/^[\[{]\s*([0-9,\s]+)\s*[\]}]$/);
  if (bracketed || /^\s*\d+(\s*[,\s]\s*\d+)+\s*$/.test(str)) {
    const inner = bracketed ? bracketed[1] : str;
    const nums = inner.split(/[,\s]+/).filter(Boolean).map(Number);
    if (nums.length >= 1 && nums.every(n => Number.isInteger(n) && n >= 0 && n <= 11)) {
      const pcs = pcSet(nums);
      const set = setInfo(pcs);
      const chord = pcs.length >= 2 ? analyzeChord(pcs, null, spelling) : null;
      return { ok: true, kind: 'set', pcs, bass: null, chord, set, raw: str };
    }
    return { ok: false, error: '音集必须使用 0–11 的整数，如 [0,2,4,5,9]。' };
  }

  const tokens = str.split(/[\s,]+/).filter(Boolean);
  const allNotes = tokens.length > 0 && tokens.every(t => parseNoteToken(t));

  /* 多个音符：C E G / C4 E4 G4 */
  if (tokens.length >= 2 && allNotes) {
    const p = parseNoteList(tokens, spelling);
    if (p) return { ok: true, ...p, set: setInfo(p.pcs), raw: str };
  }

  /* 和弦符号：Cmaj7 / Am7/E / C */
  const chord = parseChordSymbol(str, spelling);
  if (chord) return { ok: true, ...chord, set: setInfo(chord.pcs), raw: str };

  /* 单个音符：C4 / Bb3 */
  if (tokens.length === 1 && allNotes) {
    const p = parseNoteList(tokens, spelling);
    if (p) return { ok: true, ...p, set: setInfo(p.pcs), raw: str };
  }

  return { ok: false, error: '无法识别。可尝试：Cmaj7、Am7/E、C E G、[0,2,4,5,9]。' };
}
/* ---------------------------------------------------------------- voicing */

export function makeVoicing(pcs, bassPc = null, opts = {}) {
  pcs = pcSet(pcs);
  if (!pcs.length) return { notes: [], bassMidi: null };
  const low = opts.low ?? 48;
  const bass = bassPc != null ? mod12(bassPc) : pcs[0];
  const bassMidi = low + bass;
  const others = pcs.filter(pc => pc !== bass);
  others.sort((a, b) => a - b);
  const notes = [{ pc: bass, midi: bassMidi }];
  let prev = bassMidi;
  for (const pc of others) {
    let midi = 60 + pc;
    while (midi <= prev) midi += 12;
    notes.push({ pc, midi });
    prev = midi;
  }
  return { notes, bassMidi };
}

export function voicingToMidi(pcs, bassPc, opts) {
  return makeVoicing(pcs, bassPc, opts).notes.map(n => n.midi);
}

/* ---------------------------------------------------------------- display */

export function noteLabel(pc, naming = 'reference', spelling = 'flat') {
  if (naming === 'integer') return String(mod12(pc));
  if (naming === 'reference' && REFERENCE_PAIRS[mod12(pc)]) return REFERENCE_PAIRS[mod12(pc)].join('/');
  return pcName(pc, spelling);
}

export function romanize(n) {
  return ROMAN[n - 1] || String(n);
}

export function formatPcs(pcs, naming = 'reference', spelling = 'flat') {
  return pcs.map(pc => (naming === 'integer' ? pc : pcName(pc, naming === 'reference' ? spelling : 'flat')));
}

/* 用于本工作簿“通用名” [C,G,E]/C */
export function parseGenericName(str) {
  const m = String(str).match(/^\[([^\]]+)\]\/([A-G][#b]?)$/);
  if (!m) return null;
  const pcs = m[1].split(',').map(noteToPc).filter(x => x != null);
  const bass = noteToPc(m[2]);
  if (!pcs.length || bass == null) return null;
  return { pcs: pcSet(pcs), bass };
}

export function transposePcs(pcs, n) {
  return pcSet(pcs.map(pc => mod12(pc + n)));
}

export function transposeGeneric(pcs, bass, n) {
  return { pcs: transposePcs(pcs, n), bass: bass != null ? mod12(bass + n) : null };
}

export function slug(s) {
  return String(s).replace(/[^\w\u4e00-\u9fa5-]+/g, '-');
}
