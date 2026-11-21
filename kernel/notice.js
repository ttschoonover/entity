// notice.js · notices sealed to one member, and proof that a subscription
// comes from the member it names. Shared by the node, the page and the
// service worker. Nothing here takes part in settlement.
//
// A notice is a small JSON object ({ seq, kind, title, text, url, at }) sealed
// with HPKE (kernel/crypto.js: X25519, HKDF-SHA256, AES-256-GCM) to the
// member's record key, the same key that opens the sealed record:
//
//   { v: 1, entity, to, enc, ct }      info = "entity/notice/v1\n" entity
//                                      aad  = the member's id
//
// So whoever carries it (a push service, an email provider, a node with no
// member's key, the browser profile it lands in) holds ciphertext. Opening it
// needs the member's record key, derived on their device from their own key.
//
// Subscriptions (where to send a member's notices) are kept by the node, never
// in the record. A member proves a subscription is theirs with their record
// key: both sides compute X25519(record key, node notify key), derive a MAC key
// from it (label "entity/notify/subscribe/v1"), and the member MACs the
// subscription. The node needs no signing key to check it, so a node that
// cannot read the record (zero-knowledge) can still take subscriptions: the
// record keys are public records.

import * as C from './crypto.js';
import { canonical } from './canonical.js';

export const NOTICE_VERSION = 1;
const noticeInfo = (entity) => C.utf8(`entity/notice/v1\n${entity}`);

export async function sealNotice({ entity, to, recordKey }, notice) {
  const pk = typeof recordKey === 'string' ? C.unb64(recordKey) : recordKey;
  const { enc, ct } = await C.hpkeSeal(pk, C.utf8(JSON.stringify(notice)), { info: noticeInfo(entity), aad: C.utf8(to) });
  return { v: NOTICE_VERSION, entity, to, enc: C.b64(enc), ct: C.b64(ct) };
}

export async function openNotice(sealed, recordSk) {
  if (!sealed || sealed.v !== NOTICE_VERSION) throw new Error('not a notice this code reads');
  const pt = await C.hpkeOpen(recordSk, C.unb64(sealed.enc), C.unb64(sealed.ct), { info: noticeInfo(sealed.entity), aad: C.utf8(sealed.to) });
  return JSON.parse(new TextDecoder().decode(pt));
}

// ── subscriptions ───────────────────────────────────────────────────────────
async function macKey(sk, pk, entity) {
  const shared = await C.x25519(sk, typeof pk === 'string' ? C.unb64(pk) : pk);
  return C.hkdf(shared, { info: C.utf8(`entity/notify/subscribe/v1\n${entity}`), length: 32 });
}
// The member's side: their record secret key, the node's notify public key.
export async function signRequest(body, { recordSk, nodeKey }) {
  const key = await macKey(recordSk, nodeKey, body.entity);
  return { ...body, mac: C.b64(await C.hmacSha256(key, C.utf8(canonical(body)))) };
}
// The node's side: its notify secret key, the record key the request names.
export async function checkRequest(signed, { nodeSk, recordKey }) {
  const { mac, ...body } = signed;
  if (typeof mac !== 'string') return false;
  const key = await macKey(nodeSk, recordKey, body.entity);
  const want = await C.hmacSha256(key, C.utf8(canonical(body)));
  const got = C.unb64(mac);
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= got[i] ^ want[i];
  return d === 0;
}

export const notifyKeyPair = C.hpkeKeyPair;
export const b64 = C.b64, unb64 = C.unb64;
