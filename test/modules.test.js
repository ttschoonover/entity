// Modules added to a running entity by decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Parameters, loadDocument, verifyRecords } from '../kernel/index.js';
import { parametersText } from '../kernel/store.js';
import { world, decide, moduleAdds, worldWith, installFor, ALL_MODULES, ROOT, tmp } from './helpers.js';

test('a module is enabled by one decision that carries its parameters', async () => {
  const w = await world({ modules: ALL_MODULES });
  const r = await decide(w, { title: 'Turn on offices', rule: 'organic',
    changes: { 'entity.modules': ['deliberation', 'titles', 'vocabulary', 'offices'] }, adds: await moduleAdds(['offices']), install: await installFor(['offices']) });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const p = new Parameters(w.state.doc);
  assert.equal(p.value('offices.fill_rule'), 'ordinary');
  const text = parametersText(w.state);
  assert.match(text, /# — added by decision since founding/);
  assert.equal(new Parameters(loadDocument(text)).value('offices.create_rule'), 'organic', 'parameters.yml round-trips');
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('enabling is refused without its parameters, for modules not installed, or turning off deliberation', async () => {
  const w = await world({ modules: ALL_MODULES });
  const base = ['deliberation', 'titles', 'vocabulary'];
  const lay = async (fields) => (await decide(w, { title: 't', rule: 'organic', ...fields })).refused[0]?.reason;
  assert.match(await lay({ changes: { 'entity.modules': [...base, 'dragons'] } }), /dragons were never installed/);
  assert.match(await lay({ changes: { 'entity.modules': [...base, 'value'] }, install: [{ name: 'value', source: 'pack:value', digest: 'x' }] }), /needs a digest/);
  assert.match(await lay({ changes: { 'entity.modules': ['titles'] } }), /deliberation cannot be switched off/);
  assert.match(await lay({ adds: await moduleAdds(['deeds']) }), /can only be added by the proposal that enables the deeds module/);
  const weak = await moduleAdds(['value']);
  assert.match(await lay({ changes: { 'entity.modules': [...base, 'value'] }, install: await installFor(['value']), adds: { ...weak, 'value.name': { ...weak['value.name'], changed_by: 'immutable' } } }), /cannot add an unchangeable parameter/);
});

test('a module installed earlier can be switched back on and used in one decision; installing and using at once is refused', async () => {
  const w = await worldWith(['value']);
  const base = ['deliberation', 'titles', 'vocabulary'];
  const off = await decide(w, { title: 'Off', rule: 'organic', changes: { 'entity.modules': base } });
  assert.equal(off.enacted, true);
  const back = await decide(w, { title: 'Start a time bank', rule: 'organic', changes: { 'entity.modules': [...base, 'value'] },
    effects: [{ kind: 'value.issue', to: 'p-0002', amount: 10, memo: 'founding hours' }] });
  assert.equal(back.enacted, true, back.refused?.[0]?.reason || back.notEnacted);
  assert.equal(w.state.m.value.balances['p-0002'], 10);
  const w2 = await world({ modules: ALL_MODULES });
  const both = await decide(w2, { title: 'All at once', rule: 'organic', changes: { 'entity.modules': [...base, 'value'] },
    install: await installFor(['value']), adds: await moduleAdds(['value']), effects: [{ kind: 'value.issue', to: 'p-0002', amount: 1 }] });
  assert.match(both.refused[0].reason, /cannot also use effects/);
});

test('an effect of a module that is not enabled is refused at proposal', async () => {
  const w = await world({ modules: ALL_MODULES });
  const r = await decide(w, { title: 'x', rule: 'organic', effects: [{ kind: 'value.issue', to: 'p-0002', amount: 1 }] });
  assert.match(r.refused[0].reason, /module "value" is not enabled/);
});

test('an effect needs the rule its module sets', async () => {
  const w = await worldWith(['value']);
  const r = await decide(w, { title: 'Quietly', rule: 'ordinary', effects: [{ kind: 'value.issue', to: 'p-0001', amount: 5 }] });
  assert.match(r.refused[0].reason, /requires "organic"/);
});

test('upgrading a module: new code by decision, the old digest kept in its history; the same code is refused', async () => {
  const w = await worldWith(['offices']);
  const [cur] = await installFor(['offices']);
  const same = await decide(w, { title: 'Again', rule: 'organic', install: [cur] });
  assert.match(same.refused[0].reason, /already installed with exactly this code/);
  const next = { ...cur, source: 'pack:offices-next', digest: 'b'.repeat(64) };
  const r = await decide(w, { title: 'Upgrade offices', rule: 'organic', install: [next] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(w.state.modules.offices.digest, 'b'.repeat(64));
  assert.equal(w.state.modules.offices.history[0].digest, cur.digest);
  assert.equal(w.records.find(x => x.kind === 'module.installed' && x.payload.digest === 'b'.repeat(64)).payload.from, cur.digest);
  const weak = await decide(w, { title: 'Quietly', rule: 'ordinary', install: [{ ...next, digest: 'c'.repeat(64) }] });
  assert.match(weak.refused[0].reason, /requires "organic"/);
});

test('an upgrade must replay the record it inherits', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const { entityOnDisk, quietly } = await import('./helpers.js');
  const dir = await entityOnDisk();
  const { act, settle } = await import('../cli/commands/act.js');
  await quietly(async () => { await act({ pos: ['title.set'], opt: { dir, as: 'p-0002', title: 'Ben' } }); await settle({ pos: [], opt: { dir } }); });
  const store = await import('../kernel/store.js');
  const { replaysWith } = await import('../cli/modules.js');
  const records = store.read(dir).records;
  const stage = (name, edit) => {
    const d = path.join(dir, '.staged', name); fs.cpSync(path.join(dir, 'modules', 'titles'), d, { recursive: true });
    const f = path.join(d, 'index.js'); fs.writeFileSync(f, edit(fs.readFileSync(f, 'utf8'))); return d;
  };
  const harmless = stage('titles-a', (s) => `// a comment\n${s}`);
  assert.equal((await replaysWith(dir, 'titles', harmless, records)).ok, true);
  const breaking = stage('titles-b', (s) => s.replace("if (!t) return 'a title cannot be empty';", "return 'titles are closed';"));
  const r = await replaysWith(dir, 'titles', breaking, records);
  assert.equal(r.ok, false);
  assert.match(r.problem.problem, /titles are closed/);
});

test('modules come from a published pack first, pinned from a branch to its commit', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { pin, fromPack, packSource, available } = await import('../cli/modules.js');
  const { sourceFor } = await import('../cli/commands/found.js');
  const repo = path.join(tmp(), 'pack');
  fs.cpSync(path.join(ROOT, 'library', 'polls'), path.join(repo, 'polls'), { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repo }).toString().trim();
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'pack');
  const commit = git('rev-parse', 'HEAD');
  assert.equal(fromPack('github:you/entity-modules@main', 'polls'), 'github:you/entity-modules/polls@main');
  assert.equal(fromPack('git:/x/y#lib@v1', 'polls'), 'git:/x/y#lib/polls@v1');
  assert.equal(pin(`git:${repo}#polls@main`), `git:${repo}#polls@${commit}`);
  assert.equal(pin(`git:${repo}#polls@${commit}`), `git:${repo}#polls@${commit}`, 'a commit stays as it is');
  const ent = path.join(tmp(), 'ent'); fs.mkdirSync(ent);
  fs.writeFileSync(path.join(ent, 'library.yml'), `from: git:${repo}@main\nmodules: {}\n`);
  assert.equal(packSource(ent), `git:${repo}@main`);
  assert.equal(sourceFor(ent, 'polls'), `git:${repo}#polls@${commit}`);
  assert.deepEqual((await available(ent, `git:${repo}@main`)).map(m => m.name), ['polls']);
  fs.writeFileSync(path.join(ent, 'library.yml'), `from: git:${repo}@main\nmodules:\n  polls: dir:../elsewhere/polls\n`);
  assert.equal(sourceFor(ent, 'polls'), 'dir:../elsewhere/polls', 'a module named in library.yml comes from where it says');
});
