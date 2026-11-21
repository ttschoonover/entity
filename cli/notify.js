// notify.js · the node's side of the notify module: where each member's
// notices go, what to tell them after each settlement, and delivery.
//
// Everything lives in .entity/notify/ beside the record, never in it:
//
//   keys.json     the node's notify key (X25519, for subscription proofs) and
//                 its VAPID key (P-256, its identity to push services)
//   subs.json     { member: [subscription] }   push endpoints, email, phone
//   state.json    { lastSeq, nudged: { member: at }, seen: [mac] }
//   outbox.jsonl  deliveries waiting (sent by `entity serve`, or `entity notify send`)
//   inbox/ID.jsonl  each member's last notices, sealed to their record key
//
// A notice is sealed to the member's record key (kernel/notice.js) before it
// is written anywhere. A push carries it sealed once more, to the browser
// (cli/webpush.js). An email or text message carries no notice at all: only
// that there is something new and a link, unless the republic allows
// (notify.plaintext_email) and the member chose to have the title in clear.
//
// A node that cannot read the record (zero-knowledge) knows no events: when
// sealed acts or records arrive, it sends each subscribed member a sealed
// "something new", at most once an hour.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as N from '../kernel/notice.js';
import * as WP from './webpush.js';
import { sealing as S } from '../kernel/index.js';
import * as store from '../kernel/store.js';
import { proposalId } from '../modules/deliberation/index.js';

export const EVENTS = ['trades', 'proposals', 'reminders', 'decisions', 'members', 'notices'];
const MAX_SUBS = 10, INBOX_KEEP = 100, BURST = 8, HOUR = 3600000;
const dirOf = (dir) => path.join(dir, '.entity', 'notify');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(t, f); }
const appendLine = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.appendFileSync(f, JSON.stringify(v) + '\n', { mode: 0o600 }); };
const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };

export const enabled = (e) => !e.unreadable && !!e.params?.value('entity.modules')?.includes('notify');
const entityIdOf = (e) => e.state?.entity?.id || e.records?.[0]?.payload?.act?.entity || null;
const hasSubs = (dir) => Object.values(readSubs(dir)).some(l => l.length);

// ── keys ────────────────────────────────────────────────────────────────────
export async function nodeKeys(dir) {
  const f = path.join(dirOf(dir), 'keys.json');
  let k = readJson(f, null);
  if (!k) {
    const nk = await N.notifyKeyPair();
    k = { notify: { sk: N.b64(nk.sk), pk: N.b64(nk.pk) }, vapid: WP.vapidKeys(), made: new Date().toISOString() };
    writeJson(f, k);
  }
  return k;
}
export async function publicKeys(dir) { const k = await nodeKeys(dir); return { nodeKey: k.notify.pk, vapidKey: k.vapid.publicKey }; }

export const readSubs = (dir) => readJson(path.join(dirOf(dir), 'subs.json'), {});
const writeSubs = (dir, s) => writeJson(path.join(dirOf(dir), 'subs.json'), s);
const readState = (dir) => readJson(path.join(dirOf(dir), 'state.json'), { lastSeq: null, nudged: {}, seen: [] });
const writeState = (dir, s) => writeJson(path.join(dirOf(dir), 'state.json'), s);

// Each member's record key: from the state when this copy reads the record,
// otherwise from the public member.recordkey records (always in the clear).
export function recordKeysOf(e) {
  if (e.state && !e.unreadable) return S.sealingState(e.state).keys;
  const keys = {};
  for (const r of e.records || []) if (r.kind === 'member.recordkey') keys[r.payload.act.by] = r.payload.act.key;
  return keys;
}

// ── requests from members: subscribe, unsubscribe, read the inbox ───────────
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i, PHONE = /^\+[1-9][0-9]{6,14}$/;
const subId = (s) => crypto.createHash('sha256').update(`${s.channel}\n${s.push?.endpoint || s.address}`).digest('hex').slice(0, 16);

