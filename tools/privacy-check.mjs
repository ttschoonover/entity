#!/usr/bin/env node
// privacy-check.mjs · what each republic on this machine shows to people who
// are not its members. Reads only: it changes no file, signs nothing, and
// sends nothing but GET requests to the republics' own addresses.
//
//   node tools/privacy-check.mjs [ENTITIES_DIR] [--online] [--cloudflared FILE]
//
//   ENTITIES_DIR     where the republics live (default ~/entities)
//   --online         also ask each public hostname (from the Cloudflare tunnel's
//                    config) for its record, as a stranger would
//   --cloudflared    the tunnel's config (default ~/.cloudflared/config.yml)
//
// For each republic it reports: whether the node asks for sign-in (node.json
// "private"), whether its Radicle copy is public or private, what git would
// publish, other git remotes, and whether the record answers a stranger.
// See docs/PRIVACY-AUDIT.md for what each finding means. Exits 1 if any
// republic has a finding marked HIGH.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as yaml from '../kernel/yaml.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const HOME = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--cloudflared') || path.join(os.homedir(), 'entities'));
const CF = opt('--cloudflared', path.join(os.homedir(), '.cloudflared', 'config.yml'));
const ONLINE = flag('--online');
// Modules whose acts say something a group would usually keep to itself.
const SENSITIVE = ['fund', 'shares', 'budget', 'endowment', 'loans', 'lending', 'things', 'sealed', 'agreements', 'partnership', 'disputes', 'contracts', 'twofactor'];

const run = (cmd, argv, cwd) => {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8', timeout: 20000 });
  return r.error || r.status !== 0 ? null : (r.stdout || '').trim();
};
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// The tunnel's hostnames, by local port: "hostname: X" followed by "service: http://localhost:PORT".
function tunnelHosts() {
  const map = new Map();
  let text = ''; try { text = fs.readFileSync(CF, 'utf8'); } catch { return map; }
  let host = null;
  for (const line of text.split('\n')) {
    const h = line.match(/hostname:\s*(\S+)/); if (h) { host = h[1]; continue; }
    const s = line.match(/service:\s*https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
    if (s && host) { map.set(Number(s[1]), [...(map.get(Number(s[1])) || []), host]); host = null; }
  }
  return map;
}

function settings(dir) {
  try {
    const doc = yaml.parse(fs.readFileSync(path.join(dir, 'parameters.yml'), 'utf8')) || {};
    const v = (k) => doc.parameters?.[k]?.value;
    return { name: v('entity.name') || path.basename(dir), modules: v('entity.modules') || [], admission: v('membership.admission') };
  } catch { return { name: path.basename(dir), modules: [], admission: undefined }; }
}

function radicleVisibility(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return 'not a git repository';
  if (!run('rad', ['--version'], dir)) return 'unknown (rad not installed)';
  const v = run('rad', ['inspect', '--visibility'], dir);
  if (v) { const m = v.match(/\b(public|private)\b/i); if (m) return m[1].toLowerCase(); }
  const id = run('rad', ['inspect', '--identity'], dir) || run('rad', ['inspect', '--payload'], dir);
  if (id) { const m = id.match(/"visibility"\s*:\s*\{?\s*"?(?:type"?\s*:\s*"?)?(public|private)/i); if (m) return m[1].toLowerCase(); }
  return run('rad', ['.'], dir) ? 'unknown (check: rad ls)' : 'not on Radicle';
}

async function probe(url) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'entity-privacy-check' } });
    const head = r.status === 200 ? (await r.text()).slice(0, 65536) : '';
    return { status: r.status, records: r.status === 200 && /"seq":\d+/.test(head) };
  } catch (x) { return { status: null, why: x.cause?.code || x.name }; }
}

