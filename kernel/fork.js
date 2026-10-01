// Checking a fork against its parent. Pure: callers supply the parent's
// records (a fork keeps them up to the fork point in parent/events.jsonl).
//
// A fork is honest about its origin when the parent's records up to the fork
// point verify, their count, head and prefix root are the ones the founding act
// names, the reserved members and keys are exactly the parent's members then,
// and every carried piece of state is exactly the parent's state then.

import { canonical } from './canonical.js';
import { prefixRoot } from './attest.js';
import { verifyRecords } from './verify.js';

export function forkMembers(state) {
  const out = {};
  for (const id of state.order) {
    const p = state.participants[id];
    if (p.status === 'active' || p.status === 'applicant') out[id] = p.keys.slice();
  }
  return out;
}

export async function checkFork(registry, founding, parentRecords) {
  const p = founding.parent;
  const problems = [];
  if (!p) return { ok: true, fork: false, problems };
  if (parentRecords.length < p.count) return { ok: false, fork: true, problems: [`the parent's record held here has ${parentRecords.length} records; the fork starts at ${p.count}`] };
  const slice = parentRecords.slice(0, p.count);
  const v = await verifyRecords(registry, slice);
  if (!v.ok) return { ok: false, fork: true, problems: v.problems.map(x => `parent record ${x.seq}: ${x.problem}`) };
  if (slice[0]?.payload?.act?.entity !== p.entity) problems.push(`the parent's record is of ${slice[0]?.payload?.act?.entity}, not ${p.entity}`);
  if (slice[p.count - 1].hash !== p.head) problems.push('the parent\'s head at the fork point differs from the one the fork names');
  if (prefixRoot(slice, p.count) !== p.root) problems.push('the parent\'s history up to the fork point differs from the one the fork names');
  if (canonical(forkMembers(v.state)) !== canonical(p.members)) problems.push('the members reserved in the fork are not exactly the parent\'s members at the fork point');
  for (const [m, carried] of Object.entries(founding.carry || {})) {
    if (canonical(v.state.m[m] ?? null) !== canonical(carried)) problems.push(`the ${m} state carried over differs from the parent's at the fork point`);
  }
  return { ok: !problems.length, fork: true, problems, parentState: v.state };
}