export async function handle(e, req, { now = Date.now() } = {}) {
  const fail = (m) => ({ ok: false, error: m });
  if (!req || typeof req !== 'object') return fail('send a signed request');
  if (req.entity !== entityIdOf(e)) return fail('that request is for another entity');
  const at = Date.parse(req.at);
  if (!(Math.abs(now - at) < 10 * 60000)) return fail('the request is stale: check this device\'s clock');
  const recordKey = recordKeysOf(e)[req.member];
  if (!recordKey) return fail(`${req.member} has published no record key: publish one first (You → the sealed record)`);
  const k = await nodeKeys(e.dir);
  if (!(await N.checkRequest(req, { nodeSk: N.unb64(k.notify.sk), recordKey }))) return fail('the request is not signed with that member\'s record key');
  const st = readState(e.dir);
  if (st.seen.includes(req.mac)) return fail('that request was already used');
  st.seen = [...st.seen, req.mac].slice(-500); writeState(e.dir, st);
  if (e.state && !e.unreadable && e.state.participants[req.member]?.status !== 'active') return fail('only an active member has notices');

  const subs = readSubs(e.dir), mine = subs[req.member] || [];
  if (req.op === 'inbox') return { ok: true, notices: readLines(path.join(dirOf(e.dir), 'inbox', `${req.member}.jsonl`)).filter(n => !req.since || n.at > req.since) };
  if (req.op === 'list') return { ok: true, subscriptions: mine.map(({ push, ...s }) => ({ ...s, endpoint: push?.endpoint ? new URL(push.endpoint).host : undefined })) };
  if (req.op === 'unsubscribe') { subs[req.member] = mine.filter(s => s.id !== req.id); writeSubs(e.dir, subs); return { ok: true }; }
  if (req.op !== 'subscribe') return fail('op is subscribe, unsubscribe, list or inbox');
  const allowed = e.params && !e.unreadable ? e.params.value('notify.events') : EVENTS;
  const events = (Array.isArray(req.events) ? req.events : allowed).filter(x => EVENTS.includes(x) && allowed.includes(x));
  const s = { channel: req.channel, events, recordKey, at: req.at, ...(req.label ? { label: String(req.label).slice(0, 60) } : {}) };
  if (req.channel === 'push') {
    const p = req.push;
    if (!p || typeof p.endpoint !== 'string' || !/^https:\/\//.test(p.endpoint) || !p.keys?.p256dh || !p.keys?.auth) return fail('a push subscription needs an https endpoint and its keys');
    try { WP.encrypt(p, 'x'); } catch (err) { return fail(err.message); }
    s.push = { endpoint: p.endpoint, keys: { p256dh: p.keys.p256dh, auth: p.keys.auth } };
  } else if (req.channel === 'email' || req.channel === 'sms') {
    const a = String(req.address || '').trim();
    if (!(req.channel === 'email' ? EMAIL : PHONE).test(a)) return fail(req.channel === 'email' ? 'that is not an email address' : 'give the number in international form, +15105551234');
    s.address = a;
    s.plaintext = req.channel === 'email' && !!req.plaintext && !!e.params && !e.unreadable && e.params.value('notify.plaintext_email') === true;
  } else return fail('channel is push, email or sms');
  s.id = subId(s);
  const rest = mine.filter(x => x.id !== s.id);
  if (rest.length >= MAX_SUBS) return fail(`at most ${MAX_SUBS} places to send notices`);
  subs[req.member] = [...rest, s]; writeSubs(e.dir, subs);
  return { ok: true, id: s.id, events };
}

// ── what happened, in words ─────────────────────────────────────────────────
function noticesOf(e, views) {
  const st = e.state, out = [];
  const name = (id) => st.m?.titles?.[id] || st.participants[id]?.name || id;
  for (const r of views) {
    const a = r.payload?.act || {};
    const base = { seq: r.seq, kind: r.kind, at: r.at, author: r.author || a.by || null };
    if (r.kind === 'proposal.lay') {
      const id = proposalId(a);
      const trades = (a.effects || []).filter(x => x.kind === 'fund.authorize' || x.kind === 'fund.cancel');
      if (trades.length) out.push({ ...base, event: 'trades', urgent: true, title: `Trade to vote on: ${trades.map(tradeWords).join('; ')}`,
        text: `${name(a.by)} proposes it (${a.title}). Every partner decides every trade: vote before it closes.`, url: `#/votes/${id}` });
      else out.push({ ...base, event: 'proposals', title: `New proposal: ${a.title || st.proposals?.[id]?.title || 'untitled'}`, text: `${name(a.by)} proposes it; it is open for your vote.`, url: `#/votes/${id}` });
    } else if (r.kind === 'proposal.closed') {
      const p = st.proposals?.[r.payload.proposal];
      out.push({ ...base, author: null, event: 'decisions', title: `${p?.title || r.payload.proposal}: ${r.payload.carried ? 'carried' : 'not carried'}`, text: r.payload.carried ? (r.payload.enacted ? 'It is in force.' : 'It awaits a further reading.') : 'It did not pass.', url: `#/votes/${r.payload.proposal}` });
    } else if (['participant.apply', 'participant.admitted', 'participant.admit', 'participant.leave', 'participant.remove'].includes(r.kind)) {
      const who = r.kind === 'participant.apply' || r.kind === 'participant.leave' ? a.by : r.payload.id;
      const status = st.participants[who]?.status;
      const t = { 'participant.apply': status === 'active' ? 'joined' : 'applied to join', 'participant.admitted': 'was admitted', 'participant.admit': 'was admitted', 'participant.leave': 'left', 'participant.remove': 'was removed' }[r.kind];
      out.push({ ...base, event: 'members', title: `${name(who)} ${t}`, text: '', url: `#/members/${who}` });
    } else if (r.kind === 'notice.post') {
      out.push({ ...base, event: 'notices', title: a.title, text: a.text || '', url: '#/notify' });
    } else if (r.kind === 'participation.notice') {
      // An officer's notice to one partner: sent to that partner only.
      out.push({ ...base, event: 'notices', only: r.payload.member, title: 'A participation notice to you', text: r.payload.reason || 'You are below the participation the agreement requires.', url: '#/participation' });
    }
  }
  return out;
}

// After a settlement: seal each new notice to each member who wants it, keep
// it in their inbox, and queue the deliveries. Called by settlePending.
export async function afterSettle(e) {
  if (!enabled(e)) return { queued: 0 };
  const st = readState(e.dir), head = e.views?.length ? e.views[e.views.length - 1].seq : 0;
  if (st.lastSeq === null) { st.lastSeq = head; writeState(e.dir, st); return { queued: 0 }; } // first run: no flood of the past
  const fresh = (e.views || []).filter(v => v.seq > st.lastSeq);
  st.lastSeq = head; writeState(e.dir, st);
  if (!fresh.length) return { queued: 0 };
  const allowed = e.params.value('notify.events'), subs = readSubs(e.dir), keys = recordKeysOf(e);
  const entity = e.state.entity.id, from = e.params.value('entity.name');
  const notices = noticesOf(e, fresh).filter(n => allowed.includes(n.event));
  let queued = 0;
  for (const [member, list] of Object.entries(subs)) {
    if (e.state.participants[member]?.status !== 'active' || !keys[member]) continue;
    const live = list.filter(s => s.recordKey === keys[member]);          // a changed record key ends old subscriptions
    if (live.length !== list.length) { subs[member] = live; writeSubs(e.dir, subs); }
    const forMe = notices.filter(n => n.author !== member && (!n.only || n.only === member));
    if (!forMe.length) continue;
    const sealedAll = [];
    for (const n of forMe) {
      const sealed = await N.sealNotice({ entity, to: member, recordKey: keys[member] }, { from, seq: n.seq, kind: n.kind, event: n.event, title: n.title, text: n.text, url: n.url, at: n.at });
      sealedAll.push({ n, sealed: { ...sealed, at: n.at, seq: n.seq } });
      appendLine(path.join(dirOf(e.dir), 'inbox', `${member}.jsonl`), { ...sealed, at: n.at, seq: n.seq });
    }
    trimInbox(e.dir, member);
    for (const s of live) {
      const mine = sealedAll.filter(x => s.events.includes(x.n.event));
      if (!mine.length) continue;
      if (s.channel === 'push') {
        // A burst becomes one summary push; every notice is still in the inbox.
        const send = mine.length > BURST ? [{ sealed: await N.sealNotice({ entity, to: member, recordKey: keys[member] }, { from, title: `${mine.length} new things`, text: 'Open the page to see them.', url: '#/', at: new Date().toISOString() }) }] : mine;
        for (const x of send) { queue(e.dir, { member, sub: s.id, channel: 'push', payload: JSON.stringify({ v: 1, n: x.sealed }) }); queued++; }
      } else {
        const label = S.sealingOn(e.state) ? 'your group' : from;
        const one = mine.length === 1 && s.plaintext ? mine[0].n : null;
        queue(e.dir, { member, sub: s.id, channel: s.channel, subject: one ? one.title : `Something new in ${label}`,
          text: `${one ? `${one.title}\n${one.text ? `${one.text}\n` : ''}\n` : `There ${mine.length === 1 ? 'is something new' : `are ${mine.length} new things`} for you in ${label}. `}Open it here: ${linkFor(e.dir, one?.url || '#/')}` });
        queued++;
      }
    }
  }
  return { queued };
}

const tradeWords = (x) => x.kind === 'fund.cancel' ? `cancel ${x.id}`
  : `${x.side} up to ${x.quantity} ${x.symbol}${x.limit ? ` at ${x.side === 'buy' ? '≤' : '≥'} $${(x.limit / 100).toFixed(2)}` : ' at market'}`;

// Clock-based, outside settlement: a member on the roll of an open proposal
// who has not voted is reminded once, notify.remind_hours before it closes.
// `entity serve` calls this every few minutes.
export async function remind(e, { now = Date.now() } = {}) {
  if (!enabled(e)) return { queued: 0 };
  const hours = e.params.value('notify.remind_hours'), allowed = e.params.value('notify.events');
  if (!allowed.includes('reminders')) return { queued: 0 };
  const st = readState(e.dir), subs = readSubs(e.dir), keys = recordKeysOf(e), entity = e.state.entity.id, from = e.params.value('entity.name');
  st.reminded ||= {};
  let queued = 0;
  for (const p of Object.values(e.state.proposals || {})) {
    const closes = Date.parse(p.deadline);
    if (p.closed || closes <= now || closes - now > hours * 3600000) continue;
    const voted = new Set((p.ballots || []).map(b => b.by));
    for (const member of p.roll || []) {
      const key = `${p.id}:${member}`;
      if (voted.has(member) || st.reminded[key] || !keys[member] || e.state.participants[member]?.status !== 'active') continue;
      const list = (subs[member] || []).filter(s => s.recordKey === keys[member] && s.events.includes('reminders'));
      st.reminded[key] = now;
      if (!list.length) continue;
      const left = Math.max(1, Math.round((closes - now) / 3600000));
      const n = { from, kind: 'reminder', event: 'reminders', title: `Vote closes in ${left} h: ${p.title}`, text: 'You have not voted on it yet.', url: `#/votes/${p.id}`, at: new Date(now).toISOString() };
      const sealed = await N.sealNotice({ entity, to: member, recordKey: keys[member] }, n);
      appendLine(path.join(dirOf(e.dir), 'inbox', `${member}.jsonl`), { ...sealed, at: n.at });
      for (const s of list) {
        if (s.channel === 'push') queue(e.dir, { member, sub: s.id, channel: 'push', payload: JSON.stringify({ v: 1, n: sealed }) });
        else queue(e.dir, { member, sub: s.id, channel: s.channel, subject: s.plaintext ? n.title : `A vote closes soon in ${S.sealingOn(e.state) ? 'your group' : from}`, text: `${s.plaintext ? `${n.title}\n\n` : 'A vote you have not taken part in closes soon. '}Open it here: ${linkFor(e.dir, n.url)}` });
        queued++;
      }
    }
  }
  // Forget reminders for proposals long closed.
  for (const k of Object.keys(st.reminded)) if (now - st.reminded[k] > 120 * 86400000) delete st.reminded[k];
  writeState(e.dir, st);
  return { queued };
}

// A zero-knowledge node: something arrived it cannot read. A sealed
// "something new" to each subscribed member, at most once an hour.
export async function nudge(e, { now = Date.now() } = {}) {
  if (!hasSubs(e.dir)) return { queued: 0 };
  const st = readState(e.dir), subs = readSubs(e.dir), keys = recordKeysOf(e), entity = entityIdOf(e);
  let queued = 0;
  for (const [member, list] of Object.entries(subs)) {
    if (!keys[member] || now - (st.nudged[member] || 0) < HOUR) continue;
    const sealed = await N.sealNotice({ entity, to: member, recordKey: keys[member] }, { generic: true, title: 'Something new', text: 'Open the page to see it.', url: '#/', at: new Date(now).toISOString() });
    for (const s of list.filter(x => x.recordKey === keys[member])) {
      if (s.channel === 'push') queue(e.dir, { member, sub: s.id, channel: 'push', payload: JSON.stringify({ v: 1, n: sealed }) });
      else queue(e.dir, { member, sub: s.id, channel: s.channel, subject: 'Something new in your group', text: `There is something new for you. Open it here: ${linkFor(e.dir, '#/')}` });
      queued++;
    }
    st.nudged[member] = now;
  }
  writeState(e.dir, st);
  return { queued };
}

function trimInbox(dir, member) {
  const f = path.join(dirOf(dir), 'inbox', `${member}.jsonl`), lines = readLines(f);
  if (lines.length > INBOX_KEEP * 1.5) writeLinesAtomically(f, lines.slice(-INBOX_KEEP));
}
function writeLinesAtomically(f, lines) { const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, lines.map(l => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 }); fs.renameSync(t, f); }
const linkFor = (dir, hash) => `${(store.readNode(dir).notify?.url || '').replace(/\/$/, '')}/${hash}`;
const queue = (dir, d) => appendLine(path.join(dirOf(dir), 'outbox.jsonl'), { id: crypto.randomBytes(6).toString('hex'), tries: 0, next: 0, ...d });
export const pending = (dir) => readLines(path.join(dirOf(dir), 'outbox.jsonl'));

