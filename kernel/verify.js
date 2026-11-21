// Full verification: the chain, then a replay. Every act in the record is
// re-verified and re-settled from nothing; the result must reproduce the
// record byte for byte. A record that verifies here is one anybody can
// reproduce from its acts alone.
//
// Sealed records (kernel/sealing.js): the chain is checked over what is
// stored, which anyone can do. The replay reads each act from the record's
// view (the record opened) and must reproduce the stored record, ciphertext
// included; only a reader can do that. verifyStructure is the first half alone.

import { verifyChain, serialise } from './record.js';
import { emptyState } from './state.js';
import { settle } from './settle.js';
import { isSealed } from './sealing.js';

// views: the records in the clear, one per stored record (null where this copy
// cannot open it). sealer: this copy's epoch keys, for re-sealing.
export async function replay(registry, records, { views = records, sealer = null } = {}) {
  const problems = [];
  let state = emptyState();
  let i = 0;
  while (i < records.length) {
    const r = views[i];
    if (!r) { problems.push({ seq: records[i].seq, kind: 'sealed', problem: 'sealed, and this copy holds no key to open it: only a member can replay from here' }); break; }
    const act = r.payload && r.payload.act;
    if (!act) { problems.push({ seq: r.seq, kind: 'replay', problem: `a ${r.kind} record appears where an act was expected` }); break; }
    let out;
    try { out = await settle(registry, state, [act], { inPlace: true, sealer }); }
    catch (e) { problems.push({ seq: r.seq, kind: 'replay', problem: e.message }); break; }
    if (out.held.length) { problems.push({ seq: r.seq, kind: out.waitingFor[0]?.startsWith('the key') ? 'sealed' : 'modules', problem: out.waitingFor[0]?.startsWith('the key') || out.waitingFor[0]?.startsWith('a new key') ? out.waitingFor[0] : `needs the code of module(s) ${out.waitingFor.join(', ')}; run \`entity module fetch\`` }); break; }
    if (out.refused.length) { problems.push({ seq: r.seq, kind: 'replay', problem: `would be refused: ${out.refused[0].reason}` }); break; }
    for (let k = 0; k < out.records.length; k++) {
      if (!records[i + k] || serialise(records[i + k]) !== serialise(out.records[k])) {
        problems.push({ seq: i + k + 1, kind: 'replay', problem: 'differs from what its acts produce' });
        return { ok: false, problems, state };
      }
    }
    state = out.state;
    i += out.records.length;
  }
  return { ok: problems.length === 0, problems, state };
}

export async function verifyRecords(registry, records, damage = [], opts = {}) {
  const chain = verifyChain(records, damage);
  if (!chain.ok) return { ...chain, state: null };
  const rep = await replay(registry, records, opts);
  return { ...chain, ok: rep.ok, problems: rep.problems, state: rep.state };
}

// What anyone can check, member or not: the chain over every record as
// stored, and how much of it is sealed.
export function verifyStructure(records, damage = []) {
  const chain = verifyChain(records, damage);
  const sealed = records.filter(isSealed).length;
  return { ...chain, sealed, public: records.length - sealed };
}
