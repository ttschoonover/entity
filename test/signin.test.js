// Signing in with a password or a passkey: the keys, the signatures, and how
// every copy checks them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keys, passwordKey, passwordProblem, settle, draft, signedMaterial } from '../kernel/index.js';
import { world, device } from './helpers.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const sha = async (b) => new Uint8Array(await subtle.digest('SHA-256', b));
const b64url = (b) => Buffer.from(b).toString('base64url');

test('a password gives the same key on every device, and a different one for another member or entity', async () => {
  const a = await passwordKey('e-1', 'ana', 'correct horse battery staple');
  const b = await passwordKey('e-1', 'ana', 'correct horse battery staple');
  assert.deepEqual(a.publicKey, b.publicKey);
  assert.notDeepEqual((await passwordKey('e-1', 'ben', 'correct horse battery staple')).publicKey, a.publicKey);
  assert.notDeepEqual((await passwordKey('e-2', 'ana', 'correct horse battery staple')).publicKey, a.publicKey);
  const sig = await keys.sign('hello', a, 'entity.act');
  assert.equal((await keys.verify('hello', sig, [keys.publicKeyLine(a.publicKey)], 'entity.act')).ok, true);
  assert.match(passwordProblem('short', 'ana'), /at least 12/);
  assert.match(passwordProblem('ana-is-great-1', 'ana'), /username/);
  assert.match(passwordProblem('password12345'), /most common/);
  assert.equal(passwordProblem('correct horse battery staple'), null);
});

test('a member signs in and acts with a password key', async () => {
  const w = await world();
  const k = await passwordKey(w.entity, 'p-0009', 'long enough passphrase 7');
  const apply = await (async () => { const a = draft('participant.apply', { entity: w.entity, by: 'p-0009', at: new Date().toISOString(), key: keys.publicKeyLine(k.publicKey) });
    const { message, namespace } = signedMaterial(w.registry, a); return { ...a, signature: await keys.sign(message, k, namespace) }; })();
  const r = await w.settle(apply);
  assert.equal(r.applied.length, 1, r.refused[0]?.reason);
});

test('passkeys: a real signature is accepted; every forgery is refused', async () => {
  const d = await device('poezine.org');
  const ok = await d.sign('the act', 'entity.act');
  assert.equal((await keys.verify('the act', ok, [d.line], 'entity.act')).ok, true);
  assert.equal(keys.signerKeyLine(ok), keys.keyId(d.line));
  const bad = async (sig, msg = 'the act', ns = 'entity.act', ks = [d.line]) => (await keys.verify(msg, sig, ks, ns)).error;
  assert.match(await bad(ok, 'another act'), /signed something else/);
  assert.match(await bad(ok, 'the act', 'entity.ballot'), /signed something else/);
  assert.match(await bad(await d.sign('the act', 'entity.act', { origin: 'https://evil.example' })), /not on poezine.org/);
  assert.match(await bad(await d.sign('the act', 'entity.act', { rpId: 'evil.example' })), /another website/);
  assert.match(await bad(await d.sign('the act', 'entity.act', { flags: 0x04 })), /no person was present/);
  const other = await device('poezine.org');
  assert.match(await bad(ok, 'the act', 'entity.act', [other.line]), /not among those allowed/);
  assert.equal((await keys.verify('x', await (await device('localhost')).sign('x', 'ns', { origin: 'http://localhost:7780', rpId: 'localhost' }),
    [(await device('localhost')).line], 'ns')).ok, false, 'another device\'s key');
});

test('a member joins and acts with nothing but a passkey', async () => {
  const w = await world();
  const d = await device('poezine.org');
  const act = async (kind, by, fields) => {
    const a = draft(kind, { entity: w.entity, by, at: new Date().toISOString(), ...fields });
    const { message, namespace } = signedMaterial(w.registry, a);
    return { ...a, signature: await d.sign(message, namespace) };
  };
  const r = await w.settle(await act('participant.apply', 'p-face', { key: d.line }));
  assert.equal(r.applied.length, 1, r.refused[0]?.reason);
  assert.equal(w.state.participants['p-face'].keys[0], keys.keyId(d.line));
  const t = await w.settle(await act('title.set', 'p-face', { title: 'Face' }));
  assert.equal(t.applied.length, 1, t.refused[0]?.reason);
  const forged = { ...(await act('title.set', 'p-face', { title: 'x' })), title: 'tampered' };
  assert.match((await w.settle(forged)).refused[0].reason, /signature|signed something else/);
});
