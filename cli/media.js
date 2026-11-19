// media · pictures for the entity's texts, kept in media/ under their own hash.
//
// A wiki page shows a picture as ![words](media/HASH.jpg "caption"). HASH is the
// first 32 hex digits of the picture's SHA-256, so the signed page names exactly
// one picture: anyone can check a file against its name (`entity media check`),
// and a copy that lacks a file can take it from any other copy and check it the
// same way. media/ is committed with the rest of the entity, so Radicle carries
// it to every peer. The type is read from the file's first bytes, never from
// its name: JPEG, PNG, WebP or GIF, at most 8 MB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
export const MEDIA_PATH = /^media\/([a-f0-9]{32})\.(jpg|png|webp|gif)$/;

export function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return '.gif';
  return null;
}
export const fullHash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const signedMessage = (entityId, hash) => `entity.media\n${entityId}\n${hash}`;

// Keep a picture; returns { path: 'media/…', hash, ext, bytes, existed }.
export function keep(dir, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('no picture was sent');
  if (buf.length > MAX_BYTES) throw new Error('a picture is at most 8 MB');
  const ext = sniff(buf);
  if (!ext) throw new Error('that is not a JPEG, PNG, WebP or GIF picture');
  const hash = fullHash(buf), rel = `media/${hash.slice(0, 32)}${ext}`, f = path.join(dir, rel);
  const existed = fs.existsSync(f);
  if (!existed) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); }
  return { path: rel, hash, ext, bytes: buf.length, existed };
}

// Every file in media/ whose content no longer matches its name.
export function check(dir) {
  const d = path.join(dir, 'media'), bad = [], good = [];
  if (!fs.existsSync(d)) return { good, bad };
  for (const n of fs.readdirSync(d)) {
    const m = `media/${n}`.match(MEDIA_PATH);
    if (!m) { bad.push({ file: n, why: 'not a picture name this entity uses' }); continue; }
    const buf = fs.readFileSync(path.join(d, n));
    if (fullHash(buf).slice(0, 32) !== m[1]) bad.push({ file: n, why: 'its content does not match its name' });
    else if (sniff(buf) !== `.${m[2]}`) bad.push({ file: n, why: 'its type does not match its name' });
    else good.push(n);
  }
  return { good, bad };
}

// The pictures a text shows: [{ src, alt, caption }].
export function imagesIn(md) {
  const out = [];
  for (const m of String(md).matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g)) out.push({ alt: m[1], src: m[2], caption: m[3] || '' });
  return out;
}
