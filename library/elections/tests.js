import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../../kernel/index.js';
import { worldWith, decide } from '../../test/helpers.js';
import elections from './index.js';

async function setup(method, seats, people = 6) {
  const w = await worldWith(['offices', 'elections'], { people });
  const r = await decide(w, { title: 'A board, elected', rule: 'organic', effects: [
    { kind: 'office.create', office: 'board', title: 'Board', seats: 2 },
    { kind: 'office.fill', office: 'board', holder: `p-000${people}` },
    { kind: 'election.call', election: 'board-1', office: 'board', seats, method, stand_days: 3, vote_days: 3 }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, { election: 'board-1', ...f }));
  return { w, act };
}

test('elections: candidacy, then voting, then a count that replaces the holders', async () => {
  const { w, act } = await setup('approval', 2);
  for (const c of ['p-0001', 'p-0002', 'p-0003']) assert.equal((await act('election.stand', c, {})).applied.length, 1);
  assert.match((await act('election.vote', 'p-0004', { choices: ['p-0001'] })).refused[0].reason, /voting opens after/);
  w.jump(3.5);
  assert.match((await act('election.stand', 'p-0004', {})).refused[0].reason, /candidacy .* closed/);
  await act('election.vote', 'p-0004', { choices: ['p-0001', 'p-0002'] });
  await act('election.vote', 'p-0005', { choices: ['p-0001'] });
  await act('election.vote', 'p-0006', { choices: ['p-0003'] });
  assert.match((await act('election.vote', 'p-0005', { choices: ['p-0009'] })).refused[0].reason, /choose among the candidates/);
  assert.match((await act('election.count', 'p-0001', {})).refused[0].reason, /voting is open/);
  w.jump(3);
  const c = await act('election.count', 'p-0004', {});
  assert.equal(c.applied.length, 1, c.refused[0]?.reason);
  const e = w.state.m.elections['board-1'];
  assert.equal(e.counted.enacted, true, e.counted.notEnacted);
  assert.equal(e.counted.winners[0], 'p-0001');
  assert.equal(e.counted.winners.length, 2, 'a tie between p-0002 and p-0003 broken by the published hash');
  const board = w.state.m.offices.board.holders.filter(h => !h.until || h.until > w.state.head.at).map(h => h.id).sort();
  assert.deepEqual(board, [...e.counted.winners].sort(), 'the old holder is vacated and the winners appointed');
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('elections: ranked ballots transfer by instant runoff', () => {
  const e = { id: 'x', method: 'ranked', seats: 1, candidates: { a: {}, b: {}, c: {} }, ballots: {
    v1: ['a', 'b'], v2: ['a'], v3: ['b', 'a'], v4: ['c'], v5: ['c'], v6: ['a'], v7: ['c'] } };
  // First preferences a 3, b 1, c 3 of 7: no majority. b is out and v3 moves to a: a 4 of 7.
  assert.deepEqual(elections.count(e).winners, ['a']);
  const two = { ...e, seats: 2 };
  assert.deepEqual(elections.count(two).winners, ['a', 'c'], 'the next seat runs again without the winner');
  const weighted = { ...e, weights: { v1: 1, v2: 1, v3: 1, v4: 10, v5: 1, v6: 1, v7: 1 } };
  assert.deepEqual(elections.count(weighted).winners, ['c']);
});

test('elections: nobody elected, nothing changes', async () => {
  const { w, act } = await setup('ranked', 1, 3);
  w.jump(7);
  await act('election.count', 'p-0001', {});
  const e = w.state.m.elections['board-1'];
  assert.equal(e.counted.enacted, false);
  assert.equal(e.counted.notEnacted, 'nobody was elected');
});
