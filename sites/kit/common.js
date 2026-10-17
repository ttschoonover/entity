// common.js · what every page of an entity's website shares: the connection to
// the entity (through windows), the masthead, signing in and out, signing acts,
// and the host that lets any installed module draw itself here.
//
// The kit is shared by every site built on it (sites/kit); each site adds its
// own pages, flag and config.js (its name for itself, its pages, a line about
// what it is). What members are called comes from the entity's vocabulary.
//
// The site is served by the entity's own node, on the same origin as its
// signing window, so a member who signs in here is signed in there too: the
// key is kept in this browser (locked with their password unless they choose
// otherwise), and every act is shown in full before it is signed.
//
// Several entities on one site (a federation and its states, say): config.js
// says entities: 'entities.json', a list of { key, label, url } whose first is
// this site's own node. Each record is fetched from its own node and verified
// here; ctx.all holds them all, and ctx.r the one the page is about (?e=key).
// A member signs in once: their password makes their key for every entity they
// belong to, and each act goes to its own entity's node.

import { connect } from './window.js';
import * as K from './interface/js/keystore.js';
import { lockSeed, unlockSeed } from './interface/js/lock.js';
import CONFIG from './config.js';

// What the site says about itself (config.js), over these defaults.
export const SITE = { body: 'the network', about: '', pages: [['index.html', 'Home'], ['hall.html', 'Institutions']], order: [], institutions: {}, minAge: 16, ...CONFIG };
const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);
// The words for members and proposals, from the entity's vocabulary.
export function W() {
  const one = setting('vocabulary.participant', 'member'), many = setting('vocabulary.participants', 'members'), proposal = setting('vocabulary.proposal', 'proposal');
  const proposals = /s$/.test(proposal) ? proposal : `${proposal}s`;
  return { one, many, One: cap(one), Many: cap(many), a: /^[aeiou]/i.test(one) ? 'an' : 'a', proposal, proposals, Proposal: cap(proposal), Proposals: cap(proposals),
    body: SITE.body, Body: cap(SITE.body), assembly: setting('vocabulary.assembly', 'Assembly') };
}

export const E = await import('./interface/js/engine.js');
export const $ = (s, root = document) => root.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ── the connection ─────────────────────────────────────────────────────────
export const ctx = { r: null, registry: null, ident: null, authority: null, agreements: null, all: [], key: null };
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const signedListeners = new Set();
export const onSigned = (fn) => signedListeners.add(fn); // after anything is signed here: redraw, even mid-form
const signed = () => { for (const fn of signedListeners) try { fn(); } catch (e) { console.error(e); } };
const fire = () => { for (const fn of listeners) try { fn(ctx.r); } catch (e) { console.error(e); } };

// One entity: its verified record, its code, and who is signed in to it here.
async function openEntity(x) {
  const r = await connect(x.url);
  // Its own code, from its own node: each entity runs the modules it chose.
  const registry = await (r.base === new URL('./', location.href).href ? E : await import(`${r.base}interface/js/engine.js`)).loadRegistry(r.info.modules);
  let ident = null, authority = null, agreements = null;
  if (r.ok) {
    ident = await withTimeout(K.loadIdentity(r.state.entity.id), 3000).catch(() => null);
    if (ident && !r.state.participants[ident.id]) ident = null;
    const on = (m) => r.params.value('entity.modules').includes(m);
    if (on('authority')) { try { authority = await import(`${r.base}modules/authority/index.js`); } catch { /* not here */ } }
    if (on('agreements')) { try { agreements = await import(`${r.base}modules/agreements/index.js`); } catch { /* not here */ } }
  }
  return { ...x, r, registry, ident, authority, agreements };
}
// Make one of the entities the one the page is about.
function use(x) {
  Object.assign(ctx, { r: x.r, registry: x.registry, ident: x.ident, authority: x.authority, agreements: x.agreements, key: x.key });
  if (x.r.ok) fillInstitutions();
}
export const entity = (key) => ctx.all.find(x => x.key === key) || null;
// Run fn with another entity as the page's own (to sign or apply there), then come back.
export async function withEntity(key, fn) {
  const was = entity(ctx.key), x = entity(key);
  if (!x || !x.r?.ok) { toast('That record could not be reached.', true); return false; }
  use(x);
  try { return await fn(); } finally { x.ident = ctx.ident; use(was); drawWho(); }
}
// The address of a page of this site, about the entity it is about now.
export const pageFor = (href, key = ctx.key) => {
  if (!key || key === ctx.all[0]?.key || href.startsWith('chat.html')) return href; // chat is kept by this site's own node
  const [path, hash] = href.split('#');
  return `${path || 'index.html'}?e=${encodeURIComponent(key)}${hash !== undefined ? `#${hash}` : ''}`;
};

export async function start() {
  buildMasthead(); buildFooter(); storageNotice();
  let list = [{ key: 'home', label: null, url: './' }];
  if (SITE.entities) {
    try { const got = await (await fetch(SITE.entities, { cache: 'no-store' })).json(); if (Array.isArray(got) && got.length) list = got; }
    catch { /* only this site's own entity */ }
  }
  const opened = await Promise.allSettled(list.map(openEntity));
  ctx.all = opened.map((o, i) => (o.status === 'fulfilled' ? o.value : { ...list[i], r: null, error: o.reason?.message || String(o.reason) }));
  if (!ctx.all[0].r) { seal(false, `The record could not be reached: ${ctx.all[0].error}`); throw new Error(ctx.all[0].error); }
  const want = new URLSearchParams(location.search).get('e');
  use(ctx.all.find(x => x.key === want && x.r) || ctx.all[0]);
  for (const x of ctx.all) if (x.r) x.r.on('change', () => { if (x.key === ctx.key) { drawSeal(); drawWho(); drawBrand(); drawNav(); } fire(); });
  drawSeal(); drawWho(); drawBrand(); drawNav(); drawEntities();
  return ctx.r;
}

