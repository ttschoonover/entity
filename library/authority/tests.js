import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords, paramsOf } from '../../kernel/index.js';
import { worldWith, decide, enact } from '../../test/helpers.js';
import authority from './index.js';

const use = async (w, by, grant, effects) => w.settle(await w.sign('authority.exercise', by, { grant, effects }));

test('authority: a deed manager acts alone, within its grant and its rate limit', async () => {
  const w = await worldWith(['offices', 'deeds', 'authority'], { people: 4 });
  const grant = { kind: 'authority.grant', grant: 'deed-manager', to: { office: 'deed-manager' }, may: ['deed.grant', 'deed.assign'],
    where: { deed: 'room-*' }, limit: { count: 2, days: 30 } };
  const weak = await decide(w, { title: 'Too easily', rule: 'ordinary', effects: [
    { kind: 'office.create', office: 'deed-manager', title: 'Deed Manager', seats: 1 }, grant] });
  assert.match(weak.refused[0].reason, /requires "organic"/);
  const r = await decide(w, { title: 'A deed manager', rule: 'organic', effects: [
    { kind: 'office.create', office: 'deed-manager', title: 'Deed Manager', seats: 1 },
    { kind: 'office.fill', office: 'deed-manager', holder: 'p-0002' }, grant] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);

  const ok = await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.grant', deed: 'room-9', title: 'Room 9', to: 'p-0003' }]);
  assert.equal(ok.applied.length, 1, ok.refused[0]?.reason);
  assert.equal(w.state.m.deeds['room-9'].holder, 'p-0003');
  assert.equal(w.state.m.deeds['room-9'].history[0].how, 'granted by grant deed-manager');
  assert.equal(ok.records.map(x => x.kind).join(' '), 'authority.exercise authority.enacted deed.grant');

  assert.match((await use(w, 'p-0003', 'deed-manager', [{ kind: 'deed.grant', deed: 'room-8', title: 'R', to: null }])).refused[0].reason, /only members of the office deed-manager/);
  assert.match((await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.grant', deed: 'bike', title: 'Bike', to: null }])).refused[0].reason, /deed "bike" is outside this grant/);
  assert.match((await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.retire', deed: 'room-9' }])).refused[0].reason, /does not permit deed.retire/);
  assert.match((await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.assign', deed: 'room-9', to: 'p-0003', proposal: 'd-fake' }])).refused[0].reason, /set by the entity/);
  assert.equal((await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.assign', deed: 'room-9', to: 'p-0004' }])).applied.length, 1);
  assert.match((await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.assign', deed: 'room-9', to: 'p-0001' }])).refused[0].reason, /limit/);
  w.jump(31);
  assert.equal((await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.assign', deed: 'room-9', to: 'p-0001' }])).applied.length, 1);

  await decide(w, { title: 'Enough', rule: 'organic', effects: [{ kind: 'authority.revoke', grant: 'deed-manager', reason: 'reorganised' }] });
  assert.match((await use(w, 'p-0002', 'deed-manager', [{ kind: 'deed.assign', deed: 'room-9', to: 'p-0002' }])).refused[0].reason, /no longer in force/);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('authority: a president appoints advisers without a vote; creating offices is never delegated by accident', async () => {
  const w = await worldWith(['offices', 'authority']);
  const setup = [
    { kind: 'office.create', office: 'president', title: 'President', seats: 1 },
    { kind: 'office.create', office: 'advisor', title: 'Advisor', seats: 3 },
    { kind: 'office.fill', office: 'president', holder: 'p-0001' }];
  const sneaky = await decide(w, { title: 'Everything', rule: 'organic', effects: [...setup,
    { kind: 'authority.grant', grant: 'all', to: { office: 'president' }, may: ['office.create', 'office.fill'] }] });
  assert.match(sneaky.refused[0].reason, /office.create can be delegated only by a grant that says delegable: true/);
  const r = await decide(w, { title: 'Presidential appointments', rule: 'organic', effects: [...setup,
    { kind: 'authority.grant', grant: 'appointments', to: { office: 'president' }, may: ['office.fill', 'office.vacate'], where: { office: ['advisor', 'press-secretary'] } }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal((await use(w, 'p-0001', 'appointments', [{ kind: 'office.fill', office: 'advisor', holder: 'p-0002' }])).applied.length, 1);
  assert.match((await use(w, 'p-0001', 'appointments', [{ kind: 'office.fill', office: 'president', holder: 'p-0002' }])).refused[0].reason, /outside this grant/);
});

test('authority: delegating a power needs at least the rule that power needs', async () => {
  const w = await worldWith(['offices', 'value', 'authority']);
  await enact(w, { title: 'Money is serious', rule: 'constitutional', changes: { 'value.issue_rule': 'constitutional' } });
  assert.equal(paramsOf(w.state).value('value.issue_rule'), 'constitutional');
  const r = await decide(w, { title: 'Treasurer issues', rule: 'organic', effects: [
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 1 },
    { kind: 'authority.grant', grant: 'mint', to: { office: 'treasurer' }, may: ['value.issue'] }] });
  assert.match(r.refused[0].reason, /requires "constitutional"/);
});

test('authority: a committee acts by co-signature, under its own rule; unsigned uses lapse', async () => {
  const w = await worldWith(['committees', 'authority'], { people: 5 });
  const r = await decide(w, { title: 'Admissions', rule: 'organic', changes: { 'membership.admission': 'decision' }, effects: [
    { kind: 'committee.create', committee: 'admissions', title: 'Admissions Committee' },
    ...['p-0001', 'p-0002', 'p-0003'].map(m => ({ kind: 'committee.appoint', committee: 'admissions', member: m })),
    { kind: 'authority.grant', grant: 'admit', to: { committee: 'admissions' }, may: ['participant.admit'] }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  for (const id of ['p-0006', 'p-0007']) { await w.person(id); await w.settle(await w.sign('participant.apply', id, { key: w.line(id) })); }

  const first = await w.sign('authority.exercise', 'p-0001', { grant: 'admit', effects: [{ kind: 'participant.admit', id: 'p-0006' }] });
  await w.settle(first);
  const x = authority.exerciseId(first);
  assert.equal(w.state.m.authority.exercises[x].needs, 2, 'a majority of three');
  assert.equal(w.state.participants['p-0006'].status, 'applicant', 'waiting for a second signature');
  const cosign = async (by, id = x) => w.settle(await w.sign('authority.cosign', by, { exercise: id }));
  assert.match((await cosign('p-0004')).refused[0].reason, /only members of the committee admissions/);
  assert.match((await cosign('p-0001')).refused[0].reason, /already signed/);
  assert.equal((await cosign('p-0002')).applied.length, 1);
  assert.equal(w.state.participants['p-0006'].status, 'active');
  assert.ok(w.state.m.authority.exercises[x].enacted);

  const late = await w.sign('authority.exercise', 'p-0003', { grant: 'admit', effects: [{ kind: 'participant.admit', id: 'p-0007' }] });
  await w.settle(late);
  w.jump(8);
  assert.match((await cosign('p-0001', authority.exerciseId(late))).refused[0].reason, /lapsed/);
});

test('authority: a grant made under a grant is no wider, and falls with it', async () => {
  const w = await worldWith(['offices', 'deeds', 'authority']);
  await decide(w, { title: 'Estates', rule: 'organic', effects: [
    { kind: 'office.create', office: 'steward', title: 'Steward', seats: 1 },
    { kind: 'office.create', office: 'porter', title: 'Porter', seats: 1 },
    { kind: 'office.fill', office: 'steward', holder: 'p-0002' },
    { kind: 'office.fill', office: 'porter', holder: 'p-0003' },
    { kind: 'authority.grant', grant: 'estates', to: { office: 'steward' }, may: ['deed.grant', 'authority.grant', 'authority.revoke'], where: { deed: 'room-*' }, delegable: true }] });
  const wide = await use(w, 'p-0002', 'estates', [{ kind: 'authority.grant', grant: 'rooms', to: { office: 'porter' }, may: ['deed.grant'], where: { deed: '*' } }]);
  assert.match(wide.refused[0].reason, /keeps its limit on deed/);
  const more = await use(w, 'p-0002', 'estates', [{ kind: 'authority.grant', grant: 'rooms', to: { office: 'porter' }, may: ['deed.retire'] }]);
  assert.match(more.refused[0].reason, /does not itself permit deed.retire/);
  const ok = await use(w, 'p-0002', 'estates', [{ kind: 'authority.grant', grant: 'rooms', to: { office: 'porter' }, may: ['deed.grant'], where: { deed: 'room-*' } }]);
  assert.equal(ok.applied.length, 1, ok.refused[0]?.reason);
  assert.equal(w.state.m.authority.grants.rooms.parent, 'estates');
  assert.equal((await use(w, 'p-0003', 'rooms', [{ kind: 'deed.grant', deed: 'room-1', title: 'Room 1', to: null }])).applied.length, 1);
  await decide(w, { title: 'Stop', rule: 'organic', effects: [{ kind: 'authority.revoke', grant: 'estates' }] });
  assert.equal(authority.inForce(w.state, 'rooms'), false);
  assert.match((await use(w, 'p-0003', 'rooms', [{ kind: 'deed.grant', deed: 'room-2', title: 'Room 2', to: null }])).refused[0].reason, /no longer in force/);
});
