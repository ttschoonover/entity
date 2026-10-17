import fs from 'node:fs';
// 5.1 · push(destinations) → { reached, refused }. A refusal from one
// destination is reported and passed over; reaching two of five is success.
// Adding a transport class is configuration: name a module in node.json.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as store from '../kernel/store.js';
import { makeBundle, planAbsorb } from '../kernel/transport.js';

const BUILTIN = { file: '../transports/file.js', dir: '../transports/dir.js', http: '../transports/http.js', radicle: '../transports/radicle.js' };

export async function classFor(dir, node, name) {
  if (node.classes && node.classes[name]) {
    const m = await import(pathToFileURL(path.resolve(dir, node.classes[name])).href);
    return m.default;
  }
  if (BUILTIN[name]) return (await import(new URL(BUILTIN[name], import.meta.url).href)).default;
  throw new Error(`no transport class "${name}"; add it under "classes" in node.json`);
}

export async function connect(dir, node, dest) {
  const make = await classFor(dir, node, dest.class);
  return make(dest, { dir });
}

export function bundleOf(e) {
  return makeBundle({
    entity: { id: e.state.entity.id, name: e.params.value('entity.name') },
    records: e.records,
    pending: store.readPending(e.dir).filter(p => p.act).map(p => p.act),
    attestations: store.readAttestations(e.dir),
    checkpoints: store.readCheckpoints(e.dir),
  });
}

export async function push(e, destinations) {
  const node = store.readNode(e.dir);
  const bundle = bundleOf(e);
  const results = await Promise.allSettled(destinations.map(async d => {
    const t = await connect(e.dir, node, d);
    await t.push(bundle);
    return t.name;
  }));
  const reached = [], refused = [];
  results.forEach((r, i) => r.status === 'fulfilled' ? reached.push(r.value) : refused.push({ destination: destinations[i].name || destinations[i].url || destinations[i].path, why: r.reason.message }));
  return { reached, refused };
}

// A class may return one bundle, or [{ source, bundle }] when a destination
// holds many peers (Radicle does). Either way: a list of sources.
export async function pull(e, dest) {
  const node = store.readNode(e.dir);
  const t = await connect(e.dir, node, dest);
  const got = await t.pull();
  if (!got) return [];
  if (Array.isArray(got)) return Object.assign(got.map(x => ({ source: `${dest.name} · ${x.source}`, bundle: x.bundle })), { notes: got.notes || [] });
  return [{ source: dest.name, bundle: got }];
}

// Fold a bundle in, if and only if it verifies and attestations agree.
export async function absorbInto(e, bundle) {
  const plan = await planAbsorb(e.registry, {
    entity: e.state.entity, records: e.records, state: e.state,
    attestations: store.readAttestations(e.dir), checkpoints: store.readCheckpoints(e.dir),
  }, bundle);
  if (plan.action === 'refused' || plan.action === 'diverged' || plan.action === 'kept') return plan;
  if (plan.action === 'switched') {
    // The records this copy made after the fork were never final. Keep them
    // beside the record, and settle their acts again on the history that stands.
    const f = path.join(e.dir, 'record', `orphaned-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    fs.writeFileSync(f, plan.orphaned.map(r => JSON.stringify(r)).join('\n') + '\n');
    store.writeRecords(e.dir, plan.records);
    e.records = plan.records; e.state = plan.state;
    store.writeDerived(e.dir, e.state);
    for (const a of plan.acts) store.writePending(e.dir, a);
    return plan;
  }
  if (plan.added > 0) {
    store.writeRecords(e.dir, plan.records);
    e.records = plan.records; e.state = plan.state;
    store.writeDerived(e.dir, e.state);
  }
  if (plan.attestations.length) store.writeAttestations(e.dir, plan.attestations);
  if (plan.checkpoints.length) store.writeCheckpoints(e.dir, plan.checkpoints);
  const already = new Set(store.readPending(e.dir).filter(p => p.act).map(p => JSON.stringify(p.act)));
  for (const a of plan.acts) if (!already.has(JSON.stringify(a))) store.writePending(e.dir, a);
  return plan;
}
