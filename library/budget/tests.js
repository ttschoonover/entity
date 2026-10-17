import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import budget from './index.js';

test('budget: lines approved by decision; a treasurer spends under a grant, never beyond a line', async () => {
  const w = await worldWith(['offices', 'authority', 'budget']);
  const r = await decide(w, { title: 'Budget and treasurer', rule: 'organic', effects: [
    { kind: 'budget.line', line: 'ingredients', title: 'Ingredients', amount: 50000, period: 'Fall 2026' },
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 1 },
    { kind: 'office.fill', office: 'treasurer', holder: 'p-0002' },
    { kind: 'authority.grant', grant: 'spending', to: { office: 'treasurer' }, may: ['budget.spend'] }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const spend = async (by, amount) => w.settle(await w.sign('authority.exercise', by, { grant: 'spending', effects: [{ kind: 'budget.spend', line: 'ingredients', amount, payee: 'Mill Co', memo: 'flour' }] }));
  assert.equal((await spend('p-0002', 30000)).applied.length, 1);
  assert.match((await spend('p-0002', 30000)).refused[0].reason, /only 20000 is left/);
  assert.match((await spend('p-0003', 100)).refused[0].reason, /only members of the office treasurer/);
  const l = w.state.m.budget.lines.ingredients;
  assert.equal(budget.left(l), 20000); assert.equal(l.spending[0].by, 'grant spending');
  const adj = await decide(w, { title: 'Less', rule: 'organic', effects: [{ kind: 'budget.adjust', line: 'ingredients', amount: 20000 }] });
  assert.match(adj.refused[0].reason, /30000 has already been spent/);
});
