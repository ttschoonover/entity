// mahjong · Hong Kong mahjong on the record: solo games against the AI that
// count towards a member's profile, and the results of multiplayer tables.
//
// Nothing here trusts a claimed score. The engine (./engine) is deterministic,
// so the module replays every game from its seeds and the human decisions and
// computes the result itself.
//
// Solo, for a profile:
//   mahjong.deal    { opponents: [l, l, l], rules? }   starts a game; its shuffle
//                   comes from the hash of this record, which nobody knew in advance
//   mahjong.finish  { game, moves }                    the player's decisions, in order;
//                   replayed here against the same AIs; the result goes on the profile
// A game dealt and never finished counts as unfinished on the profile.
//
// Multiplayer (a world's tables, played live through its node, see cli/mahjong.js):
//   mahjong.result  { table, seats, names, players, rules, seeds, commits, moves }
//                   signed by the world's keeper (mahjong.keeper, else the founder).
//                   Every hand's seed must match the commitment published before it
//                   was dealt; the match is replayed; scores go to members' profiles.
import { actId } from '../../kernel/signed.js';
import { hash } from '../../kernel/hash.js';
import { Parameters } from '../../kernel/parameters.js';
import { replay, handSeed, DEFAULT_RULES } from './engine/index.js';

const P = (state) => new Parameters(state.doc, state.catalog);
export const gameId = (act) => 'mj-' + actId(act).slice(0, 10);
const book = (state) => (state.m.mahjong ||= { games: {}, matches: {}, profiles: {} });
const LEVEL = (x) => Number.isInteger(x) && x >= 1 && x <= 5;

export function checkRules(r = {}) {
  if (typeof r !== 'object' || Array.isArray(r)) return 'rules is an object';
  const bad = Object.keys(r).filter(k => !['minFaan', 'flowers', 'rounds'].includes(k));
  if (bad.length) return `unknown rules: ${bad.join(', ')}`;
  if (r.minFaan !== undefined && ![0, 1, 3].includes(r.minFaan)) return 'minFaan is 0, 1 or 3';
  if (r.flowers !== undefined && typeof r.flowers !== 'boolean') return 'flowers is true or false';
  if (r.rounds !== undefined && ![1, 2, 4].includes(r.rounds)) return 'rounds is 1 (East only), 2 or 4';
  return null;
}
const rulesOf = (r = {}) => ({ ...DEFAULT_RULES, ...r, maxHands: 8 * (r.rounds || 1) });

// Replays are pure: remember them, so a check and its reduce replay once.
const cache = new Map();
function replayed(key, input) {
  if (cache.has(key)) return cache.get(key);
  const r = replay(input);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(key, r);
  return r;
}
const soloInput = (g, moves) => ({ rules: g.rules, seats: g.seats, seeds: Array.from({ length: g.rules.maxHands }, (_, i) => handSeed(g.seed, i)), moves: [moves, [], [], []] });

// Ranks by final score, 1 = best; ties share a rank.
export const ranks = (scores) => scores.map(s => 1 + scores.filter(x => x > s).length);

function credit(state, id, { score, rank, levels, best, mode, ref, at }) {
  const pr = (book(state).profiles[id] ||= { games: 0, wins: 0, points: 0, best: null, byLevel: {}, multiplayer: 0, recent: [] });
  pr.games++; pr.points += score; if (rank === 1) pr.wins++;
  if (mode === 'table') pr.multiplayer++;
  const lv = String(Math.max(...levels, 0) || 'humans');
  const b = (pr.byLevel[lv] ||= { games: 0, wins: 0 }); b.games++; if (rank === 1) b.wins++;
  if (best && (!pr.best || best.faan > pr.best.faan)) pr.best = best;
  pr.recent.unshift({ ref, at, mode, score, rank }); pr.recent = pr.recent.slice(0, 20);
}
function bestHand(match, seat) {
  let best = null;
  for (const h of match.history) if (h.result.type === 'win' && h.result.winner === seat && (!best || h.result.faan > best.faan)) best = { faan: h.result.faan, items: h.result.items.map(x => x.why), hand: h.result.hand };
  return best;
}