export const enabled = (m) => !!ctx.r?.ok && ctx.r.params.value('entity.modules').includes(m);
export const me = () => (ctx.ident && ctx.r?.ok ? ctx.r.state.participants[ctx.ident.id] || null : null);
export const isCitizen = () => me()?.status === 'active';
// A person's preferred name (their title, or the name they joined with), else their id.
export const nameOf = (id) => { const t = ctx.r.state.m.titles?.[id]; return (typeof t === 'string' ? t : t?.title) || ctx.r.state.participants[id]?.name || id; };
// How a person is shown everywhere: "Ada Lovelace (ada)", or just "ada" with no other name.
export const displayName = (id) => { const n = nameOf(id); return n && n !== id ? `${n} (${id})` : id; };
export const setting = (key, fallback) => (ctx.r?.ok && ctx.r.params.has(key) ? ctx.r.params.value(key) : fallback);
// The entity's name: in full, and as it reads mid-sentence ("the Virtual Democratic Republic").
export const fullName = () => (ctx.r?.ok ? ctx.r.params.value('entity.name') : document.title.split(' · ').pop());
export const runningName = () => setting('republic.short_name', '') || `the ${fullName().replace(/^the\s+/i, '')}`;

// ── the masthead, the same on every page ───────────────────────────────────
const PAGES = SITE.pages;
function buildMasthead() {
  const head = $('header.masthead');
  head.replaceChildren(h('div', { class: 'masthead-inner' },
    h('a', { class: 'brand', href: 'index.html', id: 'brand' }, h('img', { src: 'flag.svg', alt: '', width: 42, height: 28 }), h('span', {}, h('span', { id: 'brand-name' }, fullName()), h('span', { class: 'motto', id: 'brand-motto' }))),
    h('nav', { 'aria-label': 'Pages', id: 'nav' }),
    h('div', { class: 'who', id: 'who' })),
    h('nav', { class: 'entities', id: 'entities', 'aria-label': 'Which entity', hidden: true }));
  drawNav();
  // Sticky things below the masthead sit under it, whatever its height.
  if ('ResizeObserver' in window) new ResizeObserver(([e]) => document.documentElement.style.setProperty('--masthead-h', `${Math.round(e.target.getBoundingClientRect().height)}px`)).observe(head);
  addEventListener('hashchange', () => { drawNav(); drawEntities(); });
}
function drawNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const withHash = PAGES.find(([href]) => href.startsWith(here + '#/') && location.hash.startsWith(href.slice(here.length)));
  const current = withHash ? withHash[0] : here;
  $('#nav')?.replaceChildren(...PAGES.slice(1).filter(([, , needs]) => !needs || !ctx.r?.ok || enabled(needs))
    .map(([href, label]) => h('a', { href: pageFor(href), 'aria-current': href === current ? 'page' : null }, label)));
}
// With several entities: which one the page is about, and the others.
function drawEntities() {
  const box = $('#entities'); if (!box) return;
  if (ctx.all.length < 2) { box.hidden = true; return; }
  const here = location.pathname.split('/').pop() || 'index.html';
  box.hidden = false;
  box.replaceChildren(...ctx.all.map((x, i) => h('a', { href: `${here}${i ? `?e=${encodeURIComponent(x.key)}` : ''}${location.hash}`, 'aria-current': x.key === ctx.key ? 'true' : null, class: x.r ? null : 'down', title: x.r ? null : `Not reachable: ${x.error}` }, x.label || (x.r?.ok ? x.r.params.value('entity.name') : x.key))));
}
function drawBrand() {
  if (!ctx.r?.ok) return;
  $('#brand-name').textContent = fullName();
  $('#brand-motto').textContent = setting('republic.motto', '');
  $('#brand').setAttribute('aria-label', `${fullName()}, home`);
  document.title = document.title.replace(/[^·]*$/, ` ${fullName()}`).replace(/^\s+/, '');
  for (const el of document.querySelectorAll('[data-name]')) el.textContent = el.dataset.name === 'running' ? runningName() : el.dataset.name === 'Running' ? runningName().replace(/^t/, 'T') : fullName();
  for (const el of document.querySelectorAll('[data-motto]')) { el.textContent = setting('republic.motto', ''); el.hidden = !el.textContent; }
  const w = W(); for (const el of document.querySelectorAll('[data-w]')) if (w[el.dataset.w] !== undefined) el.textContent = w[el.dataset.w];
}

// The footer, the same on every page: the seal, the links, and what this is.
function buildFooter() {
  const f = $('footer.footer'); if (!f) return;
  f.replaceChildren(
    h('p', { id: 'seal', class: 'seal' }, 'Checking the record…'),
    h('nav', { class: 'footer-links', 'aria-label': 'About this site' },
      h('a', { href: 'privacy.html' }, 'Privacy and cookies'),
      h('button', { class: 'linklike', type: 'button', onclick: () => preferencesDialog() }, 'Display and accessibility'),
      h('button', { class: 'linklike', type: 'button', onclick: () => browserCheckDialog() }, 'Check this browser'),
      h('a', { href: 'record/events.jsonl' }, 'Download the record')),
    h('p', { class: 'fine' }, h('span', { 'data-name': 'Running' }, cap(SITE.body)), ` ${SITE.about ? `${SITE.about} ` : ''}Everything on these pages is worked out in your own browser from the public record, which anyone can download and check.`));
}

function drawWho() {
  const box = $('#who'); if (!box) return;
  if (!ctx.r?.ok) { box.replaceChildren(); return; }
  // Signed in here, or (on a site of several entities) in one of the others.
  const p = me() || (ctx.all.find(x => x.ident)?.ident ? { id: ctx.all.find(x => x.ident).ident.id } : null);
  if (p) box.replaceChildren(h('span', { class: 'signed' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), ctx.r.state.participants[p.id] ? displayName(p.id) : p.id),
    h('button', { class: 'linklike', type: 'button', onclick: signOut }, 'Sign out'));
  else box.replaceChildren(h('button', { class: 'linklike', type: 'button', onclick: () => signInDialog() }, 'Sign in'));
}

// ── the seal in the footer ─────────────────────────────────────────────────
function seal(ok, text) { const s = $('#seal'); if (!s) return; s.className = `seal ${ok ? 'ok' : 'bad'}`; s.innerHTML = text; }
function drawSeal() {
  const r = ctx.r;
  if (!r.ok) return seal(false, `This record did not verify: ${esc(r.problems[0]?.problem || 'unknown problem')}. Do not rely on what this page shows.`);
  if (r.disagree.length) return seal(false, 'Copies of the record disagree. Do not rely on what this page shows until that is resolved.');
  seal(true, `${r.records.length} records, all signatures checked in this browser. <span class="hash">Latest ${esc(String(r.head).slice(0, 16))}</span>`);
}

