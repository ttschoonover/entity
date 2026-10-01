// Tests for the parts the acceptance suite relies on without naming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonical, hash, merkleRoot, keys, settle, Parameters, rewriteValues, loadDocument, yaml } from '../kernel/index.js';
const { keyId } = keys;
import { world, propose, tmp, ROOT, entityOnDisk } from './helpers.js';

const vectors = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/vectors.json'), 'utf8'));

test('canonical serialisation matches the published vectors', () => {
  for (const v of vectors.canonical) assert.equal(canonical(v.input), v.canonical);
  for (const v of vectors.canonical) assert.equal(hash(v.canonical), v.sha256);
});

test('reordering an object\'s keys changes nothing; unrepresentable values are refused', () => {
  assert.equal(canonical({ a: 1, b: { d: 2, c: 3 } }), canonical({ b: { c: 3, d: 2 }, a: 1 }));
  assert.throws(() => canonical(NaN), /non-finite/);
  assert.throws(() => canonical([undefined]), /undefined at array index 0/);
  assert.throws(() => canonical(10n), /cannot serialise/);
});

test('SHA-256 and Merkle vectors', () => {
  for (const v of vectors.sha256) assert.equal(hash(v.input), v.hex);
  assert.equal(hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const m of vectors.merkle) assert.equal(merkleRoot(m.leaves), m.root);
});

test('signatures interoperate with ssh-keygen in both directions', { skip: !hasSshKeygen() && 'ssh-keygen not installed' }, async () => {
  const d = tmp();
  const { privateKey, publicKey } = await keys.generate();
  fs.writeFileSync(path.join(d, 'id'), keys.exportPrivateKey(privateKey, 'me'), { mode: 0o600 });
  fs.writeFileSync(path.join(d, 'allowed'), `me namespaces="entity.act" ${keys.publicKeyLine(publicKey)}\n`);
  fs.writeFileSync(path.join(d, 'm'), 'the message');
  fs.writeFileSync(path.join(d, 'm.sig'), keys.armor(await keys.sign('the message', privateKey, 'entity.act')));
  const out = execFileSync('ssh-keygen', ['-Y', 'verify', '-f', 'allowed', '-I', 'me', '-n', 'entity.act', '-s', 'm.sig'], { cwd: d, input: 'the message' }).toString();
  assert.match(out, /Good "entity.act" signature/);
  execFileSync('ssh-keygen', ['-Y', 'sign', '-f', 'id', '-n', 'entity.act', 'm'], { cwd: d, stdio: 'ignore' });
  const v = await keys.verify('the message', fs.readFileSync(path.join(d, 'm.sig'), 'utf8'), [keys.publicKeyLine(publicKey)], 'entity.act');
  assert.equal(v.ok, true);
});
function hasSshKeygen() { try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); return true; } catch (e) { return e.status !== undefined && e.code !== 'ENOENT'; } }

test('the yaml subset parses the files it must and rewrites values without disturbing the rest', () => {
  const text = fs.readFileSync(path.join(ROOT, 'kernel/parameters.base.yml'), 'utf8');
  const doc = loadDocument(text);
  const p = new Parameters(doc);
  assert.equal(p.value('record.checkpoint_cosigners'), 2);
  assert.match(p.def('record.checkpoint_cosigners').describe, /^How many must sign a checkpoint\. One signing key/);
  const re = rewriteValues(text, { 'record.checkpoint_cosigners': 3, 'amendment.rules.ordinary.quorum': 0.25, 'entity.modules': ['deliberation', 'titles'] });
  const p2 = new Parameters(loadDocument(re));
  assert.equal(p2.value('record.checkpoint_cosigners'), 3);
  assert.equal(p2.value('amendment.rules.ordinary.quorum'), 0.25);
  assert.deepEqual(p2.value('entity.modules'), ['deliberation', 'titles']);
  assert.equal(re.split('\n').length, text.split('\n').length, 'only value lines changed');
  assert.throws(() => yaml.parse('a:\n   b: 1\n  c: 2'), /unexpected indentation|expected/);
});

test('acts are bound to their entity: a signature for one cannot be replayed in another', async () => {
  const a = await world({ entity: 'e-first-00001' });
  const act = await a.sign('title.set', 'p-0002', { title: 'Mine' });
  const r = await settle(a.registry, a.state, [{ ...act, entity: 'e-other-00001' }]);
  assert.match(r.refused[0].reason, /signed for entity "e-other-00001"|signature invalid/);
});

test('an act dated before the head of the record is refused with its reason', async () => {
  const w = await world();
  const old = await w.sign('title.set', 'p-0002', { title: 'Late', at: '2026-01-01T00:00:00.000Z' });
  const r = await settle(w.registry, w.state, [old]);
  assert.match(r.refused[0].reason, /before the head of the record/);
});