function install(r) {
  const member = (state, id) => state.participants[id]?.status === 'active';

  r.registerKind({
    name: 'mahjong.deal', module: 'mahjong',
    check(state, a) {
      if (!member(state, a.by)) return 'only members keep a profile';
      if (!Array.isArray(a.opponents) || a.opponents.length !== 3 || !a.opponents.every(LEVEL)) return 'opponents is three AI levels, each 1 to 5';
      return checkRules(a.rules);
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = gameId(a);
      book(state).games[id] = { id, by: a.by, at: rec.at, seats: ['human', ...a.opponents], rules: rulesOf(a.rules), seed: rec.hash, status: 'playing' };
    },
  });

  r.registerKind({
    name: 'mahjong.finish', module: 'mahjong',
    check(state, a, { params }) {
      const g = state.m.mahjong?.games?.[a.game];
      if (!g) return `there is no game ${a.game}`;
      if (g.by !== a.by) return 'only its player finishes a game';
      if (g.status !== 'playing') return 'this game is already finished';
      if (!Array.isArray(a.moves) || a.moves.length > params.value('mahjong.max_moves')) return `moves is the list of your decisions, at most ${params.value('mahjong.max_moves')}`;
      const res = replayed(`solo:${a.game}:${hash(JSON.stringify(a.moves))}`, soloInput(g, a.moves));
      if (res.error) return `the game does not replay: ${res.error}`;
      return res.complete ? null : 'the game is not over yet: play it to the end';
    },
    reduce(state, rec) {
      const a = rec.payload.act, g = state.m.mahjong.games[a.game];
      const { match } = replayed(`solo:${a.game}:${hash(JSON.stringify(a.moves))}`, soloInput(g, a.moves));
      const rk = ranks(match.scores);
      Object.assign(g, { status: 'finished', finished: rec.at, scores: match.scores, rank: rk[0], hands: match.history.length,
        won: match.history.filter(h => h.result.type === 'win' && h.result.winner === 0).length });
      credit(state, g.by, { score: match.scores[0], rank: rk[0], levels: g.seats.slice(1), best: bestHand(match, 0), mode: 'solo', ref: g.id, at: rec.at });
    },
  });

  r.registerKind({
    name: 'mahjong.result', module: 'mahjong',
    check(state, a, { params }) {
      const keeper = params.value('mahjong.keeper') || state.entity.founder;
      if (a.by !== keeper) return `only the world's keeper (${keeper}) records table results`;
      if (typeof a.table !== 'string' || !/^[a-z0-9-]{3,60}$/.test(a.table)) return 'table is an id';
      if (state.m.mahjong?.matches?.[a.table]) return `table ${a.table} is already recorded`;
      if (!Array.isArray(a.seats) || a.seats.length !== 4 || !a.seats.every(s => s === 'human' || LEVEL(s))) return 'seats is four entries: "human" or an AI level';
      const bad = checkRules(a.rules); if (bad) return bad;
      if (!Array.isArray(a.seeds) || !Array.isArray(a.commits) || a.seeds.length !== a.commits.length || !a.seeds.length) return 'every hand needs its seed and its commitment';
      for (let i = 0; i < a.seeds.length; i++) if (hash(String(a.seeds[i])) !== a.commits[i]) return `hand ${i + 1}: the seed does not match what was committed before the deal`;
      if (!Array.isArray(a.moves) || a.moves.length !== 4 || a.moves.flat().length > params.value('mahjong.max_moves') * 4) return 'moves is four lists of decisions, one per seat';
      if (!Array.isArray(a.players) || a.players.length !== 4) return 'players is four entries, one per seat';
      for (const pl of a.players) if (pl && pl.id && !state.participants[pl.id]) return `${pl.id} is not a member`;
      const res = replayed(`table:${a.table}:${hash(JSON.stringify([a.seeds, a.moves]))}`, { rules: rulesOf(a.rules), seats: a.seats, seeds: a.seeds, moves: a.moves });
      if (res.error) return `the table does not replay: ${res.error}`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      const { match, complete } = replayed(`table:${a.table}:${hash(JSON.stringify([a.seeds, a.moves]))}`, { rules: rulesOf(a.rules), seats: a.seats, seeds: a.seeds, moves: a.moves });
      const rk = ranks(match.scores);
      book(state).matches[a.table] = { table: a.table, at: rec.at, seats: a.seats, names: a.names || [], players: a.players, scores: match.scores, ranks: rk,
        hands: match.history.length, complete, rules: rulesOf(a.rules) };
      a.players.forEach((pl, s) => {
        if (pl?.id && a.seats[s] === 'human') credit(state, pl.id, { score: match.scores[s], rank: rk[s], levels: a.seats.filter(x => x !== 'human'), best: bestHand(match, s), mode: 'table', ref: a.table, at: rec.at });
      });
    },
  });
}

export default { name: 'mahjong', core: '0.7.7', install, gameId, ranks, checkRules, parameterKeys: ['mahjong.keeper', 'mahjong.max_moves'] };
