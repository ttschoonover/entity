import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import tasks from './index.js';

test('tasks: posted, claimed, done, verified by someone else; hours tallied and, if chosen, paid', async () => {
  const w = await worldWith(['value', 'tasks']);
  await decide(w, { title: 'Pay for shifts', rule: 'organic', changes: { 'tasks.pay_per_hour': 10 } });
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  assert.equal((await act('task.post', 'p-0001', { task: 'kitchen', title: 'Clean the kitchen', hours: 1.5 })).applied.length, 1);
  assert.match((await act('task.post', 'p-0001', { task: 'x', title: 'X', hours: 1.3 })).refused[0].reason, /quarter hours/);
  await act('task.claim', 'p-0002', { task: 'kitchen' });
  assert.match((await act('task.claim', 'p-0003', { task: 'kitchen' })).refused[0].reason, /p-0002 has claimed it/);
  await act('task.done', 'p-0002', { task: 'kitchen', note: 'mopped too' });
  assert.match((await act('task.verify', 'p-0002', { task: 'kitchen' })).refused[0].reason, /someone other than/);
  const v = await act('task.verify', 'p-0003', { task: 'kitchen' });
  assert.deepEqual(v.records.map(r => r.kind), ['task.verify', 'task.credited', 'value.issue']);
  assert.equal(tasks.hoursOf(w.state, 'p-0002'), 1.5);
  assert.equal(w.state.m.value.balances['p-0002'], 15);
  assert.match((await act('task.claim', 'p-0001', { task: 'kitchen' })).refused[0].reason, /no open task/);
});
