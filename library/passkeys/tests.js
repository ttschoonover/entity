import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draft, signedMaterial, keys } from '../../kernel/index.js';
import { worldWith, device } from '../../test/helpers.js';

test('passkeys: added and named, then used to sign; removed only if another way remains', async () => {
  const w = await worldWith(['passkeys']);
  const phone = await device('poezine.org');
  const r = await w.settle(await w.sign('passkey.add', 'p-0002', { key: phone.line, name: 'iPhone' }));
  assert.equal(r.applied.length, 1, r.refused[0]?.reason);
  assert.equal(w.state.m.passkeys['p-0002'][0].name, 'iPhone');
  const a = draft('title.set', { entity: w.entity, by: 'p-0002', at: w.at(), title: 'Face ID' });
  const { message, namespace } = signedMaterial(w.registry, a);
  assert.equal((await w.settle({ ...a, signature: await phone.sign(message, namespace) })).applied.length, 1, 'signs with the passkey');
  assert.match((await w.settle(await w.sign('passkey.add', 'p-0003', { key: phone.line, name: 'mine' }))).refused[0].reason, /belongs to another member/);
  assert.match((await w.settle(await w.sign('passkey.add', 'p-0003', { key: keys.publicKeyLine((await keys.generate()).publicKey), name: 'x' }))).refused[0].reason, /passkey line/);
  assert.equal((await w.settle(await w.sign('passkey.remove', 'p-0002', { key: phone.line }))).applied.length, 1);
  assert.deepEqual(w.state.m.passkeys['p-0002'], []);
});
