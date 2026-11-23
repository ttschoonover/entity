// The notify module through the command line and the node: subscriptions
// proved with record keys, sealed notices after settlement, push delivery,
// content-free email, the inbox, and a zero-knowledge node's nudges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, tmp } from './helpers.js';
import * as N from '../kernel/notice.js';
import * as WP from '../cli/webpush.js';
import { recordKeyFromSeed } from '../kernel/sealing.js';

const preset = (extra = '') => `_: Notices, for testing.\n\nmodules: [page, deliberation, titles, vocabulary, notify]\n\nset:\n  entity.name: The Noticing Assembly\n${extra}`;

async function republic(extra = '') {
  const dir = tmp('notify-');
  const { copyCode } = await import('../cli/commands/dist.js');
  copyCode(ROOT, dir);
  fs.cpSync(path.join(ROOT, 'library'), path.join(dir, 'library'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'presets', 'n.yml'), preset(extra));
  const outbox = tmp('mail-');
  const env = { ...process.env, ENTITY_KEYS: tmp('notify-keys-') };
  const cli = (args, extraEnv = {}) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...args], { cwd: dir, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  cli(['found', '--id', 'p-0001', '--preset', 'n']);
  cli(['join', '--id', 'p-0002', '--name', 'Second Person']);
  cli(['settle', '--as', 'p-0001']);
  const node = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8'));
  node.notify = { mail: `cat > "${outbox}/$NOTIFY_TO"; echo "$NOTIFY_SUBJECT" > "${outbox}/$NOTIFY_TO.subject"`, url: 'https://republic.example' };
  fs.writeFileSync(path.join(dir, 'node.json'), JSON.stringify(node, null, 2));
  return { dir, env, cli, outbox };
}
const seedOf = async (env, dir, id) => {
  const { importPrivateKey } = await import('../kernel/keys.js');
  const ent = fs.readdirSync(env.ENTITY_KEYS).find(n => n.startsWith('e-'));
  return importPrivateKey(fs.readFileSync(path.join(env.ENTITY_KEYS, ent, id), 'utf8')).seed;
};

