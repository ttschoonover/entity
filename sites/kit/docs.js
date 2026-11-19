// docs.js · the Documents page: documents of your own, shared by role, and the
// entity's, changed by decision. Text is sealed and opened only in this
// browser; the node keeps files it cannot read, and this page checks every
// file it is given against the record before showing it.
//
//   #/                      the library
//   #/d/DOC                 a document: the text, comments, drafts and votes
//   #/d/DOC/edit            write (your own: the latest; the entity's: a new draft)
//   #/d/DOC/edit/VERSION    write from that version
//   #/d/DOC/v/VERSION       one version, with what it changed
//   #/d/DOC/history         every version
//   #/d/DOC/share           who may do what (owners)
import { start, onSigned, onChange, ctx, h, $, me, displayName, nameOf, W, enabled, signInDialog, toast, E, sign, propose, day, when, setting } from './common.js';
import { unlockSeed } from './interface/js/lock.js';

const main = $('#main');
await start();
if (!enabled('docs')) { paint(h('h1', {}, 'Documents'), h('p', { class: 'empty' }, `Documents are not switched on here. ${W().body[0].toUpperCase()}${W().body.slice(1)} can install the docs module by decision.`)); throw new Error('docs is not enabled'); }
const D = await import(new URL('modules/docs/index.js', ctx.r.base).href);
const C = await import(new URL('modules/docs/crypto.js', ctx.r.base).href);
document.title = `Documents · ${ctx.r.params.value('entity.name')}`;

const S = { seed: null, x: null, reg: null, files: new Map(), keys: new Map(), plain: new Map(), dirty: false, editing: null };
const now = () => new Date().toISOString();
const st = () => ctx.r.state;
const entityId = () => st().entity.id;
const meId = () => (me()?.status === 'active' ? ctx.ident.id : null);
const roleNow = (doc) => D.roleOf(st(), doc, ctx.ident?.id || null, st().head.at > now() ? st().head.at : now());
const short = (id) => String(id || '').slice(0, 8);
const docLink = (doc, rest = '') => `#/d/${doc}${rest}`;
const paint = (...k) => main.replaceChildren(...k.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false && x !== ''));
const spin = (t = 'Loading…') => paint(h('p', { class: 'empty' }, t));

// ── your key: to sign files, and to open what is sealed for you ──────────
async function seed(ask = true) {
  const id = ctx.ident;
  if (!id || !meId()) return null;
  if (S.seed) return S.seed;
  if (id.seed) return (S.seed = id.seed);
  if (id.passkey) { if (ask) toast('Documents need a password or a key kept in this browser; a passkey cannot sign them yet.', true); return null; }
  if (!id.locked || !ask) return null;
  const pw = await askPassword(); if (!pw) return null;
  try { return (S.seed = await unlockSeed(id.locked, pw)); } catch { toast('Wrong password.', true); return null; }
}
function askPassword() {
  return new Promise((resolve) => {
    const input = h('input', { id: 'dc-pw', type: 'password', autocomplete: 'current-password', required: true });
    const form = h('form', { method: 'dialog' }, h('h2', {}, 'Unlock your documents'),
      h('p', { class: 'fine' }, 'Your key is locked with your password. It opens encrypted documents in this browser and signs what you write. It stays unlocked until you leave the page.'),
      h('label', { for: 'dc-pw' }, 'Your password'), input,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Unlock'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(null); } }, 'Cancel')));
    const d = h('dialog', { class: 'site-dialog' }, form); document.body.append(d); d.showModal();
    d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
    setTimeout(() => input.focus(), 0);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = input.value; d.close(); resolve(v); });
  });
}
const api = async (path, opts = {}) => {
  const r = await fetch(new URL(path, ctx.r.base), { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.why || `the node answered ${r.status}`), { status: r.status });
  return b;
};
// Sign a file and send it to the node.
async function put(fields) {
  const s = await seed(true); if (!s) throw new Error('your key is needed to sign this');
  const b = { entity: entityId(), by: ctx.ident.id, at: now(), ...fields };
  b.sig = await E.keys.sign(D.material(b), { seed: s, publicKey: ctx.ident.publicKey }, D.NS);
  b.id = D.blobId(b);
  await api('docs/file', { method: 'POST', body: JSON.stringify(b) });
  if (b.doc) S.files.delete(b.doc);
  return b;
}

// Everyone's encryption keys, each checked against that person's keys on the record.
async function registry(fresh = false) {
  if (S.reg && !fresh) return S.reg;
  const out = {};
  for (const k of (await api('docs/keys')).keys || []) {
    if (D.checkBlob(st(), k) || !await D.verifyBlob(st(), k, E.keys)) continue;
    (out[k.by] ||= new Set()).add(k.xpk);
  }
  return (S.reg = out);
}
// Your encryption key, registered once (signed, so nobody can put another in its place).
let minePending = null;
async function mine(ask = true) {
  if (S.x) return S.x;
  if (minePending) return minePending;
  minePending = mineNow(ask).finally(() => { minePending = null; });
  return minePending;
}
async function mineNow(ask) {
  const s = await seed(ask); if (!s) return null;
  const x = await C.memberKey(s);
  await registry();
  if (!S.reg[ctx.ident.id]?.has(x.xpk)) { await put({ type: 'xkey', xpk: x.xpk }); await registry(true); }
  return (S.x = x);
}