// ── dialogs ────────────────────────────────────────────────────────────────
function dialog(...kids) {
  const d = h('dialog', { class: 'site-dialog' }, ...kids);
  document.body.append(d);
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
  d.showModal();
  return d;
}

export function toast(text, bad = false) {
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.classList.add('gone'), 4200);
  setTimeout(() => t.remove(), 4800);
}

// ── when the browser cannot do the cryptography ───────────────────────────
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms))]);
export function cryptoProblem(e) {
  if (!window.isSecureContext || !globalThis.crypto?.subtle) return 'This page is not on a secure (https) address, so the browser will not sign anything. Open it at its https address.';
  if (/NotSupported|not supported|Unrecognized|Algorithm/i.test(`${e?.name} ${e?.message}`) || e?.name === 'OperationError')
    return `This browser could not make your signing key (${e.message || e.name}). "Check this browser", at the foot of the page, shows what it can and cannot do.`;
  return `Signing in failed: ${e?.message || e}`;
}

// ── signing in and out ─────────────────────────────────────────────────────
export function signInDialog(prefill = '') {
  return new Promise((resolve) => {
    const out = h('p', { class: 'status', role: 'status' });
    const form = h('form', { method: 'dialog' },
      h('h2', {}, 'Sign in'),
      h('p', { class: 'fine' }, 'Your password stays in this browser. It is turned into your signing key here and is never sent anywhere.'),
      h('label', { for: 'si-id' }, 'Your id'), h('input', { id: 'si-id', autocomplete: 'username', spellcheck: 'false', autocapitalize: 'none', value: prefill, required: true }),
      h('label', { for: 'si-pw' }, 'Password'), h('input', { id: 'si-pw', type: 'password', autocomplete: 'current-password', required: true }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'si-keep' }), 'Stay signed in on this device without asking for my password'),
      h('p', { class: 'fine' }, 'On a shared computer, leave this unticked. Your key then stays locked, and you type your password each time you sign something.'),
      out,
      h('p', { class: 'fine' }, `Not ${W().a} ${W().one} yet? `, h('button', { class: 'linklike', type: 'button', onclick: async () => { d.close(); resolve(await joinDialog()); } }, 'Become one'), '.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit', value: 'go' }, 'Sign in'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(false); } }, 'Cancel')));
    const d = dialog(form);
    if (prefill) setTimeout(() => $('#si-pw', d).focus(), 0);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = $('#si-id', d).value.trim().toLowerCase(), pw = $('#si-pw', d).value;
      // On a site of several entities, someone may belong to another one only.
      let target = entity(ctx.key) || { r: ctx.r, key: ctx.key }, p = ctx.r.state.participants[id];
      if (!p) { const other = ctx.all.find(x => x.r?.ok && x.r.state.participants[id]); if (other) { target = other; p = other.r.state.participants[id]; } }
      if (!p) { out.textContent = `No one has the id ${id || '(empty)'}.`; return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      out.classList.remove('bad'); out.textContent = 'Making your key from your password…';
      const slow = setTimeout(() => { out.textContent = 'Still working. On a slow device this can take up to a minute.'; }, 6000);
      let k;
      try { k = await E.passwordKey(target.r.state.entity.id, id, pw); }
      catch (e) { clearTimeout(slow); btn.disabled = false; out.classList.add('bad'); out.textContent = cryptoProblem(e); return; }
      clearTimeout(slow); btn.disabled = false;
      if (!p.keys.includes(E.keys.keyId(E.keys.publicKeyLine(k.publicKey)))) { out.classList.add('bad'); out.textContent = 'Wrong password for this id.'; return; }
      const keep = $('#si-keep', d).checked;
      const ident = keep ? { id, seed: k.seed, publicKey: k.publicKey, via: 'password', remember: true, created: new Date().toISOString() }
        : { id, publicKey: k.publicKey, locked: await lockSeed(k.seed, pw), via: 'password', created: new Date().toISOString() };
      if (target.key === ctx.key) ctx.ident = ident;
      target.ident = ident;
      const kept = await withTimeout(K.saveIdentity(target.r.state.entity.id, ident), 4000).then(() => true, () => false);
      if (!kept) toast('This browser would not store your key (perhaps a private window), so you stay signed in only until you leave this page.');
      await signInElsewhere(id, pw, keep);
      d.close(); drawWho(); fire(); signed(); toast(`Signed in as ${ctx.r.state.participants[id] ? displayName(id) : id}.`); resolve(true);
    });
  });
}

// The same password makes this member's key in every other entity on the
// site they belong to (the key differs per entity; the password does not).
export async function signInElsewhere(id, pw, keep) {
  for (const x of ctx.all) {
    if (!x.r?.ok || !x.r.state.participants[id] || x.ident?.id === id) continue;
    try {
      const k = await E.passwordKey(x.r.state.entity.id, id, pw);
      if (!x.r.state.participants[id].keys.includes(E.keys.keyId(E.keys.publicKeyLine(k.publicKey)))) continue;
      x.ident = keep ? { id, seed: k.seed, publicKey: k.publicKey, via: 'password', remember: true, created: new Date().toISOString() }
        : { id, publicKey: k.publicKey, locked: await lockSeed(k.seed, pw), via: 'password', created: new Date().toISOString() };
      if (x.key === ctx.key) ctx.ident = x.ident;
      await withTimeout(K.saveIdentity(x.r.state.entity.id, x.ident), 4000).catch(() => {});
    } catch { /* not signed in there */ }
  }
}