test('notify: email says only that there is something new; the inbox opens with the member\'s key', async () => {
  const { dir, env, cli, outbox } = await republic();
  assert.match(cli(['notify', 'subscribe', '--email', 'one@example.org', '--as', 'p-0001']), /published p-0001's record key[\s\S]*subscribed .*trades, proposals, reminders, decisions, members, notices/);
  assert.match(cli(['notify', 'subscribe', '--email', 'two@example.org', '--plaintext', '--as', 'p-0002']), /plaintext_email is off/);
  cli(['propose', '--title', 'Buy a dishwasher', '--changes', '{"entity.name":"The Clean Assembly"}', '--as', 'p-0002']);
  cli(['settle', '--as', 'p-0001']);
  assert.match(cli(['notify', 'status']), /waiting to be delivered: 1\b/, 'p-0002 is not told of their own proposal');
  assert.match(cli(['notify', 'send']), /sent 1/);
  const mail = fs.readFileSync(path.join(outbox, 'one@example.org'), 'utf8');
  assert.ok(!mail.includes('dishwasher'), 'nothing of the notice in the email');
  assert.match(mail, /something new for you in The Noticing Assembly\. Open it here: https:\/\/republic\.example\/#\//);
  assert.match(cli(['notify', 'inbox', '--as', 'p-0001']), /New proposal: Buy a dishwasher — Second Person proposes it/);
  const inbox = fs.readFileSync(path.join(dir, '.entity', 'notify', 'inbox', 'p-0001.jsonl'), 'utf8');
  assert.ok(!inbox.includes('dishwasher') && inbox.includes('"enc"'), 'the inbox on disk is sealed');
  // Another member's key cannot read it, nor ask for it.
  await assert.rejects(N.openNotice(JSON.parse(inbox.split('\n')[0]), (await recordKeyFromSeed(await seedOf(env, dir, 'p-0002'))).sk));
  assert.ok(!fs.readFileSync(path.join(dir, 'record', 'events.jsonl'), 'utf8').includes('example.org'), 'addresses stay off the record');
});

test('notify: with plaintext email allowed and chosen, the title is in the email; notices from members reach everyone else', async () => {
  const { cli, outbox } = await republic('  notify.plaintext_email: true\n');
  cli(['notify', 'subscribe', '--email', 'two@example.org', '--plaintext', '--events', 'notices', '--as', 'p-0002']);
  cli(['act', 'notice.post', '--title', 'Meeting moved to Thursday', '--text', 'Same room.', '--as', 'p-0001']);
  cli(['settle', '--as', 'p-0001']);
  cli(['notify', 'send']);
  assert.equal(fs.readFileSync(path.join(outbox, 'two@example.org.subject'), 'utf8').trim(), 'Meeting moved to Thursday');
  assert.match(fs.readFileSync(path.join(outbox, 'two@example.org'), 'utf8'), /Same room\.[\s\S]*https:\/\/republic\.example\/#\/notify/);
});

test('notify: a push carries the notice sealed twice; a stale, replayed or forged request is refused; a gone endpoint is dropped', async () => {
  const { dir, env, cli } = await republic();
  cli(['notify', 'subscribe', '--email', 'one@example.org', '--as', 'p-0001']);       // publishes the record key
  const { openEntity } = await import('../cli/context.js');
  const notify = await import('../cli/notify.js');
  const e = await openEntity({ dir, as: 'p-0001' });
  const rk = await recordKeyFromSeed(await seedOf(env, dir, 'p-0001'));
  const { nodeKey } = await notify.publicKeys(dir);
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
  const push = { endpoint: 'https://push.example.net/s/1', keys: { p256dh: ua.getPublicKey('base64url'), auth: auth.toString('base64url') } };
  const req = await N.signRequest({ entity: e.state.entity.id, member: 'p-0001', at: new Date().toISOString(), op: 'subscribe', channel: 'push', push, events: ['proposals'] }, { recordSk: rk.sk, nodeKey });
  assert.equal((await notify.handle(e, req)).ok, true);
  assert.match((await notify.handle(e, req)).error, /already used/);
  assert.match((await notify.handle(e, await N.signRequest({ ...req, mac: undefined, at: '2020-01-01T00:00:00Z' }, { recordSk: rk.sk, nodeKey }))).error, /stale/);
  const other = await recordKeyFromSeed(crypto.randomBytes(32));
  assert.match((await notify.handle(e, await N.signRequest({ entity: e.state.entity.id, member: 'p-0001', at: new Date().toISOString(), op: 'list' }, { recordSk: other.sk, nodeKey }))).error, /not signed with that member's record key/);

  cli(['propose', '--title', 'Paint the door', '--changes', '{"entity.name":"The Red Door"}', '--as', 'p-0002']);
  cli(['settle', '--as', 'p-0001']);
  const seen = [];
  const r = await notify.deliver(dir, { fetchImpl: async (url, o) => { seen.push({ url, o }); return { status: 201 }; }, run: async () => 0 });
  assert.equal(r.sent, 2);
  const p = seen.find(s => s.url === push.endpoint);
  assert.match(p.o.headers.authorization, /^vapid t=.+, k=/);
  const payload = WP.decrypt(Buffer.from(p.o.body), { privateKey: ua.getPrivateKey('base64url'), auth: push.keys.auth }).toString();
  assert.ok(!payload.includes('Paint'), 'what the browser profile sees without the member key');
  const n = await N.openNotice(JSON.parse(payload).n, rk.sk);
  assert.equal(n.title, 'New proposal: Paint the door'); assert.equal(n.from, 'The Noticing Assembly'); assert.match(n.url, /^#\/votes\/d-/);
  // The push service says the subscription is gone: it is dropped.
  cli(['act', 'participant.leave', '--as', 'p-0002']); cli(['settle', '--as', 'p-0001']);
  const e2 = await openEntity({ dir, as: 'p-0001' });
  await notify.handle(e2, await N.signRequest({ entity: e.state.entity.id, member: 'p-0001', at: new Date().toISOString(), op: 'subscribe', channel: 'push', push, events: ['members'] }, { recordSk: rk.sk, nodeKey }));
  cli(['act', 'notice.post', '--title', 'x', '--as', 'p-0001']);
  cli(['propose', '--title', 'Another', '--changes', '{"entity.name":"Y"}', '--as', 'p-0001']); cli(['settle', '--as', 'p-0001']);
  fs.appendFileSync(path.join(dir, '.entity', 'notify', 'outbox.jsonl'), JSON.stringify({ id: 'x', tries: 0, next: 0, member: 'p-0001', sub: notify.readSubs(dir)['p-0001'].find(s => s.channel === 'push').id, channel: 'push', payload: '{}' }) + '\n');
  await notify.deliver(dir, { fetchImpl: async () => ({ status: 410 }), run: async () => 0 });
  assert.ok(!notify.readSubs(dir)['p-0001'].some(s => s.channel === 'push'));
});

test('notify: a zero-knowledge node takes subscriptions by record key and sends only a sealed "something new", once an hour', async () => {
  const { dir, env, cli } = await republic('  records.sealing: true\n');
  cli(['records', 'key', '--as', 'p-0002']); cli(['settle', '--as', 'p-0001']);
  const { openEntity } = await import('../cli/context.js');
  const notify = await import('../cli/notify.js');
  const relay = await openEntity({ dir, relay: true }, { readable: false });
  assert.ok(relay.unreadable > 0, 'this test process holds no member key: the copy cannot read');
  const rk = await recordKeyFromSeed(await seedOf(env, dir, 'p-0002'));
  const { nodeKey } = await notify.publicKeys(dir);
  const entity = relay.records[0].payload.act.entity;
  const r = await notify.handle(relay, await N.signRequest({ entity, member: 'p-0002', at: new Date().toISOString(), op: 'subscribe', channel: 'email', address: 'two@example.org' }, { recordSk: rk.sk, nodeKey }));
  assert.equal(r.ok, true, r.error);
  assert.equal((await notify.nudge(relay, { now: 1e12 })).queued, 1);
  assert.equal((await notify.nudge(relay, { now: 1e12 + 60000 })).queued, 0, 'not again within the hour');
  const q = notify.pending(dir).at(-1);
  assert.equal(q.subject, 'Something new in your group');
  assert.ok(!JSON.stringify(q).includes('Noticing'), 'not even the republic\'s name');
});

test('notify: a notice to everyone reaches its author too, unless the node says not to', async () => {
  const { dir, cli, outbox } = await republic('  notify.plaintext_email: true\n');
  cli(['notify', 'subscribe', '--email', 'one@example.org', '--plaintext', '--events', 'notices,proposals', '--as', 'p-0001']);
  cli(['act', 'notice.post', '--title', 'Package at the door', '--as', 'p-0001']);
  cli(['settle', '--as', 'p-0001']); cli(['notify', 'send']);
  assert.equal(fs.readFileSync(path.join(outbox, 'one@example.org.subject'), 'utf8').trim(), 'Package at the door');
  fs.rmSync(path.join(outbox, 'one@example.org.subject'));
  const f = path.join(dir, 'node.json'), n = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...n, notify: { ...(n.notify || {}), self: false } }));
  cli(['act', 'notice.post', '--title', 'Water off at 2', '--as', 'p-0001']);
  cli(['settle', '--as', 'p-0001']); cli(['notify', 'send']);
  assert.ok(!fs.existsSync(path.join(outbox, 'one@example.org.subject')), 'with "self": false, not to its author');
});

test('notify: the member commands will not replace a record key published elsewhere (the page\'s) without --replace-key', async () => {
  const { dir, env, cli } = await republic();
  // The page publishes its own record key for p-0001 (a password-derived seed, not the key file's).
  const other = crypto.randomBytes(32).toString('base64');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { openEntity, signed, settlePending } from './cli/context.js';
    import * as store from './kernel/store.js';
    const e = await openEntity({ as: 'p-0001' });
    store.writePending(e.dir, await signed(e, 'member.recordkey', { by: 'p-0001', key: ${JSON.stringify(other)} }, { as: 'p-0001' }));
    const r = await settlePending(e); if (!r.applied.length) throw new Error(JSON.stringify(r.refused));`], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const keyNow = () => fs.readFileSync(path.join(dir, 'record', 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.kind === 'member.recordkey').pop().payload.act.key;
  assert.equal(keyNow(), other);
  for (const args of [['notify', 'inbox'], ['notify', 'list'], ['records', 'key']]) {
    assert.throws(() => cli([...args, '--as', 'p-0001']), (x) => /replace-key/.test(String(x.stderr) + String(x.stdout)), args.join(' '));
    assert.equal(keyNow(), other, `${args.join(' ')} left the page's key alone`);
  }
  assert.match(cli(['notify', 'list', '--replace-key', '--as', 'p-0001']), /published p-0001's record key/);
  assert.notEqual(keyNow(), other);
});
