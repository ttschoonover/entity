// The cryptography of sealed content, with no dependencies: X25519 (RFC 7748)
// written out with BigInt, and AES-256-GCM and HKDF-SHA-256 from the platform's
// own Web Crypto (in every browser and in Node). Used by the page and the
// command line to seal and open; never by settlement, which only checks shapes.

const P = 2n ** 255n - 19n, A24 = 121665n;
const mod = (a) => ((a % P) + P) % P;
function pow(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; } return r; }
const le2n = (b) => b.reduceRight((a, x) => (a << 8n) | BigInt(x), 0n);
const n2le = (n) => { const o = new Uint8Array(32); for (let i = 0; i < 32; i++) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
const clamp = (k) => { const c = Uint8Array.from(k); c[0] &= 248; c[31] &= 127; c[31] |= 64; return c; };

// RFC 7748 §5: the Montgomery ladder.
export function x25519(scalar, u) {
  const k = le2n(clamp(scalar)), uu = Uint8Array.from(u); uu[31] &= 127;
  const x1 = le2n(uu); let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n, swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (k >> t) & 1n; swap ^= kt;
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; } swap = kt;
    const a = mod(x2 + z2), aa = mod(a * a), b = mod(x2 - z2), bb = mod(b * b), e = mod(aa - bb);
    const c = mod(x3 + z3), d = mod(x3 - z3), da = mod(d * a), cb = mod(c * b);
    x3 = mod((da + cb) ** 2n); z3 = mod(x1 * mod((da - cb) ** 2n)); x2 = mod(aa * bb); z2 = mod(e * mod(aa + A24 * e));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return n2le(mod(x2 * pow(z2, P - 2n)));
}
const BASE = (() => { const b = new Uint8Array(32); b[0] = 9; return b; })();
export const publicFrom = (priv) => x25519(priv, BASE);

const subtle = () => globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const b64 = (u) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const enc = new TextEncoder(), dec = new TextDecoder();

async function hkdf(ikm, info, len = 32) {
  const k = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, k, len * 8));
}
const aes = (key, usage) => subtle().importKey('raw', key, 'AES-GCM', false, [usage]);

// A member's encryption key, from the seed of their signing key: nothing new to keep.
export async function memberKeys(seed) {
  const priv = clamp(await hkdf(seed, 'git-republic/sealed/member-key/v1'));
  return { priv, pub: publicFrom(priv) };
}

// Seal 32 bytes (a group key) to one member's public key: an ephemeral X25519
// key, a shared secret, and AES-GCM.
export async function sealTo(pubB64, bytes) {
  const eph = rand(32), epk = publicFrom(eph), shared = x25519(eph, unb64(pubB64));
  const key = await hkdf(new Uint8Array([...shared, ...epk, ...unb64(pubB64)]), 'git-republic/sealed/wrap/v1');
  const nonce = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, await aes(key, 'encrypt'), bytes));
  return { epk: b64(epk), nonce: b64(nonce), ct: b64(ct) };
}
export async function openWith(priv, pub, box) {
  const shared = x25519(priv, unb64(box.epk));
  const key = await hkdf(new Uint8Array([...shared, ...unb64(box.epk), ...pub]), 'git-republic/sealed/wrap/v1');
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.nonce) }, await aes(key, 'decrypt'), unb64(box.ct)));
}

// Content under a group key.
export const newGroupKey = () => rand(32);
export async function encrypt(groupKey, text) {
  const nonce = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, await aes(groupKey, 'encrypt'), enc.encode(text)));
  return { nonce: b64(nonce), ct: b64(ct) };
}
export async function decrypt(groupKey, sealed) {
  return dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(sealed.nonce) }, await aes(groupKey, 'decrypt'), unb64(sealed.ct)));
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
