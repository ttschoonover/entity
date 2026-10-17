// The loan fund revolves: lent, repaid, lent again; never beyond what is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import { available, get, owing } from './index.js';

test('loans: funded, lent within limits, repaid back into the fund, forgiven by decision', async () => {
  const w = await worldWith(['offices', 'committees', 'authority', 'loans', 'endowment'], { people: 4 });
  const r = await decide(w, { title: 'The loan fund', rule: 'organic', effects: [
    { kind: 'loan.fund', amount: 60000, source: 'dues' },
    { kind: 'committee.create', committee: 'stewards', title: 'Stewards', remit: 'loans' },
    { kind: 'committee.appoint', committee: 'stewards', member: 'p-0001' },
    { kind: 'committee.appoint', committee: 'stewards', member: 'p-0002' },
    { kind: 'authority.grant', grant: 'lending', to: { committee: 'stewards' }, may: ['loan.make', 'loan.repay'], needs: 2 }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const due = '2027-01-01T00:00:00.000Z';
  const exercises = () => Object.keys(w.state.m.authority.exercises);
  // One steward proposes the act under the grant; a second co-signs it.
  const twoSign = async (effect) => {
    const before = exercises();
    await w.settle(await w.sign('authority.exercise', 'p-0001', { grant: 'lending', effects: [effect] }));
    const id = exercises().find(x => !before.includes(x));
    await w.settle(await w.sign('authority.cosign', 'p-0002', { exercise: id }));
  };
  await w.settle(await w.sign('authority.exercise', 'p-0001', { grant: 'lending', effects: [{ kind: 'loan.make', due, loan: 'solo', to: 'p-0003', amount: 100 }] }));
  assert.equal(get(w.state, 'solo'), null, 'one steward alone is not enough');
  await twoSign({ kind: 'loan.make', due, loan: 'rent-1', to: 'p-0004', amount: 40000, purpose: 'rent' });
  assert.equal(owing(get(w.state, 'rent-1')), 40000); assert.equal(available(w.state), 20000);
  const tooMuch = await decide(w, { title: 'Big', rule: 'ordinary', effects: [{ kind: 'loan.make', loan: 'x', to: 'p-0003', amount: 30000, due }] });
  assert.match(tooMuch.refused?.[0]?.reason || tooMuch.notEnacted || '', /only 20000 is available/);
  const second = await decide(w, { title: 'Again', rule: 'ordinary', effects: [{ kind: 'loan.make', loan: 'y', to: 'p-0004', amount: 1000, due }] });
  assert.match(second.refused?.[0]?.reason || second.notEnacted || '', /already has 1 loan/);
  const capped = await decide(w, { title: 'Cap', rule: 'ordinary', effects: [{ kind: 'loan.make', loan: 'z', to: 'p-0003', amount: 60000, due }] });
  assert.match(capped.refused?.[0]?.reason || capped.notEnacted || '', /at most 50000/);
  await twoSign({ kind: 'loan.repay', loan: 'rent-1', amount: 30000 });
  assert.equal(owing(get(w.state, 'rent-1')), 10000); assert.equal(available(w.state), 50000, 'repayments return to the fund');
  const f = await decide(w, { title: 'Forgive', rule: 'organic', effects: [{ kind: 'loan.forgive', loan: 'rent-1', reason: 'hardship' }] });
  assert.equal(f.enacted, true, f.refused?.[0]?.reason || f.notEnacted);
  assert.equal(available(w.state), 50000, 'forgiven money is gone from the fund'); assert.ok(get(w.state, 'rent-1').closed);
});

test('endowment: principal kept, a yearly draw limit, draws can feed the loan fund', async () => {
  const w = await worldWith(['loans', 'endowment'], { people: 3 });
  const g = await decide(w, { title: 'Gift', rule: 'organic', effects: [{ kind: 'endowment.gift', amount: 1000000, from: 'founders' }, { kind: 'endowment.value', value: 1100000 }] });
  assert.equal(g.enacted, true, g.refused?.[0]?.reason || g.notEnacted);
  const draw = (amount, to = 'loans') => decide(w, { title: 'Draw', rule: 'organic', effects: [{ kind: 'endowment.draw', amount, to }] });
  const big = await draw(50000);
  assert.match(big.refused?.[0]?.reason || big.notEnacted || '', /at most 44000/, '4% of 1,100,000');
  assert.equal((await draw(30000)).enacted, true);
  assert.equal(w.state.m.loans.funded, 30000); assert.equal(available(w.state), 30000);
  assert.match((await draw(20000)).refused?.[0]?.reason || '', /at most 12800/, 'the rest of this year, at the new value');
  const dip = await decide(w, { title: 'Market fell', rule: 'organic', effects: [{ kind: 'endowment.value', value: 1005000 }] });
  assert.equal(dip.enacted, true);
  assert.match((await draw(10000, 'budget')).refused?.[0]?.reason || '', /at most 5000/, 'never below the principal');
});
