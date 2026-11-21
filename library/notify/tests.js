import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, enact } from '../../test/helpers.js';

test('notify: any active member posts a notice; it is kept in order; notify.broadcast can turn notices off', async () => {
  const w = await worldWith(['notify'], { people: 3 });
  const r = await w.settle(await w.sign('notice.post', 'p-0002', { title: 'Meeting moved to Thursday', text: 'Same room, 7 pm.' }));
  assert.equal(r.applied.length, 1);
  assert.deepEqual(w.state.m.notices.map(n => [n.by, n.title]), [['p-0002', 'Meeting moved to Thursday']]);
  assert.match((await w.settle(await w.sign('notice.post', 'p-0001', { title: '' }))).refused[0].reason, /title of 1–120/);
  assert.match((await w.settle(await w.sign('notice.post', 'p-0001', { title: 'x', text: 'y'.repeat(1001) }))).refused[0].reason, /1000/);
  await w.settle(await w.sign('participant.leave', 'p-0003', {}));
  assert.match((await w.settle(await w.sign('notice.post', 'p-0003', { title: 'hello' }))).refused[0].reason, /has left/);
  assert.ok((await enact(w, { title: 'No more notices', rule: 'organic', changes: { 'notify.broadcast': 'nobody' } })).enacted);
  assert.match((await w.settle(await w.sign('notice.post', 'p-0001', { title: 'still?' }))).refused[0].reason, /notices are off/);
});
