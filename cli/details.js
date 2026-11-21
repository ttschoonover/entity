// details.js · the node's side of the details module: partners' particulars,
// encrypted to the partner and the officers (kernel/details.js), kept here,
// never on the record.
//
//   .entity/details/ID.json   one partner's sealed particulars
//
// Every request is signed with the member's (or applicant's) own signing key,
// in namespace "entity.details", and checked against the register: so this
// needs a node that reads the record (a member's node, `entity serve --as`).
//   { body: { entity, member, at, op, … }, signature }
//   op readers   → the readers' record keys, to seal to          (any member or applicant)
//   op file      → { blob }: file or replace one's own particulars (member or applicant)
//   op mine      → one's own sealed particulars
//   op list      → every partner's sealed particulars              (a current reader)
//   op share     → { blobs }: the same particulars wrapped to more readers (a current reader)

import fs from 'node:fs';
import path from 'node:path';
import * as D from '../kernel/details.js';
import { keys as K, sealing as S } from '../kernel/index.js';

const dirOf = (dir) => path.join(dir, '.entity', 'details');
const fileOf = (dir, id) => path.join(dirOf(dir), `${id}.json`);
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const enabled = (e) => !e.unreadable && !!e.params?.value('entity.modules')?.includes('details');

export function readerIds(e, at = new Date().toISOString()) {
  const out = new Set();
  for (const o of e.params.value('details.readers')) for (const h of e.state.m.offices?.[o]?.holders || []) if (!h.until || h.until > at) out.add(h.id);
  return [...out];
}
export function readers(e) {
  const keys = S.sealingState(e.state).keys;
  return readerIds(e).filter(id => keys[id]).map(id => ({ id, key: keys[id] }));
}
const read = (dir, id) => { try { return JSON.parse(fs.readFileSync(fileOf(dir, id), 'utf8')); } catch { return null; } };
function write(dir, id, blob) {
  fs.mkdirSync(dirOf(dir), { recursive: true, mode: 0o700 });
  const t = `${fileOf(dir, id)}.${process.pid}.tmp`;
  fs.writeFileSync(t, JSON.stringify(blob) + '\n', { mode: 0o600 }); fs.renameSync(t, fileOf(dir, id));
}
export const list = (dir) => { try { return fs.readdirSync(dirOf(dir)).filter(f => f.endsWith('.json')).map(f => read(dir, f.slice(0, -5))).filter(Boolean); } catch { return []; } };

function sameParticulars(a, b) { return a.v === b.v && a.entity === b.entity && a.member === b.member && a.nonce === b.nonce && a.ct === b.ct; }

export async function handle(e, req, { now = Date.now() } = {}) {
  const fail = (m) => ({ ok: false, error: m });
  const body = req?.body;
  if (!body || typeof req.signature !== 'string') return fail('send { body, signature }');
  if (body.entity !== e.state.entity.id) return fail('that request is for another entity');
  if (!ID.test(body.member || '')) return fail('member is an id');
  if (!(Math.abs(now - Date.parse(body.at)) < 10 * 60000)) return fail('the request is stale: check this device\'s clock');
  const p = e.state.participants[body.member];
  if (!p || !['active', 'applicant'].includes(p.status)) return fail(`${body.member} is not a partner or applicant`);
  const v = await K.verify(D.requestMessage(body), req.signature, p.keys, D.REQUEST_NAMESPACE);
  if (!v.ok) return fail(`the request is not signed by ${body.member}: ${v.error}`);
  const isReader = p.status === 'active' && readerIds(e).includes(body.member);

  if (body.op === 'readers') return { ok: true, readers: readers(e) };
  if (body.op === 'mine') return { ok: true, blob: read(e.dir, body.member) };
  if (body.op === 'file') {
    const b = body.blob;
    if (!b || b.v !== D.DETAILS_VERSION || b.entity !== e.state.entity.id || b.member !== body.member) return fail('those are not your sealed particulars');
    if (!b.wraps?.[body.member]) return fail('seal them to yourself as well, so you can read and correct them');
    const missing = readers(e).filter(r => !b.wraps[r.id]).map(r => r.id);
    if (missing.length) return fail(`seal them to every reader: missing ${missing.join(', ')}`);
    if (JSON.stringify(b).length > 64000) return fail('too large');
    write(e.dir, body.member, b);
    return { ok: true, digest: D.digestOf(b) };
  }
  if (body.op === 'list') return isReader ? { ok: true, blobs: list(e.dir) } : fail('only the officers who keep partners\' particulars may read them');
  if (body.op === 'share') {
    if (!isReader) return fail('only a reader may share particulars with another');
    let n = 0;
    for (const b of body.blobs || []) {
      const old = read(e.dir, b?.member);
      if (!old || !sameParticulars(old, b)) return fail(`${b?.member}: those are not the same particulars`);
      if (Object.keys(old.wraps).some(id => !b.wraps?.[id])) return fail(`${b.member}: keep every existing reader`);
      write(e.dir, b.member, { ...old, wraps: b.wraps }); n++;
    }
    return { ok: true, shared: n };
  }
  return fail('op is readers, file, mine, list or share');
}