// Joining: choose an id and a password; the key is made from them here, the
// application is signed with it, and the new member is signed in. Where the
// entity requires documents to be signed before admission
// (agreements.required: a pledge, terms), they are shown here and signed with
// the same key, straight after the application. Where admission is by decision,
// the Assembly then admits them.
export function joinDialog() {
  return new Promise((resolve) => {
    const r = ctx.r, out = h('p', { class: 'status', role: 'status' });
    const min = r.params.has('passwords.min_length') ? r.params.value('passwords.min_length') : 12;
    const age = setting('republic.min_age', SITE.minAge), w = W();
    const open = setting('membership.admission', 'open') === 'open';
    const docs = docsToSign();
    const form = h('form', { method: 'dialog' },
      h('h2', {}, open ? `Become ${w.a} ${w.one}` : `Apply to join`),
      h('p', { class: 'fine' }, open ? `Anyone ${age} or older can join. You need an id and a password; nothing else is asked.`
        : `Anyone ${age} or older can apply. You need an id and a password${docs.length ? `, and to sign ${docs.map(x => x.title).join(' and ')}` : ''}. The ${w.assembly} then votes to admit you.`),
      h('label', { for: 'jn-name' }, 'Your name, as others will see it (optional)'), h('input', { id: 'jn-name', autocomplete: 'nickname', maxlength: 60, placeholder: 'A name or a pseudonym' }),
      h('label', { for: 'jn-id' }, 'Your id'), h('input', { id: 'jn-id', autocomplete: 'username', spellcheck: 'false', autocapitalize: 'none', placeholder: 'lowercase letters, digits and -', required: true }),
      h('label', { for: 'jn-pw' }, `Password (${min} or more characters)`), h('input', { id: 'jn-pw', type: 'password', autocomplete: 'new-password', required: true }),
      h('label', { for: 'jn-pw2' }, 'Password again'), h('input', { id: 'jn-pw2', type: 'password', autocomplete: 'new-password', required: true }),
      h('p', { class: 'fine' }, 'No one can recover a lost password, including us. Keep it somewhere safe.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'jn-age', required: true }), `I am ${age} or older.`),
      docs.map((x, i) => [h('div', { class: 'pledge' }, h('h3', {}, x.title), h('div', { class: 'pledge-text serif', html: true }, renderText(x.body).html)),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: `jn-doc-${i}`, required: true }), `I sign ${x.title}.`)]),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'jn-public', required: true }), h('span', {}, `I understand that my id, my name and everything I sign are published on ${w.body}’s public record, which cannot be edited or deleted. `, h('a', { href: 'privacy.html', target: '_blank' }, 'How your data is handled'), '.')),
      out,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, open ? 'Sign and join' : 'Sign and apply'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(false); } }, 'Cancel')));
    const d = dialog(form);
    for (const el of d.querySelectorAll('[html]')) { el.innerHTML = el.textContent; el.removeAttribute('html'); }
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = $('#jn-id', d).value.trim().toLowerCase(), pw = $('#jn-pw', d).value;
      if (!$('#jn-age', d).checked || !$('#jn-public', d).checked || docs.some((x, i) => !$(`#jn-doc-${i}`, d).checked)) { out.textContent = 'Please confirm every statement to join.'; return; }
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) { out.textContent = 'An id is 1 to 40 characters: lowercase letters, digits and hyphens, starting with a letter or digit.'; return; }
      if (r.state.participants[id]) { out.textContent = `${id} is taken. Choose another, or sign in if it is yours.`; return; }
      if (pw !== $('#jn-pw2', d).value) { out.textContent = 'The passwords do not match.'; return; }
      const why = E.passwordProblem(pw, id, min); if (why) { out.textContent = `Choose a stronger password: ${why}.`; return; }
      try {
        out.textContent = 'Making your key and signing…';
        const k = await E.passwordKey(r.state.entity.id, id, pw);
        const name = $('#jn-name', d).value.trim();
        const act = await E.makeActWith(ctx.registry, r.state, 'participant.apply', { by: id, key: E.keys.publicKeyLine(k.publicKey), ...(name ? { name } : {}) }, (m, ns) => E.keys.sign(m, k, ns));
        const before = r.records.length;
        const res = await fetch(new URL('acts', r.base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(act) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.refused?.length || body.why) throw new Error(body.refused?.[0]?.why || body.why || `the node answered ${res.status}`);
        await grown(before);
        // The documents admission requires, signed with the same key.
        for (const x of docs) {
          const sa = await E.makeActWith(ctx.registry, r.state, 'agreement.sign', { by: id, page: x.page, version: x.version, text: x.text }, (m, ns) => E.keys.sign(m, k, ns));
          const n = r.records.length;
          const rs = await fetch(new URL('acts', r.base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sa) });
          const bs = await rs.json().catch(() => ({}));
          if (!rs.ok || bs.refused?.length) throw new Error(`your application went in, but signing ${x.title} was refused: ${bs.refused?.[0]?.why || rs.status}. Sign it later from the Agreements tab.`);
          await grown(n);
        }
        ctx.ident = { id, publicKey: k.publicKey, locked: await lockSeed(k.seed, pw), via: 'password', created: new Date().toISOString() };
        await K.saveIdentity(r.state.entity.id, ctx.ident);
        d.close(); drawWho(); fire(); signed();
        toast(me()?.status === 'active' ? `Welcome, ${displayName(id)}. You are now ${w.a} ${w.one}.` : `Thanks, ${displayName(id)}. Your application is in; the ${w.assembly} votes on admitting you.`);
        resolve(true);
      } catch (e) { out.textContent = /signature|refused|answered|taken|register/i.test(e.message) ? e.message : cryptoProblem(e); out.classList.add('bad'); }
    });
  });
}

// The documents an applicant must sign (agreements.required), in the version
// that counts, with the fingerprint the signature carries.
function docsToSign() {
  if (!enabled('agreements') || !ctx.agreements) return [];
  return setting('agreements.required', []).map(page => {
    const v = ctx.agreements.current(ctx.r.state, page, ctx.r.params);
    return v ? { page, version: v.n, title: v.title, body: v.body, text: ctx.agreements.fingerprint(page, v) } : null;
  }).filter(Boolean);
}

async function signOut() {
  for (const x of ctx.all) { if (x.r?.ok) await withTimeout(K.forgetIdentity(x.r.state.entity.id), 4000).catch(() => {}); x.ident = null; }
  ctx.ident = null; drawWho(); fire(); signed(); toast('Signed out. Your key was removed from this browser.');
}

