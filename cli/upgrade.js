// Upgrading the core by decision: fetch a version of entity, check that it
// replays this entity's record exactly, propose exactly its files, and, once a
// decision approves that digest, install them. The gate (kernel/gate.js) is
// what permits the install; this only prepares what it checks.
//
// A source is where to look for the new version:
//   dir:PATH                       an unzipped copy of entity (e.g. ~/entities/entity)
//   github:OWNER/REPO@REF          a GitHub repository; REF a commit or a branch
//   git:URL@REF                    any git repository
// A branch is resolved to its commit when staged, and the proposal names that
// commit. What the members approve is the digest of the files, not the source.
//
// Only the core's files are touched: kernel, cli, interface, deliberation,
// transports, hardware, presets, docs, tests, the module pack and the package
// files. The entity's law, its installed modules, library.yml and its record
// are its own and never change here. Installed modules upgrade separately
// (`entity module upgrade`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changeDigest, gate as runGate, classify } from '../kernel/gate.js';
import { count } from '../modules/deliberation/count.js';
import { walk } from './commands/dist.js';

export const CORE = ['kernel', 'modules/deliberation', 'modules/index.js', 'interface', 'cli', 'transports', 'hardware', 'presets', 'test', 'docs', 'library', 'package.json', 'README.md', 'LICENSE'];
const STAGE = path.join('.staged', 'core');
const MANIFEST = path.join('.staged', 'core.json');

export function parseCoreSource(s) {
  let m;
  if ((m = s.match(/^dir:(.+)$/))) return { type: 'dir', path: m[1].replace(/^~(?=\/)/, os.homedir()) };
  if ((m = s.match(/^github:([\w.-]+)\/([\w.-]+)@([\w./-]+)$/))) return { type: 'git', url: `https://github.com/${m[1]}/${m[2]}.git`, ref: m[3] };
  if ((m = s.match(/^git:(.+)@([\w./-]+)$/))) return { type: 'git', url: m[1], ref: m[2] };
  throw new Error(`"${s}" is not a core source: use dir:PATH, github:OWNER/REPO@REF or git:URL@REF`);
}

const files = (root) => CORE.flatMap(c => (fs.existsSync(path.join(root, c)) ? (fs.statSync(path.join(root, c)).isDirectory() ? walk(root, c) : [c]) : []))
  .filter(f => !/(^|\/)(node_modules|\.git|\.staged)(\/|$)/.test(f) && !/\.DS_Store$/.test(f));
const read = (root, p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p)) : null);
const versionOf = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { return null; } };

// Fetch the source into .staged/core. → { dir, source, pinned, version }
export function stage(entityDir, source) {
  const src = parseCoreSource(source);
  const dest = path.join(entityDir, STAGE);
  fs.rmSync(dest, { recursive: true, force: true });
  let from, pinned = source, tmp = null;
  try {
    if (src.type === 'dir') from = path.resolve(entityDir, src.path);
    else {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-core-'));
      const git = (...a) => execFileSync('git', a, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 }).toString().trim();
      git('init', '-q'); git('remote', 'add', 'origin', src.url);
      git('fetch', '-q', '--depth', '1', 'origin', src.ref);
      git('-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD');
      pinned = `${source.slice(0, source.lastIndexOf('@'))}@${git('rev-parse', 'HEAD')}`;
      from = tmp;
    }
    if (!fs.existsSync(path.join(from, 'kernel', 'index.js')) || !fs.existsSync(path.join(from, 'cli', 'index.js'))) throw new Error(`${source} does not hold entity (no kernel/ and cli/)`);
    for (const f of files(from)) { fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true }); fs.copyFileSync(path.join(from, f), path.join(dest, f)); }
  } catch (e) {
    throw new Error(`could not fetch ${source}: ${(e.stderr?.toString() || e.message).trim().split('\n').pop()}`);
  } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  return { dir: dest, source, pinned, version: versionOf(dest) };
}

// What the staged version would change: every core file that differs, is new,
// or would be deleted, and the digest of the result.
export function changes(entityDir, stagedDir) {
  const all = [...new Set([...files(entityDir), ...files(stagedDir)])].sort();
  const paths = all.filter(p => { const a = read(entityDir, p), b = read(stagedDir, p); return !(a && b && a.equals(b)); });
  return { paths, digest: changeDigest(paths.map(p => ({ path: p, content: read(stagedDir, p) }))) };
}

