// chat.js · the chat page: channels on the left, the conversation on the
// right, a box to write in at the foot. Messages are signed here with your own
// key and kept by this site's node, never on the public record (cli/chat.js).
// What channels exist, who reads and writes each, and who moderates are the
// members' decision, by law (the chat module's settings).
//
// Members-only channels are end-to-end encrypted: messages are sealed here,
// with a channel key that only members' browsers hold, and opened here. The
// node keeps ciphertext (interface/js/chatcrypto.js has the details).
import { start, onSigned, ctx, h, $, me, displayName, nameOf, W, enabled, signInDialog, toast, E } from './common.js';
import { unlockSeed } from './interface/js/lock.js';
import * as cc from './interface/js/chatcrypto.js';

const NS = 'entity.chat';
const post = (m) => ['chat.post', m.entity, m.channel, m.by, m.at, m.nonce, m.reply || '', m.text].join('\n');
const del = (d) => ['chat.delete', d.entity, d.channel, d.id, d.by, d.at].join('\n');
const read = (t) => ['chat.read', t.entity, t.by, t.at].join('\n');
const roomM = (r) => ['chat.room', r.entity, r.by, r.at, r.id, r.title, r.about || '', r.read].join('\n');
const roomDelM = (r) => ['chat.room.delete', r.entity, r.by, r.at, r.id].join('\n');
// A direct message: sealed with a fresh key, wrapped for every chat key of both people.
const dmM = (m) => ['chat.dm', m.entity, m.by, m.to, m.at, m.nonce, m.reply || '', `enc:0:${m.enc.iv}:${m.enc.ct}`, E.canonical(m.wraps)].join('\n');
const dmDelM = (d) => ['chat.dm.delete', d.entity, d.by, d.at, d.id].join('\n');
const pairOf = (a, b) => [a, b].sort().join('~');
const isDm = (id) => String(id || '').startsWith('dm:');
const dmChannel = (other) => ({ id: `dm:${other}`, dm: true, with: other, title: other, canRead: true, canPost: true });

const S = { channels: [], current: null, msgs: new Map(), seq: {}, more: {}, moderator: false, max: 2000, days: 90, reply: null, stream: null, token: null, tokenAt: 0, seed: null, x: null, reg: null, ckeys: new Map(), ep: {}, dms: [], canOpen: false, dmOn: false };
const everything = () => [...S.channels, ...S.dms];
const entityId = () => ctx.r.state.entity.id;
const seen = () => { try { return JSON.parse(localStorage.getItem('site:chat-seen') || '{}'); } catch { return {}; } };
const markSeen = (ch, seq) => { const s = seen(); s[ch] = Math.max(s[ch] || 0, seq || 0); try { localStorage.setItem('site:chat-seen', JSON.stringify(s)); } catch { /* not kept */ } };

