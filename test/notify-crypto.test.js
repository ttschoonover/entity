// The notifications' cryptography: Web Push payload encryption against RFC
// 8291's own example and against independent libraries, VAPID headers, and
// notices sealed to a member's record key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as WP from '../cli/webpush.js';
import * as N from '../kernel/notice.js';
import { recordKeyFromSeed } from '../kernel/sealing.js';

// RFC 8291, section 5 and appendix A.
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw', auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  message: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const sub = { endpoint: 'https://push.example.net/p/abc', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };

test('web push: RFC 8291 example reproduced byte for byte, and decrypted', () => {
  const out = WP.encrypt(sub, Buffer.from(RFC.plaintext, 'base64url'), { serverPrivate: RFC.asPrivate, salt: RFC.salt });
  assert.equal(out.toString('base64url'), RFC.message);
  assert.equal(WP.decrypt(Buffer.from(RFC.message, 'base64url'), { privateKey: RFC.uaPrivate, auth: RFC.auth }).toString(), 'When I grow up, I want to be a watermelon');
});

test('web push: random keys and salt each time; refuses bad subscription keys and oversize payloads', () => {
  const a = WP.encrypt(sub, 'hi'), b = WP.encrypt(sub, 'hi');
  assert.notEqual(a.toString('hex'), b.toString('hex'));
  assert.equal(WP.decrypt(a, { privateKey: RFC.uaPrivate, auth: RFC.auth }).toString(), 'hi');
  assert.throws(() => WP.encrypt({ keys: { p256dh: 'AAAA', auth: RFC.auth } }, 'x'), /P-256/);
  assert.throws(() => WP.encrypt(sub, 'x'.repeat(4000)), /at most/);
});

test('vapid: an ES256 token for the push service origin, verifiable with the public key', () => {
  const v = WP.vapidKeys();
  const hdr = WP.vapidHeader('https://fcm.googleapis.com/fcm/send/xyz', v, { subject: 'mailto:a@b.c', now: 1_700_000_000_000 });
  const [, jwt, k] = hdr.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, v.publicKey);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:a@b.c' });
  const pub = Buffer.from(v.publicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

// Independent implementations: http_ece (Mozilla's) and web-push, when present
// (WEBPUSH_LIBS=/dir/with/node_modules). The repository itself has no dependencies.
const libs = process.env.WEBPUSH_LIBS;
test('web push: interoperates with http_ece and web-push', { skip: !libs && 'set WEBPUSH_LIBS to a folder where web-push and http_ece are installed' }, async () => {
  const req = createRequire(path.join(libs, 'x.js'));
  const ece = req('http_ece'), webpush = req('web-push');
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const s = { endpoint: 'https://push.example.net/p/1', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  // ours → theirs
  const body = WP.encrypt(s, 'a notice, sealed twice');
  assert.equal(ece.decrypt(body, { version: 'aes128gcm', privateKey: ua, authSecret: auth.toString('base64url') }).toString(), 'a notice, sealed twice');
  // theirs → ours
  const theirs = webpush.encrypt(s.keys.p256dh, s.keys.auth, 'from web-push', 'aes128gcm');
  assert.equal(WP.decrypt(theirs.cipherText, { privateKey: ua.getPrivateKey().toString('base64url'), auth: s.keys.auth }).toString(), 'from web-push');
  // their VAPID verifier accepts our key format
  const v = WP.vapidKeys();
  assert.doesNotThrow(() => webpush.setVapidDetails('mailto:a@b.c', v.publicKey, v.privateKey));
});

test('notice: sealed to one member, opened only with their record key, bound to entity and member', async () => {
  const alice = await recordKeyFromSeed(crypto.randomBytes(32)), bob = await recordKeyFromSeed(crypto.randomBytes(32));
  const note = { seq: 7, kind: 'proposal.open', title: 'Buy a dishwasher', text: 'needs your vote', url: '#/votes', at: '2026-11-20T00:00:00Z' };
  const s = await N.sealNotice({ entity: 'e-1', to: 'p-0001', recordKey: N.b64(alice.pk) }, note);
  assert.ok(!JSON.stringify(s).includes('dishwasher'));
  assert.deepEqual(await N.openNotice(s, alice.sk), note);
  await assert.rejects(N.openNotice(s, bob.sk));
  await assert.rejects(N.openNotice({ ...s, to: 'p-0002' }, alice.sk), 'the member id is authenticated');
  await assert.rejects(N.openNotice({ ...s, entity: 'e-2' }, alice.sk), 'so is the entity');
});

test('subscription: proved with the record key, checked by a node holding no signing key', async () => {
  const member = await recordKeyFromSeed(crypto.randomBytes(32)), node = await N.notifyKeyPair(), other = await recordKeyFromSeed(crypto.randomBytes(32));
  const body = { entity: 'e-1', member: 'p-0001', op: 'subscribe', channel: 'push', push: sub, at: '2026-11-20T00:00:00Z' };
  const signed = await N.signRequest(body, { recordSk: member.sk, nodeKey: N.b64(node.pk) });
  assert.equal(await N.checkRequest(signed, { nodeSk: node.sk, recordKey: N.b64(member.pk) }), true);
  assert.equal(await N.checkRequest({ ...signed, member: 'p-0002' }, { nodeSk: node.sk, recordKey: N.b64(member.pk) }), false);
  assert.equal(await N.checkRequest(signed, { nodeSk: node.sk, recordKey: N.b64(other.pk) }), false);
  assert.equal(await N.checkRequest({ ...body }, { nodeSk: node.sk, recordKey: N.b64(member.pk) }), false);
});
