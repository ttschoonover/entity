// §12 · The acceptance suite. An implementation lacking these has not
// demonstrated the thing. Numbers match the specification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  serialiseAll, verifyChain, recordHash, settle, emptyState, signAct, draft, keys, NS, signedMaterial, canonical, omit,
  repair, verifyRecords, attest, compare, makeCheckpoint, cosign, checkpointStatus, gate, changeDigest, makeBundle, planAbsorb,
  createRegistry, parseLines,
} from '../kernel/index.js';
import * as store from '../kernel/store.js';

import { count } from '../modules/deliberation/count.js';
import { world, propose, tmp, quietly, entityOnDisk, ROOT, loadModules } from './helpers.js';

async function vote(w, id, voters, choice = 'for') {
  for (const v of voters) await w.settle(await w.sign('ballot.cast', v, { proposal: id, choice }));
}

// ───────────────────────────────────────────── Kernel

test('1 · two independent settlements of the same acts produce byte-identical records', async () => {
  const base = await entityOnDisk();
  const { openEntity, settlePending } = await import('../cli/context.js');
  const e = await openEntity({ dir: base });
  const acts = [];
  const sign = (kind, by, fields) => signAct(e.registry, draft(kind, { entity: e.state.entity.id, by, at: fields.at, ...fields }),
    keys.importPrivateKey(fs.readFileSync(path.join(process.env.ENTITY_KEYS, e.state.entity.id, by), 'utf8')));
  const t = (m) => new Date(Date.parse(e.state.head.at) + m * 60000).toISOString();
  const lay = await sign('proposal.lay', 'p-0001', { at: t(1), title: 'Two weeks', rule: 'organic', changes: { 'deliberation.period': 14 } });
  const { proposalId } = await import('../modules/deliberation/index.js');
  acts.push(lay, await sign('title.set', 'p-0002', { at: t(1), title: 'Same moment' }));
  for (const [i, by] of ['p-0001', 'p-0002', 'p-0003'].entries()) acts.push(await sign('ballot.cast', by, { at: t(2 + i), proposal: proposalId(lay), choice: 'for' }));
  acts.push(await sign('ballot.cast', 'p-0003', { at: t(9), proposal: proposalId(lay), choice: 'against' })); // after close

  const copies = [tmp(), tmp()];
  for (const c of copies) fs.cpSync(base, c, { recursive: true });
  // Different machines receive the acts in different orders and settle at different times.
  for (const a of acts) store.writePending(copies[0], a);
  for (const a of [...acts].reverse()) store.writePending(copies[1], a);
  await quietly(async () => { await settlePending(await openEntity({ dir: copies[0] }), { until: '2999-01-01T00:00:00.000Z' }); });
  await new Promise(r => setTimeout(r, 30));
  const b = await openEntity({ dir: copies[1] });
  await settlePending(b, { until: '2999-01-01T00:00:00.000Z' });
  const [x, y] = copies.map(c => fs.readFileSync(store.P(c).events));
  assert.ok(x.length > 0);
  assert.ok(x.equals(y), 'record files differ');
  assert.equal(fs.readFileSync(store.P(copies[0]).params, 'utf8'), fs.readFileSync(store.P(copies[1]).params, 'utf8'));
});

test('2 · altering any record breaks verification at that record and every one after', async () => {
  const w = await world({ people: 5 });
  const n = w.records.length;
  for (let k = 0; k < n; k++) {
    const altered = structuredClone(w.records);
    altered[k].at = '2000-01-01T00:00:00.000Z';
    const v = verifyChain(altered);
    assert.equal(v.ok, false);
    const bad = v.problems.map(p => p.seq);
    assert.deepEqual(bad, Array.from({ length: n - k }, (_, i) => k + 1 + i), `altering ${k + 1}`);
  }
});

test('3 · an act altered after signing is refused; the original is accepted', async () => {
  const w = await world();
  const act = await w.sign('title.set', 'p-0002', { title: 'Honest' });
  const altered = { ...act, title: 'Forged' };
  const r1 = await settle(w.registry, w.state, [altered]);
  assert.equal(r1.applied.length, 0);
  assert.match(r1.refused[0].reason, /signature invalid/);
  const r2 = await settle(w.registry, w.state, [act]);
  assert.equal(r2.applied.length, 1);
});