// ── signing acts ───────────────────────────────────────────────────────────
// steps: [[kind, fields, label]], or a function (previousResults) → step, for
// acts that depend on an earlier one (a page version, then enacting it). Each
// is shown in full, signed here with the member's own key, and sent to the
// node, which settles it; the page waits until the record shows it.
export async function signAll(steps, title) {
  const r = ctx.r;
  if (!me() && !(await signInDialog())) return false;
  if (me().status !== 'active' && !steps.every(s => typeof s !== 'function' && s[0] === 'agreement.sign') && !confirm(`You are not an active ${W().one} yet, so ${W().body} will refuse most acts you sign. Sign anyway?`)) return false;
  const first = steps.map(s => (typeof s === 'function' ? null : s));
  return new Promise((resolve) => {
    const out = h('p', { class: 'status', role: 'status' });
    const locked = !!ctx.ident.locked;
    const form = h('form', { method: 'dialog' },
      h('h2', {}, title || first[0]?.[2] || 'Sign this'),
      h('p', { class: 'fine' }, `Signing as ${displayName(ctx.ident.id)}. Read it through: your signature applies to exactly this, and it goes on the public record for good.`),
      first.map((s, i) => (s ? h('pre', { class: 'act' }, JSON.stringify({ kind: s[0], ...s[1] }, null, 2)) : h('p', { class: 'fine' }, `Then step ${i + 1}, which follows from the one before it.`))),
      locked ? [h('label', { for: 'sg-pw' }, 'Your password'), h('input', { id: 'sg-pw', type: 'password', autocomplete: 'current-password', required: true })] : null,
      out,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Sign and send'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(false); } }, 'Cancel')));
    const d = dialog(form);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        out.textContent = 'Signing…';
        const seed = locked ? await unlockSeed(ctx.ident.locked, $('#sg-pw', d).value) : ctx.ident.seed;
        const fn = (m, ns) => E.keys.sign(m, { seed, publicKey: ctx.ident.publicKey }, ns);
        const results = [];
        for (const s of steps) {
          const [kind, fields] = typeof s === 'function' ? s(results) : s;
          const act = await E.makeActWith(ctx.registry, r.state, kind, { by: ctx.ident.id, ...fields }, fn);
          const before = r.records.length;
          let { res, body } = await postAct(act);
          if (body.twofactor) {
            out.textContent = 'This site uses email two-factor: confirming this browser…';
            const T = await import('./interface/js/twofactor.js');
            await T.confirmBrowser({ id: ctx.ident.id, sign: fn, ask: askCode });
            ({ res, body } = await postAct(act));
            out.textContent = 'Signing…';
          }
          if (!res.ok || body.refused?.length || body.why) throw new Error(body.refused?.[0]?.why || body.why || `the node answered ${res.status}`);
          results.push({ act, body });
          await grown(before);
        }
        d.close(); toast('Signed, sent and recorded.'); signed(); resolve(results);
      } catch (e) { out.textContent = /password|refused|answered|not|only|must|already/i.test(e.message) && !/supported/i.test(e.message) ? e.message : cryptoProblem(e); out.classList.add('bad'); }
    });
  });
}
export const sign = (kind, fields, label) => signAll([[kind, fields, label]], label);

async function postAct(act) {
  const res = await fetch(new URL('acts', ctx.r.base), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(act) });
  return { res, body: await res.json().catch(() => ({})) };
}

// Asking for an email address, or for the six-digit code: a small dialog.
export function askCode({ step, to, error, policy, confirming }) {
  return new Promise((resolve) => {
    const isEmail = step === 'email';
    const input = h('input', isEmail ? { id: 'tf-in', type: 'email', autocomplete: 'email', required: true }
      : { id: 'tf-in', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]{6,7}', maxlength: 7, required: true, class: 'code-input' });
    const form = h('form', { method: 'dialog' },
      h('h2', {}, isEmail ? 'Turn on email two-factor' : 'Check your email'),
      h('p', { class: 'fine' }, isEmail ? `${policy && policy !== 'optional' ? `${W().Body} requires email two-factor of you. ` : ''}Sign-in codes will go to this address. It is kept by ${W().body}’s server alone, and never published.`
        : `${confirming ? 'To confirm the address, enter' : 'Enter'} the six-digit code we sent to ${to}. It works once, for a few minutes.`),
      h('label', { for: 'tf-in' }, isEmail ? 'Email address' : 'Code'), input,
      error ? h('p', { class: 'status bad', role: 'alert' }, error) : null,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, isEmail ? 'Send me a code' : 'Confirm'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(null); } }, 'Cancel')));
    const d = dialog(form);
    setTimeout(() => input.focus(), 0);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = input.value.trim(); d.close(); resolve(v); });
  });
}

// Wait until the record has grown past n (the node settles and announces it).
function grown(n, ms = 6000) {
  return new Promise((resolve) => {
    if (ctx.r.records.length > n) return resolve();
    const off = ctx.r.on('change', () => { if (ctx.r.records.length > n) { off(); clearTimeout(t); resolve(); } });
    const t = setTimeout(() => { off(); resolve(); }, ms);
  });
}

// A proposal, or the use of a grant the signed-in member holds.
export function grantsFor(effects) {
  const A = ctx.authority, p = me(), st = ctx.r.state;
  if (!A || !p || p.status !== 'active') return [];
  const at = new Date().toISOString();
  return Object.values(st.m.authority?.grants || {}).filter(g => A.inForce(st, g.id)
    && (A.body(st, g.to, at) || []).includes(p.id)
    && effects.every(e => g.may.includes(e.kind) && (e.kind === 'authority.grant' || e.kind === 'authority.revoke' || !A.outside(g.where, e))));
}
export async function propose(title, effects, text) {
  const r = ctx.r, g = grantsFor(effects)[0];
  if (g && confirm(`You hold the power "${g.title || g.id}", so you can do this without a vote. It will be published, and the ${W().many} can reverse it.\n\nOK: do it now. Cancel: put it to a vote instead.`)) {
    return sign('authority.exercise', { grant: g.id, effects, ...(text ? { note: String(text).slice(0, 1000) } : {}) }, `Using the power ${g.title || g.id}: ${title}`);
  }
  const rule = E.required(r.params, { title, effects, text }, ctx.registry).name;
  return sign('proposal.lay', { title, ...(text ? { text } : {}), rule, effects }, `Your bill "${title}" (${rule} rule)`);
}

