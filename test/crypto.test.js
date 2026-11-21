// kernel/crypto.js: the published test vectors, the portable ladder against
// the native one, and data sealed by the hand-written code of 0.9.34, which
// must still open now that sealed, documents and chat use the kernel's crypto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../kernel/crypto.js';
import * as S from '../library/sealed/box.js';
import * as D from '../library/docs/crypto.js';
import * as CC from '../interface/js/chatcrypto.js';

const u = C.unhex, h = C.hex;

test('crypto: X25519 matches RFC 7748', async () => {
  // §5.2, the two single-step tests
  assert.equal(h(await C.x25519(u('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'), u('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'))),
    'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
  assert.equal(h(await C.x25519(u('4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d'), u('e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493'))),
    h(C.x25519Portable(u('4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d'), u('e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493'))));
  // §6.1, Diffie-Hellman
  const a = u('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'), b = u('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  assert.equal(h(await C.x25519Public(a)), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(h(await C.x25519Public(b)), 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
  assert.equal(h(await C.x25519(a, await C.x25519Public(b))), shared);
  assert.equal(h(await C.x25519(b, await C.x25519Public(a))), shared);
});

test('crypto: the portable ladder gives the native bytes, and low-order keys are refused', async () => {
  for (let i = 0; i < 25; i++) {
    const k = C.random(32), p = await C.x25519Public(C.random(32));
    assert.equal(h(await C.x25519(k, p)), h(C.x25519Portable(k, p)));
  }
  await assert.rejects(C.x25519(C.random(32), new Uint8Array(32)), /not a usable/);
  const one = new Uint8Array(32); one[0] = 1;
  await assert.rejects(C.x25519(C.random(32), one), /not a usable/);
  assert.equal(await C.hasNativeX25519(), true, 'Node has native X25519');
});

test('crypto: HKDF matches RFC 5869 test case 1', async () => {
  const okm = await C.hkdf(u('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'), { salt: u('000102030405060708090a0b0c'), info: u('f0f1f2f3f4f5f6f7f8f9'), length: 42 });
  assert.equal(h(okm), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
});

test('crypto: HPKE matches RFC 9180 A.1.1 and refuses tampering', async () => {
  const V = { info: '4f6465206f6e2061204772656369616e2055726e', skEm: '52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736', pkEm: '37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431',
    skRm: '4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8', pkRm: '3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d',
    shared: 'fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc', key: '4531685d41d65f03dc48f6b8302c05b0', nonce: '56d890e5accaaf011cff4b7d',
    exporter: '45ff1c2e220db587171952c0592d5f5ebe103f1561a2614e38f2ffd47e99e3f8', pt: '4265617574792069732074727574682c20747275746820626561757479', aad: '436f756e742d30',
    ct: 'f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a96d8770ac83d07bea87e13c512a' };
  assert.equal(h(await C.x25519Public(u(V.skRm))), V.pkRm);
  const s = await C.hpkeSeal(u(V.pkRm), u(V.pt), { info: u(V.info), aad: u(V.aad), aead: 0x0001, ephemeral: u(V.skEm) });
  assert.equal(h(s.enc), V.pkEm);
  assert.equal(h(s._schedule.shared), V.shared);
  assert.equal(h(s._schedule.key), V.key);
  assert.equal(h(s._schedule.nonce), V.nonce);
  assert.equal(h(s._schedule.exporter), V.exporter);
  assert.equal(h(s.ct), V.ct);
  assert.equal(h(await C.hpkeOpen(u(V.skRm), u(V.pkEm), u(V.ct), { info: u(V.info), aad: u(V.aad), aead: 0x0001 })), V.pt);
  // entity's own suite (AES-256-GCM): round trip, and every tampering refused
  const { sk, pk } = await C.hpkeKeyPair();
  const m = await C.sealText(pk, 'for members only', { info: C.utf8('entity/test'), aad: C.utf8('seq 7') });
  assert.equal(await C.openText(sk, m.enc, m.ct, { info: C.utf8('entity/test'), aad: C.utf8('seq 7') }), 'for members only');
  await assert.rejects(C.openText(sk, m.enc, m.ct, { info: C.utf8('entity/other'), aad: C.utf8('seq 7') }));
  await assert.rejects(C.openText(sk, m.enc, m.ct, { info: C.utf8('entity/test'), aad: C.utf8('seq 8') }));
  const bent = Uint8Array.from(m.ct); bent[3] ^= 1;
  await assert.rejects(C.openText(sk, m.enc, bent, { info: C.utf8('entity/test'), aad: C.utf8('seq 7') }));
  await assert.rejects(C.openText((await C.hpkeKeyPair()).sk, m.enc, m.ct, { info: C.utf8('entity/test'), aad: C.utf8('seq 7') }));
});

// Sealed by the 0.9.34 code (its own hand-written X25519), before the switch.
const OLD = {"seedA":"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=","seedB":"yMfGxcTDwsHAv769vLu6ubi3trW0s7KxsK+urayrqqk=","sealed":{"pubA":"wpEz5t4GEp3qe2a9Iyc5jx8wBydZgrUMoN0oKnN8AQo=","wrap":{"epk":"u08sI2GZ81smxWd4JTzuHqkQsUQmFmn1KHpsUPpQMEI=","nonce":"9yTmLYBvYzSMMUQX","ct":"QU0+NbFYOzDaro3xxyeN+67PCTtnaSXKLv53OU/cl67dQA9mC5wq9kv0lHUEBrb0"},"content":{"nonce":"VuzfHjoXxdcvwC5E","ct":"HtQmlVQ3lL/ZEFNacuyJVbEmDz2qb//jqIb5LPMc2XIp9IDYIway0kS+yE6+TZj1/62q0C0="},"text":"Minutes of the sealed meeting \u00b7 2026"},"docs":{"xpkA":"rInV1BTywRGzHPXkO/9gZxIOXDBu6qi4AIuI2F6uyAc=","xpkB":"mbKCRnfNTgE32bDUtcAs00f1y3st0uhiZ1V9F+q2xnk=","w":{"entity":"e-test-000001","doc":"budget","epoch":3},"wrap":{"fromXpk":"mbKCRnfNTgE32bDUtcAs00f1y3st0uhiZ1V9F+q2xnk=","iv":"VFQ2jD4mgGUBAopX","ct":"f8XeObGxW5b0mCiolaOieZQbD50avHc3q3xDHiqlG1VTtbrgBONoXjmPwZ/pUKpD"},"sealed":{"epoch":3,"iv":"BPCcadqr2NKwFNim","ct":"0rJ4IDaxx7mkmZYPoRFLnzJKPQ3XKOZ/sesDkmoYsIPysT2ZKsL4"},"value":{"lines":["rent",1200]}},"chat":{"xpkA":"WBOFUdQwKYdA5yzP3yAgmTZZL3upnMci82DYomCD4mw=","xpkB":"LdnTt8d8hi2pu/GaWw2Z/Vce7Wg/RwKBGMuTlU2b/QA=","w":{"entity":"e-test-000001","channel":"partners","epoch":2},"wrap":{"fromXpk":"LdnTt8d8hi2pu/GaWw2Z/Vce7Wg/RwKBGMuTlU2b/QA=","iv":"zvQ8y6GVAzJCE1eE","ct":"AVIRLdkNR4hyUj3NYc9p5G1jrrHVDN0HhJuEDWWKSBnpcZAf1dC6dl7iwMrCU85e"},"m":{"entity":"e-test-000001","channel":"partners","epoch":2,"by":"p-0002","at":"2026-11-20T10:00:00.000Z","nonce":"n1"},"sealed":{"epoch":2,"iv":"Hyk4+utBiTp1J87v","ct":"k6mK5+Jbg5lZbcw4OUdgUkGLjh3VZ3kAmQrFNAda0vVDxPOryg=="},"text":"the vote is on Friday"}};

test('crypto: what was sealed before still opens (sealed posts, documents, chat)', async () => {
  const seedA = C.unb64(OLD.seedA), seedB = C.unb64(OLD.seedB);
  // sealed: same member key, the group key unwraps, the content decrypts
  const a = await S.memberKeys(seedA);
  assert.equal(S.b64(a.pub), OLD.sealed.pubA, 'the member key is derived as before');
  const gk = await S.openWith(a.priv, a.pub, OLD.sealed.wrap);
  assert.equal(await S.decrypt(gk, OLD.sealed.content), OLD.sealed.text);
  // documents
  const da = await D.memberKey(seedA), db = await D.memberKey(seedB);
  assert.equal(da.xpk, OLD.docs.xpkA); assert.equal(db.xpk, OLD.docs.xpkB);
  const dk = await D.unwrapKey({ me: da, wrap: OLD.docs.wrap, ...OLD.docs.w });
  assert.deepEqual(await D.unseal({ key: dk, sealed: OLD.docs.sealed, context: 'ctx:budget:3' }), OLD.docs.value);
  // chat
  const ca = await CC.memberKey(seedA), cb = await CC.memberKey(seedB);
  assert.equal(ca.xpk, OLD.chat.xpkA); assert.equal(cb.xpk, OLD.chat.xpkB);
  const ck = await CC.unwrapKey({ me: ca, wrap: OLD.chat.wrap, ...OLD.chat.w });
  assert.equal(await CC.unseal({ key: ck, sealed: OLD.chat.sealed, ...OLD.chat.m }), OLD.chat.text);
  // and what the new code seals opens too
  const box = await S.sealTo(S.b64(a.pub), gk);
  assert.equal(S.b64(await S.openWith(a.priv, a.pub, box)), S.b64(gk));
});
