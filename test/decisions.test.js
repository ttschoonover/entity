// 0.4 · Who decides, and what the core lets them do: electorates, removal,
// recovery and admission by decision, defaults in code, and module versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, verifyRecords, createRegistry, paramsOf, emptyState, keys, loadDocument, Parameters, resolveElectorate } from '../kernel/index.js';
import { parametersText } from '../kernel/store.js';
import { world, worldWith, decide, enact, propose, vote, installFor, ALL_MODULES } from './helpers.js';

const verified = async (w) => assert.equal((await verifyRecords(w.registry, w.records)).ok, true, 'the record replays');

test('electorate "founder": one person decides alone, at once; others may propose but not vote', async () => {
  const w = await world({ set: { 'decision.electorate': 'founder' } });
  const { id } = await propose(w, 'p-0002', { title: 'Nine days', rule: 'organic', changes: { 'deliberation.period': 9 } });
  assert.deepEqual(w.state.proposals[id].roll, ['p-0001']);
  await vote(w, id, 'p-0002');
  assert.equal(w.state.proposals[id].closed, null, 'a ballot from off the roll changes nothing');
  await vote(w, id, 'p-0001');
  assert.equal(w.state.proposals[id].enacted, true, 'the sole voter carries it on the spot');
  assert.equal(paramsOf(w.state).value('deliberation.period'), 9);
  const t = (await import('../modules/deliberation/count.js')).count(w.state, id);
  assert.deepEqual(t.rejected.map(r => [r.by, r.why]), [['p-0002', 'not on the roll when the proposal was laid']]);
  await verified(w);
});

test('founding refuses an electorate nobody is on, and accepts "none": a frozen entity decides nothing', async () => {
  await assert.rejects(world({ set: { 'decision.electorate': 'member:p-0009' } }), /not on the register/);
  await assert.rejects(world({ set: { 'decision.electorate': 'office:council' } }), /is not an electorate this entity knows|needs the offices module/);
  await assert.rejects(world({ set: { 'decision.electorate': 'dragons' } }), /not an electorate/);
  const w = await world({ set: { 'decision.electorate': 'none' } });
  const r = await propose(w, 'p-0001', { title: 'Anything', rule: 'ordinary' });
  assert.match(r.refused[0].reason, /frozen/);
  const again = await settle(w.registry, w.state, [await w.sign('participant.leave', 'p-0003')]);
  assert.equal(again.applied.length, 1, 'leaving is still unconditional');
});