// ── your key, for signing messages and proving who is reading ─────────────
async function seed(ask = true) {
  const id = ctx.ident;
  if (!id || !me() || me().status !== 'active') return null;
  if (S.seed) return S.seed;
  if (id.seed) return (S.seed = id.seed);
  if (id.passkey) { if (ask) toast('Chat needs a password or a key kept in this browser; a passkey cannot sign chat messages yet.', true); return null; }
  if (!id.locked || !ask) return null;
  const pw = await askPassword(); if (!pw) return null;
  try { return (S.seed = await unlockSeed(id.locked, pw)); } catch { toast('Wrong password.', true); return null; }
}
const signWith = async (s, message) => E.keys.sign(message, { seed: s, publicKey: ctx.ident.publicKey }, NS);
function askPassword() {
  return new Promise((resolve) => {
    const input = h('input', { id: 'ch-pw', type: 'password', autocomplete: 'current-password', required: true });
    const form = h('form', { method: 'dialog' }, h('h2', {}, 'Unlock chat'),
      h('p', { class: 'fine' }, 'Your key is locked with your password. It stays unlocked on this page until you leave it, so you can read and write without typing it again.'),
      h('label', { for: 'ch-pw' }, 'Your password'), input,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Unlock'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(null); } }, 'Cancel')));
    const d = h('dialog', { class: 'site-dialog' }, form); document.body.append(d); d.showModal();
    d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
    setTimeout(() => input.focus(), 0);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = input.value; d.close(); resolve(v); });
  });
}
// A token proving who is reading, renewed every few minutes.
async function token(ask = false) {
  if (S.token && Date.now() - S.tokenAt < 8 * 60000) return S.token;
  const s = await seed(ask); if (!s) return null;
  const at = new Date().toISOString(), by = ctx.ident.id;
  S.token = btoa(JSON.stringify({ by, at, sig: await signWith(s, read({ entity: entityId(), by, at })) })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  S.tokenAt = Date.now();
  return S.token;
}
const api = async (path, opts = {}) => {
  const t = await token();
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(t ? { 'x-chat-token': t } : {}), ...(opts.headers || {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.why || `the server answered ${r.status}`), { status: r.status });
  return b;
};

// ── keys for encrypted channels ───────────────────────────────────────────
// Your chat key, derived from your signing key and registered with the node,
// signed so that no one, the node included, can put another key in its place.
async function mine() {
  if (S.x) return S.x;
  const s = await seed(false); if (!s) return null;
  const x = await cc.memberKey(s), by = ctx.ident.id;
  await registry();
  if (!(S.reg[by] || new Set()).has(x.xpk)) {
    await api('chat/keys', { method: 'POST', body: JSON.stringify({ by, xpk: x.xpk, sig: await signWith(s, cc.keyMaterial({ entity: entityId(), by, xpk: x.xpk })) }) });
    await registry(true);
  }
  return (S.x = x);
}
// Everyone's chat keys, each checked against that person's keys on the record.
async function registry(fresh = false) {
  if (S.reg && !fresh) return S.reg;
  const b = await api('chat/keys'), out = {};
  for (const [by, list] of Object.entries(b.keys || {})) {
    const p = ctx.r.state.participants[by]; if (!p) continue;
    for (const k of list) {
      if (!cc.validXpk(k.xpk)) continue;
      const v = await E.keys.verify(cc.keyMaterial({ entity: entityId(), by, xpk: k.xpk }), k.sig, p.keys, NS).catch(() => ({ ok: false }));
      if (v.ok) (out[by] ||= new Set()).add(k.xpk);
    }
  }
  return (S.reg = out);
}
const keyOf = (ch, epoch) => S.ckeys.get(ch)?.get(epoch);
// Fetch a channel's epochs; open the keys wrapped for you; start a new epoch
// when there is none or someone has left; share the key with members who lack it.
async function channelKeys(ch, again = true) {
  const x = await mine(); if (!x) return;
  const b = await api(`chat/c/${ch}/epochs`);
  const keys = S.ckeys.get(ch) || new Map(); S.ckeys.set(ch, keys);
  for (const ep of b.epochs) {
    if (keys.has(ep.epoch)) continue;
    const w = ep.wraps[x.xpk]; if (!w) continue;
    if (!(S.reg[w.from] || new Set()).has(w.fromXpk)) await registry(true);
    if (!(S.reg[w.from] || new Set()).has(w.fromXpk)) continue; // not a key anyone vouched for
    try { keys.set(ep.epoch, await cc.unwrapKey({ me: x, wrap: w, entity: entityId(), channel: ch, epoch: ep.epoch })); } catch { /* not for us after all */ }
  }
  S.ep[ch] = { current: b.current, has: keys.has(b.current) };
  const targets = (have) => {
    const out = [];
    for (const id of b.readers) for (const xpk of S.reg[id] || []) if (!have.has(xpk)) out.push([id, xpk]);
    return out;
  };
  if (!b.readers.every(id => S.reg[id]) ) await registry(true);
  try {
    if (b.current === 0 || b.stale) {
      const key = cc.channelKey(), epoch = b.current + 1, wraps = {};
      for (const [to, xpk] of targets(new Set())) wraps[xpk] = { to, ...(await cc.wrapKey({ me: x, toXpk: xpk, key, entity: entityId(), channel: ch, epoch })) };
      await api(`chat/c/${ch}/epochs`, { method: 'POST', body: JSON.stringify({ epoch, wraps }) });
      keys.set(epoch, key); S.ep[ch] = { current: epoch, has: true };
    } else if (keys.has(b.current)) {
      const need = targets(new Set(b.wrapped));
      if (need.length) {
        const key = keys.get(b.current), wraps = {};
        for (const [to, xpk] of need) wraps[xpk] = { to, ...(await cc.wrapKey({ me: x, toXpk: xpk, key, entity: entityId(), channel: ch, epoch: b.current })) };
        await api(`chat/c/${ch}/epochs`, { method: 'POST', body: JSON.stringify({ epoch: b.current, wraps }) });
      }
    }
  } catch (e) { if (e.status === 409 && again) return channelKeys(ch, false); throw e; }
}
// Open what can be opened; the rest stays sealed.
async function openSealed(ch, list) {
  const c = S.channels.find(y => y.id === ch);
  if (!c?.encrypted) return;
  if (list.some(m => m.enc && !keyOf(ch, m.enc.epoch))) { try { await channelKeys(ch); } catch { /* shown as sealed */ } }
  for (const m of list) {
    if (!m.enc || m.text !== undefined) continue;
    const key = keyOf(ch, m.enc.epoch);
    if (!key) { m.sealed = true; continue; }
    try { m.text = await cc.unseal({ key, sealed: m.enc, entity: entityId(), channel: ch, by: m.by, at: m.at, nonce: m.nonce, reply: m.reply || '' }); m.sealed = false; }
    catch { m.sealed = true; m.broken = true; }
  }
}

// ── loading ────────────────────────────────────────────────────────────────
async function loadChannels() {
  const b = await api('chat/channels');
  Object.assign(S, { channels: b.channels, moderator: b.moderator, max: b.max, days: b.days, canOpen: !!b.canOpen, dmOn: !!b.dm && me()?.status === 'active' });
  for (const c of b.channels) if (c.seq !== null) S.seq[c.id] = c.seq;
  if (S.dmOn) {
    try {
      const d = await api('chat/dm');
      const known = new Map(S.dms.map(x => [x.id, x]));
      for (const c of d.conversations) { const id = `dm:${c.with}`; if (!known.has(id)) known.set(id, dmChannel(c.with)); S.seq[id] = c.seq; }
      S.dms = [...known.values()];
    } catch { /* none yet */ }
  } else S.dms = [];
  const want = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (isDm(want) && S.dmOn && !S.dms.some(x => x.id === want) && ctx.r.state.participants[want.slice(3)]) S.dms.unshift(dmChannel(want.slice(3)));
  S.current = everything().find(c => c.id === want) || everything().find(c => c.id === S.current?.id) || S.channels.find(c => c.canRead) || S.channels[0] || null;
}
// Open the direct messages you can: the key wrapped for one of your chat keys,
// by a chat key the sender registered (checked against their record keys).
async function openDms(other, list) {
  const pair = pairOf(ctx.ident.id, other), where = { entity: entityId(), channel: `dm:${pair}` };
  for (const m of list) {
    if (m.deleted || m.text !== undefined) continue;
    const w = S.x && m.wraps?.[S.x.xpk];
    if (w && !(S.reg[m.by] || new Set()).has(w.fromXpk)) await registry(true);
    if (!w || !(S.reg[m.by] || new Set()).has(w.fromXpk)) { m.sealed = true; continue; }
    try {
      const key = await cc.unwrapKey({ me: S.x, wrap: w, ...where, epoch: m.nonce });
      m.text = await cc.unseal({ key, sealed: { epoch: 0, ...m.enc }, ...where, by: m.by, at: m.at, nonce: m.nonce, reply: m.reply || '' });
    } catch { m.sealed = true; m.broken = true; }
  }
}
async function loadMessages(ch, { older = false } = {}) {
  const have = S.msgs.get(ch) || [];
  if (isDm(ch)) {
    const other = ch.slice(3);
    const b = await api(`chat/dm/${other}${have.length ? `?after=${have.at(-1).seq}` : ''}`);
    await openDms(other, b.messages);
    const merged = new Map([...have, ...b.messages].map(m => [m.seq, m]));
    S.msgs.set(ch, [...merged.values()].sort((a, c) => a.seq - c.seq));
    S.seq[ch] = b.seq;
    return b.messages.length;
  }
  const q = older && have.length ? `?before=${have[0].seq}` : have.length ? `?after=${have.at(-1).seq}` : '';
  const b = await api(`chat/c/${ch}${q}`);
  await openSealed(ch, b.messages);
  const merged = new Map([...have, ...b.messages].map(m => [m.seq, m]));
  // A deleted message comes back as a tombstone with the same seq.
  for (const m of b.messages) merged.set(m.seq, m);
  S.msgs.set(ch, [...merged.values()].sort((a, c) => a.seq - c.seq));
  S.seq[ch] = b.seq;
  if (!have.length || older) S.more[ch] = b.more;
  return b.messages.length;
}
// A deletion changes a message already shown: fetch the channel again.
async function reload(ch) { S.msgs.delete(ch); await loadMessages(ch); }

function connect() {
  S.stream?.close();
  token().then((t) => {
    const es = new EventSource(`chat/stream${t ? `?t=${encodeURIComponent(t)}` : ''}`);
    S.stream = es;
    es.addEventListener('keys', async (ev) => {
      const { channel } = JSON.parse(ev.data);
      const c = S.channels.find(y => y.id === channel);
      // Someone new may need the key, or someone has shared it with you.
      if (!c?.encrypted || !c.canRead || (S.current?.id !== channel && !S.ckeys.has(channel))) return;
      const had = S.ep[channel]?.has;
      try { await channelKeys(channel); } catch { return; }
      if (S.current?.id === channel && !had && S.ep[channel]?.has) { await reload(channel); drawMessages(true); drawComposer(); }
    });
    // A room opened or closed: the list changed, and so must what this stream hears.
    es.addEventListener('rooms', async () => {
      try { await loadChannels(); } catch { return; }
      if (S.current && !everything().some(c => c.id === S.current.id)) S.current = S.channels.find(c => c.canRead) || null;
      draw(); connect();
    });
    es.addEventListener('dm', async (ev) => {
      const { with: other, seq } = JSON.parse(ev.data), id = `dm:${other}`;
      const before = S.seq[id] || 0; S.seq[id] = seq;
      if (!S.dms.some(x => x.id === id)) S.dms.unshift(dmChannel(other));
      if (S.current?.id === id) {
        const atBottom = nearBottom();
        try { if (seq <= before) await reload(id); else await loadMessages(id); } catch { /* next time */ }
        drawMessages(atBottom); if (document.visibilityState === 'visible') markSeen(id, S.seq[id]);
      }
      drawSide();
    });
    es.addEventListener('message', async (ev) => {
      const { channel, seq } = JSON.parse(ev.data);
      const before = S.seq[channel] || 0;
      S.seq[channel] = seq;
      if (S.current?.id === channel) {
        const atBottom = nearBottom();
        try { if (seq <= before) await reload(channel); else await loadMessages(channel); } catch { /* try on the next */ }
        drawMessages(atBottom); if (document.visibilityState === 'visible') markSeen(channel, S.seq[channel]);
      }
      drawSide();
    });
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  });
}

// ── drawing ────────────────────────────────────────────────────────────────
const when = (iso) => {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
// Text: links, @mentions and `code`, everything else as typed.
function rich(text) {
  const out = [], re = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(@[a-z0-9][a-z0-9-]{0,39})|(`[^`\n]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
    else if (m[2]) { const id = m[2].slice(1), known = ctx.r.state.participants[id]; out.push(h('span', { class: `mention${me() && id === me().id ? ' me' : ''}`, title: known ? displayName(id) : '' }, known ? `@${nameOf(id)}` : m[2])); }
    else out.push(h('code', {}, m[3].slice(1, -1)));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
const nearBottom = () => { const l = $('#chat-log'); return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 80; };

function drawSide() {
  const s = seen(), w = W();
  const list = S.channels.map(c => {
    const unread = c.canRead && (S.seq[c.id] || 0) > (s[c.id] || 0) && S.current?.id !== c.id;
    return h('li', {}, h('a', { href: `#/${c.id}`, class: `${S.current?.id === c.id ? 'on' : ''}${unread ? ' unread' : ''}`, 'aria-current': S.current?.id === c.id ? 'page' : null },
      h('span', { class: 'hash', 'aria-hidden': 'true' }, '#'), c.id, !c.canRead ? h('span', { class: 'lock', title: `${w.Many} only` }, ' · members') : unread ? h('span', { class: 'visually-hidden' }, ' (new messages)') : null));
  });
  $('#chat-channels').replaceChildren(...(list.length ? list : [h('li', { class: 'empty' }, 'No channels yet.')]));
  for (const [i, c] of S.channels.entries()) if (c.room) list[i].firstChild.append(h('span', { class: 'room-mark', title: `A room ${displayName(c.by)} opened` }, ' · room'));
  $('#chat-new-room').hidden = !S.canOpen;
  $('#chat-new-room').replaceChildren(h('button', { class: 'linklike', type: 'button', onclick: newRoom }, '+ Open a room'));
  const dms = S.dms.map(c => {
    const unread = (S.seq[c.id] || 0) > (s[c.id] || 0) && S.current?.id !== c.id;
    return h('li', {}, h('a', { href: `#/${c.id}`, class: `${S.current?.id === c.id ? 'on' : ''}${unread ? ' unread' : ''}`, 'aria-current': S.current?.id === c.id ? 'page' : null },
      h('span', { class: 'hash', 'aria-hidden': 'true' }, '@'), ctx.r.state.participants[c.with] ? nameOf(c.with) : c.with, unread ? h('span', { class: 'visually-hidden' }, ' (new messages)') : null));
  });
  for (const id of ['#chat-dms-h', '#chat-dms', '#chat-new-dm']) $(id).hidden = !S.dmOn;
  $('#chat-dms').replaceChildren(...(dms.length ? dms : [h('li', { class: 'empty' }, 'None yet.')]));
  $('#chat-new-dm').replaceChildren(h('button', { class: 'linklike', type: 'button', onclick: newDm }, '+ New message'));
  $('#chat-pick').replaceChildren(...everything().map(c => h('option', { value: c.id, selected: S.current?.id === c.id || null }, `${c.dm ? `@${nameOf(c.with)}` : `#${c.id}`}${(S.seq[c.id] || 0) > (s[c.id] || 0) && S.current?.id !== c.id ? ' •' : ''}`)));
  $('#chat-who').replaceChildren(me() ? `Signed in as ${displayName(me().id)}` : h('span', {}, h('button', { class: 'linklike', type: 'button', onclick: () => signInDialog() }, 'Sign in'), ' to write'));
}

function drawHeader() {
  const c = S.current;
  $('#chat-head-acts').hidden = !c?.room || !c.canClose;
  if (c?.room && c.canClose) $('#chat-head-acts').replaceChildren(h('button', { class: 'linklike', type: 'button', onclick: () => closeRoom(c) }, c.by === me()?.id ? 'Close this room' : 'Close this room (moderator)'));
  if (c?.dm) {
    $('#chat-title').textContent = `@${nameOf(c.with)}`;
    $('#chat-about').textContent = `Between you and ${displayName(c.with)} only. Sealed in your browser for the two of you: this site’s server passes them on and cannot read them.`;
    return;
  }
  $('#chat-title').textContent = c ? `#${c.id}` : 'Chat';
  $('#chat-about').textContent = c ? [c.title !== c.id ? c.title : '', c.about, c.read === 'public' ? 'Anyone can read this channel.' : c.encrypted ? `Only ${W().many} can read it, and messages are encrypted in your browser: this site’s server cannot read them.` : `Only ${W().many} can read it.`, c.post !== 'members' ? `Only ${c.post.replace(/^office:/, 'holders of the office ').replace(/^committee:/, 'the committee ')} can write here.` : ''].filter(Boolean).join(' · ') : '';
}

function messageEl(m, prev) {
  const grouped = prev && !prev.deleted && !m.deleted && prev.by === m.by && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60000 && !m.reply;
  const mine = me() && m.by === me().id;
  const actions = [];
  if (!m.deleted && S.current?.canPost) actions.push(h('button', { class: 'linklike', type: 'button', onclick: () => { S.reply = m; drawComposer(); $('#chat-text').focus(); } }, 'Reply'));
  if (!m.deleted && (mine || (S.moderator && !S.current?.dm))) actions.push(h('button', { class: 'linklike', type: 'button', onclick: () => remove(m) }, mine ? 'Delete' : 'Delete (moderator)'));
  const parent = m.reply ? (S.msgs.get(S.current.id) || []).find(x => x.id === m.reply) : null;
  return h('li', { class: `msg${grouped ? ' cont' : ''}${m.text && me() && new RegExp(`@${me().id}\\b`).test(m.text) ? ' to-me' : ''}`, id: `m-${m.id}` },
    m.reply ? h('p', { class: 'reply-to' }, '↳ ', parent ? [h('strong', {}, nameOf(parent.by)), ' ', parent.deleted ? 'deleted message' : parent.sealed ? 'an encrypted message' : String(parent.text).slice(0, 90)] : 'a message no longer kept') : null,
    grouped ? null : h('p', { class: 'meta' }, h('strong', {}, displayName(m.by)), ' ', h('time', { datetime: m.at }, when(m.at))),
    m.deleted ? h('p', { class: 'gone' }, m.deleted.by === m.by ? 'Deleted by its author.' : `Deleted by a moderator, ${displayName(m.deleted.by)}.`)
      : m.sealed ? h('p', { class: 'gone' }, m.broken ? 'This message could not be opened: it was altered, or sealed with the wrong key.' : 'Encrypted before you could read this channel.')
      : h('p', { class: 'text' }, rich(m.text)),
    actions.length ? h('span', { class: 'acts' }, actions) : null);
}

function drawMessages(stick = true) {
  const log = $('#chat-log'), c = S.current;
  if (!c) { log.replaceChildren(h('li', { class: 'empty' }, `No channels yet. The ${W().many} add channels by law (chat.channels).`)); return; }
  if (!c.canRead) {
    log.replaceChildren(h('li', { class: 'empty' }, me() ? `Only ${W().many} can read #${c.id}.` : [`#${c.id} is for ${W().many}. `, h('button', { class: 'linklike', type: 'button', onclick: async () => { if (await signInDialog()) boot(); } }, 'Sign in'), ' to read it.']));
    return;
  }
  const msgs = S.msgs.get(c.id) || [];
  const kids = [];
  if (S.more[c.id]) kids.push(h('li', { class: 'older' }, h('button', { class: 'quiet', type: 'button', onclick: async () => { const top = log.scrollHeight; await loadMessages(c.id, { older: true }); drawMessages(false); log.scrollTop = log.scrollHeight - top; } }, 'Show earlier messages')));
  let day = '';
  msgs.forEach((m, i) => {
    const d = new Date(m.at).toDateString();
    if (d !== day) { day = d; kids.push(h('li', { class: 'day', role: 'separator' }, new Date(m.at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))); }
    kids.push(messageEl(m, i && new Date(msgs[i - 1].at).toDateString() === d ? msgs[i - 1] : null));
  });
  if (!msgs.length) kids.push(h('li', { class: 'empty' }, c.dm ? `No messages with ${nameOf(c.with)} yet.` : `Nothing said in #${c.id} yet${c.canPost ? '. Say hello.' : '.'}`));
  log.replaceChildren(...kids);
  if (stick) log.scrollTop = log.scrollHeight;
}

function drawComposer() {
  const c = S.current, box = $('#chat-compose');
  const waiting = !!c?.encrypted && c.canRead && !S.ep[c.id]?.has;
  const canWrite = !!c && c.canPost && me()?.status === 'active' && !waiting;
  box.hidden = !c;
  $('#chat-text').disabled = !canWrite;
  $('#chat-send').disabled = !canWrite;
  $('#chat-text').placeholder = !c ? '' : c.dm ? (canWrite ? `Message @${nameOf(c.with)}` : 'Sign in to write') : waiting && c.canPost ? 'Waiting for another member to share this channel’s key with you' : canWrite ? `Message #${c.id}` : !me() ? 'Sign in to write' : me().status !== 'active' ? `Only ${W().many} can write` : `You cannot write in #${c.id}`;
  $('#chat-reply').replaceChildren(...(S.reply ? [h('span', {}, 'Replying to ', h('strong', {}, nameOf(S.reply.by)), `: ${String(S.reply.text).slice(0, 80)}`), h('button', { class: 'linklike', type: 'button', onclick: () => { S.reply = null; drawComposer(); } }, 'Cancel')] : []));
  $('#chat-reply').hidden = !S.reply;
  $('#chat-limit').textContent = `${c?.encrypted || c?.dm ? 'End-to-end encrypted. ' : ''}Kept for ${S.days} days, never on the public record.`;
}

function draw() { drawSide(); drawHeader(); drawMessages(); drawComposer(); }

// ── writing and deleting ───────────────────────────────────────────────────
async function send(ev) {
  ev?.preventDefault();
  const ta = $('#chat-text'), text = ta.value.replace(/\r\n?/g, '\n').trim(), c = S.current;
  if (!text || !c) return;
  if (text.length > S.max) { toast(`A message is at most ${S.max} characters.`, true); return; }
  const s = await seed(true); if (!s) return;
  const m = { entity: entityId(), channel: c.id, by: ctx.ident.id, at: new Date().toISOString(), nonce: [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join(''), reply: S.reply?.id || '', text };
  $('#chat-send').disabled = true;
  const sendOnce = async () => {
    if (c.dm) return sendDm(s, c.with, m);
    if (!c.encrypted) return api(`chat/c/${c.id}`, { method: 'POST', body: JSON.stringify({ ...m, reply: m.reply || undefined, sig: await signWith(s, post(m)) }) });
    const epoch = S.ep[c.id]?.current, key = keyOf(c.id, epoch);
    if (!key) throw new Error('You do not have this channel’s key yet.');
    const { text: _t, ...head } = m;
    const enc = await cc.seal({ key, text, ...head, epoch });
    return api(`chat/c/${c.id}`, { method: 'POST', body: JSON.stringify({ ...head, reply: m.reply || undefined, enc, sig: await signWith(s, post({ ...head, text: cc.sealedText(enc) })) }) });
  };
  try {
    try { await sendOnce(); } catch (e) { if (e.status !== 409 || !c.encrypted) throw e; await channelKeys(c.id); await sendOnce(); }
    ta.value = ''; S.reply = null; autosize();
    await loadMessages(c.id); drawMessages(true); drawComposer(); markSeen(c.id, S.seq[c.id]);
  } catch (e) { toast(e.message, true); }
  $('#chat-send').disabled = false; ta.focus();
}
// A direct message: a fresh key seals it; the key is wrapped for each chat key
// of the recipient and of the sender (so it reads on any of their devices).
async function sendDm(s, other, m) {
  await mine(); await registry(true);
  const theirs = [...(S.reg[other] || [])], ours = [...(S.reg[m.by] || [])];
  if (!theirs.length) throw new Error(`${nameOf(other)} has not opened the chat yet, so there is no key to seal a message for them.`);
  const pair = pairOf(m.by, other), where = { entity: m.entity, channel: `dm:${pair}` };
  const key = cc.channelKey();
  const enc = await cc.seal({ key, text: m.text, ...where, epoch: 0, by: m.by, at: m.at, nonce: m.nonce, reply: m.reply });
  const wraps = {};
  for (const xpk of new Set([...theirs, ...ours, S.x.xpk])) wraps[xpk] = await cc.wrapKey({ me: S.x, toXpk: xpk, key, ...where, epoch: m.nonce });
  const body = { entity: m.entity, by: m.by, to: other, at: m.at, nonce: m.nonce, ...(m.reply ? { reply: m.reply } : {}), enc: { iv: enc.iv, ct: enc.ct }, wraps };
  return api(`chat/dm/${other}`, { method: 'POST', body: JSON.stringify({ ...body, sig: await signWith(s, dmM(body)) }) });
}
async function newDm() {
  const people = ctx.r.state.order.filter(id => id !== me()?.id && ctx.r.state.participants[id].status === 'active');
  const sel = h('select', { id: 'dm-to' }, people.map(id => h('option', { value: id }, displayName(id))));
  const form = h('form', { method: 'dialog' }, h('h2', {}, 'New message'),
    h('p', { class: 'fine' }, 'Only the two of you can read it: it is sealed in your browser, and this site’s server cannot open it.'),
    h('label', { for: 'dm-to' }, 'To'), sel,
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Write'), h('button', { class: 'secondary', type: 'button', onclick: () => d.close() }, 'Cancel')));
  const d = h('dialog', { class: 'site-dialog' }, form); document.body.append(d); d.showModal();
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
  form.addEventListener('submit', (ev) => { ev.preventDefault(); const to = sel.value; d.close(); if (!to) return; if (!S.dms.some(x => x.with === to)) S.dms.unshift(dmChannel(to)); location.hash = `#/dm:${to}`; });
}
async function newRoom() {
  const form = h('form', { method: 'dialog' }, h('h2', {}, 'Open a room'),
    h('p', { class: 'fine' }, 'A room of your own, beside the channels the law names. You, or a moderator, can close it; its messages go with it.'),
    h('label', { for: 'rm-title' }, 'Name'), h('input', { id: 'rm-title', required: true, maxlength: 80, placeholder: 'Garden club' }),
    h('label', { for: 'rm-id' }, 'Address'), h('input', { id: 'rm-id', required: true, maxlength: 40, placeholder: 'garden-club', pattern: '[a-z0-9][a-z0-9-]*' }),
    h('label', { for: 'rm-about' }, 'What it is for (optional)'), h('input', { id: 'rm-about', maxlength: 300 }),
    h('label', { for: 'rm-read' }, 'Who can read it'), h('select', { id: 'rm-read' }, h('option', { value: 'members' }, `${W().Many} only, encrypted`), h('option', { value: 'public' }, 'Anyone')),
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Open it'), h('button', { class: 'secondary', type: 'button', onclick: () => d.close() }, 'Cancel')));
  const d = h('dialog', { class: 'site-dialog' }, form); document.body.append(d); d.showModal();
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
  const t = $('#rm-title', d), i = $('#rm-id', d);
  t.addEventListener('input', () => { if (!i.dataset.touched) i.value = t.value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); });
  i.addEventListener('input', () => { i.dataset.touched = '1'; });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const s = await seed(true); if (!s) return;
    const r = { entity: entityId(), by: ctx.ident.id, at: new Date().toISOString(), id: i.value.trim(), title: t.value.trim(), about: $('#rm-about', d).value.trim(), read: $('#rm-read', d).value };
    try {
      await api('chat/rooms', { method: 'POST', body: JSON.stringify({ ...r, sig: await signWith(s, roomM(r)) }) });
      d.close(); await loadChannels(); location.hash = `#/${r.id}`; connect();
    } catch (e) { toast(e.message, true); }
  });
}
async function closeRoom(c) {
  if (!confirm(`Close #${c.id}? Its messages are deleted from this site’s server for good.`)) return;
  const s = await seed(true); if (!s) return;
  const r = { entity: entityId(), by: ctx.ident.id, at: new Date().toISOString(), id: c.id };
  try { await api(`chat/rooms/${c.id}/delete`, { method: 'POST', body: JSON.stringify({ ...r, sig: await signWith(s, roomDelM(r)) }) }); S.msgs.delete(c.id); location.hash = ''; await loadChannels(); S.current = S.channels.find(x => x.canRead) || null; draw(); connect(); }
  catch (e) { toast(e.message, true); }
}
async function remove(m) {
  if (S.current?.dm) {
    if (!confirm('Delete your message? It is removed for both of you, from this site’s server, for good.')) return;
    const s = await seed(true); if (!s) return;
    const d = { entity: entityId(), by: ctx.ident.id, at: new Date().toISOString(), id: m.id };
    try { await api(`chat/dm/${S.current.with}/delete`, { method: 'POST', body: JSON.stringify({ ...d, sig: await signWith(s, dmDelM(d)) }) }); await reload(S.current.id); drawMessages(false); }
    catch (e) { toast(e.message, true); }
    return;
  }
  const mine = me() && m.by === me().id;
  if (!confirm(mine ? 'Delete your message? It is removed from this site’s server for good.' : `Delete ${nameOf(m.by)}’s message as a moderator? The deletion is logged.`)) return;
  const s = await seed(true); if (!s) return;
  const d = { entity: entityId(), channel: S.current.id, id: m.id, by: ctx.ident.id, at: new Date().toISOString() };
  try { await api(`chat/c/${S.current.id}/delete`, { method: 'POST', body: JSON.stringify({ ...d, sig: await signWith(s, del(d)) }) }); await reload(S.current.id); drawMessages(false); }
  catch (e) { toast(e.message, true); }
}
function autosize() { const ta = $('#chat-text'); ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`; }

// ── starting ───────────────────────────────────────────────────────────────
async function open(id) {
  if (isDm(id) && S.dmOn && !S.dms.some(x => x.id === id) && ctx.r.state.participants[id.slice(3)]) S.dms.unshift(dmChannel(id.slice(3)));
  const c = everything().find(x => x.id === id) || S.current; if (!c) return;
  S.current = c; S.reply = null;
  if (c.dm) { try { await mine(); await registry(); } catch (e) { toast(e.message, true); } }
  if (c.canRead && c.encrypted && !S.ep[c.id]?.has) { try { await channelKeys(c.id); } catch (e) { toast(e.message, true); } }
  if (c.canRead && !S.msgs.has(c.id)) { try { await loadMessages(c.id); } catch (e) { toast(e.message, true); } }
  draw(); markSeen(c.id, S.seq[c.id]); drawSide();
}
async function boot() {
  if (!ctx.r.ok) { $('#chat-log').replaceChildren(h('li', { class: 'empty' }, 'The record did not verify.')); return; }
  if (!enabled('chat')) { $('#chat-log').replaceChildren(h('li', { class: 'empty' }, `Chat is not switched on. The ${W().many} can add it by vote, under Institutions › Modules.`)); $('#chat-compose').hidden = true; return; }
  S.token = null; S.msgs.clear(); S.ckeys.clear(); S.ep = {}; S.x = null; S.reg = null;
  if (me()?.status === 'active' && !ctx.ident.seed && ctx.ident.locked && !S.seed) {
    $('#chat-log').replaceChildren(h('li', { class: 'empty' }, 'Your key is locked. ', h('button', { class: 'primary', type: 'button', onclick: async () => { if (await seed(true)) boot(); } }, 'Unlock chat'), ' Public channels show below once you do; or read them without unlocking: ', h('button', { class: 'linklike', type: 'button', onclick: () => { S.seed = null; S.skipUnlock = true; go(); } }, 'just read')));
    if (!S.skipUnlock) return;
  }
  await go();
}
async function go() {
  try { await loadChannels(); } catch (e) { $('#chat-log').replaceChildren(h('li', { class: 'empty' }, `The chat could not be reached: ${e.message}`)); return; }
  await open(S.current?.id);
  connect();
}

$('#chat-form').addEventListener('submit', send);
$('#chat-text').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) send(ev); });
$('#chat-text').addEventListener('input', autosize);
$('#chat-pick').addEventListener('change', (ev) => { location.hash = `#/${ev.target.value}`; });
addEventListener('hashchange', () => open(decodeURIComponent(location.hash.replace(/^#\/?/, ''))));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.current) { markSeen(S.current.id, S.seq[S.current.id]); drawSide(); } });
onSigned(() => { S.seed = null; S.token = null; boot(); });
await start();
boot();