// ── a document's files, every one checked here ─────────────────────────
async function files(doc, fresh = false) {
  if (S.files.has(doc) && !fresh) return S.files.get(doc);
  const got = (await api(`docs/d/${doc}`)).files || [];
  const ids = new Set(got.map(f => f.id));
  const ok = [];
  let refused = 0;
  for (const f of got) {
    if (f.doc !== doc || D.checkBlob(st(), f, { have: (x) => ids.has(x) }) || !await D.verifyBlob(st(), f, E.keys)) { refused++; continue; }
    ok.push(f);
  }
  const r = { versions: ok.filter(f => f.type === 'version'), comments: ok.filter(f => f.type === 'comment'), keys: ok.filter(f => f.type === 'keys'), refused };
  S.files.set(doc, r);
  return r;
}
const epochNow = (F) => F.keys.reduce((a, k) => Math.max(a, k.epoch), 0);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// The keys of an epoch wrapped for you: usually one, but two people may start
// an epoch at the same moment, each with a key of their own. Each comes with
// whose encryption keys it has been wrapped for. The first, by file id, is
// the one everybody writes with; every one of them opens what it sealed.
async function epochKeys(doc, F, epoch) {
  const x = await mine(false); if (!x) return [];
  const groups = [];
  for (const f of F.keys.filter(f => f.epoch === epoch).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const w = f.wraps[x.xpk]; if (!w || w.to !== ctx.ident.id) continue;
    let key = S.keys.get(f.id);
    if (!key) { try { key = await C.unwrapKey({ me: x, wrap: w, entity: entityId(), doc, epoch }); S.keys.set(f.id, key); } catch { continue; } }
    let g = groups.find(g => same(g.key, key));
    if (!g) groups.push(g = { key, to: new Set() });
    for (const k of Object.keys(f.wraps)) g.to.add(k);
  }
  return groups;
}
const keyOf = async (doc, F, epoch) => (await epochKeys(doc, F, epoch))[0]?.key || null;
// Keep the key current: wrap it for readers who lack it, and start a new epoch
// when someone has lost access. Anyone who can read does this when they open it.
const tending = new Map();
function tendKeys(doc) {
  // One at a time per document, so two redraws do not wrap the same key twice.
  const next = (tending.get(doc) || Promise.resolve()).then(() => tend(doc)).finally(() => { if (tending.get(doc) === next) tending.delete(doc); });
  tending.set(doc, next);
  return next;
}
async function tend(doc) {
  let F = await files(doc, true);
  const d = D.docOf(st(), doc);
  if (!D.isEncrypted(d) || !roleNow(doc) || !meId()) return F;
  const x = await mine(false); if (!x) return F;
  const reg = await registry(true), at = now();
  const readers = new Set(D.readers(st(), doc, at));
  let epoch = epochNow(F);
  const stale = F.keys.filter(f => f.epoch === epoch).some(f => Object.values(f.wraps).some(w => !readers.has(w.to)));
  let groups = epoch ? await epochKeys(doc, F, epoch) : [];
  if (epoch && !groups.length && !stale) return F; // nobody has given you the key yet
  if (!epoch || stale) { epoch += 1; groups = [{ key: C.docKey(), to: new Set() }]; }
  let sent = false;
  for (const g of groups) {
    const wraps = {};
    for (const r of readers) for (const xpk of reg[r] || []) if (!g.to.has(xpk) && !(xpk === x.xpk && g.to.size)) wraps[xpk] = { to: r, ...await C.wrapKey({ me: x, toXpk: xpk, key: g.key, entity: entityId(), doc, epoch }) };
    if (!Object.keys(wraps).length) continue;
    // Every keys file carries its author's own wrap too, so they can tell which key it holds.
    if (!wraps[x.xpk]) wraps[x.xpk] = { to: ctx.ident.id, ...await C.wrapKey({ me: x, toXpk: x.xpk, key: g.key, entity: entityId(), doc, epoch }) };
    const f = await put({ type: 'keys', doc, epoch, wraps });
    S.keys.set(f.id, g.key); sent = true;
  }
  return sent ? files(doc, true) : F;
}
// Who can read it but cannot be given the key yet: they have never opened Documents.
async function waiting(doc) {
  const reg = await registry();
  return D.readers(st(), doc, now()).filter(r => !reg[r]?.size);
}
// A file's text, opened here.
async function open(doc, F, f) {
  if (S.plain.has(f.id)) return S.plain.get(f.id);
  let v;
  if (!f.enc) v = f.type === 'version' ? { title: f.title, body: f.body } : { quote: f.quote, text: f.text };
  else {
    for (const g of await epochKeys(doc, F, f.enc.epoch)) {
      try { v = await C.unseal({ key: g.key, sealed: f.enc, context: D.sealContext(f) }); break; } catch { /* another key of the epoch */ }
    }
    if (!v) return null;
  }
  S.plain.set(f.id, v);
  return v;
}
// Seal (or not) and send a version or a comment.
async function write(doc, type, fields, value) {
  const d = D.docOf(st(), doc);
  if (!D.isEncrypted(d)) return put({ type, doc, ...fields, ...value });
  let F = await tendKeys(doc);
  const epoch = epochNow(F), key = epoch && await keyOf(doc, F, epoch);
  if (!key) throw new Error('you do not have this document\'s key yet: someone who has it must open the document first');
  const draft = { entity: entityId(), type, doc, by: ctx.ident.id, at: now(), ...fields };
  const enc = await C.seal({ key, epoch, value, context: D.sealContext(draft) });
  const s = await seed(true);
  const b = { ...draft, enc };
  b.sig = await E.keys.sign(D.material(b), { seed: s, publicKey: ctx.ident.publicKey }, D.NS);
  b.id = D.blobId(b);
  await api('docs/file', { method: 'POST', body: JSON.stringify(b) });
  S.files.delete(doc);
  return b;
}

