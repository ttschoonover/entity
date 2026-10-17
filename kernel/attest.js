// 2.9 · Attestation: a participant saying what they hold.
//
// attestation := { entity, by, at, count, root, marks, signature }
//
// root  = merkleRoot of the first `count` record hashes.
// marks = prefix roots at counts 1, 2, 4, 8, … below `count`.
//
// Comparing counts alone fails: a truncated chain looks exactly like lagging.
// So for each attestation we ask whether its roots appear among the prefix
// roots of the history we now hold.
//
//   count ≤ ours, root matches our prefix          → agreeing (we hold it, or more)
//   count > ours, every mark ≤ ours matches        → ahead of us: fetch from them
//   any root or mark ≤ ours does not match         → diverged: a history was rewritten
//
// Named limit: removing only the final records of a chain is indistinguishable
// from lagging until the missing records are fetched and compared.

import { merkleRoot } from './hash.js';
import { canonical, omit } from './canonical.js';
import { sign, verify } from './keys.js';
import { NS } from './signed.js';

export function prefixRoot(records, n) {
  return merkleRoot(records.slice(0, n).map(r => r.hash));
}

export function markCounts(count) {
  const out = [];
  for (let c = 1; c < count; c *= 2) out.push(c);
  return out;
}

export function attestationBody(records, { entity, by, at }) {
  const count = records.length;
  const marks = {};
  for (const c of markCounts(count)) marks[c] = prefixRoot(records, c);
  return { entity, by, at, count, root: prefixRoot(records, count), marks };
}

export async function attest(records, { entity, by, at }, privateKey) {
  const body = attestationBody(records, { entity, by, at });
  return { ...body, signature: await sign(canonical(body), privateKey, NS.attestation) };
}

export async function verifyAttestation(att, state) {
  const p = state.participants[att.by];
  if (!p) return { ok: false, error: `${att.by} is not on the register` };
  if (state.entity && att.entity !== state.entity.id) return { ok: false, error: 'attests a different entity' };
  return verify(canonical(omit(att, 'signature')), att.signature, p.keys, NS.attestation);
}

export async function compare(records, state, attestations) {
  const agreeing = [], ahead = [], diverged = [], invalid = [];
  const memo = new Map();
  const root = (n) => { if (!memo.has(n)) memo.set(n, prefixRoot(records, n)); return memo.get(n); };
  const mine = records.length;
  for (const a of attestations) {
    const v = await verifyAttestation(a, state);
    if (!v.ok) { invalid.push({ by: a.by, why: v.error }); continue; }
    const checks = Object.entries(a.marks || {}).map(([c, r]) => [Number(c), r]).concat([[a.count, a.root]]);
    const mismatch = checks.find(([c, r]) => c <= mine && root(c) !== r);
    if (mismatch) {
      diverged.push({ by: a.by, at: a.at, count: a.count, at_count: mismatch[0],
        why: `their history and ours disagree at or before record ${mismatch[0]}` });
    } else if (a.count > mine) {
      ahead.push({ by: a.by, at: a.at, count: a.count, why: `they hold ${a.count - mine} more record(s); fetch from them` });
    } else {
      agreeing.push({ by: a.by, at: a.at, count: a.count });
    }
  }
  return { agreeing, ahead, diverged, invalid };
}
