// 1.1 / 2.2 · Ed25519 keys and SSHSIG signatures.
//
// One implementation for server and browser: Web Crypto's Ed25519 in both.
// Signatures use the SSHSIG envelope so `ssh-keygen -Y verify` can check them
// with tools we did not write. Private keys use the openssh-key-v1 format so
// `ssh-keygen -Y sign` can produce signatures with them.

import { utf8, toBase64, fromBase64 } from './hash.js';

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('Web Crypto is unavailable. This page must be opened over HTTPS, on localhost, or from a local file.');
  return s;
};

// --- SSH wire helpers -------------------------------------------------------
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; }
function cat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function sshString(x) { const b = typeof x === 'string' ? utf8(x) : x; return cat(u32(b.length), b); }
class Reader {
  constructor(b) { this.b = b; this.o = 0; }
  u32() { if (this.o + 4 > this.b.length) throw new Error('truncated'); const v = new DataView(this.b.buffer, this.b.byteOffset + this.o, 4).getUint32(0); this.o += 4; return v; }
  bytes(n) { if (this.o + n > this.b.length) throw new Error('truncated'); const v = this.b.slice(this.o, this.o + n); this.o += n; return v; }
  string() { return this.bytes(this.u32()); }
  text() { return new TextDecoder().decode(this.string()); }
}
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const PKCS8_PREFIX = Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);

function publicBlob(raw32) { return cat(sshString('ssh-ed25519'), sshString(raw32)); }

// --- keys -------------------------------------------------------------------
export async function generate() {
  const pair = await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  const seed = pkcs8.slice(16, 48);
  const publicKey = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { privateKey: { seed, publicKey }, publicKey };
}

// The private key, imported for signing. Some browsers (Firefox) refuse a
// PKCS#8 key without its public part; for them, the public key is computed
// here and the key imported as a JWK, which carries both halves.
async function importPrivate(key) {
  try { return await subtle().importKey('pkcs8', cat(PKCS8_PREFIX, key.seed), { name: 'Ed25519' }, false, ['sign']); }
  catch (e) {
    const pub = key.publicKey || await (await import('./ed25519pub.js')).publicKeyFromSeed(key.seed);
    try { return await subtle().importKey('jwk', { kty: 'OKP', crv: 'Ed25519', d: b64url(key.seed), x: b64url(pub) }, { name: 'Ed25519' }, false, ['sign']); }
    catch { throw e; }
  }
}
async function importPublic(raw32) {
  return subtle().importKey('raw', raw32, { name: 'Ed25519' }, false, ['verify']);
}

export function publicKeyLine(publicKey, comment = '') {
  const line = 'ssh-ed25519 ' + toBase64(publicBlob(publicKey));
  return comment ? `${line} ${comment}` : line;
}

export function parsePublicKeyLine(line) {
  const parts = String(line).trim().split(/\s+/);
  if (parts[0] === PASSKEY) return parsePasskey(line).spki;
  if (parts[0] !== 'ssh-ed25519' || !parts[1]) throw new Error('not an ssh-ed25519 public key line');
  const r = new Reader(fromBase64(parts[1]));
  if (r.text() !== 'ssh-ed25519') throw new Error('key type mismatch inside blob');
  const raw = r.string();
  if (raw.length !== 32) throw new Error('bad ed25519 key length');
  return raw;
}

export const keyId = (line) => String(line).trim().split(/\s+/).slice(0, 2).join(' ');

