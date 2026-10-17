import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../../kernel/index.js';
import { makeBundle, planAbsorb } from '../../kernel/transport.js';
import { worldWith, decide, enact } from '../../test/helpers.js';
import finality from './index.js';

const here = (w) => ({ count: w.state.head.seq, head: w.state.head.hash });
const sign = async (w, by, number, at = here(w)) => w.settle(await w.sign('checkpoint.sign', by, { number, ...at }));

test('finality: a checkpoint becomes final with more than two thirds of the signers, and never before', async () => {
  const w = await worldWith(['finality']);
  const pos = here(w);
  const one = await sign(w, 'p-0001', 1, pos);
  assert.equal(one.applied.length, 1, one.refused[0]?.reason);
  assert.equal(finality.lastFinal(w.state), null, 'one of three is not enough');
  assert.match((await sign(w, 'p-0001', 1, pos)).refused[0].reason, /already signed/);
  const other = { count: pos.count, head: 'f'.repeat(64) };
  assert.match((await sign(w, 'p-0002', 1, other)).refused[0].reason, /open at record/);
  const two = await sign(w, 'p-0002', 1, pos);
  assert.deepEqual(two.records.map(r => r.kind), ['checkpoint.sign', 'checkpoint.final']);
  const f = finality.lastFinal(w.state);
  assert.equal(f.count, pos.count); assert.deepEqual(f.signers, ['p-0001', 'p-0002']);
  assert.match((await sign(w, 'p-0003', 1, pos)).refused[0].reason, /the next checkpoint is number 2/);
  assert.match((await sign(w, 'p-0003', 2, { count: 1, head: w.state.hashes[0] })).refused[0].reason, /opened at the record's head/);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('finality: signers are anchored at the previous checkpoint, so nobody can pad them later', async () => {
  const w = await worldWith(['finality']);
  await sign(w, 'p-0001', 1);
  await w.person('p-0004'); await w.settle(await w.sign('participant.apply', 'p-0004', { key: w.line('p-0004') }));
  await sign(w, 'p-0002', 1, { count: w.state.m.finality.open.count, head: w.state.m.finality.open.head });
  const two = await sign(w, 'p-0004', 2);
  assert.match(two.refused[0].reason, /not among the signers of checkpoint 2/);
  await sign(w, 'p-0001', 2); await sign(w, 'p-0002', 2, { count: w.state.m.finality.open.count, head: w.state.m.finality.open.head });
  assert.equal(finality.lastFinal(w.state).number, 2);
  assert.ok(w.state.m.finality.rolls[3].roll['p-0004'], 'but the next one includes them');
});

test('finality: a role signs; a checkpoint left open lapses and reopens at the head', async () => {
  const w = await worldWith(['offices', 'finality']);
  const r = await enact(w, { title: 'Validators', rule: 'constitutional', changes: { 'finality.signers': 'office:validators' }, effects: [
    { kind: 'office.create', office: 'validators', title: 'Validators', seats: 3 },
    { kind: 'office.fill', office: 'validators', holder: 'p-0001' }, { kind: 'office.fill', office: 'validators', holder: 'p-0002' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.match((await sign(w, 'p-0003', 1)).refused[0].reason, /not among the signers of checkpoint 1 \(office:validators\)/);
  const pos = here(w);
  await sign(w, 'p-0001', 1, pos);
  w.jump(8);
  await w.settle(await w.sign('title.set', 'p-0003', { title: 'Cleo' }));
  assert.match((await sign(w, 'p-0002', 1, pos)).refused[0].reason, /opened at the record's head/);
  const re = await sign(w, 'p-0002', 1);
  assert.equal(re.applied.length, 1, re.refused[0]?.reason);
  await sign(w, 'p-0001', 1, { count: w.state.m.finality.open.count, head: w.state.m.finality.open.head });
  assert.equal(finality.lastFinal(w.state).number, 1, 'two of two validators');
});

test('finality: a validator who signs a false history is excluded, loses their seat, and is fined; the reporter is paid', async () => {
  const w = await worldWith(['offices', 'value', 'finality']);
  const r = await enact(w, { title: 'Validators', rule: 'constitutional',
    changes: { 'finality.signers': 'office:validators', 'finality.slash': 0.5, 'finality.bounty': 0.5 }, effects: [
      { kind: 'office.create', office: 'validators', title: 'Validators', seats: 3 },
      ...['p-0001', 'p-0002', 'p-0003'].map(h => ({ kind: 'office.fill', office: 'validators', holder: h })),
      { kind: 'value.issue', to: 'p-0002', amount: 100 }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const pos = here(w);
  const honest = await w.sign('checkpoint.sign', 'p-0001', { number: 1, ...pos });
  await w.settle(honest);
  await sign(w, 'p-0002', 1, pos); await sign(w, 'p-0003', 1, pos);
  assert.equal(finality.lastFinal(w.state).number, 1);

  // p-0002 also signs checkpoint 1 of another history, somewhere else.
  const lie = await w.sign('checkpoint.sign', 'p-0002', { number: 1, count: pos.count, head: 'e'.repeat(64) });
  const evidence = async (by, statement) => w.settle(await w.sign('checkpoint.evidence', by, { statement }));
  assert.match((await evidence('p-0003', honest)).refused[0].reason, /agrees with this record/);
  assert.match((await evidence('p-0003', { ...lie, by: 'p-0001' })).refused[0].reason, /signature does not verify/);
  const caught = await evidence('p-0003', lie);
  assert.equal(caught.applied.length, 1, caught.refused[0]?.reason);
  assert.deepEqual(caught.records.map(x => x.kind), ['checkpoint.evidence', 'office.vacate', 'value.revoke', 'value.issue']);
  assert.ok(w.state.m.finality.banned['p-0002']);
  assert.equal(w.state.m.value.balances['p-0002'], 50);
  assert.equal(w.state.m.value.balances['p-0003'], 25);
  assert.match((await sign(w, 'p-0002', 2)).refused[0].reason, /excluded from signing/);
  assert.match((await evidence('p-0001', lie)).refused[0].reason, /already been excluded/);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('finality: choosing between histories: final stands, provisional gives way, two finals are refused', async () => {
  const w = await worldWith(['finality']);
  await sign(w, 'p-0001', 1); const at1 = { count: w.state.m.finality.open.count, head: w.state.m.finality.open.head };
  await sign(w, 'p-0002', 1, at1);
  const shared = { records: w.records.slice(), state: structuredClone(w.state) };
  const branch = async (title) => {
    w.records = shared.records.slice(); w.state = structuredClone(shared.state);
    await w.settle(await w.sign('title.set', 'p-0003', { title }));
    return w;
  };
  // History A: a new title, then checkpoint 2 made final over it.
  await branch('Anne');
  await sign(w, 'p-0001', 2); const at2 = { count: w.state.m.finality.open.count, head: w.state.m.finality.open.head };
  await sign(w, 'p-0002', 2, at2);
  const A = { records: w.records.slice(), state: w.state };
  // History B: another title, not final.
  await branch('Bea');
  const B = { records: w.records.slice(), state: w.state };
  const bundle = (h) => makeBundle({ entity: { id: w.entity }, records: h.records });
  const toB = await planAbsorb(w.registry, { entity: { id: w.entity }, ...B }, bundle(A));
  assert.equal(toB.action, 'switched', toB.why);
  assert.equal(toB.records.length, A.records.length);
  assert.deepEqual(toB.acts.map(a => a.title), ['Bea'], 'B\'s own act is settled again on top of A');
  const toA = await planAbsorb(w.registry, { entity: { id: w.entity }, ...A }, bundle(B));
  assert.equal(toA.action, 'kept');
  // History C: final too, past the same fork. Only possible if validators signed both.
  await branch('Cleo');
  await sign(w, 'p-0001', 2); const at3 = { count: w.state.m.finality.open.count, head: w.state.m.finality.open.head };
  await sign(w, 'p-0002', 2, at3);
  const C = { records: w.records.slice(), state: w.state };
  const both = await planAbsorb(w.registry, { entity: { id: w.entity }, ...A }, bundle(C));
  assert.equal(both.action, 'refused'); assert.match(both.why, /validators signed both/);
});

test('finality: a decision can re-anchor signing when finality stalls', async () => {
  const w = await worldWith(['finality']);
  await sign(w, 'p-0001', 1);
  const r = await enact(w, { title: 'Re-anchor', rule: 'constitutional', effects: [{ kind: 'finality.reanchor', reason: 'two validators lost their keys' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(w.state.m.finality.open, null);
  assert.equal(w.state.m.finality.reanchored.length, 1);
  assert.equal((await sign(w, 'p-0003', 1)).applied.length, 1);
});