// ── Markdown, a small and safe part of it: everything is escaped first ───
const escH = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function inlineMd(t) {
  return escH(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
}
export function markdown(src) {
  const out = []; let para = [], list = null, quote = [], code = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inlineMd(para.join(' '))}</p>`); para = [];
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inlineMd(i)}</li>`).join('')}</${list.tag}>`); list = null;
    if (quote.length) out.push(`<blockquote><p>${inlineMd(quote.join(' '))}</p></blockquote>`); quote = [];
  };
  for (const raw of String(src).split('\n')) {
    if (code) { if (/^```/.test(raw.trim())) { out.push(`<pre><code>${escH(code.join('\n'))}</code></pre>`); code = null; } else code.push(raw); continue; }
    const l = raw.trim();
    if (/^```/.test(l)) { flush(); code = []; continue; }
    if (!l) { flush(); continue; }
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { flush(); out.push(`<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(l)) { flush(); out.push('<hr>'); continue; }
    if ((m = l.match(/^>\s?(.*)/))) { if (para.length || list) { const q = quote; quote = []; flush(); quote = q; } quote.push(m[1]); continue; }
    const n = l.match(/^\d+[.)]\s+(.*)/), u = l.match(/^[-*+]\s+(.*)/);
    if (n || u) { const tag = n ? 'ol' : 'ul'; if (para.length || quote.length || (list && list.tag !== tag)) flush(); list ||= { tag, items: [] }; list.items.push((n || u)[1]); continue; }
    if (list || quote.length) flush();
    para.push(l);
  }
  if (code) out.push(`<pre><code>${escH(code.join('\n'))}</code></pre>`);
  flush();
  return out.join('');
}

// ── who: members, offices and committees, in words ─────────────────────
const specName = (spec) => spec === 'members' ? `every ${W().one}` : spec === 'public' ? 'anyone' : spec.startsWith('office:') ? (st().m.offices?.[spec.slice(7)]?.title || spec.slice(7)) : spec.startsWith('committee:') ? (st().m.committees?.[spec.slice(10)]?.title || spec.slice(10)) : nameOf(spec);
function specOptions({ members = true, people = false, pub = false } = {}) {
  const o = [];
  if (pub) o.push(['public', 'Anyone']);
  if (members) o.push(['members', `Every ${W().one}`]);
  for (const x of Object.values(st().m.offices || {}).filter(x => !x.abolished)) o.push([`office:${x.id}`, `Office: ${x.title}`]);
  for (const x of Object.values(st().m.committees || {}).filter(x => !x.dissolved)) o.push([`committee:${x.id}`, `Committee: ${x.title}`]);
  if (people) for (const p of Object.values(st().participants).filter(p => p.status === 'active' && p.id !== ctx.ident?.id)) o.push([p.id, displayName(p.id)]);
  return o;
}
const select = (id, opts, value) => h('select', { id }, opts.map(([v, l]) => h('option', { value: v, ...(v === value ? { selected: true } : {}) }, l)));
const badge = (t, cls = '') => h('span', { class: `doc-badge ${cls}` }, t);
const lockBadge = (d) => (D.isEncrypted(d) ? badge(`Encrypted for ${D.readers(st(), d.id, now()).length}`, 'locked') : badge(d.mode === 'personal' && !d.public ? 'Shared' : 'Public', 'open'));

// ── the library ───────────────────────────────────────────────────────
async function library() {
  const at = now(), id = ctx.ident?.id || null;
  if (meId()) mine(false).catch(() => {}); // so documents can be shared with you before you open one
  const all = D.allDocs(st()).filter(d => D.roleOf(st(), d.id, id, at));
  const ent = all.filter(d => d.mode === 'governed' && !d.retired);
  const mineOwn = all.filter(d => d.mode === 'personal' && d.owner === id && !d.archived);
  const shared = all.filter(d => d.mode === 'personal' && d.owner !== id && !d.public && !d.archived);
  const pub = all.filter(d => d.mode === 'personal' && d.public && d.owner !== id && !d.archived);
  const archived = all.filter(d => d.mode === 'personal' && d.archived && d.owner === id);
  const row = (d) => {
    const t = h('a', { href: docLink(d.id), class: 'doc-title' }, d.title || 'Untitled');
    const li = h('li', { class: 'doc-row' }, t,
      h('span', { class: 'meta' }, d.mode === 'governed' ? `${D.inForce(d) ? `in force since ${day((d.adopted || []).at(-1).at)}` : 'no version in force yet'} · drafted by ${specName(d.draft)}`
        : `${d.owner === id ? 'yours' : `${nameOf(d.owner)}’s`} · ${D.roleOf(st(), d.id, id, at)} · ${day(d.created)}`), lockBadge(d));
    if (d.mode === 'personal') titleOf(d.id).then(x => { t.textContent = x || 'Untitled'; }).catch(() => {});
    return li;
  };
  const section = (title, list, empty) => h('section', { class: 'doc-shelf' }, h('h2', {}, title), list.length ? h('ul', { class: 'doc-list' }, list.map(row)) : h('p', { class: 'hint' }, empty));
  const canOwn = !!meId() && setting('docs.personal', true);
  paint(
    h('div', { class: 'page-head' }, h('h1', {}, 'Documents'),
      h('p', { class: 'lede' }, `Written together. Your own documents are shared with whom you choose; ${W().body}’s change only by decision. Unless a document is public, its text is encrypted in your browser, and only the people it is shared with can open it.`),
      canOwn ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => create(false) }, 'New document'),
        setting('docs.public_allowed', true) ? h('button', { class: 'secondary', onclick: () => create(true) }, 'New public document') : null) : null,
      !ctx.ident ? h('p', { class: 'fine' }, h('button', { class: 'linklike', onclick: () => signInDialog() }, 'Sign in'), ' to see documents shared with you.') : null),
    section(`${W().body[0].toUpperCase()}${W().body.slice(1)}’s documents`, ent, `None yet. Any ${W().one} can propose one below.`),
    id ? section('Yours', mineOwn, 'Nothing yet. Start one: only you can read it until you share it.') : null,
    id ? section('Shared with you', shared, 'Nothing has been shared with you yet.') : null,
    pub.length ? section('Public', pub, '') : null,
    archived.length ? h('details', {}, h('summary', {}, `Archived (${archived.length})`), h('ul', { class: 'doc-list' }, archived.map(row))) : null,
    meId() ? proposeDocForm() : null);
}
async function titleOf(doc) {
  const F = await files(doc); const v = D.latestHead(F.versions);
  return v ? (await open(doc, F, v))?.title || (v.enc ? 'Encrypted' : 'Untitled') : 'Untitled';
}
async function create(isPublic) {
  if (!isPublic && !await mine(true)) return;
  const res = await sign('doc.create', isPublic ? { public: true } : {}, isPublic ? 'A new public document' : 'A new encrypted document, readable only by you until you share it');
  if (!res) return;
  location.hash = docLink(D.docId(res[0].act), '/edit');
}
function proposeDocForm() {
  const f = h('div', { class: 'inline-form' },
    h('label', { for: 'nd-title' }, 'Title'), h('input', { id: 'nd-title', placeholder: 'Bylaws' }),
    h('label', { for: 'nd-id' }, 'Short name, for links'), h('input', { id: 'nd-id', placeholder: 'bylaws' }),
    h('label', { for: 'nd-read' }, 'Who reads it'), select('nd-read', specOptions({ pub: true }), 'members'),
    h('label', { for: 'nd-comment' }, 'Who comments'), select('nd-comment', specOptions(), 'members'),
    h('label', { for: 'nd-draft' }, 'Who writes drafts'), select('nd-draft', specOptions(), 'members'),
    h('label', { for: 'nd-rule' }, 'What a change needs'), select('nd-rule', [['', `the usual (${setting('docs.adopt_rule', 'ordinary')})`], ['ordinary', 'ordinary'], ['organic', 'organic'], ['constitutional', 'constitutional']], ''),
    h('p', { class: 'fine' }, 'Read by anyone: public, not encrypted. Otherwise encrypted for the readers you name. The title is on the public record either way.'),
    h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => {
      const title = $('#nd-title').value.trim(), doc = ($('#nd-id').value.trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 40);
      if (!title) return toast('Give it a title.', true);
      const e = { kind: 'docs.create', doc, title, read: $('#nd-read').value, comment: $('#nd-comment').value, draft: $('#nd-draft').value };
      if ($('#nd-rule').value) e.rule = $('#nd-rule').value;
      propose(`Keep the document “${title}”`, [e]);
    } }, 'Propose it')));
  return h('details', { class: 'doc-propose' }, h('summary', {}, `Propose a document for ${W().body}`), f);
}

