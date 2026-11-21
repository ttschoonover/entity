// webpush.js · Web Push from a node: payload encryption (RFC 8291, the
// "aes128gcm" content coding of RFC 8188) and the node's identity to push
// services (VAPID, RFC 8292). No dependencies: node:crypto only.
//
// What a push service sees: the endpoint, the size and time of each message,
// and the node's VAPID public key. The payload is encrypted to the browser's
// subscription key; inside it, the notice itself is sealed again to the
// member's record key (kernel/notice.js), so a browser profile without the
// member's key learns nothing either.

import crypto from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const expand = (prk, info, n) => hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, n);
const RS = 4096;

// Encrypt one push payload to a subscription { keys: { p256dh, auth } }.
// `test` = { serverPrivate, salt } reproduces RFC 8291's example only.
export function encrypt(subscription, payload, test = null) {
  const uaPublic = unb64u(subscription.keys.p256dh), auth = unb64u(subscription.keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('the subscription key is not an uncompressed P-256 point');
  if (auth.length !== 16) throw new Error('the subscription secret is not 16 bytes');
  const ecdh = crypto.createECDH('prime256v1');
  if (test?.serverPrivate) ecdh.setPrivateKey(unb64u(test.serverPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  // IKM = HKDF(auth, ecdh_secret, "WebPush: info" 0 ua_public as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = expand(hmac(auth, secret), keyInfo, 32);
  const salt = test?.salt ? unb64u(test.salt) : crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = expand(prk, 'Content-Encoding: nonce\0', 12);
  const body = Buffer.from(payload);
  if (body.length > RS - 17 - 86) throw new Error(`a push payload holds at most ${RS - 17 - 86} bytes`);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([body, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(RS, 16); header[20] = 65;
  return Buffer.concat([header, asPublic, ct]);
}

// The reverse, for tests: what the browser does with its private key.
export function decrypt(body, { privateKey, auth }) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(unb64u(privateKey));
  const uaPublic = ecdh.getPublicKey();
  const ikm = expand(hmac(unb64u(auth), ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const prk = hmac(salt, ikm);
  const d = crypto.createDecipheriv('aes-128-gcm', expand(prk, 'Content-Encoding: aes128gcm\0', 16), expand(prk, 'Content-Encoding: nonce\0', 12));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = padded.length - 1; while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error('bad padding delimiter');
  return padded.subarray(0, end);
}

// ── VAPID: the node's own P-256 key, kept in .entity/notify/vapid.json ──────
export function vapidKeys() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}
function vapidPrivateKey({ publicKey, privateKey }) {
  const pub = unb64u(publicKey);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}
export function vapidHeader(endpoint, vapid, { subject = 'mailto:nobody@invalid', now = Date.now(), hours = 12 } = {}) {
  const aud = new URL(endpoint).origin;
  const part = (o) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp: Math.floor(now / 1000) + hours * 3600, sub: subject })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: vapidPrivateKey(vapid), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// Send one push. Returns { status, gone } (gone: the subscription has ended,
// 404 or 410, and should be dropped).
export async function send(subscription, payload, vapid, { ttl = 86400, urgency = 'normal', subject, fetchImpl = fetch } = {}) {
  const body = encrypt(subscription, payload);
  const r = await fetchImpl(subscription.endpoint, { method: 'POST', body, headers: {
    authorization: vapidHeader(subscription.endpoint, vapid, { subject }), 'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream', ttl: String(ttl), urgency } });
  return { status: r.status, gone: r.status === 404 || r.status === 410 };
}