// ── text: the entity's texts are written in a small markdown ─────────────
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function renderText(md, { anchors = '' } = {}) {
  const out = [], heads = []; let para = [], list = null;
  const flushP = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushL = () => { if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
  for (const raw of String(md).split('\n')) {
    const l = raw.trim();
    if (!l) { flushP(); flushL(); continue; }
    const hd = l.match(/^#{1,3}\s+(.*)/), n = l.match(/^\d+\.\s+(.*)/), u = l.match(/^[-*]\s+(.*)/);
    if (hd) { flushP(); flushL(); const id = anchors ? `${anchors}-${slug(hd[1])}` : ''; heads.push({ id, text: hd[1] }); out.push(`<h3${id ? ` id="${id}"` : ''}>${inline(hd[1])}</h3>`); continue; }
    if (n || u) { flushP(); const tag = n ? 'ol' : 'ul'; if (list?.tag !== tag) { flushL(); list = { tag, items: [] }; } list.items.push((n || u)[1]); continue; }
    if (list) flushL();
    para.push(l);
  }
  flushP(); flushL();
  return { html: out.join(''), heads };
}

// ── the module host: what a module's ui.js is given to draw itself ─────────
// The same contract as the republic's own page (interface/js/app.js), so every
// module that can draw itself there can draw itself here, unchanged.
export function moduleApi({ link, go, refresh }) {
  const r = ctx.r;
  const who = (id) => (r.state.participants[id] ? link(`members/${id}`, displayName(id)) : id);
  return {
    h, $, state: r.state, params: r.params, registry: ctx.registry, me: me(), ident: ctx.ident, E,
    words: (({ one, many, assembly, proposal }) => ({ one, many, assembly, proposal }))(W()),
    day, when, link, go, who, refresh, nameOf: displayName, grantsFor, editForm,
    sign: (kind, fields, label, then = []) => signAll([[kind, fields, label], ...then.map(([k, f]) => [k, f, k])], label),
    propose,
    section: (title, ...kids) => h('section', {}, title ? h('h2', {}, title) : null, ...kids),
    list: listView, sorts: { byText, newest, oldest },
    key: async () => {
      if (!ctx.ident || ctx.ident.passkey) return null;
      if (!ctx.ident.locked) return { seed: ctx.ident.seed, publicKey: ctx.ident.publicKey };
      const pw = prompt('Your password, to open sealed matters'); if (!pw) return null;
      return { seed: await unlockSeed(ctx.ident.locked, pw), publicKey: ctx.ident.publicKey };
    },
  };
}

const byText = (f) => (a, b) => String(f(a)).localeCompare(String(f(b)), undefined, { numeric: true, sensitivity: 'base' });
const newest = (f = (x) => x.at) => (a, b) => (f(a) < f(b) ? 1 : f(a) > f(b) ? -1 : 0);
const oldest = (f = (x) => x.at) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);

// Lists: yours first; search, sort and filters once long enough; pages.
const views = {};
export function listView(o) {
  const v = views[o.key] ||= { q: '', sort: 0, f: {}, others: false, page: 1 };
  const small = !!o.row, size = o.size || (small ? 20 : 10);
  const results = h('div');
  const draw = () => {
    const q = v.q.trim().toLowerCase();
    let list = o.items.filter(it => !q || (o.text ? o.text(it) : '').toLowerCase().includes(q));
    for (const [i, f] of (o.filters || []).entries()) { const opt = f.options[v.f[i] || 0]; if (opt) list = list.filter(opt[1]); }
    const s = (o.sorts || [])[v.sort]; if (s) list = list.slice().sort(s[1]);
    if (o.pin) list = [...list.filter(o.pin), ...list.filter(it => !o.pin(it))];
    const mine = o.mine ? list.filter(o.mine) : [];
    const hide = o.mine && mine.length && !v.others;
    const shown = hide ? mine : o.mine ? [...mine, ...list.filter(it => !o.mine(it))] : list;
    const pages = Math.max(1, Math.ceil(shown.length / size)); v.page = Math.min(v.page, pages);
    const slice = shown.slice((v.page - 1) * size, v.page * size);
    const kids = [];
    if (!shown.length) kids.push(h('p', { class: 'hint' }, q ? 'Nothing matches.' : (o.empty || 'Nothing yet.')));
    else if (small) kids.push(h('div', { class: 'scroll' }, h('table', {}, o.head ? h('thead', {}, h('tr', {}, o.head.map(x => h('th', {}, x)))) : null, h('tbody', {}, slice.map(o.row)))));
    else kids.push(h('ul', { class: 'items' }, slice.map((it) => { const li = o.render(it); const e = o.edit && o.edit(it); if (e && li) li.append(e); return li; })));
    if (pages > 1) kids.push(h('nav', { class: 'pager', 'aria-label': 'Pages' }, Array.from({ length: pages }, (_, i) =>
      h('button', { class: i + 1 === v.page ? '' : 'quiet', 'aria-current': i + 1 === v.page ? 'page' : null, onclick: () => { v.page = i + 1; draw(); } }, String(i + 1)))));
    if (o.mine && mine.length && list.length > mine.length) kids.push(h('div', { class: 'buttons' },
      h('button', { class: 'quiet', onclick: () => { v.others = !v.others; v.page = 1; draw(); } }, v.others ? `Only yours (${mine.length})` : `Show everyone else's too (${list.length - mine.length})`)));
    results.replaceChildren(...kids);
  };
  const controls = [], n = o.items.length;
  if (o.text && n > 5) controls.push(h('input', { type: 'search', class: 'find', placeholder: `Search ${o.noun || ''}`.trim(), value: v.q, 'aria-label': `Search ${o.noun || ''}`, oninput: (e) => { v.q = e.target.value; v.page = 1; draw(); } }));
  if ((o.sorts || []).length > 1 && n > 3) controls.push(h('select', { 'aria-label': 'Sort', onchange: (e) => { v.sort = Number(e.target.value); draw(); } }, o.sorts.map(([label], i) => h('option', { value: i, selected: i === v.sort }, label))));
  for (const [i, f] of (o.filters || []).entries()) {
    if (f.options.filter(([, t]) => o.items.some(t)).length > 1 && n > 3) controls.push(h('select', { 'aria-label': f.label, onchange: (e) => { v.f[i] = Number(e.target.value); v.page = 1; draw(); } }, f.options.map(([label], j) => h('option', { value: j, selected: j === (v.f[i] || 0) }, label))));
  }
  draw();
  return h('div', { class: 'listview' }, controls.length ? h('div', { class: 'controls' }, controls) : null, results);
}

// An "Edit" panel: fields [[key, label, value, kind?, options?]]; only what
// changed is passed to submit(changes).
export function editForm(title, fields, submit) {
  const rows = fields.map(([key, label, value, kind = 'text', opts]) => {
    const id = 'ed-' + Math.random().toString(36).slice(2, 9);
    const el = kind === 'textarea' || kind === 'lines' ? h('textarea', { id }, kind === 'lines' ? (value || []).join('\n') : (value ?? ''))
      : kind === 'bool' ? h('input', { id, type: 'checkbox', checked: !!value })
      : kind === 'select' ? h('select', { id }, opts.map(o => h('option', { value: o, selected: String(value ?? '') === String(o) ? true : null }, o)))
      : h('input', { id, type: kind === 'number' ? 'number' : kind === 'datetime' ? 'datetime-local' : 'text', value: kind === 'datetime' && value ? new Date(value).toISOString().slice(0, 16) : (value ?? '') });
    return { key, label, value, kind, el, id };
  });
  const read = (x) => {
    if (x.kind === 'bool') return x.el.checked;
    const v = x.el.value;
    if (x.kind === 'number') return v === '' ? null : Number(v);
    if (x.kind === 'datetime') return v ? new Date(v).toISOString() : x.value;
    if (x.kind === 'lines') return v.split('\n').map(s => s.trim()).filter(Boolean);
    if (x.kind === 'select' && /^\d+$/.test(v)) return Number(v);
    return v;
  };
  return h('details', { class: 'edit' }, h('summary', {}, title || 'Edit'), h('div', { class: 'inline-form' },
    rows.map(x => (x.kind === 'bool' ? h('label', { class: 'check' }, x.el, x.label) : [h('label', { for: x.id }, x.label), x.el])),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const changes = {};
      for (const x of rows) {
        const v = read(x), old = x.kind === 'lines' ? (x.value || []) : x.kind === 'bool' ? !!x.value : x.value ?? (x.kind === 'number' ? null : '');
        if (JSON.stringify(v) !== JSON.stringify(old)) changes[x.key] = v;
      }
      if (!Object.keys(changes).length) return alert('Nothing has changed.');
      submit(changes);
    } }, 'Propose these changes'))));
}

