import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../../kernel/index.js';
import { worldWith, decide, enact, propose, vote } from '../../test/helpers.js';

test('shares: classes, issue, transfer rules, redemption, dividends with published rounding', async () => {
  const w = await worldWith(['value', 'shares']);
  const r = await enact(w, { title: 'Classes', rule: 'constitutional', effects: [
    { kind: 'share.class', class: 'member', title: 'Member shares', voting: true, transferable: false },
    { kind: 'share.class', class: 'investor', title: 'Investor shares', voting: false, transferable: true }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  await decide(w, { title: 'Issue', rule: 'organic', effects: [
    { kind: 'share.issue', class: 'member', to: 'p-0001', count: 1 }, { kind: 'share.issue', class: 'member', to: 'p-0002', count: 1 },
    { kind: 'share.issue', class: 'investor', to: 'p-0001', count: 3 }, { kind: 'share.issue', class: 'investor', to: 'p-0003', count: 4 }] });
  const t = async (by, f) => w.settle(await w.sign('share.transfer', by, f));
  assert.match((await t('p-0001', { class: 'member', to: 'p-0003', count: 1 })).refused[0].reason, /not transferable/);
  assert.equal((await t('p-0003', { class: 'investor', to: 'p-0002', count: 1 })).applied.length, 1);
  const div = await decide(w, { title: 'Dividend', rule: 'organic', effects: [{ kind: 'share.dividend', class: 'investor', per_share: 2.5 }] });
  assert.equal(div.enacted, true, div.refused?.[0]?.reason || div.notEnacted);
  assert.deepEqual(w.state.m.value.balances, { 'p-0001': 7, 'p-0003': 7, 'p-0002': 2 }, '3×2.5=7.5→7, 3×2.5→7, 1×2.5→2');
  assert.match(w.state.m.shares.history.at(-1).what, /16 paid, 1\.5 lost to rounding/);
  await decide(w, { title: 'Redeem', rule: 'organic', effects: [{ kind: 'share.redeem', class: 'investor', from: 'p-0003', count: 3 }] });
  assert.equal(w.state.m.shares.classes.investor.holders['p-0003'], undefined);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('shares: the members\' shares can be the electorate, one vote per share', async () => {
  const w = await worldWith(['shares']);
  await enact(w, { title: 'Class', rule: 'constitutional', effects: [{ kind: 'share.class', class: 'common', title: 'Common', voting: true, transferable: true }] });
  await decide(w, { title: 'Issue', rule: 'organic', effects: [{ kind: 'share.issue', class: 'common', to: 'p-0001', count: 70 }, { kind: 'share.issue', class: 'common', to: 'p-0002', count: 30 }] });
  const r = await enact(w, { title: 'Shareholders decide', rule: 'entrenched', changes: { 'decision.electorate': 'shares:common' } });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const { id } = await propose(w, 'p-0003', { title: 'Nine days', rule: 'organic', changes: { 'deliberation.period': 9 } });
  assert.deepEqual(w.state.proposals[id].weights, { 'p-0001': 70, 'p-0002': 30 });
  await vote(w, id, 'p-0001', 'for');
  assert.equal(w.state.proposals[id].enacted, true, '70 of 100 votes: the 30 left cannot overturn it');
});
