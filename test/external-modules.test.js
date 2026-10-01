// Modules from outside the core: fetched, pinned by digest, installed by decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as store from '../kernel/store.js';
import { tmp, quietly, entityOnDisk, LIB } from './helpers.js';
import { parseSource, moduleDigest } from '../cli/modules.js';

const cli = async () => ({
  ...(await import('../cli/context.js')),
  mod: (await import('../cli/commands/module.js')).module,
  act: (await import('../cli/commands/act.js')).act,
});

// Lay `entity module add SOURCE`, have everyone vote, settle. Returns the proposal's act.
async function installByDecision(dir, source, people = ['p-0001', 'p-0002', 'p-0003']) {
  const { mod, act, openEntity, settlePending } = await cli();
  await quietly(() => mod({ pos: ['add', source], opt: { dir, as: 'p-0001' } }));
  const lay = store.readPending(dir).map(p => p.act).find(a => a.kind === 'proposal.lay');
  const { proposalId } = await import('../modules/deliberation/index.js');
  for (const by of people) await quietly(() => act({ pos: ['ballot.cast'], opt: { dir, as: by, proposal: proposalId(lay), choice: 'for' } }));
  const r = await quietly(async () => settlePending(await openEntity({ dir }), { until: '2999-01-01T00:00:00.000Z' }));
  return { lay, r };
}

test('sources are parsed strictly; a branch is only where to look, pinned before use', () => {
  assert.deepEqual(parseSource('github:you/entity-modules/offices@3f2a9c1'), { type: 'git', url: 'https://github.com/you/entity-modules.git', sub: 'offices', commit: '3f2a9c1' });
  assert.deepEqual(parseSource('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5@abcdef1'), { type: 'git', url: 'rad://z3gqcJUoA1n9HaHKufZs5FCSGazv5', sub: '', commit: 'abcdef1' });
  assert.equal(parseSource('git:https://example.org/m.git#mods/value@0123456').sub, 'mods/value');
  assert.equal(parseSource('github:you/repo@main').commit, 'main', 'a branch parses, and is pinned to its commit (pin) before any proposal names it');
  assert.throws(() => parseSource('https://github.com/you/repo'), /not a module source/);
});

test('the founding records where each of its modules came from, and its digest', async () => {
  const dir = await entityOnDisk({ people: 1 });
  const found = store.read(dir).records[0].payload.act;
  const titles = found.install.find(m => m.name === 'titles');
  assert.equal(titles.source, 'pack:titles');
  assert.equal(titles.digest, moduleDigest(path.join(LIB, 'titles'), 'titles'));
  assert.ok(!found.install.some(m => m.name === 'deliberation'), 'the core is not a module to install');
});

test('a module is installed by decision from a directory, with exactly the approved code', async () => {
  const dir = await entityOnDisk({ people: 3 });
  const src = path.join(tmp(), 'value'); fs.cpSync(path.join(LIB, 'value'), src, { recursive: true });
  const { lay, r } = await installByDecision(dir, `dir:${src}`);
  assert.deepEqual(lay.install.map(m => m.name), ['value']);
  assert.deepEqual(r.fetched.installed, ['value'], 'the proposer\'s staged code was installed on enactment');
  assert.equal(moduleDigest(path.join(dir, 'modules', 'value'), 'value'), lay.install[0].digest);
  assert.ok(!fs.existsSync(path.join(dir, '.staged', 'value')), 'the staging area is cleared');
  const { openEntity, fullVerify } = await cli();
  assert.equal((await fullVerify(await openEntity({ dir }))).ok, true);
});

test('a module is installed from a git commit', async () => {
  const dir = await entityOnDisk({ people: 3 });
  const repo = tmp('module-repo-');
  fs.cpSync(path.join(LIB, 'deeds'), path.join(repo, 'deeds'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo }).toString().trim();
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'deeds');
  const commit = git('rev-parse', 'HEAD');
  const { lay, r } = await installByDecision(dir, `git:${repo}#deeds@${commit}`);
  assert.equal(lay.install[0].source, `git:${repo}#deeds@${commit}`);
  assert.deepEqual(r.fetched.installed, ['deeds']);
});

