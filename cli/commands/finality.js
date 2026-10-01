// entity finality · checkpoints that decide (the finality module).
//
//   entity finality status                 what is final, what is open, who signs
//   entity finality sign --as ID           sign the open checkpoint, or open one at the head
//   entity finality evidence FILE --as ID  submit a signed checkpoint.sign that contradicts this record
//   entity finality scan PATH --as ID      read another copy's record (a folder or events.jsonl),
//                                          and submit evidence against every validator in it who
//                                          signed a history contradicting this one

import fs from 'node:fs';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { parseLines } from '../../kernel/index.js';
import { refuse, openEntity, out, signed, settlePending, whoAmI } from '../context.js';

async function mod() {
  try { return (await import('../../modules/finality/index.js')).default; } catch { return null; }
}

export async function finality({ pos, opt }) {
  const e = await openEntity(opt);
  if (!e.params.value('entity.modules').includes('finality')) refuse('the finality module is not enabled here: `entity module add finality`');
  const F = await mod();
  const f = e.state.m.finality || { finals: [], open: null, banned: {}, evidence: [] };
  const sub = pos[0] || 'status';
  const now = new Date().toISOString();

  if (sub === 'status') {
    const last = F.lastFinal(e.state);
    out(`signers    ${e.params.value('finality.signers')}; final at ${Math.round(e.params.value('finality.threshold') * 100)}% of their weight (and always more than half)`);
    out(`final      ${last ? `checkpoint ${last.number}: records 1–${last.count}, signed by ${last.signers.join(', ')} (${last.weight} of ${last.total})` : 'nothing yet: every record is provisional'}`);
    out(`provisional ${e.records.length - (last?.count || 0)} record(s) after that`);
    const o = F.isOpen(e.state, now);
    if (o) out(`open       checkpoint ${o.number} at record ${o.count}: ${F.weightOf(e.state, o)} of ${o.total} signed (${Object.keys(o.signed).join(', ')}); waiting on ${Object.keys(o.roll).filter(id => !o.signed[id]).join(', ') || 'nobody'}`);
    for (const x of f.evidence) out(`evidence   ${x.id}: ${x.against} excluded ${x.at.slice(0, 10)}, reported by ${x.by}: ${x.why}`);
    return;
  }
  const by = whoAmI(e.state.entity.id, opt);

  if (sub === 'sign') {
    const o = F.isOpen(e.state, now);
    const n = (F.lastFinal(e.state)?.number || 0) + 1;
    const fields = o ? { number: o.number, count: o.count, head: o.head } : { number: n, count: e.state.head.seq, head: e.state.head.hash };
    const a = await signed(e, 'checkpoint.sign', fields, opt);
    store.writePending(e.dir, a);
    const r = await settlePending(e);
    const done = r.refused.find(x => x.act.signature === a.signature) || null;
    if (done) refuse(done.reason);
    const last = F.lastFinal(e.state);
    out(last && last.number === fields.number ? `checkpoint ${fields.number} is FINAL: records 1–${fields.count}` : `signed checkpoint ${fields.number} at record ${fields.count}; ${F.weightOf(e.state, e.state.m.finality.open)} of ${e.state.m.finality.open.total} so far`);
    return;
  }

  const lay = async (statement) => {
    const a = await signed(e, 'checkpoint.evidence', { statement }, opt);
    store.writePending(e.dir, a);
    const r = await settlePending(e);
    const bad = r.refused.find(x => x.act.signature === a.signature);
    return bad ? bad.reason : null;
  };

  if (sub === 'evidence') {
    const file = pos[1] || refuse('which file? `entity finality evidence statement.json --as ID`');
    const why = await lay(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (why) refuse(why);
    out(`evidence recorded; ${JSON.parse(fs.readFileSync(file, 'utf8')).by} is excluded from signing checkpoints, and the penalties set here applied`);
    return;
  }

  if (sub === 'scan') {
    const where = pos[1] || refuse('where is the other copy? `entity finality scan ../other-copy --as ID`');
    const file = fs.statSync(where).isDirectory() ? path.join(where, 'record', 'events.jsonl') : where;
    const theirs = parseLines(fs.readFileSync(file, 'utf8')).records;
    const statements = theirs.map(r => r.payload?.act).filter(a => a?.kind === 'checkpoint.sign' && a.entity === e.state.entity.id);
    let n = 0;
    for (const st of statements) {
      if (e.state.m.finality?.banned?.[st.by]) continue;
      const why = await lay(st);
      if (!why) { n++; out(`evidence against ${st.by}: signed checkpoint ${st.number} of a history that is not this one`); }
    }
    out(n ? `${n} validator(s) caught` : `no signature in ${where} contradicts this record`);
    return;
  }
  refuse(`unknown finality command "${sub}"; use status, sign, evidence or scan`);
}
