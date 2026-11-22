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

test('elections: direct, every member a candidate and voting at once; one may decline; one person may hold two offices', async () => {
  const w = await worldWith(['offices', 'elections'], { people: 4 });
  const r = await decide(w, { title: 'Two officers, elected directly', rule: 'organic', effects: [
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 1 },
    { kind: 'office.create', office: 'secretary', title: 'Secretary', seats: 1 },
    { kind: 'election.call', election: 't-1', office: 'treasurer', direct: true, vote_days: 7 },
    { kind: 'election.call', election: 's-1', office: 'secretary', direct: true, vote_days: 7 }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const e = w.state.m.elections['t-1'];
  assert.deepEqual(Object.keys(e.candidates).sort(), ['p-0001', 'p-0002', 'p-0003', 'p-0004'], 'every member stands');
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  assert.match((await act('election.stand', 'p-0001', { election: 't-1' })).refused[0].reason, /candidacy .* closed|already standing/);
  assert.equal((await act('election.withdraw', 'p-0004', { election: 't-1' })).applied.length, 1, 'a member may decline');
  for (const v of ['p-0001', 'p-0002', 'p-0003']) {
    assert.equal((await act('election.vote', v, { election: 't-1', choices: ['p-0002'] })).applied.length, 1);
    assert.equal((await act('election.vote', v, { election: 's-1', choices: ['p-0002'] })).applied.length, 1);
  }
  assert.match((await act('election.vote', 'p-0003', { election: 't-1', choices: ['p-0004'] })).refused[0].reason, /choose among the candidates/);
  w.jump(7.5);
  for (const id of ['t-1', 's-1']) assert.equal((await act('election.count', 'p-0001', { election: id })).applied.length, 1);
  const holds = (o) => w.state.m.offices[o].holders.filter(h => !h.until).map(h => h.id);
  assert.deepEqual([holds('treasurer'), holds('secretary')], [['p-0002'], ['p-0002']], 'one person holds both, as nothing forbids it');
  // stand_days is refused on a direct election.
  const bad = await decide(w, { title: 'Bad', rule: 'organic', effects: [{ kind: 'election.call', election: 't-2', office: 'treasurer', direct: true, stand_days: 3, vote_days: 3 }] });
  assert.notEqual(bad.enacted, true);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});
