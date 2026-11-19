// entity media · pictures for the entity's texts (see cli/media.js)
//
//   entity media add <file> [--alt "words"] [--caption "…"]   keep a picture; prints the Markdown that shows it
//   entity media fetch <url> [--alt …] [--caption …]          download a picture and keep it the same way
//   entity media list                                          the pictures kept, and the wiki pages that show them
//   entity media check                                         every picture still matches its name
//
// Pictures added here need no signature: whoever runs this command already
// holds this copy of the entity. Members on the website sign for each picture.
import fs from 'node:fs';
import path from 'node:path';
import { entityDir, refuse, out, openEntity } from '../context.js';
import * as media from '../media.js';

const snippet = (rel, opt, fallback) => {
  const alt = String(opt.alt || fallback || 'picture').replace(/[[\]]/g, '');
  return `![${alt}](${rel}${opt.caption ? ` "${String(opt.caption).replace(/"/g, "'")}"` : ''})`;
};

export async function mediaCmd({ pos, opt }) {
  const [sub, arg] = pos;
  const dir = entityDir(opt);
  if (sub === 'add') {
    if (!arg || !fs.existsSync(arg)) refuse('usage: entity media add <file> [--alt "words"] [--caption "…"]');
    const k = media.keep(dir, fs.readFileSync(arg));
    out(`${k.existed ? 'already kept' : 'kept'}: ${k.path} (${Math.round(k.bytes / 1024)} KB)`);
    return out(snippet(k.path, opt, path.basename(arg).replace(/\.[^.]+$/, '')));
  }
  if (sub === 'fetch') {
    if (!/^https?:\/\//.test(arg || '')) refuse('usage: entity media fetch <https://…> [--alt "words"] [--caption "…"]');
    const res = await fetch(arg, { headers: { 'user-agent': 'entity-media/1.0 (an Athènes node)' }, redirect: 'follow' });
    if (!res.ok) refuse(`the address answered ${res.status}`);
    const k = media.keep(dir, Buffer.from(await res.arrayBuffer()));
    out(`${k.existed ? 'already kept' : 'kept'}: ${k.path} (${Math.round(k.bytes / 1024)} KB) from ${arg}`);
    return out(snippet(k.path, opt, decodeURIComponent(arg.split('/').pop()).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')));
  }
  if (sub === 'list' || !sub) {
    const d = path.join(dir, 'media');
    const files = fs.existsSync(d) ? fs.readdirSync(d) : [];
    let pages = {};
    try { pages = (await openEntity(opt)).state?.m?.wiki?.pages || {}; } catch { /* listing works without settling */ }
    const usedBy = (f) => Object.entries(pages).filter(([, p]) => p.versions.at(-1).body.includes(`media/${f}`)).map(([id]) => id);
    if (!files.length) return out('no pictures yet: entity media add <file>');
    for (const f of files) out(`media/${f}  ${Math.round(fs.statSync(path.join(d, f)).size / 1024)} KB  ${usedBy(f).join(', ') || '(not shown on any page)'}`);
    return;
  }
  if (sub === 'check') {
    const { good, bad } = media.check(dir);
    out(`${good.length} picture(s) match their names`);
    for (const b of bad) out(`  media/${b.file}: ${b.why}`);
    if (bad.length) process.exitCode = 1;
    return;
  }
  refuse('entity media add <file> | fetch <url> | list | check');
}
