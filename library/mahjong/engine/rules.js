// rules.js · what wins, how far a hand is from winning, and what a win scores,
// under Hong Kong rules with faan.
//
// A winning hand is four sets (chows: three in a row of one suit; pungs: three
// alike; kongs count as pungs) and a pair, counting the sets already exposed,
// or the thirteen orphans. Scoring adds faan for patterns; a hand of 13 faan or
// more is a limit hand.
import { idx, kind, counts, isHonor, isSuited, isDragon, isWind, isTerminal, suitOf, WINDS, DRAGONS } from './tiles.js';

const ORPHANS = ['m1', 'm9', 'p1', 'p9', 's1', 's9', ...WINDS, ...DRAGONS].map(idx);
export const LIMIT = 13;

// ── decomposition ───────────────────────────────────────────────────────────
// Every way to split concealed counts into sets and one pair.
export function decompositions(c) {
  const out = [];
  const sets = [];
  const walk = (i) => {
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) { out.push(sets.slice()); return; }
    if (c[i] >= 3) { c[i] -= 3; sets.push({ type: 'pung', tile: kind(i) }); walk(i); sets.pop(); c[i] += 3; }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ type: 'chow', tile: kind(i) }); walk(i); sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  };
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const before = out.length;
    walk(0);
    for (let k = before; k < out.length; k++) out[k] = { pair: kind(p), sets: out[k] };
    c[p] += 2;
  }
  return out;
}

export function isThirteenOrphans(c) {
  let pair = false;
  for (let i = 0; i < 34; i++) {
    if (ORPHANS.includes(i)) { if (c[i] === 0) return false; if (c[i] === 2) { if (pair) return false; pair = true; } if (c[i] > 2) return false; }
    else if (c[i]) return false;
  }
  return pair;
}

// Is this (concealed tiles, exposed melds) a complete hand? Returns its shapes.
export function winningShapes(concealed, melds) {
  const c = counts(concealed);
  const n = c.reduce((a, b) => a + b, 0);
  if (n !== 14 - 3 * melds.length) return [];
  const out = decompositions(c).filter(d => d.sets.length === 4 - melds.length).map(d => ({ ...d, special: null }));
  if (!melds.length && isThirteenOrphans(c)) out.push({ pair: null, sets: [], special: 'thirteen-orphans' });
  return out;
}

// ── shanten: how many tiles from ready (0 = one tile from winning, -1 = won) ─
const memo = new Map();
export function shanten(c, meldCount = 0) {
  const key = c.join('') + meldCount;
  if (memo.has(key)) return memo.get(key);
  const need = 4 - meldCount;
  let best = 8;
  const scan = (i, sets, partials, pair) => {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      const p = Math.min(partials, need - sets);
      const s = 2 * (need - sets) - p - pair;
      if (s < best) best = s;
      return;
    }
    if (c[i] >= 3) { c[i] -= 3; scan(i, sets + 1, partials, pair); c[i] += 3; }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; scan(i, sets + 1, partials, pair); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (sets + partials < need) {
      if (c[i] >= 2) { c[i] -= 2; scan(i, sets, partials + 1, pair); c[i] += 2; }
      if (i < 27 && i % 9 <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; scan(i, sets, partials + 1, pair); c[i]++; c[i + 1]++; }
      if (i < 27 && i % 9 <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; scan(i, sets, partials + 1, pair); c[i]++; c[i + 2]++; }
    }
    c[i]--; scan(i + (c[i] === 0 ? 1 : 0), sets, partials, pair); c[i]++;
  };
  scan(0, 0, 0, 0);
  for (let p = 0; p < 34; p++) if (c[p] >= 2) { c[p] -= 2; scan(0, 0, 0, 1); c[p] += 2; }
  if (!meldCount) {
    let kinds = 0, pair = 0;
    for (const i of ORPHANS) { if (c[i]) kinds++; if (c[i] >= 2) pair = 1; }
    best = Math.min(best, 13 - kinds - pair);
  }
  if (memo.size > 200000) memo.clear();
  memo.set(key, best);
  return best;
}