test('the founding window closes when a second participant exists', async () => {
  const solo = await world({ people: 1 });
  const ok = await settle(solo.registry, solo.state, [await solo.sign('entity.preset', 'p-0001', { document: solo.doc, source: solo.text })]);
  assert.equal(ok.applied.length, 1);
  const w = await world({ people: 2 });
  const r = await settle(w.registry, w.state, [await w.sign('entity.preset', 'p-0001', { document: w.doc, source: w.text })]);
  assert.match(r.refused[0].reason, /founding window has closed/);
});

test('a constitutional change needs two readings, the prescribed interval apart', async () => {
  const w = await world({ people: 3 });
  const changes = { 'entity.name': 'The Commons' };
  const first = await propose(w, 'p-0001', { title: 'Rename', rule: 'constitutional', changes });
  for (const v of w.ids) await w.settle(await w.sign('ballot.cast', v, { proposal: first.id, choice: 'for' }));
  const p1 = w.state.proposals[first.id];
  assert.equal(p1.closed.carried, true); assert.equal(p1.enacted, false); assert.match(p1.awaiting, /reading 2/);
  assert.equal(new Parameters(w.state.doc).value('entity.name'), 'The Assembly');
  const early = await propose(w, 'p-0001', { title: 'Rename', rule: 'constitutional', changes, reading_of: first.id });
  assert.match(early.refused[0].reason, /may not be laid before/);
  w.jump(31);
  const altered = await propose(w, 'p-0001', { title: 'Rename', rule: 'constitutional', changes: { 'entity.name': 'Other' }, reading_of: first.id });
  assert.match(altered.refused[0].reason, /exactly the same effects/);
  const second = await propose(w, 'p-0001', { title: 'Rename', rule: 'constitutional', changes, reading_of: first.id });
  assert.equal(second.refused.length, 0);
  for (const v of w.ids) await w.settle(await w.sign('ballot.cast', v, { proposal: second.id, choice: 'for' }));
  assert.equal(new Parameters(w.state.doc).value('entity.name'), 'The Commons');
  assert.equal(w.state.proposals[first.id].enacted, true);
});

test('admission by decision: an applicant cannot vote until admitted', async () => {
  const w = await world({ preset: 'worker-coop', people: 3 });
  assert.deepEqual(w.ids.slice(1).map(id => w.state.participants[id].status), ['applicant', 'applicant']);
  const { id } = await propose(w, 'p-0001', { title: 'Admit both', rule: 'ordinary', admit: ['p-0002', 'p-0003'] });
  assert.equal(w.state.proposals[id].roll.length, 1, 'applicants are not on the roll');
  await w.settle(await w.sign('ballot.cast', 'p-0001', { proposal: id, choice: 'for' }));
  assert.equal(w.state.participants['p-0002'].status, 'active');
  const lay = await propose(w, 'p-0002', { title: 'Now I may', rule: 'ordinary' });
  assert.equal(lay.refused.length, 0);
});

test('exit is unconditional, and a participant who has left can no longer act', async () => {
  const w = await world();
  const r = await w.settle(await w.sign('participant.leave', 'p-0003'));
  assert.equal(r.applied.length, 1);
  assert.equal(w.state.participants['p-0003'].status, 'left');
  const after = await settle(w.registry, w.state, [await w.sign('title.set', 'p-0003', { title: 'Ghost' })]);
  assert.match(after.refused[0].reason, /has left/);
});

test('a key rotation is signed by the old key; afterwards only the new key works', async () => {
  const w = await world();
  const fresh = await keys.generate();
  await w.settle(await w.sign('participant.key', 'p-0002', { add: keys.publicKeyLine(fresh.publicKey), revoke: w.line('p-0002') }));
  assert.deepEqual(w.state.participants['p-0002'].keys, [keyId(keys.publicKeyLine(fresh.publicKey))]);
  const old = await settle(w.registry, w.state, [await w.sign('title.set', 'p-0002', { title: 'Old key' })]);
  assert.match(old.refused[0].reason, /signature invalid/);
  const nu = await settle(w.registry, w.state, [await w.sign('title.set', 'p-0002', { title: 'New key' }, fresh.privateKey)]);
  assert.equal(nu.applied.length, 1);
});

test('a kind whose module is not enabled is refused, naming the module', async () => {
  const w = await world({ set: { 'entity.modules': ['deliberation'] } });
  const r = await settle(w.registry, w.state, [await w.sign('title.set', 'p-0002', { title: 'x' })]);
  assert.match(r.refused[0].reason, /module "titles" is not enabled/);
});

