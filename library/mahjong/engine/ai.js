// ai.js · opponents of adjustable strength, 1 (beginner) to 5 (sharp).
//
// Every choice is deterministic: where an AI "guesses" it draws from a
// generator seeded by the hand's seed, its seat and the move number, so a
// replay makes exactly the same choices. It sees only what its seat sees: its
// own tiles, every discard and every exposed meld.
//
//   1  discards mostly at random; claims whatever it can
//   2  moves towards a winning hand, but slips often
//   3  also counts how many unseen tiles would help (ukeire)
//   4  also plays for value (one suit, dragon and wind pairs) and defends
//      against a player who looks ready
//   5  as 4, without the slips, defending earlier
import { counts, idx, kind, isHonor, isDragon, suitOf, WINDS } from './tiles.js';
import { shanten } from './rules.js';
import { rngFrom } from './rng.js';
import { options, seatWind } from './game.js';

const SLIP = { 1: 70, 2: 25, 3: 10, 4: 3, 5: 0 };

function unseen(m, seat) {
  const u = new Array(34).fill(4);
  const see = (t) => { const i = idx(t); if (i !== undefined) u[i]--; };
  const h = m.hand;
  h.players[seat].concealed.forEach(see);
  for (const p of h.players) { p.discards.forEach(d => { if (!d.claimed) see(d.tile); }); p.melds.forEach(x => x.tiles.forEach(see)); }
  return u.map(x => Math.max(0, x));
}
function ukeire(c, mc, u) {
  const s = shanten(c, mc);
  let n = 0;
  for (let i = 0; i < 34; i++) { if (!u[i] || c[i] >= 4) continue; c[i]++; if (shanten(c, mc) < s) n += u[i]; c[i]--; }
  return n;
}
const valueTiles = (m, seat) => new Set(['zC', 'zF', 'zP', WINDS[seatWind(m, seat)], WINDS[m.round % 4]]);

// Players who look close to winning.
function threats(m, seat) {
  const h = m.hand, left = h.back - h.front;
  return [0, 1, 2, 3].filter(s => s !== seat && (h.players[s].melds.length >= 3 || (h.players[s].melds.length >= 2 && left < 40)));
}
function danger(m, t, who) {
  let d = 0;
  for (const s of who) {
    const safe = m.hand.players[s].discards.some(x => x.tile === t);
    if (!safe) d += isHonor(t) ? 1 : 3;
  }
  return d;
}

function chooseDiscard(m, seat, level, opts, rng) {
  const h = m.hand, p = h.players[seat], mc = p.melds.length;
  const discards = opts.filter(o => o.type === 'discard');
  if (rng.int(100) < (level === 1 ? 70 : 0)) return rng.pick(discards);
  const u = unseen(m, seat), vt = valueTiles(m, seat);
  const c = counts(p.concealed);
  // The suit the hand leans to, for the value-minded.
  const bySuit = { m: 0, p: 0, s: 0 };
  for (const t of p.concealed) if (!isHonor(t)) bySuit[suitOf(t)]++;
  for (const x of p.melds) if (!isHonor(x.tiles[0])) bySuit[suitOf(x.tiles[0])] += 3;
  const lean = Object.entries(bySuit).sort((a, b) => b[1] - a[1])[0];
  const flush = level >= 4 && lean[1] >= 8 ? lean[0] : null;
  const who = level >= 4 ? threats(m, seat) : [];
  const scored = discards.map(o => {
    const i = idx(o.tile); c[i]--;
    const sh = shanten(c, mc);
    let s = -sh * 10000;
    if (level >= 3) s += ukeire(c, mc, u) * 10;
    if (level >= 4) {
      if (flush && !isHonor(o.tile) && suitOf(o.tile) !== flush) s += 300;
      if (flush && suitOf(o.tile) === flush) s -= 150;
      if (vt.has(o.tile) && c[i] >= 1) s -= 250;                 // breaking a pair of value tiles
      if (isHonor(o.tile) && c[i] === 0 && u[i] <= 1) s += 60;  // a dead honour goes early
      if (who.length && (sh >= 2 || (level === 5 && sh >= 1))) s -= danger(m, o.tile, who) * 400;
    }
    c[i]++;
    return { o, s };
  }).sort((a, b) => b.s - a.s || (a.o.tile < b.o.tile ? -1 : 1));
  if (rng.int(100) < SLIP[level]) return scored[Math.min(scored.length - 1, rng.int(3))].o;
  const top = scored.filter(x => x.s === scored[0].s);
  return (level <= 2 ? rng.pick(top) : top[0]).o;
}

// Best shanten reachable after claiming and then discarding.
function afterClaim(p, take, addMeld) {
  const rest = p.concealed.slice();
  for (const t of take) rest.splice(rest.indexOf(t), 1);
  const c = counts(rest), mc = p.melds.length + addMeld;
  let best = 9;
  for (let i = 0; i < 34; i++) if (c[i]) { c[i]--; best = Math.min(best, shanten(c, mc)); c[i]++; }
  return best;
}

export function choose(m, seat, level = 3) {
  const opts = options(m, seat);
  if (!opts.length) return null;
  const h = m.hand, p = h.players[seat];
  const rng = rngFrom(`ai:${h.seed}:${seat}:${h.n}`);
  const win = opts.find(o => o.type === 'win');
  if (win) return win;
  if (h.stage === 'discard') {
    const kongs = opts.filter(o => o.type === 'kong');
    for (const k of kongs) {
      if (level === 1) return k;
      const c = counts(p.concealed), now = shanten(c, p.melds.length);
      const after = c.slice(); after[idx(k.tile)] = 0;
      if (shanten(after, p.melds.length + 1) <= now) return k;
    }
    return chooseDiscard(m, seat, level, opts, rng);
  }
  // A discard is on the table: claim it?
  const t = h.last.tile, c = counts(p.concealed), now = shanten(c, p.melds.length);
  const concealedHand = !p.melds.some(x => !x.concealed);
  const vt = valueTiles(m, seat);
  if (level === 1) { const claim = opts.filter(o => o.type !== 'pass'); return claim.length && rng.int(2) ? rng.pick(claim) : { type: 'pass' }; }
  const kong = opts.find(o => o.type === 'kong');
  if (kong && (level < 4 || vt.has(t) || !concealedHand)) return kong;
  const pung = opts.find(o => o.type === 'pung');
  if (pung) {
    const after = afterClaim(p, [t, t], 1);
    if (vt.has(t) && level >= 3) return pung;
    if (after < now || (level === 2 && after <= now)) { if (!(level >= 4 && concealedHand && now >= 3 && !vt.has(t))) return pung; }
  }
  const chows = opts.filter(o => o.type === 'chow');
  let best = null;
  for (const ch of chows) { const after = afterClaim(p, ch.tiles, 1); if (after < now && (!best || after < best.after)) best = { ch, after }; }
  if (best && !(level >= 4 && concealedHand && now >= 2)) return best.ch;
  return { type: 'pass' };
}
export { kind, isDragon };
