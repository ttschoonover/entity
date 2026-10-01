import fs from 'node:fs';
import path from 'node:path';
import { gate as runGate, changeDigest, classify } from '../../kernel/gate.js';
import { refuse, openEntity, out, fullVerify } from '../context.js';
import * as store from '../../kernel/store.js';
import { walk, NEVER } from './dist.js';
import { count } from '../../modules/deliberation/count.js';

const read = (root, p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p)) : null);

export function changedBetween(candidate, approved) {
  const list = (r) => walk(r, '').filter(f => !NEVER.some(re => re.test(f)) || /^parameters\.yml$/.test(f)).filter(f => !/^(record|participants|pending|settled|refused|site)\//.test(f));
  const all = new Set([...list(candidate), ...list(approved)]);
  return [...all].filter(p => { const a = read(candidate, p), b = read(approved, p); return !(a && b && a.equals(b)); }).sort();
}

// entity gate digest <paths…>            the digest a proposal must carry
// entity gate <paths…> --decision <id>   may these paths change as they now stand?
// entity gate --against <dir> [--decision <id>]
export async function gate({ pos, opt }) {
  const e = await openEntity(opt);
  if (pos[0] === 'digest') {
    const paths = pos.slice(1);
    if (!paths.length) refuse('which paths?');
    out(changeDigest(paths.map(p => ({ path: p, content: read(e.dir, p) }))));
    return;
  }
  let paths = opt.against ? changedBetween(e.dir, path.resolve(opt.against)) : pos;
  // Count ballots from a record that has itself been verified. A result file,
  // however it arrived, is never read.
  const v = await fullVerify(e);
  if (!v.ok) refuse(`the record does not verify (${v.problems[0]?.problem}); nothing can be permitted from it`);
  // parameters.yml changes by settlement. Written exactly as the record
  // dictates, it passes because of what it is; any other edit is governed.
  if (paths.includes('parameters.yml') && String(read(e.dir, 'parameters.yml')) === store.parametersText(v.state)) {
    out('  derived         parameters.yml (exactly as the record dictates)');
    paths = paths.filter(p => p !== 'parameters.yml');
  }
  if (!paths.length) { out('no governed changes to gate'); return; }
  const digest = changeDigest(paths.map(p => ({ path: p, content: read(e.dir, p) })));
  const r = runGate(paths, { decision: opt.decision, state: v.state, count, digest });
  if (opt.json) { out(JSON.stringify({ paths, digest, ...r }, null, 2)); if (!r.ok) process.exitCode = 1; return; }
  for (const p of paths) { const c = classify(p); out(`  ${c.need ? c.need.padEnd(15) : 'ungoverned'.padEnd(15)} ${p}`); }
  out(`digest ${digest}`);
  out(r.ok ? `PERMITTED: ${r.why}` : `REFUSED: ${r.why.replace(/^refused: /, '')}`);
  if (r.approvers.length) out(`approved by: ${r.approvers.join(', ')}`);
  if (!r.ok) process.exitCode = 1;
}
