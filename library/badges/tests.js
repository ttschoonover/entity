import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import badges from './index.js';

test('badges: created and awarded by decision, revoked with a reason, given back by the holder', async () => {
  const w = await worldWith(['badges']);
  const r = await decide(w, { title: 'Founders', rule: 'ordinary', effects: [
    { kind: 'badge.create', badge: 'founder', title: 'Founding member' },
    { kind: 'badge.award', badge: 'founder', to: 'p-0001' }, { kind: 'badge.award', badge: 'founder', to: 'p-0002', note: 'wrote the charter' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.deepEqual(badges.badgesOf(w.state, 'p-0002').map(b => b.id), ['founder']);
  assert.match((await decide(w, { title: 'Again', rule: 'ordinary', effects: [{ kind: 'badge.award', badge: 'founder', to: 'p-0001' }] })).refused[0].reason, /already holds/);
  await decide(w, { title: 'Take it', rule: 'ordinary', effects: [{ kind: 'badge.revoke', badge: 'founder', from: 'p-0001', reason: 'error' }] });
  assert.equal(badges.holds(w.state, 'founder', 'p-0001'), false);
  assert.equal((await w.settle(await w.sign('badge.return', 'p-0002', { badge: 'founder' }))).applied.length, 1);
  assert.match(w.state.m.badges.founder.history.map(x => x.how).join('|'), /awarded by decision d-.*revoked by decision d-.*: error.*given back/);
});