// openssh-key-v1, unencrypted. Encrypt it at rest with your OS if you need to.
export function exportPrivateKey(key, comment = '') {
  const pub = publicBlob(key.publicKey);
  const check = new Uint8Array(4); globalThis.crypto.getRandomValues(check);
  let priv = cat(check, check, sshString('ssh-ed25519'), sshString(key.publicKey),
    sshString(cat(key.seed, key.publicKey)), sshString(comment));
  const pad = []; for (let i = 1; (priv.length + pad.length) % 8; i++) pad.push(i);
  priv = cat(priv, Uint8Array.from(pad));
  const body = cat(utf8('openssh-key-v1\0'), sshString('none'), sshString('none'), sshString(new Uint8Array(0)),
    u32(1), sshString(pub), sshString(priv));
  const b64 = toBase64(body).match(/.{1,70}/g).join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

export function importPrivateKey(text) {
  const b64 = text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const body = fromBase64(b64);
  const magic = utf8('openssh-key-v1\0');
  if (!eq(body.slice(0, magic.length), magic)) throw new Error('not an openssh-key-v1 private key');
  const r = new Reader(body.slice(magic.length));
  const cipher = r.text(); r.text(); r.string();
  if (cipher !== 'none') throw new Error('encrypted private keys are not supported; decrypt with ssh-keygen -p first');
  if (r.u32() !== 1) throw new Error('expected exactly one key');
  r.string();
  const p = new Reader(r.string());
  if (p.u32() !== p.u32()) throw new Error('private key check bytes differ (wrong passphrase or corrupt)');
  if (p.text() !== 'ssh-ed25519') throw new Error('not an ed25519 key');
  const publicKey = p.string();
  const both = p.string();
  return { seed: both.slice(0, 32), publicKey };
}

// --- SSHSIG -----------------------------------------------------------------
async function digest(alg, bytes) {
  return new Uint8Array(await subtle().digest(alg === 'sha256' ? 'SHA-256' : 'SHA-512', bytes));
}
function toSign(namespace, alg, h) {
  return cat(utf8('SSHSIG'), sshString(namespace), sshString(''), sshString(alg), sshString(h));
}

// Returns the SSHSIG blob, base64, unarmored. Use armor() for ssh-keygen.
export async function sign(message, key, namespace) {
  if (!namespace) throw new Error('sign: a namespace is required');
  const msg = typeof message === 'string' ? utf8(message) : message;
  const h = await digest('sha512', msg);
  const sig = new Uint8Array(await subtle().sign({ name: 'Ed25519' }, await importPrivate(key), toSign(namespace, 'sha512', h)));
  const blob = cat(utf8('SSHSIG'), u32(1), sshString(publicBlob(key.publicKey)), sshString(namespace),
    sshString(''), sshString('sha512'), sshString(cat(sshString('ssh-ed25519'), sshString(sig))));
  return toBase64(blob);
}

export function armor(sig) {
  return `-----BEGIN SSH SIGNATURE-----\n${sig.match(/.{1,76}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;
}
export function dearmor(text) {
  return String(text).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
}

export function signerKeyLine(signature) {
  if (String(signature).startsWith('webauthn:')) { try { return JSON.parse(new TextDecoder().decode(fromBase64(signature.slice(9)))).key; } catch { return null; } }
  try {
    const r = new Reader(fromBase64(dearmor(signature)));
    r.bytes(6); r.u32();
    return 'ssh-ed25519 ' + toBase64(r.string());
  } catch { return null; }
}

// verify(message, signature, keys[], namespace) → { ok, error, key }
export async function verify(message, signature, keys, namespace) {
  if (String(signature).startsWith('webauthn:')) return verifyPasskey(message, signature, keys, namespace);
  let r;
  try { r = new Reader(fromBase64(dearmor(signature))); } catch { return { ok: false, error: 'signature is not valid base64' }; }
  try {
    if (new TextDecoder().decode(r.bytes(6)) !== 'SSHSIG') return { ok: false, error: 'not an SSHSIG signature' };
    if (r.u32() !== 1) return { ok: false, error: 'unsupported SSHSIG version' };
    const pub = r.string();
    const ns = r.text();
    r.string();
    const alg = r.text();
    const sigBlob = new Reader(r.string());
    if (ns !== namespace) return { ok: false, error: `wrong namespace: signed for "${ns}", required "${namespace}"` };
    if (alg !== 'sha512' && alg !== 'sha256') return { ok: false, error: `unsupported hash ${alg}` };
    if (sigBlob.text() !== 'ssh-ed25519') return { ok: false, error: 'not an ed25519 signature' };
    const sig = sigBlob.string();
    const pr = new Reader(pub);
    if (pr.text() !== 'ssh-ed25519') return { ok: false, error: 'not an ed25519 key' };
    const raw = pr.string();
    const line = 'ssh-ed25519 ' + toBase64(pub);
    const allowed = (keys || []).map(keyId);
    if (!allowed.includes(line)) return { ok: false, error: 'signed by a key that is not among those allowed' };
    const msg = typeof message === 'string' ? utf8(message) : message;
    const h = await digest(alg, msg);
    const ok = await subtle().verify({ name: 'Ed25519' }, await importPublic(raw), sig, toSign(namespace, alg, h));
    return ok ? { ok: true, error: null, key: line } : { ok: false, error: 'signature does not match the message' };
  } catch (e) {
    return { ok: false, error: `malformed signature (${e.message})` };
  }
}

// A key's Radicle Node ID (did:key, Ed25519): "z" + base58btc(0xed 0x01 ‖ key).
// A participant registered with their Radicle key is thereby findable on the
// Radicle network without any further claim.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
export function nodeId(keyLineOrRaw) {
  if (typeof keyLineOrRaw === 'string' && keyLineOrRaw.startsWith(PASSKEY)) return null;
  const raw = typeof keyLineOrRaw === 'string' ? parsePublicKeyLine(keyLineOrRaw) : keyLineOrRaw;
  return 'z' + base58(cat(Uint8Array.from([0xed, 0x01]), raw));
}

// --- keys from a seed ---------------------------------------------------------
// The public half of an Ed25519 key, from its 32-byte seed.
export async function keyFromSeed(seed) {
  try {
    const k = await subtle().importKey('pkcs8', cat(PKCS8_PREFIX, seed), { name: 'Ed25519' }, true, ['sign']);
    const jwk = await subtle().exportKey('jwk', k);
    return { seed: Uint8Array.from(seed), publicKey: fromBase64(jwk.x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - jwk.x.length % 4) % 4)) };
  } catch {
    // A browser that will not export the public key (Firefox): compute it.
    return { seed: Uint8Array.from(seed), publicKey: await (await import('./ed25519pub.js')).publicKeyFromSeed(seed) };
  }
}

// --- passkeys (WebAuthn, ES256) ------------------------------------------------
// A passkey (Face ID, Touch ID, a fingerprint, a security key) is a P-256 key
// held by the device, usable only on the website it was made for. It is
// registered like any key, as a line:
//   webauthn-es256 <base64 of {"c": credential id, "k": public key (SPKI), "rp": website}>
// and signs by the device signing a challenge derived from exactly what the act
// says, and for what. Every copy checks it: the challenge, the website, that a
// person was present, and the signature itself.
export const PASSKEY = 'webauthn-es256';
const b64url = (b) => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => fromBase64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(s).length % 4) % 4));

export function passkeyLine({ credentialId, publicKey, rp }) {
  const body = JSON.stringify({ c: b64url(credentialId), k: toBase64(publicKey), rp: String(rp) });
  return `${PASSKEY} ${toBase64(utf8(body))}`;
}
export function parsePasskey(line) {
  const parts = String(line).trim().split(/\s+/);
  if (parts[0] !== PASSKEY || !parts[1]) throw new Error('not a passkey line');
  const o = JSON.parse(new TextDecoder().decode(fromBase64(parts[1])));
  if (typeof o.c !== 'string' || typeof o.k !== 'string' || typeof o.rp !== 'string' || !/^[a-z0-9.-]+$/i.test(o.rp)) throw new Error('bad passkey line');
  return { credentialId: o.c, spki: fromBase64(o.k), rp: o.rp.toLowerCase() };
}
export const isPasskey = (line) => String(line).startsWith(PASSKEY + ' ');

// The challenge a passkey signs for a message: bound to the namespace, as SSHSIG is.
export async function passkeyChallenge(message, namespace) {
  const msg = typeof message === 'string' ? utf8(message) : message;
  return new Uint8Array(await subtle().digest('SHA-256', cat(utf8(`entity-passkey\0${namespace}\0`), msg)));
}
// The signature string, from what the browser's navigator.credentials.get returned.
export function passkeySignature(line, { authenticatorData, clientDataJSON, signature }) {
  const body = { key: keyId(line), a: toBase64(new Uint8Array(authenticatorData)), c: toBase64(new Uint8Array(clientDataJSON)), s: toBase64(new Uint8Array(signature)) };
  return 'webauthn:' + toBase64(utf8(JSON.stringify(body)));
}

// ASN.1 DER ECDSA signature → the 64 raw bytes Web Crypto verifies.
function derToRaw(der) {
  const r = new Reader(der);
  if (r.bytes(1)[0] !== 0x30) throw new Error('not DER');
  const len = r.bytes(1)[0]; if (len & 0x80) r.bytes(len & 0x7f);
  const int = () => { if (r.bytes(1)[0] !== 0x02) throw new Error('not DER'); let v = r.bytes(r.bytes(1)[0]); while (v.length > 32 && v[0] === 0) v = v.slice(1); if (v.length > 32) throw new Error('bad integer'); return cat(new Uint8Array(32 - v.length), v); };
  return cat(int(), int());
}

async function verifyPasskey(message, signature, keys, namespace) {
  try {
    const o = JSON.parse(new TextDecoder().decode(fromBase64(signature.slice(9))));
    const allowed = (keys || []).map(keyId);
    if (!allowed.includes(o.key)) return { ok: false, error: 'signed by a key that is not among those allowed' };
    const pk = parsePasskey(o.key);
    const ad = fromBase64(o.a), cdBytes = fromBase64(o.c), sig = fromBase64(o.s);
    const cd = JSON.parse(new TextDecoder().decode(cdBytes));
    if (cd.type !== 'webauthn.get') return { ok: false, error: 'not a passkey assertion' };
    const want = b64url(await passkeyChallenge(message, namespace));
    if (cd.challenge !== want) return { ok: false, error: 'the passkey signed something else' };
    const origin = new URL(cd.origin);
    const local = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
    if (!(origin.protocol === 'https:' || (origin.protocol === 'http:' && local)) || !(origin.hostname === pk.rp || origin.hostname.endsWith('.' + pk.rp))) return { ok: false, error: `signed on ${cd.origin}, not on ${pk.rp}` };
    const rpHash = new Uint8Array(await subtle().digest('SHA-256', utf8(pk.rp)));
    if (ad.length < 37 || !eq(ad.slice(0, 32), rpHash)) return { ok: false, error: 'the passkey belongs to another website' };
    if (!(ad[32] & 0x01)) return { ok: false, error: 'no person was present when the passkey signed' };
    const key = await subtle().importKey('spki', pk.spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const data = cat(ad, new Uint8Array(await subtle().digest('SHA-256', cdBytes)));
    const ok = await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), data);
    return ok ? { ok: true, error: null, key: o.key } : { ok: false, error: 'signature does not match the message' };
  } catch (e) {
    return { ok: false, error: `malformed passkey signature (${e.message})` };
  }
}
