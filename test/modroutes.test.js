// A module's own routes (cli/modroutes.js), node.json "readers" (who may read
// the record) and a site's own sign-in page, on a private house hub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT, tmp } from './helpers.js';
import * as H from '../cli/house.js';

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('module routes: the house reads what the module shows; the record is for its readers alone', async () => {
  const dir = tmp('modroutes-');
  const { copyCode } = await import('../cli/commands/dist.js');
  copyCode(ROOT, dir);
  fs.cpSync(path.join(ROOT, 'library'), path.join(dir, 'library'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'presets', 'm.yml'), '_: Module routes.\n\nmodules: [deliberation, wiki, notify, offices, authority, minihub]\n\nset:\n  entity.name: The Route Test\n  decision.electorate: founder\n');
  const env = { ...process.env, ENTITY_KEYS: tmp('modroutes-keys-') };
  const cli = (args) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  cli(['preset', 'apply', 'm']); cli(['found', '--id', 'p-0001']);
  cli(['act', 'wiki.edit', '--as', 'p-0001', '--page', 'kitchen', '--title', 'Kitchen', '--base', '0', '--body', 'Clean as you go.', '--settle']);
  fs.mkdirSync(path.join(dir, 'site'));
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), '<!doctype html><title>own site</title>');
  fs.writeFileSync(path.join(dir, 'site', 'signin.html'), '<!doctype html><title>own sign-in</title>');
  fs.writeFileSync(path.join(dir, 'site', 'site.css'), 'body{}');
  const n = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'node.json'), JSON.stringify({ ...n, private: true, site: 'site', site_open: ['site.css'], readers: ['founder'],
    house: { name: 'The Route Test', admins: ['founder'], networks: H.DEFAULT_NETWORKS, publicIps: ['203.0.113.7'], detect: false, password: H.hashPassword('mellon friend 1') } }));
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--settle', '--port', String(port)], { cwd: dir, env });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  try {
    await new Promise((ok) => { const t = setInterval(() => { if (log.includes('served')) { clearInterval(t); ok(); } }, 50); setTimeout(() => { clearInterval(t); ok(); }, 5000); });
    const get = (p, h = {}) => fetch(`http://127.0.0.1:${port}/${p}`, { headers: h, redirect: 'manual' });
    const house = { 'cf-connecting-ip': '203.0.113.7' }, stranger = { 'cf-connecting-ip': '198.51.100.9' };
    assert.equal((await get('m/minihub/wiki', stranger)).status, 401, 'the gate runs first');
    assert.match(await (await get('signin', stranger)).text(), /own sign-in/, 'the site brings its own sign-in page');
    assert.equal((await get('site.css', stranger)).status, 200, 'site_open files are served before sign-in');
    assert.match(await (await get('', house)).text(), /own site/);
    const pages = await (await get('m/minihub/wiki', house)).json();
    assert.deepEqual(pages.pages.map(p => p.id), ['kitchen']);
    assert.equal((await (await get('m/minihub/wiki/kitchen', house)).json()).body, 'Clean as you go.');
    const me = await (await get('m/minihub/me', house)).json();
    assert.equal(me.house, true); assert.equal(me.member, null); assert.equal(me.admin, false);
    assert.equal((await get('m/minihub/alerts', house)).status, 403, 'alerts are for members');
    assert.equal((await get('m/minihub/admin', house)).status, 403);
    assert.equal((await get('record/events.jsonl', house)).status, 403, 'the record is for its readers');
    assert.equal((await get('bundle', house)).status, 403);
    assert.equal((await get('m/nosuch/thing', house)).status, 404);
    assert.equal((await get('m/minihub/nothing-here', house)).status, 404);
  } finally { proc.kill(); }
});

test('house: admins and readers may follow an office in the record', () => {
  const at = '2026-11-23T00:00:00Z';
  const state = { entity: { founder: 'a' }, participants: { a: { status: 'active' }, b: { status: 'active' }, c: { status: 'left' } },
    m: { offices: { admin: { holders: [{ id: 'b' }, { id: 'c' }, { id: 'a', until: '2026-01-01T00:00:00Z' }] } } } };
  assert.equal(H.inSpec(['office:admin'], state, 'b', at), true);
  assert.equal(H.inSpec(['office:admin'], state, 'a', at), false, 'a term that ended');
  assert.equal(H.inSpec(['office:admin'], state, 'c', at), false, 'only active members');
  assert.equal(H.inSpec(['founder'], state, 'a', at), true);
  assert.equal(H.isAdmin({ admins: ['office:admin'] }, state, 'b'), true);
  state.m.notifys = { admins: ['a'] };
  assert.equal(H.inSpec(['m:notifys.admins'], state, 'a', at), true, 'a list a module keeps');
  assert.equal(H.inSpec(['m:notifys.admins'], state, 'b', at), false);
  assert.equal(H.inSpec(['m:nothing.here'], state, 'a', at), false);
});
