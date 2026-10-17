// entity fork: a new entity naming its parent, checkable against it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keys, parseLines, checkFork, settle, draft, signAct } from '../kernel/index.js';
import * as store from '../kernel/store.js';
import { entityOnDisk, quietly, tmp } from './helpers.js';

async function forked(opts = {}) {
  const dir = await entityOnDisk();
  const { fork } = await import('../cli/commands/fork.js');
  const to = path.join(tmp(), 'fork');
  await quietly(() => fork({ pos: [], opt: { dir, out: to, name: 'The Other Commons', as: 'p-0002', ...opts } }));
  return { dir, to, parent: await store.open(dir), child: await store.open(to) };
}

test('a fork names its parent, starts from its parameters and modules, and verifies against its record', async () => {
  const { parent, child, to } = await forked();
  const p = child.state.entity.parent;
  assert.equal(p.entity, parent.state.entity.id);
  assert.equal(p.count, parent.records.length);
  assert.deepEqual(Object.keys(p.members).sort(), ['p-0001', 'p-0002', 'p-0003']);
  assert.deepEqual(child.state.order, ['p-0002'], 'members are not carried over: only the founder is here');
  assert.deepEqual(Object.keys(child.state.modules).sort(), Object.keys(parent.state.modules).sort());
  const founding = child.records[0].payload.act;
  const c = await checkFork(child.registry, founding, parseLines(fs.readFileSync(path.join(to, 'parent', 'events.jsonl'), 'utf8')).records);
  assert.equal(c.ok, true, c.problems.join('; '));
});

test('a parent\'s member claims their id in the fork only with a key they held there', async () => {
  const { child, dir } = await forked();
  const w = { registry: child.registry, state: child.state };
  const stranger = await keys.generate();
  const act = await signAct(w.registry, draft('participant.apply', { entity: w.state.entity.id, by: 'p-0003', at: new Date().toISOString(), key: keys.publicKeyLine(stranger.publicKey) }), stranger.privateKey);
  const r = await settle(w.registry, w.state, [act]);
  assert.match(r.refused[0].reason, /was a member of .* claimed by applying with a key it held there/);
  const { loadKey } = await import('../cli/context.js');
  const real = loadKey(store.read(dir).records[0].payload.act.entity, 'p-0003');
  const ok = await signAct(w.registry, draft('participant.apply', { entity: w.state.entity.id, by: 'p-0003', at: new Date().toISOString(), key: keys.publicKeyLine(real.publicKey) }), real);
  assert.equal((await settle(w.registry, w.state, [ok])).applied.length, 1);
});

test('a fork whose origin was misstated is caught', async () => {
  const { child, to } = await forked();
  const founding = structuredClone(child.records[0].payload.act);
  const parentRecords = parseLines(fs.readFileSync(path.join(to, 'parent', 'events.jsonl'), 'utf8')).records;
  const lies = [
    [(f) => { f.parent.members['p-0009'] = ['ssh-ed25519 AAAA']; }, /members reserved/],
    [(f) => { f.parent.root = '0'.repeat(64); }, /history up to the fork point differs/],
    [(f) => { f.carry = { titles: { 'p-0001': 'Queen' } }; }, /titles state carried over differs/],
  ];
  for (const [lie, why] of lies) {
    const f = structuredClone(founding); lie(f);
    const c = await checkFork(child.registry, f, parentRecords);
    assert.equal(c.ok, false); assert.match(c.problems.join('; '), why);
  }
  assert.equal((await checkFork(child.registry, founding, parentRecords.slice(0, 2))).ok, false, 'a shortened parent record');
});

test('forking refuses an electorate nobody would be on, and a founder using someone else\'s id', async () => {
  const { fork } = await import('../cli/commands/fork.js');
  const dir = await entityOnDisk();
  await assert.rejects(quietly(() => fork({ pos: [], opt: { dir, out: path.join(tmp(), 'f1'), name: 'X', as: 'p-0002', electorate: 'member:p-0003' } })), /not on the register/);
  const { keyDir } = await import('../cli/context.js');
  const other = path.join(keyDir(store.read(dir).records[0].payload.act.entity), 'p-0002');
  await assert.rejects(quietly(() => fork({ pos: [], opt: { dir, out: path.join(tmp(), 'f2'), name: 'X', as: 'p-0001', key: other } })), /not one p-0001 held in the parent/);
});
