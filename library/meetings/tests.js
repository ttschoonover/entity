import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';

test('meetings: called by decision; members check themselves in within the window; minutes drafted and approved', async () => {
  const w = await worldWith(['meetings']);
  const starts = new Date(Date.parse(w.at()) + 2 * 86400000).toISOString();
  const r = await decide(w, { title: 'Call', rule: 'ordinary', effects: [{ kind: 'meeting.call', meeting: 'gm-1', title: 'General meeting', starts, agenda: ['Budget', 'Rota'] }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const attend = async (by) => w.settle(await w.sign('meeting.attend', by, { meeting: 'gm-1' }));
  assert.match((await attend('p-0001')).refused[0].reason, /check-in opens/);
  w.jump(2);
  assert.equal((await attend('p-0001')).applied.length, 1);
  assert.match((await attend('p-0001')).refused[0].reason, /already checked in/);
  const draft = async (by, text) => w.settle(await w.sign('meeting.minutes', by, { meeting: 'gm-1', text }));
  await draft('p-0002', 'Budget approved.'); await draft('p-0003', 'Budget approved. Rota agreed.');
  await decide(w, { title: 'Approve', rule: 'ordinary', effects: [{ kind: 'meeting.approve', meeting: 'gm-1', version: 2 }] });
  const m = w.state.m.meetings['gm-1'];
  assert.equal(m.approved.version, 2); assert.deepEqual(Object.keys(m.attendance), ['p-0001']);
  w.jump(1);
  assert.match((await attend('p-0002')).refused[0].reason, /check-in closed/);
});
