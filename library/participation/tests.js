import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, enact, decide } from '../../test/helpers.js';
import participation from './index.js';

test('participation: standing read from votes; a notice only to a partner below the minimum, once per cure period', async () => {
  const w = await worldWith(['participation'], { people: 4 });
  // Count from the start: no grace period, a short window.
  assert.ok((await enact(w, { title: 'Strict', rule: 'organic', changes: { 'participation.grace_days': 0, 'participation.window_votes': 4 } })).enacted);
  // p-0004 never votes on the next four proposals.
  for (let i = 0; i < 4; i++) {
    const r = await decide(w, { title: `Motion ${i}`, rule: 'ordinary' });
    w.jump(8);
    assert.ok(w.state.proposals[r.id].closed, 'closed');
  }
  const at = w.at();
  const s4 = participation.standing(w.state, 'p-0004', at), s1 = participation.standing(w.state, 'p-0001', at);
  assert.equal(s1.ok, true);
  assert.equal(s4.ok, false); assert.equal(s4.votes.of, 4);
  const notice = async (member) => decide(w, { title: `Notice ${member}`, rule: 'ordinary', effects: [{ kind: 'participation.notice', member, reason: 'missed votes' }] });
  assert.match((await notice('p-0001')).refused?.[0]?.reason || '', /meets the participation minimum/);
  const n = await notice('p-0004');
  assert.ok(n.enacted, n.notEnacted);
  assert.equal(w.state.m.participation.notices.at(-1).member, 'p-0004');
  assert.match((await notice('p-0004')).refused?.[0]?.reason || '', /already has a notice/);
  w.jump(31);
  assert.equal(participation.standing(w.state, 'p-0004', w.at()).cureOver, true);
});