test('a copy without a module\'s code waits instead of refusing, then catches up; tampered code is never installed', async () => {
  const dir = await entityOnDisk({ people: 3 });
  const src = path.join(tmp(), 'value'); fs.cpSync(path.join(LIB, 'value'), src, { recursive: true });
  await installByDecision(dir, `dir:${src}`);
  const { openEntity, settlePending, act, mod } = await cli();

  // Another copy, without the code, whose source has gone away.
  const other = tmp(); fs.cpSync(dir, other, { recursive: true });
  fs.rmSync(path.join(other, 'modules', 'value'), { recursive: true });
  fs.renameSync(src, `${src}-away`);
  await quietly(() => act({ pos: ['title.set'], opt: { dir: other, as: 'p-0002', title: 'Waiting' } }));
  const held = await quietly(async () => settlePending(await openEntity({ dir: other }), { until: '2999-01-01T00:00:00.000Z' }));
  assert.deepEqual(held.waitingFor, ['value']);
  assert.equal(held.held.length, 1);
  assert.equal(held.refused.length, 0, 'nothing is refused for want of code');
  assert.equal(store.readPending(other).length, 1, 'the act is still pending');

  // The source comes back, but altered: refused, and nothing installed.
  fs.renameSync(`${src}-away`, src);
  fs.appendFileSync(path.join(src, 'index.js'), '\n// changed after the vote\n');
  const bad = await quietly(async () => settlePending(await openEntity({ dir: other }), { until: '2999-01-01T00:00:00.000Z' }));
  assert.match(bad.fetched.failed[0].why, /does not match the digest the decision approved/);
  assert.ok(!fs.existsSync(path.join(other, 'modules', 'value')));

  // The genuine code returns: fetched, checked, installed, and the act settles.
  fs.cpSync(path.join(LIB, 'value', 'index.js'), path.join(src, 'index.js'));
  await quietly(() => mod({ pos: ['fetch'], opt: { dir: other } }));
  const ok = await quietly(async () => settlePending(await openEntity({ dir: other }), { until: '2999-01-01T00:00:00.000Z' }));
  assert.equal(ok.applied.length, 1);
});

test('a core-only copy is cloned from a bundle and fetches its modules by digest', async () => {
  const dir = await entityOnDisk({ people: 3 });
  const src = path.join(tmp(), 'offices'); fs.cpSync(path.join(LIB, 'offices'), src, { recursive: true });
  await installByDecision(dir, `dir:${src}`);
  const { bundle, clone } = await import('../cli/commands/transport.js');
  const f = path.join(tmp(), 'b.json');
  await quietly(() => bundle({ pos: [], opt: { dir, out: f } }));
  const to = path.join(tmp(), 'clone');
  await quietly(() => clone({ pos: [f, to], opt: {} }));
  for (const m of ['titles', 'vocabulary', 'offices']) assert.ok(fs.existsSync(path.join(to, 'modules', m, 'index.js')), m);
  const { openEntity, fullVerify } = await cli();
  assert.equal((await fullVerify(await openEntity({ dir: to }))).ok, true);
});

test('the core distribution carries no optional module; the pack carries them all', async () => {
  const { dist } = await import('../cli/commands/dist.js');
  const { listTarGz } = await import('../cli/tar.js');
  const { ROOT } = await import('./helpers.js');
  const core = path.join(tmp(), 'core.tar.gz'), pack = path.join(tmp(), 'pack.tar.gz');
  await quietly(() => dist({ pos: [], opt: { dir: ROOT, out: core } }));
  await quietly(() => dist({ pos: [], opt: { dir: ROOT, out: pack, pack: true } }));
  const coreModules = new Set(listTarGz(fs.readFileSync(core)).map(n => n.split('/')).filter(p => p[1] === 'modules' && p.length > 3).map(p => p[2]));
  assert.deepEqual([...coreModules], ['deliberation']);
  const packModules = new Set(listTarGz(fs.readFileSync(pack)).map(n => n.split('/')[1]));
  for (const m of ['titles', 'vocabulary', 'offices', 'value', 'deeds', 'threads']) assert.ok(packModules.has(m), m);
});