test('4 · a signature in the wrong namespace is refused', async () => {
  const w = await world();
  const body = draft('title.set', { entity: w.entity, by: 'p-0002', at: w.at(), title: 'Cross-purpose' });
  const { message } = signedMaterial(w.registry, body);
  const sig = await keys.sign(message, w.keys['p-0002'].privateKey, NS.ballot);
  const r = await settle(w.registry, w.state, [{ ...body, signature: sig }]);
  assert.match(r.refused[0].reason, /wrong namespace: signed for "entity\.ballot", required "entity\.act"/);
  // and the attestation namespace cannot stand in for a checkpoint
  const v = await keys.verify('x', await keys.sign('x', w.keys['p-0001'].privateKey, NS.attestation), [w.line('p-0001')], NS.checkpoint);
  assert.equal(v.ok, false);
});

test('5 · two histories concatenated with a duplicate repair to a verifying chain with no content altered', async () => {
  const w = await world({ people: 2 });
  const common = [...w.records];
  const branchState = structuredClone(w.state);
  const a = await w.sign('title.set', 'p-0001', { title: 'From A' });
  const b = await w.sign('title.set', 'p-0002', { title: 'From B' });
  const ra = await settle(w.registry, w.state, [a]);
  const rb = await settle(w.registry, branchState, [b]);
  const merged = [...common, ...ra.records, ...common.slice(-1), ...rb.records];
  const text = serialiseAll(merged).replace(/\n(?=[^\n]*From B)/, '\n=======\n');
  const { records, damage } = parseLines(text);
  assert.equal(damage[0].kind, 'conflict');
  const out = repair(records);
  assert.equal(out.duplicates, 1);
  assert.equal(verifyChain(out.records).ok, true);
  assert.equal((await verifyRecords(w.registry, out.records)).ok, true);
  const content = (r) => canonical(omit(r, 'seq', 'prev', 'hash'));
  const before = new Set(records.map(content));
  assert.deepEqual(new Set(out.records.map(content)), before, 'every distinct record kept, none altered');
});

test('6 · apply called twice with the same input produces identical output, and does not mutate state', async () => {
  const w = await world();
  const { id } = await propose(w, 'p-0001', { title: 'Period', rule: 'organic', changes: { 'deliberation.period': 9 } });
  await vote(w, id, ['p-0001', 'p-0002']);
  const act = await w.sign('ballot.cast', 'p-0003', { proposal: id, choice: 'for' });
  const def = w.registry.get('ballot.cast');
  const ctx = { params: new (await import('../kernel/parameters.js')).Parameters(w.state.doc), registry: w.registry };
  const snapshot = canonical({ ...w.state, acts: [...w.state.acts] });
  const one = def.apply(w.state, act, ctx), two = def.apply(w.state, act, ctx);
  assert.ok(one.length > 0, 'this ballot closes the proposal');
  assert.equal(canonical(one), canonical(two));
  assert.equal(canonical({ ...w.state, acts: [...w.state.acts] }), snapshot, 'apply mutated state');
  assert.equal(def.check(w.state, act, ctx), def.check(w.state, act, ctx));
});

// ───────────────────────────────────────────── Corroboration

test('7 · a chain that verifies perfectly but omits a record is caught by an attestation', async () => {
  const w = await world({ people: 3 });
  for (const id of w.ids) await w.settle(await w.sign('title.set', id, { title: `Name ${id}` }));
  const att = await attest(w.records, { entity: w.entity, by: 'p-0002', at: w.at() }, w.keys['p-0002'].privateKey);
  // Remove a record from the middle and re-chain the remainder perfectly.
  const victim = w.records.findIndex(r => r.kind === 'title.set');
  const kept = w.records.filter((_, i) => i !== victim);
  let prev = '0'.repeat(64);
  const forged = kept.map((r, i) => { const n = { ...omit(r, 'hash'), seq: i + 1, prev }; n.hash = recordHash(n); prev = n.hash; return n; });
  assert.equal(verifyChain(forged).ok, true, 'the forgery verifies on its own');
  assert.equal((await verifyRecords(w.registry, forged)).ok, true, 'it even replays');
  const c = await compare(forged, w.state, [att]);
  assert.equal(c.diverged.length, 1);
  assert.equal(c.ahead.length, 0, 'not mistaken for lagging');
});