test('electorate "office:ID": a council decides; the electorate cannot be emptied by decision', async () => {
  const w = await worldWith(['offices']);
  const r = await enact(w, { title: 'A council rules', rule: 'entrenched', changes: { 'decision.electorate': 'office:council' }, effects: [
    { kind: 'office.create', office: 'council', title: 'Council', seats: 2 },
    { kind: 'office.fill', office: 'council', holder: 'p-0002' },
    { kind: 'office.fill', office: 'council', holder: 'p-0003' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const { id } = await propose(w, 'p-0001', { title: 'Ten days', rule: 'organic', changes: { 'deliberation.period': 10 } });
  assert.deepEqual(w.state.proposals[id].roll, ['p-0002', 'p-0003']);
  await vote(w, id, 'p-0001');
  await vote(w, id, 'p-0002'); await vote(w, id, 'p-0003');
  assert.equal(w.state.proposals[id].enacted, true);

  // Removing both councillors would leave nobody to decide: refused.
  const empty = await decide(w, { title: 'Nobody', rule: 'ordinary', effects: [
    { kind: 'office.vacate', office: 'council', holder: 'p-0002' }, { kind: 'office.vacate', office: 'council', holder: 'p-0003' }] });
  assert.match(empty.refused[0].reason, /nobody could vote/);
  const unknown = await decide(w, { title: 'Nowhere', rule: 'entrenched', changes: { 'decision.electorate': 'office:senate' } });
  assert.match(unknown.refused[0].reason, /there is no office senate/);
  // Resigning cannot be prevented; once the council is empty, nothing can be laid.
  await w.settle(await w.sign('office.resign', 'p-0002', { office: 'council' }));
  await w.settle(await w.sign('office.resign', 'p-0003', { office: 'council' }));
  const stuck = await propose(w, 'p-0001', { title: 'Help', rule: 'ordinary' });
  assert.match(stuck.refused[0].reason, /the electorate "office:council" is empty/);
  await verified(w);
});

test('electorate "value": holders vote with their balance, fixed when the proposal is laid', async () => {
  const w = await worldWith(['value']);
  await decide(w, { title: 'Shares', rule: 'organic', effects: [
    { kind: 'value.issue', to: 'p-0001', amount: 70 }, { kind: 'value.issue', to: 'p-0002', amount: 30 }] });
  const r = await enact(w, { title: 'One unit, one vote', rule: 'entrenched', changes: { 'decision.electorate': 'value' } });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const { id } = await propose(w, 'p-0002', { title: 'Twelve days', rule: 'organic', changes: { 'deliberation.period': 12 } });
  assert.deepEqual(w.state.proposals[id].weights, { 'p-0001': 70, 'p-0002': 30 });
  // Units bought during the vote do not count: the roll is fixed.
  await w.settle(await w.sign('value.transfer', 'p-0001', { to: 'p-0002', amount: 50 }));
  await vote(w, id, 'p-0002', 'for');
  await vote(w, id, 'p-0001', 'against');
  const p = w.state.proposals[id];
  assert.equal(p.closed.carried, false, '30 for against 70 against');
  assert.equal(p.closed.tally.weighted, true);
  assert.equal(p.closed.tally.against, 70);
  await verified(w);
});

test('removal by decision: a published reason; past acts stay; the removed can no longer act', async () => {
  const w = await world();
  const why = await decide(w, { title: 'Remove', rule: 'ordinary', effects: [{ kind: 'participant.remove', id: 'p-0003' }] });
  assert.match(why.refused[0].reason, /give a reason/);
  const r = await decide(w, { title: 'Remove', rule: 'ordinary', effects: [{ kind: 'participant.remove', id: 'p-0003', reason: 'did not pay dues for a year' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const p = w.state.participants['p-0003'];
  assert.equal(p.status, 'removed'); assert.equal(p.reason, 'did not pay dues for a year');
  const after = await settle(w.registry, w.state, [await w.sign('title.set', 'p-0003', { title: 'Still here' })]);
  assert.match(after.refused[0].reason, /has been removed/);
  const { id } = await propose(w, 'p-0001', { title: 'Next', rule: 'ordinary' });
  assert.ok(!w.state.proposals[id].roll.includes('p-0003'), 'off every future roll');
  const constitutional = await enact(w, { title: 'Harder', rule: 'organic', changes: { 'membership.removal_rule': 'constitutional' } });
  assert.equal(constitutional.enacted, true);
  const weak = await decide(w, { title: 'Remove', rule: 'ordinary', effects: [{ kind: 'participant.remove', id: 'p-0002', reason: 'x' }] });
  assert.match(weak.refused[0].reason, /requires "constitutional"/);
  await verified(w);
});

test('removal never leaves the entity without an active member', async () => {
  const w = await world({ people: 1 });
  const r = await decide(w, { title: 'Self', rule: 'ordinary', effects: [{ kind: 'participant.remove', id: 'p-0001', reason: 'x' }] });
  assert.match(r.refused[0].reason, /no active member/);
});

test('recovery by decision: a lost key replaced; the old key no longer signs; flagged on the member', async () => {
  const w = await world();
  const fresh = await keys.generate();
  const r = await decide(w, { title: 'New key for p-0002', rule: 'ordinary', effects: [
    { kind: 'participant.rekey', id: 'p-0002', key: keys.publicKeyLine(fresh.publicKey), reason: 'phone lost' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(w.state.participants['p-0002'].recovered.length, 1);
  const old = await settle(w.registry, w.state, [await w.sign('title.set', 'p-0002', { title: 'old' })]);
  assert.match(old.refused[0].reason, /signature invalid/);
  const now = await w.settle(await w.sign('title.set', 'p-0002', { title: 'new' }, fresh.privateKey));
  assert.equal(now.applied.length, 1);
  const taken = await decide(w, { title: 'Steal', rule: 'ordinary', effects: [
    { kind: 'participant.rekey', id: 'p-0003', key: keys.publicKeyLine(fresh.publicKey), reason: 'x' }] });
  assert.match(taken.refused[0].reason, /belongs to another participant/);
});

test('admission as an effect: participant.admit, under membership.admission_rule', async () => {
  const w = await world({ set: { 'membership.admission': 'decision' }, people: 1 });
  await w.person('p-0002');
  await w.settle(await w.sign('participant.apply', 'p-0002', { key: w.line('p-0002') }));
  assert.equal(w.state.participants['p-0002'].status, 'applicant');
  const r = await decide(w, { title: 'Admit', rule: 'ordinary', effects: [{ kind: 'participant.admit', id: 'p-0002' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(w.state.participants['p-0002'].status, 'active');
  const twice = await decide(w, { title: 'Again', rule: 'ordinary', effects: [{ kind: 'participant.admit', id: 'p-0002' }] });
  assert.match(twice.refused[0].reason, /not an applicant/);
});

test('defaults live in code: a module enabled with no parameters reads its defaults; set ones are recorded', async () => {
  const w = await world({ modules: ALL_MODULES });
  const base = paramsOf(w.state).value('entity.modules');
  const r = await decide(w, { title: 'Offices, with a term limit', rule: 'organic', install: await installFor(['offices']),
    changes: { 'entity.modules': [...base, 'offices'], 'offices.term_limit': 2 } });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const p = paramsOf(w.state);
  assert.equal(p.value('offices.fill_rule'), 'ordinary', 'the default');
  assert.equal(p.isSet('offices.fill_rule'), false);
  assert.equal(p.value('offices.term_limit'), 2, 'set in the same decision that enabled it');
  assert.deepEqual(w.state.doc.parameters['offices.term_limit'], { value: 2 }, 'the document holds only the choice');
  assert.equal(p.value('membership.removal_rule'), 'ordinary', 'kernel parameters added since 0.3 have defaults too');
  const text = parametersText(w.state);
  assert.match(text, /offices\.term_limit:\n    value: 2/);
  assert.ok(!/offices\.fill_rule/.test(text), 'defaults are not copied into parameters.yml');
  assert.equal(new Parameters(loadDocument(text), w.registry.catalog).value('offices.term_limit'), 2);
  // Setting a value back to its default is allowed.
  const back = await decide(w, { title: 'No limit', rule: 'organic', changes: { 'offices.term_limit': 0 } });
  assert.equal(back.enacted, true);
  await verified(w);
});

test('a module needing a newer core is not run: its acts wait, and say why', async () => {
  const future = { name: 'future', core: '9.0', parameters: {}, install(r) { r.registerKind({ name: 'future.do', module: 'future' }); } };
  const reg = createRegistry([future]);
  assert.equal(reg.incompatible.get('future'), '9.0');
  assert.equal(reg.has('future.do'), false);
  const w = await world();
  // As if the record had installed it: this copy's registry holds it but cannot run it.
  const st = structuredClone(w.state); st.modules.future = { source: 'pack:future', digest: 'x'.repeat(64), at: st.head.at, by: 'test' };
  w.registry.incompatible.set('future', '9.0');
  const r = await settle(w.registry, st, [await w.sign('title.set', 'p-0001', { title: 'x' })]);
  w.registry.incompatible.delete('future');
  assert.equal(r.held.length, 1);
  assert.match(r.waitingFor[0], /future \(needs core 9\.0 or later\)/);
});

test('an electorate resolves only active members, in whole-number weights', async () => {
  const w = await world();
  await decide(w, { title: 'Remove', rule: 'ordinary', effects: [{ kind: 'participant.remove', id: 'p-0002', reason: 'x' }] });
  const e = resolveElectorate(w.registry, w.state, paramsOf(w.state), w.state.head.at);
  assert.deepEqual(e.roll, { 'p-0001': 1, 'p-0003': 1 });
  assert.equal(e.total, 2);
  assert.equal(emptyState().catalog !== undefined, true);
});

test('parameters.yml records a kernel default changed by decision, where founding never wrote it', async () => {
  const w = await world();
  const r = await enact(w, { title: 'Founder rule', rule: 'entrenched', changes: { 'decision.electorate': 'founder' } });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const text = parametersText(w.state);
  assert.match(text, /decision\.electorate:\n    value: founder/);
  assert.equal(new Parameters(loadDocument(text), w.registry.catalog).value('decision.electorate'), 'founder');
});
