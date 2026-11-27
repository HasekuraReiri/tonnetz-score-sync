/* ==========================================================================
   spelling.js — 调号与音名拼写（总谱绘制共用）
   仅保留原谱显示需要的三个纯函数，不再包含任何旧版钢琴谱渲染代码。
   ========================================================================== */

import { mod12, keySpell, nameOf, makeKey, FIFTHS_PCS, FIFTHS_POS } from '../assets/js/core.js';

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const LETTERS = 'CDEFGAB';

export function keySigFifths(key) {
  if (!key) return 0;
  const pcs = key.pcs ? key.pcs.slice().sort((a, b) => a - b).join(',') : '';
  for (let f = -7; f <= 7; f++) {
    const majT = FIFTHS_PCS[((f % 12) + 12) % 12];
    const majorPcs = [0, 2, 4, 5, 7, 9, 11].map(i => mod12(majT + i)).sort((a, b) => a - b).join(',');
    if (majorPcs === pcs) return f;
  }
  let f = FIFTHS_POS[mod12(key.tonic)] ?? 0;
  if (f > 6) f -= 12;
  if (key.mode && key.mode.group === 'minor') f -= 3;
  while (f > 7) f -= 12;
  while (f < -7) f += 12;
  return f;
}

export function spellName(pc, key) {
  pc = mod12(pc);
  const sp = key && key.spell ? key.spell : keySpell(makeKey(0, 'major'));
  if (key && key.mode && key.mode.group === 'minor') {
    const tonicName = sp.tonicName || nameOf(key.tonic, sp.pref || 'flat');
    const ti = LETTERS.indexOf(String(tonicName).charAt(0));
    if (ti >= 0) {
      for (const [letterOffset, semitoneOffset] of [[6, 11], [5, 9]]) {
        if (pc !== mod12(key.tonic + semitoneOffset)) continue;
        const letter = LETTERS[(ti + letterOffset) % 7];
        let diff = mod12(pc - SEMI[letter]);
        if (diff > 6) diff -= 12;
        if (Math.abs(diff) <= 2) {
          return letter + (diff > 0 ? '#'.repeat(diff) : diff < 0 ? 'b'.repeat(-diff) : '');
        }
      }
    }
  }
  return (sp.map && sp.map[pc]) || nameOf(pc, sp.pref || 'flat');
}

export function spellMidi(midi, key) {
  const pc = mod12(midi);
  const sp = key && key.spell ? key.spell : keySpell(makeKey(0, 'major'));
  const name = spellName(pc, key);
  const m = String(name).match(/^([A-G])([#b]*)$/);
  const letter = m ? m[1] : LETTERS[pc % 7];
  const alter = m ? (m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0) : 0;
  let octave = Math.floor(midi / 12) - 1;
  const natural = 12 * (octave + 1) + SEMI[letter];
  if (natural + alter - midi === 12) octave -= 1;
  else if (midi - (natural + alter) === 12) octave += 1;
  return { letter, alter, octave, step: octave * 7 + LETTER_IDX[letter], pc };
}