test('8 · being behind is distinguished from being rewritten', async () => {
  const w = await world({ people: 3 });
  for (const id of w.ids) await w.settle(await w.sign('title.set', id, { title: `T ${id}` }));
  const att = await attest(w.records, { entity: w.entity, by: 'p-0001', at: w.at() }, w.keys['p-0001'].privateKey);
  const behind = w.records.slice(0, 4);
  const cb = await compare(behind, w.state, [att]);
  assert.equal(cb.ahead.length, 1); assert.equal(cb.diverged.length, 0);
  const rewritten = structuredClone(behind);
  const sneaky = await w.sign('title.set', 'p-0002', { title: 'Other', at: rewritten[3].at });
  const alt = await settle(w.registry, (await import('../kernel/state.js')).foldRecords(w.registry, rewritten.slice(0, 3)), [sneaky]);
  const cr = await compare([...rewritten.slice(0, 3), ...alt.records], w.state, [att]);
  assert.equal(cr.diverged.length, 1); assert.equal(cr.ahead.length, 0);
  const ahead = await compare(w.records, w.state, [att]);
  assert.equal(ahead.agreeing.length, 1);
});

test('9 · a checkpoint below the required signature count is reported as not binding', async () => {
  const w = await world({ people: 3 });
  const cp = await cosign(makeCheckpoint(w.records, w.entity, null), 'p-0001', w.keys['p-0001'].privateKey);
  const s1 = await checkpointStatus(cp, w.state, 2, w.records);
  assert.equal(s1.binding, false);
  assert.match(s1.why, /1 of 2/);
  // A record lands between signatures; the co-signer adds to the existing checkpoint.
  await w.settle(await w.sign('title.set', 'p-0003', { title: 'Late arrival' }));
  const cp2 = await cosign(cp, 'p-0002', w.keys['p-0002'].privateKey);
  const s2 = await checkpointStatus(cp2, w.state, 2, w.records);
  assert.equal(s2.binding, true);
  assert.equal(s2.consistent, true);
  await assert.rejects(() => cosign(cp2, 'p-0002', w.keys['p-0002'].privateKey), /already signed/);
});

// ───────────────────────────────────────────── Rules

test('10 · a decision of insufficient class is refused, with the rule named', async () => {
  const w = await world();
  const r = await propose(w, 'p-0001', { title: 'Rename', rule: 'ordinary', changes: { 'entity.name': 'Elsewhere' } });
  assert.match(r.refused[0].reason, /refused under amendment\.rules\.constitutional: changing entity\.name requires "constitutional".*cites "ordinary"/);
});

test('11 · changing a trivial and an entrenched parameter together requires the entrenched rule', async () => {
  const w = await world();
  const changes = { 'titles.max_length': 40, 'amendment.rules.ordinary.quorum': 0.3 };
  const r1 = await propose(w, 'p-0001', { title: 'Both', rule: 'constitutional', changes });
  assert.match(r1.refused[0].reason, /requires "entrenched"/);
  const r2 = await propose(w, 'p-0001', { title: 'Both', rule: 'entrenched', changes });
  assert.equal(r2.refused.length, 0);
});

test('12 · an unchangeable parameter is refused at proposal, not at enactment', async () => {
  const w = await world();
  for (const [k, v] of [['exit.unconditional', false], ['membership.transferable', true], ['record.immutable', false], ['entity.founded', '2020-01-01T00:00:00.000Z'], ['amendment.meta', 'ordinary']]) {
    const r = await propose(w, 'p-0001', { title: `Change ${k}`, rule: 'entrenched', changes: { [k]: v } });
    assert.match(r.refused[0].reason, /^refused at proposal: .* cannot be changed under any rule/, k);
  }
  assert.equal(Object.keys(w.state.proposals).length, 0, 'nothing was laid');
  // Nor can a founding document assert otherwise.
  const bad = structuredClone(w.doc); bad.parameters['exit.unconditional'].value = false;
  const w2 = await world({ people: 1 });
  const r = await settle(w2.registry, emptyState(), [await w2.sign('entity.found', 'p-0001', { entity: 'e-other-000001', key: w2.line('p-0001'), document: bad })]);
  assert.match(r.refused[0].reason, /exit\.unconditional is fixed at true/);
});

