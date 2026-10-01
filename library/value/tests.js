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
