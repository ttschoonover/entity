// Security headers and the private node's sign-in wall (docs/PRIVACY-AUDIT.md,
// F4 and F7–F9): what a stranger can and cannot learn from a members-only node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { keys } from '../kernel/index.js';
import { scanHtml, policy, securityHeaders } from '../cli/security.js';
import { entityOnDisk } from './helpers.js';

const hashOf = async (s) => `'sha256-${(await import('node:crypto')).createHash('sha256').update(s).digest('base64')}'`;

test('security: an HTML page may run only its own inline scripts, by hash', async () => {
  const html = `<!doctype html><script type="application/json" id="d">{"a":1}</script>
<script>console.log("mine")</script><script src="/interface/js/app.js"></script>
<script src="https://other.example/window.js"></script>`;
  const { hashes, origins } = scanHtml(html);
  assert.deepEqual(hashes, [await hashOf('console.log("mine")')], 'the JSON block is data, not script');
  assert.deepEqual(origins, ['https://other.example']);
  const p = policy(html, { allow: ['https://friend.example/path', 'javascript:alert(1)', 'nonsense'] });
  assert.match(p, /script-src 'self' 'sha256-[^']+' https:\/\/other\.example https:\/\/friend\.example(;|$)/);
  assert.match(p, /connect-src 'self' https:\/\/other\.example https:\/\/friend\.example;/);
  assert.match(p, /frame-ancestors 'none'/);
  assert.match(p, /object-src 'none'/);
  assert.doesNotMatch(p, /unsafe-eval|javascript:/);
  assert.doesNotMatch(p, /script-src[^;]*unsafe-inline/, 'inline script runs only by hash');
});

test('security: every response gets the headers; HTML gets the policy; HSTS only over HTTPS', () => {
  const html = securityHeaders({ req: { headers: {} }, given: { 'content-type': 'text/html; charset=utf-8' }, body: '<p>hi</p>' });
  assert.ok(html['content-security-policy']);
  assert.equal(html['x-frame-options'], 'DENY');
  assert.equal(html['x-content-type-options'], 'nosniff');
  assert.equal(html['strict-transport-security'], undefined);
  const json = securityHeaders({ req: { headers: { 'cf-visitor': '{"scheme":"https"}' } }, given: { 'content-type': 'application/json' }, body: '{}', privateMode: true });
  assert.equal(json['content-security-policy'], undefined);
  assert.equal(json['strict-transport-security'], 'max-age=15552000');
  assert.equal(json['cross-origin-resource-policy'], 'same-origin');
  const ro = securityHeaders({ req: { headers: {} }, given: { 'content-type': 'text/html' }, body: '', csp: { mode: 'report-only' } });
  assert.ok(ro['content-security-policy-report-only'] && !ro['content-security-policy']);
  const off = securityHeaders({ req: { headers: {} }, given: { 'content-type': 'text/html' }, body: '', csp: { mode: 'off' } });
  assert.ok(!off['content-security-policy'] && !off['content-security-policy-report-only']);
  const mine = securityHeaders({ req: { headers: {} }, given: { 'Referrer-Policy': 'origin' }, body: '' });
  assert.equal(mine['referrer-policy'], undefined, "a handler's own header wins");
});

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('security: a private node tells strangers nothing about who belongs', async () => {
  // company: joining makes an applicant, admitted only by decision.
  const dir = await entityOnDisk({ preset: 'company', people: 2 });
  const nodeFile = path.join(dir, 'node.json');
  const node = fs.existsSync(nodeFile) ? JSON.parse(fs.readFileSync(nodeFile, 'utf8')) : {};
  fs.writeFileSync(nodeFile, JSON.stringify({ ...node, private: true }));
  const entity = fs.readdirSync(process.env.ENTITY_KEYS).find(n => n.startsWith('e-'));   // keys are kept per entity id
  const { loadKey } = await import('../cli/context.js');
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--port', String(port)], { cwd: dir, env: process.env });
  try {
    await new Promise((ok) => { proc.stdout.on('data', (d) => { if (String(d).includes('served')) ok(); }); setTimeout(ok, 4000); });
    const base = `http://127.0.0.1:${port}/`;
    const get = (p, h = {}) => fetch(base + p, { headers: h, redirect: 'manual' });
    const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

    // F4: the sign-in page carries the policy and refuses to be framed.
    const signin = await get('signin');
    assert.equal(signin.status, 200);
    assert.match(signin.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(signin.headers.get('x-frame-options'), 'DENY');
    // The wall holds for the record; F9: and for asking the node to fetch modules.
    assert.equal((await get('record/events.jsonl')).status, 401);
    assert.equal((await get('modules/available')).status, 401);
    assert.equal((await get('modules/deliberation/index.js')).status, 200, 'code stays open: sign-in needs it');

    // F8: one answer for a member, an applicant and a stranger without the key.
    const applicant = 'p-0002';
    const sayFor = async (id) => { const { body: c } = await post('auth/challenge', {}); return (await post('auth/verify', { id, challenge: c.challenge, signature: 'x' })).body.why; };
    const answers = new Set([await sayFor('p-0001'), await sayFor(applicant), await sayFor('p-9999')]);
    assert.equal(answers.size, 1, `sign-in answers differ: ${[...answers].join(' / ')}`);
    // ...but the applicant, proving their key, hears that the application is pending.
    const { body: c } = await post('auth/challenge', {});
    const sig = await keys.sign(`entity.signin\n${entity}\n${c.challenge}`, loadKey(entity, applicant), 'entity.signin');
    assert.match((await post('auth/verify', { id: applicant, challenge: c.challenge, signature: sig })).body.why, /not been admitted/);

    // F7: whether someone signed is never told for a member.
    const req = await (await get('auth/required?for=p-0001')).json();
    for (const d of req.documents || []) assert.equal(d.signed, undefined, 'no signature status for members');
  } finally { proc.kill(); }
});