// What each institution is, in a line, for the ones the kit knows, in the
// entity's own words; a site's config.js may say more. Any other module the
// Assembly installs still appears, under its own name.
export const INSTITUTIONS = {};
function fillInstitutions() {
  const { many, body, Body, proposals } = W();
  for (const k of Object.keys(INSTITUTIONS)) delete INSTITUTIONS[k];
  Object.assign(INSTITUTIONS, {
    elections: ['Elections', 'Who is standing, who voted, and who won.'],
    offices: ['Offices', 'The posts, their terms and who holds them.'],
    committees: ['Committees', `Groups of ${many} with a job to do.`],
    authority: ['Powers', 'What officers may do without a vote, and every time they did it.'],
    polls: ['Polls', `Questions put to the ${many}. A poll decides nothing.`],
    meetings: ['Meetings', 'Meetings, with agendas and minutes.'],
    badges: ['Honours', `Honours ${body} awards its ${many}.`],
    wiki: ['Texts', 'Shared documents, with every version kept.'],
    laws: ['Parliament and the laws', 'Bills in Parliament, petitions, referendums, and the laws in force.'],
    republic: ['Settings', 'The motto, the privacy contact and the minimum age.'],
    titles: ['Names', `Lets each of the ${many} choose the name others see.`],
    vocabulary: ['Words', `What ${body} calls its ${many}, ${proposals} and Assembly.`],
    passwords: ['Passwords', 'Signing in with a password. Removing it stops password sign-in.'],
    twofactor: ['Two-factor', 'Sign-in codes by email.'],
    threads: ['Forum', 'Discussion boards.'],
    chat: ['Chat', 'Channels for talking things over, kept by this site and never on the public record.'],
    tasks: ['Tasks', 'Jobs that need doing and who took them on.'],
    lending: ['Lending', `Things ${body} lends out, and who has them.`],
    things: ['Library of things', `Things ${many} lend each other, for a deposit or none.`],
    budget: ['Budget', 'Money approved for spending, and what was spent.'],
    value: ['Currency', `${Body}’s own currency and who holds it.`],
    disputes: ['Disputes', 'Complaints and how they were settled.'],
    agreements: ['Agreements', `Documents ${many} sign.`],
    contracts: ['Contracts', `Agreements between ${many}.`],
    deeds: ['Deeds', 'Who owns what.'],
    fund: ['Common fund', 'Money held in common.'],
    shares: ['Shares', 'Ownership units and who holds them.'],
    sealed: ['Sealed posts', 'Posts only key holders can read.'],
    finality: ['Finality', 'Checkpoints that make the record final.'],
    endowment: ['Endowment', 'Gifts kept as capital.'],
    loans: ['Loans', 'Interest-free loans from a common fund.'],
  }, typeof SITE.institutions === 'function' ? SITE.institutions(W()) : SITE.institutions);
}
fillInstitutions();
export const institutionTitle = (m) => INSTITUTIONS[m]?.[0] || m[0].toUpperCase() + m.slice(1).replace(/-/g, ' ');

