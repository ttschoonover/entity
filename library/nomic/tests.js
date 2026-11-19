// Nomic: rules enacted, amended, repealed and transmuted by decision; turns;
// points for passed proposals and for dissent; winning; new games; judgments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import nomic from './index.js';

const act = async (w, kind, by, fields = {}) => w.settle(await w.sign(kind, by, fields));
const ok = (r) => assert.equal(r.applied.length, 1, r.refused[0]?.reason);
const no = (r, re) => { assert.equal(r.applied.length, 0); assert.match(r.refused[0].reason, re); };

test('nomic: rules change by decision, on your turn, and passing proposals score', async () => {
  const w = await worldWith(['nomic'], { people: 3 });
  const [a, b, c] = w.ids;
  // The founding rules: points from it are wiped by the new game at the end.
  const r0 = await decide(w, { title: 'The initial rules', rule: 'organic', effects: [
    { kind: 'nomic.enact', number: 101, title: 'Obey the rules', text: 'All players obey the rules in force.', mutable: false },
    { kind: 'nomic.enact', number: 201, title: 'Turns', text: 'Players take turns.' },
    { kind: 'nomic.new_game' },
  ] }, a);
  assert.ok(r0.enacted, r0.notEnacted || r0.refused?.[0]?.reason);
  assert.equal(nomic.rules(w.state).length, 2);
  assert.equal(nomic.score(w.state, a), 0);

  // Out of turn, and twice in one turn, are refused.
  const out = await decide(w, { title: 'Mine', rule: 'ordinary', effects: [{ kind: 'nomic.enact', number: 202, title: 'B', text: 'B rules.' }] }, b);
  assert.match(out.refused[0].reason, /turn/);
  const again = await decide(w, { title: 'Again', rule: 'ordinary', effects: [{ kind: 'nomic.enact', number: 202, title: 'A', text: 'A again.' }] }, a);
  assert.match(again.refused[0].reason, /already proposed/);

  // b's turn: an amendment passes, with c voting against.
  ok(await act(w, 'nomic.pass', a));
  assert.equal(nomic.turnOf(w.state).player, b);
  no(await act(w, 'nomic.pass', c), /turn/);
  const { propose } = await import('../../test/helpers.js');
  const pr = await propose(w, b, { title: 'Faster turns', rule: 'ordinary', effects: [{ kind: 'nomic.amend', number: 201, text: 'Players take short turns.' }], changes: { 'nomic.points_dissent': 3 } });
  assert.equal(pr.refused.length, 0, pr.refused[0]?.reason);
  ok(await act(w, 'ballot.cast', a, { proposal: pr.id, choice: 'for' }));
  ok(await act(w, 'ballot.cast', b, { proposal: pr.id, choice: 'for' }));
  ok(await act(w, 'ballot.cast', c, { proposal: pr.id, choice: 'against' }));
  assert.equal(w.state.m.nomic.rules[201].text, 'Players take short turns.');
  assert.equal(nomic.score(w.state, b), 10);
  // The dissent points were set by the same proposal, after its effects applied: none this time.
  assert.equal(nomic.score(w.state, c), 0);

  // Immutable rules cannot be amended or repealed until transmuted.
  ok(await act(w, 'nomic.pass', b));
  const im = await decide(w, { title: 'Change 101', rule: 'ordinary', effects: [{ kind: 'nomic.amend', number: 101, text: 'x' }] }, c);
  assert.ok(!im.enacted);
  ok(await act(w, 'nomic.pass', c));
  const tr = await decide(w, { title: 'Soften 101', rule: 'organic', effects: [{ kind: 'nomic.transmute', number: 101 }] }, a);
  assert.ok(tr.enacted, tr.notEnacted);
  assert.equal(w.state.m.nomic.rules[101].mutable, true);

  // A turn that runs out may be ended by anyone.
  w.jump(4);
  ok(await act(w, 'nomic.pass', c));
  assert.equal(nomic.turnOf(w.state).player, b);
});

test('nomic: winning, a new game, and the judge', async () => {
  const w = await worldWith(['nomic'], { people: 2 });
  const [a, b] = w.ids;
  const r = await decide(w, { title: 'A big award', rule: 'ordinary', effects: [{ kind: 'nomic.award', member: b, points: 100, reason: 'a fine rule' }, { kind: 'nomic.judge', member: b }] }, a);
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  assert.equal(w.state.m.nomic.winner?.id, b);
  assert.equal(nomic.score(w.state, a), 0); // no points once the game is won
  // Once won, anyone may call a new game, out of turn.
  const ng = await decide(w, { title: 'Again!', rule: 'ordinary', effects: [{ kind: 'nomic.new_game' }] }, b);
  assert.ok(ng.enacted, ng.notEnacted || ng.refused?.[0]?.reason);
  assert.equal(w.state.m.nomic.game, 2);
  assert.equal(nomic.score(w.state, b), 0);
  assert.equal(w.state.m.nomic.past[0].winner.id, b);

  const q = await w.sign('nomic.cfj', a, { question: 'Does rule 201 apply on weekends?' });
  ok(await w.settle(q));
  const id = nomic.cfjId(q);
  no(await act(w, 'nomic.judgment', a, { cfj: id, verdict: 'true', reason: 'yes' }), /only the judge/);
  no(await act(w, 'nomic.judgment', b, { cfj: id, verdict: 'maybe', reason: 'hm' }), /true, false or undecided/);
  ok(await act(w, 'nomic.judgment', b, { cfj: id, verdict: 'true', reason: 'Nothing exempts weekends.' }));
  assert.equal(w.state.m.nomic.cfjs[id].judgment.verdict, 'true');
});
