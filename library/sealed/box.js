// The cryptography of sealed content. X25519, HKDF-SHA-256 and AES-256-GCM
// come from kernel/crypto.js (native Web Crypto, in every browser and in Node).
// The derivations and labels here are unchanged since sealed began, so every
// key period and post sealed before still opens. Used by the page and the
// command line to seal and open; never by settlement, which only checks shapes.
import { x25519, x25519Public, clamp, random, b64, unb64, hkdf as hkdfRaw, aeadSeal, aeadOpen, utf8, concat } from '../../kernel/crypto.js';

export { b64, unb64, x25519 };
export const publicFrom = (priv) => x25519Public(priv);
const dec = new TextDecoder();
const ZERO_SALT = new Uint8Array(32);
const hkdf = (ikm, info, len = 32) => hkdfRaw(ikm, { salt: ZERO_SALT, info: utf8(info), length: len });

// A member's encryption key, from the seed of their signing key: nothing new to
// keep, and the same on every device. The label separates it from every other use.
export async function memberKeys(seed) {
  const priv = clamp(await hkdf(seed, 'git-republic/sealed/member-key/v1'));
  return { priv, pub: await x25519Public(priv) };
}

// Seal 32 bytes (a group key) to one member's public key: an ephemeral X25519
// key, a shared secret, and AES-GCM.
export async function sealTo(pubB64, bytes) {
  const pub = unb64(pubB64), eph = clamp(random(32)), epk = await x25519Public(eph), shared = await x25519(eph, pub);
  const key = await hkdf(concat(shared, epk, pub), 'git-republic/sealed/wrap/v1');
  const nonce = random(12);
  return { epk: b64(epk), nonce: b64(nonce), ct: b64(await aeadSeal(key, nonce, bytes)) };
}
export async function openWith(priv, pub, box) {
  const epk = unb64(box.epk), shared = await x25519(priv, epk);
  const key = await hkdf(concat(shared, epk, pub), 'git-republic/sealed/wrap/v1');
  return aeadOpen(key, unb64(box.nonce), unb64(box.ct));
}

// Content under a group key.
export const newGroupKey = () => random(32);
export async function encrypt(groupKey, text) {
  const nonce = random(12);
  return { nonce: b64(nonce), ct: b64(await aeadSeal(groupKey, nonce, utf8(text))) };
}
export async function decrypt(groupKey, sealed) {
  return dec.decode(await aeadOpen(groupKey, unb64(sealed.nonce), unb64(sealed.ct)));
}

// Every group key a member can open: { epoch: key }.
export async function groupKeys(state, memberId, seed) {
  const s = state.m.sealed, out = {};
  if (!s) return out;
  const me = await memberKeys(seed);
  for (const e of s.epochs) {
    const w = e.wraps[memberId];
    if (w) { try { out[e.n] = await openWith(me.priv, me.pub, w); } catch { /* a wrap that does not open */ } }
  }
  return out;
}
