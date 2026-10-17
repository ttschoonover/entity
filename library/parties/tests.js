// Parties: founding, joining (open and by approval), one party at a time,
// leadership by hand-over or by a majority of members, the party electorate
// with its cooling-off period, dissolution by decision, and seat allocation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide, enact } from '../../test/helpers.js';
import parties, { allocate } from './index.js';

const act = async (w, kind, by, fields) => (await w.settle(await w.sign(kind, by, fields)));
const ok = (r) => assert.equal(r.applied.length, 1, r.refused[0]?.reason);
const no = (r, re) => { assert.equal(r.applied.length, 0); assert.match(r.refused[0].reason, re); };

test('parties: found, join, one at a time, leave, leadership, registration', async () => {
  const w = await worldWith(['parties'], { people: 5 });
  const [a, b, c, d, e] = w.ids;
  ok(await act(w, 'party.found', a, { party: 'greens', title: 'The Greens', platform: 'Trees.' }));
  no(await act(w, 'party.found', a, { party: 'reds', title: 'Reds' }), /belong to greens/);
  ok(await act(w, 'party.found', b, { party: 'reds', title: 'The Reds', joining: 'approval' }));
  ok(await act(w, 'party.join', c, { party: 'greens' }));
  no(await act(w, 'party.join', c, { party: 'reds' }), /leave it first/);
  // Approval: asking is not joining until the leader accepts.
  ok(await act(w, 'party.join', d, { party: 'reds' }));
  assert.deepEqual(parties.members(w.state, 'reds'), [b]);
  no(await act(w, 'party.accept', c, { party: 'reds', member: d }), /only the leader/);
  ok(await act(w, 'party.accept', b, { party: 'reds', member: d }));
  assert.deepEqual(parties.members(w.state, 'reds'), [b, d]);
  assert.equal(parties.partyOf(w.state, d), 'reds');
  // Registered at parties.min_members (3 by default).
  const { Parameters } = await import('../../kernel/parameters.js');
  const P = () => new Parameters(w.state.doc, w.state.catalog);
  assert.equal(parties.registered(w.state, 'greens', P()), false);
  ok(await act(w, 'party.join', e, { party: 'greens' }));
  assert.equal(parties.registered(w.state, 'greens', P()), true);
  // Leadership: a call by one of three members is not enough; two of three is.
  ok(await act(w, 'party.leader', c, { party: 'greens', to: e }));
  assert.equal(w.state.m.parties.parties.greens.leader, a);
  ok(await act(w, 'party.leader', e, { party: 'greens', to: e }));
  assert.equal(w.state.m.parties.parties.greens.leader, e);
  no(await act(w, 'party.platform', a, { party: 'greens', platform: 'More trees.' }), /only the leader/);
  ok(await act(w, 'party.platform', e, { party: 'greens', platform: 'More trees.' }));
  assert.equal(w.state.m.parties.parties.greens.platforms.length, 1);
  // Leaving hands the lead on; the last one out winds the party up.
  ok(await act(w, 'party.leave', d, { party: 'reds' }));
  ok(await act(w, 'party.leave', b, { party: 'reds' }));
  assert.ok(w.state.m.parties.parties.reds.dissolved);
  ok(await act(w, 'party.join', b, { party: 'greens' }));
});

test('parties: the party electorate waits out the cooling-off period; dissolution by decision', async () => {
  const w = await worldWith(['parties'], { people: 4 });
  const [a, b, c] = w.ids;
  const r = await enact(w, { title: 'Cooling off', rule: 'organic', changes: { 'parties.cooling_days': 10 } });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  ok(await act(w, 'party.found', a, { party: 'blues', title: 'Blues' }));
  w.jump(11);
  ok(await act(w, 'party.join', b, { party: 'blues' }));
  const { resolveElectorate } = await import('../../kernel/effects.js');
  const { Parameters } = await import('../../kernel/parameters.js');
  const roll = () => resolveElectorate(w.registry, w.state, new Parameters(w.state.doc, w.state.catalog), w.at(), 'party:blues').roll;
  assert.deepEqual(Object.keys(roll()), [a], 'a new member does not vote yet');
  w.jump(11);
  assert.deepEqual(Object.keys(roll()).sort(), [a, b].sort());
  const weak = await decide(w, { title: 'Ban the Blues', rule: 'ordinary', effects: [{ kind: 'party.dissolve', party: 'blues', reason: 'test' }] });
  assert.match(weak.refused[0].reason, /constitutional/);
  const d = await enact(w, { title: 'Ban the Blues', rule: 'constitutional', effects: [{ kind: 'party.dissolve', party: 'blues', reason: 'a test of the rule' }] });
  assert.equal(d.enacted, true, d.refused?.[0]?.reason || d.notEnacted);
  assert.ok(w.state.m.parties.parties.blues.dissolved);
  no(await act(w, 'party.join', c, { party: 'blues' }), /no party/);
});

test('parties: seats by D’Hondt and Sainte-Laguë', () => {
  const votes = { a: 100000, b: 80000, c: 30000, d: 20000 };
  assert.deepEqual(allocate(votes, 8), { a: 4, b: 3, c: 1, d: 0 });
  assert.deepEqual(allocate(votes, 8, 'sainte-lague'), { a: 3, b: 3, c: 1, d: 1 });
  assert.deepEqual(allocate({ x: 1, y: 1 }, 1), { x: 1, y: 0 }, 'ties go to the earlier id');
});
