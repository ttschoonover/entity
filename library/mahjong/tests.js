// Mahjong: the engine (winning hands, shanten, scoring, determinism, replay),
// solo games that go on a profile only when they replay, and multiplayer
// results whose seeds must match their commitments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith } from '../../test/helpers.js';
import mahjong from './index.js';
import * as M from './engine/index.js';
import { hash } from '../../kernel/hash.js';

const act = async (w, kind, by, fields = {}) => w.settle(await w.sign(kind, by, fields));
const ok = (r) => assert.equal(r.applied.length, 1, r.refused[0]?.reason);
const no = (r, re) => { assert.equal(r.applied.length, 0); assert.match(r.refused[0].reason, re); };

// Play a match where the "human" seats are driven by an AI, recording their decisions.
function playAs(seats, seeds, rules = {}, policy = 4) {
  const m = M.newMatch({ seats, rules: { ...M.DEFAULT_RULES, ...rules } });
  const moves = [[], [], [], []];
  let i = 0;
  while (m.phase !== 'over') {
    if (m.phase !== 'play') { if (i >= seeds.length) break; M.startHand(m, seeds[i++]); }
    M.runAI(m);
    for (const s of M.pending(m)) if (seats[s] === 'human' && M.pending(m).includes(s)) { const a = M.choose(m, s, policy); moves[s].push(a); M.act(m, s, a); }
  }
  return { m, moves };
}

test('mahjong engine: winning hands, shanten, scoring', () => {
  const tiles = (s) => s.split(' ');
  assert.equal(M.winningShapes(tiles('m1 m2 m3 m4 m5 m6 m7 m8 m9 p2 p2 p2 zC zC'), []).length, 1);
  assert.equal(M.winningShapes(tiles('m1 m9 p1 p9 s1 s9 zE zS zW zN zC zF zP zP'), [])[0].special, 'thirteen-orphans');
  assert.equal(M.winningShapes(tiles('m1 m2 m3 m4 m5 m6 m7 m8 m9 p2 p2 p2 zC zF'), []).length, 0);
  const c = (s) => { const x = new Array(34).fill(0); for (const t of tiles(s)) x[M.idx(t)]++; return x; };
  assert.equal(M.shanten(c('m1 m2 m3 m4 m5 m6 m7 m8 m9 p2 p2 p2 zC'), 0), 0);   // ready, waiting on red dragon
  assert.equal(M.shanten(c('m1 m2 m3 m4 m5 m6 m7 m8 m9 p2 p2 p2 zC zC'), 0), -1);
  // Pure one suit, all pungs and a dragon: a big hand.
  const shape = M.winningShapes(tiles('m1 m1 m1 m4 m4 m4 m7 m7 m7 m9 m9'), [{ type: 'pung', tiles: ['m2', 'm2', 'm2'], concealed: false }])[0];
  const r = M.score(shape, { melds: [{ type: 'pung', tiles: ['m2', 'm2', 'm2'], concealed: false }], bonus: ['f1'], seatWind: 0, roundWind: 0, selfDraw: true, flowers: true });
  assert.ok(r.items.some(x => x.why === 'Pure one suit') && r.items.some(x => x.why === 'All pungs') && r.items.some(x => x.why === 'Your own flower'));
  assert.equal(r.faan, 7 + 3 + 1 + 1);
  assert.deepEqual(M.payments(2, 1, 3), [-4, 16, -4, -8]);   // base 4: the discarder pays 8, the others 4
  assert.deepEqual(M.payments(2, 1, null), [-8, 24, -8, -8]); // self-drawn: everyone pays 8
});

