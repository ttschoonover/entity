// 5 · Transport, the pure part. What moves between copies is a bundle: the
// record, attestations, checkpoints and acts awaiting settlement. A source is a
// source, never an authority: nothing is folded in until the record still
// verifies AND attestations still agree.

import { verifyRecords } from './verify.js';
import { compare } from './attest.js';
import { actHash, actId } from './signed.js';

export const BUNDLE_FORMAT = 'entity-bundle/1';

export function makeBundle({ entity, records, pending = [], attestations = [], checkpoints = [], from = 1 }) {
  return {
    format: BUNDLE_FORMAT,
    entity,
    range: { from, to: records.length },
    records: records.slice(from - 1),
    pending, attestations, checkpoints,
  };
}

// Latest attestation per participant.
export function mergeAttestations(a, b) {
  const by = new Map();
  for (const x of [...a, ...b]) {
    const cur = by.get(x.by);
    if (!cur || x.at > cur.at || (x.at === cur.at && x.count > cur.count)) by.set(x.by, x);
  }
  return [...by.values()].sort((x, y) => (x.by < y.by ? -1 : 1));
}

export function mergeCheckpoints(a, b) {
  const key = (c) => `${c.number}:${c.count}:${c.root}:${c.previous}`;
  const m = new Map();
  for (const c of [...a, ...b]) {
    const k = key(c);
    if (!m.has(k)) m.set(k, { ...c, signatures: [...c.signatures] });
    else {
      const cur = m.get(k);
      for (const s of c.signatures) if (!cur.signatures.some(t => t.by === s.by)) cur.signatures.push(s);
    }
  }
  return [...m.values()].sort((x, y) => x.number - y.number);
}

// Decide what absorbing a bundle would do. Nothing is written here.
export async function planAbsorb(registry, local, bundle) {
  if (!bundle || bundle.format !== BUNDLE_FORMAT) return { action: 'refused', why: 'not an entity bundle' };
  if (local.entity && bundle.entity && bundle.entity.id !== local.entity.id) {
    return { action: 'refused', why: `bundle is for entity ${bundle.entity.id}, this is ${local.entity.id}` };
  }
  const L = local.records;
  let B = bundle.records;
  if (bundle.range && bundle.range.from > 1) {
    const base = L.slice(0, bundle.range.from - 1);
    if (base.length !== bundle.range.from - 1) return { action: 'refused', why: `bundle starts at record ${bundle.range.from}; this copy holds only ${L.length}` };
    B = [...base, ...B];
  }
  const v = await verifyRecords(registry, B);
  if (!v.ok) return { action: 'refused', why: `bundle does not verify: ${v.problems[0]?.problem || 'unknown'} (record ${v.problems[0]?.seq ?? '?'})` };

  let candidate, action;
  const k = Math.min(L.length, B.length);
  if (k > 0 && L[k - 1].hash !== B[k - 1].hash) {
    let fork = 0; while (fork < k && L[fork].hash === B[fork].hash) fork++;
    // With a finality module, final checkpoints decide: a history with records
    // made final past the fork stands; the other's records after the fork are
    // provisional, set aside, and their acts settled again on top of it.
    const c = registry.forkChoice && local.state ? registry.forkChoice(local.state, v.state, fork + 1) : null;
    if (c?.action === 'switch') {
      const orphaned = L.slice(fork);
      const requeue = orphaned.map(r => r.payload?.act).filter(a => a && !v.state.acts.has(actId(a)));
      const pend = (bundle.pending || []).filter(a => !v.state.acts.has(actId(a)));
      return { action: 'switched', fork: fork + 1, why: c.why, records: B, added: B.length - fork, state: v.state, orphaned,
        acts: [...requeue, ...pend], attestations: mergeAttestations(local.attestations || [], bundle.attestations || []),
        checkpoints: mergeCheckpoints(local.checkpoints || [], bundle.checkpoints || []) };
    }
    if (c?.action === 'keep') return { action: 'kept', fork: fork + 1, why: c.why };
    if (c?.action === 'conflict') return { action: 'refused', fork: fork + 1, why: c.why };
    return { action: 'diverged', fork: fork + 1, why: `histories diverge at record ${fork + 1}; nothing was folded in. Use \`entity repair --merge\` to combine them deliberately.` };
  }
  if (B.length > L.length) { candidate = B; action = L.length ? 'fast-forward' : 'adopt'; }
  else { candidate = L; action = B.length < L.length ? 'ahead' : 'same'; }

  const state = B.length >= L.length ? v.state : local.state;
  const atts = mergeAttestations(local.attestations || [], bundle.attestations || []);
  const cmp = await compare(candidate, state, atts);
  if (cmp.diverged.length) {
    return { action: 'refused', why: `attestations disagree with this history: ${cmp.diverged.map(d => `${d.by} (${d.why})`).join('; ')}` };
  }
  const known = state.acts;
  const acts = (bundle.pending || []).filter(a => !known.has(actId(a)));
  return {
    action, records: candidate, added: candidate.length - L.length, state,
    attestations: atts.filter(a => !cmp.invalid.some(x => x.by === a.by)),
    checkpoints: mergeCheckpoints(local.checkpoints || [], bundle.checkpoints || []),
    acts, comparison: cmp,
  };
}
