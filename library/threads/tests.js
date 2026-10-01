import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import threads from './index.js';

test('threads: posts, replies, votes, edits, deletion', async () => {
  const w = await worldWith(['threads']);
  const act = async (kind, by, f) => { const a = await w.sign(kind, by, f); const r = await w.settle(a); return { a, r }; };
  const { a: post } = await act('post.create', 'p-0001', { board: 'general', title: 'Hello', body: 'First post' });
  const pid = threads.postId(post);
  assert.match((await act('post.create', 'p-0001', { board: 'nope', title: 'x', body: 'y' })).r.refused[0].reason, /no board "nope"/);
  const { a: reply } = await act('post.reply', 'p-0002', { to: pid, body: 'Welcome' });
  assert.deepEqual(w.state.m.threads.items[pid].replies, [threads.postId(reply)]);
  await act('post.vote', 'p-0002', { target: pid, value: 1 });
  await act('post.vote', 'p-0003', { target: pid, value: -1 });
  await act('post.vote', 'p-0003', { target: pid, value: 1 });
  assert.equal(threads.score(w.state.m.threads.items[pid]), 2, 'a later vote replaces an earlier one');
  assert.match((await act('post.edit', 'p-0002', { target: pid, body: 'hijack' })).r.refused[0].reason, /only the author/);
  await act('post.edit', 'p-0001', { target: pid, body: 'First post, edited' });
  assert.equal(w.state.m.threads.items[pid].edits, 1);
  await act('post.delete', 'p-0001', { target: pid });
  assert.ok(w.state.m.threads.items[pid].deleted);
  assert.match((await act('post.reply', 'p-0003', { to: pid, body: 'late' })).r.refused[0].reason, /removed/);
});

test('threads: moderators hide posts only if they hold the named office', async () => {
  const w = await worldWith(['threads', 'offices']);
  const { a: post } = { a: await w.sign('post.create', 'p-0003', { board: 'general', title: 'Spam', body: 'buy now' }) };
  await w.settle(post);
  const pid = threads.postId(post);
  const hide = async (by) => w.settle(await w.sign('post.hide', by, { target: pid, reason: 'spam' }));
  assert.match((await hide('p-0001')).refused[0].reason, /no moderator office/);
  await decide(w, { title: 'Moderators', rule: 'organic', changes: { 'threads.moderator_office': 'mods' }, effects: [
    { kind: 'office.create', office: 'mods', title: 'Moderators', seats: 2, term_days: 90 },
    { kind: 'office.fill', office: 'mods', holder: 'p-0001' }] });
  assert.match((await hide('p-0002')).refused[0].reason, /only holders of the mods office/);
  assert.equal((await hide('p-0001')).applied.length, 1);
  assert.equal(w.state.m.threads.items[pid].hidden.reason, 'spam');
});

test('threads: a post can be hidden by decision without any office', async () => {
  const w = await worldWith(['threads']);
  const post = await w.sign('post.create', 'p-0002', { board: 'general', title: 'Off topic', body: '…' });
  await w.settle(post);
  const r = await decide(w, { title: 'Hide it', rule: 'ordinary', effects: [{ kind: 'thread.hide', target: threads.postId(post), reason: 'off topic' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
});
