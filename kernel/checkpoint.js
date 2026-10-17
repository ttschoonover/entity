// 2.10 · Checkpoints: a signed position, binding only with enough co-signers.
//
// checkpoint := { entity, number, count, root, previous, signatures[{ by, signature }] }
//
// One signing key is one key to steal. A co-signer adds to an existing
// checkpoint rather than starting a new one; otherwise a record landing between
// signatures means neither ever reaches the threshold.

import { canonical, omit } from './canonical.js';
import { hash, ZERO } from './hash.js';
import { sign, verify } from './keys.js';
import { NS } from './signed.js';
import { prefixRoot } from './attest.js';
import { keysAt } from './participants.js';

export const checkpointBody = (cp) => omit(cp, 'signatures');
export const checkpointHash = (cp) => hash(canonical(checkpointBody(cp)));

export function makeCheckpoint(records, entity, previous) {
  return {
    entity,
    number: previous ? previous.number + 1 : 1,
    count: records.length,
    root: prefixRoot(records, records.length),
    previous: previous ? checkpointHash(previous) : ZERO,
    signatures: [],
  };
}

export async function cosign(cp, by, privateKey) {
  if (cp.signatures.some(s => s.by === by)) throw new Error(`${by} has already signed checkpoint ${cp.number}`);
  const signature = await sign(canonical(checkpointBody(cp)), privateKey, NS.checkpoint);
  return { ...cp, signatures: [...cp.signatures, { by, signature }] };
}

export async function checkpointStatus(cp, state, required, records) {
  const valid = [], invalid = [];
  const seen = new Set();
  for (const s of cp.signatures) {
    const p = state.participants[s.by];
    if (!p) { invalid.push({ by: s.by, why: 'not on the register' }); continue; }
    if (seen.has(s.by)) { invalid.push({ by: s.by, why: 'signed twice; counted once' }); continue; }
    // The keys the signer held when the record reached this point: a key
    // replaced later still counts for checkpoints before its replacement.
    const at = records?.[cp.count - 1]?.at;
    const v = await verify(canonical(checkpointBody(cp)), s.signature, keysAt(p, at), NS.checkpoint);
    if (v.ok) { valid.push(s.by); seen.add(s.by); } else invalid.push({ by: s.by, why: v.error });
  }
  const consistent = records ? (cp.count <= records.length ? prefixRoot(records, cp.count) === cp.root : null) : null;
  const binding = valid.length >= required;
  return {
    number: cp.number, count: cp.count, binding, valid, invalid, required, consistent,
    why: binding ? null : `not binding: ${valid.length} of ${required} required signatures`,
  };
}

// A checkpoint arriving from someone else (a page, a peer), merged into the
// ones this copy holds. Pure. Refuses a checkpoint that does not match this
// copy's record, breaks the chain, or claims a number already taken by a
// different position; otherwise keeps every signature that verifies, once per
// signer, and drops the rest.
// → { checkpoint, added: [ids] } or { why }
export async function mergeCheckpoint(held, incoming, state, records) {
  const cp = incoming;
  if (!cp || typeof cp !== 'object' || !Array.isArray(cp.signatures)) return { why: 'not a checkpoint' };
  if (cp.entity !== state.entity.id) return { why: `this checkpoint is for ${cp.entity}, not ${state.entity.id}` };
  if (!Number.isInteger(cp.number) || cp.number < 1 || !Number.isInteger(cp.count) || cp.count < 1) return { why: 'number and count are whole numbers' };
  if (cp.count > records.length) return { why: `it marks ${cp.count} records; this copy holds ${records.length}. Sync first` };
  if (prefixRoot(records, cp.count) !== cp.root) return { why: 'it contradicts this copy\'s record' };
  const same = held.find(h => h.number === cp.number);
  if (same && checkpointHash(same) !== checkpointHash(cp)) return { why: `checkpoint ${cp.number} already marks a different position` };
  if (!same) {
    const last = held[held.length - 1] || null;
    if (cp.number !== (last ? last.number + 1 : 1)) return { why: `the next checkpoint is number ${last ? last.number + 1 : 1}` };
    if (cp.previous !== (last ? checkpointHash(last) : ZERO)) return { why: 'it does not follow the last checkpoint' };
    if (last && cp.count <= last.count) return { why: `checkpoint ${last.number} already marks ${last.count} records` };
  }
  const body = canonical(checkpointBody(cp));
  const out = [], seen = new Set();
  for (const s of [...(same?.signatures || []), ...cp.signatures]) {
    const p = state.participants[s?.by];
    if (!p || seen.has(s.by)) continue;
    if ((await verify(body, s.signature, keysAt(p, records[cp.count - 1]?.at), NS.checkpoint)).ok) { out.push(s); seen.add(s.by); }
  }
  const before = new Set((same?.signatures || []).map(s => s.by));
  const added = out.filter(s => !before.has(s.by) || !(same.signatures.find(x => x.by === s.by)?.signature === s.signature)).map(s => s.by);
  if (!out.length) return { why: 'no signature on it verifies' };
  return { checkpoint: { ...checkpointBody(cp), signatures: out }, added };
}
