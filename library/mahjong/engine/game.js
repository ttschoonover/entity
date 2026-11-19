// game.js · a match of mahjong as a state machine with no hidden randomness.
//
// Each hand's wall is shuffled from that hand's seed, and nothing else is ever
// random, so a match is fully determined by its hand seeds and the decisions
// the players made. That is what lets the record, or any browser, replay a game
// and check it.
//
//   const m = newMatch({ rules, seats: ['human', 3, 3, 3] })   // a seat is 'human' or an AI level 1–5
//   startHand(m, handSeed)
//   pending(m)           → seats whose decision is needed now
//   options(m, seat)     → the legal actions for that seat
//   act(m, seat, action) → applies it, then plays on (draws, claims) until someone must decide
//   view(m, seat)        → what that seat may see
//
// Actions: { type: 'discard', tile } | { type: 'kong', tile } | { type: 'win' }
//          { type: 'pass' } | { type: 'chow', tiles: [a, b] } | { type: 'pung' } | { type: 'kong' } | { type: 'win' }
import { fullSet, isBonus, sortTiles, counts, idx, kind, isSuited, num, suitOf } from './tiles.js';
import { rngFrom, shuffle } from './rng.js';
import { winningShapes, bestScore, payments } from './rules.js';

export const DEFAULT_RULES = { minFaan: 0, flowers: true, rounds: 1, maxHands: 16 };

export function newMatch({ rules = {}, seats = ['human', 3, 3, 3], names } = {}) {
  return {
    rules: { ...DEFAULT_RULES, ...rules }, seats: seats.slice(0, 4), names: names || seats.map((s, i) => (s === 'human' ? `Player ${i + 1}` : `AI ${i + 1}`)),
    round: 0, dealer: 0, handNo: 0, scores: [0, 0, 0, 0], history: [], phase: 'ready', hand: null,
  };
}
export const seatWind = (m, seat) => (seat - m.dealer + 4) % 4;
const remove = (arr, t, n = 1) => { for (let k = 0; k < n; k++) { const i = arr.indexOf(t); if (i < 0) throw new Error(`no ${t} to remove`); arr.splice(i, 1); } };
const countOf = (arr, t) => arr.reduce((a, x) => a + (x === t), 0);
const left = (m) => m.hand.back - m.hand.front;

// ── dealing ─────────────────────────────────────────────────────────────────
export function startHand(m, seed) {
  if (m.phase === 'over') throw new Error('the match is over');
  const rng = rngFrom(`wall:${seed}`);
  const wall = shuffle(sortTiles(fullSet(m.rules.flowers)), rng);
  const h = m.hand = { seed, wall, front: 0, back: wall.length, players: [0, 1, 2, 3].map(() => ({ concealed: [], melds: [], bonus: [], discards: [] })),
    turn: m.dealer, dealer: m.dealer, round: m.round, stage: 'discard', drawn: null, last: null, decisions: {}, kongReplacement: false, result: null, n: 0, log: [] };
  for (let r = 0; r < 13; r++) for (let k = 0; k < 4; k++) h.players[(m.dealer + k) % 4].concealed.push(wall[h.front++]);
  h.players[m.dealer].concealed.push(wall[h.front++]);
  // Bonus tiles out, replaced from the back, the dealer first, until none remain.
  for (let k = 0; k < 4; k++) {
    const p = h.players[(m.dealer + k) % 4];
    for (let t; (t = p.concealed.find(isBonus));) { remove(p.concealed, t); p.bonus.push(t); if (left(m) <= 0) break; p.concealed.push(wall[--h.back]); }
  }
  for (const p of h.players) p.concealed = sortTiles(p.concealed);
  h.drawn = null; h.fresh = true;
  m.phase = 'play';
  return m;
}

// A tile from the front (or the back, as a replacement), flowers set aside.
function draw(m, seat, fromBack = false, afterKong = false) {
  const h = m.hand, p = h.players[seat];
  for (;;) {
    if (left(m) <= 0) return endHand(m, { type: 'draw' });
    const t = fromBack ? h.wall[--h.back] : h.wall[h.front++];
    if (isBonus(t)) { p.bonus.push(t); h.log.push({ seat, type: 'bonus', tile: t }); fromBack = true; continue; }
    p.concealed.push(t); p.concealed = sortTiles(p.concealed);
    h.drawn = t; h.turn = seat; h.stage = 'discard'; h.kongReplacement = afterKong;
    return m;
  }
}

