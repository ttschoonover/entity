import fs from 'node:fs';
import * as store from '../../kernel/store.js';
import { canonical, diagnose as diag, repair as rep, verifyRecords, foldRecords, loadDocument, Parameters,
  compare, checkpointStatus, emptyState, settle as settleActs, paramsOf } from '../../kernel/index.js';
import { refuse, openEntity, entityDir, out, fullVerify } from '../context.js';

const tick = (ok) => (ok ? 'ok  ' : 'FAIL');

// verify · check it, offline, needing nobody.
export async function verify({ opt }) {
  const e = await openEntity(opt);
  const report = { chain: null, replay: null, parameters: null, participants: null, attestations: null, checkpoints: [] };
  const v = await fullVerify(e);
  report.chain = { ok: !v.problems.some(p => p.kind === 'chain'), records: v.records, head: v.head.hash };
  report.replay = { ok: v.ok, problems: v.problems };
  const st = v.state || e.state;

  const expected = store.parametersText(st);
  const actual = fs.existsSync(store.P(e.dir).params) ? fs.readFileSync(store.P(e.dir).params, 'utf8') : '';
  let paramDrift = [];
  if (expected !== actual) {
    try {
      const want = paramsOf(st).values(), have = new Parameters(loadDocument(actual), st.catalog).values();
      paramDrift = Object.keys({ ...want, ...have }).filter(k => canonical(want[k] ?? null) !== canonical(have[k] ?? null)).map(k => `${k}: file says ${JSON.stringify(have[k])}, record says ${JSON.stringify(want[k])}`);
      if (!paramDrift.length) paramDrift = ['formatting differs from the recorded source'];
    } catch (x) { paramDrift = [`parameters.yml does not parse: ${x.message}`]; }
  }
  report.parameters = { ok: paramDrift.length === 0, drift: paramDrift };

  const pdrift = [];
  for (const id of st.order) {
    const f = `${store.P(e.dir).participants}/${id}.json`;
    const have = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    if (have !== JSON.stringify(st.participants[id], null, 2) + '\n') pdrift.push(id);
  }
  report.participants = { ok: pdrift.length === 0, drift: pdrift };

  const atts = store.readAttestations(e.dir);
  const cmp = await compare(e.records, st, atts);
  report.attestations = { ok: !cmp.diverged.length && !cmp.invalid.length, ...cmp };

  const need = paramsOf(st).value('record.checkpoint_cosigners');
  for (const cp of store.readCheckpoints(e.dir)) report.checkpoints.push(await checkpointStatus(cp, st, need, e.records));

  // A fork is checked against the parent's records it keeps.
  const founding = e.records[0]?.payload?.act;
  if (founding?.parent) {
    const pf = `${e.dir}/parent/events.jsonl`;
    if (!fs.existsSync(pf)) report.fork = { ok: true, held: false, problems: [] };
    else {
      const { parseLines, checkFork } = await import('../../kernel/index.js');
      const c = await checkFork(e.registry, founding, parseLines(fs.readFileSync(pf, 'utf8')).records);
      report.fork = { ok: c.ok, held: true, problems: c.problems };
    }
  }
  const ok = report.chain.ok && report.replay.ok && (!report.fork || report.fork.ok) && report.parameters.ok && report.participants.ok && report.attestations.ok
    && report.checkpoints.every(c => c.consistent !== false);
  if (opt.json) { out(JSON.stringify({ ok, ...report }, null, 2)); if (!ok) process.exitCode = 1; return; }

  out(`${paramsOf(st).value('entity.name')} · ${e.state.entity.id}`);
  out(`${tick(report.chain.ok)} chain          ${v.records} records, head ${v.head.hash.slice(0, 16)}…`);
  out(`${tick(report.replay.ok)} replay         every act re-verified and re-settled from nothing${report.replay.ok ? '; the record is reproduced byte for byte' : ''}`);
  for (const p of report.replay.problems) out(`       record ${p.seq}: ${p.problem}`);
  out(`${tick(report.parameters.ok)} parameters     parameters.yml ${report.parameters.ok ? 'matches the record' : 'differs from the record'}`);
  for (const d of paramDrift) out(`       ${d}`);
  out(`${tick(report.participants.ok)} participants   ${report.participants.ok ? 'participants/ matches the record' : `stale: ${pdrift.join(', ')} (run \`entity settle\` to rewrite)`}`);
  if (report.fork) {
    const pa = founding.parent;
    out(`${tick(report.fork.ok)} fork           of ${pa.name || pa.entity} (${pa.entity}) at record ${pa.count}: ${!report.fork.held ? 'the parent\'s record is not held here (parent/events.jsonl); its origin is unchecked' : report.fork.ok ? 'its record, members and carried state match the fork' : 'DOES NOT MATCH'}`);
    for (const p of report.fork.problems) out(`       ${p}`);
  }
  out(`${tick(report.attestations.ok)} attestations   ${cmp.agreeing.length} agree, ${cmp.ahead.length} hold more, ${cmp.diverged.length} diverged, ${cmp.invalid.length} invalid`);
  for (const d of cmp.diverged) out(`       ${d.by}: ${d.why}. One of these histories has been rewritten.`);
  for (const d of cmp.ahead) out(`       ${d.by}: ${d.why}`);
  for (const d of cmp.invalid) out(`       ${d.by}: invalid (${d.why})`);
  if (!atts.length) out(`       nobody has attested yet; the record is uncorroborated (run \`entity attest\`)`);
  for (const c of report.checkpoints) {
    out(`${tick(c.consistent !== false)} checkpoint ${c.number}   at ${c.count}: ${c.binding ? `binding (${c.valid.length}/${c.required})` : c.why}${c.consistent === false ? '; CONTRADICTS this record' : ''}`);
    // A signature that does not verify counts for nothing. Anyone can add one to
    // a checkpoint file, so it is reported, not held against the copy.
    for (const x of c.invalid) out(`       not counted: a signature under ${x.by}'s name (${x.why}); \`entity checkpoint tidy\` removes it`);
  }
  out(ok ? '\nVerified.' : '\nNOT verified. Do not act on this copy until the failures above are understood.');
  if (!ok) process.exitCode = 1;
}

export async function diagnose({ opt }) {
  const dir = entityDir(opt);
  const { records, damage } = store.read(dir);
  const problems = diag(records, damage);
  if (!problems.length) { out(`no problems in ${records.length} records`); return; }
  for (const p of problems) out(`  ${p.seq ? `record ${p.seq}` : `line ${p.line}`}: ${p.problem}${p.kind === 'conflict' ? ' (a merge conflict marker; concurrent appends — run `entity repair`)' : ''}`);
  process.exitCode = 1;
}

export async function repair({ opt }) {
  const dir = entityDir(opt);
  const { records, damage } = store.read(dir);
  let input = records;
  if (opt.merge) {
    // A bundle file, or a directory of them (such as .entity/incoming).
    const src = String(opt.merge);
    if (!fs.existsSync(src)) refuse(`nothing to merge at ${src}`);
    const files = fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter(f => f.endsWith('.json')).map(f => `${src}/${f}`) : [src];
    for (const f of files) {
      let b; try { b = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (x) { refuse(`${f} is not a bundle: ${x.message}`); }
      input = [...input, ...(b.records || [])];
      out(`merging ${(b.records || []).length} records from ${f}`);
    }
  }
  const r = rep(input);
  const registry = await store.registryFor(dir);
  let result = r.records;
  let v = await verifyRecords(registry, result);
  if (!v.ok && opt.resettle) {
    const acts = result.filter(x => x.payload?.act).map(x => x.payload.act);
    const s = await settleActs(registry, emptyState(), acts);
    result = s.records;
    out(`re-settled ${acts.length} acts from nothing: ${s.applied.length} applied, ${s.refused.length} refused`);
    for (const x of s.refused) out(`  refused ${x.act.kind} by ${x.act.by}: ${x.reason}`);
    v = await verifyRecords(registry, result);
  }
  out(`in ${r.in}, kept ${r.kept}, duplicates ${r.duplicates}, rechained ${r.rechained}, damaged lines dropped ${damage.length}`);
  for (const d of damage.filter(d => d.kind !== 'conflict')) out(`  dropped line ${d.line} (${d.kind}): ${d.text.slice(0, 80)}`);
  out(v.ok ? 'the repaired chain verifies and replays' : `the repaired chain does not replay: record ${v.problems[0]?.seq}: ${v.problems[0]?.problem}. Derived records depend on order; --resettle rebuilds them from the acts.`);
  if (!opt.write) { out('(nothing written; pass --write to replace the record, keeping the previous file beside it)'); return; }
  if (!v.ok) refuse('refusing to write a record that does not verify');
  store.writeRecords(dir, result, { keepPrevious: true });
  // Bundles that have been merged are set aside, so they are not merged again.
  if (opt.merge && fs.statSync(String(opt.merge)).isDirectory()) {
    const done = `${opt.merge}/../merged`; fs.mkdirSync(done, { recursive: true });
    for (const f of fs.readdirSync(opt.merge).filter(f => f.endsWith('.json'))) fs.renameSync(`${opt.merge}/${f}`, `${done}/${Date.now()}-${f}`);
  }
  store.writeDerived(dir, foldRecords(registry, result));
  out('written.');
}

export async function status({ opt }) {
  const e = await openEntity(opt);
  const s = e.state, p = e.params;
  const act = Object.values(s.participants);
  out(`${p.value('entity.name')} · ${s.entity.id} · founded ${s.entity.founded}`);
  if (s.entity.parent) out(`forked     from ${s.entity.parent.name || s.entity.parent.entity} (${s.entity.parent.entity}) at record ${s.entity.parent.count}`);
  out(`record     ${e.records.length} records, head ${s.head.hash.slice(0, 16)}… at ${s.head.at}`);
  out(`members    ${act.filter(x => x.status === 'active').length} active, ${act.filter(x => x.status === 'applicant').length} applying, ${act.filter(x => x.status === 'left').length} left${act.some(x => x.status === 'removed') ? `, ${act.filter(x => x.status === 'removed').length} removed` : ''}`);
  const { resolveElectorate, describeElectorate } = await import('../../kernel/index.js');
  const who = resolveElectorate(e.registry, s, p, s.head.at);
  out(`decides    ${describeElectorate(e.registry, who.spec)}${who.frozen ? '' : who.why ? ` (${who.why})` : ` — ${who.voters} on the roll${who.total !== who.voters ? `, total weight ${who.total}` : ''}`}`);
  const open = Object.values(s.proposals).filter(x => !x.closed);
  out(`proposals  ${open.length} open${open.length ? ':' : ''}`);
  for (const x of open) out(`  ${x.id}  ${x.title}  (${x.rule}, closes ${x.deadline})`);
  out(`pending    ${store.readPending(e.dir).length} act(s) awaiting settlement`);
  out(`modules    ${p.value('entity.modules').join(', ')}`);
}

export async function count({ pos, opt }) {
  const e = await openEntity(opt);
  const id = pos[0] || refuse('which proposal?');
  if (!e.state.proposals[id]) refuse(`no proposal ${id}`);
  const { count: c } = await import('../../modules/deliberation/count.js');
  const t = c(e.state, id);
  if (opt.json) return out(JSON.stringify(t, null, 2));
  const p = e.state.proposals[id];
  out(`${p.title}  [${p.rule}, reading ${p.reading} of ${p.terms.readings}]`);
  out(`electorate ${t.electorateSpec}: ${t.voters} voter(s)${t.weighted ? `, weight ${t.electorate}` : ''}; cast ${t.cast}; quorum ${t.quorumNeeded} ${t.quorumMet ? 'met' : 'not met'}`);
  out(`for ${t.for}, against ${t.against}, abstain ${t.abstain}; share ${(t.share * 100).toFixed(1)}% (needs ${(p.terms.threshold * 100).toFixed(0)}%)`);
  out(t.open ? `open until ${t.deadline}; ${t.projected}` : `closed${t.closedEarly ? ' early' : ''}: ${t.carried ? 'CARRIED' : 'not carried'}${p.enacted ? ', enacted' : p.awaiting ? `, awaiting ${p.awaiting}` : p.notEnacted ? `, NOT enacted: ${p.notEnacted}` : ''}`);
  for (const r of t.rejected) out(`  not counted: ${r.by} — ${r.why}`);
}

export async function params({ pos, opt }) {
  const e = await openEntity(opt);
  const p = e.params;
  const keys = pos[0] ? [pos[0]] : p.keys();
  let group = null;
  for (const k of keys) {
    const d = p.def(k); if (!d) refuse(`no parameter ${k}`);
    if (d.group !== group) { group = d.group; out(`\n${group}`); }
    const r = p.rule(k);
    out(`  ${k.padEnd(36)} ${JSON.stringify(d.value).padEnd(24)} ${r.changeable === false ? 'unchangeable' : `by ${r.name}`}`);
    if (pos[0] && d.describe) out(`\n  ${d.describe}${d.why ? `\n  why: ${d.why}` : ''}`);
  }
}

export async function participants({ opt }) {
  const e = await openEntity(opt);
  for (const id of e.state.order) {
    const x = e.state.participants[id];
    const t = e.state.m.titles?.[id];
    out(`${id.padEnd(12)} ${x.status.padEnd(10)} joined ${x.joined}${x.left ? `, left ${x.left}` : ''}${x.removed ? `, removed ${x.removed}: ${x.reason}` : ''}${x.recovered ? `, key recovered ${x.recovered.length}×` : ''}${t ? `  "${t}"` : ''}`);
  }
}