test('13 · a fabricated tally is refused because ballots are counted, not believed', async () => {
  const w = await world({ people: 3 });
  const content = 'export const x = 1;\n';
  const digest = changeDigest([{ path: 'kernel/extra.js', content }]);
  const { id } = await propose(w, 'p-0001', { title: 'Add a file', rule: 'organic', paths: ['kernel/extra.js'], digest });
  // (a) A close act claiming a result the ballots do not support.
  w.jump(8);
  const lie = await w.sign('proposal.close', 'p-0002', { proposal: id, result: 'carried' });
  const r = await settle(w.registry, w.state, [lie]);
  assert.match(r.refused[0].reason, /claimed result does not match the count/);
  // (b) The gate, handed a change and a result file saying it carried.
  const fabricated = { proposal: id, carried: true, for: 3, against: 0 };
  assert.ok(fabricated.carried);
  const g1 = gate(['kernel/extra.js'], { decision: id, state: w.state, count, digest });
  assert.equal(g1.ok, false);
  assert.match(g1.why, /counted ballots show decision .* did not carry/);
  // The same change with real signed ballots passes. (A fresh world: the first proposal is past its deadline.)
  const w2 = await world({ people: 3 });
  const p2 = await propose(w2, 'p-0001', { title: 'Add a file', rule: 'organic', paths: ['kernel/extra.js'], digest });
  await vote(w2, p2.id, ['p-0001', 'p-0002', 'p-0003']);
  const g2 = gate(['kernel/extra.js'], { decision: p2.id, state: w2.state, count, digest });
  assert.equal(g2.ok, true, g2.why);
  assert.deepEqual(g2.approvers.sort(), ['p-0001', 'p-0002', 'p-0003']);
  const g3 = gate(['kernel/extra.js'], { decision: p2.id, state: w2.state, count, digest: changeDigest([{ path: 'kernel/extra.js', content: 'evil' }]) });
  assert.match(g3.why, /digest mismatch/);
});

// ───────────────────────────────────────────── Participation

test('14 · a first act, self-signed, is accepted; signed by another key, refused', async () => {
  const w = await world({ people: 1 });
  const newcomer = await keys.generate();
  const other = await keys.generate();
  const line = keys.publicKeyLine(newcomer.publicKey);
  const forged = await w.sign('participant.apply', 'p-0009', { key: line }, other.privateKey);
  const r1 = await settle(w.registry, w.state, [forged]);
  assert.match(r1.refused[0].reason, /signature invalid/);
  const honest = await w.sign('participant.apply', 'p-0009', { key: line }, newcomer.privateKey);
  const r2 = await settle(w.registry, w.state, [honest]);
  assert.equal(r2.applied.length, 1);
  assert.equal(r2.state.participants['p-0009'].status, 'active');
});

test('15 · the interface and the engine count identically', async () => {
  const E = await import('../interface/js/engine.js');
  const w = await world({ people: 5 });
  const p1 = await propose(w, 'p-0001', { title: 'Open one', rule: 'ordinary', changes: { 'titles.max_length': 30 } });
  const p2 = await propose(w, 'p-0002', { title: 'Closes early', rule: 'organic', changes: { 'deliberation.period': 12 } });
  await vote(w, p1.id, ['p-0001', 'p-0002'], 'for'); await vote(w, p1.id, ['p-0003'], 'against'); await vote(w, p1.id, ['p-0002'], 'abstain');
  await vote(w, p2.id, ['p-0001', 'p-0002', 'p-0003', 'p-0004']);
  await vote(w, p2.id, ['p-0005'], 'against');
  await w.settle(await w.sign('participant.apply', 'p-late', { key: keys.publicKeyLine((await w.person('p-late')).publicKey) }, w.keys['p-late'].privateKey));
  await vote(w, p1.id, ['p-late']);
  // The same engine the page runs, with modules found where this copy keeps them.
  const registry = createRegistry(await loadModules(['deliberation', 'titles', 'vocabulary', 'page']));
  const v = await E.verifyText(registry, serialiseAll(w.records));
  assert.equal(v.ok, true);
  for (const id of [p1.id, p2.id]) assert.deepEqual(E.tally(v.state, id), count(w.state, id));
  const t = E.tally(v.state, p1.id);
  assert.ok(t.rejected.some(r => r.by === 'p-late' && /not on the roll/.test(r.why)));
  assert.ok(E.tally(v.state, p2.id).rejected.some(r => r.by === 'p-0005' && r.why === 'cast after close'));
});

