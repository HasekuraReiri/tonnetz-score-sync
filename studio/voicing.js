/* ==========================================================================
   voicing.js — 由和弦音集生成四部和声（SATB）
   目标：不依赖人工编辑，给每个和声片段一个可唱、声部次序正确、
   与前一和弦尽量平滑连接的四声部排列。
   ========================================================================== */

import { mod12 } from '../assets/js/core.js';

const RANGE = {
  B: [36, 55],
  T: [45, 64],
  A: [53, 74],
  S: [60, 84],
};
const CENTER = { B: 48, T: 57, A: 64, S: 72 };
const VOICES = ['B', 'T', 'A', 'S'];
const MOVE_WEIGHT = { B: 0.9, T: 0.8, A: 0.9, S: 1.0 };

function midiOptions(pc, range) {
  const out = [];
  for (let m = range[0]; m <= range[1]; m++) if (mod12(m) === pc) out.push(m);
  return out;
}

function targetPcs(seg) {
  const chord = seg.chord || {};
  const pcs = (seg.pcs && seg.pcs.length ? seg.pcs : chord.pcs || []).slice();
  if (!pcs.length) return [];
  const root = chord.root != null ? chord.root : pcs[0];
  const bass = seg.bassPc != null ? seg.bassPc : (chord.bass != null ? chord.bass : root);
  const third = mod12(root + (pcs.includes(mod12(root + 3)) ? 3 : 4));
  const order = [bass, root, third, mod12(root + 7), mod12(root + 10), mod12(root + 11), ...pcs];
  const out = [];
  for (const pc of order) {
    if (pc == null || !pcs.includes(mod12(pc))) continue;
    if (!out.some(x => mod12(x) === mod12(pc))) out.push(mod12(pc));
    if (out.length >= 4) break;
  }
  for (const pc of pcs) {
    if (out.length >= 4) break;
    if (!out.includes(pc)) out.push(pc);
  }
  while (out.length < 3) {
    const add = out.length ? root : bass;
    if (out.includes(add)) {
      if (out.length === 1) out.push(mod12(add + 7));
      else break;
    } else out.push(add);
    if (out.length >= 4) break;
  }
  return out;
}

function staticCost(v, pcs, root, bassPc) {
  let cost = 0;
  const counts = {};
  for (const m of v.midi) counts[mod12(m)] = (counts[mod12(m)] || 0) + 1;
  if (!counts[root]) cost += 1.1;
  if (counts[root] > 1) cost -= 0.35;
  if (counts[mod12(root + 4)] > 1 || counts[mod12(root + 3)] > 1) cost += 1.8;
  if (bassPc != null && mod12(v.B) !== mod12(bassPc)) cost += 0.6;
  const [b, t, a, s] = [v.B, v.T, v.A, v.S];
  cost += Math.max(0, s - a - 12) * 0.32;
  cost += Math.max(0, a - t - 12) * 0.32;
  cost += Math.max(0, t - b - 19) * 0.22;
  cost += Math.max(0, b - t) * 4 + Math.max(0, t - a) * 4 + Math.max(0, a - s) * 4;
  return cost;
}

function candidatesFor(seg, cache) {
  const pcs = targetPcs(seg);
  if (!pcs.length) return [];
  const chord = seg.chord || {};
  const root = chord.root != null ? chord.root : pcs[0];
  const bassPc = seg.bassPc != null ? seg.bassPc : (chord.bass != null ? chord.bass : root);
  const key = `${pcs.join(',')}|${root}|${mod12(bassPc == null ? root : bassPc)}`;
  if (cache.has(key)) return cache.get(key);
  const bassOptions = midiOptions(mod12(bassPc == null ? root : bassPc), RANGE.B);
  const opts = { T: [], A: [], S: [] };
  for (const pc of pcs) {
    for (const v of ['T', 'A', 'S']) {
      for (const m of midiOptions(pc, RANGE[v])) opts[v].push(m);
    }
  }
  for (const v of ['T', 'A', 'S']) {
    opts[v].sort((a, b) => Math.abs(a - CENTER[v]) - Math.abs(b - CENTER[v]));
    if (opts[v].length > 9) opts[v] = opts[v].slice(0, 9);
  }
  const out = [];
  for (const B of bassOptions) {
    for (const T of opts.T) {
      if (T <= B) continue;
      for (const A of opts.A) {
        if (A <= T) continue;
        for (const S of opts.S) {
          if (S <= A) continue;
          if (S - A > 13 || A - T > 13 || T - B > 21) continue;
          const v = { B, T, A, S, midi: [B, T, A, S] };
          v.cost = staticCost(v, pcs, root, bassPc);
          out.push(v);
        }
      }
    }
  }
  out.sort((a, b) => a.cost - b.cost);
  const trimmed = out.slice(0, 240);
  cache.set(key, trimmed);
  return trimmed;
}

function moveCost(prev, cur) {
  if (!prev) return 0;
  let cost = 0;
  for (const v of VOICES) {
    cost += Math.abs(cur[v] - prev[v]) * MOVE_WEIGHT[v];
    /* 声部超越：新声部落到相邻声部上一位置之外，听觉上会像换声部 */
    if (v === 'S' && cur.S < prev.A) cost += 3;
    if (v === 'A' && (cur.A > prev.S || cur.A < prev.T)) cost += 2.2;
    if (v === 'T' && (cur.T > prev.A || cur.T < prev.B)) cost += 2.2;
    if (v === 'B' && cur.B > prev.T) cost += 3;
  }
  return cost;
}

function pick(prev, cands) {
  let best = null, bestScore = Infinity;
  for (const c of cands) {
    const score = c.cost * 0.7 + moveCost(prev, c);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function fallback(seg) {
  const pcs = targetPcs(seg);
  const chord = seg.chord || {};
  const root = chord.root != null ? chord.root : (pcs[0] ?? 0);
  const bassPc = seg.bassPc != null ? seg.bassPc : root;
  const nearest = (pc, target, lo, hi) => {
    let best = target;
    let d = 99;
    for (let m = lo; m <= hi; m++) {
      if (mod12(m) !== mod12(pc)) continue;
      const dd = Math.abs(m - target);
      if (dd < d) { d = dd; best = m; }
    }
    return best;
  };
  const B = nearest(bassPc, 45, 36, 55);
  const T = nearest(root, 55, 45, 64);
  const A = nearest(pcs.find(p => p !== root) ?? mod12(root + 4), 62, 53, 74);
  const S = nearest(pcs.find(p => p !== root && p !== mod12(A)) ?? mod12(root + 7), 70, 60, 84);
  return { B, T, A: Math.max(A, T + 1), S: Math.max(S, Math.max(A, T + 1) + 1), midi: [B, T, A, S], cost: 0 };
}

export function buildSatbVoices(segments) {
  const cache = new Map();
  const voices = new Array(segments.length).fill(null);
  let prev = null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || !seg.chord || !seg.pcs || seg.pcs.length < 2) { prev = null; continue; }
    const cands = candidatesFor(seg, cache);
    let v = cands.length ? pick(prev, cands) : fallback(seg);
    if (!v) { prev = null; continue; }
    voices[i] = { S: v.S, A: v.A, T: v.T, B: v.B, midi: [v.B, v.T, v.A, v.S] };
    prev = v;
  }
  return voices;
}
