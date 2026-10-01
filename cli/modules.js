// Module code from outside: fetched from a source, checked against the digest a
// decision recorded, then kept inside the entity's own directory so the entity
// never depends on that source again.
//
// Sources (a source is where to look; the digest is what is trusted):
//   github:OWNER/REPO[/SUBDIR]@REF        a GitHub repository at a commit, or at a
//                                         branch or tag, pinned to its commit when fetched
//   rad:RID[/SUBDIR]@COMMIT               a Radicle repository at a commit (needs git-remote-rad)
//   git:URL[#SUBDIR]@COMMIT               any git repository at a commit
//   dir:PATH                              a directory, relative to the entity
//   pack:NAME                             the module pack: $ENTITY_MODULES/NAME,
//                                         ../entity-modules/NAME, or this installation's library/NAME

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changeDigest } from '../kernel/gate.js';
import { yaml, CORE_VERSION, versionAtLeast } from '../kernel/index.js';
import * as store from '../kernel/store.js';

export const STAGED = '.staged';

export function parseSource(source) {
  let m;
  if ((m = source.match(/^github:([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)@([\w./-]+)$/))) return { type: 'git', url: `https://github.com/${m[1]}/${m[2]}.git`, sub: m[3].slice(1), commit: m[4] };
  if ((m = source.match(/^rad:(z\w+)((?:\/[\w.-]+)*)@([0-9a-f]{7,40})$/))) return { type: 'git', url: `rad://${m[1]}`, sub: m[2].slice(1), commit: m[3] };
  if ((m = source.match(/^git:(.+?)(?:#([\w./-]+))?@([\w./-]+)$/))) return { type: 'git', url: m[1], sub: m[2] || '', commit: m[3] };
  if ((m = source.match(/^dir:(.+)$/))) return { type: 'dir', path: m[1] };
  if ((m = source.match(/^pack:([a-z][a-z0-9-]*)$/))) return { type: 'pack', name: m[1] };
  throw new Error(`"${source}" is not a module source. Use github:OWNER/REPO[/SUBDIR]@COMMIT, rad:RID[/SUBDIR]@COMMIT, git:URL[#SUBDIR]@COMMIT, dir:PATH or pack:NAME`);
}

// A branch or tag named in a source is only where to look: pin it to the
// commit it points at now, so the proposal (and every copy fetching later)
// names exactly one version. Remembered for the life of the command.
const pinned = new Map();
const isCommit = (ref) => /^[0-9a-f]{7,40}$/.test(ref);
export function pin(source) {
  const src = parseSource(source);
  if (src.type !== 'git' || isCommit(src.commit) || source.startsWith('rad:')) return source;
  if (pinned.has(source)) return pinned.get(source);
  let out;
  try { out = execFileSync('git', ['ls-remote', src.url, src.commit], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).toString(); }
  catch (e) { throw new Error(`could not reach ${src.url}: ${(e.stderr?.toString() || e.message).trim().split('\n').pop()}`); }
  const line = out.split('\n').find(l => /\trefs\/(heads|tags)\//.test(l) && l.endsWith(`/${src.commit}`)) || out.split('\n').find(Boolean);
  if (!line) throw new Error(`${src.url} has no branch or tag "${src.commit}"`);
  const commit = line.split('\t')[0];
  const result = source.slice(0, source.lastIndexOf('@') + 1) + commit;
  pinned.set(source, result);
  return result;
}

// Where the modules are published: library.yml's "from" line, e.g.
//   from: github:you/entity-modules@main
// A module named in library.yml's "modules" is fetched from there instead.
export function packSource(entityDir) {
  try { return yaml.parse(fs.readFileSync(path.join(entityDir, 'library.yml'), 'utf8')).from || null; } catch { return null; }
}
export function fromPack(from, name) {
  const at = from.lastIndexOf('@');
  const base = from.slice(0, at), ref = from.slice(at + 1);
  if (base.startsWith('git:')) { const [url, sub] = base.slice(4).split('#'); return `git:${url}#${sub ? `${sub}/` : ''}${name}@${ref}`; }
  return `${base}/${name}@${ref}`;
}

// What a module pack offers: every folder in it with an index.js. → [{ name, about, core }]
export async function available(entityDir, from) {
  const src = parseSource(pin(from));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-pack-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
    git('init', '-q'); git('remote', 'add', 'origin', src.url);
    try { git('fetch', '-q', '--depth', '1', 'origin', src.commit); } catch { git('fetch', '-q', 'origin'); }
    git('-c', 'advice.detachedHead=false', 'checkout', '-q', src.commit);
    const root = path.join(tmp, src.sub || '');
    return fs.readdirSync(root).sort().filter(n => fs.existsSync(path.join(root, n, 'index.js'))).map(n => {
      const text = fs.readFileSync(path.join(root, n, 'index.js'), 'utf8');
      const about = (text.match(/^\/\/ [a-z0-9-]+ · (.+)$/m) || [])[1] || '';
      const core = (text.match(/core: '([\d.]+)'/) || [])[1] || null;
      return { name: n, about, core };
    });
  } catch (e) {
    throw new Error(`could not read ${from}: ${(e.stderr?.toString() || e.message).trim().split('\n').pop()}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function packDirs(entityDir) {
  return [process.env.ENTITY_MODULES, path.join(entityDir, '..', 'entity-modules'), path.join(store.CODE_ROOT, 'library')].filter(Boolean);
}

function files(root, rel = '') {
  const d = path.join(root, rel);
  return fs.readdirSync(d).sort().flatMap(n => {
    if (n === '.git' || n === 'node_modules') return [];
    const r = rel ? `${rel}/${n}` : n;
    return fs.statSync(path.join(root, r)).isDirectory() ? files(root, r) : [r];
  });
}

// The fingerprint of a module's code: every file, as it would sit in modules/NAME/.
export function moduleDigest(dir, name) {
  return changeDigest(files(dir).map(f => ({ path: `modules/${name}/${f}`, content: fs.readFileSync(path.join(dir, f)) })));
}

function copyTree(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  for (const f of files(from)) {
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
}

// Fetch a source into STAGED/NAME. Returns the staged directory.
export function fetchSource(entityDir, source, name) {
  const src = parseSource(pin(source));
  const dest = path.join(entityDir, STAGED, name);
  if (src.type === 'dir') {
    const from = path.resolve(entityDir, src.path);
    if (!fs.existsSync(path.join(from, 'index.js'))) throw new Error(`${from} holds no module (no index.js)`);
    copyTree(from, dest);
  } else if (src.type === 'pack') {
    const from = packDirs(entityDir).map(d => path.join(d, src.name)).find(d => fs.existsSync(path.join(d, 'index.js')));
    if (!from) throw new Error(`module ${src.name} is not in any module pack (looked in ${packDirs(entityDir).join(', ')})`);
    copyTree(from, dest);
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-module-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
      git('init', '-q'); git('remote', 'add', 'origin', src.url);
      try { git('fetch', '-q', '--depth', '1', 'origin', src.commit); }
      catch { git('fetch', '-q', 'origin'); }
      git('-c', 'advice.detachedHead=false', 'checkout', '-q', src.commit);
      const from = path.join(tmp, src.sub || '');
      if (!fs.existsSync(path.join(from, 'index.js'))) throw new Error(`${source}: no index.js at ${src.sub || 'the repository root'}`);
      copyTree(from, dest);
    } catch (e) {
      throw new Error(`could not fetch ${source}: ${(e.stderr?.toString() || e.message).trim().split('\n').pop()}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  return dest;
}

// What a module says about itself, read from its staged or installed files.
export async function describeModule(dir) {
  const mod = (await import(`file://${path.join(dir, 'index.js')}?v=${Date.now()}`)).default;
  if (!mod || typeof mod.install !== 'function' || !mod.name) throw new Error('index.js must export default { name, install }');
  const pf = path.join(dir, 'parameters.yml');
  const parameters = fs.existsSync(pf) ? yaml.parse(fs.readFileSync(pf, 'utf8')).parameters || {} : {};
  const missing = (mod.parameterKeys || []).filter(k => !(k in parameters));
  if (missing.length) throw new Error(`module ${mod.name} declares parameters its parameters.yml lacks: ${missing.join(', ')}`);
  if (mod.core && !versionAtLeast(CORE_VERSION, mod.core)) throw new Error(`module ${mod.name} needs core ${mod.core} or later; this copy runs ${CORE_VERSION}. Upgrade the core first (by decision: \`entity adopt\`)`);
  return { name: mod.name, parameters, core: mod.core || null, files: files(dir) };
}

// Move staged code into modules/NAME, only if it matches the digest.
export function install(entityDir, name, digest) {
  const staged = path.join(entityDir, STAGED, name);
  const got = moduleDigest(staged, name);
  if (got !== digest) throw new Error(`module ${name}: the fetched code does not match the digest the decision approved (${got.slice(0, 12)}… ≠ ${digest.slice(0, 12)}…). Nothing was installed.`);
  copyTree(staged, path.join(entityDir, 'modules', name));
  fs.rmSync(staged, { recursive: true, force: true });
}

// Every module the record says this entity relies on, read straight from the
// records (no fold), so it works even when code is missing.
export function recordedModules(records) {
  const out = {};
  for (const r of records) {
    const a = r.payload && r.payload.act;
    if (r.kind === 'entity.found') for (const m of a.install || []) out[m.name] = { source: m.source, digest: m.digest };
    if (r.kind === 'module.installed') out[r.payload.name] = { source: r.payload.source, digest: r.payload.digest };
  }
  return out;
}

export function moduleStatus(entityDir, name, digest) {
  const dir = path.join(entityDir, 'modules', name);
  if (!fs.existsSync(path.join(dir, 'index.js'))) return 'missing';
  return moduleDigest(dir, name) === digest ? 'ok' : 'differs';
}

// Fetch and install whatever the record requires and this copy lacks.
// Returns { installed[], failed[{ name, why }] }. Never touches a module whose
// code already matches.
export function ensureModules(entityDir, records) {
  const installed = [], failed = [];
  for (const [name, { source, digest }] of Object.entries(recordedModules(records))) {
    const status = moduleStatus(entityDir, name, digest);
    if (status === 'ok') continue;
    try {
      const staged = path.join(entityDir, STAGED, name);
      if (!(fs.existsSync(staged) && moduleDigest(staged, name) === digest)) fetchSource(entityDir, source, name);
      install(entityDir, name, digest);
      installed.push(name);
    } catch (e) { failed.push({ name, why: e.message, status }); }
  }
  return { installed, failed };
}

// Would the record so far replay exactly with this module's staged code in
// place of the installed code? An upgrade must reproduce the history it
// inherits: every copy replays it with the new code from then on.
export async function replaysWith(entityDir, name, stagedDir, records) {
  const { createRegistry, verifyRecords } = await import('../kernel/index.js');
  const { withParameters } = await import('../modules/index.js');
  const mods = [];
  for (const n of store.installedModules(entityDir)) {
    const dir = n === name ? stagedDir : path.join(entityDir, 'modules', n);
    const url = `file://${path.join(dir, 'index.js')}?v=${Date.now()}`;
    mods.push(await withParameters((await import(url)).default, `file://${path.join(dir, 'index.js')}`));
  }
  const v = await verifyRecords(createRegistry(mods), records);
  return { ok: v.ok, problem: v.problems[0] || null };
}

// Prepare a proposal to install or upgrade a module, as `entity module add` and
// `entity module upgrade` do: fetch the code from the entity's module source,
// check it, and return the proposal's fields for a member to sign. The page uses
// this through the node (a browser cannot fetch the code itself).
export async function prepareModule(e, name, mode = 'add') {
  const { sourceFor } = await import('./commands/found.js');
  const dir = e.dir;
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name || '')) throw new Error('a module name is lowercase letters, digits and -');
  if (name === 'deliberation') throw new Error('deliberation is part of the core');
  const recorded = recordedModules(e.records);
  const enabled = e.params.value('entity.modules');
  if (mode === 'add' && recorded[name]) throw new Error(`${name} is already installed`);
  if (mode === 'upgrade' && !recorded[name]) throw new Error(`${name} is not installed here`);
  const source = sourceFor(dir, name);
  const staged = fetchSource(dir, source, name);
  const d = await describeModule(staged);
  if (d.name !== name) throw new Error(`${source} holds the module "${d.name}", not "${name}"`);
  const digest = moduleDigest(staged, name);
  const rule = e.params.rule('entity.modules').name;
  const info = { name, source, digest, files: d.files, settings: Object.keys(d.parameters || {}).length, rule };
  if (mode === 'add') {
    return { info, fields: { title: `Install and enable the ${name} module`, rule,
      text: `Installs ${name} from ${source}, exactly the code with digest ${digest}.`,
      changes: { 'entity.modules': [...enabled, name] }, install: [{ name, source, digest }] } };
  }
  const was = recorded[name];
  if (digest === was.digest) return { info: { ...info, current: true } };
  const check = await replaysWith(dir, name, staged, e.records);
  if (!check.ok) throw new Error(`the new code does not reproduce this entity's record (record ${check.problem?.seq}: ${check.problem?.problem}), so it cannot be installed`);
  return { info: { ...info, replaced: was.digest, replays: e.records.length }, fields: { title: `Upgrade the ${name} module`, rule,
    text: `Replaces the ${name} code ${was.digest} with ${digest}, from ${source}. The record so far replays exactly with it.`,
    install: [{ name, source, digest }] } };
}