// ───────────────────────────────────────────── Transport

test('16 · a record carried by file with no network verifies on arrival', async () => {
  const w = await world({ people: 3 });
  await w.settle(await w.sign('title.set', 'p-0002', { title: 'Carried' }));
  const f = path.join(tmp(), 'carried.bundle.json');
  fs.writeFileSync(f, JSON.stringify(makeBundle({ entity: { id: w.entity, name: 'x' }, records: w.records })));
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  const plan = await planAbsorb(w.registry, { entity: null, records: [], state: emptyState() }, b);
  assert.equal(plan.action, 'adopt'); assert.equal(plan.records.length, w.records.length);
  b.records[2].payload.act.key = w.line('p-0002');
  const bad = await planAbsorb(w.registry, { entity: null, records: [], state: emptyState() }, b);
  assert.equal(bad.action, 'refused'); assert.match(bad.why, /does not verify/);
});

test('17 · an unreachable destination does not prevent the others receiving', async () => {
  const dir = await entityOnDisk({ people: 2 });
  const { openEntity } = await import('../cli/context.js');
  const { push } = await import('../cli/net.js');
  const drop = tmp();
  const e = await openEntity({ dir });
  const r = await push(e, [
    { name: 'gone', class: 'dir', path: path.join(drop, 'does-not-exist') },
    { name: 'stick', class: 'dir', path: drop },
    { name: 'dead-node', class: 'http', url: 'http://127.0.0.1:9', timeout: 1500 },
  ]);
  assert.deepEqual(r.reached, ['stick']);
  assert.equal(r.refused.length, 2);
  assert.equal(fs.readdirSync(drop).filter(f => f.endsWith('.bundle.json')).length, 1);
});

test('18 · the whole history is obtainable from any single holder', async () => {
  const dir = await entityOnDisk({ people: 3 });
  const { openEntity } = await import('../cli/context.js');
  const { bundle, clone } = await import('../cli/commands/transport.js');
  const f = path.join(tmp(), 'b.json');
  await quietly(() => bundle({ pos: [], opt: { dir, out: f } }));
  const to = path.join(tmp(), 'copy');
  await quietly(() => clone({ pos: [f, to], opt: {} }));
  assert.ok(fs.readFileSync(store.P(to).events).equals(fs.readFileSync(store.P(dir).events)));
  const e = await openEntity({ dir: to });
  assert.equal((await verifyRecords(e.registry, e.records)).ok, true);
  assert.equal(fs.readFileSync(store.P(to).params, 'utf8'), fs.readFileSync(store.P(dir).params, 'utf8'), 'parameters.yml is rebuilt from the record');
});

test('19 · adding a transport class requires configuration only', async () => {
  const dir = await entityOnDisk({ people: 2 });
  const received = path.join(tmp(), 'mirror.json');
  fs.writeFileSync(path.join(dir, 'mirror-class.js'),
    `import fs from 'node:fs';\nexport default (d) => ({ name: 'mirror', async push(b) { fs.writeFileSync(d.target, JSON.stringify(b)); }, async pull() { return null; } });\n`);
  const transportSrc = fs.readFileSync(path.join(ROOT, 'cli/net.js'), 'utf8');
  fs.writeFileSync(store.P(dir).node, JSON.stringify({ classes: { mirror: './mirror-class.js' }, destinations: [{ name: 'm', class: 'mirror', target: received }] }));
  const { sync } = await import('../cli/commands/transport.js');
  await quietly(() => sync({ pos: [], opt: { dir } }));
  assert.ok(fs.existsSync(received));
  assert.equal(JSON.parse(fs.readFileSync(received, 'utf8')).format, 'entity-bundle/1');
  assert.equal(fs.readFileSync(path.join(ROOT, 'cli/net.js'), 'utf8'), transportSrc, 'no transport code changed');
});

// ───────────────────────────────────────────── Structure