// Does the entity's record replay exactly under the new code? Run the new
// version's own `verify`, in a scratch copy of the entity with the new core.
export function replays(entityDir, stagedDir) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-candidate-'));
  try {
    // Only ordinary files and folders: pipes and sockets (the Pi's GPIO library
    // leaves .lgd-nfy* pipes in whatever folder it runs from) cannot be copied.
    const plain = (src) => { try { const st = fs.lstatSync(src); return st.isFile() || st.isDirectory() || st.isSymbolicLink(); } catch { return false; } };
    for (const n of fs.readdirSync(entityDir)) if (n !== '.staged' && n !== '.git') fs.cpSync(path.join(entityDir, n), path.join(scratch, n), { recursive: true, filter: plain });
    for (const f of files(scratch)) if (!read(stagedDir, f)) fs.rmSync(path.join(scratch, f), { force: true });
    fs.cpSync(stagedDir, scratch, { recursive: true });
    const out = execFileSync(process.execPath, [path.join(scratch, 'cli', 'index.js'), 'verify', '--dir', scratch],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, env: { ...process.env, ENTITY_OFFLINE: '1' } }).toString();
    return { ok: /Verified\./.test(out), output: out.trim() };
  } catch (e) {
    return { ok: false, output: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

// Stage a source and describe the upgrade, remembering it for `apply`.
export function check(entityDir, source, params) {
  const s = stage(entityDir, source);
  const c = changes(entityDir, s.dir);
  const r = replays(entityDir, s.dir);
  const need = c.paths.map(p => classify(p).need).filter(Boolean).reduce((a, b) => (!a || params.rank(b) > params.rank(a) ? b : a), null);
  const manifest = { source: s.source, pinned: s.pinned, from: versionOf(entityDir), version: s.version, paths: c.paths, digest: c.digest,
    need, replays: r.ok, replayOutput: r.output.split('\n').slice(-6).join('\n'), checked: new Date().toISOString() };
  if (!c.paths.length) { fs.rmSync(s.dir, { recursive: true, force: true }); fs.rmSync(path.join(entityDir, MANIFEST), { force: true }); return manifest; }
  fs.writeFileSync(path.join(entityDir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function staged(entityDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(entityDir, MANIFEST), 'utf8'));
    return fs.existsSync(path.join(entityDir, STAGE)) ? m : null;
  } catch { return null; }
}

// The fields of a proposal that approves exactly the staged version.
export function proposal(m) {
  return {
    title: `Upgrade entity from ${m.from} to ${m.version}`,
    text: `Replaces ${m.paths.length} core file(s) with those of entity ${m.version}, from ${m.pinned}. ` +
      'The entity\'s record replays exactly with the new code; its law, modules and record are unchanged.',
    rule: m.need, paths: m.paths, digest: m.digest,
  };
}

// Which carried decision approves the staged version, if any.
export const approvedBy = (state, m) => Object.values(state.proposals).find(p => p.approved && p.digest === m.digest) || null;

// Install the staged version, if a decision approved exactly it.
export function apply(entityDir, state, decision) {
  const m = staged(entityDir);
  if (!m) throw new Error('nothing is staged: run `entity upgrade check` first');
  const stagedDir = path.join(entityDir, STAGE);
  const now = changes(entityDir, stagedDir);
  if (now.digest !== m.digest) throw new Error('the staged files or this copy\'s code changed since they were checked; run `entity upgrade check` again');
  const id = decision || approvedBy(state, m)?.id;
  const r = runGate(m.paths, { decision: id, state, count, digest: m.digest });
  if (!r.ok) throw new Error(r.why.replace(/^refused: /, ''));
  for (const p of m.paths) {
    const c = read(stagedDir, p), f = path.join(entityDir, p);
    if (c === null) fs.rmSync(f, { force: true });
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); }
  }
  fs.rmSync(stagedDir, { recursive: true, force: true });
  fs.rmSync(path.join(entityDir, MANIFEST), { force: true });
  return { version: m.version, decision: id, approvers: r.approvers, paths: m.paths.length };
}