// ── who must decide, and what they may do ───────────────────────────────────
export function pending(m) {
  if (m.phase !== 'play') return [];
  const h = m.hand;
  if (h.stage === 'discard') return [h.turn];
  return claimants(m).filter(s => !(s in h.decisions));
}
function claimants(m) {
  const h = m.hand, out = [];
  for (let k = 1; k < 4; k++) { const s = (h.last.from + k) % 4; if (claimOptions(m, s).length > 1) out.push(s); }
  return out;
}

function winScore(m, seat, concealed, selfDraw) {
  const h = m.hand, p = h.players[seat];
  const shapes = winningShapes(concealed, p.melds);
  if (!shapes.length) return null;
  return bestScore(shapes, { melds: p.melds, bonus: p.bonus, seatWind: seatWind(m, seat), roundWind: m.round % 4, selfDraw,
    lastTile: left(m) === 0, kongReplacement: selfDraw && h.kongReplacement, flowers: m.rules.flowers });
}

function turnOptions(m, seat) {
  const h = m.hand, p = h.players[seat], out = [];
  const w = h.drawn !== null || h.fresh ? winScore(m, seat, p.concealed, true) : null;
  if (w && w.faan >= m.rules.minFaan) out.push({ type: 'win' });
  if (left(m) > 0) {
    const c = counts(p.concealed);
    for (let i = 0; i < 34; i++) if (c[i] === 4) out.push({ type: 'kong', tile: kind(i) });
    for (const meld of p.melds) if (meld.type === 'pung' && p.concealed.includes(meld.tiles[0])) out.push({ type: 'kong', tile: meld.tiles[0] });
  }
  for (const t of [...new Set(p.concealed)]) out.push({ type: 'discard', tile: t });
  return out;
}

function claimOptions(m, seat) {
  const h = m.hand, p = h.players[seat], t = h.last.tile, out = [{ type: 'pass' }];
  const w = winScore(m, seat, [...p.concealed, t], false);
  if (w && w.faan >= m.rules.minFaan) out.push({ type: 'win' });
  const n = countOf(p.concealed, t);
  if (left(m) > 0) {
    if (n >= 2) out.push({ type: 'pung' });
    if (n >= 3) out.push({ type: 'kong' });
    if (seat === (h.last.from + 1) % 4 && isSuited(t)) {
      const s = suitOf(t), v = num(t), has = (x) => x >= 1 && x <= 9 && p.concealed.includes(s + x);
      for (const [a, b] of [[v - 2, v - 1], [v - 1, v + 1], [v + 1, v + 2]]) if (has(a) && has(b)) out.push({ type: 'chow', tiles: [s + a, s + b] });
    }
  }
  return out;
}

export function options(m, seat) {
  if (!pending(m).includes(seat)) return [];
  return m.hand.stage === 'discard' ? turnOptions(m, seat) : claimOptions(m, seat);
}
export const sameAction = (a, b) => a.type === b.type && (a.tile || null) === (b.tile || null) && JSON.stringify(a.tiles || null) === JSON.stringify(b.tiles || null);

// ── playing ─────────────────────────────────────────────────────────────────
export function act(m, seat, action) {
  const legal = options(m, seat);
  if (!legal.some(a => sameAction(a, action))) throw new Error(`seat ${seat} may not ${JSON.stringify(action)} now`);
  const h = m.hand, p = h.players[seat];
  h.n++;
  if (h.stage === 'discard') {
    h.fresh = false;
    if (action.type === 'win') return endHand(m, { type: 'win', winner: seat, from: null, ...winScore(m, seat, p.concealed, true) });
    if (action.type === 'kong') {
      const t = action.tile, meld = p.melds.find(x => x.type === 'pung' && x.tiles[0] === t);
      if (meld) { remove(p.concealed, t); meld.type = 'kong'; meld.tiles.push(t); }
      else { remove(p.concealed, t, 4); p.melds.push({ type: 'kong', tiles: [t, t, t, t], concealed: true, from: null }); }
      h.log.push({ seat, type: 'kong', tile: t, concealed: !meld });
      return draw(m, seat, true, true);
    }
    // A discard: others may claim it.
    remove(p.concealed, action.tile);
    p.discards.push({ tile: action.tile, claimed: false });
    h.last = { tile: action.tile, from: seat }; h.drawn = null; h.kongReplacement = false;
    h.log.push({ seat, type: 'discard', tile: action.tile });
    h.stage = 'claim'; h.decisions = {};
    return resolve(m);
  }
  h.decisions[seat] = action;
  return resolve(m);
}

