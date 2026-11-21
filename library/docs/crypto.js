// crypto · end-to-end encryption for documents, the same code in the browser
// and in Node (tests). Nothing here touches the record. The primitives come
// from kernel/crypto.js (native Web Crypto); the derivations and labels below
// are unchanged, so every document sealed before still opens.
//
// Each member has an encryption key pair (X25519, RFC 7748) derived from the
// seed of their signing key, registered as a signed xkey file. Each encrypted
// document has a key per epoch: 32 random bytes, wrapped for every reader's
// key (X25519 → HKDF → AES-GCM). Text is sealed with the document key
// (AES-GCM), bound to the document, the kind of file, its author, time and
// place in the history. When someone loses access, the next person to write
// starts a new epoch that leaves them out; what they already read, they keep.
import { x25519, x25519Public, random, b64, unb64, hkdf, aeadSeal, aeadOpen, utf8, concat } from '../../kernel/crypto.js';

export { b64, unb64, random, x25519 };
const subtle = () => globalThis.crypto.subtle;
const dec = new TextDecoder();

// A member's document key pair, from the 32-byte seed of their signing key.
export async function memberKey(seed) {
  const xsk = new Uint8Array(await subtle().digest('SHA-256', concat(utf8('athenes.docs.x25519\n'), seed)));
  return { xsk, xpk: b64(await x25519Public(xsk)) };
}
async function kek(xsk, fromXpk, toXpk, theirXpk, w) {
  let shared;
  try { shared = await x25519(xsk, unb64(theirXpk)); } catch { throw new Error('a key that is not a key'); }
  return hkdf(shared, { salt: utf8(`${w.entity}\n${w.doc}\n${w.epoch}`), info: utf8(`athenes.docs.wrap\n${fromXpk}\n${toXpk}`), length: 32 });
}
export async function wrapKey({ me, toXpk, key, entity, doc, epoch }) {
  const iv = random(12);
  const k = await kek(me.xsk, me.xpk, toXpk, toXpk, { entity, doc, epoch });
  return { fromXpk: me.xpk, iv: b64(iv), ct: b64(await aeadSeal(k, iv, key)) };
}
export async function unwrapKey({ me, wrap, entity, doc, epoch }) {
  const k = await kek(me.xsk, wrap.fromXpk, me.xpk, wrap.fromXpk, { entity, doc, epoch });
  return aeadOpen(k, unb64(wrap.iv), unb64(wrap.ct));
}
export const docKey = () => random(32);
// Seal a value (JSON) for a file; context: sealContext(file) from index.js.
export async function seal({ key, epoch, value, context }) {
  const iv = random(12);
  return { epoch, iv: b64(iv), ct: b64(await aeadSeal(key, iv, utf8(JSON.stringify(value)), utf8(context))) };
}
export async function unseal({ key, sealed, context }) {
  return JSON.parse(dec.decode(await aeadOpen(key, unb64(sealed.iv), unb64(sealed.ct), utf8(context))));
}