// ── one document ──────────────────────────────────────────────────────
async function docView(doc, mode, arg) {
  const d = D.docOf(st(), doc);
  if (!d) return paint(h('h1', {}, 'Not found'), h('p', {}, `There is no document ${doc}. `, h('a', { href: '#/' }, 'Every document')));
  const role = roleNow(doc);
  if (!role) return paint(h('h1', {}, 'Not shared with you'), h('p', {}, ctx.ident ? 'This document is not shared with you.' : 'Sign in to open documents shared with you.'), !ctx.ident ? h('button', { class: 'primary', onclick: () => signInDialog() }, 'Sign in') : null);
  if (D.isEncrypted(d) && !ctx.ident?.seed && !S.seed && ctx.ident?.locked) {
    return paint(head(d, role, null), h('p', { class: 'empty' }, 'This document is encrypted. ', h('button', { class: 'primary', onclick: async () => { if (await seed(true)) route(); } }, 'Unlock to read it')));
  }
  spin(D.isEncrypted(d) ? 'Opening it in this browser…' : 'Loading…');
  let F = await files(doc, true);
  if (D.isEncrypted(d) && meId()) { try { F = await tendKeys(doc); } catch (e) { toast(e.message, true); } }
  if (mode === 'edit') return editor(d, F, role, arg);
  if (mode === 'share') return share(d, F, role);
  if (mode === 'history') return history(d, F, role);
  if (mode === 'v') return versionView(d, F, role, arg);
  return reader(d, F, role);
}
function head(d, role, title) {
  return h('div', { class: 'doc-head' },
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, 'Documents'), d.mode === 'governed' ? ` · ${W().body}’s` : d.owner === ctx.ident?.id ? ' · yours' : ` · ${nameOf(d.owner)}’s`),
    h('h1', {}, title ?? d.title ?? 'Untitled'),
    h('p', { class: 'doc-meta' }, lockBadge(d), badge(role === 'editor' && d.mode === 'governed' ? 'you can draft' : `you are ${role === 'owner' || role === 'editor' ? 'an' : 'a'} ${role}`), d.archived ? badge('archived') : null, d.retired ? badge('retired') : null));
}
const tools = (d, role) => h('p', { class: 'doc-tools' },
  D.atLeast(role, 'editor') && meId() ? h('a', { class: 'button primary', href: docLink(d.id, '/edit') }, d.mode === 'governed' ? 'Write a draft' : 'Edit') : null,
  h('a', { class: 'button secondary', href: docLink(d.id, '/history') }, 'History'),
  role === 'owner' ? h('a', { class: 'button secondary', href: docLink(d.id, '/share') }, 'Share') : null,
  role === 'owner' ? h('button', { class: 'secondary', onclick: () => sign('doc.archive', { doc: d.id, archived: !d.archived }, d.archived ? 'Bring this document back' : 'Archive this document') }, d.archived ? 'Bring back' : 'Archive') : null,
  d.mode === 'personal' && role !== 'owner' && (d.shares[ctx.ident?.id] || []).some(s => !s.until) ? h('button', { class: 'linklike', onclick: () => sign('doc.leave', { doc: d.id }, 'Leave this document') }, 'Leave it') : null);

