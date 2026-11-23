import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith } from '../../test/helpers.js';

// p-0001 founded the world, so is the first admin. p-0002 and p-0003 are members.
test('notifys: admins run houses; a house manager admits its own applicants; teams send to their level', async () => {
  const w = await worldWith(['notify', 'notifys'], { people: 3 });
  const ok = async (kind, by, f) => { const r = await w.settle(await w.sign(kind, by, f)); assert.equal(r.refused.length, 0, r.refused[0]?.reason); };
  const no = async (kind, by, f, why) => assert.match((await w.settle(await w.sign(kind, by, f))).refused[0]?.reason || 'accepted', why);

  await no('notifys.house', 'p-0002', { house: 'loth', name: 'Lothlórien' }, /only an admin/);
  await ok('notifys.house', 'p-0001', { house: 'loth', name: 'Lothlórien' });
  await ok('notifys.house', 'p-0001', { house: 'cloyne', name: 'Cloyne Court' });
  await ok('notifys.manager', 'p-0001', { house: 'loth', member: 'p-0002', on: true });
  await ok('notifys.move', 'p-0001', { member: 'p-0002', house: 'loth' });
  await ok('notifys.move', 'p-0001', { member: 'p-0003', house: 'cloyne' });

  // The manager appoints their house team, not another house's, nor the central team.
  await ok('notifys.team', 'p-0002', { team: 'loth', member: 'p-0002', on: true });
  await no('notifys.team', 'p-0002', { team: 'cloyne', member: 'p-0003', on: true }, /emergency manager/);
  await no('notifys.team', 'p-0002', { team: 'central', member: 'p-0002', on: true }, /only an admin/);

  // Alerts: the house team reaches its house; only the central team (or an admin) reaches everyone.
  await ok('notifys.alert', 'p-0002', { to: 'loth', type: 'alert', title: 'Gas smell in the kitchen', todo: 'Stay out.', severity: 'severe' });
  await no('notifys.alert', 'p-0002', { to: 'central', type: 'alert', title: 'Hello everyone' }, /central team/);
  await no('notifys.alert', 'p-0003', { to: 'loth', type: 'alert', title: 'Not my house' }, /team/);
  const first = w.state.m.notifys.alerts[0].seq;
  await no('notifys.alert', 'p-0002', { to: 'loth', type: 'allclear', title: 'All clear' }, /which alert/);
  await ok('notifys.alert', 'p-0002', { to: 'loth', type: 'allclear', title: 'Kitchen open', ref: first });
  await ok('notifys.alert', 'p-0001', { to: 'central', type: 'alert', title: 'Outage on Southside', severity: 'moderate' });
  assert.deepEqual(w.state.m.notifys.alerts.map(a => [a.to, a.type]), [['loth', 'alert'], ['loth', 'allclear'], ['central', 'alert']]);

  // House alerts reach residents (and admins); central alerts reach everyone.
  const maker = w.registry.noticeMakers.find(m => m.module === 'notifys');
  const params = { value: () => true };
  const houseRec = { kind: 'notifys.alert', payload: { act: { by: 'p-0002', to: 'loth', type: 'alert', title: 'Gas smell', todo: 'Stay out.' } } };
  const told = maker.notices(w.state, houseRec, params);
  assert.deepEqual(told.map(x => x.only).sort(), ['p-0001', 'p-0002']);
  assert.equal(told[0].title, '[Lothlórien] Gas smell');
  assert.match(told[0].text, /What to do: Stay out\.\nFrom: /);
  assert.equal(told[0].plain, true);
  assert.equal(maker.notices(w.state, { kind: 'notifys.alert', payload: { act: { by: 'p-0001', to: 'central', type: 'update', title: 'x' } } }, params)[0].only, undefined);
});

test('notifys: an applicant declares a house; its manager or an admin lets them in, nobody else', async () => {
  const w = await worldWith(['notify', 'notifys'], { people: 3 });
  const sign = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  await sign('notifys.house', 'p-0001', { house: 'loth', name: 'Lothlórien' });
  await sign('notifys.house', 'p-0001', { house: 'cloyne', name: 'Cloyne Court' });
  await sign('notifys.manager', 'p-0001', { house: 'cloyne', member: 'p-0003', on: true });
  await sign('notifys.manager', 'p-0001', { house: 'loth', member: 'p-0002', on: true });
  // Admission by decision, as Notify.S founds it.
  w.state.doc.parameters['membership.admission'] = { ...(w.state.doc.parameters['membership.admission'] || {}), value: 'decision' };
  await w.person('jun');
  const applied = await w.settle(await w.sign('participant.apply', 'jun', { key: w.line('jun'), name: 'Jun Park', about: { house: 'loth' } }));
  assert.equal(applied.refused.length, 0, applied.refused[0]?.reason);
  assert.equal(w.state.participants.jun.status, 'applicant');
  assert.deepEqual(w.state.participants.jun.declared, { house: 'loth' });
  await w.person('bad');
  assert.match((await w.settle(await w.sign('participant.apply', 'bad', { key: w.line('bad'), about: { House: 'loth' } }))).refused[0].reason, /not a fact name/);
  assert.match((await sign('notifys.admit', 'p-0003', { id: 'jun' })).refused[0].reason, /emergency manager/);
  assert.equal((await sign('notifys.admit', 'p-0002', { id: 'jun' })).refused.length, 0);
  assert.equal(w.state.participants.jun.status, 'active');
  assert.equal(w.state.m.notifys.residence.jun, 'loth');
  // The manager removes them; Cloyne's manager could not have.
  assert.match((await sign('notifys.remove', 'p-0003', { id: 'jun' })).refused[0].reason, /emergency manager/);
  assert.equal((await sign('notifys.remove', 'p-0002', { id: 'jun' })).refused.length, 0);
  assert.equal(w.state.participants.jun.status, 'removed');
  // The last admin stays.
  assert.match((await sign('notifys.admin', 'p-0001', { member: 'p-0001', on: false })).refused[0].reason, /at least one admin/);
});
