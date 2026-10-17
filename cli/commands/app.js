// entity app — the local control panel: create, run and look after republics
// from a browser, with no terminal needed.
//
//   entity app [--port 7700] [--home ~/entities] [--no-open]
//
// It listens on 127.0.0.1 only (never through a tunnel), and every request must
// carry the secret token printed at start, so neither other machines nor other
// websites open in your browser can use it. Every operation it offers runs the
// republic's own command line (node cli/index.js …) in that republic's folder:
// whatever the panel can do, the terminal can do, with the same result.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { out, refuse } from '../context.js';

const SRC = path.resolve(new URL('../..', import.meta.url).pathname);       // the code this panel runs from
const UI = path.join(SRC, 'interface', 'app');
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const NODE_KEYS = ['settleAfter', 'publishOnSettle', 'look', 'colour', 'modulesOnline', 'port', 'private'];
// Commands the panel may run; app and serve are handled by the panel itself.
const ALLOWED = new Set(['act', 'settle', 'verify', 'sync', 'propose', 'join', 'key', 'password', 'status', 'count', 'params', 'participants',
  'preset', 'attest', 'checkpoint', 'bundle', 'absorb', 'clone', 'diagnose', 'repair', 'module', 'finality', 'upgrade', 'fork', 'radicle', 'adopt', 'gate', 'build', 'dist']);

const isRepublic = (dir) => fs.existsSync(path.join(dir, 'cli', 'index.js')) && fs.existsSync(path.join(dir, 'kernel'));
const isFounded = (dir) => fs.existsSync(path.join(dir, 'record', 'events.jsonl'));

// Run the republic's own command line in its folder.
function run(dir, args, { env = {}, timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(dir, 'cli', 'index.js'), ...args], { cwd: dir, env: { ...process.env, ...env }, timeout, maxBuffer: 8 << 20 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}`.trim() }));
  });
}
function runCmd(cmd, args, cwd, timeout = 180000) {
  return new Promise((resolve) => execFile(cmd, args, { cwd, timeout, maxBuffer: 8 << 20 }, (err, so, se) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}`.trim() })));
}

async function readParamsFile(file) {
  const { loadDocument } = await import('../../kernel/parameters.js');
  try { return loadDocument(fs.readFileSync(file, 'utf8')).parameters || {}; } catch { return {}; }
}

// Every setting a republic with these modules would have: defaults, types, explanations.
async function catalog(modules) {
  const sets = [path.join(SRC, 'kernel', 'parameters.base.yml')];
  for (const m of modules) for (const base of ['modules', 'library']) { const f = path.join(SRC, base, m, 'parameters.yml'); if (fs.existsSync(f)) { sets.push(f); break; } }
  const outp = {};
  for (const f of sets) for (const [k, d] of Object.entries(await readParamsFile(f))) outp[k] = { key: k, value: d.value, type: d.type || typeof d.value, one_of: d.one_of || null, min: d.min ?? null, max: d.max ?? null, describe: d.describe || '', group: d.group || (k.split('.')[0]), changed_by: d.changed_by || null };
  return Object.values(outp);
}

function about(dir) {
  try { const src = fs.readFileSync(path.join(dir, 'index.js'), 'utf8'); const m = src.match(/^\/\/\s*[a-z-]+\s*·\s*(.+)$/m) || src.match(/^\/\/\s*(.+)$/m); return m ? m[1].trim() : ''; } catch { return ''; }
}
function modulesList() {
  const lib = path.join(SRC, 'library');
  const core = ['deliberation', 'titles', 'vocabulary'];
  return [...core.map(n => ({ name: n, core: true, about: about(path.join(SRC, 'modules', n)) })),
    ...(fs.existsSync(lib) ? fs.readdirSync(lib).filter(n => fs.existsSync(path.join(lib, n, 'index.js'))).sort().map(n => ({ name: n, about: about(path.join(lib, n)), needs: n === 'contracts' ? ['value'] : n === 'fund' ? ['value'] : [] })) : [])];
}