test('mahjong engine: the same seeds and decisions always replay to the same match', () => {
  const seeds = Array.from({ length: 8 }, (_, i) => M.handSeed('determinism', i));
  const a = playAs(['human', 3, 2, 4], seeds);
  const b = M.replay({ rules: M.DEFAULT_RULES, seats: ['human', 3, 2, 4], seeds, moves: a.moves });
  assert.equal(b.error, null);
  assert.equal(b.complete, true);
  assert.deepEqual(b.match.scores, a.m.scores);
  assert.equal(b.match.scores.reduce((x, y) => x + y, 0), 0);
  // One changed decision either fails to replay or changes the match.
  const bent = a.moves.map(q => q.slice()); const k = bent[0].findIndex(x => x.type === 'discard');
  bent[0][k] = { type: 'discard', tile: 'zC' };
  const c = M.replay({ rules: M.DEFAULT_RULES, seats: ['human', 3, 2, 4], seeds, moves: bent });
  assert.ok(c.error || JSON.stringify(c.match.scores) !== JSON.stringify(a.m.scores));
});

test('mahjong: a solo game counts on the profile only once it replays', async () => {
  const w = await worldWith(['mahjong'], { people: 2 });
  const [a, b] = w.ids;
  no(await act(w, 'mahjong.deal', a, { opponents: [3, 3, 9] }), /1 to 5/);
  no(await act(w, 'mahjong.deal', a, { opponents: [3, 3, 3], rules: { minFaan: 2 } }), /minFaan/);
  const deal = await w.sign('mahjong.deal', a, { opponents: [2, 3, 4], rules: { rounds: 1 } });
  ok(await w.settle(deal));
  const id = mahjong.gameId(deal), g = w.state.m.mahjong.games[id];
  assert.equal(g.seed.length, 64);
  const seeds = Array.from({ length: g.rules.maxHands }, (_, i) => M.handSeed(g.seed, i));
  const { m, moves } = playAs(g.seats, seeds, g.rules);
  no(await act(w, 'mahjong.finish', b, { game: id, moves: moves[0] }), /only its player/);
  no(await act(w, 'mahjong.finish', a, { game: id, moves: moves[0].slice(0, 5) }), /not over yet/);
  const bent = moves[0].slice(); bent[0] = { type: 'discard', tile: 'zX' }; // no such tile: a move the replay must refuse, whatever the deal
  const bad = await act(w, 'mahjong.finish', a, { game: id, moves: bent });
  assert.equal(bad.applied.length, 0);
  ok(await act(w, 'mahjong.finish', a, { game: id, moves: moves[0] }));
  const pr = w.state.m.mahjong.profiles[a];
  assert.equal(pr.games, 1);
  assert.equal(pr.points, m.scores[0]);
  assert.equal(w.state.m.mahjong.games[id].status, 'finished');
  no(await act(w, 'mahjong.finish', a, { game: id, moves: moves[0] }), /already finished/);
});

test('mahjong: a table result is recorded by the keeper, with seeds that match their commitments', async () => {
  const w = await worldWith(['mahjong'], { people: 3 });
  const [keeper, x, y] = w.ids;
  const seeds = Array.from({ length: 8 }, (_, i) => hash(`secret:${i}`));
  const seats = ['human', 'human', 3, 5];
  const { m, moves } = playAs(seats, seeds);
  const used = m.history.length, s = seeds.slice(0, used);
  const fields = { table: 'friday-night', seats, names: ['Ana', 'Ben', 'AI', 'AI'], players: [{ id: x, name: 'Ana' }, { name: 'Ben', key: 'guest' }, null, null],
    rules: {}, seeds: s, commits: s.map(z => hash(z)), moves };
  no(await act(w, 'mahjong.result', x, fields), /keeper/);
  no(await act(w, 'mahjong.result', keeper, { ...fields, commits: fields.commits.map((c, i) => (i ? c : hash('other'))) }), /does not match what was committed/);
  ok(await act(w, 'mahjong.result', keeper, fields));
  assert.deepEqual(w.state.m.mahjong.matches['friday-night'].scores, m.scores);
  assert.equal(w.state.m.mahjong.profiles[x].multiplayer, 1);
  assert.equal(w.state.m.mahjong.profiles[y], undefined);
  no(await act(w, 'mahjong.result', keeper, fields), /already recorded/);
});