const unreadable = () => h('p', { class: 'empty' }, 'You cannot open this yet: nobody holding the key has opened the document since it was shared with you. It opens once they do.');
async function reader(d, F, role) {
  const shownId = d.mode === 'governed' ? D.inForce(d) : D.latestHead(F.versions)?.id;
  const shown = F.versions.find(v => v.id === shownId) || null;
  const text = shown ? await open(d.id, F, shown) : null;
  const heads = D.heads(F.versions);
  const body = h('article', { class: 'doc-page prose' });
  if (!shown) body.append(h('p', { class: 'empty' }, d.mode === 'governed' ? ((d.adopted || []).length ? 'The version in force has not reached this site yet.' : 'No version is in force yet. Drafts are below.') : 'Nothing written yet.'));
  else if (!text) body.append(unreadable());
  else { body.innerHTML = markdown(text.body || ''); }
  const by = shown ? h('p', { class: 'fine' }, d.mode === 'governed' ? `Version ${short(shown.id)}, in force since ${day((d.adopted || []).at(-1).at)}.` : `Last saved by ${nameOf(shown.by)}, ${when(shown.at)}.`,
    d.mode === 'personal' && heads.length > 1 ? ` ${heads.length} people saved at once; the next save merges their versions.` : '') : null;
  paint(head(d, role, text?.title || (d.mode === 'personal' ? (shown ? (text ? 'Untitled' : 'Encrypted') : 'Untitled') : null)), tools(d, role),
    h('div', { class: 'doc-layout' },
      h('div', { class: 'doc-main' }, body, by, d.mode === 'governed' ? await drafts(d, F, role) : null),
      h('aside', { class: 'doc-side', 'aria-label': 'Comments' }, await comments(d, F, role, shown))),
    F.refused ? h('p', { class: 'fine' }, `${F.refused} file${F.refused === 1 ? '' : 's'} from the node did not check out against the record and ${F.refused === 1 ? 'is' : 'are'} not shown.`) : null);
  const sel = () => { const s = String(getSelection() || '').trim(); const q = $('#dc-quote'); if (q && s && body.contains(getSelection().anchorNode)) q.value = s.slice(0, D.LIMITS.quote); };
  body.addEventListener('mouseup', sel); body.addEventListener('keyup', sel);
}

// Comments: on the version shown, with replies; resolved ones fold away.
async function comments(d, F, role, shown) {
  const box = h('div', { class: 'doc-comments' }, h('h2', {}, 'Comments'));
  const list = [];
  for (const c of F.comments) list.push({ c, v: await open(d.id, F, c) });
  const resolved = new Set(list.filter(x => x.c.resolves).map(x => x.c.resolves));
  const top = list.filter(x => !x.c.reply && !x.c.resolves);
  const kids = (id) => list.filter(x => x.c.reply === id);
  const item = (x, nested) => h('li', { class: `doc-comment${resolved.has(x.c.id) ? ' resolved' : ''}` },
    x.v?.quote && !nested ? h('blockquote', {}, x.v.quote) : null,
    h('p', {}, x.v ? x.v.text : h('em', {}, 'Sealed with a key you do not have yet.')),
    h('p', { class: 'meta' }, `${nameOf(x.c.by)} · ${when(x.c.at)}${shown && x.c.version !== shown.id ? ` · on version ${short(x.c.version)}` : ''}`),
    !nested ? h('ul', {}, kids(x.c.id).map(k => item(k, true))) : null,
    !nested && D.atLeast(role, 'commenter') && meId() ? h('p', { class: 'doc-comment-acts' },
      h('button', { class: 'linklike', onclick: () => reply(d, x.c) }, 'Reply'),
      !resolved.has(x.c.id) ? [' · ', h('button', { class: 'linklike', onclick: () => send(d, { version: x.c.version, resolves: x.c.id }, { text: 'Resolved.' }) }, 'Resolve')] : null) : null);
  const open_ = top.filter(x => !resolved.has(x.c.id)), done = top.filter(x => resolved.has(x.c.id));
  box.append(open_.length ? h('ul', { class: 'doc-comment-list' }, open_.map(x => item(x))) : h('p', { class: 'hint' }, 'No open comments.'));
  if (done.length) box.append(h('details', {}, h('summary', {}, `Resolved (${done.length})`), h('ul', { class: 'doc-comment-list' }, done.map(x => item(x)))));
  if (D.atLeast(role, 'commenter') && meId() && shown) {
    box.append(h('form', { class: 'doc-comment-form', onsubmit: (ev) => { ev.preventDefault(); const t = $('#dc-text').value.trim(); if (!t) return; send(d, { version: shown.id }, { text: t, quote: $('#dc-quote').value.trim() || undefined }); } },
      h('label', { for: 'dc-quote' }, 'On the passage (select text to fill this)'), h('input', { id: 'dc-quote', maxlength: D.LIMITS.quote }),
      h('label', { for: 'dc-text' }, 'Your comment'), h('textarea', { id: 'dc-text', rows: 3, maxlength: D.LIMITS.comment, required: true }),
      h('button', { class: 'secondary', type: 'submit' }, 'Comment')));
  }
  return box;
}
async function send(d, fields, value) {
  try { const v = Object.fromEntries(Object.entries(value).filter(([, x]) => x !== undefined)); await write(d.id, 'comment', fields, v); toast('Comment added.'); route(); }
  catch (e) { toast(e.message, true); }
}
function reply(d, c) {
  const t = prompt('Your reply'); if (!t?.trim()) return;
  send(d, { version: c.version, reply: c.id }, { text: t.trim().slice(0, D.LIMITS.comment) });
}

