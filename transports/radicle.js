// Radicle · the entity directory is a Radicle repository. Code, law,
// parameters and record replicate together, peer to peer, with no host.
//
// Radicle is a source, never an authority:
//   push  commits this copy's state to its own namespace and announces it.
//   pull  fetches, then reads each participant's record out of their branch as
//         a bundle. Those bundles go through the same verified absorb as every
//         other transport. Git never merges events.jsonl; nothing is trusted
//         because it arrived by Radicle, or because it is on the canonical branch.
//
// Code and law are not pulled here. They are adopted file by file, only as a
// carried decision approved them: `entity adopt <ref>`.
//
// node.json:  { "name": "radicle", "class": "radicle", "home": "~/.radicle", "branch": "main" }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseLines } from '../kernel/record.js';
import { hash } from '../kernel/hash.js';
import { canonical } from '../kernel/canonical.js';
import { nodeId } from '../kernel/keys.js';
import { BUNDLE_FORMAT } from '../kernel/transport.js';
import { SEALED_EXCLUDE } from '../kernel/store.js';
import { latestPeriod, sealActTo } from '../kernel/sealing.js';

export function radHome(dest = {}) {
  const h = dest.home || process.env.RAD_HOME || path.join(os.homedir(), '.radicle');
  return h.startsWith('~') ? path.join(os.homedir(), h.slice(1)) : h;
}

export function runner(dir, dest = {}) {
  const env = { ...process.env, RAD_HOME: radHome(dest) };
  if (dest.bin) env.PATH = `${dest.bin}${path.delimiter}${env.PATH}`;
  return (cmd, args, { input, buffer = false, timeout } = {}) => {
    try {
      return execFileSync(cmd, args, { cwd: dir, env, input, encoding: buffer ? 'buffer' : 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: timeout || dest.timeout || 60000, maxBuffer: 256e6 });
    } catch (e) {
      // rad often prints its error on stdout, so look at both before falling back to the bare "Command failed".
      const said = [e.stderr, e.stdout].map(x => (x ? x.toString() : '').replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean).join('\n');
      const why = e.code === 'ETIMEDOUT' ? `timed out after ${(timeout || dest.timeout || 60000) / 1000}s` : (said.split('\n').filter(l => /error|✗|fail|denied|passphrase|agent/i.test(l)).pop() || said.split('\n').filter(Boolean).pop() || e.message);
      const err = new Error(`${cmd} ${args[0]}: ${why}`); err.code = e.code; throw err;
    }
  };
}

// This copy's own Node ID, read from its Radicle key. No running node needed.
export function selfNid(dest = {}) {
  const pub = path.join(radHome(dest), 'keys', 'radicle.pub');
  return fs.existsSync(pub) ? nodeId(fs.readFileSync(pub, 'utf8')) : null;
}

// Participants whose key is also their Radicle identity, found from the register.
export function participantNids(dir) {
  const d = path.join(dir, 'participants');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json') && f !== 'index.json').flatMap(f => {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      return p.status === 'left' ? [] : p.keys.map(k => ({ id: p.id, nid: nodeId(k) }));
    } catch { return []; }
  });
}

// Remotes that are other peers' namespaces of this repository.
export function peerRemotes(run) {
  const out = {};
  for (const line of run('git', ['remote', '-v']).split('\n')) {
    const m = line.match(/^(\S+)\s+rad:\/\/([^/\s]+)\/(z6Mk\w+)\s+\(fetch\)/);
    if (m) out[m[1]] = m[3];
  }
  return out;
}

export function ensureCommitIdentity(run) {
  let has = true;
  try { run('git', ['config', 'user.email']); } catch { has = false; }
  return has ? [] : ['-c', 'user.name=entity', '-c', 'user.email=entity@localhost'];
}

// Read one peer's record, attestations, checkpoints and pending acts from a git ref.
export function bundleFromRef(run, ref) {
  let files;
  try { files = run('git', ['ls-tree', '-r', '--name-only', ref, '--', 'record', 'pending']).split('\n').filter(Boolean); }
  catch { return null; }
  const show = (p) => run('git', ['show', `${ref}:${p}`]);
  const json = (re) => files.filter(f => re.test(f) && !f.endsWith('index.json')).flatMap(f => { try { return [JSON.parse(show(f))]; } catch { return []; } });
  if (!files.includes('record/events.jsonl')) return null;
  const { records } = parseLines(show('record/events.jsonl'));
  const found = records[0]?.payload?.act;
  return {
    format: BUNDLE_FORMAT,
    entity: { id: found?.entity || null, name: null },
    range: { from: 1, to: records.length },
    records,
    attestations: json(/^record\/attestations\/[^/]+\.json$/),
    checkpoints: json(/^record\/checkpoints\/[^/]+\.json$/),
    pending: json(/^pending\/[^/]+\.json$/).map(x => x.act || x),
  };
}