// Once everyone who could claim has decided: a win, then a pung or kong, then a chow, else the next draw.
function resolve(m) {
  const h = m.hand;
  if (pending(m).length) return m;
  const order = [1, 2, 3].map(k => (h.last.from + k) % 4);
  const d = (s) => h.decisions[s];
  const winner = order.find(s => d(s)?.type === 'win');
  const t = h.last.tile, from = h.last.from;
  const take = () => { h.players[from].discards.at(-1).claimed = true; };
  if (winner !== undefined) {
    const p = h.players[winner];
    take();
    return endHand(m, { type: 'win', winner, from, ...winScore(m, winner, [...p.concealed, t], false), tile: t });
  }
  const big = order.find(s => ['pung', 'kong'].includes(d(s)?.type));
  if (big !== undefined) {
    const p = h.players[big], kong = d(big).type === 'kong';
    take(); remove(p.concealed, t, kong ? 3 : 2);
    p.melds.push({ type: kong ? 'kong' : 'pung', tiles: Array(kong ? 4 : 3).fill(t), concealed: false, from });
    h.log.push({ seat: big, type: kong ? 'kong' : 'pung', tile: t, from });
    h.last = null; h.decisions = {}; h.turn = big; h.stage = 'discard'; h.drawn = null;
    return kong ? draw(m, big, true, true) : m;
  }
  const chower = order.find(s => d(s)?.type === 'chow');
  if (chower !== undefined) {
    const p = h.players[chower], [a, b] = d(chower).tiles;
    take(); remove(p.concealed, a); remove(p.concealed, b);
    p.melds.push({ type: 'chow', tiles: sortTiles([a, t, b]), concealed: false, from });
    h.log.push({ seat: chower, type: 'chow', tile: t, tiles: [a, b], from });
    h.last = null; h.decisions = {}; h.turn = chower; h.stage = 'discard'; h.drawn = null;
    return m;
  }
  h.last = null; h.decisions = {};
  return draw(m, (from + 1) % 4);
}

// ── the end of a hand, and of the match ─────────────────────────────────────
function endHand(m, result) {
  const h = m.hand;
  if (result.type === 'win') {
    result.points = payments(result.faan, result.winner, result.from);
    for (let s = 0; s < 4; s++) m.scores[s] += result.points[s];
    result.hand = sortTiles(h.players[result.winner].concealed.concat(result.tile && result.from !== null ? [result.tile] : []));
  } else result.points = [0, 0, 0, 0];
  h.result = result; h.stage = 'over';
  m.history.push({ handNo: m.handNo, round: m.round, dealer: m.dealer, seed: h.seed, result: { ...result, items: result.items } });
  m.handNo++;
  // The dealer keeps the deal on a win or a draw; otherwise it passes, and a full turn of the table ends the round.
  const keeps = result.type === 'draw' || result.winner === m.dealer;
  if (!keeps) { m.dealer = (m.dealer + 1) % 4; if (m.dealer === 0) m.round++; }
  m.phase = m.round >= m.rules.rounds || m.handNo >= m.rules.maxHands ? 'over' : 'between';
  return m;
}

// ── what one seat may see ───────────────────────────────────────────────────
export function view(m, seat) {
  const h = m.hand;
  return {
    rules: m.rules, names: m.names, seats: m.seats, round: h ? h.round : m.round, dealer: h ? h.dealer : m.dealer, handNo: h && h.result ? m.handNo - 1 : m.handNo, scores: m.scores, phase: m.phase, me: seat,
    hand: h && {
      wallLeft: left(m), turn: h.turn, stage: h.stage, last: h.last, drawn: h.turn === seat ? h.drawn : null, result: h.result,
      players: h.players.map((p, s) => ({ melds: p.melds.map(x => (x.concealed && s !== seat && !h.result ? { ...x, tiles: x.tiles.map((t, i) => (i === 0 || i === 3 ? 'back' : t)) } : x)),
        bonus: p.bonus, discards: p.discards, size: p.concealed.length, concealed: s === seat || h.result ? p.concealed : null })),
      log: h.log.slice(-30),
    },
    options: options(m, seat), pending: pending(m),
  };
}
export { idx };