// ── scoring ─────────────────────────────────────────────────────────────────
// ctx: { melds, bonus, seatWind (0–3), roundWind (0–3), selfDraw, lastTile, kongReplacement, flowers (rules on?) }
export function score(shape, ctx) {
  const items = [];
  const add = (faan, why) => items.push({ faan, why });
  if (shape.special === 'thirteen-orphans') { add(LIMIT, 'Thirteen orphans'); return total(items); }

  // Every set in the hand, exposed ones first.
  const sets = [...ctx.melds.map(m => ({ type: m.type === 'chow' ? 'chow' : 'pung', tile: m.tiles[0], concealed: !!m.concealed })), ...shape.sets.map(s => ({ ...s, concealed: true }))];
  const tiles = [shape.pair, ...sets.flatMap(s => (s.type === 'chow' ? [s.tile] : [s.tile]))];
  const all = [shape.pair, ...sets.map(s => s.tile)];
  const pungs = sets.filter(s => s.type === 'pung');
  const suits = new Set(all.filter(isSuited).map(suitOf));
  const honors = all.some(isHonor);
  const seatW = WINDS[ctx.seatWind], roundW = WINDS[ctx.roundWind];
  const exposed = ctx.melds.some(m => !m.concealed);

  const dragonPungs = pungs.filter(s => isDragon(s.tile)).length;
  const windPungs = pungs.filter(s => isWind(s.tile)).length;
  if (windPungs === 4) add(LIMIT, 'Great four winds');
  else if (windPungs === 3 && isWind(shape.pair)) add(6, 'Small four winds');
  if (dragonPungs === 3) add(8, 'Great three dragons');
  else if (dragonPungs === 2 && isDragon(shape.pair)) add(5, 'Small three dragons');

  if (!suits.size) add(10, 'All honours');
  else if (suits.size === 1 && !honors) add(7, 'Pure one suit');
  else if (suits.size === 1) add(3, 'Mixed one suit');
  if (all.every(t => isHonor(t) || isTerminal(t)) && suits.size) add(honors ? 4 : 10, honors ? 'Mixed orphans' : 'Pure orphans');

  if (pungs.length === 4) add(3, 'All pungs');
  else if (sets.every(s => s.type === 'chow') && !isDragon(shape.pair) && shape.pair !== seatW && shape.pair !== roundW) add(1, 'All chows');

  for (const s of pungs) {
    if (isDragon(s.tile)) add(1, `Pung of ${{ zC: 'red', zF: 'green', zP: 'white' }[s.tile]} dragons`);
    if (s.tile === seatW) add(1, 'Pung of your seat wind');
    if (s.tile === roundW) add(1, 'Pung of the prevailing wind');
  }
  if (ctx.selfDraw) add(1, 'Self-drawn');
  if (!exposed) add(1, 'Concealed hand');
  if (ctx.lastTile) add(1, ctx.selfDraw ? 'Won on the last tile of the wall' : 'Won on the last discard');
  if (ctx.kongReplacement) add(1, 'Won on a kong replacement');
  if (ctx.flowers) {
    const b = ctx.bonus || [];
    if (!b.length) add(1, 'No flowers or seasons');
    for (const t of b) if (Number(t[1]) === ctx.seatWind + 1) add(1, `Your own ${t[0] === 'f' ? 'flower' : 'season'}`);
    for (const set of ['f', 'g']) if (b.filter(t => t[0] === set).length === 4) add(2, set === 'f' ? 'All four flowers' : 'All four seasons');
  }
  void tiles;
  return total(items);
}
const total = (items) => {
  const faan = Math.min(LIMIT, items.reduce((a, x) => a + x.faan, 0));
  return { faan, items, limit: faan >= LIMIT };
};

// The best score any shape of this winning hand earns.
export function bestScore(shapes, ctx) {
  let best = null;
  for (const s of shapes) { const r = score(s, ctx); if (!best || r.faan > best.faan) best = { ...r, shape: s }; }
  return best;
}

// Points from faan: the base doubles with each faan, capped at 10.
// Self-drawn: each other player pays twice the base. On a discard: the
// discarder pays twice the base, the other two the base.
export const base = (faan) => 2 ** Math.min(faan, 10);
export function payments(faan, winner, discarder) {
  const b = base(faan), p = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) {
    if (s === winner) continue;
    const pay = discarder === null || discarder === undefined ? 2 * b : s === discarder ? 2 * b : b;
    p[s] -= pay; p[winner] += pay;
  }
  return p;
}
export { idx };
