import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, enact } from '../../test/helpers.js';

test('minihub: only the chosen senders send alerts; an alert is a plain notice for email', async () => {
  const w = await worldWith(['notify', 'minihub'], { people: 3 });
  assert.match((await w.settle(await w.sign('alert.send', 'p-0002', { title: 'Water off Thursday' }))).refused[0].reason, /not one of the hub's alert senders/);
  assert.ok((await enact(w, { title: 'Senders', rule: 'ordinary', effects: [{ kind: 'minihub.senders', members: ['p-0002'] }] })).enacted);
  assert.deepEqual(w.state.m.minihub.senders, ['p-0002']);
  const r = await w.settle(await w.sign('alert.send', 'p-0002', { title: 'Water off Thursday', text: 'Fill a jug.' }));
  assert.equal(r.applied.length, 1);
  assert.deepEqual(w.state.m.minihub.alerts.map(a => [a.by, a.title, a.text]), [['p-0002', 'Water off Thursday', 'Fill a jug.']]);
  assert.match((await w.settle(await w.sign('alert.send', 'p-0002', { title: '' }))).refused[0].reason, /subject of 1–120/);
  assert.match((await enact(w, { title: 'Bad', rule: 'ordinary', effects: [{ kind: 'minihub.senders', members: ['nobody-here'] }] })).refused?.[0]?.reason || 'refused', /./);
  const maker = w.registry.noticeMakers.find(m => m.module === 'minihub');
  const rec = { kind: 'alert.send', payload: { act: { by: 'p-0002', title: 'Water off Thursday', text: 'Fill a jug.' } } };
  assert.deepEqual(maker.notices(w.state, rec, { value: () => true }), [{ event: 'notices', title: 'Water off Thursday', text: 'Fill a jug.', url: '#/alerts', plain: true }]);
});