test('20 · removing an unused module changes no other behaviour', async () => {
  const w = await world({ set: { 'entity.modules': ['deliberation'] } });
  const { id } = await propose(w, 'p-0001', { title: 'Same', rule: 'organic', changes: { 'deliberation.period': 5 } });
  await vote(w, id, ['p-0001', 'p-0002', 'p-0003']);
  const acts = w.records.filter(r => r.payload.act).map(r => r.payload.act);
  const resettle = async (installed) => {
    const registry = createRegistry(await loadModules(installed));
    let st = emptyState(); const out = [];
    for (const a of acts) { const r = await settle(registry, st, [a]); st = r.state; out.push(...r.records); }
    return serialiseAll(out);
  };
  const withAll = await resettle(['deliberation', 'titles', 'vocabulary']);
  assert.equal(withAll, serialiseAll(w.records));
  assert.equal(await resettle(['deliberation']), withAll, 'removing titles and vocabulary changed the record');
  // And no module imports another module.
  const { LIB } = await import('./helpers.js');
  const dirs = [path.join(ROOT, 'modules'), LIB].flatMap(base => fs.readdirSync(base).filter(n => fs.statSync(path.join(base, n)).isDirectory()).map(n => [n, path.join(base, n)]));
  for (const [m, mdir] of dirs) {
    for (const f of fs.readdirSync(mdir).filter(f => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(mdir, f), 'utf8');
      for (const [, spec] of src.matchAll(/from\s+'([^']+)'/g)) {
        // A module may use the kernel (and its tests the test helpers); never another module.
        const allowed = /^\.\.\/\.\.\/kernel\//.test(spec) || (f === 'tests.js' && /^\.\.\/\.\.\/test\//.test(spec)) || spec.startsWith('./') || spec.startsWith('node:');
        assert.ok(allowed, `${m}/${f} imports ${spec}`);
      }
    }
  }
});

async function builtSite() {
  const dir = await entityOnDisk({ people: 2 });
  const { build } = await import('../cli/commands/site.js');
  const out = path.join(dir, 'site');
  await quietly(() => build({ pos: [], opt: { dir, out } }));
  const { walk } = await import('../cli/commands/dist.js');
  return { dir, out, files: walk(out, '') };
}

test('21 · every page uses relative links only', async () => {
  const { out, files } = await builtSite();
  const absolute = /(?:href|src|action)\s*=\s*["']\/(?!\/)|url\(\s*["']?\/(?!\/)|fetch\(\s*["'`]\/(?!\/)|import\s*\(?\s*["']\/(?!\/)|from\s+["']\/(?!\/)/;
  for (const f of files.filter(f => /\.(html|js|css)$/.test(f))) {
    const src = fs.readFileSync(path.join(out, f), 'utf8');
    assert.ok(!absolute.test(src), `${f} assumes the domain root`);
  }
});

test('22 · no page contains generated code', async () => {
  const { dir, out, files } = await builtSite();
  for (const f of files.filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const attrs = m[1], body = m[2].trim();
      if (/type="application\/json"/.test(attrs)) { JSON.parse(body); continue; }
      assert.match(attrs, /\bsrc=/, `${f} has an inline script`);
      assert.equal(body, '', `${f} has script content`);
    }
    assert.ok(!/\son[a-z]+\s*=/.test(html), `${f} has an inline event handler`);
  }
  // Every script shipped is a byte-for-byte copy of a source file.
  const map = { 'interface/js/': 'interface/js/', 'kernel/': 'kernel/', 'modules/': 'modules/' };
  for (const f of files.filter(f => f.endsWith('.js'))) {
    const pre = Object.keys(map).find(p => f.startsWith(p));
    assert.ok(fs.readFileSync(path.join(out, f)).equals(fs.readFileSync(path.join(dir, map[pre] + f.slice(pre.length)))), `${f} differs from its source`);
  }
});

test('23 · the distribution archive contains no state directory that could overwrite a record', async () => {
  const dir = await entityOnDisk({ people: 2 });
  for (const d of ['pending', 'settled', 'refused', 'site']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.bundle.json'), '{}');
  const { dist } = await import('../cli/commands/dist.js');
  const { listTarGz } = await import('../cli/tar.js');
  const f = path.join(tmp(), 'dist.tar.gz');
  await quietly(() => dist({ pos: [], opt: { dir, out: f } }));
  const names = listTarGz(fs.readFileSync(f)).map(n => n.split('/').slice(1).join('/'));
  assert.ok(names.includes('kernel/settle.js'));
  for (const n of names) {
    assert.ok(!/^(record|participants|pending|settled|refused|site)(\/|$)|^node\.json$|^parameters\.yml$|\.bundle\.json$/.test(n), `archive contains ${n}`);
  }
});