// The entity's document: drafts, and the votes on them.
async function drafts(d, F, role) {
  const box = h('section', { class: 'doc-drafts' }, h('h2', {}, 'Drafts and votes'));
  const r = ctx.r, force = D.inForce(d);
  const adopted = new Set((d.adopted || []).map(a => a.version));
  const votes = r.get('proposals').filter(b => (st().proposals[b.id]?.effects || []).some(e => e.kind === 'docs.adopt' && e.doc === d.id));
  for (const b of votes) {
    const e = st().proposals[b.id].effects.find(e => e.kind === 'docs.adopt' && e.doc === d.id);
    const total = b.for + b.against + b.abstain || 1;
    box.append(h('article', { class: 'bill-card doc-vote' },
      h('h3', {}, b.title), h('p', { class: 'when' }, `Closes ${day(b.closes)} · adopts version ${short(e.version)} · `, h('a', { href: docLink(d.id, `/v/${e.version}`) }, 'see what it changes')),
      h('div', { class: 'tally', 'aria-hidden': 'true' }, h('span', { class: 'aye', style: `width:${100 * b.for / total}%` }), h('span', { class: 'no', style: `width:${100 * b.against / total}%` })),
      h('p', { class: 'fine' }, `${b.for} for · ${b.against} against${b.abstain ? ` · ${b.abstain} abstaining` : ''}`),
      me()?.status === 'active' && (st().proposals[b.id].roll || []).includes(ctx.ident.id) ? h('div', { class: 'row' },
        h('button', { class: 'secondary', onclick: () => sign('ballot.cast', { proposal: b.id, choice: 'for' }, `Your vote for "${b.title}"`) }, 'For'),
        h('button', { class: 'secondary', onclick: () => sign('ballot.cast', { proposal: b.id, choice: 'against' }, `Your vote against "${b.title}"`) }, 'Against')) : null));
  }
  const proposed = new Set(votes.map(b => st().proposals[b.id].effects.find(e => e.kind === 'docs.adopt' && e.doc === d.id).version));
  const list = D.heads(F.versions).filter(v => !adopted.has(v.id)).reverse();
  if (!list.length && !votes.length) box.append(h('p', { class: 'hint' }, D.atLeast(role, 'editor') ? 'No drafts. Write one: it changes nothing until it is adopted.' : 'No drafts.'));
  if (list.length) box.append(h('ul', { class: 'doc-list' }, await Promise.all(list.map(async v => {
    const t = await open(d.id, F, v);
    const base = baseOf(d, F, v);
    return h('li', { class: 'doc-row' }, h('a', { class: 'doc-title', href: docLink(d.id, `/v/${v.id}`) }, t?.title || `Draft ${short(v.id)}`),
      h('span', { class: 'meta' }, `${nameOf(v.by)} · ${when(v.at)}${v.note ? ` · ${v.note}` : ''}${base !== force ? ' · written before the latest change' : ''}${proposed.has(v.id) ? ' · put to a vote' : ''}`));
  }))));
  return box;
}
// The version in force a draft was written from (the nearest adopted ancestor).
function baseOf(d, F, v) {
  const adopted = new Set((d.adopted || []).map(a => a.version));
  return D.lineage(F.versions, v.id).find(x => adopted.has(x.id))?.id || null;
}

// One version, with what it changed.
async function versionView(d, F, role, id) {
  const v = F.versions.find(x => x.id === id);
  if (!v) return paint(head(d, role), h('p', { class: 'empty' }, 'That version is not here.'), h('a', { href: docLink(d.id) }, 'Back'));
  const t = await open(d.id, F, v);
  const against = d.mode === 'governed' ? D.inForce(d) : v.parent;
  const prev = against && against !== v.id ? F.versions.find(x => x.id === against) : null;
  const pt = prev ? await open(d.id, F, prev) : { title: '', body: '' };
  const force = D.inForce(d), base = d.mode === 'governed' ? baseOf(d, F, v) : null;
  const canPropose = d.mode === 'governed' && meId() && !(d.adopted || []).some(a => a.version === v.id);
  const acts = h('p', { class: 'doc-tools' },
    canPropose && base === force ? h('button', { class: 'primary', onclick: () => propose(`Adopt “${t?.title || d.title}”: ${v.note || `the draft by ${nameOf(v.by)}`}`, [{ kind: 'docs.adopt', doc: d.id, version: v.id, base: force }]) }, 'Propose adopting this draft') : null,
    canPropose && base !== force && D.atLeast(role, 'editor') ? h('button', { class: 'primary', onclick: () => catchUp(d, F, v) }, 'Bring it up to date') : null,
    D.atLeast(role, 'editor') && meId() ? h('a', { class: 'button secondary', href: docLink(d.id, `/edit/${v.id}`) }, 'Write from this version') : null,
    h('a', { class: 'button secondary', href: docLink(d.id) }, 'Back'));
  paint(head(d, role, t?.title),
    h('p', { class: 'fine' }, `Version ${short(v.id)} by ${nameOf(v.by)}, ${when(v.at)}${v.note ? `: ${v.note}` : ''}.${(d.adopted || []).some(a => a.version === v.id) ? ' Adopted.' : d.mode === 'governed' ? ' A draft: it changes nothing until adopted.' : ''}`),
    canPropose && base !== force ? h('p', { class: 'fine' }, 'The document changed after this draft was written. Bring it up to date first: its changes are merged into the version in force.') : null,
    acts,
    !t ? unreadable() : redline(pt, t, prev ? (d.mode === 'governed' ? 'Compared with the version in force' : 'Compared with the version before') : 'The first version'));
}
function redline(a, b, caption) {
  const rows = D.diffLines(a.body || '', b.body || '');
  return h('figure', { class: 'doc-diff' }, h('figcaption', { class: 'fine' }, caption, a.title !== b.title && a.title ? ` · title: “${a.title}” → “${b.title}”` : ''),
    h('pre', {}, rows.map(([op, l]) => h('span', { class: op === '+' ? 'add' : op === '-' ? 'del' : 'same' }, `${op === ' ' ? ' ' : op} ${l}\n`))));
}
async function catchUp(d, F, v) {
  const base = F.versions.find(x => x.id === baseOf(d, F, v)), force = F.versions.find(x => x.id === D.inForce(d));
  const [b, o, t] = await Promise.all([base ? open(d.id, F, base) : { body: '' }, open(d.id, F, v), open(d.id, F, force)]);
  if (!o || !t) return toast('You cannot open every version needed to merge.', true);
  const m = D.merge3(b?.body || '', o.body, t.body, { ourName: 'this draft', theirName: 'in force' });
  S.editing = { doc: d.id, parent: force.id, title: o.title, body: m.text, note: v.note || '', conflicts: m.conflicts, from: v.id };
  location.hash = docLink(d.id, `/edit/${force.id}`);
}

