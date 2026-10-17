// chat · the node's side of the chat module: channels of messages, kept by
// this node in .entity/chat/ and never written to the record.
//
// Every message is signed in the page with its author's own key, in its own
// namespace, so it can be checked against the record's keys but never replayed
// as an act. The members decide everything else by law (library/chat): the
// channels, who reads and writes each, who moderates, how long messages last.
//
//   GET  /chat/channels                       the channels, and what the asker may do
//   GET  /chat/c/ID?after=N | ?before=N       messages (members-only channels need a token)
//   POST /chat/c/ID                           a signed message
//   POST /chat/c/ID/delete                    a signed deletion, by its author or a moderator
//   GET  /chat/stream?t=TOKEN                 a live stream: "this channel has message N"
//   GET  /chat/keys | POST /chat/keys         members' chat keys (X25519), each signed with a record key
//   POST /chat/rooms                          a member opens a room (chat.room_creators may)
//   POST /chat/rooms/ID/delete                its opener or a moderator closes it, and its messages go
//   GET  /chat/dm                             your direct conversations
//   GET  /chat/dm/ID | POST /chat/dm/ID       direct messages with ID, sealed in the page for the two of you
//   POST /chat/dm/ID/delete                   the author deletes a direct message
//   GET  /chat/c/ID/epochs                    an encrypted channel's key epochs, with the asker's wraps
//   POST /chat/c/ID/epochs                    start an epoch, or wrap its key for members who lack it
//
// Members-only channels are end-to-end encrypted unless the law says
// encrypt: false (interface/js/chatcrypto.js). The node keeps and passes on
// ciphertext and wrapped keys; it never sees a channel key or a message's text.
// It does see who wrote, when, and in which channel.
//
// A token proves who is reading without a session: chat.read, the entity, the
// member and the time, signed with their key; good for ten minutes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as store from '../kernel/store.js';
import { keys } from '../kernel/index.js';
import { openEntity } from './context.js';
import { emit } from './events.js';
import { keyMaterial, validXpk, sealedText } from '../interface/js/chatcrypto.js';
import { canonical } from '../kernel/canonical.js';

export const NS = 'entity.chat';
export const postMaterial = (m) => ['chat.post', m.entity, m.channel, m.by, m.at, m.nonce, m.reply || '', m.text].join('\n');
export const deleteMaterial = (d) => ['chat.delete', d.entity, d.channel, d.id, d.by, d.at].join('\n');
export const readMaterial = (t) => ['chat.read', t.entity, t.by, t.at].join('\n');
export const roomMaterial = (r) => ['chat.room', r.entity, r.by, r.at, r.id, r.title, r.about || '', r.read].join('\n');
export const roomDeleteMaterial = (r) => ['chat.room.delete', r.entity, r.by, r.at, r.id].join('\n');
// A direct message: sealed once with a fresh key, which is wrapped for every
// chat key of both people; the signature covers the ciphertext and the wraps.
export const dmMaterial = (m) => ['chat.dm', m.entity, m.by, m.to, m.at, m.nonce, m.reply || '', sealedText({ epoch: 0, ...m.enc }), canonical(m.wraps)].join('\n');
export const dmDeleteMaterial = (d) => ['chat.dm.delete', d.entity, d.by, d.at, d.id].join('\n');
export const pairOf = (a, b) => [a, b].sort().join('~');

export const encrypted = (c) => c.read !== 'public' && c.encrypt !== false;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SKEW = 5 * 60000, TOKEN_LIFE = 10 * 60000, RATE = 30; // messages per member per minute
const clean = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();

// Is this member, now, among those a spec names: members | office:ID | committee:ID?
export function inBody(state, spec, who, now = new Date().toISOString()) {
  const p = state.participants[who];
  if (!p || p.status !== 'active') return false;
  if (!spec || spec === 'members') return true;
  const [kind, id] = String(spec).split(':');
  const live = (list) => (list || []).some(m => m.id === who && (!m.since || m.since <= now) && (!m.until || m.until > now));
  if (kind === 'office') return live(state.m.offices?.[id]?.holders);
  if (kind === 'committee') return live(state.m.committees?.[id]?.members);
  return false;
}