test('parameters.yml is rebuilt from the record after enactment', async () => {
  const w = await world();
  const { id } = await propose(w, 'p-0001', { title: 'Nine days', rule: 'organic', changes: { 'deliberation.period': 9 } });
  for (const v of w.ids) await w.settle(await w.sign('ballot.cast', v, { proposal: id, choice: 'for' }));
  const { parametersText } = await import('../kernel/store.js');
  const text = parametersText(w.state);
  assert.equal(new Parameters(loadDocument(text)).value('deliberation.period'), 9);
  assert.match(text, /# parameters\.yml — the values this entity has chosen/, 'comments survive');
});

test('a key\'s Radicle Node ID matches the one rad derives for it', () => {
  // Generated by `rad auth`; rad reported this Node ID for this key.
  const line = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILkzlkTI6sNlVWM6axRYzMcyLBeDuXqFPK0foDb19IBE radicle';
  assert.equal(keys.nodeId(line), 'z6MkrvD6NJxhMTb5r1zbjKvPCJWyd8WhfDVbv7R5AQdzLadq');
});

test('every preset composes into a valid document and founds an entity', async () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'presets')).filter(f => f.endsWith('.yml'))) {
    const w = await world({ preset: f.replace(/\.yml$/, ''), people: 1 });
    assert.equal(w.records.length, 1, f);
  }
});

test('rule strength survives recording: a constitutional change cannot be made under a weaker rule after reading from disk', async () => {
  // Regression: rules were once ranked by key order, which canonical serialisation sorts away.
  const { canonical: c } = await import('../kernel/canonical.js');
  const w = await world({ people: 3 });
  const fromDisk = JSON.parse(c(w.doc));             // keys now alphabetical, as in any recorded document
  assert.deepEqual(Object.keys(fromDisk.amendment.rules), ['constitutional', 'entrenched', 'immutable', 'ordinary', 'organic']);
  const p = new Parameters(fromDisk);
  assert.deepEqual(p.ruleOrder(), ['ordinary', 'organic', 'constitutional', 'entrenched']);
  const legacy = structuredClone(fromDisk); delete legacy.amendment.order;   // founded before `order` existed
  assert.deepEqual(new Parameters(legacy).ruleOrder(), ['ordinary', 'organic', 'constitutional', 'entrenched']);
  // And end to end, on disk, through the command line:
  const dir = await entityOnDisk({ people: 3 });
  const { openEntity, settlePending } = await import('../cli/context.js');
  const e = await openEntity({ dir });
  const key = keys.importPrivateKey(fs.readFileSync(path.join(process.env.ENTITY_KEYS, e.state.entity.id, 'p-0001'), 'utf8'));
  const { signAct, draft } = await import('../kernel/index.js');
  const act = await signAct(e.registry, draft('proposal.lay', { entity: e.state.entity.id, by: 'p-0001', at: new Date(Date.parse(e.state.head.at) + 1000).toISOString(),
    title: 'Rename cheaply', rule: 'ordinary', changes: { 'entity.name': 'Captured' } }), key);
  const { writePending } = await import('../kernel/store.js');
  writePending(dir, act);
  const r = await settlePending(e, { until: '2999-01-01T00:00:00.000Z' });
  assert.match(r.refused[0].reason, /requires "constitutional".*cites "ordinary"/);
});

