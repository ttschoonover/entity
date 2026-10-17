// Chat at the node: channels the members set, messages signed with members'
// keys and kept off the record, reading by token, deletion, and the limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keys, passwordKey } from '../kernel/index.js';
import { postMaterial, deleteMaterial, readMaterial, roomMaterial, roomDeleteMaterial, dmMaterial, dmDeleteMaterial, pairOf, NS } from '../cli/chat.js';
import * as cc from '../interface/js/chatcrypto.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('chat: X25519 matches RFC 7748', () => {
  const h = (x) => Uint8Array.from(x.match(/../g).map(y => parseInt(y, 16)));
  assert.equal(Buffer.from(cc.x25519(h('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'), h('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'))).toString('hex'), 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
});

test('chat: members write and read in channels, signed and off the record; tokens, deletion and limits', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  const dir = path.join(tmp, 'rep');
  fs.mkdirSync(dir);
  execFileSync('tar', ['cf', path.join(tmp, 'code.tar'), '--exclude=.git', '--exclude=record', '--exclude=node_modules', '--exclude=./node.json', '--exclude=./parameters.yml', '-C', ROOT, '.']);
  execFileSync('tar', ['xf', path.join(tmp, 'code.tar'), '-C', dir]);
  const env = { ...process.env, ENTITY_KEYS: path.join(tmp, 'keys'), ENTITY_NEW_PASSWORD: 'a long test password' };
  const E = (...a) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...a], { cwd: dir, env, encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'presets', '_chat.yml'), `modules: [deliberation, passwords, chat]
set:
  entity.name: "Chat Test"
  membership.admission: "open"
  chat.channels:
    - { id: general, title: General, read: members, post: members, encrypt: false }
    - { id: inner, title: Inner, read: members, post: members }
    - { id: notices, title: Notices, read: public, post: "office:secretary" }
`);
  E('preset', 'apply', '_chat'); E('found', '--id', 'tim', '--name', 'Chat Test');
  E('password', 'set', '--as', 'tim', '--settle');
  E('join', '--id', 'ana'); E('settle');
  const entity = fs.readFileSync(path.join(dir, 'record', 'events.jsonl'), 'utf8').match(/"entity":"(e-[0-9a-f]+)"/)[1];
  const records = () => fs.readFileSync(path.join(dir, 'record', 'events.jsonl'), 'utf8').trim().split('\n').length;
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--settle', '--port', String(port)], { cwd: dir, env });
  try {
    await new Promise((ok) => { proc.stdout.on('data', (d) => { if (String(d).includes('served')) ok(); }); setTimeout(ok, 4000); });
    const base = `http://localhost:${port}/`;
    const call = async (p, body, token) => { const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-chat-token': token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const tim = await passwordKey(entity, 'tim', 'a long test password');
    const token = async (by, key, at = new Date().toISOString()) => Buffer.from(JSON.stringify({ by, at, sig: await keys.sign(readMaterial({ entity, by, at }), key, NS) })).toString('base64url');
    const msg = async (by, key, channel, text, extra = {}) => { const m = { entity, channel, by, at: new Date().toISOString(), nonce: 'a'.repeat(16) + Math.random().toString(16).slice(2, 10).padEnd(8, '0'), text, ...extra }; return { ...m, sig: await keys.sign(postMaterial(m), key, NS) }; };
    const before = records();

    // Without a token, the members' channel is closed; with one, open.
    const ch0 = await call('chat/channels');
    assert.deepEqual(ch0.body.channels.map(c => [c.id, c.canRead, c.canPost]), [['general', false, false], ['inner', false, false], ['notices', true, false]]);
    assert.equal((await call('chat/c/general')).status, 403);
    const t = await token('tim', tim);
    const ch1 = await call('chat/channels', undefined, t);
    assert.equal(ch1.body.me, 'tim');
    assert.deepEqual(ch1.body.channels.map(c => [c.id, c.canRead, c.canPost]), [['general', true, true], ['inner', true, true], ['notices', true, false]]);
    // A token signed for someone else, or long ago, is not a token.
    assert.equal((await call('chat/channels', undefined, await token('tim', tim, new Date(Date.now() - 3600000).toISOString()))).body.me, null);

    // Writing: signed, kept by the node, never on the record.
    const m1 = await call('chat/c/general', await msg('tim', tim, 'general', 'Hello, @tim'));
    assert.equal(m1.status, 200, m1.body.why);
    const got = await call('chat/c/general', undefined, t);
    assert.equal(got.body.messages.length, 1); assert.equal(got.body.messages[0].text, 'Hello, @tim');
    assert.equal(records(), before, 'chat never touches the record');
    // Tampered text, a reply to nothing, a channel only an office writes in, a stale clock.
    const bad = await msg('tim', tim, 'general', 'original'); bad.text = 'changed';
    assert.match((await call('chat/c/general', bad)).body.why, /signature invalid/);
    assert.match((await call('chat/c/general', await msg('tim', tim, 'general', 'hi', { reply: 'nope' }))).body.why, /gone/);
    assert.equal((await call('chat/c/notices', await msg('tim', tim, 'notices', 'hear ye'))).status, 403);
    const old = { entity, channel: 'general', by: 'tim', at: new Date(Date.now() - 3600000).toISOString(), nonce: 'b'.repeat(16), text: 'late' };
    assert.match((await call('chat/c/general', { ...old, sig: await keys.sign(postMaterial(old), tim, NS) })).body.why, /clock/);
    // The same signed message twice is one message.
    const twice = await msg('tim', tim, 'general', 'once');
    await call('chat/c/general', twice); assert.equal((await call('chat/c/general', twice)).body.duplicate, true);
    // Replies, and reading only what is new.
    const id1 = got.body.messages[0].id;
    await call('chat/c/general', await msg('tim', tim, 'general', 'a reply', { reply: id1 }));
    const newer = await call(`chat/c/general?after=${got.body.seq}`, undefined, t);
    assert.deepEqual(newer.body.messages.map(m => m.text), ['once', 'a reply']);
    assert.equal(newer.body.messages[1].reply, id1);

    // Deleting: the author may; the text is gone from the node's disk.
    const d = { entity, channel: 'general', id: id1, by: 'tim', at: new Date().toISOString() };
    assert.equal((await call('chat/c/general/delete', { ...d, sig: await keys.sign(deleteMaterial(d), tim, NS) })).status, 200);
    const after = await call('chat/c/general', undefined, t);
    assert.ok(after.body.messages[0].deleted); assert.equal(after.body.messages[0].text, undefined);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '.entity', 'chat', 'general.jsonl'), 'utf8'), /Hello, @tim/);

    // Encrypted channels: the node keeps only ciphertext and wrapped keys.
    assert.equal(ch1.body.channels.find(c => c.id === 'inner').encrypted, true);
    const seed = tim.seed, mk = await cc.memberKey(seed);
    const kreg = { by: 'tim', xpk: mk.xpk, sig: await keys.sign(cc.keyMaterial({ entity, by: 'tim', xpk: mk.xpk }), tim, NS) };
    assert.match((await call('chat/keys', { ...kreg, xpk: (await cc.memberKey(new Uint8Array(32))).xpk })).body.why, /signature invalid/);
    assert.equal((await call('chat/keys', kreg)).status, 200);
    assert.deepEqual((await call('chat/keys')).body.keys.tim.map(k => k.xpk), [mk.xpk]);
    const e0 = await call('chat/c/inner/epochs', undefined, t);
    assert.equal(e0.body.current, 0); assert.deepEqual(e0.body.readers, ['tim', 'ana']);
    // Plain text is refused, and so is a message before there is a key.
    assert.match((await call('chat/c/inner', await msg('tim', tim, 'inner', 'in the clear'))).body.why, /encrypted/);
    const key = cc.channelKey(), where = { entity, channel: 'inner', epoch: 1 };
    const wrap = { to: 'tim', ...(await cc.wrapKey({ me: mk, toXpk: mk.xpk, key, ...where })) };
    assert.equal((await call('chat/c/inner/epochs', { epoch: 1, wraps: { [mk.xpk]: wrap } }, t)).status, 200);
    assert.equal((await call('chat/c/inner/epochs', { epoch: 3, wraps: { [mk.xpk]: wrap } }, t)).status, 409, 'epochs go one at a time');
    assert.equal((await call('chat/c/inner/epochs', { epoch: 1, wraps: { [mk.xpk]: { ...wrap, to: 'nobody' } } }, t)).status, 400);
    const e1 = await call('chat/c/inner/epochs', undefined, t);
    const back = await cc.unwrapKey({ me: mk, wrap: e1.body.epochs[0].wraps[mk.xpk], ...where });
    assert.deepEqual([...back], [...key]);
    const sealedMsg = async (text, epoch = 1) => {
      const m = { entity, channel: 'inner', by: 'tim', at: new Date().toISOString(), nonce: 'c'.repeat(16) + Math.random().toString(16).slice(2, 10).padEnd(8, '0') };
      const enc = await cc.seal({ key, text, ...m, epoch });
      return { ...m, enc, sig: await keys.sign(postMaterial({ ...m, text: cc.sealedText(enc) }), tim, NS) };
    };
    assert.equal((await call('chat/c/inner', await sealedMsg('a secret plan for the garden'))).status, 200);
    assert.equal((await call('chat/c/inner', await sealedMsg('old key', 2))).status, 409);
    const sm = (await call('chat/c/inner', undefined, t)).body.messages[0];
    assert.equal(sm.text, undefined);
    assert.equal(await cc.unseal({ key, sealed: sm.enc, entity, channel: 'inner', by: sm.by, at: sm.at, nonce: sm.nonce }), 'a secret plan for the garden');
    await assert.rejects(cc.unseal({ key, sealed: sm.enc, entity, channel: 'general', by: sm.by, at: sm.at, nonce: sm.nonce }), 'a sealed message cannot be moved to another channel');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '.entity', 'chat', 'inner.jsonl'), 'utf8'), /garden/);
    assert.equal(records(), before, 'encrypted chat never touches the record either');

    // Rooms members open: the opener or a moderator closes them, and their messages go.
    const ana = keys.importPrivateKey(fs.readFileSync(path.join(tmp, 'keys', entity, 'ana'), 'utf8'));
    const ta = await token('ana', ana);
    const open = { entity, by: 'tim', at: new Date().toISOString(), id: 'garden', title: 'Garden', about: 'Weeds and plans', read: 'public' };
    assert.equal((await call('chat/rooms', { ...open, sig: await keys.sign(roomMaterial(open), tim, NS) })).status, 200);
    assert.equal((await call('chat/rooms', { ...open, sig: await keys.sign(roomMaterial(open), tim, NS) })).status, 409, 'one #garden');
    const law = { ...open, id: 'general' };
    assert.equal((await call('chat/rooms', { ...law, sig: await keys.sign(roomMaterial(law), tim, NS) })).status, 409, 'a room cannot take a law channel’s name');
    const listed = (await call('chat/channels', undefined, ta)).body;
    const g = listed.channels.find(c => c.id === 'garden');
    assert.equal(g.room, true); assert.equal(g.canClose, false, 'not ana’s to close'); assert.equal(listed.canOpen, true);
    assert.equal((await call('chat/c/garden', await msg('ana', ana, 'garden', 'Tomatoes are in'))).status, 200);
    const shut = (by, key) => ({ entity, by, at: new Date().toISOString(), id: 'garden' });
    const byAna = shut('ana');
    assert.equal((await call('chat/rooms/garden/delete', { ...byAna, sig: await keys.sign(roomDeleteMaterial(byAna), ana, NS) })).status, 403);
    const lawShut = { ...shut('tim'), id: 'general' };
    assert.equal((await call('chat/rooms/general/delete', { ...lawShut, sig: await keys.sign(roomDeleteMaterial(lawShut), tim, NS) })).status, 404, 'law channels close only by law');
    const byTim = shut('tim');
    assert.equal((await call('chat/rooms/garden/delete', { ...byTim, sig: await keys.sign(roomDeleteMaterial(byTim), tim, NS) })).status, 200);
    assert.equal((await call('chat/channels', undefined, ta)).body.channels.some(c => c.id === 'garden'), false);
    assert.equal(fs.existsSync(path.join(dir, '.entity', 'chat', 'garden.jsonl')), false, 'its messages are gone');

    // Direct messages: sealed for the two of them; the node cannot read them.
    const ak = await cc.memberKey(ana.seed);
    const areg = { by: 'ana', xpk: ak.xpk, sig: await keys.sign(cc.keyMaterial({ entity, by: 'ana', xpk: ak.xpk }), ana, NS) };
    assert.equal((await call('chat/keys', areg)).status, 200);
    const pair = pairOf('tim', 'ana'), dw = { entity, channel: `dm:${pair}` };
    const dm = async (text, extra = {}) => {
      const m = { entity, by: 'tim', to: 'ana', at: new Date().toISOString(), nonce: 'd'.repeat(16) + Math.random().toString(16).slice(2, 10).padEnd(8, '0'), ...extra };
      const k = cc.channelKey();
      const enc = await cc.seal({ key: k, text, ...dw, epoch: 0, by: m.by, at: m.at, nonce: m.nonce, reply: m.reply || '' });
      const wraps = {};
      for (const xpk of [mk.xpk, ak.xpk]) { const w = await cc.wrapKey({ me: mk, toXpk: xpk, key: k, ...dw, epoch: m.nonce }); wraps[xpk] = w; }
      const body = { ...m, enc: { iv: enc.iv, ct: enc.ct }, wraps };
      return { ...body, sig: await keys.sign(dmMaterial(body), tim, NS) };
    };
    const sent = await call('chat/dm/ana', await dm('Can I borrow your ladder?'));
    assert.equal(sent.status, 200, sent.body.why);
    const tampered = await dm('hello'); tampered.wraps = { [ak.xpk]: tampered.wraps[ak.xpk] };
    assert.match((await call('chat/dm/ana', tampered)).body.why, /signature invalid/);
    assert.deepEqual((await call('chat/dm', undefined, ta)).body.conversations.map(c => c.with), ['tim']);
    assert.equal((await call('chat/dm/tim')).status, 403, 'signed in only');
    const got2 = (await call('chat/dm/tim', undefined, ta)).body.messages[0];
    const mkey = await cc.unwrapKey({ me: ak, wrap: got2.wraps[ak.xpk], ...dw, epoch: got2.nonce });
    assert.equal(await cc.unseal({ key: mkey, sealed: { epoch: 0, ...got2.enc }, ...dw, by: got2.by, at: got2.at, nonce: got2.nonce, reply: '' }), 'Can I borrow your ladder?');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '.entity', 'chat', 'dm', `${pair}.jsonl`), 'utf8'), /ladder/);
    const delA = { entity, by: 'ana', at: new Date().toISOString(), id: got2.id };
    assert.equal((await call('chat/dm/tim/delete', { ...delA, sig: await keys.sign(dmDeleteMaterial(delA), ana, NS) })).status, 403, 'only its author');
    const delT = { entity, by: 'tim', at: new Date().toISOString(), id: got2.id };
    assert.equal((await call('chat/dm/ana/delete', { ...delT, sig: await keys.sign(dmDeleteMaterial(delT), tim, NS) })).status, 200);
    assert.ok((await call('chat/dm/tim', undefined, ta)).body.messages[0].deleted);
    assert.equal(records(), before, 'rooms and direct messages never touch the record');
  } finally { proc.kill(); }
});
