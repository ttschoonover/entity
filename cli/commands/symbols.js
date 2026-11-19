// entity symbols · the state's digital symbols.
//
//   entity symbols seal [--out seal.svg] [--colors field,accent,light] [--hash HEX]
//     Draws the founding seal from the hash of this entity's first record.
//     Anyone with a copy of the record draws the same seal.
//
//   entity symbols fingerprint <file …>
//     The SHA-256 of each file, for a Symbols Act that pins them on the record.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { openEntity, refuse, out } from '../context.js';
import { seal } from '../../interface/js/seal.js';

export async function symbols({ pos, opt }) {
  const [sub, ...rest] = pos;
  if (sub === 'fingerprint') {
    if (!rest.length) refuse('name the files: entity symbols fingerprint favicon.svg …');
    for (const f of rest) out(`${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}  ${f}`);
    return;
  }
  if (sub !== 'seal') refuse('entity symbols seal [--out file] | fingerprint <files…>');
  const e = await openEntity(opt);
  const first = e.records[0];
  if (!first && !opt.hash) refuse('this entity has no record yet');
  const [field, accent, light] = String(opt.colors || '').split(',').filter(Boolean);
  const svg = seal(opt.hash || first.hash, {
    name: e.params.value('entity.name') || e.state.entity.id,
    founded: String(e.state.entity.founded || first.at || '').slice(0, 10),
    colors: { ...(field && { field }), ...(accent && { accent }), ...(light && { light }) },
  });
  if (opt.out) { fs.writeFileSync(opt.out, svg + '\n'); out(`seal drawn from ${(opt.hash || first.hash).slice(0, 16)}… → ${opt.out}`); }
  else out(svg);
}