async function presets() {
  const dir = path.join(SRC, 'presets');
  const outp = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yml')).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const aboutText = (text.match(/^_:\s*([\s\S]*?)\n(?=\S)/m)?.[1] || '').replace(/\s+/g, ' ').trim();
    const mods = (text.match(/^modules:\s*\[([\s\S]*?)\]/m)?.[1] || '').split(',').map(s => s.trim()).filter(Boolean);
    const set = {};
    const block = text.split(/^set:\s*$/m)[1];
    if (block) for (const line of block.split('\n')) { const m = line.match(/^  ([a-z_.]+):\s*(.+)$/); if (m) { try { set[m[1]] = JSON.parse(m[2]); } catch { set[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } else if (/^\S/.test(line)) break; }
    outp.push({ name: f.replace(/\.yml$/, ''), about: aboutText, modules: mods, set });
  }
  return outp;
}

function summary(home, name, served) {
  const dir = path.join(home, name);
  const r = { folder: name, founded: isFounded(dir), served: served.get(name) ? { port: served.get(name).port, url: `http://localhost:${served.get(name).port}/` } : null };
  try { r.node = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8')); } catch { r.node = {}; }
  if (r.founded) {
    const lines = fs.readFileSync(path.join(dir, 'record', 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
    r.records = lines.length;
    try { const first = JSON.parse(lines[0]); r.id = first.payload?.act?.entity || first.entity || null; } catch { r.id = null; }
    try { r.last = JSON.parse(lines[lines.length - 1]).at; } catch { /* */ }
    const p = fs.readFileSync(path.join(dir, 'parameters.yml'), 'utf8');
    r.name = (p.match(/entity\.name:\s*\n\s*value:\s*(.+)/)?.[1] || name).replace(/^["']|["']$/g, '');
    r.radicle = (r.node.destinations || []).some(d => /rad/.test(JSON.stringify(d)));
  }
  try { r.version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { /* */ }
  return r;
}

export async function app({ opt }) {
  const port = Number(opt.port || 7700);
  const home = path.resolve(opt.home || (fs.existsSync(path.join(os.homedir(), 'entities')) ? path.join(os.homedir(), 'entities') : path.dirname(SRC)));
  fs.mkdirSync(home, { recursive: true });
  const token = opt.token || crypto.randomBytes(24).toString('hex');
  const served = new Map();       // folder → { proc, port, log }

  const send = (res, code, body, type = 'application/json', extra = {}) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const body = (req) => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); });
  const dirOf = (name) => { if (!SLUG.test(name || '')) throw new Error('a folder name is lowercase letters, digits and -'); const d = path.join(home, name); if (!isRepublic(d)) throw new Error(`there is no republic in ${d}`); return d; };

  function startServing(name, p) {
    if (served.get(name)) return served.get(name);
    const dir = dirOf(name);
    const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--settle', '--port', String(p)], { cwd: dir, env: process.env });
    const s = { proc, port: p, log: [] };
    const keep = (d) => { s.log.push(...String(d).split('\n').filter(Boolean)); s.log = s.log.slice(-200); };
    proc.stdout.on('data', keep); proc.stderr.on('data', keep);
    proc.on('exit', (c) => { keep(`(stopped${c ? `, code ${c}` : ''})`); if (served.get(name) === s) served.delete(name); });
    served.set(name, s);
    return s;
  }

  async function create(b) {
    const log = [];
    const step = async (what, p) => { const r = await p; log.push({ what, ...r }); if (r.code) throw Object.assign(new Error(`${what} failed`), { log }); return r; };
    if (!SLUG.test(b.folder || '')) throw new Error('choose a folder name: lowercase letters, digits and -');
    if (!SLUG.test(b.founder || '')) throw new Error('choose your member id: lowercase letters, digits and -');
    if (!b.name?.trim()) throw new Error('give the republic a name');
    const dir = path.join(home, b.folder);
    if (fs.existsSync(dir)) throw new Error(`${dir} already exists: choose another folder name`);
    const all = await presets();
    const pre = all.find(p => p.name === b.preset) || all.find(p => p.name === 'assembly');
    const modules = [...new Set([...pre.modules, ...(b.modules || []), ...(b.password ? ['passwords'] : [])])];
    for (const m of modules) for (const need of (modulesList().find(x => x.name === m)?.needs || [])) if (!modules.includes(need)) modules.push(need);
    if (b.password) { const { passwordProblem } = await import('../../kernel/password.js'); const why = passwordProblem(b.password, b.founder); if (why) throw new Error(why); }
    // 1 · the code, copied beside the record-to-be
    // Everything but state: no record, no settings of its own, no node settings, no git history.
    const skip = new Set(['/.git', '/.staged', '/record', '/node_modules', '/parameters.yml', '/node.json']);
    fs.cpSync(SRC, dir, { recursive: true, filter: (s) => !skip.has(s.slice(SRC.length).replace(/\\/g, '/')) });
    log.push({ what: `copied the code to ${dir}`, code: 0, out: '' });
    // 2 · the preset, with your choices
    const set = { ...pre.set, ...(b.settings || {}) };
    const yml = [`_: Made with entity app from the ${pre.name} preset.`, `modules: [${modules.join(', ')}]`, 'set:', ...Object.entries(set).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'presets', '_chosen.yml'), yml);
    await step('composed the settings', run(dir, ['preset', 'apply', '_chosen']));
    await step('founded the republic', run(dir, ['found', '--id', b.founder, '--name', b.name.trim()]));
    if (b.password) await step('set your password', run(dir, ['password', 'set', '--as', b.founder, '--settle'], { env: { ENTITY_NEW_PASSWORD: b.password } }));
    const node = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8'));
    Object.assign(node, { settleAfter: 0, look: b.look || 'minimal', colour: b.colour || 'dark', ...(b.port ? { port: Number(b.port) } : {}) });
    fs.writeFileSync(path.join(dir, 'node.json'), JSON.stringify(node, null, 2) + '\n');
    await step('checked the record', run(dir, ['verify']));
    let url = null;
    if (b.serve !== false) { const s = startServing(b.folder, Number(b.port || 7780)); url = `http://localhost:${s.port}/`; log.push({ what: `serving it at ${url}`, code: 0, out: '' }); }
    return { ok: true, folder: b.folder, url, log };
  }

  const server = http.createServer(async (req, res) => {
    try {
      // Only this machine, by its own name (no DNS rebinding), with the token.
      const host = String(req.headers.host || '');
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, 'This panel answers only on this computer.', 'text/plain');
      const url = new URL(req.url, `http://${host}`);
      const cookie = (String(req.headers.cookie || '').match(/(?:^|;\s*)entity_app=([A-Za-z0-9]+)/) || [])[1];
      if (url.searchParams.get('t') === token) return send(res, 302, '', 'text/plain', { location: '/', 'set-cookie': `entity_app=${token}; Path=/; HttpOnly; SameSite=Strict` });
      if (cookie !== token) return send(res, 401, `<!doctype html><meta charset=utf-8><title>entity app</title><body style="font:15px system-ui;background:#111;color:#ddd;padding:3rem">Open the link the panel printed when it started (it ends in ?t=…). Run <code>entity app</code> again to get a new one.</body>`, 'text/html; charset=utf-8');
      const p = url.pathname;
      if (!p.startsWith('/api/')) {
        const f = path.join(UI, p === '/' ? 'index.html' : p.slice(1));
        if (!f.startsWith(UI) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
        const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream';
        return send(res, 200, fs.readFileSync(f), type, { 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
      }
      if (req.method !== 'GET' && req.headers['x-entity-app'] !== '1') return send(res, 403, { error: 'refused' });

      if (p === '/api/info') {
        const names = fs.readdirSync(home).filter(n => SLUG.test(n) && isRepublic(path.join(home, n)) && n !== path.basename(SRC));
        return send(res, 200, { home, source: SRC, version: JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version, republics: names.map(n => summary(home, n, served)), rad: await runCmd('rad', ['--version'], home, 5000).then(r => !r.code).catch(() => false) });
      }
      if (p === '/api/presets') return send(res, 200, await presets());
      if (p === '/api/modules') return send(res, 200, modulesList());
      if (p === '/api/catalog') return send(res, 200, await catalog((url.searchParams.get('modules') || '').split(',').filter(Boolean)));
      if (p === '/api/create' && req.method === 'POST') {
        try { return send(res, 200, await create(await body(req))); } catch (e) { return send(res, 400, { error: e.message, log: e.log || [] }); }
      }
      if (p === '/api/clone' && req.method === 'POST') {
        const b = await body(req);
        if (!/^rad:z[1-9A-HJ-NP-Za-km-z]+$/.test(b.rid || '')) return send(res, 400, { error: 'a Radicle id looks like rad:z…' });
        if (!SLUG.test(b.folder || '') || fs.existsSync(path.join(home, b.folder))) return send(res, 400, { error: 'choose a new folder name: lowercase letters, digits and -' });
        const r = await runCmd('rad', ['clone', b.rid, b.folder, ...(b.seed ? ['--seed', b.seed] : [])], home);
        return send(res, r.code ? 400 : 200, r.code ? { error: 'rad clone failed', out: r.out } : { ok: true, out: r.out });
      }
      const m = p.match(/^\/api\/r\/([a-z0-9-]+)\/(run|serve|stop|node|log|settings|propose)$/);
      if (m) {
        const [, name, what] = m, dir = dirOf(name);
        if (what === 'log') return send(res, 200, { log: served.get(name)?.log || [] });
        if (what === 'settings') {
          const values = await readParamsFile(path.join(dir, 'parameters.yml'));
          const mods = values['entity.modules']?.value || [];
          const cat = await catalog(mods);
          return send(res, 200, cat.map(c => ({ ...c, current: values[c.key]?.value ?? c.value })));
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'POST' });
        const b = await body(req);
        if (what === 'serve') { const s = startServing(name, Number(b.port || summary(home, name, served).node.port || 7780)); await new Promise(r => setTimeout(r, 800)); return send(res, 200, { ok: true, url: `http://localhost:${s.port}/`, log: s.log }); }
        if (what === 'stop') { served.get(name)?.proc.kill(); served.delete(name); return send(res, 200, { ok: true }); }
        if (what === 'node') {
          const f = path.join(dir, 'node.json'); const n = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
          for (const [k, v] of Object.entries(b.settings || {})) if (NODE_KEYS.includes(k)) { if (v === null || v === '') delete n[k]; else n[k] = v; }
          fs.writeFileSync(f, JSON.stringify(n, null, 2) + '\n');
          return send(res, 200, { ok: true, node: n });
        }
        if (what === 'propose') {
          // A settings change or effects, laid as a proposal; voted for at once if asked (a founder alone carries it).
          const args = ['propose', '--as', String(b.as || ''), '--title', String(b.title || 'Change settings')];
          if (b.changes) args.push('--changes', JSON.stringify(b.changes));
          if (b.effects) args.push('--effects', JSON.stringify(b.effects));
          const r1 = await run(dir, args);
          const id = (r1.out.match(/d-[0-9a-f]{12}/) || [])[0];
          if (r1.code || !id) return send(res, 400, { error: 'the proposal was refused', out: r1.out });
          await run(dir, ['settle']);
          let r2 = { out: '' };
          if (b.vote) { r2 = await run(dir, ['act', 'ballot.cast', '--proposal', id, '--choice', 'for', '--as', String(b.as), '--settle']); }
          const r3 = await run(dir, ['count', id]);
          return send(res, 200, { ok: true, id, out: [r1.out, r2.out, r3.out].filter(Boolean).join('\n') });
        }
        if (what === 'run') {
          const args = Array.isArray(b.args) ? b.args.map(String) : [];
          if (!ALLOWED.has(args[0])) return send(res, 400, { error: `the panel does not run "${args[0]}"` });
          const env = b.newPassword ? { ENTITY_NEW_PASSWORD: String(b.newPassword) } : {};
          const r = await run(dir, args, { env });
          return send(res, 200, r);
        }
      }
      return send(res, 404, { error: 'no such thing' });
    } catch (e) { return send(res, 500, { error: e.message }); }
  });

  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); }).catch((e) => refuse(e.code === 'EADDRINUSE' ? `port ${port} is in use: entity app --port 7701` : e.message));
  const link = `http://127.0.0.1:${port}/?t=${token}`;
  out(`The control panel is at ${link}`);
  out(`It answers only on this computer. Republics live in ${home}. Ctrl-C stops it, and every republic it started.`);
  if (!opt['no-open'] && !opt.noOpen) { const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'; try { spawn(opener, [link], { stdio: 'ignore', detached: true }).unref(); } catch { /* print only */ } }
  const stop = () => { for (const s of served.values()) s.proc.kill(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return new Promise(() => {});
}
