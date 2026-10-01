import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith } from '../../test/helpers.js';
import polls from './index.js';

test('polls: opened by any member, answered once each (latest counts), closed by date or by the opener', async () => {
  const w = await worldWith(['polls'], { people: 4 });
  const open = await w.sign('poll.open', 'p-0002', { question: 'Pizza or tacos?', options: ['pizza', 'tacos', 'both'], days: 3 });
  await w.settle(open);
  const id = polls.pollId(open);
  const say = async (by, choices) => w.settle(await w.sign('poll.answer', by, { poll: id, choices }));
  assert.equal((await say('p-0001', ['pizza'])).applied.length, 1);
  await say('p-0001', ['tacos']);
  await say('p-0003', ['tacos']);
  assert.match((await say('p-0004', ['pizza', 'tacos'])).refused[0].reason, /one choice/);
  assert.match((await say('p-0004', ['sushi'])).refused[0].reason, /choose from/);
  assert.deepEqual(polls.results(w.state.m.polls[id]).counts, { pizza: 0, tacos: 2, both: 0 });
  assert.match((await w.settle(await w.sign('poll.close', 'p-0001', { poll: id }))).refused[0].reason, /only the member who opened/);
  w.jump(4);
  assert.match((await say('p-0004', ['both'])).refused[0].reason, /closed/);
  const ap = await w.sign('poll.open', 'p-0001', { question: 'Which evenings?', options: ['mon', 'tue', 'wed'], mode: 'approval' });
  await w.settle(ap);
  assert.equal((await w.settle(await w.sign('poll.answer', 'p-0002', { poll: polls.pollId(ap), choices: ['mon', 'wed'] }))).applied.length, 1);
  await w.person('p-late'); await w.settle(await w.sign('participant.apply', 'p-late', { key: w.line('p-late') }));
  const late = await w.settle(await w.sign('poll.answer', 'p-late', { poll: polls.pollId(ap), choices: ['mon'] }));
  assert.match(late.refused[0].reason, /not a member when this poll opened/);
});
