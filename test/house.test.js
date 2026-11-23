// House access (node.json "house", cli/house.js): the house network and the
// house password let a visitor read a private hub and make an account; its
// admins change its name, password, networks and admins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { keys } from '../kernel/index.js';
import * as H from '../cli/house.js';
import { entityOnDisk } from './helpers.js';

test('house: addresses, networks and who is asking', () => {
  assert.ok(H.inCidr('10.4.0.37', '10.0.0.0/8'));
  assert.ok(H.inCidr('172.20.1.1', '172.16.0.0/12'));
  assert.ok(!H.inCidr('172.32.0.1', '172.16.0.0/12'));
  assert.ok(H.inCidr('203.0.113.7', '203.0.113.7'));
  assert.ok(!H.inCidr('203.0.113.8', '203.0.113.7'));
  assert.ok(H.inCidr('2001:db8:1:2:abcd::5', '2001:db8:1:2::/64'));
  assert.ok(!H.inCidr('2001:db8:1:3::5', '2001:db8:1:2::/64'));
  assert.ok(H.inCidr('fd00::9', 'fc00::/7'));
  assert.ok(!H.inCidr('10.0.0.1', 'fc00::/7'), 'v4 never matches a v6 network');
  assert.equal(H.plainIp('::ffff:10.1.2.3'), '10.1.2.3');
  for (const bad of ['10.0.0.0/33', 'nonsense', '300.1.1.1', '', '1.2.3.4/x']) assert.equal(H.validCidr(bad), false, bad);
  // The tunnel's visitor address is believed only from this machine.
  const req = (remote, cf) => ({ socket: { remoteAddress: remote }, headers: cf ? { 'cf-connecting-ip': cf } : {} });
  assert.deepEqual(H.clientIp(req('127.0.0.1', '203.0.113.7')), { ip: '203.0.113.7', via: 'tunnel' });
  assert.deepEqual(H.clientIp(req('::ffff:198.51.100.4', '203.0.113.7')), { ip: '198.51.100.4', via: 'direct' }, 'a stranger cannot claim the house address');
  assert.deepEqual(H.clientIp(req('127.0.0.1')), { ip: '127.0.0.1', via: 'local' });
  assert.deepEqual(H.clientIp(req('::ffff:10.0.4.2')), { ip: '10.0.4.2', via: 'direct' });
});

