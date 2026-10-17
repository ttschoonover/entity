// ed25519pub.js · the public key of an Ed25519 seed, computed in plain
// JavaScript (RFC 8032, section 5.1.5). Only for browsers whose Web Crypto can
// sign with an imported Ed25519 key but cannot give its public key back
// (Firefox, whose PKCS#8 import without the public key part cannot export it).
// It derives a public key from a private seed; it signs nothing.

const P = 2n ** 255n - 19n;
const mod = (a) => ((a % P) + P) % P;
const pow = (b, e) => { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; } return r; };
const inv = (a) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const B = [15112221349535400772501151409588531511454012693041857206046113283949847762202n,
  46316835694926478169428394003475163141307993866256225615783033603165251855960n, 1n, 0n];
B[3] = mod(B[0] * B[1]);

// Extended coordinates (X, Y, Z, T): x = X/Z, y = Y/Z, x*y = T/Z.
function add([X1, Y1, Z1, T1], [X2, Y2, Z2, T2]) {
  const A = mod((Y1 - X1) * (Y2 - X2)), Bv = mod((Y1 + X1) * (Y2 + X2));
  const C = mod(2n * T1 * T2 * D), Dv = mod(2n * Z1 * Z2);
  const E = Bv - A, F = Dv - C, G = Dv + C, H = Bv + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function mul(s, Pt) {
  let R = [0n, 1n, 1n, 0n], Q = Pt;
  while (s > 0n) { if (s & 1n) R = add(R, Q); Q = add(Q, Q); s >>= 1n; }
  return R;
}
const le = (bytes) => bytes.reduceRight((a, b) => (a << 8n) + BigInt(b), 0n);

export async function publicKeyFromSeed(seed) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', Uint8Array.from(seed)));
  const a = h.slice(0, 32); a[0] &= 248; a[31] &= 127; a[31] |= 64;
  const [X, Y, Z] = mul(le(a), B);
  const zi = inv(Z), x = mod(X * zi), y = mod(Y * zi);
  const out = new Uint8Array(32);
  let v = y; for (let i = 0; i < 32; i++) { out[i] = Number(v & 255n); v >>= 8n; }
  if (x & 1n) out[31] |= 0x80;
  return out;
}
