// keyfile · private key files that can be locked with a passphrase.
//
// A key file is either the plain OpenSSH private key (as `ssh-keygen` writes
// it) or that same text locked:
//
//   -----BEGIN ENTITY LOCKED KEY-----
//   base64 of {"v":1,"kdf":"scrypt","N":65536,"r":8,"p":1,"salt":…,"iv":…,"ct":…}
//   -----END ENTITY LOCKED KEY-----
//
// The passphrase is stretched with scrypt and the key sealed with AES-256-GCM,
// both from Node's own crypto. Anyone who copies the file without the
// passphrase has nothing they can sign with.
//
// The passphrase comes from, in order: ENTITY_PASSPHRASE, the file named by
// ENTITY_PASSPHRASE_FILE, or a prompt on the terminal. A node that signs on
// its own (finality, say) needs one of the first two in its environment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const BEGIN = '-----BEGIN ENTITY LOCKED KEY-----', END = '-----END ENTITY LOCKED KEY-----';
const AAD = Buffer.from('entity locked key v1');
const SCRYPT = { N: 65536, r: 8, p: 1 };   // 64 MiB and about half a second on a Raspberry Pi 4

export const isLocked = (text) => String(text).trimStart().startsWith(BEGIN);

const stretch = (pass, salt, { N, r, p }) => crypto.scryptSync(Buffer.from(String(pass).normalize('NFKC')), salt, 32, { N, r, p, maxmem: 256 * N * r });

export function lockText(plain, pass) {
  if (!pass) throw new Error('a passphrase is needed to lock a key');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', stretch(pass, salt, SCRYPT), iv); c.setAAD(AAD);
  const ct = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final(), c.getAuthTag()]);
  const body = Buffer.from(JSON.stringify({ v: 1, kdf: 'scrypt', ...SCRYPT, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') })).toString('base64');
  return `${BEGIN}\n${body.match(/.{1,70}/g).join('\n')}\n${END}\n`;
}

export function unlockText(locked, pass) {
  const body = String(locked).replace(BEGIN, '').replace(END, '').replace(/\s+/g, '');
  let o; try { o = JSON.parse(Buffer.from(body, 'base64').toString('utf8')); } catch { throw new Error('this locked key file is damaged'); }
  if (o.v !== 1 || o.kdf !== 'scrypt') throw new Error('this locked key file is from a newer version');
  const ct = Buffer.from(o.ct, 'base64'), tag = ct.subarray(ct.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', stretch(pass, Buffer.from(o.salt, 'base64'), o), Buffer.from(o.iv, 'base64'));
  d.setAAD(AAD); d.setAuthTag(tag);
  try { return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'); }
  catch { throw new Error('wrong passphrase for this key'); }
}

// Ask on the terminal, without echo. Returns null where there is no terminal.
export function prompt(question) {
  if (!process.stdin.isTTY && !fs.existsSync('/dev/tty')) return null;
  const r = spawnSync('sh', ['-c', 'stty -echo </dev/tty || exit 1; trap "stty echo </dev/tty" EXIT INT TERM; printf "%s" "$1" >/dev/tty; IFS= read -r p </dev/tty; s=$?; printf "\\n" >/dev/tty; [ $s -eq 0 ] && printf "%s" "$p"', 'sh', question], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

export function passphrase(question) {
  if (process.env.ENTITY_PASSPHRASE) return process.env.ENTITY_PASSPHRASE;
  if (process.env.ENTITY_PASSPHRASE_FILE) return fs.readFileSync(process.env.ENTITY_PASSPHRASE_FILE, 'utf8').replace(/\r?\n$/, '');
  return prompt(question);
}

// The OpenSSH text of a key file, unlocking it if it is locked.
export function readKeyFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!isLocked(text)) return text;
  const pass = passphrase(`Passphrase for ${path.basename(file)}: `);
  if (!pass) throw new Error(`${file} is locked: set ENTITY_PASSPHRASE (or ENTITY_PASSPHRASE_FILE), or run this from a terminal`);
  return unlockText(text, pass);
}

// Write a key file in place, only after checking the new text opens.
export function rewriteKeyFile(file, text, check) {
  check(text);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
