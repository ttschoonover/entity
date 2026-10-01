// The core by decision, and checkpoints arriving from pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../kernel/store.js';
import { makeCheckpoint, cosign, mergeCheckpoint, keys } from '../kernel/index.js';
import { entityOnDisk, quietly, tmp, ROOT } from './helpers.js';

test('upgrading the core: check, propose, vote, apply exactly what was approved', async () => {
  const dir = await entityOnDisk();
  const src = path.join(tmp(), 'next');
  fs.cpSync(ROOT, src, { recursive: true, filter: (f) => !/\/(\.git|node_modules|\.staged)(\/|$)/.test(f) });
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ ...pkg, version: '9.9.9' }, null, 2) + '\n');
  fs.appendFileSync(path.join(src, 'docs', 'MANUAL.md'), '\nA new paragraph.\n');
  const { upgrade } = await import('../cli/commands/upgrade.js');
  const { settle } = await import('../cli/commands/act.js');
  const said = await quietly(() => upgrade({ pos: ['propose', `dir:${src}`], opt: { dir, as: 'p-0001' } }));
  await quietly(() => settle({ pos: [], opt: { dir } }));
  let e = await store.open(dir);
  const p = Object.values(e.state.proposals).find(x => x.digest);
  assert.ok(p, 'a proposal approving the files was laid');
  assert.ok(p.paths.includes('package.json') && p.paths.includes('docs/MANUAL.md'));
  assert.ok(!p.paths.some(x => x.startsWith('law/') || x.startsWith('record/')), 'the entity\'s law and record are its own');
  await assert.rejects(quietly(() => upgrade({ pos: ['apply'], opt: { dir } })), /requires a decision/);
  const { act } = await import('../cli/commands/act.js');
  for (const id of ['p-0001', 'p-0002', 'p-0003']) await quietly(() => act({ pos: ['ballot.cast'], opt: { dir, as: id, proposal: p.id, choice: 'for' } }));
  await quietly(() => settle({ pos: [], opt: { dir } }));
  // Someone edits the staged files after the vote: the install is refused.
  fs.appendFileSync(path.join(dir, '.staged', 'core', 'docs', 'MANUAL.md'), 'sneaky\n');
  await assert.rejects(quietly(() => upgrade({ pos: ['apply'], opt: { dir } })), /changed since they were checked/);
  await quietly(() => upgrade({ pos: ['check', `dir:${src}`], opt: { dir } }));
  await quietly(() => upgrade({ pos: ['apply'], opt: { dir } }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '9.9.9');
  e = await store.open(dir);
  const { verifyRecords } = await import('../kernel/index.js');
  assert.equal((await verifyRecords(e.registry, e.records)).ok, true);
  void said;
});

test('checkpoints from a page are merged: only matching positions, only signatures that verify', async () => {
  const dir = await entityOnDisk();
  const e = await store.open(dir);
  const { loadKey } = await import('../cli/context.js');
  const k = (id) => loadKey(e.state.entity.id, id);
  const cp = makeCheckpoint(e.records, e.state.entity.id, null);
  const one = await cosign(cp, 'p-0001', k('p-0001'));
  let r = await mergeCheckpoint([], one, e.state, e.records);
  assert.deepEqual(r.added, ['p-0001']);
  const held = [r.checkpoint];
  const forged = await cosign(cp, 'p-0002', k('p-0003'));
  r = await mergeCheckpoint(held, forged, e.state, e.records);
  assert.deepEqual(r.checkpoint.signatures.map(s => s.by), ['p-0001'], 'a forged signature is dropped');
  r = await mergeCheckpoint(held, await cosign(cp, 'p-0002', k('p-0002')), e.state, e.records);
  assert.deepEqual(r.checkpoint.signatures.map(s => s.by), ['p-0001', 'p-0002']);
  const wrong = await cosign({ ...cp, root: '0'.repeat(64) }, 'p-0001', k('p-0001'));
  assert.match((await mergeCheckpoint(held, wrong, e.state, e.records)).why, /contradicts this copy's record/);
  const skip = await cosign({ ...cp, number: 3 }, 'p-0001', k('p-0001'));
  assert.match((await mergeCheckpoint(held, skip, e.state, e.records)).why, /next checkpoint is number 2/);
  void keys;
});
