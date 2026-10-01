// A password on the key kept in this browser. The key's seed is encrypted with
// AES-GCM under a key derived from the password (PBKDF2-SHA-256); the page
// asks for the password each time it signs, decrypts the seed in memory, signs,
// and forgets it. A stolen laptop no longer gives the key away, as long as the
// password is not guessed. Nothing leaves the browser; the password is not
// recoverable, so a saved copy of the key (exported) is still the backup.
//
// This is a lock on a key, not a key made from a password: see docs/MANUAL.md.

const ITERATIONS = 310000;
const te = new TextEncoder();

async function derive(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function lockSeed(seed, password) {
  if (!password || password.length < 8) throw new Error('use a password of at least 8 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, seed));
  return { kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt, iv, ct };
}

export async function unlockSeed(locked, password) {
  const key = await derive(password, locked.salt, locked.iterations);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: locked.iv }, key, locked.ct)); }
  catch { throw new Error('that password does not unlock this key'); }
}
