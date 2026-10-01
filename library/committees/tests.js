import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide, enact, propose, vote } from '../../test/helpers.js';
import committees from './index.js';

test('committees: created and filled by decision; seats; leaving; dissolving', async () => {
  const w = await worldWith(['committees'], { people: 4 });
  const r = await decide(w, { title: 'Maintenance', rule: 'organic', effects: [
    { kind: 'committee.create', committee: 'maintenance', title: 'Maintenance Committee', seats: 2, remit: 'Repairs under 500' },
    { kind: 'committee.appoint', committee: 'maintenance', member: 'p-0002' },
    { kind: 'committee.appoint', committee: 'maintenance', member: 'p-0003' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const c = w.state.m.committees.maintenance;
  assert.deepEqual(committees.members(c, w.at()), ['p-0002', 'p-0003']);
  assert.equal(c.needs, 'majority');
  const full = await decide(w, { title: 'Third', rule: 'ordinary', effects: [{ kind: 'committee.appoint', committee: 'maintenance', member: 'p-0004' }] });
  assert.match(full.refused[0].reason, /all 2 seats/);
  assert.equal((await w.settle(await w.sign('committee.leave', 'p-0003', { committee: 'maintenance' }))).applied.length, 1);
  assert.deepEqual(committees.members(w.state.m.committees.maintenance, w.at()), ['p-0002']);
  const bad = await decide(w, { title: 'Bad rule', rule: 'organic', effects: [{ kind: 'committee.create', committee: 'x', title: 'X', needs: 'most' }] });
  assert.match(bad.refused[0].reason, /majority/);
  await decide(w, { title: 'Done', rule: 'organic', effects: [{ kind: 'committee.dissolve', committee: 'maintenance' }] });
  assert.ok(w.state.m.committees.maintenance.dissolved);
  assert.deepEqual(committees.members(w.state.m.committees.maintenance, w.at()), []);
});

test('committees: a committee can be made the electorate (rule by a party or council)', async () => {
  const w = await worldWith(['committees'], { people: 4 });
  const r = await enact(w, { title: 'The committee decides', rule: 'entrenched', changes: { 'decision.electorate': 'committee:central' }, effects: [
    { kind: 'committee.create', committee: 'central', title: 'Central Committee' },
    { kind: 'committee.appoint', committee: 'central', member: 'p-0001' },
    { kind: 'committee.appoint', committee: 'central', member: 'p-0004' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const { id } = await propose(w, 'p-0002', { title: 'Five days', rule: 'organic', changes: { 'deliberation.period': 5 } });
  assert.deepEqual(w.state.proposals[id].roll, ['p-0001', 'p-0004']);
  await vote(w, id, 'p-0001'); await vote(w, id, 'p-0004');
  assert.equal(w.state.proposals[id].enacted, true);
});
