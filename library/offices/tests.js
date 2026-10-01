import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import offices from './index.js';

test('offices: create and fill in one decision; seats, terms, resignation, removal', async () => {
  const w = await worldWith(['offices']);
  const r = await decide(w, { title: 'A treasurer', rule: 'organic', effects: [
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 1, term_days: 30 },
    { kind: 'office.fill', office: 'treasurer', holder: 'p-0002' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(offices.holds(w.state, 'treasurer', 'p-0002', w.at()), true);
  const full = await decide(w, { title: 'Two treasurers', rule: 'ordinary', effects: [{ kind: 'office.fill', office: 'treasurer', holder: 'p-0003' }] });
  assert.match(full.refused[0].reason, /all 1 seat\(s\) of treasurer are filled/);
  w.jump(31);
  assert.equal(offices.holds(w.state, 'treasurer', 'p-0002', w.at()), false, 'the term has ended');
  const next = await decide(w, { title: 'Next treasurer', rule: 'ordinary', effects: [{ kind: 'office.fill', office: 'treasurer', holder: 'p-0003' }] });
  assert.equal(next.enacted, true);
  const quit = await w.settle(await w.sign('office.resign', 'p-0003', { office: 'treasurer' }));
  assert.equal(quit.applied.length, 1);
  const notMine = await w.settle(await w.sign('office.resign', 'p-0001', { office: 'treasurer' }));
  assert.match(notMine.refused[0].reason, /you do not hold treasurer/);
});

test('offices: the term limit is enforced', async () => {
  const w = await worldWith(['offices']);
  await decide(w, { title: 'Limit', rule: 'organic', changes: { 'offices.term_limit': 1 }, effects: [
    { kind: 'office.create', office: 'chair', title: 'Chair', seats: 1, term_days: 10 },
    { kind: 'office.fill', office: 'chair', holder: 'p-0001' }] });
  w.jump(11);
  const again = await decide(w, { title: 'Again', rule: 'ordinary', effects: [{ kind: 'office.fill', office: 'chair', holder: 'p-0001' }] });
  assert.match(again.refused[0].reason, /served the limit of 1 term/);
});
