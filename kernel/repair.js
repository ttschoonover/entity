// 2.4 · Repair. Concurrent appends are expected, not an error.
//
// Every record's content is preserved exactly; only seq, prev and hash are
// recomputed. Order: by `at`, then by the causing act's hash, then by position
// within that act. Duplicates (same content) are dropped.

import { contentOf, recordHash, ZERO, verifyChain } from './record.js';
import { actHash } from './signed.js';

function sortKey(r) {
  const cause = r.payload?.act ? actHash(r.payload.act) : (r.payload?.cause || '');
  const part = r.payload?.act ? 0 : (r.payload?.part ?? 0);
  return [r.at || '', cause, part];
}

export function diagnose(records, damage = []) {
  const problems = verifyChain(records, damage).problems.slice();
  const seen = new Map();
  records.forEach((r) => {
    const c = contentOf(r);
    if (seen.has(c)) problems.push({ seq: r.seq, kind: 'duplicate', problem: `duplicates record ${seen.get(c)}` });
    else seen.set(c, r.seq);
  });
  for (let i = 1; i < records.length; i++) {
    if ((records[i].at || '') < (records[i - 1].at || '')) problems.push({ seq: records[i].seq, kind: 'order', problem: 'dated before the record it follows' });
  }
  return problems;
}

export function repair(records) {
  const byContent = new Map();
  for (const r of records) {
    const c = contentOf(r);
    if (!byContent.has(c)) byContent.set(c, r);
  }
  const kept = [...byContent.values()].sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    for (let i = 0; i < 3; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; }
    return 0;
  });
  let prev = ZERO;
  let rechained = 0;
  const out = kept.map((r, i) => {
    const n = { seq: i + 1, at: r.at, author: r.author, kind: r.kind, payload: r.payload, prev };
    n.hash = recordHash(n);
    if (n.hash !== r.hash) rechained++;
    prev = n.hash;
    return n;
  });
  return { records: out, in: records.length, kept: out.length, duplicates: records.length - out.length, rechained };
}
