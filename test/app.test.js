// The control panel: strangers are refused; a republic founded through it is
// the same as one founded in a terminal; and the terminal can now set passwords.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const status = (port, host, cookie) => new Promise((ok, no) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/info', headers: { host, cookie } }, (res) => { res.resume(); ok(res.statusCode); }); r.on('error', no); r.end(); });

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const until = async (f, ms = 15000) => { const t = Date.now(); for (;;) { try { const r = await f(); if (r) return r; } catch { /* not yet */ } if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 200)); } };

test('the control panel: refuses strangers; founds a republic exactly as the terminal does; manages it', { timeout: 180000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'app-home-')), keys = fs.mkdtempSync(path.join(os.tmpdir(), 'app-keys-'));
  const port = 17700 + Math.floor(Math.random() * 200), token = 'tok' + Math.random().toString(36).slice(2);
  const proc = spawn(process.execPath, [path.join(ROOT, 'cli', 'index.js'), 'app', '--port', String(port), '--home', home, '--no-open', '--token', token], { env: { ...process.env, ENTITY_KEYS: keys } });
  try {
    const U = `http://127.0.0.1:${port}`;
    await until(() => fetch(`${U}/api/info`).then(r => r.status === 401));
    const as = { headers: { cookie: `entity_app=${token}` } };
    const post = (p, b, headers = {}) => fetch(U + p, { method: 'POST', headers: { cookie: `entity_app=${token}`, 'content-type': 'application/json', 'x-entity-app': '1', ...headers }, body: JSON.stringify(b) });
    assert.equal((await fetch(`${U}/api/info`)).status, 401, 'no token, no panel');
    assert.equal(await status(port, `evil.example:${port}`, `entity_app=${token}`), 403, 'only this computer, by its own name');
    assert.equal(await status(port, `127.0.0.1:${port}`, `entity_app=${token}`), 200);
    assert.equal((await fetch(`${U}/api/create`, { method: 'POST', headers: { cookie: `entity_app=${token}` }, body: '{}' })).status, 403, 'a change needs the panel’s header');
    const made = await (await post('/api/create', { name: 'Panel Republic', folder: 'panel-republic', founder: 'ana', password: 'a long panel password', preset: 'worker-coop', modules: ['contracts'], settings: { 'deliberation.period': 9 }, serve: false })).json();
    assert.equal(made.ok, true, JSON.stringify(made));
    const dir = path.join(home, 'panel-republic'), cli = (...a) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...a], { cwd: dir, env: { ...process.env, ENTITY_KEYS: keys }, encoding: 'utf8' });
    assert.match(cli('verify'), /Verified/);
    const params = cli('params');
    assert.match(params, /deliberation\.period\s+9/); assert.match(params, /"contracts"/); assert.match(params, /"value"/, 'contracts brought value with it'); assert.match(params, /"passwords"/);
    assert.equal(fs.existsSync(path.join(dir, '.git')), false, 'no history copied'); assert.equal(fs.existsSync(path.join(dir, 'modules', 'titles', 'parameters.yml')), true);
    const p = await (await post('/api/r/panel-republic/propose', { as: 'ana', title: 'Longer', changes: { 'deliberation.period': 12 }, vote: true })).json();
    assert.match(p.out, /CARRIED, enacted/);
    assert.match(cli('params'), /deliberation\.period\s+12/, 'the terminal sees what the panel decided');
    assert.equal((await (await post('/api/r/panel-republic/run', { args: ['serve', '--port', '1'] })).json()).error, 'the panel does not run "serve"');
    const info = await (await fetch(`${U}/api/info`, as)).json();
    assert.equal(info.republics.find(r => r.folder === 'panel-republic').name, 'Panel Republic');
  } finally { proc.kill(); }
});

test('the terminal can set a password, as the page does', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), keys = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-keys-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/]\.git([\\/]|$)/.test(s.slice(ROOT.length)) });
  const env = { ...process.env, ENTITY_KEYS: keys };
  const cli = (a, e = {}) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...a], { cwd: dir, env: { ...env, ...e }, encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'presets', 't.yml'), 'modules: [deliberation, titles, vocabulary, passwords]\n');
  cli(['preset', 'apply', 't']); cli(['found', '--id', 'tim']);
  assert.throws(() => cli(['password', 'set', '--as', 'tim'], { ENTITY_NEW_PASSWORD: 'short' }), /12/);
  assert.match(cli(['password', 'set', '--as', 'tim', '--settle'], { ENTITY_NEW_PASSWORD: 'a long terminal password' }), /password\.set/);
  // and now the password signs: a title set with it, no key file needed
  assert.match(cli(['act', 'title.set', '--as', 'tim', '--title', 'Signed by password', '--password', '--settle'], { ENTITY_PASSWORD: 'a long terminal password' }), /settled/);
  assert.match(cli(['verify']), /Verified/);
});
