// Email two-factor at the node's door: sign-in codes, enrolment, acts refused
// over the web without a confirmed browser, the republic's rule, and the mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keys, passwordKey, draft, signedMaterial } from '../kernel/index.js';
import { sendMail } from '../cli/mail.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('two-factor: enrol by email, sign in with a code, acts refused without it, the rule covers everyone', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-'));
  const dir = path.join(tmp, 'rep'), outbox = path.join(tmp, 'outbox'), keyHome = path.join(tmp, 'keys');
  fs.mkdirSync(dir);
  execFileSync('tar', ['cf', path.join(tmp, 'code.tar'), '--exclude=.git', '--exclude=record', '--exclude=node_modules', '--exclude=./node.json', '--exclude=./parameters.yml', '-C', ROOT, '.']);
  execFileSync('tar', ['xf', path.join(tmp, 'code.tar'), '-C', dir]);
  const env = { ...process.env, ENTITY_KEYS: keyHome, ENTITY_MAIL_OUTBOX: outbox, ENTITY_NEW_PASSWORD: 'a long test password' };
  const E = (...a) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...a], { cwd: dir, env, encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'presets', '_tf.yml'), 'modules: [deliberation, passwords, twofactor]\nset:\n  entity.name: "Two Factor Test"\n  membership.admission: "open"\n');
  E('preset', 'apply', '_tf'); E('found', '--id', 'tim', '--name', 'Two Factor Test');
  E('password', 'set', '--as', 'tim', '--settle');
  const entity = fs.readFileSync(path.join(dir, 'record', 'events.jsonl'), 'utf8').match(/"entity":"(e-[0-9a-f]+)"/)[1];
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--settle', '--port', String(port)], { cwd: dir, env });
  try {
    await new Promise((ok) => { proc.stdout.on('data', (d) => { if (String(d).includes('served')) ok(); }); setTimeout(ok, 4000); });
    const base = `http://localhost:${port}/`;
    const call = async (p, body, cookie) => { const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
    const lastCode = () => { const f = fs.readdirSync(outbox).sort().at(-1); return fs.readFileSync(path.join(outbox, f), 'utf8').match(/^ {4}(\d{6})$/m)[1]; };
    const tim = await passwordKey(entity, 'tim', 'a long test password');
    const act = async (by, key, kind, fields) => { const a = draft(kind, { entity, by, at: new Date().toISOString(), ...fields }); const { message, namespace } = signedMaterial(await (await import('../kernel/index.js')).createRegistry(await (await import('./helpers.js')).loadModules(['deliberation', 'passwords', 'twofactor'])), a); return { ...a, signature: await keys.sign(message, key, namespace) }; };
    const bill = (by, key, title) => act(by, key, 'proposal.lay', { title, rule: 'ordinary' });
    const signIn = async (id, key) => { const { body: c } = await call('auth/challenge', {}); return call('auth/verify', { id, challenge: c.challenge, signature: await keys.sign(`entity.signin\n${entity}\n${c.challenge}`, key, 'entity.signin') }); };

    // Optional, and not turned on: acts are taken as before.
    assert.equal((await call('acts', await bill('tim', tim, 'One'))).status, 200);
    // Turn it on: sign in (no code yet), give an address, confirm it with the code.
    const s1 = await signIn('tim', tim); assert.equal(s1.body.ok, true); assert.equal(s1.body.twofactor, false);
    const en = await call('auth/2fa/enroll', { email: 'tim@example.org' }, s1.cookie);
    assert.equal(en.status, 200, en.body.why); assert.match(en.body.to, /^t•+@example\.org$/);
    assert.equal((await call('auth/2fa/confirm', { ticket: en.body.ticket, code: '000000' })).status, 401);
    const ok = await call('auth/2fa/confirm', { ticket: en.body.ticket, code: lastCode() });
    assert.equal(ok.body.twofactor, true, ok.body.why);
    // Now an act without a confirmed browser is refused; with one, taken.
    const no = await call('acts', await bill('tim', tim, 'Two'));
    assert.equal(no.status, 403); assert.equal(no.body.twofactor, true);
    assert.equal((await call('acts', await bill('tim', tim, 'Two'), ok.cookie)).status, 200);
    // Signing in again asks for the emailed code; wrong codes count down.
    const s2 = await signIn('tim', tim); assert.equal(s2.body.need, 'code'); assert.equal(s2.cookie, '');
    assert.match((await call('auth/2fa/code', { ticket: s2.body.ticket, code: '123456' })).body.why, /tries left/);
    const s3 = await call('auth/2fa/code', { ticket: s2.body.ticket, code: lastCode() });
    assert.equal(s3.body.twofactor, true); assert.match(s3.cookie, /^gr_session=/);
    const st = await call('auth/2fa/status', undefined, s3.cookie);
    assert.deepEqual([st.body.enrolled, st.body.confirmed, st.body.policy], [true, true, 'optional']);
    // A bundle is taken only from a confirmed browser.
    assert.equal((await call('bundle', { records: [] })).status, 403);
    // The rule: everyone (decided while tim is the only member). A member who
    // joins afterwards must set it up at sign-in, and acts only once confirmed.
    const pid = E('propose', '--as', 'tim', '--title', 'Everyone', '--changes', '{"twofactor.require":"everyone"}').match(/d-[0-9a-f]{12}/)[0];
    E('settle'); E('act', 'ballot.cast', '--proposal', pid, '--choice', 'for', '--as', 'tim', '--settle');
    const ana = await passwordKey(entity, 'ana', 'another long password');
    assert.equal((await call('acts', await act('ana', ana, 'participant.apply', { key: keys.publicKeyLine(ana.publicKey) }))).status, 200, 'applying is never held back');
    const p = await signIn('ana', ana);
    assert.equal(p.body.need, 'enroll', p.body.why);
    assert.equal((await call('acts', await bill('ana', ana, 'From Ana'))).body.twofactor, true);
    const en2 = await call('auth/2fa/enroll', { ticket: p.body.ticket, email: 'ana@example.org' });
    const ok2 = await call('auth/2fa/confirm', { ticket: en2.body.ticket, code: lastCode() });
    assert.equal((await call('acts', await bill('ana', ana, 'From Ana'), ok2.cookie)).status, 200);
    assert.equal((await call('auth/2fa/off', {}, ok2.cookie)).status, 403, 'the rule keeps it on');
  } finally { proc.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('mail: a plain SMTP conversation delivers the message', async () => {
  const got = [];
  const server = net.createServer((sock) => {
    let data = false, msg = '';
    sock.write('220 test ESMTP\r\n');
    sock.on('data', (d) => {
      for (const line of String(d).split('\r\n').filter((l, i, a) => i < a.length - 1 || l)) {
        if (data) { if (line === '.') { data = false; got.push(msg); sock.write('250 queued\r\n'); } else msg += line + '\n'; continue; }
        if (/^EHLO/.test(line)) sock.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) { got.push(Buffer.from(line.slice(11), 'base64').toString()); sock.write('235 ok\r\n'); }
        else if (/^(MAIL|RCPT)/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  }).listen(0);
  const port = server.address().port;
  await sendMail({ host: '127.0.0.1', port, secure: false, starttls: false, user: 'u@x.org', password: 'pw', from: 'Rep <u@x.org>' }, 'to@x.org', '123456 is your code', 'Your code:\n\n    123456\n');
  server.close();
  assert.equal(got[0], '\0u@x.org\0pw');
  assert.match(got[1], /Subject: 123456 is your code/);
  assert.match(got[1], /^ {4}123456$/m);
});
