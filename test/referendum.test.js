// Parliament, direct democracy, or both: decision.referendum sends proposals
// under the rules it names to every member, whoever decision.electorate names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, enact, propose } from './helpers.js';

test('referendum: a parliament makes ordinary law, the people amend the constitution', async () => {
  const w = await worldWith(['offices'], { people: 4 });
  const [a, b] = w.ids;
  const r = await enact(w, { title: 'A parliament, and referendums for the constitution', rule: 'entrenched',
    changes: { 'decision.electorate': 'office:parliament', 'decision.referendum': ['constitutional', 'entrenched'] },
    effects: [{ kind: 'office.create', office: 'parliament', title: 'Member of Parliament', seats: 3 }, { kind: 'office.fill', office: 'parliament', holder: b }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const law = await propose(w, a, { title: 'An ordinary law', rule: 'ordinary' });
  assert.deepEqual(w.state.proposals[law.id].roll, [b]);
  assert.equal(w.state.proposals[law.id].electorate, 'office:parliament');
  const amend = await propose(w, a, { title: 'An amendment', rule: 'constitutional' });
  assert.deepEqual(w.state.proposals[amend.id].roll, w.ids);
  assert.equal(w.state.proposals[amend.id].electorate, 'members');
});
