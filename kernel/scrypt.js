// scrypt (RFC 7914), in plain JavaScript, for server and browser alike: the
// browser has PBKDF2 but not scrypt, and a password must turn into the same
// key on every device. Memory-hard: each guess at a password costs an attacker
// N × r × 128 bytes of memory as well as time.

const R = (a, b) => (a << b) | (a >>> (32 - b));

function salsa208(B, x) {
  x.set(B);
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12] | 0, 7); x[8] ^= R(x[4] + x[0] | 0, 9); x[12] ^= R(x[8] + x[4] | 0, 13); x[0] ^= R(x[12] + x[8] | 0, 18);
    x[9] ^= R(x[5] + x[1] | 0, 7); x[13] ^= R(x[9] + x[5] | 0, 9); x[1] ^= R(x[13] + x[9] | 0, 13); x[5] ^= R(x[1] + x[13] | 0, 18);
    x[14] ^= R(x[10] + x[6] | 0, 7); x[2] ^= R(x[14] + x[10] | 0, 9); x[6] ^= R(x[2] + x[14] | 0, 13); x[10] ^= R(x[6] + x[2] | 0, 18);
    x[3] ^= R(x[15] + x[11] | 0, 7); x[7] ^= R(x[3] + x[15] | 0, 9); x[11] ^= R(x[7] + x[3] | 0, 13); x[15] ^= R(x[11] + x[7] | 0, 18);
    x[1] ^= R(x[0] + x[3] | 0, 7); x[2] ^= R(x[1] + x[0] | 0, 9); x[3] ^= R(x[2] + x[1] | 0, 13); x[0] ^= R(x[3] + x[2] | 0, 18);
    x[6] ^= R(x[5] + x[4] | 0, 7); x[7] ^= R(x[6] + x[5] | 0, 9); x[4] ^= R(x[7] + x[6] | 0, 13); x[5] ^= R(x[4] + x[7] | 0, 18);
    x[11] ^= R(x[10] + x[9] | 0, 7); x[8] ^= R(x[11] + x[10] | 0, 9); x[9] ^= R(x[8] + x[11] | 0, 13); x[10] ^= R(x[9] + x[8] | 0, 18);
    x[12] ^= R(x[15] + x[14] | 0, 7); x[13] ^= R(x[12] + x[15] | 0, 9); x[14] ^= R(x[13] + x[12] | 0, 13); x[15] ^= R(x[14] + x[13] | 0, 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}

function blockMix(B, Y, r, X, t) {
  X.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) X[k] ^= B[i * 16 + k];
    salsa208(X, t);
    Y.set(X, i * 16);
  }
  for (let i = 0; i < r; i++) { B.set(Y.subarray(2 * i * 16, 2 * i * 16 + 16), i * 16); B.set(Y.subarray((2 * i + 1) * 16, (2 * i + 1) * 16 + 16), (i + r) * 16); }
}

function roMix(B, r, N) {
  const words = 32 * r;
  const V = new Int32Array(N * words), Y = new Int32Array(words), X = new Int32Array(16), t = new Int32Array(16);
  for (let i = 0; i < N; i++) { V.set(B, i * words); blockMix(B, Y, r, X, t); }
  for (let i = 0; i < N; i++) {
    const j = B[(2 * r - 1) * 16] & (N - 1);
    for (let k = 0; k < words; k++) B[k] ^= V[j * words + k];
    blockMix(B, Y, r, X, t);
  }
}

async function pbkdf2(password, salt, bytes) {
  const s = globalThis.crypto.subtle;
  const key = await s.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, key, bytes * 8));
}

// Little-endian words, whatever the machine.
const toWords = (bytes) => { const w = new Int32Array(bytes.length / 4), d = new DataView(bytes.buffer, bytes.byteOffset, bytes.length); for (let i = 0; i < w.length; i++) w[i] = d.getInt32(i * 4, true); return w; };
const toBytes = (words) => { const b = new Uint8Array(words.length * 4), d = new DataView(b.buffer); for (let i = 0; i < words.length; i++) d.setInt32(i * 4, words[i], true); return b; };

export async function scrypt(password, salt, { N, r, p, dkLen }) {
  if (N < 2 || (N & (N - 1))) throw new Error('scrypt: N must be a power of two');
  const B = await pbkdf2(password, salt, p * 128 * r);
  for (let i = 0; i < p; i++) {
    const w = toWords(B.subarray(i * 128 * r, (i + 1) * 128 * r));
    roMix(w, r, N);
    B.set(toBytes(w), i * 128 * r);
  }
  return pbkdf2(password, B, dkLen);
}