const republics = fs.existsSync(HOME) ? fs.readdirSync(HOME, { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => path.join(HOME, d.name))
  .filter(d => fs.existsSync(path.join(d, 'record', 'events.jsonl')) && fs.existsSync(path.join(d, 'cli', 'index.js'))) : [];
if (!republics.length) { console.log(`No founded republics in ${HOME}.`); process.exit(0); }

const hosts = tunnelHosts();
let high = 0;
console.log(`Privacy check · ${republics.length} republic(s) in ${HOME}${hosts.size ? ` · tunnel config ${CF}` : ' · no tunnel config found'}\n`);

for (const dir of republics) {
  const node = readJson(path.join(dir, 'node.json')) || {};
  const s = settings(dir);
  const priv = node.private === true;
  const rad = radicleVisibility(dir);
  const sensitive = s.modules.filter(m => SENSITIVE.includes(m));
  const findings = [];
  const add = (level, text) => { findings.push([level, text]); if (level === 'HIGH') high++; };

  // F1 / F2 · the node and the Radicle copy disagree, or a sensitive republic is open.
  if (!priv && rad === 'private') add('HIGH', 'Radicle copy is private but the node is public: anyone can read the record at its web address (F1).');
  if (priv && rad === 'public') add('HIGH', 'node asks for sign-in but the Radicle copy is public: the whole record replicates to anyone (F2).');
  if (!priv && sensitive.length) add(rad === 'public' || rad === 'private' ? 'HIGH' : 'WARN', `public node with sensitive modules (${sensitive.join(', ')}): their acts are readable by anyone (F1).`);
  if (s.modules.includes('sealed')) add('INFO', 'sealed posts: bodies are encrypted, titles and authors are not (F5).');

  // F6 · what git publishes: the record, and also unsettled acts (pending/,
  // which peers read to settle them), media/ and letters/. Private on Radicle,
  // that stays among members; public, it is public with each settlement.
  if (fs.existsSync(path.join(dir, '.git'))) {
    const extra = ['pending/', 'media/', 'letters/'].filter(p => fs.existsSync(path.join(dir, p)));
    if (rad === 'public' && extra.length && (priv || sensitive.length)) add('HIGH', `public on Radicle: ${extra.join(', ')} go out with every settlement, alongside the record (F6).`);
    const remotes = (run('git', ['remote', '-v'], dir) || '').split('\n').map(l => l.split(/\s+/)).filter(([n, u]) => n && u && n !== 'rad' && !u.startsWith('rad:'));
    const named = [...new Set(remotes.map(([n, u]) => `${n} → ${u}`))];
    if (named.length) add('WARN', `other git remotes: ${named.join('; ')}. Anything pushed there leaves the members' hands.`);
  }

  // F13 · email without encryption.
  if (node.mail?.host && node.mail.starttls === false && !(node.mail.secure ?? Number(node.mail.port || 465) === 465)) add('WARN', 'email is sent without TLS (mail.starttls is false) (F13).');
  if (node.modulesOnline !== false && priv) add('INFO', 'GET /modules/available answers strangers and makes this node fetch from its module source (F9).');

  // Does the record answer a stranger?
  const port = Number(node.port || 0);
  const local = port ? await probe(`http://127.0.0.1:${port}/record/events.jsonl`) : { status: null, why: 'no port in node.json' };
  if (local.records) add(priv ? 'HIGH' : (sensitive.length ? 'HIGH' : 'INFO'), `the running node gives its record to anyone who asks (port ${port}).`);
  // F4 · does the running node send the security headers yet? Each republic
  // runs its own copy of the code, which changes only when its core upgrade carries.
  if (local.status) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/${priv ? 'signin' : ''}`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      if (!r.headers.get('content-security-policy') && !r.headers.get('content-security-policy-report-only')) add('WARN', 'the running node sends no Content Security Policy: its code predates the security headers. It gets them when its core upgrade carries (update-republics.sh) and the node restarts (F4).');
    } catch { /* not answering: reported above */ }
  }
  const names = hosts.get(port) || [];
  const online = [];
  if (ONLINE) for (const h of names) {
    const r = await probe(`https://${h}/record/events.jsonl`);
    online.push(`${h}: ${r.status ?? r.why}${r.records ? ' (records visible)' : ''}`);
    if (r.records && (priv || sensitive.length || rad === 'private')) add('HIGH', `https://${h}/record/events.jsonl is readable by anyone on the internet.`);
  }

  console.log(`■ ${s.name}  (${path.basename(dir)})`);
  console.log(`  node: ${priv ? 'private (sign-in required)' : 'public'} · Radicle: ${rad} · admission: ${s.admission ?? '?'} · modules: ${s.modules.join(', ') || '?'}`);
  console.log(`  local node: ${local.status ? `${local.status}${local.records ? ' (records visible)' : ''}` : `not running (${local.why})`}${names.length ? ` · hostnames: ${names.join(', ')}` : ''}`);
  if (online.length) console.log(`  online: ${online.join('; ')}`);
  for (const [level, text] of findings) console.log(`  ${level.padEnd(4)} ${text}`);
  if (!findings.length) console.log('  ok   nothing found');
  console.log('');
}

console.log('Not checked from here: what the Cloudflare tunnel itself sees (everything, in plaintext: F3),');
console.log('the /status ticker on the main site (F10), and members\' own devices.');
process.exit(high ? 1 : 0);
