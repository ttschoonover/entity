import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keys, passwordKey } from '../../kernel/index.js';
import { worldWith } from '../../test/helpers.js';

test('passwords: set, changed (the old one stops working), removed only if another way remains', async () => {
  const w = await worldWith(['passwords']);
  const act = async (kind, by, f, key) => w.settle(await w.sign(kind, by, f, key));
  const one = await passwordKey(w.entity, 'p-0002', 'first long passphrase 1');
  assert.equal((await act('password.set', 'p-0002', { key: keys.publicKeyLine(one.publicKey) })).applied.length, 1);
  assert.equal((await act('title.set', 'p-0002', { title: 'by password' }, one)).applied.length, 1, 'signs in with the password');
  const two = await passwordKey(w.entity, 'p-0002', 'second long passphrase 2');
  await act('password.set', 'p-0002', { key: keys.publicKeyLine(two.publicKey) }, one);
  assert.match((await act('title.set', 'p-0002', { title: 'old' }, one)).refused[0].reason, /signature invalid|not among/, 'the old password no longer works');
  assert.equal((await act('title.set', 'p-0002', { title: 'new' }, two)).applied.length, 1);
  assert.match((await act('password.set', 'p-0003', { key: keys.publicKeyLine(two.publicKey) })).refused[0].reason, /belongs to another member/);
  assert.equal((await act('password.remove', 'p-0002', {}, two)).applied.length, 1, 'their original key remains');
  assert.equal(w.state.m.passwords['p-0002'], undefined);
});
