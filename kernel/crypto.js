// crypto · the one place entity does public-key encryption, the same code in
// the browser and in Node. Everything comes from the platform's Web Crypto:
//
//   X25519 (RFC 7748)          native where the platform has it, which every
//                              current browser and Node does. An older browser
//                              without it falls back to a portable ladder below,
//                              which gives the same bytes but is not constant-time.
//   HKDF-SHA-256 (RFC 5869)    extract and expand, from HMAC-SHA-256.
//   AES-GCM                    256-bit keys for entity's own use; 128-bit too,
//                              only so HPKE can be checked against RFC 9180.
//   HPKE (RFC 9180)            base mode, DHKEM(X25519, HKDF-SHA256),
//                              HKDF-SHA256, AES-256-GCM: sealing to a public key.
//
// Nothing here touches the record or settlement. The sealed module, documents
// and chat use it to seal and open; their key derivations and labels are their
// own and unchanged, so everything sealed before still opens.

const subtle = () => globalThis.crypto.subtle;
const te = new TextEncoder(), td = new TextDecoder();

// ── bytes ──────────────────────────────────────────────────────────────────
export const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const b64 = (u8) => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
export const hex = (u8) => Array.from(u8, x => x.toString(16).padStart(2, '0')).join('');
export const unhex = (s) => Uint8Array.from(String(s).match(/../g) || [], x => parseInt(x, 16));
export const utf8 = (s) => te.encode(s);
export const concat = (...parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const i2osp = (n, w) => { const o = new Uint8Array(w); for (let i = w - 1; i >= 0; i--) { o[i] = n & 255; n = Math.floor(n / 256); } return o; };
const isZero = (u8) => u8.every(x => x === 0);

// ── X25519 ─────────────────────────────────────────────────────────────────
export const BASEPOINT = (() => { const b = new Uint8Array(32); b[0] = 9; return b; })();
export const clamp = (k) => { const c = Uint8Array.from(k); c[0] &= 248; c[31] &= 127; c[31] |= 64; return c; };
// PKCS#8 wrapping of a raw X25519 private key (RFC 8410): a fixed prefix.
const PKCS8 = unhex('302e020100300506032b656e04220420');

// The portable ladder (RFC 7748 §5), used only where Web Crypto lacks X25519.
const P = 2n ** 255n - 19n, A24 = 121665n;
const mod = (a) => { a %= P; return a < 0n ? a + P : a; };
const inv = (b) => { let r = 1n, e = P - 2n; b = mod(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const le = (u8) => { let n = 0n; for (let i = u8.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(u8[i]); return n; };
const n2le = (n) => { const o = new Uint8Array(32); for (let i = 0; i < 32; i++) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
export function x25519Portable(scalar, u) {
  const s = le(clamp(scalar)), uu = Uint8Array.from(u); uu[31] &= 127;
  const x1 = mod(le(uu));
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
  return n2le(x2 * inv(z2) % P);
}

async function x25519Native(scalar, u) {
  const priv = await subtle().importKey('pkcs8', concat(PKCS8, clamp(scalar)), { name: 'X25519' }, false, ['deriveBits']);
  const pub = await subtle().importKey('raw', Uint8Array.from(u), { name: 'X25519' }, false, []);
  return new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: pub }, priv, 256));
}

// RFC 7748 §5.2, first test: checked once, so a platform that answers wrongly is never used.
const KAT = { k: 'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4', u: 'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c', out: 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552' };
let nativeOk;
export async function hasNativeX25519() {
  if (nativeOk === undefined) {
    try { nativeOk = hex(await x25519Native(unhex(KAT.k), unhex(KAT.u))) === KAT.out; }
    catch { nativeOk = false; }
  }
  return nativeOk;
}

// X25519(scalar, u). Refuses an all-zero result: the other key was not a real
// public key (a low-order point), and nothing derived from it would be secret.
export async function x25519(scalar, u) {
  let out;
  if (await hasNativeX25519()) {
    try { out = await x25519Native(scalar, u); }
    catch { throw new Error('not a usable X25519 public key'); }
  } else out = x25519Portable(scalar, u);
  if (isZero(out)) throw new Error('not a usable X25519 public key');
  return out;
}
export const x25519Public = (scalar) => x25519(scalar, BASEPOINT);

// ── HKDF-SHA-256, from HMAC ────────────────────────────────────────────────
async function hmac(key, data) {
  // An empty HMAC key is the same as 32 zero bytes (both pad to a zero block);
  // some platforms refuse a zero-length key, so give them the zeros.
  const k = await subtle().importKey('raw', key.length ? key : new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}
export const hkdfExtract = (salt, ikm) => hmac(salt, ikm);
export const hmacSha256 = (key, data) => hmac(key, data);
export async function hkdfExpand(prk, info, length) {
  if (length > 255 * 32) throw new Error('HKDF output too long');
  let t = new Uint8Array(0), out = new Uint8Array(0);
  for (let i = 1; out.length < length; i++) { t = await hmac(prk, concat(t, info, Uint8Array.of(i))); out = concat(out, t); }
  return out.slice(0, length);
}
export async function hkdf(ikm, { salt = new Uint8Array(0), info = new Uint8Array(0), length = 32 } = {}) {
  return hkdfExpand(await hkdfExtract(salt, ikm), info, length);
}

// ── AES-GCM ────────────────────────────────────────────────────────────────
const aesKey = (key, use) => subtle().importKey('raw', key, 'AES-GCM', false, [use]);
export async function aeadSeal(key, nonce, plaintext, aad = new Uint8Array(0)) {
  return new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, await aesKey(key, 'encrypt'), plaintext));
}
export async function aeadOpen(key, nonce, ciphertext, aad = new Uint8Array(0)) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, await aesKey(key, 'decrypt'), ciphertext));
}

