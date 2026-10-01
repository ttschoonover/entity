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
import { nodeId } from '../kernel/keys.js';
import { BUNDLE_FORMAT } from '../kernel/transport.js';

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
      const why = (e.stderr?.toString() || e.message).replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).pop();
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

export default function radicle(dest, { dir }) {
  const run = runner(dir, dest);
  const branch = dest.branch || 'main';
  const isRepo = () => { try { run('rad', ['.']); return true; } catch { return false; } };

  return {
    name: dest.name || 'radicle',

    async push(bundle) {
      if (!isRepo()) throw new Error('this entity is not a Radicle repository; run `entity radicle init`');
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
      }
      out.notes = notes;
      return out;
    },
  };
}
