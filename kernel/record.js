// 2.3 · The record. Pure functions only; disk access lives in store.js so the
// same code runs in the browser.
//
// record := { seq, at, author, kind, payload, prev, hash }
// hash   := hash(prev ‖ canonical(record minus hash))
// Stored one canonical JSON object per line, append-only.

import { canonical, omit } from './canonical.js';
import { hash, ZERO } from './hash.js';

export { ZERO };

export function recordHash(rec) {
  return hash(rec.prev + canonical(omit(rec, 'hash')));
}

export function makeRecord(head, { at, author, kind, payload }) {
  const rec = { seq: head.seq + 1, at, author, kind, payload, prev: head.hash };
  rec.hash = recordHash(rec);
  return rec;
}

export const serialise = (rec) => canonical(rec);
export const serialiseAll = (recs) => recs.map(serialise).join('\n') + (recs.length ? '\n' : '');

// Content identity: what a record says, independent of where it sits.
export const contentOf = (rec) => canonical(omit(rec, 'seq', 'prev', 'hash'));

// read never throws. Damage is data.
export function parseLines(text) {
  const records = [], damage = [];
  const lines = String(text).split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (/^(<{7}|={7}|>{7})/.test(line)) { damage.push({ line: i + 1, kind: 'conflict', text: raw }); return; }
    try {
      const r = JSON.parse(line);
      if (!r || typeof r !== 'object' || typeof r.seq !== 'number' || typeof r.hash !== 'string') {
        damage.push({ line: i + 1, kind: 'malformed', text: raw });
      } else records.push(r);
    } catch { damage.push({ line: i + 1, kind: 'unparsable', text: raw }); }
  });
  return { records, damage };
}

// Chain verification. Reports the first break and everything it invalidates.
export function verifyChain(records, damage = []) {
  const problems = damage.map(d => ({ ...d, problem: `line ${d.line}: ${d.kind}` }));
  let prev = ZERO, broken = null;
  records.forEach((r, i) => {
    const expectSeq = i + 1;
    const why = [];
    if (r.seq !== expectSeq) why.push(`seq is ${r.seq}, expected ${expectSeq}`);
    if (r.prev !== prev) why.push('prev does not match the previous record');
    if (recordHash(r) !== r.hash) why.push('hash does not match content');
    if (why.length) {
      if (broken === null) broken = expectSeq;
      problems.push({ seq: expectSeq, kind: 'chain', problem: why.join('; ') });
    } else if (broken !== null) {
      problems.push({ seq: expectSeq, kind: 'chain', problem: `follows a broken record (${broken})` });
    }
    prev = r.hash;
  });
  const last = records[records.length - 1];
  return {
    ok: problems.length === 0,
    records: records.length,
    head: last ? { seq: last.seq, hash: last.hash, at: last.at } : { seq: 0, hash: ZERO, at: null },
    problems,
  };
}