// ── display and accessibility preferences ──────────────────────────────────
// Kept in this browser only (localStorage "site:prefs"); applied as attributes
// on <html>. Each page applies them before drawing, with a line in its <head>.
export const PREFS = [
  ['theme', 'Theme', [['', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']]],
  ['text', 'Text size', [['', 'Normal'], ['large', 'Large'], ['larger', 'Larger']]],
  ['contrast', 'Contrast', [['', 'Normal'], ['more', 'More']]],
  ['motion', 'Motion', [['', 'Match my device'], ['reduce', 'Reduce'], ['full', 'Allow']]],
  ['links', 'Links', [['', 'Underline in text'], ['underline', 'Underline everywhere']]],
  ['font', 'Font', [['', 'Default'], ['system', 'My system font'], ['spaced', 'Wider spacing, no serif']]],
];
const readPrefs = () => { try { return JSON.parse(localStorage.getItem('site:prefs') || '{}'); } catch { return {}; } };
export function applyPrefs(p = readPrefs()) {
  for (const [k] of PREFS) { if (p[k]) document.documentElement.dataset[k] = p[k]; else delete document.documentElement.dataset[k]; }
}
export function preferencesDialog() {
  const p = readPrefs();
  const box = h('div', { class: 'prefs' },
    h('h2', {}, 'Display and accessibility'),
    h('p', { class: 'fine' }, 'These settings are saved in this browser only. They are never sent anywhere.'),
    PREFS.map(([k, label, opts]) => h('div', { class: 'opt', role: 'radiogroup', 'aria-label': label }, h('span', {}, label),
      h('div', { class: 'seg' }, opts.map(([v, text]) => h('label', {}, h('input', { type: 'radio', name: `pref-${k}`, value: v, checked: (p[k] || '') === v || null,
        onchange: () => { const n = readPrefs(); if (v) n[k] = v; else delete n[k]; try { localStorage.setItem('site:prefs', JSON.stringify(n)); } catch { /* not kept */ } applyPrefs(n); } }), text))))),
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onclick: () => d.close() }, 'Done'),
      h('button', { class: 'secondary', type: 'button', onclick: () => { try { localStorage.removeItem('site:prefs'); } catch { /* none */ } applyPrefs({}); d.close(); } }, 'Reset')));
  const d = dialog(box);
}
applyPrefs();

// ── a short notice about what this site stores, once ──────────────────────
function storageNotice() {
  let seen = null; try { seen = localStorage.getItem('site:storage-notice'); } catch { /* storage off */ }
  if (seen) return;
  const gpc = navigator.globalPrivacyControl === true;
  const n = h('div', { class: 'consent', role: 'region', 'aria-label': 'About storage on this site' },
    h('p', {}, 'This site stores two things in your browser: your display settings, and your signing key if you sign in. It uses no tracking or advertising cookies, and sends nothing to anyone else.',
      gpc ? ' Your browser’s Global Privacy Control signal is on; we do not sell or share personal data in any case.' : ''),
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onclick: () => { try { localStorage.setItem('site:storage-notice', new Date().toISOString().slice(0, 10)); } catch { /* not kept */ } n.remove(); } }, 'OK'),
      h('a', { href: 'privacy.html' }, 'Privacy and cookies')));
  document.body.append(n);
}

// ── what this browser can do ───────────────────────────────────────────────
export async function browserChecks() {
  const out = [];
  const check = async (label, fn) => { try { const r = await fn(); out.push([label, r === true || r === undefined, typeof r === 'string' ? r : '']); } catch (e) { out.push([label, false, e.message || e.name]); } };
  await check('Secure connection (https)', () => window.isSecureContext || 'open the site at its https address');
  await check('Web Crypto', () => !!globalThis.crypto?.subtle || 'not available');
  await check('Ed25519 signatures (checking the record)', async () => { await crypto.subtle.importKey('raw', new Uint8Array(32).fill(1), { name: 'Ed25519' }, false, ['verify']); return true; });
  await check('Making a key from a password, and signing with it', async () => {
    const k = await E.passwordKey('e-check', 'check', 'a password long enough');
    const sig = await E.keys.sign('check', k, 'check');
    return (await E.keys.verify('check', sig, [E.keys.publicKeyLine(k.publicKey)], 'check')).ok || 'the signature did not verify';
  });
  await check('Keeping your key in this browser (IndexedDB)', () => new Promise((ok, no) => { const r = indexedDB.open('site-check'); r.onsuccess = () => { r.result.close(); indexedDB.deleteDatabase('site-check'); ok(true); }; r.onerror = () => no(r.error || new Error('refused')); }));
  await check('Saving settings (localStorage)', () => { localStorage.setItem('site:check', '1'); localStorage.removeItem('site:check'); return true; });
  await check('Live updates (EventSource)', () => 'EventSource' in window || 'not available: reload to see changes');
  return out;
}
export async function browserCheckDialog() {
  const list = h('ul', { class: 'checklist' }, h('li', {}, 'Checking…'));
  const d = dialog(h('div', {}, h('h2', {}, 'Check this browser'), h('p', { class: 'fine' }, navigator.userAgent), list,
    h('p', { class: 'fine' }, 'If something here fails, the message says why. Signing needs every line above “Saving settings”.'),
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onclick: () => d.close() }, 'Close'))));
  const res = await browserChecks();
  list.replaceChildren(...res.map(([label, ok, why]) => h('li', {}, h('span', { class: ok ? 'ok' : 'bad', 'aria-hidden': 'true' }, ok ? '✓ ' : '✗ '), h('span', { class: 'visually-hidden' }, ok ? 'Works: ' : 'Fails: '), label, why ? h('span', { class: 'fine' }, ` (${why})`) : '')));
}

// ── your data ──────────────────────────────────────────────────────────────
// Everything the record holds about a person, and what this browser holds.
export function myData(id = ctx.ident?.id) {
  const r = ctx.r, mentions = (x) => JSON.stringify(x).includes(`"${id}"`);
  return {
    generated: new Date().toISOString(), entity: r.state.entity.id, id,
    participant: r.state.participants[id] || null, preferredName: nameOf(id),
    signedByYou: r.records.filter(x => x.author === id),
    mentioningYou: r.records.filter(x => x.author !== id && mentions(x.payload)),
    thisBrowser: { preferences: readPrefs(), keyKept: !!ctx.ident, keyLocked: !!ctx.ident?.locked },
    notes: 'Your email address for two-factor sign-in, if you gave one, is held by this site’s server and is not part of the public record; ask the privacy contact for it.',
  };
}
export function downloadMyData() {
  const blob = new Blob([JSON.stringify(myData(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `my-data-${ctx.ident.id}.json` }); document.body.append(a); a.click(); a.remove();
}
export async function clearThisBrowser() {
  for (const x of ctx.all.length ? ctx.all : [{ r: ctx.r }]) if (x.r?.ok) await withTimeout(K.forgetIdentity(x.r.state.entity.id), 4000).catch(() => {});
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('site:') || k.startsWith('vdr:') || k.startsWith('entity:')) localStorage.removeItem(k); } catch { /* none */ }
  try { await fetch('auth/signout', { method: 'POST', credentials: 'same-origin' }); } catch { /* not signed in there */ }
  ctx.ident = null; applyPrefs({}); drawWho(); fire(); signed();
}
