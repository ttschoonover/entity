import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import lending from './index.js';

test('lending: the entity lends what it holds; due dates, renewals, limits, recall', async () => {
  const w = await worldWith(['deeds', 'lending']);
  await decide(w, { title: 'Things', rule: 'ordinary', changes: { 'lending.except': ['server'], 'lending.max_per_member': 1 }, effects: [
    { kind: 'deed.grant', deed: 'bike', title: 'Cargo bike', to: null },
    { kind: 'deed.grant', deed: 'drill', title: 'Drill', to: null },
    { kind: 'deed.grant', deed: 'server', title: 'The server', to: null },
    { kind: 'deed.grant', deed: 'room-3', title: 'Room 3', to: 'p-0003' }] });
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  assert.match((await act('loan.borrow', 'p-0002', { deed: 'room-3' })).refused[0].reason, /held by p-0003/);
  assert.match((await act('loan.borrow', 'p-0002', { deed: 'server' })).refused[0].reason, /not lent out/);
  assert.equal((await act('loan.borrow', 'p-0002', { deed: 'bike', days: 3 })).applied.length, 1);
  assert.match((await act('loan.borrow', 'p-0001', { deed: 'bike' })).refused[0].reason, /out with p-0002/);
  assert.match((await act('loan.borrow', 'p-0002', { deed: 'drill' })).refused[0].reason, /the limit is 1/);
  assert.match((await act('loan.borrow', 'p-0001', { deed: 'drill', days: 99 })).refused[0].reason, /days is a whole number from 1 to 30/);
  assert.equal((await act('loan.renew', 'p-0002', { deed: 'bike', days: 5 })).applied.length, 1);
  assert.match((await act('loan.renew', 'p-0002', { deed: 'bike' })).refused[0].reason, /renewed 1 time/);
  w.jump(9);
  assert.equal(lending.overdue(lending.current(w.state, 'bike'), w.at()), true);
  assert.match((await act('loan.return', 'p-0001', { deed: 'bike' })).refused[0].reason, /you have not borrowed bike/);
  await act('loan.return', 'p-0002', { deed: 'bike' });
  assert.equal(w.state.m.lending.loans[0].how, 'returned late');
  await act('loan.borrow', 'p-0001', { deed: 'drill' });
  const r = await decide(w, { title: 'Need it back', rule: 'ordinary', effects: [{ kind: 'loan.recall', deed: 'drill', reason: 'repairs' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.match(w.state.m.lending.loans[1].how, /^recalled by decision d-.*: repairs$/);
  assert.equal(lending.current(w.state, 'drill'), null);
});
