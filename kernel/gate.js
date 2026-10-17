// 4 · The gate: the entity's own code, subject to its rules.
//
// First match wins. Records first: requiring a decision to record a decision
// deadlocks. That exemption is also the entire privilege automation receives —
// a process passes because of WHAT IT TOUCHED, never because of WHAT IT IS.
//
// Paths no rule names are governed as code. Refusing clearly beats an
// unlisted path slipping through.

import { canonical } from './canonical.js';
import { hash, utf8 } from './hash.js';
import { Parameters } from './parameters.js';

export const RULES = [
  { re: /^record\//,          need: null,             why: 'records: requiring a decision to record a decision deadlocks' },
  { re: /^participants\//,    need: null,             why: 'admission takes effect on recording' },
  { re: /^(pending|settled|refused)\//, need: null,  why: 'acts in transit are signed by their authors and checked at settlement' },
  { re: /^site\//,            need: null,             why: 'built output, reproducible from the governed sources' },
  { re: /^node\.json$/,       need: null,             why: 'this copy\'s local configuration, not the entity\'s' },
  { re: /^\.staged\//,        need: null,             why: 'module code fetched for review, not yet installed' },
  { re: /^parent\//,          need: null,             why: 'the parent\'s record up to a fork: evidence, checked by verify' },
  { re: /^\.entity\//,        need: null,             why: 'this copy\'s working files: histories held for a deliberate merge' },
  { re: /^law\/charter\//,    need: 'constitutional', why: 'the founding text' },
  { re: /^law\//,             need: 'organic',        why: 'law' },
  { re: /^kernel\//,          need: 'organic',        why: 'the code is the procedure' },
  { re: /^modules\//,         need: 'organic',        why: 'the code is the procedure' },
  { re: /^parameters\.yml$/,  need: 'organic',        why: 'every settable value; changes arrive by decision and settlement' },
  { re: /^interface\/style/,  need: null,             why: 'presentation is not governed' },
  { re: /^interface\//,       need: 'organic',        why: 'the verifier participants run' },
  { re: /^(cli|transports|test)\//, need: 'organic',  why: 'the code is the procedure; tests are its guarantees' },
  { re: /^presets\//,         need: 'ordinary',       why: 'templates for other entities' },
  { re: /.*/,                 need: 'organic',        why: 'unlisted paths are governed as code' },
];

export function classify(path, rules = RULES) {
  const p = path.replace(/^\.\//, '');
  const r = rules.find(x => x.re.test(p));
  return { path: p, need: r.need, why: r.why };
}

// What a set of changed paths requires. The strictest match governs.
export function gateNeed(paths, params, rules = RULES) {
  const hits = paths.map(p => classify(p, rules));
  let need = null, because = null;
  for (const h of hits) {
    if (h.need === null) continue;
    if (need === null || params.rank(h.need) > params.rank(need)) { need = h.need; because = h; }
  }
  return { need, because, hits };
}

// digest over [{ path, content | null }] — null means deleted.
export function changeDigest(changes) {
  const items = changes
    .map(c => ({ path: c.path.replace(/^\.\//, ''), hash: c.content === null || c.content === undefined ? null : hash(typeof c.content === 'string' ? utf8(c.content) : c.content) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return hash(canonical(items));
}

// gate(changedPaths, { decision, state, count, digest }) → { need, ok, why, approvers }
//
// Count the ballots; do not read a recorded result. A decision file and a
// result file can arrive in one change, and believing the result would let a
// decision nobody voted on enact anything.
export function gate(changedPaths, { decision, state, count, digest }) {
  const params = new Parameters(state.doc, state.catalog);
  const { need, because } = gateNeed(changedPaths, params);
  if (need === null) return { need: null, ok: true, why: 'no decision required: every path is ungoverned', approvers: [] };
  const needWhy = `${because.path} requires a decision under "${need}" (${because.why})`;
  if (!decision) return { need, ok: false, why: `refused: ${needWhy}; none was cited`, approvers: [] };
  const p = state.proposals[decision];
  if (!p) return { need, ok: false, why: `refused: decision ${decision} is not in the record`, approvers: [] };
  const tally = count(state, decision);
  const approvers = tally.counted.filter(b => b.choice === 'for').map(b => b.by);
  if (!tally.carried) return { need, ok: false, why: `refused: counted ballots show decision ${decision} did not carry (${tally.for} for, ${tally.against} against, quorum ${tally.quorumMet ? 'met' : 'not met'})`, approvers };
  if (!p.enacted) return { need, ok: false, why: `refused: decision ${decision} carried but is not enacted${p.awaiting ? ` (awaiting ${p.awaiting})` : ''}`, approvers };
  if (params.rank(p.rule) < params.rank(need)) return { need, ok: false, why: `refused under amendment.rules.${need}: ${needWhy}; decision ${decision} was made under "${p.rule}"`, approvers };
  const covered = new Set(p.paths || []);
  const missing = changedPaths.map(x => x.replace(/^\.\//, '')).filter(x => !covered.has(x) && classify(x).need !== null);
  if (missing.length) return { need, ok: false, why: `refused: decision ${decision} does not cover ${missing.join(', ')}`, approvers };
  if (digest && p.digest !== digest) return { need, ok: false, why: `refused: the change differs from the one decision ${decision} approved (digest mismatch)`, approvers };
  return { need, ok: true, why: `permitted by decision ${decision} under "${p.rule}"`, approvers };
}
