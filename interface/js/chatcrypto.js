// chatcrypto · end-to-end encryption for members-only chat channels, the same
// code in the browser and in Node (tests). Nothing here touches the record.
// The primitives come from kernel/crypto.js (native Web Crypto); the
// derivations and labels below are unchanged, so every message sealed before
// still opens.
//
// Each member has a chat key pair (X25519, RFC 7748) derived from the seed of
// their signing key, so every browser holding that key gets the same pair and
// nothing new has to be kept. The public half is registered with the node,
// signed with the member's record key, so a node cannot swap it for its own.
//
// Each channel has a key per epoch: 32 random bytes made by whichever member
// starts the epoch, and wrapped for every reader's chat key (X25519 → HKDF →
// AES-GCM). Messages are sealed with the channel key (AES-GCM), bound to their
// channel, epoch, author, time and nonce. The node keeps only ciphertext. When
// someone stops being a member, the next member to open the channel starts a
// new epoch that leaves them out.
import { x25519, x25519Public, random, b64, unb64, hkdf, aeadSeal, aeadOpen, utf8, concat } from '../../kernel/crypto.js';

export { b64, unb64, random, x25519 };
const subtle = () => globalThis.crypto.subtle;
const dec = new TextDecoder();

// A member's chat key pair, from the 32-byte seed of their signing key.
export async function memberKey(seed) {
  const xsk = new Uint8Array(await subtle().digest('SHA-256', concat(utf8('athenes.chat.x25519\n'), seed)));
  return { xsk, xpk: b64(await x25519Public(xsk)) };
}
// What a member signs (namespace entity.chat) to register their chat key.
export const keyMaterial = (k) => ['chat.key', k.entity, k.by, k.xpk].join('\n');
export const validXpk = (s) => typeof s === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(s);

async function kek(xsk, fromXpk, toXpk, theirXpk, w) {
  let shared;
  try { shared = await x25519(xsk, unb64(theirXpk)); } catch { throw new Error('a chat key that is not a key'); }
  return hkdf(shared, { salt: utf8(`${w.entity}\n${w.channel}\n${w.epoch}`), info: utf8(`athenes.chat.wrap\n${fromXpk}\n${toXpk}`), length: 32 });
}
// Wrap a channel key for one reader; unwrap one wrapped for you.
export async function wrapKey({ me, toXpk, key, entity, channel, epoch }) {
  const iv = random(12);
  const k = await kek(me.xsk, me.xpk, toXpk, toXpk, { entity, channel, epoch });
  return { fromXpk: me.xpk, iv: b64(iv), ct: b64(await aeadSeal(k, iv, key)) };
}
export async function unwrapKey({ me, wrap, entity, channel, epoch }) {
  const k = await kek(me.xsk, wrap.fromXpk, me.xpk, wrap.fromXpk, { entity, channel, epoch });
  return aeadOpen(k, unb64(wrap.iv), unb64(wrap.ct));
}
export const channelKey = () => random(32);

// A message: sealed with the channel key, bound to where and by whom it was said.
export const aad = (m) => utf8(['chat.sealed', m.entity, m.channel, m.epoch, m.by, m.at, m.nonce, m.reply || ''].join('\n'));
// What stands for the text in the signed material of a sealed message.
export const sealedText = (e) => `enc:${e.epoch}:${e.iv}:${e.ct}`;
export async function seal({ key, text, ...m }) {
  const iv = random(12);
  return { epoch: m.epoch, iv: b64(iv), ct: b64(await aeadSeal(key, iv, utf8(text), aad(m))) };
}
export async function unseal({ key, sealed, ...m }) {
  return dec.decode(await aeadOpen(key, unb64(sealed.iv), unb64(sealed.ct), aad({ ...m, epoch: sealed.epoch })));
}
