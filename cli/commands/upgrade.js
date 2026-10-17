// entity upgrade · the core, by decision.
//
//   entity upgrade check   [SOURCE]           fetch it, check the record replays, say what it changes
//   entity upgrade propose [SOURCE] --as ID   the same, then lay the proposal that approves exactly it
//   entity upgrade apply   [--decision ID]    once carried, install exactly what was approved
//
// SOURCE defaults to "upgrade.source" in node.json, e.g. "dir:~/entities/entity"
// or "github:you/entity@main". Restart any running `entity serve` after applying.

import fs from 'node:fs';
import path from 'node:path';
import * as up from '../upgrade.js';
import * as store from '../../kernel/store.js';
import { refuse, openEntity, out, fullVerify, signed } from '../context.js';
import { proposalId } from '../../modules/deliberation/index.js';

export function sourceOf(dir, given) {
  if (given) return given;
  try { const n = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8')); if (n.upgrade?.source) return n.upgrade.source; } catch { /* none */ }
  return null;
}

const older = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };
function report(m, e) {
  out(`entity ${m.from} → ${m.version}, from ${m.pinned}`);
  // From 0.9.0 the page is a module: a republic without it runs headless.
  if (e && older(m.from, '0.9.0') && !older(m.version, '0.9.0') && !e.params.value('entity.modules').includes('page'))
    out('  NOTE: from 0.9.0 the page is a module. Install it first (entity module add page, or from Settings), or after this upgrade the republic has no page.');
  out(`  ${m.paths.length} core file(s) change; digest ${m.digest}`);
  out(`  the record ${m.replays ? 'replays byte for byte with the new code' : 'DOES NOT replay with the new code'}`);
  if (!m.replays) out(m.replayOutput.split('\n').map(l => `    ${l}`).join('\n'));
  out(`  needs a decision under the ${m.need} rule`);
}

export async function upgrade({ pos, opt }) {
  const e = await openEntity(opt);
  const sub = pos[0] || 'check';
  if (sub === 'check' || sub === 'propose') {
    const source = sourceOf(e.dir, pos[1] || opt.source) || (sub === 'propose' && up.staged(e.dir)?.source) || refuse('where from? `entity upgrade check dir:~/entities/entity`, or set "upgrade": { "source": "…" } in node.json');
    let m;
    try { m = up.check(e.dir, source, e.params); } catch (x) { refuse(x.message); }
    if (!m.paths.length) { out(`entity ${m.version} from ${m.pinned} is the code this copy already runs; nothing to upgrade`); return; }
    report(m, e);
    if (sub === 'check') { out('Propose it with `entity upgrade propose --as ID`.'); return; }
    if (!m.replays) refuse('refusing to propose code that would not reproduce this entity\'s record');
    const a = await signed(e, 'proposal.lay', up.proposal(m), opt);
    store.writePending(e.dir, a);
    out(`proposal ${proposalId(a)} signed; settle it, and vote. Once it carries: \`entity upgrade apply\`.`);
    return;
  }
  if (sub === 'apply') {
    const v = await fullVerify(e);
    if (!v.ok) refuse(`this copy's record does not verify (${v.problems[0]?.problem}); nothing can be installed on its authority`);
    let r;
    try { r = up.apply(e.dir, v.state, opt.decision); } catch (x) { refuse(x.message); }
    out(`INSTALLED entity ${r.version}: ${r.paths} file(s), permitted by decision ${r.decision}, approved by ${r.approvers.join(', ')}.`);
    out('Run `entity verify` with it, restart any running `entity serve`, then `entity module upgrade NAME` for modules with new code.');
    return;
  }
  if (sub === 'status') {
    const m = up.staged(e.dir);
    if (!m) return out('nothing staged');
    report(m, e);
    const d = up.approvedBy(e.state, m);
    out(d ? `  approved by decision ${d.id}: \`entity upgrade apply\` installs it` : '  not yet approved by any decision');
    return;
  }
  refuse(`unknown upgrade command "${sub}"; use check, propose, apply or status`);
}
