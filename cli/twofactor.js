// twofactor.js · email two-factor at the node's door. A member who has turned
// it on (or whom the republic's twofactor.require setting covers) signs in with
// their key or password AND a six-digit code emailed to them; until they have,
// this node accepts no act signed in their name over the web.
//
// Email addresses are this copy's own, kept in .entity/twofactor.json (never
// on the record, never replicated, readable only by the node's user). Codes
// are random, expire in twofactor.code_minutes, allow five tries, and are
// stored only as hashes. At most five codes an hour are sent to one member.
//
// What it guards, honestly: this node's sign-in, its /acts and its /bundle.
// A signature is still a signature: whoever holds a member's password could
// sign an act and hand it to another copy that does not run two-factor. On a
// republic served from one node, that node is the door, and it is now locked
// twice.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sendMail } from './mail.js';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const mask = (email) => { const [u, d] = String(email).split('@'); return `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}`; };
export const validEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s);

export function twoFactor(dir) {
  const file = path.join(dir, '.entity', 'twofactor.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { members: {} }; } };
  const save = (s) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const tickets = new Map(), sent = new Map();
  const sweep = () => { const now = Date.now(); for (const [k, v] of tickets) if (v.until < now) tickets.delete(k); };

  const live = (list, at) => (list || []).filter(m => m.since <= at && (!m.until || m.until > at)).map(m => m.id);
  const officer = (state, id) => {
    const at = new Date().toISOString();
    return Object.values(state.m.offices || {}).some(o => !o.abolished && live(o.holders, at).includes(id))
      || Object.values(state.m.committees || {}).some(c => !c.dissolved && live(c.members, at).includes(id));
  };

  const api = {
    on: (params) => params.value('entity.modules').includes('twofactor'),
    policy: (params) => (params.has('twofactor.require') ? params.value('twofactor.require') : 'optional'),
    minutes: (params) => (params.has('twofactor.code_minutes') ? params.value('twofactor.code_minutes') : 10),
    email: (id) => load().members[id]?.email || null,
    // Does the republic require it of this member, whatever they chose?
    policyCovers(state, params, id) { const p = api.policy(params); return p === 'everyone' || (p === 'officers' && officer(state, id)); },
    required(state, params, id) { return api.on(params) && (!!api.email(id) || api.policyCovers(state, params, id)); },
    enroll(id, email) { const s = load(); s.members[id] = { email, since: new Date().toISOString() }; save(s); },
    remove(id) { const s = load(); const had = !!s.members[id]; delete s.members[id]; save(s); return had; },
    list() { return Object.entries(load().members).map(([id, m]) => ({ id, email: m.email, since: m.since })); },
    // A ticket without a code: proof that this browser signed for `id` just now.
    ticket(id, purpose, extra = {}) { sweep(); const t = crypto.randomBytes(24).toString('hex'); tickets.set(t, { id, purpose, until: Date.now() + 15 * 60000, tries: 0, ...extra }); return t; },
    peek(t) { sweep(); return tickets.get(t) || null; },
    // Email a code; returns a ticket that redeems it.
    async send({ id, purpose, email, params, mail, name, extra = {} }) {
      if (!mail) throw new Error('this node cannot send email yet: its operator sets it up with `entity twofactor mail …`');
      const now = Date.now(), recent = (sent.get(id) || []).filter(x => x > now - 3600000);
      if (recent.length >= 5) throw new Error('five codes have been sent in the last hour: wait a while, then try again');
      sent.set(id, [...recent, now]);
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'), salt = crypto.randomBytes(8).toString('hex'), mins = api.minutes(params);
      const what = purpose === 'confirm' ? `to confirm this address for two-factor sign-in as ${id}` : `to sign in as ${id}`;
      await sendMail(mail, email, `${code} is your code for ${name}`,
        `Your code ${what} at ${name}:\n\n    ${code}\n\nIt works once, for ${mins} minutes.\n\n` +
        (purpose === 'confirm' ? 'If you did not ask for this, ignore it: nothing changes.\n' : 'If you are not signing in right now, someone has your password. Change it, and tell the republic.\n'));
      sweep();
      const t = crypto.randomBytes(24).toString('hex');
      tickets.set(t, { id, purpose, email, code: hash(salt + code), salt, until: now + mins * 60000, tries: 0, ...extra });
      return t;
    },
    // Redeem a code: { id, purpose, email } or { why }.
    redeem(t, code, purpose) {
      sweep();
      const x = tickets.get(t);
      if (!x || !x.code || (purpose && x.purpose !== purpose)) return { why: 'that code has expired: ask for a new one' };
      if (++x.tries > 5) { tickets.delete(t); return { why: 'too many wrong codes: ask for a new one' }; }
      const want = Buffer.from(x.code, 'hex'), got = Buffer.from(hash(x.salt + String(code || '').replace(/\D/g, '')), 'hex');
      if (!crypto.timingSafeEqual(want, got)) return { why: `that is not the code${x.tries < 5 ? `: ${5 - x.tries} tries left` : ''}` };
      tickets.delete(t);
      return { id: x.id, purpose: x.purpose, email: x.email };
    },
  };
  return api;
}