// Document files (the docs module) a peer holds and this copy does not. They
// are content-addressed, so a file is taken only if it matches its name; the
// node and every page check it against the record before using it.
export function importDocuments(run, ref, dir) {
  let list = '';
  try { list = run('git', ['ls-tree', '-r', '--name-only', ref, '--', 'documents']); } catch { return 0; }
  let n = 0;
  for (const p of list.split('\n')) {
    const m = p.match(/^documents\/([a-z0-9_][a-z0-9-]{0,39})\/([0-9a-f]{64})\.json$/);
    if (!m) continue;
    const f = path.join(dir, p);
    if (fs.existsSync(f)) continue;
    let b; try { b = JSON.parse(run('git', ['show', `${ref}:${p}`])); } catch { continue; }
    const { sig, id, ...rest } = b || {};
    if (!sig || id !== m[2] || hash(canonical(rest)) !== m[2]) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(b) + '\n');
    n++;
  }
  return n;
}

// In a sealed republic, an unsettled act is sealed to the latest key period
// before git carries it, so peers and seeds see only ciphertext. A reader's
// copy opens it again when it settles.
export async function sealPendingFiles(dir) {
  const rf = path.join(dir, 'record', 'events.jsonl'), pd = path.join(dir, 'pending');
  if (!fs.existsSync(rf) || !fs.existsSync(pd)) return 0;
  const period = latestPeriod(parseLines(fs.readFileSync(rf, 'utf8')).records);
  if (!period) return 0;
  let n = 0;
  for (const f of fs.readdirSync(pd).filter(x => x.endsWith('.json'))) {
    const file = path.join(pd, f);
    let data; try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (data.sealedAct) continue;
    fs.writeFileSync(file, JSON.stringify(await sealActTo(period, data.act || data), null, 2) + '\n');
    n++;
  }
  return n;
}

export default function radicle(dest, { dir }) {
  const run = runner(dir, dest);
  const branch = dest.branch || 'main';
  const isRepo = () => { try { run('rad', ['.']); return true; } catch { return false; } };

  return {
    name: dest.name || 'radicle',

    async push(bundle) {
      if (!isRepo()) throw new Error('this entity is not a Radicle repository; run `entity radicle init`');
      // A sealed record's register and parameters stay on this copy (kernel/store.js).
      const exclude = path.join(dir, '.git', 'info', 'exclude');
      if (fs.existsSync(exclude) && fs.readFileSync(exclude, 'utf8').includes(SEALED_EXCLUDE)) {
        run('git', ['rm', '-r', '-q', '--cached', '--ignore-unmatch', 'participants', 'parameters.yml']);
        await sealPendingFiles(dir);
      }
      run('git', ['add', '-A']);
      if (run('git', ['status', '--porcelain']).trim()) {
        const to = bundle?.range?.to ?? '?';
        run('git', [...ensureCommitIdentity(run), 'commit', '-q', '-m', `entity: ${to} records`]);
      }
      run('git', ['push', '-q', 'rad', branch], { timeout: dest.timeout || 120000 });
    },

    // Returns one bundle per peer: [{ source, bundle }]. Unreachable seeds are
    // not an error; whatever the local node already holds is still read.
    async pull() {
      if (!isRepo()) throw new Error('this entity is not a Radicle repository; run `entity radicle init`');
      const notes = [];
      try { run('rad', ['sync', '--fetch'], { timeout: dest.timeout || 60000 }); }
      catch (e) { notes.push(`fetch: ${e.message}`); }
      const self = selfNid(dest);
      const remotes = peerRemotes(run);
      const known = new Set(Object.values(remotes));
      // Follow every peer publishing a namespace here, not only participants:
      // an applicant is not on the register until their application is read.
      // Following costs nothing in trust; every bundle is verified on arrival.
      if (dest.follow !== 'none') {
        const named = new Map(participantNids(dir).map(p => [p.nid, p.id]));
        let published = [];
        try { published = run('rad', ['inspect', '--sigrefs']).split('\n').map(l => l.split(/\s+/)[0]).filter(n => /^z6Mk\w+$/.test(n)); }
        catch (e) { notes.push(`inspect: ${e.message}`); }
        // A peer first seen as an applicant is renamed once their key is on the register.
        for (const [name, nid] of Object.entries(remotes)) {
          const id = named.get(nid);
          if (id && name !== id && name.startsWith('peer-') && !remotes[id]) {
            try { run('git', ['remote', 'rename', name, id]); delete remotes[name]; remotes[id] = nid; } catch { /* keep the old name */ }
          }
        }
        for (const nid of new Set([...published, ...named.keys()])) {
          if (nid === self || known.has(nid)) continue;
          const name = named.get(nid) || `peer-${nid.slice(4, 12)}`;
          try { run('rad', ['remote', 'add', nid, '--name', name]); remotes[name] = nid; known.add(nid); }
          catch { /* not yet seen on the network; tried again next time */ }
        }
      }
      const out = [];
      for (const [name, nid] of Object.entries(remotes)) {
        if (nid === self) continue;
        try { run('git', ['fetch', '-q', name]); }
        catch (e) { notes.push(`${name}: ${e.message}`); continue; }
        const bundle = bundleFromRef(run, `${name}/${branch}`);
        if (bundle) out.push({ source: `${name} (${nid.slice(0, 12)}…)`, bundle });
        try { const n = importDocuments(run, `${name}/${branch}`, dir); if (n) notes.push(`${name}: ${n} document file${n === 1 ? '' : 's'}`); }
        catch (e) { notes.push(`${name} documents: ${e.message}`); }
      }
      out.notes = notes;
      return out;
    },
  };
}
