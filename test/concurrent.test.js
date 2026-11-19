// Concurrent majorities: a rule that counts the same ballots twice, once per
// person and once per share, and carries only if both counts carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide, propose, vote } from './helpers.js';

const extra = { rules: { joint: { quorum: 0.5, threshold: 0.5, readings: 1, concurrent: 'shares:units' } },
  order: ['ordinary', 'joint', 'organic', 'constitutional', 'entrenched'] };

test('concurrent: a joint rule needs a majority of people and of units', async () => {
  const w = await worldWith(['shares'], { people: 3, extra });
  const [a, b, c] = w.ids;
  assert.deepEqual(w.state.doc.amendment.order, extra.order);
  const r = await (await import('./helpers.js')).enact(w, { title: 'Units', rule: 'constitutional', effects: [
    { kind: 'share.class', class: 'units', title: 'Partnership units', voting: true, transferable: false },
    { kind: 'share.issue', class: 'units', to: a, count: 70 }, { kind: 'share.issue', class: 'units', to: b, count: 15 }, { kind: 'share.issue', class: 'units', to: c, count: 15 }] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);

  // a alone holds 70 units: most of the stake, but only one person in three.
  const p1 = await propose(w, a, { title: 'A by units alone', rule: 'joint', effects: [] });
  assert.equal(p1.refused.length, 0, p1.refused[0]?.reason);
  await vote(w, p1.id, a, 'for'); await vote(w, p1.id, b, 'against'); await vote(w, p1.id, c, 'against');
  const x = w.state.proposals[p1.id];
  assert.equal(x.closed.carried, false);
  assert.equal(x.closed.tally.concurrent.for, 70);

  // b and c: two people in three, but 30 units of 100.
  const p2 = await propose(w, b, { title: 'By heads alone', rule: 'joint', effects: [] });
  await vote(w, p2.id, b, 'for'); await vote(w, p2.id, c, 'for'); await vote(w, p2.id, a, 'against');
  assert.equal(w.state.proposals[p2.id].closed.carried, false);

  // a and b: two people in three, and 85 units: carried, and closes as soon as it cannot fail.
  const p3 = await propose(w, a, { title: 'Both', rule: 'joint', effects: [] });
  await vote(w, p3.id, a, 'for'); await vote(w, p3.id, b, 'for');
  const y = w.state.proposals[p3.id];
  assert.equal(y.closed?.carried, true);
  assert.equal(y.closed.closedEarly, true);
  // An ordinary motion is counted once, per person, as before.
  const p4 = await propose(w, b, { title: 'Heads', rule: 'ordinary', effects: [] });
  assert.equal(w.state.proposals[p4.id].concurrent, undefined);
});
