import fs from 'node:fs';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { planAbsorb } from '../../kernel/transport.js';
import { emptyState } from '../../kernel/index.js';
import { refuse, openEntity, entityDir, out, settlePending } from '../context.js';
import { bundleOf, push, pull, absorbInto } from '../net.js';
import { copyCode } from './dist.js';

export async function bundle({ opt }) {
  const e = await openEntity(opt);
  const b = bundleOf(e);
  if (opt.from) { b.range.from = Number(opt.from); b.records = e.records.slice(b.range.from - 1); }
  const f = opt.out || `${e.state.entity.id}-${String(e.records.length).padStart(6, '0')}.bundle.json`;
  fs.writeFileSync(f, JSON.stringify(b) + '\n');
  out(`bundle of ${b.records.length} records, ${b.pending.length} pending act(s), ${b.attestations.length} attestation(s) → ${f}`);
}

function report(plan) {
  const words = { adopt: 'adopted', 'fast-forward': 'fast-forwarded', ahead: 'already ahead of it', same: 'already up to date' };
  return `${words[plan.action] || plan.action}${plan.added ? ` (+${plan.added} records)` : ''}${plan.acts?.length ? `; ${plan.acts.length} act(s) now pending` : ''}`;
}

export async function absorb({ pos, opt }) {
  const e = await openEntity(opt);
  const f = pos[0] || refuse('which file?');
  let b;
  try { b = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (x) { refuse(`cannot read ${f}: ${x.message}`); }
  if (b && b.kind && b.signature && !b.format) b = { format: 'entity-bundle/1', entity: { id: b.entity }, records: [], range: { from: e.records.length + 1, to: e.records.length }, pending: [b], attestations: [], checkpoints: [] };
  const plan = await absorbInto(e, b);
  if (plan.action === 'refused' || plan.action === 'diverged') refuse(plan.why);
  out(report(plan));
  if (opt.settle) { const r = await settlePending(e); out(`settled ${r.applied.length}, refused ${r.refused.length}`); }
}

export async function sync({ opt }) {
  const e = await openEntity(opt);
  const node = store.readNode(e.dir);
  let dests = node.destinations || [];
  if (opt.to) dests = dests.filter(d => d.name === opt.to);
  if (!dests.length) refuse('no destinations. Add them to node.json, e.g. {"destinations":[{"name":"stick","class":"dir","path":"/media/stick"},{"name":"hub","class":"http","url":"https://example.org/entity"}]}');
  for (const d of dests) {
    let got;
    try { got = await pull(e, d); } catch (x) { out(`  pull  ${d.name}: unreachable (${x.message})`); continue; }
    for (const n of got.notes || []) out(`  note  ${d.name}: ${n}`);
    if (!got.length) out(`  pull  ${d.name}: nothing yet`);
    for (const { source, bundle: b } of got) {
      const plan = await absorbInto(e, b);
      if (plan.action === 'diverged') {
        // Kept, never merged silently. Merging is a deliberate act.
        const f = path.join(e.dir, '.entity', 'incoming', `${source.replace(/[^\w.-]+/g, '_')}.bundle.json`);
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(b) + '\n');
        out(`  pull  ${source}: DIVERGED at record ${plan.fork}. Nothing was folded in.`);
        out(`        Their copy is saved at ${path.relative(e.dir, f)}. To combine the histories deliberately:`);
        out(`        entity repair --merge ${path.relative(e.dir, f)} --resettle --write`);
      } else out(`  pull  ${source}: ${plan.action === 'refused' ? `REFUSED — ${plan.why}` : report(plan)}`);
    }
  }
  if (opt.settle) { const r = await settlePending(e); out(`  settled ${r.applied.length}, refused ${r.refused.length}`); }
  const r = await push(e, dests);
  for (const n of r.reached) out(`  push  ${n}: reached`);
  for (const x of r.refused) out(`  push  ${x.destination}: not reached — ${x.why}`);
  out(`${r.reached.length} of ${dests.length} destination(s) reached.`);
  if (!r.reached.length) process.exitCode = 1;
}

// clone: make a new directory that is the whole entity, from any single holder.
export async function clone({ pos, opt }) {
  const [src, target] = pos;
  if (!src || !target) refuse('usage: entity clone <bundle file | http(s) url> <new directory>');
  const to = path.resolve(target);
  if (fs.existsSync(to) && fs.readdirSync(to).length) refuse(`${to} is not empty`);
  if (/^rad:/.test(src)) return cloneRadicle(src, to, opt);
  let b;
  if (/^https?:\/\//.test(src)) { const r = await fetch(`${src.replace(/\/+$/, '')}/bundle`); if (!r.ok) refuse(`${src} answered ${r.status}`); b = await r.json(); }
  else b = JSON.parse(fs.readFileSync(src, 'utf8'));
  copyCode(store.CODE_ROOT, to);
  const { ensureModules } = await import('../modules.js');
  const fetched = ensureModules(to, b.records || []);
  for (const n of fetched.installed) out(`fetched module ${n}; its code matches the record's digest`);
  for (const f of fetched.failed) refuse(`cannot clone without module ${f.name}: ${f.why}`);
  const registry = await store.registryFor(to);
  const plan = await planAbsorb(registry, { entity: null, records: [], state: emptyState(), attestations: [], checkpoints: [] }, b);
  if (plan.action !== 'adopt') refuse(`cannot clone: ${plan.why || plan.action}`);
  store.writeRecords(to, plan.records);
  store.writeDerived(to, plan.state);
  if (plan.attestations.length) store.writeAttestations(to, plan.attestations);
  if (plan.checkpoints.length) store.writeCheckpoints(to, plan.checkpoints);
  for (const a of plan.acts) store.writePending(to, a);
  fs.writeFileSync(path.join(to, 'node.json'), JSON.stringify({ port: 7780, destinations: /^https?:/.test(src) ? [{ name: 'origin', class: 'http', url: src }] : [], classes: {} }, null, 2) + '\n');
  out(`cloned ${b.entity.name} (${b.entity.id}): ${plan.records.length} records verified by replay → ${to}`);
  out(`Note: the code in ${to} is this installation's. Compare it with the entity's own using \`entity gate --against\`.`);
}

// clone over Radicle: the whole directory arrives — code, law, record — and
// is then verified here. Radicle's canonical branch is where it came from,
// not a reason to believe it.
async function cloneRadicle(rid, to, opt) {
  const { runner } = await import('../../transports/radicle.js');
  const run = runner(path.dirname(to), { home: opt.home });
  try { run('rad', ['clone', rid, to, '--timeout', opt.timeout || '60s'], { timeout: 180000 }); }
  catch (x) { refuse(`rad clone failed: ${x.message}`); }
  const { openEntity: open2, fullVerify } = await import('../context.js');
  const e = await open2({ dir: to });
  const v = await fullVerify(e);
  store.writeDerived(to, v.state || e.state);
  const node = { port: 7780, settleAfter: 600, destinations: [{ name: 'radicle', class: 'radicle', ...(opt.home ? { home: opt.home } : {}) }], classes: {} };
  fs.writeFileSync(path.join(to, 'node.json'), JSON.stringify(node, null, 2) + '\n');
  out(`cloned ${e.params.value('entity.name')} (${e.state.entity.id}) from ${rid} → ${to}`);
  out(v.ok ? `${e.records.length} records verified by replay.` : `WARNING: this copy does NOT verify: record ${v.problems[0]?.seq}: ${v.problems[0]?.problem}. Do not act on it.`);
  if (!v.ok) process.exitCode = 1;
}