// ── HPKE (RFC 9180), base mode ─────────────────────────────────────────────
// DHKEM(X25519, HKDF-SHA256) = 0x0020, HKDF-SHA256 = 0x0001,
// AES-128-GCM = 0x0001, AES-256-GCM = 0x0002. entity uses AES-256-GCM.
export const HPKE = Object.freeze({ kem: 0x0020, kdf: 0x0001, aead: 0x0002 });
const AEADS = { 0x0001: { nk: 16 }, 0x0002: { nk: 32 } };
const V1 = utf8('HPKE-v1');
const KEM_ID = concat(utf8('KEM'), i2osp(0x0020, 2));
const suiteId = (aead) => concat(utf8('HPKE'), i2osp(0x0020, 2), i2osp(0x0001, 2), i2osp(aead, 2));
const labeledExtract = (sid, salt, label, ikm) => hkdfExtract(salt, concat(V1, sid, utf8(label), ikm));
const labeledExpand = (sid, prk, label, info, L) => hkdfExpand(prk, concat(i2osp(L, 2), V1, sid, utf8(label), info), L);

async function kemShared(dh, kemContext) {
  const prk = await labeledExtract(KEM_ID, new Uint8Array(0), 'eae_prk', dh);
  return labeledExpand(KEM_ID, prk, 'shared_secret', kemContext, 32);
}
async function keySchedule(shared, info, aead) {
  const sid = suiteId(aead), nk = AEADS[aead]?.nk;
  if (!nk) throw new Error('unsupported HPKE AEAD');
  const empty = new Uint8Array(0);
  const ctx = concat(Uint8Array.of(0), await labeledExtract(sid, empty, 'psk_id_hash', empty), await labeledExtract(sid, empty, 'info_hash', info));
  const secret = await labeledExtract(sid, shared, 'secret', empty);
  return {
    key: await labeledExpand(sid, secret, 'key', ctx, nk),
    nonce: await labeledExpand(sid, secret, 'base_nonce', ctx, 12),
    exporter: await labeledExpand(sid, secret, 'exp', ctx, 32),
  };
}

// A key pair for HPKE: a random X25519 private key and its public key.
export async function hpkeKeyPair() { const sk = clamp(random(32)); return { sk, pk: await x25519Public(sk) }; }

// Seal one message to a public key. Returns { enc, ct }: enc is the
// ephemeral public key the recipient needs. `info` binds the message to its
// use; `aad` is authenticated but not encrypted. `ephemeral` is for test vectors only.
export async function hpkeSeal(pkR, plaintext, { info = new Uint8Array(0), aad = new Uint8Array(0), aead = HPKE.aead, ephemeral } = {}) {
  const skE = ephemeral ? Uint8Array.from(ephemeral) : clamp(random(32));
  const enc = await x25519Public(skE);
  const shared = await kemShared(await x25519(skE, pkR), concat(enc, pkR));
  const ks = await keySchedule(shared, info, aead);
  return { enc, ct: await aeadSeal(ks.key, ks.nonce, plaintext, aad), _schedule: ephemeral ? { shared, ...ks } : undefined };
}
export async function hpkeOpen(skR, enc, ciphertext, { info = new Uint8Array(0), aad = new Uint8Array(0), aead = HPKE.aead } = {}) {
  const pkR = await x25519Public(skR);
  const shared = await kemShared(await x25519(skR, enc), concat(enc, pkR));
  const ks = await keySchedule(shared, info, aead);
  return aeadOpen(ks.key, ks.nonce, ciphertext, aad);
}

// Text conveniences for the callers that seal strings.
export const sealText = (pkR, text, opt) => hpkeSeal(pkR, utf8(text), opt);
export const openText = async (skR, enc, ct, opt) => td.decode(await hpkeOpen(skR, enc, ct, opt));
