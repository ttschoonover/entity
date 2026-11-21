import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { verifyAct, actHash, keys as K, sealing } from '../../kernel/index.js';
import { build as buildSite, renderIndex, island, lawIndex } from '../../interface/build.js';
import { openEntity, out, settlePending } from '../context.js';
import { bundleOf, absorbInto, pull } from '../net.js';
import { emit } from '../events.js';
import { available, packSource, prepareModule } from '../modules.js';
import { twoFactor, mask, validEmail } from '../twofactor.js';
import { mailConfig } from '../mail.js';
import { chatNode } from '../chat.js';
import { mahjongNode } from '../mahjong.js';
import { docsNode } from '../docs.js';
import * as media from '../media.js';
import { guard } from '../security.js';
import * as notify from '../notify.js';
import * as details from '../details.js';
import * as documents from '../documents.js';

export async function build({ opt }) {
  const e = await openEntity(opt);
  const dir = buildSite(e.dir, path.resolve(opt.out || path.join(e.dir, 'site')), e.state);
  out(`site built in ${dir}. Serve it over HTTPS from any folder; every link is relative.`);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.yml': 'text/plain; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8', '.pub': 'text/plain', '.md': 'text/plain; charset=utf-8', ...media.MEDIA_TYPES };

// A node: serves the page, the record and the code, and accepts signed acts.
// Anyone may POST an act: the signature is the authority, and settlement
// checks it again. With --settle, it settles on receipt; that is automation of
// something any participant can reproduce exactly, so it holds no authority.
export async function serve({ opt }) {
  opt.relay = true;   // a node may hold a sealed record it cannot open: it serves and relays it
  let e;
  try { e = await openEntity(opt); }
  catch (x) { console.error(`warning: ${x.message}\nServing anyway, so participants can see the problem for themselves.`); e = await store.open((await import('../context.js')).entityDir(opt)); e.params = null; }
  const port = Number(opt.port || store.readNode(e.dir).port || 7780);
  const auto = !!opt.settle;
  const map = [['/interface/js/', 'interface/js/'], ['/interface/fonts/', 'interface/fonts/'], ['/kernel/', 'kernel/'], ['/modules/', 'modules/'], ['/record/', 'record/'], ['/law/', 'law/'], ['/letters/', 'letters/'], ['/media/', 'media/']];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-chat-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true' };
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...(store.readNode(e.dir).private === true ? {} : cors) });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const body = (req) => (req._body !== undefined ? Promise.resolve(req._body) : new Promise((ok, bad) => { let d = ''; req.on('data', c => { d += c; if (d.length > 32e6) req.destroy(); }); req.on('end', () => { req._body = d; ok(d); }); req.on('error', bad); }));
  // The republic's own website, for headless republics: node.json "site": "site".
  const siteFolder = () => { const s = store.readNode(e.dir).site; return s ? path.resolve(e.dir, s) : null; };
  // Every response says nosniff (cli/security.js), so a file is used only as the type named here.
  const SITE_TYPES = { '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
    '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.map': 'application/json' };
  let live = 0;
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));

  // Private mode (node.json "private": true): nothing but the sign-in page, the
  // public code it needs, and an application form, until a member signs a
  // one-time challenge with their own key, password or passkey. The record,
  // the page, the votes and every other address answer only to a signed-in
  // member's session.
  const sessions = new Map(), challenges = new Map();
  const SESSION_HOURS = 12;
  const isPrivate = () => store.readNode(e.dir).private === true;
  const cookieOf = (req) => (String(req.headers.cookie || '').match(/(?:^|;\s*)gr_session=([a-f0-9]{64})/) || [])[1];
  const sessionOf = (req) => { const t = cookieOf(req), s = t && sessions.get(t); if (!s || s.until < Date.now()) { if (t) sessions.delete(t); return null; } return s; };
  const signinMessage = (entityId, challenge) => `entity.signin\n${entityId}\n${challenge}`;
  const OPEN_PREFIXES = ['/interface/js/', '/interface/fonts/', '/kernel/', '/modules/'];
  // What an applicant may send before admission: the application, signing what
  // it requires, their particulars (details), and accepting an invitation.
  const APPLY_KINDS = ['participant.apply', 'agreement.sign', 'details.filed', 'invite.accept', 'member.recordkey'];
  const sendPlain = (res, code, body, type, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra }); res.end(body); };
  // Email two-factor (the twofactor module): see cli/twofactor.js.
  const tf = twoFactor(e.dir);
  const chat = chatNode(opt);
  const mahjong = mahjongNode(opt);
  const docs = docsNode(opt);
  const mail = () => mailConfig(e.dir, store.readNode(e.dir));
  const json = (res, code, obj, extra) => (sendPlain(res, code, JSON.stringify(obj), TYPES['.json'], extra), true);
  const issue = (req, res, id, twofactor) => {
    const t = crypto.randomBytes(32).toString('hex');
    sessions.set(t, { id, twofactor, until: Date.now() + SESSION_HOURS * 3600000 });
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') || req.headers['cf-visitor'] ? '; Secure' : '';
    return json(res, 200, { ok: true, id, twofactor }, { 'set-cookie': `gr_session=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}` });
  };
  // Must this act, posted over the web, come from a browser that passed two-factor?
  const needsSecond = (ee, a) => a && a.kind !== 'participant.apply' && !(a.kind === 'agreement.sign' && ee.state.participants[a.by]?.status === 'applicant')
    && ee.state.participants[a.by] && tf.required(ee.state, ee.params, a.by);
  async function twoFactorRoutes(req, res, p) {
    if (!p.startsWith('/auth/2fa/')) return false;
    const ee = await openEntity(opt), name = ee.params.value('entity.name');
    let b = {}; if (req.method === 'POST') { try { b = JSON.parse(await body(req) || '{}'); } catch { b = {}; } }
    const s = sessionOf(req);
    if (p === '/auth/2fa/status' && req.method === 'GET') {
      const id = s?.id, email = id && tf.email(id);
      return json(res, 200, { module: tf.on(ee.params), policy: tf.policy(ee.params), mail: !!mail(), signedIn: id || null,
        enrolled: !!email, to: email ? mask(email) : null, required: id ? tf.required(ee.state, ee.params, id) : null,
        covered: id ? tf.policyCovers(ee.state, ee.params, id) : null, confirmed: !!s?.twofactor });
    }
    if (req.method !== 'POST') return json(res, 405, { why: 'method not allowed' });
    if (!tf.on(ee.params)) return json(res, 409, { why: 'two-factor is not installed in this republic' });
    try {
      // Sign-in, second step: the code emailed after the signature.
      if (p === '/auth/2fa/code') {
        const r = tf.redeem(b.ticket, b.code, 'signin');
        return r.why ? json(res, 401, { why: r.why }) : issue(req, res, r.id, true);
      }
      // Turning it on: from a sign-in ticket (when the republic requires it) or a session.
      if (p === '/auth/2fa/enroll') {
        const t = b.ticket ? tf.peek(b.ticket) : null;
        const id = t?.purpose === 'enroll' ? t.id : s?.id;
        if (!id) return json(res, 401, { why: 'sign in first' });
        if (!validEmail(b.email)) return json(res, 400, { why: 'that is not an email address' });
        if (tf.email(id) && !s?.twofactor) return json(res, 403, { why: 'two-factor is already on: sign in with your code to change its address' });
        const ticket = await tf.send({ id, purpose: 'confirm', email: b.email.trim(), params: ee.params, mail: mail(), name });
        return json(res, 200, { ticket, to: mask(b.email) });
      }
      if (p === '/auth/2fa/confirm') {
        const r = tf.redeem(b.ticket, b.code, 'confirm');
        if (r.why) return json(res, 401, { why: r.why });
        tf.enroll(r.id, r.email);
        return issue(req, res, r.id, true);
      }
      if (p === '/auth/2fa/resend') {
        const t = tf.peek(b.ticket);
        if (!t || t.purpose !== 'signin') return json(res, 401, { why: 'sign in again' });
        const ticket = await tf.send({ id: t.id, purpose: 'signin', email: tf.email(t.id), params: ee.params, mail: mail(), name });
        return json(res, 200, { ticket, to: mask(tf.email(t.id)) });
      }
      if (p === '/auth/2fa/off') {
        if (!s?.twofactor) return json(res, 403, { why: 'confirm this browser with a code first' });
        if (tf.policyCovers(ee.state, ee.params, s.id)) return json(res, 403, { why: `the republic requires two-factor of you (twofactor.require: ${tf.policy(ee.params)})` });
        tf.remove(s.id);
        return json(res, 200, { ok: true });
      }
    } catch (x) { return json(res, 503, { why: x.message }); }
    return json(res, 404, { why: 'no such address' });
  }
  async function gate(req, res, p) {
    // Code is open, since the sign-in page needs it. Asking the node to list or
    // fetch from its module source is not (docs/PRIVACY-AUDIT.md, F9).
    if (OPEN_PREFIXES.some(x => p.startsWith(x)) && req.method === 'GET' && p !== '/modules/available') return false;
    if ((p === '/sw.js' || p === '/sw-basic.js' || p === '/manifest.webmanifest') && req.method === 'GET') return false;   // the service workers and the manifest: needed before sign-in, nothing private
    if (p === '/signin' || p === '/signin.html') return sendPlain(res, 200, fs.readFileSync(path.join(e.dir, 'interface/signin.html')), TYPES['.html']), true;
    if (p === '/interface/style.css' || p === '/interface/athens.css') return false;
    const fresh = async () => (await openEntity(opt)).state;
    if (p === '/auth/info' && req.method === 'GET') {
      const st = await fresh();
      return sendPlain(res, 200, JSON.stringify({ entity: st.entity.id }), TYPES['.json']), true;
    }
    // Partners' particulars (the details module): signed requests, for applicants and members alike.
    if (p === '/auth/details' && req.method === 'POST') {
      let b; try { b = JSON.parse(await body(req)); } catch { return sendPlain(res, 400, '{"why":"send { body, signature }"}', TYPES['.json']), true; }
      await serial(async () => {
        const ee = await openEntity(opt);
        if (!details.enabled(ee)) return sendPlain(res, 404, '{"why":"the details module is not enabled here"}', TYPES['.json']);
        const r = await details.handle(ee, b);
        sendPlain(res, r.ok ? 200 : 403, JSON.stringify(r.ok ? r : { why: r.error }), TYPES['.json']);
      });
      return true;
    }
    // An invitation link: who it is for, told only to whoever holds its secret.
    if (p === '/auth/invite' && req.method === 'POST') {
      let b; try { b = JSON.parse(await body(req)); } catch { b = {}; }
      const ee = await openEntity(opt);
      const i = ee.state.m.invites?.[b.invite];
      const { hash } = await import('../../kernel/hash.js');
      const ok = i && typeof b.secret === 'string' && hash(b.secret) === i.hash;
      const state = !ok ? 'unknown' : i.used ? 'used' : i.revoked ? 'withdrawn' : new Date().toISOString() > i.expires ? 'expired' : 'open';
      return sendPlain(res, ok ? 200 : 404, JSON.stringify(ok ? { name: i.name, state, expires: i.expires, details: !!(ee.params.has('details.required') && ee.params.value('details.required')) } : { why: 'that invitation link is not valid' }), TYPES['.json']), true;
    }
    if (p === '/auth/required' && req.method === 'GET') {
      // What a candidate must sign before admission: the texts in force.
      const ee = await openEntity(opt), st = ee.state;
      const f = path.join(e.dir, 'modules', 'agreements', 'index.js');
      if (!ee.params.value('entity.modules').includes('agreements') || !fs.existsSync(f)) return sendPlain(res, 200, JSON.stringify({ documents: [] }), TYPES['.json']), true;
      const ag = await import(new URL(`file://${f}`).href);
      // Whether someone has signed is told only for a pending applicant (who is
      // finishing their application), never for members, so this cannot be used
      // to find out who belongs (docs/PRIVACY-AUDIT.md, F7).
      const asked = new URL(req.url, 'http://x').searchParams.get('for');
      const who = asked && st.participants[asked]?.status === 'applicant' ? asked : null;
      const drawn = ee.params.value('agreements.drawn_signature');
      const documents = (ee.params.value('agreements.required') || []).map(id => {
        const v = ag.current(st, id, ee.params);
        if (!v) return { page: id, missing: true };
        return { page: id, version: v.n, title: v.title, body: v.body, text: ag.fingerprint(id, v), drawn,
          signed: who ? ag.signaturesOf(st, who, id).some(x => x.version === v.n) : undefined };
      });
      return sendPlain(res, 200, JSON.stringify({ documents }), TYPES['.json']), true;
    }
    if (p === '/auth/challenge' && req.method === 'POST') {
      for (const [k, v] of challenges) if (v < Date.now()) challenges.delete(k);
      if (challenges.size > 1000) return sendPlain(res, 429, '{"why":"too many sign-ins in progress"}', TYPES['.json']), true;
      const c = crypto.randomBytes(32).toString('hex'); challenges.set(c, Date.now() + 5 * 60000);
      return sendPlain(res, 200, JSON.stringify({ challenge: c }), TYPES['.json']), true;
    }
    if (p === '/auth/verify' && req.method === 'POST') {
      let b; try { b = JSON.parse(await body(req)); } catch { b = {}; }
      const exp = challenges.get(b.challenge); challenges.delete(b.challenge);
      const no = (why) => (sendPlain(res, 401, JSON.stringify({ why }), TYPES['.json']), true);
      if (!exp || exp < Date.now()) return no('that sign-in expired: try again');
      const st = await fresh(), m = st.participants[b.id];
      // One answer for every failure, so sign-in cannot be used to find out who
      // belongs; only someone who proves they hold an applicant's key hears that
      // the application is still pending (docs/PRIVACY-AUDIT.md, F8).
      if (!m || (m.status !== 'active' && m.status !== 'applicant')) return no('no member by that id, or not that password');
      const v = await K.verify(signinMessage(st.entity.id, b.challenge), String(b.signature || ''), m.keys, 'entity.signin');
      if (!v.ok) return no('no member by that id, or not that password');
      if (m.status === 'applicant') return no('your application has not been admitted yet');
      const ee = await openEntity(opt);
      if (tf.required(ee.state, ee.params, b.id)) {
        const email = tf.email(b.id);
        if (!email) return json(res, 200, { need: 'enroll', ticket: tf.ticket(b.id, 'enroll'), policy: tf.policy(ee.params) });
        try { return json(res, 200, { need: 'code', ticket: await tf.send({ id: b.id, purpose: 'signin', email, params: ee.params, mail: mail(), name: ee.params.value('entity.name') }), to: mask(email) }); }
        catch (x) { return json(res, 503, { why: x.message }); }
      }
      return issue(req, res, b.id, false);
    }
    if (p === '/auth/signout' && req.method === 'POST') {
      const t = cookieOf(req); if (t) sessions.delete(t);
      return sendPlain(res, 200, '{"ok":true}', TYPES['.json'], { 'set-cookie': 'gr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' }), true;
    }
    // The latest key period's public key, for sealing an application: public
    // in the record already (kernel/sealing.js latestPeriod), so no secret.
    if (p === '/auth/period' && req.method === 'GET') {
      const rec = store.read(e.dir).records;
      return sendPlain(res, 200, JSON.stringify({ period: sealing.latestPeriod(rec) }), TYPES['.json']), true;
    }
    if (p === '/auth/apply' && req.method === 'POST') {
      // An application, and nothing else, from someone not yet a member.
      let a; try { a = JSON.parse(await body(req)); } catch { a = null; }
      // Sealed in transit: its kind is checked once a member's node opens it.
      if (a && a.sealedAct && !Array.isArray(a)) { req._applyOnly = true; return 'apply'; }
      if (!a || !APPLY_KINDS.includes(a.kind)) return sendPlain(res, 400, '{"why":"only an application to join, and signing what it requires, are accepted here"}', TYPES['.json']), true;
      if (a.kind === 'agreement.sign' && (await openEntity(opt)).state.participants[a.by]?.status !== 'applicant') return sendPlain(res, 400, '{"why":"members sign from the page, once signed in"}', TYPES['.json']), true;
      const pending = fs.existsSync(path.join(e.dir, 'pending')) ? fs.readdirSync(path.join(e.dir, 'pending')).length : 0;
      if (pending > 200) return sendPlain(res, 429, '{"why":"too many acts waiting; try later"}', TYPES['.json']), true;
      if (Array.isArray(a)) return sendPlain(res, 400, '{"why":"one application at a time"}', TYPES['.json']), true;
      return 'apply';
    }
    if (await twoFactorRoutes(req, res, p)) return true;
    if (sessionOf(req)) return false;
    if (req.method === 'GET' && (p === '/' || p === '/index.html' || String(req.headers.accept || '').includes('text/html'))) return sendPlain(res, 302, '', 'text/plain', { location: '/signin' }), true;
    return sendPlain(res, 401, '{"why":"sign in first"}', TYPES['.json']), true;
  }

  const server = http.createServer(async (req, res) => {
    // Every response carries the security headers (cli/security.js), whatever handler writes it.
    guard(req, res, () => { const n = store.readNode(e.dir); return { privateMode: n.private === true, csp: n.csp || {} }; });
    try {
      const url = new URL(req.url, 'http://x');
      let p = decodeURIComponent(url.pathname);
      if (isPrivate()) {
        if (req.method === 'OPTIONS') return sendPlain(res, 204, '', 'text/plain');
        const g = await gate(req, res, p);
        if (g === true) return;
        if (g === 'apply') p = '/acts';
      } else if (p.startsWith('/auth/') && p !== '/auth/apply' && p !== '/auth/required') {
        // Public republics sign in only for two-factor; the same routes serve it.
        if (await gate(req, res, p) === true) return;
      }
      if (req.method === 'OPTIONS') return send(res, 204, '');
      // Chat (the chat module): channels kept by this node, off the record. See cli/chat.js.
      if (p.startsWith('/chat/')) { try { if (await chat.handle(req, res, p, { body, send, cors })) return; } catch (x) { return send(res, 500, { why: x.message }); } }
      // Mahjong (the mahjong module): live tables, kept by this node until a match ends. See cli/mahjong.js.
      if (p.startsWith('/mahjong/')) { try { if (await mahjong.handle(req, res, p, { body, send, cors })) return; } catch (x) { return send(res, 500, { why: x.message }); } }
      // Documents (the docs module): signed files in documents/, checked against the record. See cli/docs.js.
      if (p.startsWith('/docs/')) { try { if (await docs.handle(req, res, p, { body, send, cors })) return; } catch (x) { return send(res, 500, { why: x.message }); } }
      // Notifications (the notify module): subscriptions and inboxes, off the
      // record; every request is proved with the member's record key. See cli/notify.js.
      if ((p === '/sw.js' || p === '/sw-basic.js') && req.method === 'GET') return sendPlain(res, 200, fs.readFileSync(path.join(e.dir, 'interface', p.slice(1))), TYPES['.js']);
      // The web app manifest: added to a phone's Home Screen, the page opens as an
      // app, which is what lets an iPhone receive its notifications (iOS 16.4+).
      // A Home Screen label: whole words up to 12 characters ("The Orchard General Partnership" → "Orchard").
      const shortName = (n) => { if (n.length <= 12) return n; let out = ''; for (const w of n.replace(/^The /, '').split(/\s+/)) { if ((out ? `${out} ${w}` : w).length > 12) break; out = out ? `${out} ${w}` : w; } return out || n.slice(0, 12); };
      if (p === '/manifest.webmanifest' && req.method === 'GET') {
        let name = 'Athènes';
        try { const x = await openEntity({ ...opt, relay: true }, { readable: false }); name = x.params?.value('entity.name') || x.records?.[0]?.payload?.act?.document?.parameters?.['entity.name']?.value || name; } catch { /* the default */ }
        return sendPlain(res, 200, JSON.stringify({ name, short_name: shortName(name), start_url: '/', scope: '/', display: 'standalone',
          background_color: '#F7F5F0', theme_color: '#111110' }), 'application/manifest+json');
      }
      if (p === '/notify/keys' && req.method === 'GET') {
        e = await openEntity(opt);
        if (!notify.enabled(e) && !e.unreadable) return send(res, 404, { why: 'the notify module is not enabled here' });
        return send(res, 200, await notify.publicKeys(e.dir));
      }
      if (p === '/notify/request' && req.method === 'POST') {
        let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { why: 'send a signed request' }); }
        return serial(async () => {
          e = await openEntity(opt);
          if (!notify.enabled(e) && !e.unreadable) return send(res, 404, { why: 'the notify module is not enabled here' });
          const r = await notify.handle(e, b);
          send(res, r.ok ? 200 : 403, r.ok ? r : { why: r.error });
        });
      }
      // Certificates and signed agreements as PDFs (cli/documents.js), for signed-in members:
      // a partner sees their own certificates, the officers every one.
      let dm;
      if (req.method === 'GET' && (dm = p.match(/^\/documents\/(certificate|agreement)\/([a-z0-9-]+)\.pdf$/))) {
        const who = sessionOf(req)?.id;
        if (!who) return send(res, 401, { why: 'sign in first' });
        return serial(async () => {
          try {
            e = await openEntity(opt);
            const st = e.state, on = (m) => e.params.value('entity.modules').includes(m);
            if (st.participants[who]?.status !== 'active') return send(res, 403, { why: 'only partners' });
            let doc;
            if (dm[1] === 'certificate') {
              if (!on('partnership')) return send(res, 404, { why: 'no partnership module here' });
              const { certificates } = await import(new URL(`file://${path.join(e.dir, 'modules', 'partnership', 'index.js')}`).href);
              const certs = certificates(e.views || e.records, e.params.value('partnership.unit_class'));
              const c = certs.find(x => String(x.number) === dm[2]);
              if (!c) return send(res, 404, { why: 'no such certificate' });
              if (c.partner !== who && !documents.officers(st).some(o => o.id === who)) return send(res, 403, { why: 'a partner sees their own certificates; the officers see all' });
              doc = documents.certificateTex(e, c.number, certs);
            } else {
              if (!on('agreements')) return send(res, 404, { why: 'no agreements module here' });
              const ag = await import(new URL(`file://${path.join(e.dir, 'modules', 'agreements', 'index.js')}`).href);
              doc = documents.agreementTex(e, dm[2], ag);
            }
            const out = documents.pdf(e, doc);
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${doc.name}.pdf"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
            res.end(out);
          } catch (x) { send(res, 500, { why: x.message }); }
        });
      }
      // Pictures for texts (cli/media.js): a member signs for the picture's hash,
      // and the node keeps it in media/ under that hash. In a private republic
      // the gate above has already required a member's session as well.
      if (p === '/media' && req.method === 'POST') {
        let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { why: 'send { by, signature, data }' }); }
        try {
          const buf = Buffer.from(String(b.data || ''), 'base64');
          const st = (await openEntity(opt)).state, m = st.participants[b.by];
          if (!m || m.status !== 'active') return send(res, 403, { why: 'only an active member may add a picture' });
          const v = await K.verify(media.signedMessage(st.entity.id, media.fullHash(buf)), String(b.signature || ''), m.keys, 'entity.media');
          if (!v.ok) return send(res, 403, { why: 'the signature does not match this picture and member' });
          const kept = media.keep(e.dir, buf);
          emit(e.dir, 'media.kept', { by: b.by, path: kept.path });
          return send(res, 200, { path: kept.path, bytes: kept.bytes, existed: kept.existed });
        } catch (x) { return send(res, 400, { why: x.message }); }
      }
      // Modules, from the page: what the entity's module source offers, and a
      // proposal to install or upgrade one (fetched and checked here, signed by
      // the member in their browser). Off with "modulesOnline": false in node.json.
      if (p === '/modules/available' || p === '/modules/prepare') {
        return serial(async () => {
          try {
            e = await openEntity(opt);
            if (store.readNode(e.dir).modulesOnline === false) return send(res, 403, JSON.stringify({ error: 'this node does not prepare modules from the page' }), 'application/json');
            if (p === '/modules/available') {
              const from = packSource(e.dir);
              if (!from) return send(res, 200, JSON.stringify({ source: null, modules: [] }), 'application/json');
              const list = await available(e.dir, from);
              const installed = new Set(store.installedModules(e.dir));
              return send(res, 200, JSON.stringify({ source: from, modules: list.map(m => ({ ...m, installed: installed.has(m.name) })) }), 'application/json');
            }
            if (req.method !== 'POST') return send(res, 405, '');
            const { name, mode } = JSON.parse(await body(req) || '{}');
            const r = await prepareModule(e, name, mode === 'upgrade' ? 'upgrade' : 'add');
            return send(res, 200, JSON.stringify(r), 'application/json');
          } catch (x) { return send(res, 400, JSON.stringify({ error: x.message }), 'application/json'); }
        });
      }
      if (req.method === 'POST' && p === '/acts') {
        const got = JSON.parse(await body(req));
        const acts = Array.isArray(got) ? got : [got];
        return serial(async () => {
          e = await openEntity(opt);
          const accepted = [], refused = [];
          for (let a of acts) {
            // An act sealed in transit (kernel/sealing.js): checked here if this
            // node holds a reader's key, and kept sealed on disk either way.
            let box = null;
            if (a && a.sealedAct) {
              box = a;
              let opened = null; if (e.ring) { try { opened = await sealing.openAct(a.sealedAct, e.ring); } catch { /* not ours */ } }
              if (!opened) { store.writePending(e.dir, box); accepted.push(`sealed:${a.sealedAct.ct.slice(0, 16)}`); continue; }
              a = opened;
              if (req._applyOnly && !APPLY_KINDS.includes(a.kind)) { refused.push({ hash: actHash(a), why: 'only an application to join, and signing what it requires, are accepted here' }); continue; }
            }
            const def = e.registry.get(a && a.kind);
            const keys = def?.selfSigned ? [a.key] : e.state.participants[a?.by]?.keys;
            if (!def) { refused.push({ hash: null, why: `unknown kind ${a && a.kind}` }); continue; }
            if (!keys) { refused.push({ hash: actHash(a), why: `${a.by} is not on the register` }); continue; }
            const v = await verifyAct(e.registry, a, keys);
            if (!v.ok) { refused.push({ hash: actHash(a), why: `signature invalid: ${v.error}` }); continue; }
            if (needsSecond(e, a)) {
              const s = sessionOf(req);
              if (!s || s.id !== a.by || !s.twofactor) { refused.push({ hash: actHash(a), twofactor: true, why: `${a.by} uses email two-factor: confirm this browser with the code emailed to you, then send it again` }); continue; }
            }
            store.writePending(e.dir, box || a); accepted.push(actHash(a));
            emit(e.dir, 'act', box ? { kind: 'sealed', by: null } : { kind: a.kind, by: a.by });
          }
          let settled = false;
          // A zero-knowledge node cannot say what arrived: a sealed "something new" to subscribers.
          if (e.unreadable && accepted.length) { try { await notify.nudge(e); } catch { /* notices are a convenience */ } }
          if (auto && accepted.length) {
            const r = await settlePending(e, { publish: 'background' });
            for (const x of r.refused) if (accepted.includes(x.hash)) refused.push({ hash: x.hash, why: x.reason });
            settled = !e.unreadable;   // a zero-knowledge node stores; a member's copy settles
          }
          send(res, refused.length && !accepted.length ? (refused.every(x => x.twofactor) ? 403 : 422) : 200, { accepted, refused, settled, ...(refused.some(x => x.twofactor) ? { twofactor: true } : {}) });
        });
      }
      // A checkpoint made or co-signed in a page. Kept only if it matches this
      // copy's record and chain; only signatures that verify are kept.
      if (req.method === 'POST' && p === '/checkpoints') {
        const cp = JSON.parse(await body(req));
        return serial(async () => {
          e = await openEntity(opt);
          const { mergeCheckpoint, checkpointStatus } = await import('../../kernel/index.js');
          const r = await mergeCheckpoint(store.readCheckpoints(e.dir), cp, e.state, e.records);
          if (r.why) return send(res, 422, { why: r.why });
          store.writeCheckpoints(e.dir, [r.checkpoint]);
          emit(e.dir, 'checkpoint', { number: r.checkpoint.number });
          const st = await checkpointStatus(r.checkpoint, e.state, e.params.value('record.checkpoint_cosigners'), e.records);
          send(res, 200, { number: r.checkpoint.number, added: r.added, binding: st.binding, signed: st.valid });
        });
      }
      // The core, by decision: what is staged, fetching the configured source,
      // and installing it once a decision approves exactly it.
      if (p === '/upgrade' && req.method === 'GET') {
        e = await openEntity(opt);
        const up = await import('../upgrade.js');
        const { sourceOf } = await import('./upgrade.js');
        const m = up.staged(e.dir);
        return send(res, 200, { source: sourceOf(e.dir), current: JSON.parse(fs.readFileSync(path.join(e.dir, 'package.json'), 'utf8')).version,
          staged: m, proposal: m ? up.proposal(m) : null, approvedBy: m ? up.approvedBy(e.state, m)?.id || null : null });
      }
      if (req.method === 'POST' && (p === '/upgrade/check' || p === '/upgrade/apply')) {
        return serial(async () => {
          e = await openEntity(opt);
          const up = await import('../upgrade.js');
          const { sourceOf } = await import('./upgrade.js');
          try {
            if (p === '/upgrade/check') {
              const source = sourceOf(e.dir);
              if (!source) return send(res, 409, { why: 'no upgrade source is set: add "upgrade": { "source": "…" } to node.json' });
              const m = up.check(e.dir, source, e.params);
              return send(res, 200, { staged: m.paths.length ? m : null, proposal: m.paths.length ? up.proposal(m) : null, current: m.from });
            }
            const r = up.apply(e.dir, e.state);
            send(res, 200, { ...r, restart: true });
            out(`installed entity ${r.version}, permitted by decision ${r.decision}. Restart this node to run it.`);
          } catch (x) { send(res, 422, { why: x.message }); }
        });
      }
      if (req.method === 'POST' && p === '/bundle') {
        // With two-factor installed, a bundle (which may carry new acts) is taken
        // only from a signed-in member who passed it.
        { const ee = await openEntity(opt); if (tf.on(ee.params) && !sessionOf(req)?.twofactor) return send(res, 403, { why: 'this republic uses two-factor: sign in with your code to send a bundle', twofactor: true }); }
        const b = JSON.parse(await body(req));
        return serial(async () => {
          e = await openEntity(opt);
          const plan = await absorbInto(e, b);
          if (auto && plan.action !== 'refused' && plan.action !== 'diverged') await settlePending(e);
          send(res, plan.action === 'refused' || plan.action === 'diverged' ? 409 : 200, { action: plan.action, added: plan.added || 0, why: plan.why || null });
        });
      }
      if (req.method !== 'GET') return send(res, 405, { why: 'method not allowed' });
      // Presence: each open page holds this stream. Opening it is a visit;
      // closing the page closes it. Nothing about the visitor is recorded.
      if (p === '/presence') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
        live++;
        emit(e.dir, 'visit', { live });
        res.write(`data: ${live}\n\n`);
        const beat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
        req.on('close', () => { clearInterval(beat); live--; emit(e.dir, 'leave', { live }); });
        return;
      }
      if (p === '/bundle') { e = await openEntity(opt); return send(res, 200, await bundleOf(e)); }
      if (p === '/' || p === '/index.html') {
        // A republic with its own website (node.json "site": a folder, built on
        // windows) serves it, whether or not the page module is installed: the
        // site is this node's choice of front door; the page stays a module.
        const siteDir = siteFolder();
        if (siteDir && fs.existsSync(path.join(siteDir, 'index.html'))) return send(res, 200, fs.readFileSync(path.join(siteDir, 'index.html')), TYPES['.html']);
        // The page is a module: without it, the republic runs headless.
        if (!store.installedModules(e.dir).includes('page')) {
          const name = String(e.params ? e.params.value('entity.name') : 'This republic').replace(/[<>&"]/g, '');
          return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>
<body style="font:16px/1.6 'Helvetica Neue',Helvetica,Arial,sans-serif;background:#131310;color:#E8E5DC;max-width:40em;margin:4rem auto;padding:0 1.5rem">
<h1 style="font-weight:400">${name}</h1>
<p>This republic runs without its own page. Its record is public and checkable, and its members act through windows on other websites, or the command line.</p>
<ul><li><a style="color:inherit" href="record/events.jsonl">The record</a>, one signed record per line</li><li><a style="color:inherit" href="window.js">window.js</a>, for showing this republic on another website</li></ul>
<p style="color:#8a877f">Installing the <code>page</code> module, by decision, gives it a page here.</p></body>`, TYPES['.html']);
        }
        // Serve the page even for a copy that does not verify: each
        // participant's own verifier must be the one to raise the alarm.
        const raw = await store.open(e.dir);
        let data;
        // node.json "look": the look this node shows until a viewer picks their own.
        try { data = island(raw.state, { node: true, installed: store.installedModules(e.dir), look: store.readNode(e.dir).look || null, colour: store.readNode(e.dir).colour || null }); }
        catch {
          const first = raw.records[0]?.payload?.act;
          data = { id: first?.entity || null, name: 'This copy cannot be read', modules: store.installedModules(e.dir), node: true };
        }
        return send(res, 200, renderIndex(fs.readFileSync(path.join(e.dir, 'interface/index.html'), 'utf8'), data), TYPES['.html']);
      }
      // Windows: other websites show this republic, verified in each visitor's browser.
      if (p === '/window.js') return send(res, 200, fs.readFileSync(path.join(e.dir, 'interface/window/window.js')), TYPES['.js']);
      if (p === '/window/info.json') {
        const raw = await store.open(e.dir);
        const first = raw.records[0]?.payload?.act;
        let name = null; try { name = e.params?.value('entity.name') ?? null; } catch { /* unreadable copy */ }
        return send(res, 200, JSON.stringify({ id: first?.entity || null, name, modules: store.installedModules(e.dir), records: raw.records.length, page: store.installedModules(e.dir).includes('page') }));
      }
      if (p === '/window/events') {
        // A live stream: "record" whenever the record grows, with the new count.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
        const file = store.P(e.dir).events;
        const size = () => { try { return fs.statSync(file).size; } catch { return 0; } };
        let last = size();
        const lines = () => { try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
        res.write(`event: hello\ndata: ${JSON.stringify({ records: lines() })}\n\n`);
        const poll = setInterval(() => { const n = size(); if (n !== last) { last = n; res.write(`event: record\ndata: ${JSON.stringify({ records: lines() })}\n\n`); } }, 1500);
        const beat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
        req.on('close', () => { clearInterval(poll); clearInterval(beat); });
        return;
      }
      if (p.startsWith('/window/')) {
        const f = path.resolve(e.dir, 'interface/window', p.slice('/window/'.length));
        if (!f.startsWith(path.resolve(e.dir, 'interface/window')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, { why: 'not found' });
        return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || SITE_TYPES[path.extname(f)] || 'application/octet-stream');
      }
      if (p === '/law/index.json') return send(res, 200, JSON.stringify(lawIndex(e.dir)));
      if (p === '/interface/style.css' || p === '/interface/athens.css') return send(res, 200, fs.readFileSync(path.join(e.dir, p.slice(1))), TYPES['.css']);
      for (const [pre, real] of map) {
        if (!p.startsWith(pre)) continue;
        const f = path.resolve(e.dir, real, p.slice(pre.length));
        if (!f.startsWith(path.resolve(e.dir, real))) return send(res, 403, { why: 'outside the served tree' });
        if (/[\\/](store|compose)\.js$/.test(f)) return send(res, 404, { why: 'not for browsers' });
        if (p.startsWith('/record/') && /\/(attestations|checkpoints)\/index\.json$/.test(p) && !fs.existsSync(f)) return send(res, 200, '[]');
        if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, { why: 'not found' });
        return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
      }
      const siteDir = siteFolder();
      if (siteDir && req.method === 'GET') {
        const f = path.resolve(siteDir, '.' + p);
        if (f.startsWith(siteDir + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || SITE_TYPES[path.extname(f)] || 'application/octet-stream');
      }
      send(res, 404, { why: 'not found' });
    } catch (x) { send(res, 400, { why: x.message }); }
  });
  await new Promise(r => server.listen(port, opt.host || '127.0.0.1', r));
  // Notices waiting in .entity/notify/outbox.jsonl: delivered every few seconds.
  setInterval(() => { notify.deliver(e.dir).catch(() => {}); }, Number(process.env.ENTITY_NOTIFY_EVERY || 5000)).unref();
  // Reminders before votes close (notify.remind_hours), checked every five minutes.
  setInterval(() => serial(async () => { try { const x = await openEntity(opt); if (!x.unreadable) await notify.remind(x); } catch { /* notices are a convenience */ } }), 300000).unref();
  if (e.unreadable) {
    out(`zero-knowledge: this node holds no member's key, so it cannot open ${e.unreadable} sealed record(s). It stores and relays them and accepts sealed acts; members' browsers and copies open and settle them.`);
    if (isPrivate()) out('note: the sign-in wall checks members against the register, which this node cannot read; only members named in public records can sign in here. The records it serves are ciphertext either way.');
  }
  out(`${e.params ? e.params.value('entity.name') : 'An unreadable copy'} is served at http://localhost:${port}/${auto ? ' (settling acts on receipt)' : ''}`);
  out('POST /acts accepts signed acts; GET /bundle and POST /bundle carry the whole record.');
  // A validator's node may sign checkpoints on its own: node.json
  //   "finality": { "signAs": "ID", "everyMinutes": 60 }
  // signs any open checkpoint it has not signed, and opens one at the head
  // once there are new records and the last final checkpoint is that old.
  const fin = store.readNode(e.dir).finality;
  if (fin?.signAs && auto) {
    const every = Math.max(1, Number(fin.everyMinutes || 60));
    const tick = () => serial(async () => {
      try {
        e = await openEntity(opt);
        if (!e.params.value('entity.modules').includes('finality')) return;
        const F = (await import('../../modules/finality/index.js')).default;
        const now = new Date().toISOString(), o = F.isOpen(e.state, now), last = F.lastFinal(e.state);
        const mine = o && o.roll[fin.signAs] && !o.signed[fin.signAs];
        const due = !o && e.records.length > (last?.count || 0) && (!last || Date.parse(now) - Date.parse(last.at) >= every * 60000);
        if (!mine && !due) return;
        const fields = o ? { number: o.number, count: o.count, head: o.head } : { number: (last?.number || 0) + 1, count: e.state.head.seq, head: e.state.head.hash };
        const { signed } = await import('../context.js');
        store.writePending(e.dir, await signed(e, 'checkpoint.sign', fields, { ...opt, as: fin.signAs }));
        const r = await settlePending(e);
        if (r.applied.length) out(`signed checkpoint ${fields.number} at record ${fields.count} as ${fin.signAs}`);
      } catch (x) { out(`finality: ${x.message}`); }
    });
    setInterval(tick, Math.min(every, 10) * 60000).unref();
    setTimeout(tick, 5000).unref();
    out(`signing checkpoints as ${fin.signAs} when due (every ${every} minutes at most)`);
  }
  // Peer to peer: a node that replicates over Radicle pulls every peer's acts
  // and records on a schedule, inside the same queue as everything else here,
  // then settles and publishes. So an act signed on any copy reaches this one
  // with nobody running a command. node.json "pullEveryMinutes" (default 2 when
  // there is a radicle destination; 0 turns it off).
  {
    const cfg = store.readNode(e.dir);
    const peers = (cfg.destinations || []).filter(d => d.class === 'radicle');
    const every = Number(cfg.pullEveryMinutes ?? (peers.length ? 2 : 0));
    if (peers.length && every > 0) {
      const tick = () => serial(async () => {
        try {
          e = await openEntity(opt);
          let added = 0, acts = 0;
          for (const d of peers) {
            let got;
            try { got = await pull(e, d); } catch (x) { out(`peers: ${d.name} unreachable (${x.message})`); continue; }
            for (const { source, bundle: b } of got) {
              const plan = await absorbInto(e, b);
              if (plan.action === 'diverged') {
                // Kept aside, never merged silently: merging is a deliberate act (entity repair --merge).
                const f = path.join(e.dir, '.entity', 'incoming', `${source.replace(/[^\w.-]+/g, '_')}.bundle.json`);
                fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(b) + '\n');
                out(`peers: ${source} DIVERGED at record ${plan.fork}; nothing folded in, their copy saved at ${path.relative(e.dir, f)}`);
              } else if (plan.action === 'refused') out(`peers: ${source} refused (${plan.why})`);
              else { added += plan.added || 0; acts += (plan.acts || []).length; }
            }
          }
          if (auto) {
            const r = await settlePending(e, { publish: 'background' });
            if (added || r.applied.length) out(`peers: ${added} record(s) and ${acts} act(s) in; ${r.applied.length} settled`);
          }
        } catch (x) { out(`peers: ${x.message}`); }
      });
      setInterval(tick, every * 60000).unref();
      setTimeout(tick, 10000).unref();
      out(`pulling from peers on Radicle every ${every} minute${every === 1 ? '' : 's'}`);
    }
  }
  return server;
}
