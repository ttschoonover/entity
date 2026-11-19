import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';

test('value: issued by decision, sent between holders, never overdrawn', async () => {
  const w = await worldWith(['value']);
  const r = await decide(w, { title: 'Credits', rule: 'organic', effects: [{ kind: 'value.issue', to: 'p-0001', amount: 100 }] });
  assert.equal(r.enacted, true);
  const send = async (by, fields) => w.settle(await w.sign('value.transfer', by, fields));
  assert.equal((await send('p-0001', { to: 'p-0002', amount: 30, memo: 'bread' })).applied.length, 1);
  assert.deepEqual(w.state.m.value.balances, { 'p-0001': 70, 'p-0002': 30 });
  assert.match((await send('p-0002', { to: 'p-0003', amount: 31 })).refused[0].reason, /you hold 30/);
  assert.match((await send('p-0002', { to: 'p-0003', amount: 1.5 })).refused[0].reason, /whole number/);
  assert.match((await send('p-0002', { to: 'p-0002', amount: 1 })).refused[0].reason, /yourself/);
  await w.settle(await w.sign('value.retire', 'p-0002', { amount: 10 }));
  assert.equal(w.state.m.value.supply, 90);
  await decide(w, { title: 'Freeze', rule: 'organic', changes: { 'value.transferable': false } });
  assert.match((await send('p-0001', { to: 'p-0002', amount: 1 })).refused[0].reason, /cannot be transferred/);
});

test('value: revocation and the supply cap', async () => {
  const w = await worldWith(['value']);
  await decide(w, { title: 'Cap', rule: 'constitutional', changes: { 'value.max_supply': 50 } });
  w.jump(31);
  const cap = w.state.proposals[Object.keys(w.state.proposals)[1]];
  if (!cap.enacted) {
    const second = await decide(w, { title: 'Cap', rule: 'constitutional', changes: { 'value.max_supply': 50 }, reading_of: cap.id });
    assert.equal(second.enacted, true, second.refused?.[0]?.reason || second.notEnacted);
  }
  const over = await decide(w, { title: 'Too many', rule: 'organic', effects: [{ kind: 'value.issue', to: 'p-0001', amount: 51 }] });
  assert.match(over.refused[0].reason, /maximum supply of 50/);
  await decide(w, { title: 'Some', rule: 'organic', effects: [{ kind: 'value.issue', to: 'p-0002', amount: 20 }] });
  const back = await decide(w, { title: 'Take back', rule: 'organic', effects: [{ kind: 'value.revoke', from: 'p-0002', amount: 5, memo: 'error' }] });
  assert.equal(back.enacted, true);
  assert.equal(w.state.m.value.balances['p-0002'], 15);
});

test('value: a committee keeps a reserve, issued into and destroyed from it only by the committee\'s vote', async () => {
  const w = await worldWith(['value', 'committees', 'authority'], { people: 3 });
  const [a, b, c] = w.ids;
  const bank = 'committee:federal-bank';
  const r = await decide(w, { title: 'A federal bank', rule: 'organic', effects: [
    { kind: 'committee.create', committee: 'federal-bank', title: 'Federal Bank', needs: 'majority' },
    { kind: 'committee.appoint', committee: 'federal-bank', member: a },
    { kind: 'committee.appoint', committee: 'federal-bank', member: b },
    { kind: 'authority.grant', grant: 'bank-issue', title: 'Issuing currency', to: { committee: 'federal-bank' }, may: ['value.issue'], where: { to: bank } },
    { kind: 'authority.grant', grant: 'bank-destroy', title: 'Destroying currency', to: { committee: 'federal-bank' }, may: ['value.revoke'], where: { from: bank } },
  ] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  // One member moves to issue; nothing happens until the other votes for it (a majority of two is two).
  const m = await act('authority.exercise', a, { grant: 'bank-issue', effects: [{ kind: 'value.issue', to: bank, amount: 1000, memo: 'first issue' }] });
  assert.equal(m.refused.length, 0, m.refused[0]?.reason);
  assert.equal(w.state.m.value?.supply || 0, 0);
  const id = Object.keys(w.state.m.authority.exercises)[0];
  assert.match((await act('authority.cosign', c, { exercise: id })).refused[0].reason, /only members/);
  assert.equal((await act('authority.cosign', b, { exercise: id })).refused.length, 0);
  assert.equal(w.state.m.value.balances[bank], 1000);
  assert.equal(w.state.m.value.supply, 1000);
  // The grant reaches only the bank's own account.
  assert.match((await act('authority.exercise', a, { grant: 'bank-issue', effects: [{ kind: 'value.issue', to: a, amount: 5 }] })).refused[0].reason, /outside this grant/);
  // Destroying: moved and seconded; never more than the reserve holds.
  assert.match((await act('authority.exercise', b, { grant: 'bank-destroy', effects: [{ kind: 'value.revoke', from: bank, amount: 1001 }] })).refused[0].reason, /holds only 1000/);
  await act('authority.exercise', b, { grant: 'bank-destroy', effects: [{ kind: 'value.revoke', from: bank, amount: 400 }] });
  const d = Object.keys(w.state.m.authority.exercises).at(-1);
  await act('authority.cosign', a, { exercise: d });
  assert.equal(w.state.m.value.balances[bank], 600);
  assert.equal(w.state.m.value.supply, 600);
  // Paid out by decision; members may deposit; the reserve has no vote.
  assert.ok((await decide(w, { title: 'A grant', rule: 'organic', effects: [{ kind: 'value.pay', from: bank, to: c, amount: 100 }] })).enacted);
  assert.equal((await act('value.transfer', c, { to: bank, amount: 40 })).refused.length, 0);
  assert.equal(w.state.m.value.balances[bank], 540);
  assert.match((await decide(w, { title: 'Bad', rule: 'organic', effects: [{ kind: 'value.issue', to: 'committee:nobody', amount: 1 }] })).refused[0].reason, /no committee/);
});