// ── delivery ────────────────────────────────────────────────────────────────
// Push through push services; email and text messages through the commands
// in node.json "notify": { "mail": "…", "sms": "…" }, each run with
// NOTIFY_TO and NOTIFY_SUBJECT set and the text on standard input (for
// instance "mail": "msmtp -t" with a small wrapper, or a script calling an
// SMS provider). Failed deliveries are retried with growing waits, six times.
let delivering = false;
export async function deliver(dir, { now = Date.now(), fetchImpl = fetch, run = runCommand } = {}) {
  if (delivering) return { sent: 0, failed: 0, waiting: pending(dir).length };
  delivering = true;
  try {
    const items = pending(dir);
    if (!items.length) return { sent: 0, failed: 0, waiting: 0 };
    const node = store.readNode(dir).notify || {}, k = await nodeKeys(dir), subs = readSubs(dir);
    const keep = []; let sent = 0, failed = 0, gone = false;
    for (const d of items) {
      if (d.next > now) { keep.push(d); continue; }
      const s = (subs[d.member] || []).find(x => x.id === d.sub);
      if (!s) continue;                                         // unsubscribed meanwhile
      let ok = false, drop = false, why = '';
      try {
        if (d.channel === 'push') { const r = await WP.send(s.push, d.payload, k.vapid, { subject: node.subject, fetchImpl }); ok = r.status >= 200 && r.status < 300; drop = r.gone; why = `push service answered ${r.status}`; }
        else if (node[d.channel === 'email' ? 'mail' : d.channel]) { const r = await run(node[d.channel === 'email' ? 'mail' : d.channel], { NOTIFY_TO: s.address, NOTIFY_SUBJECT: d.subject }, d.text); ok = r === 0; why = `the ${d.channel} command exited ${r}`; }
        else { why = `no "${d.channel === 'email' ? 'mail' : d.channel}" command in node.json "notify"`; }
      } catch (err) { why = err.message; }
      if (ok) sent++;
      else if (drop) { subs[d.member] = (subs[d.member] || []).filter(x => x.id !== d.sub); gone = true; }
      else if (d.tries + 1 >= 6) failed++;
      else keep.push({ ...d, tries: d.tries + 1, next: now + 60000 * 2 ** d.tries, why });
    }
    if (gone) writeSubs(dir, subs);
    // Deliveries queued while this ran are kept.
    const f = path.join(dirOf(dir), 'outbox.jsonl'), seenIds = new Set(items.map(x => x.id));
    writeLinesAtomically(f, [...keep, ...pending(dir).filter(x => !seenIds.has(x.id))]);
    return { sent, failed, waiting: keep.length };
  } finally { delivering = false; }
}

function runCommand(cmd, env, text) {
  return new Promise((resolve) => {
    const p = spawn('/bin/sh', ['-c', cmd], { env: { ...process.env, ...env }, stdio: ['pipe', 'ignore', 'ignore'] });
    const t = setTimeout(() => p.kill(), 30000);
    p.on('close', (code) => { clearTimeout(t); resolve(code ?? 1); });
    p.on('error', () => resolve(127));
    p.stdin.end(text);
  });
}