export function chatNode(opt) {
  let cache = { size: -1, e: null };
  const sizeOf = (dir) => { try { return fs.statSync(store.P(dir).events).size; } catch { return 0; } };
  // The entity, refolded only when the record has grown.
  const entity = async () => {
    if (!cache.e) { cache.e = await openEntity(opt); cache.size = sizeOf(cache.e.dir); return cache.e; }
    const size = sizeOf(cache.e.dir);
    if (size !== cache.size) { cache.e = await openEntity(opt); cache.size = size; }
    return cache.e;
  };
  const on = (e) => !!e.params && e.params.value('entity.modules').includes('chat');
  const val = (e, k, d) => (e.params.has(k) ? e.params.value(k) : d);
  // The channels: those the law names, then the rooms members opened.
  const settings = (e) => {
    const law = (e.params.value('chat.channels') || []).filter(c => c && ID.test(c.id || '') && typeof c.title === 'string');
    const taken = new Set(law.map(c => c.id));
    const opened = Object.values(memberRooms(e.dir)).filter(r => !taken.has(r.id)).map(r => ({ ...r, post: 'members', room: true }));
    return {
      channels: [...law, ...opened],
      moderators: e.params.value('chat.moderators') || '',
      days: e.params.value('chat.retention_days'),
      max: e.params.value('chat.max_length'),
      creators: val(e, 'chat.room_creators', 'members'),
      maxRooms: val(e, 'chat.max_rooms', 50),
      dm: val(e, 'chat.direct_messages', true),
    };
  };
  // Rooms members opened: { id: { id, title, about, read, by, at, sig } }, kept off the record.
  const rfile = (dir) => path.join(dir, '.entity', 'chat', '_rooms.json');
  let roomBook = null;
  const memberRooms = (dir) => { if (!roomBook) { try { roomBook = JSON.parse(fs.readFileSync(rfile(dir), 'utf8')); } catch { roomBook = {}; } } return roomBook; };

  // Messages, by channel: loaded from disk once, pruned to the retention period.
  const rooms = new Map();
  const file = (dir, ch) => path.join(dir, '.entity', 'chat', `${ch}.jsonl`);
  const save = (dir, ch, r) => { fs.mkdirSync(path.dirname(file(dir, ch)), { recursive: true }); fs.writeFileSync(file(dir, ch), r.msgs.map(m => JSON.stringify(m)).join('\n') + (r.msgs.length ? '\n' : '')); };
  function room(dir, ch, days) {
    let r = rooms.get(ch);
    if (!r) {
      let msgs = [];
      try { msgs = fs.readFileSync(file(dir, ch), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { /* new channel */ }
      r = { msgs, seq: msgs.reduce((a, m) => Math.max(a, m.seq), 0), ids: new Set(msgs.map(m => m.id)) };
      rooms.set(ch, r);
    }
    const cut = new Date(Date.now() - days * 86400000).toISOString();
    if (r.msgs.length && r.msgs[0].at < cut) { r.msgs = r.msgs.filter(m => m.at >= cut); save(dir, ch, r); }
    return r;
  }

  // Members' chat keys: { member: [{ xpk, sig }] }, checked when registered
  // and again by every page that uses them.
  const kfile = (dir) => path.join(dir, '.entity', 'chat', '_keys.json');
  let registry = null;
  const reg = (dir) => { if (!registry) { try { registry = JSON.parse(fs.readFileSync(kfile(dir), 'utf8')); } catch { registry = {}; } } return registry; };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
  // A channel's epochs: [{ epoch, from, at, wraps: { xpk: { to, fromXpk, iv, ct } } }]
  const efile = (dir, ch) => path.join(dir, '.entity', 'chat', `${ch}.keys.json`);
  const epochs = new Map();
  const eps = (dir, ch) => { if (!epochs.has(ch)) { let v = []; try { v = JSON.parse(fs.readFileSync(efile(dir, ch), 'utf8')); } catch { /* none yet */ } epochs.set(ch, v); } return epochs.get(ch); };
  const readers = (e) => Object.keys(e.state.participants).filter(id => inBody(e.state, 'members', id));
  // Stale: someone the current key was given to can no longer read the channel.
  const stale = (e, ep) => !!ep && Object.values(ep.wraps).some(w => !inBody(e.state, 'members', w.to));

  // Who is asking: a token, checked against the member's keys on the record.
  const tokens = new Map();
  async function reader(e, token) {
    if (!token) return null;
    const seen = tokens.get(token); if (seen && seen.until > Date.now()) return seen.by;
    let t; try { t = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')); } catch { return null; }
    const p = e.state.participants[t?.by];
    if (!p || p.status !== 'active' || typeof t.at !== 'string' || Math.abs(Date.now() - Date.parse(t.at)) > TOKEN_LIFE) return null;
    const v = await keys.verify(readMaterial({ entity: e.state.entity.id, by: t.by, at: t.at }), t.sig, p.keys, NS);
    if (!v.ok) return null;
    tokens.set(token, { by: t.by, until: Date.parse(t.at) + TOKEN_LIFE });
    if (tokens.size > 5000) for (const [k, x] of tokens) if (x.until < Date.now()) tokens.delete(k);
    return t.by;
  }
  const canRead = (e, c, who) => c.read === 'public' || (!!who && inBody(e.state, 'members', who));
  const canPost = (e, c, who) => !!who && inBody(e.state, c.post || 'members', who);
  const isMod = (e, s, who) => !!s.moderators && inBody(e.state, s.moderators, who);

  // Live streams, and who may hear about which channel.
  const streams = new Set();
  const tellAll = (event, data) => { for (const st of streams) st.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const tellPair = (a, b, seq) => { for (const st of streams) if (st.who === a || st.who === b) st.res.write(`event: dm\ndata: ${JSON.stringify({ with: st.who === a ? b : a, seq })}\n\n`); };
  const ping = (ch, seq) => { for (const s of streams) if (s.channels.has(ch)) s.res.write(`event: message\ndata: ${JSON.stringify({ channel: ch, seq })}\n\n`); };
  const recent = new Map(); // member → timestamps of their last messages
  const keyPing = (ch) => { for (const s of streams) if (s.channels.has(ch)) s.res.write(`event: keys\ndata: ${JSON.stringify({ channel: ch })}\n\n`); };
  const show = (m) => (m.deleted ? { seq: m.seq, id: m.id, at: m.at, by: m.by, deleted: m.deleted } : { seq: m.seq, id: m.id, at: m.at, by: m.by, ...(m.enc ? { enc: m.enc } : { text: m.text }), reply: m.reply || null, sig: m.sig, nonce: m.nonce });

  // → true when it answered.
  async function handle(req, res, p, { body, send, cors }) {
    if (!p.startsWith('/chat/')) return false;
    const e = await entity();
    if (!on(e)) { send(res, 404, { why: 'chat is not switched on here' }); return true; }
    const s = settings(e), url = new URL(req.url, 'http://x');
    const token = req.headers['x-chat-token'] || url.searchParams.get('t');
    const who = await reader(e, token);

    if (req.method === 'GET' && p === '/chat/channels') {
      send(res, 200, { me: who, moderator: isMod(e, s, who), max: s.max, days: s.days,
        canOpen: !!who && !!s.creators && inBody(e.state, s.creators, who) && s.channels.filter(c => c.room).length < s.maxRooms, dm: s.dm,
        channels: s.channels.map(c => ({ id: c.id, title: c.title, about: c.about || '', read: c.read === 'public' ? 'public' : 'members', post: c.post || 'members',
          ...(c.room ? { room: true, by: c.by, canClose: !!who && (c.by === who || isMod(e, s, who)) } : {}),
          encrypted: encrypted(c), canRead: canRead(e, c, who), canPost: canPost(e, c, who), seq: canRead(e, c, who) ? room(e.dir, c.id, s.days).seq : null })) });
      return true;
    }
    if (req.method === 'GET' && p === '/chat/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
      const st = { res, who, channels: new Set(s.channels.filter(c => canRead(e, c, who)).map(c => c.id)) };
      streams.add(st);
      res.write(`event: hello\ndata: ${JSON.stringify({ me: who, channels: [...st.channels] })}\n\n`);
      const beat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
      req.on('close', () => { clearInterval(beat); streams.delete(st); });
      return true;
    }
    if (p === '/chat/keys') {
      if (req.method === 'GET') { send(res, 200, { keys: reg(e.dir) }); return true; }
      if (req.method !== 'POST') { send(res, 405, { why: 'method not allowed' }); return true; }
      let b; try { b = JSON.parse(await body(req) || '{}'); } catch { send(res, 400, { why: 'not JSON' }); return true; }
      const pp = e.state.participants[b.by];
      if (!pp || pp.status !== 'active') { send(res, 403, { why: `${b.by} is not an active member` }); return true; }
      if (!validXpk(b.xpk)) { send(res, 400, { why: 'not a chat key' }); return true; }
      const v = await keys.verify(keyMaterial({ entity: e.state.entity.id, by: b.by, xpk: b.xpk }), b.sig, pp.keys, NS);
      if (!v.ok) { send(res, 403, { why: `signature invalid: ${v.error}` }); return true; }
      const r0 = reg(e.dir), list = r0[b.by] || [];
      if (!list.some(k => k.xpk === b.xpk)) { r0[b.by] = [...list, { xpk: b.xpk, sig: b.sig }].slice(-8); writeJson(kfile(e.dir), r0); emit(e.dir, 'chat.key', { by: b.by }); for (const c of s.channels) if (encrypted(c)) keyPing(c.id); }
      send(res, 200, { ok: true });
      return true;
    }
    // ── rooms members open and close ──
    const rm = p.match(/^\/chat\/rooms(?:\/([a-z0-9-]+)\/delete)?$/);
    if (rm) {
      if (req.method !== 'POST') { send(res, 405, { why: 'method not allowed' }); return true; }
      let b; try { b = JSON.parse(await body(req) || '{}'); } catch { send(res, 400, { why: 'not JSON' }); return true; }
      const pp = e.state.participants[b.by];
      if (!pp || pp.status !== 'active') { send(res, 403, { why: `${b.by} is not an active member` }); return true; }
      if (typeof b.at !== 'string' || Math.abs(Date.now() - Date.parse(b.at)) > SKEW) { send(res, 400, { why: 'the time on this is off by more than five minutes: check your computer’s clock' }); return true; }
      const book = memberRooms(e.dir);
      if (!rm[1]) {
        if (!s.creators || !inBody(e.state, s.creators, b.by)) { send(res, 403, { why: s.creators ? `only ${s.creators} may open rooms` : 'rooms are opened by law here (chat.channels)' }); return true; }
        if (!ID.test(b.id || '')) { send(res, 400, { why: 'a room id is lowercase letters, digits and -' }); return true; }
        if (s.channels.some(c => c.id === b.id)) { send(res, 409, { why: `#${b.id} already exists` }); return true; }
        if (s.channels.filter(c => c.room).length >= s.maxRooms) { send(res, 400, { why: `there are already ${s.maxRooms} rooms (chat.max_rooms); close one first` }); return true; }
        if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 80) { send(res, 400, { why: 'a room needs a title of 1–80 characters' }); return true; }
        if (b.about !== undefined && (typeof b.about !== 'string' || b.about.length > 300)) { send(res, 400, { why: 'what a room is about is at most 300 characters' }); return true; }
        if (!['public', 'members'].includes(b.read)) { send(res, 400, { why: 'read is public or members' }); return true; }
        const v = await keys.verify(roomMaterial({ entity: e.state.entity.id, ...b }), b.sig, pp.keys, NS);
        if (!v.ok) { send(res, 403, { why: `signature invalid: ${v.error}` }); return true; }
        book[b.id] = { id: b.id, title: b.title.trim(), about: b.about || '', read: b.read, by: b.by, at: b.at, sig: b.sig };
        writeJson(rfile(e.dir), book);
        emit(e.dir, 'chat.room', { id: b.id, by: b.by });
        tellAll('rooms', { opened: b.id });
        send(res, 200, { ok: true });
        return true;
      }
      const it = book[rm[1]];
      if (!it || s.channels.find(c => c.id === rm[1])?.room !== true) { send(res, 404, { why: 'no such room: channels the law names close only by law' }); return true; }
      if (it.by !== b.by && !isMod(e, s, b.by)) { send(res, 403, { why: 'only the member who opened a room, or a moderator, closes it' }); return true; }
      const v = await keys.verify(roomDeleteMaterial({ entity: e.state.entity.id, by: b.by, at: b.at, id: rm[1] }), b.sig, pp.keys, NS);
      if (!v.ok) { send(res, 403, { why: `signature invalid: ${v.error}` }); return true; }
      delete book[rm[1]];
      writeJson(rfile(e.dir), book);
      for (const f of [file(e.dir, rm[1]), efile(e.dir, rm[1])]) fs.rmSync(f, { force: true });
      rooms.delete(rm[1]); epochs.delete(rm[1]);
      emit(e.dir, 'chat.room.close', { id: rm[1], by: b.by, moderator: it.by !== b.by });
      tellAll('rooms', { closed: rm[1] });
      send(res, 200, { ok: true });
      return true;
    }

    // ── direct messages ──
    if (p === '/chat/dm' || p.startsWith('/chat/dm/')) {
      if (!s.dm) { send(res, 404, { why: 'direct messages are switched off here (chat.direct_messages)' }); return true; }
      if (req.method === 'GET' && p === '/chat/dm') {
        if (!who) { send(res, 403, { why: 'sign in to see your messages' }); return true; }
        const d = path.join(e.dir, '.entity', 'chat', 'dm');
        let names = []; try { names = fs.readdirSync(d).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6)); } catch { /* none yet */ }
        const mine = names.filter(n => n.split('~').includes(who)).map(n => {
          const r = room(e.dir, `dm/${n}`, s.days), last = r.msgs.at(-1);
          return { with: n.split('~').find(x => x !== who) || who, seq: r.seq, at: last?.at || null };
        }).filter(x => x.at).sort((a, b) => (a.at < b.at ? 1 : -1));
        send(res, 200, { conversations: mine });
        return true;
      }
      const dm = p.match(/^\/chat\/dm\/([a-z0-9][a-z0-9-]{0,39})(\/delete)?$/);
      if (!dm) { send(res, 404, { why: 'no such address' }); return true; }
      const other = dm[1];
      if (!e.state.participants[other]) { send(res, 404, { why: `no member ${other}` }); return true; }
      if (req.method === 'GET' && !dm[2]) {
        if (!who) { send(res, 403, { why: 'sign in to read your messages' }); return true; }
        const r = room(e.dir, `dm/${pairOf(who, other)}`, s.days), after = Number(url.searchParams.get('after') || 0);
        const list = r.msgs.filter(x => x.seq > after).slice(-200);
        send(res, 200, { with: other, seq: r.seq, messages: list.map(x => (x.deleted ? { seq: x.seq, id: x.id, at: x.at, by: x.by, deleted: x.deleted } : x)) });
        return true;
      }
      if (req.method !== 'POST') { send(res, 405, { why: 'method not allowed' }); return true; }
      let b; try { b = JSON.parse(await body(req) || '{}'); } catch { send(res, 400, { why: 'not JSON' }); return true; }
      const pp = e.state.participants[b.by];
      if (!pp || pp.status !== 'active') { send(res, 403, { why: `${b.by} is not an active member` }); return true; }
      if (typeof b.at !== 'string' || Math.abs(Date.now() - Date.parse(b.at)) > SKEW) { send(res, 400, { why: 'the time on this message is off by more than five minutes: check your computer’s clock' }); return true; }
      const key = `dm/${pairOf(b.by, other)}`, r = room(e.dir, key, s.days);
      if (dm[2]) {
        const x = r.msgs.find(y => y.id === b.id);
        if (!x || x.deleted) { send(res, 404, { why: 'no such message' }); return true; }
        if (x.by !== b.by) { send(res, 403, { why: 'only its author deletes a direct message' }); return true; }
        const v = await keys.verify(dmDeleteMaterial({ entity: e.state.entity.id, by: b.by, at: b.at, id: b.id }), b.sig, pp.keys, NS);
        if (!v.ok) { send(res, 403, { why: `signature invalid: ${v.error}` }); return true; }
        r.msgs[r.msgs.indexOf(x)] = { seq: x.seq, id: x.id, at: x.at, by: x.by, to: x.to, deleted: { by: b.by, at: b.at } };
        save(e.dir, key, r);
        tellPair(b.by, other, r.seq);
        send(res, 200, { ok: true });
        return true;
      }
      if (other === b.by) { send(res, 400, { why: 'a direct message goes to someone else' }); return true; }
      if (e.state.participants[other].status !== 'active') { send(res, 403, { why: `${other} is not an active member` }); return true; }
      if (b.to !== other) { send(res, 400, { why: 'the message is addressed to someone else' }); return true; }
      if (typeof b.nonce !== 'string' || !/^[0-9a-f]{16,64}$/.test(b.nonce)) { send(res, 400, { why: 'missing nonce' }); return true; }
      const x = b.enc;
      if (!x || ![x.iv, x.ct].every(y => typeof y === 'string' && B64.test(y)) || x.ct.length > Math.ceil((s.max * 4 + 16) / 3) * 4 + 4) { send(res, 400, { why: `a message is sealed in the page, and at most ${s.max} characters` }); return true; }
      const all = reg(e.dir), theirs = new Set([...(all[b.by] || []), ...(all[other] || [])].map(k => k.xpk)), mineK = new Set((all[b.by] || []).map(k => k.xpk));
      const w = b.wraps;
      if (!w || typeof w !== 'object' || !Object.keys(w).length || Object.keys(w).length > 16) { send(res, 400, { why: 'the message key is wrapped for nobody' }); return true; }
      for (const [xpk, y] of Object.entries(w)) {
        if (!theirs.has(xpk) || !mineK.has(y?.fromXpk) || ![y.iv, y.ct].every(z => typeof z === 'string' && B64.test(z) && z.length < 200)) { send(res, 400, { why: 'a wrapped key is not for one of you two' }); return true; }
      }
      if (!Object.keys(w).some(k => (all[other] || []).some(q => q.xpk === k))) { send(res, 400, { why: `${other} has no chat key yet: they need to open the chat once` }); return true; }
      if (b.reply && !r.msgs.some(y => y.id === b.reply)) { send(res, 400, { why: 'the message you replied to is gone' }); return true; }
      const material = dmMaterial({ entity: e.state.entity.id, ...b });
      const v = await keys.verify(material, b.sig, pp.keys, NS);
      if (!v.ok) { send(res, 403, { why: `signature invalid: ${v.error}` }); return true; }
      const id = crypto.createHash('sha256').update(material).digest('hex').slice(0, 24);
      if (r.ids.has(id)) { send(res, 200, { ok: true, duplicate: true }); return true; }
      const times = (recent.get(b.by) || []).filter(t => t > Date.now() - 60000);
      if (times.length >= RATE) { send(res, 429, { why: 'slow down: too many messages in a minute' }); return true; }
      recent.set(b.by, [...times, Date.now()]);
      const msg = { seq: ++r.seq, id, at: b.at, by: b.by, to: other, enc: { iv: x.iv, ct: x.ct }, wraps: w, ...(b.reply ? { reply: b.reply } : {}), nonce: b.nonce, sig: b.sig };
      r.msgs.push(msg); r.ids.add(id);
      fs.mkdirSync(path.dirname(file(e.dir, key)), { recursive: true });
      fs.appendFileSync(file(e.dir, key), JSON.stringify(msg) + '\n');
      tellPair(b.by, other, msg.seq);
      send(res, 200, { ok: true, message: msg });
      return true;
    }

    const m = p.match(/^\/chat\/c\/([a-z0-9-]+)(\/delete|\/epochs)?$/);
    const c = m && s.channels.find(x => x.id === m[1]);
    if (!c) { send(res, 404, { why: 'no such channel' }); return true; }
    const r = room(e.dir, c.id, s.days);

    if (m[2] === '/epochs') {
      if (!encrypted(c)) { send(res, 404, { why: `#${c.id} is not encrypted` }); return true; }
      if (!canRead(e, c, who)) { send(res, 403, { why: who ? 'you cannot read this channel' : 'sign in to read this channel' }); return true; }
      const list = eps(e.dir, c.id), cur = list.at(-1);
      const mine = new Set((reg(e.dir)[who] || []).map(k => k.xpk));
      if (req.method === 'GET') {
        send(res, 200, { current: cur?.epoch || 0, stale: stale(e, cur), readers: readers(e), wrapped: cur ? Object.keys(cur.wraps) : [],
          epochs: list.map(x => ({ epoch: x.epoch, from: x.from, at: x.at, wraps: Object.fromEntries(Object.entries(x.wraps).filter(([k]) => mine.has(k)).map(([k, w]) => [k, { ...w, from: w.from || x.from }])) })) });
        return true;
      }
      if (req.method !== 'POST') { send(res, 405, { why: 'method not allowed' }); return true; }
      let b; try { b = JSON.parse(await body(req) || '{}'); } catch { send(res, 400, { why: 'not JSON' }); return true; }
      const want = Number(b.epoch), now = cur?.epoch || 0;
      if (want !== now && want !== now + 1) { send(res, 409, { why: 'someone else changed the channel key first: try again', current: now }); return true; }
      const all = reg(e.dir), wraps = {};
      for (const [xpk, w] of Object.entries(b.wraps || {})) {
        if (!w || !inBody(e.state, 'members', w.to) || !(all[w.to] || []).some(k => k.xpk === xpk)) { send(res, 400, { why: `a key was wrapped for someone who is not a reader` }); return true; }
        if (!mine.has(w.fromXpk) || ![w.iv, w.ct].every(x => typeof x === 'string' && B64.test(x) && x.length < 200)) { send(res, 400, { why: 'a wrapped key is not well formed' }); return true; }
        wraps[xpk] = { to: w.to, from: who, fromXpk: w.fromXpk, iv: w.iv, ct: w.ct };
      }
      if (!Object.keys(wraps).length) { send(res, 400, { why: 'no keys wrapped' }); return true; }
      if (want === now + 1) {
        if (!Object.keys(wraps).some(k => mine.has(k))) { send(res, 400, { why: 'a new epoch must include a key for its maker' }); return true; }
        list.push({ epoch: want, from: who, at: new Date().toISOString(), wraps });
        emit(e.dir, 'chat.epoch', { channel: c.id, epoch: want, by: who });
      } else {
        for (const [k, w] of Object.entries(wraps)) if (!cur.wraps[k]) cur.wraps[k] = w;
      }
      writeJson(efile(e.dir, c.id), list);
      keyPing(c.id);
      send(res, 200, { ok: true, current: list.at(-1).epoch });
      return true;
    }

    if (req.method === 'GET' && !m[2]) {
      if (!canRead(e, c, who)) { send(res, 403, { why: who ? 'you cannot read this channel' : 'sign in to read this channel' }); return true; }
      const after = Number(url.searchParams.get('after') || 0), before = Number(url.searchParams.get('before') || 0);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      let list = r.msgs.filter(x => x.seq > after && (!before || x.seq < before));
      list = after ? list.slice(0, limit) : list.slice(-limit);
      send(res, 200, { channel: c.id, seq: r.seq, messages: list.map(show), more: !after && r.msgs.length > 0 && list.length > 0 && list[0].seq > r.msgs[0].seq });
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, { why: 'method not allowed' }); return true; }
    let b; try { b = JSON.parse(await body(req) || '{}'); } catch { send(res, 400, { why: 'not JSON' }); return true; }
    const pp = e.state.participants[b.by];
    if (!pp || pp.status !== 'active') { send(res, 403, { why: `${b.by} is not an active member` }); return true; }
    if (typeof b.at !== 'string' || Math.abs(Date.now() - Date.parse(b.at)) > SKEW) { send(res, 400, { why: 'the time on this message is off by more than five minutes: check your computer’s clock' }); return true; }

    if (m[2]) {
      const x = r.msgs.find(y => y.id === b.id);
      if (!x || x.deleted) { send(res, 404, { why: 'no such message' }); return true; }
      const mod = isMod(e, s, b.by);
      if (x.by !== b.by && !mod) { send(res, 403, { why: 'only its author or a moderator can delete a message' }); return true; }
      const v = await keys.verify(deleteMaterial({ entity: e.state.entity.id, channel: c.id, id: b.id, by: b.by, at: b.at }), b.sig, pp.keys, NS);
      if (!v.ok) { send(res, 403, { why: `signature invalid: ${v.error}` }); return true; }
      const i = r.msgs.indexOf(x);
      r.msgs[i] = { seq: x.seq, id: x.id, at: x.at, by: x.by, deleted: { by: b.by, at: b.at } };
      save(e.dir, c.id, r);
      emit(e.dir, 'chat.delete', { channel: c.id, id: x.id, by: b.by, moderator: x.by !== b.by });
      ping(c.id, r.seq);
      send(res, 200, { ok: true });
      return true;
    }

    if (!canPost(e, c, b.by)) { send(res, 403, { why: c.post && c.post !== 'members' ? `only ${c.post} can write in #${c.id}` : 'you cannot write in this channel' }); return true; }
    let text, sealed = null;
    if (encrypted(c)) {
      const x = b.enc, cur = eps(e.dir, c.id).at(-1);
      if (!x || typeof x !== 'object' || b.text !== undefined) { send(res, 400, { why: `#${c.id} is encrypted: messages must be sealed in the page` }); return true; }
      if (!cur || x.epoch !== cur.epoch) { send(res, 409, { why: 'the channel key has changed: try again', current: cur?.epoch || 0 }); return true; }
      if (![x.iv, x.ct].every(y => typeof y === 'string' && B64.test(y)) || x.ct.length > Math.ceil((s.max * 4 + 16) / 3) * 4 + 4) { send(res, 400, { why: `a message is at most ${s.max} characters` }); return true; }
      sealed = { epoch: x.epoch, iv: x.iv, ct: x.ct };
      text = sealedText(sealed);
    } else {
      text = clean(b.text || '');
      if (!text) { send(res, 400, { why: 'say something' }); return true; }
      if (text.length > s.max) { send(res, 400, { why: `a message is at most ${s.max} characters` }); return true; }
      if (text !== b.text) { send(res, 400, { why: 'the text was not sent as signed' }); return true; }
    }
    if (typeof b.nonce !== 'string' || !/^[0-9a-f]{16,64}$/.test(b.nonce)) { send(res, 400, { why: 'missing nonce' }); return true; }
    if (b.reply && !r.msgs.some(y => y.id === b.reply)) { send(res, 400, { why: 'the message you replied to is gone' }); return true; }
    const material = postMaterial({ entity: e.state.entity.id, channel: c.id, by: b.by, at: b.at, nonce: b.nonce, reply: b.reply, text });
    const v = await keys.verify(material, b.sig, pp.keys, NS);
    if (!v.ok) { send(res, 403, { why: `signature invalid: ${v.error}` }); return true; }
    const id = crypto.createHash('sha256').update(material).digest('hex').slice(0, 24);
    if (r.ids.has(id)) { send(res, 200, { ok: true, duplicate: true }); return true; }
    const times = (recent.get(b.by) || []).filter(t => t > Date.now() - 60000);
    if (times.length >= RATE) { send(res, 429, { why: 'slow down: too many messages in a minute' }); return true; }
    recent.set(b.by, [...times, Date.now()]);
    const msg = { seq: ++r.seq, id, at: b.at, by: b.by, ...(sealed ? { enc: sealed } : { text }), ...(b.reply ? { reply: b.reply } : {}), nonce: b.nonce, sig: b.sig };
    r.msgs.push(msg); r.ids.add(id);
    fs.mkdirSync(path.dirname(file(e.dir, c.id)), { recursive: true });
    fs.appendFileSync(file(e.dir, c.id), JSON.stringify(msg) + '\n');
    ping(c.id, msg.seq);
    send(res, 200, { ok: true, message: show(msg) });
    return true;
  }
  return { handle };
}