test('checkpoints: a signature under someone else\'s name never counts, and never blocks their real one', async () => {
  const { entityOnDisk, quietly } = await import('./helpers.js');
  const store = await import('../kernel/store.js');
  const { checkpoint } = await import('../cli/commands/corroborate.js');
  const { keyDir } = await import('../cli/context.js');
  const path = await import('node:path');
  const dir = await entityOnDisk();
  const id = store.read(dir).records[0].payload.act.entity;
  const ben = path.join(keyDir(id), 'p-0002');
  await quietly(() => checkpoint({ pos: ['make'], opt: { dir, as: 'p-0002' } }));
  await assert.rejects(quietly(() => checkpoint({ pos: ['sign'], opt: { dir, as: 'p-0003', key: ben } })), /not one of p-0003's registered keys/);
  // A forged signature that reached the file some other way (an older copy, a hand edit).
  const { cosign, checkpointStatus } = await import('../kernel/index.js');
  const { loadKey } = await import('../cli/context.js');
  const [cp] = store.readCheckpoints(dir);
  store.writeCheckpoints(dir, [await cosign(cp, 'p-0003', loadKey(id, 'p-0002'))]);
  const e = await store.open(dir);
  let s = await checkpointStatus(store.readCheckpoints(dir)[0], e.state, 2, e.records);
  assert.deepEqual(s.valid, ['p-0002']); assert.equal(s.invalid[0].by, 'p-0003'); assert.equal(s.binding, false);
  await quietly(() => checkpoint({ pos: ['sign'], opt: { dir, as: 'p-0003' } }));
  s = await checkpointStatus(store.readCheckpoints(dir)[0], e.state, 2, e.records);
  assert.deepEqual(s.valid, ['p-0002', 'p-0003']); assert.equal(s.binding, true);
});

test('a signature that does not count is reported, not held against the copy; tidy removes it', async () => {
  const { entityOnDisk, quietly } = await import('./helpers.js');
  const store = await import('../kernel/store.js');
  const { checkpoint } = await import('../cli/commands/corroborate.js');
  const { verify } = await import('../cli/commands/inspect.js');
  const { cosign } = await import('../kernel/index.js');
  const { loadKey } = await import('../cli/context.js');
  const dir = await entityOnDisk();
  const id = store.read(dir).records[0].payload.act.entity;
  await quietly(() => checkpoint({ pos: ['make'], opt: { dir, as: 'p-0001' } }));
  await quietly(() => checkpoint({ pos: ['sign'], opt: { dir, as: 'p-0002' } }));
  const [cp] = store.readCheckpoints(dir);
  store.writeCheckpoints(dir, [await cosign(cp, 'p-0003', loadKey(id, 'p-0001'))]);
  const said = [];
  const log = console.log; console.log = (...a) => said.push(a.join(' '));
  try { await verify({ pos: [], opt: { dir } }); } finally { console.log = log; }
  assert.match(said.join('\n'), /not counted: a signature under p-0003's name/);
  assert.match(said.join('\n'), /^Verified\./m);
  await quietly(() => checkpoint({ pos: ['tidy'], opt: { dir } }));
  assert.deepEqual(store.readCheckpoints(dir)[0].signatures.map(s => s.by), ['p-0001', 'p-0002']);
});

test('an act is recorded once, however its signature is re-encoded', async () => {
  const { worldWith, decide } = await import('./helpers.js');
  const { keys } = await import('../kernel/index.js');
  const w = await worldWith(['value']);
  await decide(w, { title: 'mint', rule: 'organic', effects: [{ kind: 'value.issue', to: 'p-0001', amount: 100 }] });
  const t = await w.sign('value.transfer', 'p-0001', { to: 'p-0002', amount: 40 });
  await w.settle(t);
  for (const signature of [t.signature + '\n', ` ${t.signature}`, keys.armor(t.signature)]) {
    const r = await w.settle({ ...t, signature });
    assert.equal(r.applied.length, 0);
    assert.equal(r.refused[0].reason, 'already recorded');
  }
  assert.deepEqual(w.state.m.value.balances, { 'p-0001': 60, 'p-0002': 40 });
});

test('a checkpoint signature still counts after its signer replaces the key', async () => {
  const { world } = await import('./helpers.js');
  const { makeCheckpoint, cosign, checkpointStatus, keys } = await import('../kernel/index.js');
  const w = await world();
  const cp = makeCheckpoint(w.records, w.state.entity.id, null);
  const signedCp = await cosign(await cosign(cp, 'p-0001', w.keys['p-0001'].privateKey), 'p-0002', w.keys['p-0002'].privateKey);
  assert.equal((await checkpointStatus(signedCp, w.state, 2, w.records)).binding, true);
  const fresh = await keys.generate();
  await w.settle(await w.sign('participant.key', 'p-0002', { add: keys.publicKeyLine(fresh.publicKey), revoke: w.line('p-0002') }));
  assert.equal((await checkpointStatus(signedCp, w.state, 2, w.records)).binding, true, 'signed before the key was replaced');
  const late = makeCheckpoint(w.records, w.state.entity.id, signedCp);
  const stale = await cosign(late, 'p-0002', w.keys['p-0002'].privateKey);
  assert.equal((await checkpointStatus(stale, w.state, 1, w.records)).valid.length, 0, 'the old key cannot sign later checkpoints');
});

test('a browser alarms when final records change, and only notes provisional ones being replaced', async () => {
  const { remember } = await import('../interface/js/engine.js');
  const { world } = await import('./helpers.js');
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const w = await world();
  for (const t of ['a', 'b', 'c']) await w.settle(await w.sign('title.set', 'p-0001', { title: t }));
  const all = w.records.slice();
  assert.ok(all.length >= 5);
  const s = store();
  remember(s, 'e', all.slice(0, 5), '2026-01-01T00:00:00Z', 3);
  const other = [...all.slice(0, 4), { ...all[4], hash: 'x'.repeat(64) }];
  const soft = remember(s, 'e', other, '2026-01-02T00:00:00Z', 3);
  assert.equal(soft.warning, null); assert.equal(soft.notice.kind, 'reorganised');
  const hard = remember(s, 'e', [...all.slice(0, 2), { ...all[2], hash: 'y'.repeat(64) }, ...all.slice(3, 5)], '2026-01-03T00:00:00Z', 3);
  assert.equal(hard.warning.kind, 'rewritten');
  const none = store();
  remember(none, 'e', all.slice(0, 5));
  assert.equal(remember(none, 'e', other).warning.kind, 'rewritten', 'without finality, every record is held to what was seen');
});
