// Full verification: the chain, then a replay. Every act in the record is
// re-verified and re-settled from nothing; the result must reproduce the
// record byte for byte. A record that verifies here is one anybody can
// reproduce from its acts alone.

import { verifyChain, serialise } from './record.js';
import { emptyState } from './state.js';
import { settle } from './settle.js';

export async function replay(registry, records) {
  const problems = [];
  let state = emptyState();
  let i = 0;
  while (i < records.length) {
    const r = records[i];
    const act = r.payload && r.payload.act;
    if (!act) { problems.push({ seq: r.seq, kind: 'replay', problem: `a ${r.kind} record appears where an act was expected` }); break; }
    let out;
    try { out = await settle(registry, state, [act], { inPlace: true }); }
    catch (e) { problems.push({ seq: r.seq, kind: 'replay', problem: e.message }); break; }
    if (out.held.length) { problems.push({ seq: r.seq, kind: 'modules', problem: `needs the code of module(s) ${out.waitingFor.join(', ')}; run \`entity module fetch\`` }); break; }
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

export async function verifyRecords(registry, records, damage = []) {
  const chain = verifyChain(records, damage);
  if (!chain.ok) return { ...chain, state: null };
  const rep = await replay(registry, records);
  return { ...chain, ok: rep.ok, problems: rep.problems, state: rep.state };
}
