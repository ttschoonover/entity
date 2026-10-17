// chatcrypto · end-to-end encryption for members-only chat channels, the same
// code in the browser and in Node (tests). Nothing here touches the record.
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

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();
export const b64 = (u8) => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
export const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ── X25519, RFC 7748 §5 ────────────────────────────────────────────────────
const P = 2n ** 255n - 19n, A24 = 121665n;
const mod = (a) => { a %= P; return a < 0n ? a + P : a; };
const inv = (b) => { let r = 1n, e = P - 2n; b = mod(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const le = (u8) => { let n = 0n; for (let i = u8.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(u8[i]); return n; };
const bytes = (n) => { const o = new Uint8Array(32); for (let i = 0; i < 32; i++) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
export function x25519(scalar, u) {
  const k = Uint8Array.from(scalar); k[0] &= 248; k[31] &= 127; k[31] |= 64;
  const uu = Uint8Array.from(u); uu[31] &= 127;
  const s = le(k), x1 = mod(le(uu));
  let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n, swap = 0n;
  for (let t = 254; t >= 0; t--) {
    const bit = (s >> BigInt(t)) & 1n;
    swap ^= bit; if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; } swap = bit;
    const A = mod(x2 + z2), AA = A * A % P, B = mod(x2 - z2), BB = B * B % P, E = mod(AA - BB);
    const C = mod(x3 + z3), D = mod(x3 - z3), DA = D * A % P, CB = C * B % P;
    x3 = mod((DA + CB) * (DA + CB)); z3 = mod(x1 * mod((DA - CB) * (DA - CB)));
    x2 = AA * BB % P; z2 = mod(E * mod(AA + A24 * E));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return bytes(x2 * inv(z2) % P);
}
const BASE = bytes(9n);

// A member's chat key pair, from the 32-byte seed of their signing key.
export async function memberKey(seed) {
  const xsk = new Uint8Array(await subtle().digest('SHA-256', new Uint8Array([...enc.encode('athenes.chat.x25519\n'), ...seed])));
  return { xsk, xpk: b64(x25519(xsk, BASE)) };
}
// What a member signs (namespace entity.chat) to register their chat key.
export const keyMaterial = (k) => ['chat.key', k.entity, k.by, k.xpk].join('\n');
export const validXpk = (s) => typeof s === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(s);

async function kek(xsk, fromXpk, toXpk, theirXpk, w) {
  const shared = x25519(xsk, unb64(theirXpk));
  if (shared.every(x => x === 0)) throw new Error('a chat key that is not a key');
  const base = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`${w.entity}\n${w.channel}\n${w.epoch}`), info: enc.encode(`athenes.chat.wrap\n${fromXpk}\n${toXpk}`) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Wrap a channel key for one reader; unwrap one wrapped for you.
export async function wrapKey({ me, toXpk, key, entity, channel, epoch }) {
  const iv = random(12);
  const k = await kek(me.xsk, me.xpk, toXpk, toXpk, { entity, channel, epoch });
  return { fromXpk: me.xpk, iv: b64(iv), ct: b64(new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, k, key))) };
}
export async function unwrapKey({ me, wrap, entity, channel, epoch }) {
  const k = await kek(me.xsk, wrap.fromXpk, me.xpk, wrap.fromXpk, { entity, channel, epoch });
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(wrap.iv) }, k, unb64(wrap.ct)));
}
export const channelKey = () => random(32);

// A message: sealed with the channel key, bound to where and by whom it was said.
export const aad = (m) => enc.encode(['chat.sealed', m.entity, m.channel, m.epoch, m.by, m.at, m.nonce, m.reply || ''].join('\n'));
// What stands for the text in the signed material of a sealed message.
export const sealedText = (e) => `enc:${e.epoch}:${e.iv}:${e.ct}`;
const aes = (key, use) => subtle().importKey('raw', key, 'AES-GCM', false, [use]);
export async function seal({ key, text, ...m }) {
  const iv = random(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(m) }, await aes(key, 'encrypt'), enc.encode(text));
  return { epoch: m.epoch, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
export async function unseal({ key, sealed, ...m }) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: aad({ ...m, epoch: sealed.epoch }) }, await aes(key, 'decrypt'), unb64(sealed.ct));
  return dec.decode(pt);
}