test('house: the password is never kept in clear; the cookie dies with the password', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'house-'));
  const h = { password: H.hashPassword('mellon friend 1') };
  assert.ok(!JSON.stringify(h).includes('mellon'));
  assert.ok(H.checkPassword(h, 'mellon friend 1'));
  assert.ok(!H.checkPassword(h, 'mellon friend 2'));
  const c = H.makeCookie(dir, h);
  assert.ok(H.cookieValid(dir, h, c.value));
  assert.ok(!H.cookieValid(dir, h, c.value.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A'))), 'a changed mac');
  const h2 = { password: { ...H.hashPassword('another one 22'), set: new Date(Date.now() + 1000).toISOString() } };
  assert.ok(!H.cookieValid(dir, h2, c.value), 'a new password ends the old cookies');
  assert.match(H.passwordProblem('short'), /at least 8/);
});

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('house: a private hub opens to the house network and the house password, and only admins change it', async () => {
  const dir = await entityOnDisk({ preset: 'assembly', people: 2 });
  const nodeFile = path.join(dir, 'node.json');
  const node = fs.existsSync(nodeFile) ? JSON.parse(fs.readFileSync(nodeFile, 'utf8')) : {};
  fs.writeFileSync(nodeFile, JSON.stringify({ ...node, private: true,
    house: { name: 'The Test Minihub', admins: ['p-0001'], networks: H.DEFAULT_NETWORKS, publicIps: ['203.0.113.7'], detect: false, password: H.hashPassword('mellon friend 1') } }));
  const entity = fs.readdirSync(process.env.ENTITY_KEYS).find(n => n.startsWith('e-'));
  const { loadKey } = await import('../cli/context.js');
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--port', String(port)], { cwd: dir, env: process.env });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  try {
    await new Promise((ok) => { const t = setInterval(() => { if (log.includes('served')) { clearInterval(t); ok(); } }, 50); setTimeout(() => { clearInterval(t); ok(); }, 5000); });
    const base = `http://127.0.0.1:${port}/`;
    const get = (p, h = {}) => fetch(base + p, { headers: h, redirect: 'manual' });
    const post = async (p, b, h = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b), redirect: 'manual' }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) }; };
    const house = { 'cf-connecting-ip': '203.0.113.7' }, stranger = { 'cf-connecting-ip': '198.51.100.9' };

    // Strangers see the sign-in page and its brand; the house's address goes straight in.
    assert.equal((await get('', stranger)).status, 302);
    assert.equal((await get('record/events.jsonl', stranger)).status, 401);
    assert.deepEqual(await (await get('signin/brand', stranger)).json(), { name: 'The Test Minihub' });
    const st = await (await get('house/status', stranger)).json();
    assert.equal(st.house, true); assert.equal(st.access, null); assert.equal(st.password, true); assert.equal(st.admin, false);
    assert.equal((await get('', house)).status, 200);
    assert.equal((await get('record/events.jsonl', house)).status, 200);
    assert.equal((await (await get('house/status', house)).json()).access, 'network');
    // A direct connection from the house Wi-Fi's own range (this machine's LAN address, if it has one).
    const lan = Object.values((await import('node:os')).networkInterfaces()).flat().find(i => i && !i.internal && i.family === 'IPv4' && H.DEFAULT_NETWORKS.some(c => H.inCidr(i.address, c)));
    if (lan) assert.equal((await fetch(`http://${lan.address}:${port}/record/events.jsonl`, { redirect: 'manual' })).status, 200, 'on the house network');

    // Joining: only from the house.
    assert.equal((await post('auth/apply', { kind: 'participant.apply' }, stranger)).status, 403);
    assert.notEqual((await post('auth/apply', { kind: 'nonsense' }, house)).status, 403);

    // The house password: a wrong one is refused; the right one gives a cookie that opens the hub.
    assert.equal((await post('auth/house', { password: 'wrong guess 99' }, stranger)).status, 401);
    const ok = await post('auth/house', { password: 'mellon friend 1' }, stranger);
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await get('record/events.jsonl', { ...stranger, cookie })).status, 200);
    assert.equal((await (await get('house/status', { ...stranger, cookie })).json()).access, 'password');
    assert.equal((await get('record/events.jsonl', { ...stranger, cookie: cookie.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')) })).status, 401, 'a forged cookie');

    // Settings: only an admin, signed in as themselves.
    assert.equal((await get('house/config', { ...stranger, cookie })).status, 401);
    const s = await get('house/settings', house);
    assert.equal(s.status, 302); assert.match(s.headers.get('location'), /signin\?next=/);
    const signIn = async (id) => {
      const { body: c } = await post('auth/challenge', {});
      const sig = await keys.sign(`entity.signin\n${entity}\n${c.challenge}`, loadKey(entity, id), 'entity.signin');
      const r = await post('auth/verify', { id, challenge: c.challenge, signature: sig });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.headers.get('set-cookie').split(';')[0];
    };
    const admin = await signIn('p-0001'), other = await signIn('p-0002');
    assert.equal((await get('house/config', { cookie: other })).status, 403, 'a member who is not an admin');
    assert.equal((await get('house/settings', { cookie: other })).status, 403);
    const page = await get('house/settings', { cookie: admin });
    assert.equal(page.status, 200); assert.match(await page.text(), /House settings/);
    const cfg = await (await get('house/config', { cookie: admin })).json();
    assert.equal(cfg.name, 'The Test Minihub'); assert.deepEqual(cfg.admins, ['p-0001']); assert.ok(!JSON.stringify(cfg).includes('hash'), 'no password hash leaves the node');
    assert.equal((await (await get('house/status', { cookie: admin })).json()).admin, true);

    assert.equal((await post('house/config', { name: 'Lothlórien Unofficial Minihub' }, { cookie: admin })).status, 200);
    assert.deepEqual(await (await get('signin/brand')).json(), { name: 'Lothlórien Unofficial Minihub' });
    assert.match((await post('house/config', { password: 'short' }, { cookie: admin })).body.why, /at least 8/);
    assert.match((await post('house/config', { admins: [] }, { cookie: admin })).body.why, /at least one admin/);
    assert.match((await post('house/config', { admins: ['p-0001', 'nobody'] }, { cookie: admin })).body.why, /not an active member/);
    assert.match((await post('house/config', { publicIps: ['not an address'] }, { cookie: admin })).body.why, /not an address/);
    assert.equal((await post('house/config', { admins: ['p-0001', 'p-0002'] }, { cookie: admin })).status, 200);
    assert.equal((await get('house/config', { cookie: other })).status, 200, 'now an admin');

    // A new password: the old cookie no longer opens anything; the new password does.
    assert.equal((await post('house/config', { password: 'a new password 2' }, { cookie: admin })).status, 200);
    assert.equal((await get('record/events.jsonl', { ...stranger, cookie })).status, 401);
    assert.equal((await post('auth/house', { password: 'mellon friend 1' }, stranger)).status, 401);
    assert.equal((await post('auth/house', { password: 'a new password 2' }, stranger)).status, 200);
    // The house's address can be listed by hand, and removed.
    assert.equal((await post('house/config', { publicIps: [] }, { cookie: admin })).status, 200);
    assert.equal((await get('record/events.jsonl', house)).status, 401, 'no longer the house');
    // Ten wrong passwords from one place, then a pause.
    for (let i = 0; i < 10; i++) await post('auth/house', { password: `wrong ${i} guess` }, { 'cf-connecting-ip': '192.0.2.50' });
    assert.equal((await post('auth/house', { password: 'a new password 2' }, { 'cf-connecting-ip': '192.0.2.50' })).status, 429);
    // Nothing secret was written in clear.
    assert.ok(!fs.readFileSync(nodeFile, 'utf8').includes('a new password 2'));
  } finally { proc.kill(); }
});
