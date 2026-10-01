// The state is a fold over records. Rebuilding it needs the record and the
// registry, and nothing else.

import { ZERO } from './hash.js';
import { actId } from './signed.js';
import { Parameters } from './parameters.js';

export function emptyState() {
  return {
    entity: null,
    doc: null,
    source: null,
    participants: {},
    order: [],
    proposals: {},
    decisions: 0,
    modules: {},
    m: {},
    acts: new Set(),
    catalog: {},
    head: { seq: 0, hash: ZERO, at: null },
    hashes: [],
  };
}

export function reduceRecord(registry, state, rec) {
  const fn = registry.reducer(rec.kind);
  if (!fn) throw new Error(`record ${rec.seq}: unknown kind "${rec.kind}"; this copy lacks a module's code (run \`entity module fetch\`)`);
  // The defaults of the code this copy runs. Pinned by digest, so every copy
  // holding the right code holds the same ones.
  state.catalog = registry.catalog;
  fn(state, rec, registry);
  if (rec.payload && rec.payload.act) state.acts.add(actId(rec.payload.act));
  state.head = { seq: rec.seq, hash: rec.hash, at: rec.at };
  // Every record's hash, by position: what a checkpoint is checked against.
  (state.hashes ||= []).push(rec.hash);
  return state;
}

export function foldRecords(registry, records, state = emptyState()) {
  for (const r of records) reduceRecord(registry, state, r);
  return state;
}

export const paramsOf = (state) => state.doc ? new Parameters(state.doc, state.catalog || null) : null;

// Every module this entity has ever relied on: installed at founding or by
// decision, or enabled at any point. A copy must hold all of their code.
export function knownModules(state) {
  const out = new Set(Object.keys(state.modules || {}));
  for (const m of enabledModules(state)) out.add(m);
  out.delete('deliberation');
  return [...out].sort();
}

export function enabledModules(state) {
  const p = paramsOf(state);
  return p && p.has('entity.modules') ? p.value('entity.modules') : [];
}
