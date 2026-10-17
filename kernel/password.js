// Signing in with a username and a password.
//
// The password is turned into an ordinary Ed25519 key, the same on every
// device: scrypt(password, "entity-password-v1" ‖ entity id ‖ member id). The
// member registers that key's public half like any other key; nothing about
// the password is stored anywhere. To sign, the page derives the key again.
//
// Because every public key is on the public register, anyone can try guessing
// a password offline. scrypt makes each guess cost about 32 MB of memory and a
// fraction of a second; a long password makes guessing hopeless. Hence the
// rules in passwordProblem.

import { scrypt } from './scrypt.js';
import { keyFromSeed } from './keys.js';
import { utf8 } from './hash.js';

export const PASSWORD_KDF = Object.freeze({ N: 32768, r: 8, p: 1, dkLen: 32 });

export async function passwordKey(entityId, memberId, password) {
  const salt = utf8(`entity-password-v1\0${entityId}\0${memberId}`);
  const seed = await scrypt(utf8(String(password).normalize('NFKC')), salt, PASSWORD_KDF);
  return keyFromSeed(seed);
}

const COMMON = ['password', '123456', 'qwerty', 'letmein', 'iloveyou', 'welcome', 'admin', 'abc123', 'monkey', 'dragon'];

// Why this password is too weak to guard a public key, or null.
export function passwordProblem(password, memberId = '', min = 12) {
  const pw = String(password);
  if (pw.length < min) return `use at least ${min} characters (a few ordinary words together work well)`;
  const low = pw.toLowerCase();
  if (memberId && low.includes(String(memberId).toLowerCase())) return 'do not put your username in your password';
  if (/^(.)\1+$/.test(pw)) return 'use more than one character';
  if (COMMON.some(c => low.replace(/[^a-z0-9]/g, '').startsWith(c) && low.length < c.length + 8)) return 'that is one of the most common passwords';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(r => r.test(pw)).length;
  if (pw.length < 20 && classes < 2) return 'mix letters with numbers, capitals or symbols, or make it 20 characters or more';
  return null;
}