// Every version.
async function history(d, F, role) {
  const adopted = new Map((d.adopted || []).map(a => [a.version, a]));
  const items = await Promise.all([...F.versions].reverse().map(async v => {
    const t = await open(d.id, F, v);
    return h('li', { class: 'doc-row' }, h('a', { class: 'doc-title', href: docLink(d.id, `/v/${v.id}`) }, t?.title || short(v.id)),
      h('span', { class: 'meta' }, `${nameOf(v.by)} · ${when(v.at)}${v.note ? ` · ${v.note}` : ''}`), adopted.has(v.id) ? badge(`adopted ${day(adopted.get(v.id).at)}`, 'open') : null);
  }));
  paint(head(d, role), h('h2', {}, 'History'), h('p', { class: 'fine' }, 'Every version stays, signed by who wrote it.'),
    items.length ? h('ul', { class: 'doc-list' }, items) : h('p', { class: 'hint' }, 'Nothing written yet.'), h('p', {}, h('a', { href: docLink(d.id) }, 'Back')));
}

// ── writing ───────────────────────────────────────────────────────────
async function editor(d, F, role, from) {
  if (!D.atLeast(role, 'editor') || !meId()) return paint(head(d, role), h('p', { class: 'empty' }, 'You may read this document, not write in it.'));
  if (!await seed(true)) return route('#/d/' + d.id);
  let parent, start = { title: d.mode === 'governed' ? d.title : '', body: '', note: '' }, conflicts = 0;
  const kept = S.editing?.doc === d.id && (!from || from === S.editing.parent) ? S.editing : null;
  if (kept) { parent = kept.parent; start = kept; conflicts = kept.conflicts || 0; }
  else {
    parent = from || (d.mode === 'governed' ? D.inForce(d) : D.latestHead(F.versions)?.id) || null;
    const heads = D.heads(F.versions);
    if (!from && d.mode === 'personal' && heads.length > 1) {
      // Two people saved at once: merge their versions before going on.
      const [x, y] = heads.slice(-2), anc = common(F, x.id, y.id);
      const [a, b, o] = await Promise.all([open(d.id, F, x), open(d.id, F, y), anc ? open(d.id, F, anc) : { body: '' }]);
      if (a && b) { const m = D.merge3(o?.body || '', b.body, a.body, { ourName: nameOf(y.by), theirName: nameOf(x.by) }); start = { title: b.title, body: m.text, note: 'Merged' }; conflicts = m.conflicts; parent = y.id; }
    } else if (parent) {
      const v = F.versions.find(x => x.id === parent), t = v && await open(d.id, F, v);
      if (v && !t) return paint(head(d, role), unreadable());
      if (t) start = { title: t.title, body: t.body, note: '' };
    }
  }
  S.editing = { doc: d.id, parent, title: start.title, body: start.body, note: start.note || '' };
  const ti = h('input', { id: 'ed-title', class: 'doc-edit-title', value: start.title || '', maxlength: D.LIMITS.title, placeholder: 'Title', 'aria-label': 'Title' });
  const ta = h('textarea', { id: 'ed-body', class: 'doc-edit-body', maxlength: D.LIMITS.body, spellcheck: 'true', 'aria-label': 'Text, in Markdown' }, start.body || '');
  const note = h('input', { id: 'ed-note', maxlength: D.LIMITS.note, value: start.note || '', placeholder: d.mode === 'governed' ? 'What this draft changes' : 'What you changed (optional)' });
  const pv = h('article', { class: 'doc-page prose doc-preview', hidden: true });
  const status = h('p', { class: 'status', role: 'status' }, conflicts ? `${conflicts} passage${conflicts === 1 ? '' : 's'} changed on both sides: they are marked <<<<<<< and >>>>>>>. Keep what should stay, delete the markers, and save.` : '');
  const remember = () => { S.editing.title = ti.value; S.editing.body = ta.value; S.editing.note = note.value; S.dirty = true; };
  ti.addEventListener('input', remember); ta.addEventListener('input', remember); note.addEventListener('input', remember);
  const toggle = h('button', { type: 'button', class: 'secondary', onclick: () => { pv.hidden = !pv.hidden; ta.hidden = !pv.hidden; if (!pv.hidden) pv.innerHTML = markdown(ta.value); toggle.textContent = pv.hidden ? 'Preview' : 'Write'; } }, 'Preview');
  const save = h('button', { type: 'button', class: 'primary', onclick: () => saveVersion(d, status, save) }, d.mode === 'governed' ? 'Save the draft' : 'Save');
  paint(head(d, role, d.mode === 'governed' ? `A draft of ${d.title}` : (start.title ? `Editing ${start.title}` : 'A new document')),
    d.mode === 'governed' ? h('p', { class: 'fine' }, parent ? `Starting from version ${short(parent)}. A draft changes nothing until it is adopted.` : 'The first draft. It changes nothing until it is adopted.') : null,
    h('div', { class: 'doc-editor' }, ti, h('p', { class: 'doc-edit-bar' }, toggle, h('span', { class: 'fine' }, ' Markdown: # heading, **bold**, *italic*, - list, 1. list. ', D.isEncrypted(d) ? 'Sealed in this browser before it is sent.' : 'This document is public.')), ta, pv,
      h('label', { for: 'ed-note' }, 'Note'), note, status,
      h('div', { class: 'row' }, save, h('a', { class: 'button secondary', href: docLink(d.id), onclick: () => { S.editing = null; S.dirty = false; } }, 'Close'))));
  ta.focus();
}
// The nearest version both descend from.
function common(F, a, b) {
  const seen = new Set(D.lineage(F.versions, a).map(v => v.id));
  return D.lineage(F.versions, b).find(v => seen.has(v.id)) || null;
}
async function saveVersion(d, status, btn) {
  const ed = S.editing; if (!ed) return;
  if (/^(<<<<<<< |=======$|>>>>>>> )/m.test(ed.body) && !confirm('The text still has merge markers in it. Save anyway?')) return;
  btn.disabled = true; status.textContent = 'Saving…';
  try {
    let parent = ed.parent, body = ed.body;
    if (d.mode === 'personal') {
      // Someone saved meanwhile: merge what both of you did.
      const F = await files(d.id, true), headV = D.latestHead(F.versions);
      if (headV && headV.id !== parent) {
        const [o, t] = await Promise.all([parent ? open(d.id, F, F.versions.find(v => v.id === parent)) : { body: '' }, open(d.id, F, headV)]);
        const m = D.merge3(o?.body || '', body, t?.body || '', { ourName: 'yours', theirName: nameOf(headV.by) });
        parent = headV.id; body = m.text;
        if (m.conflicts) { ed.parent = parent; ed.body = body; $('#ed-body').value = body; status.textContent = `${nameOf(headV.by)} saved while you were writing. Your changes are merged with theirs, but ${m.conflicts} passage${m.conflicts === 1 ? '' : 's'} changed on both sides: they are marked. Resolve them and save again.`; btn.disabled = false; return; }
        toast(`${nameOf(headV.by)} saved while you were writing: merged.`);
      }
    }
    const v = await write(d.id, 'version', { parent: parent || null, ...(ed.note.trim() ? { note: ed.note.trim() } : {}) }, { title: ed.title.trim() || 'Untitled', body });
    S.editing = null; S.dirty = false;
    if (d.mode === 'governed') toast('Draft saved. Propose adopting it when it is ready.');
    location.hash = d.mode === 'governed' ? docLink(d.id, `/v/${v.id}`) : docLink(d.id);
  } catch (e) { status.textContent = e.message; status.classList.add('bad'); btn.disabled = false; }
}

// ── sharing ───────────────────────────────────────────────────────────
async function share(d, F, role) {
  if (role !== 'owner') return paint(head(d, role), h('p', { class: 'empty' }, 'Only an owner shares this document.'));
  const live = Object.entries(d.shares).map(([to, l]) => [to, l.find(s => !s.until)]).filter(([, s]) => s);
  const wait = D.isEncrypted(d) ? await waiting(d.id) : [];
  paint(head(d, role), h('h2', {}, 'Share'),
    h('ul', { class: 'doc-shares' },
      h('li', {}, h('span', {}, `${displayName(d.owner)}`), h('span', { class: 'meta' }, 'owner, who made it')),
      live.map(([to, s]) => h('li', {}, h('span', {}, specName(to)), h('span', { class: 'meta' }, s.role),
        h('button', { class: 'linklike', onclick: () => sign('doc.unshare', { doc: d.id, to }, `Stop sharing with ${specName(to)}`) }, 'Remove')))),
    h('div', { class: 'inline-form' },
      h('label', { for: 'sh-to' }, 'With'), select('sh-to', specOptions({ people: true })),
      h('label', { for: 'sh-role' }, 'As'), select('sh-role', [['viewer', 'Viewer: reads'], ['commenter', 'Commenter: reads and comments'], ['editor', 'Editor: writes'], ['owner', 'Owner: writes and shares']], 'editor'),
      h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => sign('doc.share', { doc: d.id, to: $('#sh-to').value, role: $('#sh-role').value }, `Share as ${$('#sh-role').value} with ${specName($('#sh-to').value)}`) }, 'Share'))),
    D.isEncrypted(d) ? h('p', { class: 'fine' }, 'Sharing gives them the key the next time someone who has it opens the document. Removing someone changes the key from then on: they cannot read later versions, but they keep whatever they already read. Who it is shared with, and when it changes, is on the record; the text is not.') : h('p', { class: 'fine' }, 'This document is public: anyone can read it. Sharing decides who may comment and write.'),
    wait.length ? h('p', { class: 'fine' }, `Waiting for ${wait.map(nameOf).join(', ')} to open Documents once, so their key can be added.`) : null,
    h('p', {}, h('a', { href: docLink(d.id) }, 'Back to the document')));
}

// ── routing, and keeping up ───────────────────────────────────────────
let routed = '';
function route(to) {
  if (to) { location.hash = to; return; }
  const m = location.hash.match(/^#\/d\/([a-z0-9-]+)(?:\/(edit|share|history|v))?(?:\/([0-9a-f]{64}))?$/);
  routed = location.hash;
  if (!m) return library().catch(e => paint(h('p', { class: 'empty bad' }, e.message)));
  docView(m[1], m[2], m[3]).catch(e => paint(h('p', { class: 'empty bad' }, e.message)));
}
window.addEventListener('hashchange', () => { if (S.dirty && routed.includes('/edit') && !confirm('Leave without saving?')) { history.replaceState(null, '', routed); return; } S.dirty = false; if (!location.hash.includes('/edit')) S.editing = null; route(); });
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
onSigned(() => { if (!routed.includes('/edit')) route(); });
onChange(() => { if (!routed.includes('/edit')) route(); });
try {
  const es = new EventSource(new URL('docs/events', ctx.r.base));
  es.addEventListener('file', (ev) => {
    const { doc, type, by } = JSON.parse(ev.data);
    S.files.delete(doc);
    const cur = routed.match(/^#\/d\/([a-z0-9-]+)/)?.[1];
    // Someone registered a key: if this document is open, wrap its key for them.
    if (doc === '_keys') { S.reg = null; if (cur && !routed.includes('/edit') && D.isEncrypted(D.docOf(st(), cur))) route(); return; }
    if (routed.includes('/edit')) { if (doc === cur && type === 'version' && by !== ctx.ident?.id) toast(`${nameOf(by)} saved a newer version: it will be merged with yours when you save.`); return; }
    if (by === ctx.ident?.id && type === 'keys') return; // your own page keeping the key current
    if (!cur || cur === doc) route();
  });
} catch { /* no live updates: reload to see changes */ }
route();
