// The participant's page. It verifies, it does not display: the record is
// fetched and checked here, by the same code the engine runs.
//
// Every view has an address after "#", so every view has its own link and the
// page works from any folder on any static host:
//
//   #/                overview: the seal, your membership, what needs your vote
//   #/votes           every proposal;  #/votes/ID  one proposal, every ballot
//   #/members         the register;    #/members/ID  one member
//   #/record          the record;      #/record/N    one record and its act
//   #/law             charter and statutes, with the decisions that approved them
//   #/settings        every parameter, its rule, and its history
//   #/<module>/…      tabs that enabled modules contribute (their ui.js `tabs`)

import * as E from './engine.js';
import * as K from './keystore.js';
import { lockSeed, unlockSeed } from './lock.js';

const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
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
const day = (iso) => (iso ? iso.slice(0, 10) : '');
const when = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '');
const short = (x) => x.slice(0, 12) + '…';
const link = (path, ...kids) => h('a', { href: `#/${path}` }, ...kids);
const go = (path) => { location.hash = `#/${path}`; };

const island = JSON.parse($('#entity').textContent || '{}');
const ctx = { registry: null, records: [], state: null, params: null, ident: null, words: null, tabs: [], seal: null, views: {}, authority: null };

// ------------------------------------------------------------------ lists
// One way to show any list: yours first, then everyone else's on request (if
// you have any); a search box, sorting and filters once the list is long enough
// to need them; and pages past 10 large items or 20 small ones (table rows).
// What a viewer chose is kept per list while the page is open.
//
// o := { key, items, render(item) → <li> | row(item) → <tr> with head: [..],
//        text(item) → searchable string, sorts: [[label, compare]],
//        filters: [{ label, options: [[label, test]] }], mine(item) → bool,
//        noun: 'deeds', empty: 'text', size }
function listView(o) {
  const v = ctx.views[o.key] ||= { q: '', sort: 0, f: {}, others: false, page: 1 };
  const small = !!o.row;
  const size = o.size || (small ? 20 : 10);
  const results = h('div');
  const draw = () => {
    const q = v.q.trim().toLowerCase();
    let list = o.items.filter(it => !q || (o.text ? o.text(it) : '').toLowerCase().includes(q));
    for (const [i, f] of (o.filters || []).entries()) { const opt = f.options[v.f[i] || 0]; if (opt) list = list.filter(opt[1]); }
    const sort = (o.sorts || [])[v.sort];
    if (sort) list = list.slice().sort(sort[1]);
    if (o.pin) list = [...list.filter(o.pin), ...list.filter(it => !o.pin(it))];
    const mineList = o.mine ? list.filter(o.mine) : [];
    const hideOthers = o.mine && mineList.length && !v.others;
    const shown = hideOthers ? mineList : o.mine ? [...mineList, ...list.filter(it => !o.mine(it))] : list;
    const pages = Math.max(1, Math.ceil(shown.length / size));
    v.page = Math.min(v.page, pages);
    const slice = shown.slice((v.page - 1) * size, v.page * size);
    const kids = [];
    if (!shown.length) kids.push(h('p', { class: 'hint' }, q || Object.values(v.f).some(Boolean) ? 'Nothing matches.' : (o.empty || 'Nothing yet.')));
    else if (small) kids.push(h('div', { class: 'scroll' }, h('table', {}, o.head ? h('thead', {}, h('tr', {}, o.head.map(x => h('th', {}, x)))) : null, h('tbody', {}, slice.map(o.row)))));
    else kids.push(h('ul', { class: 'items' }, slice.map((it) => { const li = o.render(it); const e = o.edit && o.edit(it); if (e && li) li.append(e); return li; })));
    if (pages > 1) kids.push(h('nav', { class: 'pager', 'aria-label': 'Pages' }, Array.from({ length: pages }, (_, i) =>
      h('button', { class: i + 1 === v.page ? '' : 'quiet', 'aria-current': i + 1 === v.page ? 'page' : null, onclick: () => { v.page = i + 1; draw(); } }, String(i + 1)))));
    if (o.mine && mineList.length && list.length > mineList.length) kids.push(h('div', { class: 'buttons' },
      h('button', { class: 'quiet', onclick: () => { v.others = !v.others; v.page = 1; draw(); } },
        v.others ? `Only yours (${mineList.length})` : `Show everyone else's too (${list.length - mineList.length})`)));
    results.replaceChildren(...kids);
  };
  const controls = [];
  const n = o.items.length;
  if (o.text && n > 5) controls.push(h('input', { type: 'search', class: 'find', placeholder: `Search ${o.noun || ''}`.trim(), value: v.q, 'aria-label': `Search ${o.noun || ''}`,
    oninput: (e) => { v.q = e.target.value; v.page = 1; draw(); } }));
  if ((o.sorts || []).length > 1 && n > 3) controls.push(h('select', { 'aria-label': 'Sort', onchange: (e) => { v.sort = Number(e.target.value); draw(); } },
    o.sorts.map(([label], i) => h('option', { value: i, selected: i === v.sort }, label))));
  for (const [i, f] of (o.filters || []).entries()) {
    const useful = f.options.filter(([, t]) => o.items.some(t)).length > 1;
    if (useful && n > 3) controls.push(h('select', { 'aria-label': f.label, onchange: (e) => { v.f[i] = Number(e.target.value); v.page = 1; draw(); } },
      f.options.map(([label], j) => h('option', { value: j, selected: j === (v.f[i] || 0) }, label))));
  }
  draw();
  return h('div', { class: 'listview' }, controls.length ? h('div', { class: 'controls' }, controls) : null, results);
}
// An "Edit" panel for anything: fields [[key, label, value, kind?, options?]],
// kind text | textarea | number | bool | select | datetime | lines. Only what
// changed is passed on, to submit(changes) (usually a proposal, or a grant).
function editForm(title, fields, submit) {
  const rows = fields.map(([key, label, value, kind = 'text', opts]) => {
    const id = 'ed-' + Math.random().toString(36).slice(2, 9);
    const el = kind === 'textarea' || kind === 'lines' ? h('textarea', { id, style: 'font-family:inherit;min-height:5rem' }, kind === 'lines' ? (value || []).join('\n') : (value ?? ''))
      : kind === 'bool' ? h('input', { id, type: 'checkbox', checked: !!value, style: 'width:auto;margin-right:.5rem' })
      : kind === 'select' ? h('select', { id }, opts.map(o => h('option', { value: o, selected: String(value ?? '') === String(o) ? true : null }, o)))
      : h('input', { id, type: kind === 'number' ? 'number' : kind === 'datetime' ? 'datetime-local' : 'text', value: kind === 'datetime' && value ? new Date(value).toISOString().slice(0, 16) : (value ?? '') });
    return { key, label, value, kind, el, id };
  });
  const read = (r) => {
    if (r.kind === 'bool') return r.el.checked;
    const v = r.el.value;
    if (r.kind === 'number') return v === '' ? null : Number(v);
    if (r.kind === 'datetime') return v ? new Date(v).toISOString() : r.value;
    if (r.kind === 'lines') return v.split('\n').map(x => x.trim()).filter(Boolean);
    if (r.kind === 'select' && /^\d+$/.test(v)) return Number(v);
    return v;
  };
  return h('details', { class: 'edit' }, h('summary', {}, title || 'Edit'), h('div', { class: 'inline-form' },
    rows.map(r => r.kind === 'bool' ? h('label', { style: 'font-weight:400' }, r.el, r.label) : [h('label', { for: r.id }, r.label), r.el]),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const changes = {};
      for (const r of rows) {
        const v = read(r), old = r.kind === 'lines' ? (r.value || []) : r.kind === 'bool' ? !!r.value : r.value ?? (r.kind === 'number' ? null : '');
        if (JSON.stringify(v) !== JSON.stringify(old)) changes[r.key] = v;
      }
      if (!Object.keys(changes).length) return alert('Nothing has changed.');
      submit(changes);
    } }, 'Propose these changes'))));
}

const byText = (f) => (a, b) => String(f(a)).localeCompare(String(f(b)), undefined, { numeric: true, sensitivity: 'base' });
const newest = (f = (x) => x.at) => (a, b) => (f(a) < f(b) ? 1 : f(a) > f(b) ? -1 : 0);
const oldest = (f = (x) => x.at) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);

// ------------------------------------------------------------------ boot
async function boot() {
  applyLook();
  $('#noboot').hidden = true;
  const problem = E.environmentProblem(window);
  if (problem) return fatal('This page cannot check anything here', problem);

  $('#entity-name').textContent = island.name || 'The record';
  $('#entity-id').textContent = island.id || '';
  showSeal(h('p', { class: 'statement' }, 'Fetching the record and checking it on this device…'));

  let text;
  try {
    const r = await fetch('record/events.jsonl', { cache: 'no-store' });
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    text = await r.text();
  } catch (e) {
    return fatal('The record could not be fetched', `record/events.jsonl did not load (${e.message}). Nothing has been checked.`);
  }

  ctx.registry = await E.loadRegistry(island.installed || island.modules || ['deliberation']);
  const v = await E.verifyText(ctx.registry, text);
  ctx.records = v.records;
  if (!v.ok) {
    return alarm('This record does not verify', 'The page checked every record itself and found the problems below. Do not act on this copy.',
      v.problems.slice(0, 12).map(p => (p.seq ? `Record ${p.seq}: ${p.problem}` : p.problem)));
  }
  ctx.state = v.state;
  ctx.params = E.paramsOf(ctx.state);
  ctx.words = words();
  document.title = ctx.params.value('entity.name');
  $('#entity-name').textContent = ctx.params.value('entity.name');
  $('#entity-id').textContent = `${ctx.state.entity.id} · founded ${day(ctx.state.entity.founded)}`;

  const finalCount = enabled('finality') ? (ctx.state.m.finality?.finals?.slice(-1)[0]?.count || 0) : null;
  const mem = E.remember(localStorage, ctx.state.entity.id, ctx.records, undefined, finalCount);
  const atts = await loadList('record/attestations/');
  const cmp = await E.compare(ctx.records, ctx.state, atts);
  const cps = await loadList('record/checkpoints/');
  const need = ctx.params.value('record.checkpoint_cosigners');
  const cpStatus = [];
  for (const c of cps) cpStatus.push(await E.checkpointStatus(c, ctx.state, need, ctx.records));
  ctx.seal = { mem, cmp, cps: cpStatus };
  ctx.checkpoints = cps;
  renderSeal(true);
  if (mem.warning) return; // nothing else is shown on a copy that has changed behind you

  if (island.node && 'EventSource' in window) { try { new EventSource('presence'); } catch { /* optional */ } }
  ctx.ident = await K.loadIdentity(ctx.state.entity.id).catch(() => null);
  ctx.tabs = await collectTabs();
  addEventListener('hashchange', route);
  route();
}

async function loadList(dir) {
  try {
    const r = await fetch(`${dir}index.json`, { cache: 'no-store' });
    if (!r.ok) return [];
    const files = await r.json();
    const out = [];
    for (const f of files) { const x = await fetch(dir + f, { cache: 'no-store' }); if (x.ok) out.push(await x.json()); }
    return out;
  } catch { return []; }
}

function showSeal(...kids) { const s = $('#seal'); s.replaceChildren(...kids); s.hidden = false; return s; }
function fatal(title, text) { alarm(title, text); }
function alarm(title, text, items = []) {
  const s = showSeal(h('div', { class: 'alarm' }, h('h2', {}, title), h('p', {}, text), items.length ? h('ul', {}, items.map(i => h('li', {}, i))) : null));
  s.classList.add('bad');
}

function words() {
  const w = (k, d) => (ctx.params.has(k) ? ctx.params.value(k) : d);
  return { one: w('vocabulary.participant', 'participant'), many: w('vocabulary.participants', 'participants'),
    assembly: w('vocabulary.assembly', 'Assembly'), proposal: w('vocabulary.proposal', 'proposal') };
}
const enabled = (m) => ctx.params.value('entity.modules').includes(m);
const nameOf = (id) => ctx.state.m.titles?.[id] || ctx.state.participants[id]?.name || id;
const who = (id) => (ctx.state.participants[id] ? link(`members/${id}`, nameOf(id)) : id);

// ------------------------------------------------------------------ tabs and routing
const CORE_TABS = [
  { id: '', title: 'Overview', render: renderOverview },
  { id: 'votes', title: 'Votes', render: renderVotes },
  { id: 'members', title: 'Members', render: renderMembers },
];
const LAST_TABS = [
  { id: 'record', title: 'Record', render: renderRecord },
  { id: 'law', title: 'Law', render: renderLaw },
  { id: 'settings', title: 'Settings', render: renderSettings },
];

// Each enabled module may export `tabs` = [{ id, title, render(api, path) }]
// from its ui.js; one exporting only a default render(api) gets one tab.
async function collectTabs() {
  if (enabled('authority')) { try { ctx.authority = await import('../../modules/authority/index.js'); } catch { /* not installed here */ } }
  const out = [...CORE_TABS];
  for (const m of ctx.params.value('entity.modules')) {
    let mod;
    try { mod = await import(`../../modules/${m}/ui.js`); } catch { continue; }
    if (Array.isArray(mod.tabs)) for (const t of mod.tabs) out.push({ ...t, module: m });
    else if (typeof mod.default === 'function') out.push({ id: m, title: m[0].toUpperCase() + m.slice(1), module: m, render: (api) => mod.default(api) });
  }
  return [...out, ...LAST_TABS];
}

function route() {
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  const tab = ctx.tabs.find(t => t.id === (path[0] || '')) || ctx.tabs[0];
  const nav = $('#tabs');
  nav.replaceChildren(...ctx.tabs.map(t => h('a', { href: `#/${t.id}`, 'aria-current': t === tab ? 'page' : null }, t.title)));
  nav.hidden = false;
  renderSeal(tab.id === '');
  const view = $('#view');
  let el;
  try { el = tab.module ? tab.render(api(), path.slice(1)) : tab.render(path.slice(1)); }
  catch (e) { el = h('section', {}, h('p', { class: 'hint' }, `This view could not be drawn: ${e.message}`)); console.error(e); }
  view.replaceChildren(...[].concat(el).filter(Boolean));
  window.scrollTo(0, 0);
}
const refresh = () => route();

// What a module's tab is given. The same as 0.3's, plus navigation.
function api() {
  return { h, $, state: ctx.state, params: ctx.params, registry: ctx.registry, me: me(), ident: ctx.ident,
    words: ctx.words, day, when, sign, propose, E, link, go, who, refresh, section,
    list: listView, sorts: { byText, newest, oldest }, grantsFor, nameOf, editForm,
    // The signed-in member's private key, for modules that decrypt (sealed):
    // asks for its password if it is locked; null for passkeys, which cannot.
    key: async (label) => (!ctx.ident || ctx.ident.passkey ? null : unlock(label)) };
}
const section = (title, ...kids) => h('section', {}, title ? h('h2', {}, title) : null, ...kids);

// ------------------------------------------------------------------ the seal
function renderSeal(full) {
  const { mem, cmp, cps } = ctx.seal;
  const n = ctx.records.length;
  const head = ctx.state.head;
  const kids = [];
  if (mem.warning) kids.push(h('div', { class: 'alarm', role: 'alert' }, h('h2', {}, 'The record has changed behind you.'), h('p', {}, mem.warning.text)));
  if (mem.notice) kids.push(h('div', { class: 'notice-box', role: 'status' }, h('p', {}, mem.notice.text)));
  if (cmp.diverged.length) {
    kids.push(h('div', { class: 'alarm', role: 'alert' },
      h('h2', {}, 'Participants hold a different history.'),
      h('ul', {}, cmp.diverged.map(d => h('li', {}, `${d.by} attested ${d.count} records on ${day(d.at)}; ${d.why}.`))),
      h('p', {}, 'One of these histories has been rewritten. Do not act on this copy until it is explained.')));
  }
  kids.push(h('p', { class: full ? 'statement' : 'statement compact' },
    `${n} record${n === 1 ? '' : 's'}, verified in this browser.`));
  if (full) {
    const corroboration = cmp.agreeing.length + cmp.ahead.length
      ? `${cmp.agreeing.length} ${cmp.agreeing.length === 1 ? ctx.words.one : ctx.words.many} attest a history consistent with this one${cmp.ahead.length ? `; ${cmp.ahead.length} hold more than this copy` : ''}.`
      : 'Nobody has attested yet. This copy is verified but not yet corroborated.';
    const binding = cps.filter(c => c.binding && c.consistent !== false);
    kids.push(h('dl', {},
      h('dt', {}, 'Latest'), h('dd', {}, `${when(head.at)} · `, link(`record/${head.seq}`, h('span', { class: 'hash' }, head.hash))),
      h('dt', {}, 'Corroborated'), h('dd', {}, corroboration),
      enabled('finality') ? [h('dt', {}, 'Final'), h('dd', {}, (() => { const l = ctx.state.m.finality?.finals?.slice(-1)[0]; return l ? [`records 1–${l.count} (checkpoint ${l.number}); ${n - l.count} provisional · `, link('finality', 'finality')] : ['nothing yet; every record is provisional · ', link('finality', 'finality')]; })())] : null,
      h('dt', {}, 'Checkpoints'), h('dd', {}, cps.length ? `${binding.length} of ${cps.length} binding${cps.some(c => c.consistent === false) ? '; one CONTRADICTS this record' : ''}` : 'none yet'),
      h('dt', {}, 'This browser'), h('dd', {}, mem.visits > 1 ? `has seen this record on ${mem.visits} visits and it has only grown` : 'is seeing this record for the first time and will remember it')));
  }
  const s = showSeal(...kids);
  s.classList.toggle('bad', !!(mem.warning || cmp.diverged.length));
  s.classList.toggle('slim', !full);
}

// ------------------------------------------------------------------ overview
function electorate() { return E.resolveElectorate(ctx.registry, ctx.state, ctx.params, ctx.state.head.at); }
function decidesText() {
  const e = electorate();
  if (e.frozen) return 'Nothing can be decided here: the entity is frozen, and its rules and modules are fixed for good.';
  if (e.why) return `Nobody can decide at the moment: ${e.why}.`;
  const d = E.describeElectorate(ctx.registry, e.spec);
  return `Proposals are decided by ${d}${e.voters ? ` (${e.voters} on the roll${e.total !== e.voters ? `, ${e.total} votes in all` : ''})` : ', and nobody is on it now'}.`;
}

function renderOverview() {
  const p = me();
  const out = [renderYou()];
  const due = p && p.status === 'active' ? Object.values(ctx.state.proposals).filter(x => !x.closed && x.roll.includes(p.id)
    && !E.tally(ctx.state, x.id).counted.some(b => b.by === p.id) && new Date().toISOString() <= x.deadline) : [];
  const open = Object.values(ctx.state.proposals).filter(x => !x.closed);
  out.push(section(`Before the ${ctx.words.assembly}`, h('p', {}, decidesText()),
    due.length ? h('div', {}, h('p', {}, h('strong', {}, `${due.length} ${due.length === 1 ? ctx.words.proposal + ' needs' : ctx.words.proposal + 's need'} your vote.`)),
      h('ul', { class: 'items' }, due.map(x => proposalRow(x))))
      : h('p', { class: 'hint' }, open.length ? `${open.length} open; none needs your vote.` : `Nothing is open. ${p?.status === 'active' ? '' : ''}`),
    h('p', {}, link('votes', `All ${ctx.words.proposal}s`))));
  const parent = ctx.state.entity.parent;
  if (parent) out.push(section('Where this entity came from', h('p', {}, `It forked from ${parent.name || parent.entity} (${parent.entity}) at that entity's record ${parent.count}, on ${day(ctx.state.entity.founded)}. `,
    `It started with its parameters and modules as they stood then${Object.keys(ctx.records[0].payload.act.carry || {}).length ? `, and took over its ${Object.keys(ctx.records[0].payload.act.carry).join(' and ')}` : ''}. `,
    `Its ${Object.keys(parent.members).length} members then keep their ids here, claimable with the keys they held there.`),
    h('p', { class: 'fine' }, 'Its head there: ', h('span', { class: 'hash' }, parent.head), '. Anyone holding that record can check this: ', h('code', {}, 'entity verify'), ' does, using parent/events.jsonl.')));
  const applicants = ctx.state.order.map(id => ctx.state.participants[id]).filter(x => x.status === 'applicant');
  if (applicants.length) out.push(section('Waiting to be admitted', h('p', {}, applicants.map(a => who(a.id)).reduce((a, b) => [a, ', ', b])), h('p', {}, link('members', 'Admit from the register'))));
  return out;
}

// ------------------------------------------------------------------ you
function me() { return ctx.ident && ctx.state.participants[ctx.ident.id]; }
function myKeyLine() { return !ctx.ident ? null : ctx.ident.passkey || E.keys.publicKeyLine(ctx.ident.publicKey); }

function renderYou() {
  const w = ctx.words;
  const kids = [h('h2', {}, 'You')];
  const p = me();
  if (!ctx.ident) return signedOut();
  const line = myKeyLine();
  const onRegister = p && p.keys.includes(E.keys.keyId(line));
  const status = !p ? ' · not yet on the register' : ` · ${{ active: `an active ${w.one}`, applicant: 'applying, awaiting admission', left: 'has left', removed: `removed on ${day(p.removed)}: ${p.reason}` }[p.status]}`;
  kids.push(h('p', {}, link(`members/${ctx.ident.id}`, h('strong', {}, ctx.ident.id)), status));
  if (p?.status === 'applicant') {
    const why = E.admissionProblem(ctx.registry, ctx.state, ctx.params, p.id);
    if (why) {
      const rest = why.replace(/^.*cannot be admitted yet: /, '');
      const signIt = rest.match(/^has not signed (the current version of )?(".*?")/);
      kids.push(h('p', { class: 'flag' }, signIt ? `Before you can be admitted, sign ${signIt[1] ? 'the current version of ' : ''}${signIt[2]}. ` : `Before you can be admitted: ${rest}. `,
        enabled('agreements') ? link('agreements', 'Read and sign it') : null));
    }
  }
  if (!p) kids.push(h('p', { class: 'hint' }, 'Your application has not been settled into this record yet. If you have not sent it, send it again.'),
    h('div', { class: 'buttons' }, h('button', { onclick: () => applyAct(ctx.ident.id, ctx.ident.name) }, 'Send my application again')));
  else if (!onRegister) kids.push(h('p', { class: 'hint' }, 'The key in this browser is not one registered for this id. Acts signed with it will be refused. If you lost your key, the members can give you a new one by decision: send them this public key.'), h('p', { class: 'hash' }, line));
  kids.push(h('p', { class: 'fine' }, ctx.ident.passkey ? 'You are signed in with a passkey: your device asks for Face ID, a fingerprint or its PIN each time you sign.'
    : ctx.ident.via === 'password' ? `You are signed in with your password${ctx.ident.remember ? ', remembered on this device' : ' for this visit'}.`
    : ctx.ident.locked ? 'Your key is locked with a password; the page asks for it each time you sign.' : 'Your key is kept in this browser without a password. Anyone using this browser can sign as you.'));
  if (p && (p.status === 'active' || p.status === 'applicant')) kids.push(waysIn(p));
  if (p && p.status === 'active' && ctx.registry.has('title.set') && enabled('titles')) {
    kids.push(h('label', { for: 'title' }, 'The name others see'),
      h('div', { class: 'row' }, h('input', { id: 'title', value: ctx.state.m.titles?.[p.id] || '' }),
        h('button', { class: 'quiet', onclick: () => sign('title.set', { title: $('#title').value }) }, 'Sign this name')));
  }
  const kept = !ctx.ident.passkey && ctx.ident.via !== 'password';
  const btns = kept ? [h('button', { class: 'quiet', onclick: exportKey }, 'Save a copy of my key'), ctx.ident.locked
    ? h('button', { class: 'quiet', onclick: removeLock }, 'Remove the password')
    : h('button', { class: 'quiet', onclick: addLock }, 'Lock my key with a password')] : [];
  if (p && (p.status === 'active' || p.status === 'applicant')) btns.push(h('button', { class: 'danger', onclick: leave }, `Leave ${ctx.params.value('entity.name')}`));
  btns.push(h('button', { class: 'quiet', onclick: forget }, kept ? 'Remove my key from this browser' : 'Sign out'));
  kids.push(h('details', {}, h('summary', {}, kept ? 'Your key' : 'Signing out'), h('p', { class: 'hash' }, line),
    E.keys.nodeId(line) ? h('p', { class: 'fine' }, 'As a Radicle Node ID: ', h('span', { class: 'hash' }, E.keys.nodeId(line))) : null,
    h('p', { class: 'fine' }, 'You are a light participant: you hold your own key and verify the record yourself, and a node carries your acts to the network. Running ',
      h('code', {}, 'entity serve'), ' makes you a full one.'),
    h('div', { class: 'buttons' }, btns)));
  return section(null, ...kids);
}

async function join() {
  const id = $('#join-id').value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return alert('An id is 1–40 characters: lowercase letters, digits and -, starting with a letter or digit.');
  if (ctx.state.participants[id]) return alert(`${id} is already taken.`);
  const name = $('#join-name').value.trim() || undefined;
  const password = $('#join-password')?.value || '';
  if (password && password.length < 8) return alert('Use a password of at least 8 characters, or none.');
  const { privateKey } = await E.keys.generate();
  ctx.ident = { id, name, publicKey: privateKey.publicKey, created: new Date().toISOString(),
    ...(password ? { locked: await lockSeed(privateKey.seed, password) } : { seed: privateKey.seed }) };
  await K.saveIdentity(ctx.state.entity.id, ctx.ident);
  refresh();
  const act = await E.makeAct(ctx.registry, ctx.state, 'participant.apply', { by: id, key: myKeyLine(), ...(name ? { name } : {}) }, privateKey);
  offer(act, `Your application to join as ${id}`);
}

async function applyAct(id, name) {
  try {
    const fn = await signer(`Your application to join as ${id}`); if (!fn) return;
    const act = await E.makeActWith(ctx.registry, ctx.state, 'participant.apply', { by: id, key: myKeyLine(), ...(name ? { name } : {}) }, fn);
    offer(act, `Your application to join as ${id}`);
  } catch (e) { alert(`Nothing was signed: ${e.message}`); }
}

async function importKey() {
  try {
    const id = $('#imp-id').value.trim();
    const k = E.keys.importPrivateKey($('#imp-key').value);
    ctx.ident = { id, seed: k.seed, publicKey: k.publicKey, created: new Date().toISOString() };
    await K.saveIdentity(ctx.state.entity.id, ctx.ident);
    refresh();
  } catch (e) { alert(`That key could not be read: ${e.message}`); }
}

async function exportKey() {
  const key = await unlock('Saving a copy of your key'); if (!key) return;
  download(`${ctx.ident.id}.key`, E.keys.exportPrivateKey(key, `${ctx.ident.id}@${ctx.state.entity.id}`), 'application/x-pem-file');
}

async function addLock() {
  const pw = prompt('A password for your key (at least 8 characters). It cannot be recovered: keep a saved copy of the key as well.');
  if (!pw) return;
  if (pw !== prompt('The same password again:')) return alert('The passwords differ. Nothing changed.');
  try {
    const locked = await lockSeed(ctx.ident.seed, pw);
    ctx.ident = { ...ctx.ident, locked }; delete ctx.ident.seed;
    await K.saveIdentity(ctx.state.entity.id, ctx.ident); refresh();
  } catch (e) { alert(e.message); }
}

async function removeLock() {
  const key = await unlock('Removing the password from your key'); if (!key) return;
  ctx.ident = { ...ctx.ident, seed: key.seed }; delete ctx.ident.locked;
  await K.saveIdentity(ctx.state.entity.id, ctx.ident); refresh();
}

async function forget() {
  if (!confirm('Remove your key from this browser? Without a saved copy you cannot sign as this id again from here.')) return;
  await K.forgetIdentity(ctx.state.entity.id);
  ctx.ident = null; refresh();
}

function leave() {
  if (!confirm(`Leaving takes effect when settled, and nothing can prevent it. Sign your departure from ${ctx.params.value('entity.name')}?`)) return;
  sign('participant.leave', {}, 'Your departure');
}

// The private key, for one signature. A locked key asks for its password.
function unlock(label) {
  if (!ctx.ident.locked) return Promise.resolve({ seed: ctx.ident.seed, publicKey: ctx.ident.publicKey });
  const d = $('#unlock');
  $('#unlock-what').textContent = `${label}.`;
  $('#unlock-password').value = ''; $('#unlock-result').textContent = '';
  return new Promise((resolve) => {
    const onClose = async () => {
      if (d.returnValue !== 'ok') return resolve(null);
      try { resolve({ seed: await unlockSeed(ctx.ident.locked, $('#unlock-password').value), publicKey: ctx.ident.publicKey }); }
      catch (e) { $('#unlock-result').textContent = e.message; d.returnValue = ''; d.showModal(); d.addEventListener('close', onClose, { once: true }); }
    };
    d.addEventListener('close', onClose, { once: true });
    d.returnValue = '';
    d.showModal();
  });
}

// How the signed-in member signs: fn(message, namespace) → signature, or null.
async function signer(label) {
  if (ctx.ident.passkey) return (message, namespace) => passkeySign(ctx.ident.passkey, message, namespace);
  const key = await unlock(label); if (!key) return null;
  return (message, namespace) => E.keys.sign(message, key, namespace);
}

// then: acts to sign and send, one after another, once this one is sent.
async function sign(kind, fields, label, then = []) {
  try {
    const fn = await signer(label || kind); if (!fn) return;
    const act = await E.makeActWith(ctx.registry, ctx.state, kind, { by: ctx.ident.id, ...fields }, fn);
    offer(act, label || kind, then.length ? async (send) => { for (const [k, f] of then) { await new Promise(r => setTimeout(r, 1100)); await send(await E.makeActWith(ctx.registry, ctx.state, k, { by: ctx.ident.id, ...f }, fn)); } } : null);
  } catch (e) { alert(`Nothing was signed: ${e.message}`); }
}

// ------------------------------------------------------------------ passkeys and passwords
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const canPasskey = () => enabled('passkeys') && !!window.PublicKeyCredential;
const canPassword = () => enabled('passwords');

async function passkeySign(line, message, namespace) {
  const pk = E.keys.parsePasskey(line);
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: await E.keys.passkeyChallenge(message, namespace), rpId: pk.rp, userVerification: 'preferred', timeout: 120000,
    allowCredentials: [{ type: 'public-key', id: unb64u(pk.credentialId) }] } });
  if (!cred) throw new Error('the passkey was not used');
  return E.keys.passkeySignature(line, cred.response);
}

async function makePasskey(id, name) {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { id: location.hostname, name: ctx.params.value('entity.name') },
    user: { id: new TextEncoder().encode(`${id}@${ctx.state.entity.id}`).slice(0, 64), name: id, displayName: name || id },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    timeout: 120000, attestation: 'none' } });
  if (!cred) throw new Error('no passkey was made');
  if (cred.response.getPublicKeyAlgorithm && cred.response.getPublicKeyAlgorithm() !== -7) throw new Error('this device made a kind of passkey this page cannot use (it needs ES256)');
  return E.keys.passkeyLine({ credentialId: new Uint8Array(cred.rawId), publicKey: new Uint8Array(cred.response.getPublicKey()), rp: location.hostname });
}

// Every key line a member holds that is a passkey.
const passkeysOf = (p) => (p?.keys || []).filter(E.keys.isPasskey);

// The page for someone not signed in: sign in any way this entity offers, or join.
function signedOut() {
  const open = ctx.params.value('membership.admission') === 'open';
  const min = canPassword() ? ctx.params.value('passwords.min_length') : 12;
  const ways = ['a key kept in this browser'].concat(canPassword() ? ['a username and password'] : [], canPasskey() ? ['a passkey (Face ID, a fingerprint, a security key)'] : []);
  const signIn = h('div', {},
    h('h3', {}, 'Sign in'),
    canPassword() ? h('div', { class: 'inline-form' },
      h('label', { for: 'si-id' }, 'Username'), h('input', { id: 'si-id', autocomplete: 'username', spellcheck: 'false', autocapitalize: 'none' }),
      h('label', { for: 'si-pw' }, 'Password'), h('input', { id: 'si-pw', type: 'password', autocomplete: 'current-password' }),
      h('label', { style: 'font-weight:400' }, h('input', { type: 'checkbox', id: 'si-remember', style: 'width:auto;margin-right:.5rem' }), 'Keep me signed in on this device'),
      h('div', { class: 'buttons' }, h('button', { onclick: passwordSignIn }, 'Sign in'))) : null,
    canPasskey() ? h('div', { class: 'buttons' }, h('button', { class: canPassword() ? 'quiet' : null, onclick: passkeySignIn }, 'Sign in with a passkey (Face ID, fingerprint…)')) : null,
    h('details', {}, h('summary', {}, 'Use a key file I already have'),
      h('label', { for: 'imp-id' }, 'Your id'), h('input', { id: 'imp-id', spellcheck: 'false' }),
      h('label', { for: 'imp-key' }, 'Private key (OpenSSH format)'), h('textarea', { id: 'imp-key', spellcheck: 'false' }),
      h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: importKey }, 'Keep this key in this browser'))),
    h('p', { class: 'fine', role: 'status', id: 'si-result' }));
  const joinForm = h('div', {},
    h('h3', {}, 'Join'),
    h('p', { class: 'fine' }, `${open ? 'Admission is open: you are a member once your application is settled.' : 'Admission is by decision: once your application is settled, the members decide whether to admit you.'} You can sign in with ${ways.join(', or ')}; you can add the others later.`),
    h('label', { for: 'join-id' }, 'Choose a username'),
    h('input', { id: 'join-id', placeholder: 'lowercase letters, digits and -', autocomplete: 'username', spellcheck: 'false', autocapitalize: 'none' }),
    h('label', { for: 'join-name' }, 'Your name (optional)'), h('input', { id: 'join-name', autocomplete: 'name' }),
    canPassword() ? [h('label', { for: 'join-pw' }, `A password (at least ${min} characters: a few ordinary words together are good)`),
      h('input', { id: 'join-pw', type: 'password', autocomplete: 'new-password' }),
      h('label', { for: 'join-pw2' }, 'The same password again'), h('input', { id: 'join-pw2', type: 'password', autocomplete: 'new-password' })]
      : [h('label', { for: 'join-password' }, 'A password to lock the key in this browser (optional, recommended)'),
        h('input', { id: 'join-password', type: 'password', autocomplete: 'new-password', placeholder: 'at least 8 characters; asked each time you sign' })],
    h('div', { class: 'buttons' },
      canPassword() ? h('button', { onclick: joinWithPassword }, 'Join with this password') : null,
      canPasskey() ? h('button', { class: canPassword() ? 'quiet' : null, onclick: joinWithPasskey }, 'Join with a passkey') : null,
      h('button', { class: canPassword() || canPasskey() ? 'quiet' : null, onclick: join }, 'Join with a key kept in this browser')),
    h('p', { class: 'fine', role: 'status', id: 'join-result' }));
  return section('You', signIn, joinForm);
}

const say = (el, text) => { const e = $(el); if (e) e.textContent = text; };
function joinId() {
  const id = $('#join-id').value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) { alert('A username is 1–40 characters: lowercase letters, digits and -, starting with a letter or digit.'); return null; }
  if (ctx.state.participants[id]) { alert(`${id} is already taken.`); return null; }
  return id;
}

async function passwordSignIn() {
  const id = $('#si-id').value.trim().toLowerCase(), pw = $('#si-pw').value;
  const p = ctx.state.participants[id];
  if (!p) return say('#si-result', `There is no member called ${id || '(empty)'}.`);
  say('#si-result', 'Checking…');
  const k = await E.passwordKey(ctx.state.entity.id, id, pw);
  if (!p.keys.includes(E.keys.keyId(E.keys.publicKeyLine(k.publicKey)))) return say('#si-result', 'That password is not right, or this member has no password set.');
  const remember = $('#si-remember').checked;
  ctx.ident = { id, seed: k.seed, publicKey: k.publicKey, via: 'password', remember, created: new Date().toISOString() };
  if (remember) await K.saveIdentity(ctx.state.entity.id, ctx.ident);
  refresh();
}

async function passkeySignIn() {
  try {
    say('#si-result', 'Waiting for your passkey…');
    const cred = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: 'preferred', timeout: 120000 } });
    const c = b64u(cred.rawId);
    const found = ctx.state.order.map(id => ctx.state.participants[id]).find(p => passkeysOf(p).some(l => E.keys.parsePasskey(l).credentialId === c));
    if (!found) return say('#si-result', 'That passkey is not registered to any member here.');
    ctx.ident = { id: found.id, passkey: passkeysOf(found).find(l => E.keys.parsePasskey(l).credentialId === c), via: 'passkey', created: new Date().toISOString() };
    await K.saveIdentity(ctx.state.entity.id, ctx.ident);
    refresh();
  } catch (e) { say('#si-result', `No passkey was used (${e.message}).`); }
}

async function joinWithPassword() {
  const id = joinId(); if (!id) return;
  const pw = $('#join-pw').value;
  if (pw !== $('#join-pw2').value) return alert('The two passwords differ.');
  const why = E.passwordProblem(pw, id, ctx.params.value('passwords.min_length'));
  if (why) return alert(`Choose a stronger password: ${why}.`);
  const name = $('#join-name').value.trim() || undefined;
  say('#join-result', 'Making your key from your password…');
  const k = await E.passwordKey(ctx.state.entity.id, id, pw);
  ctx.ident = { id, name, seed: k.seed, publicKey: k.publicKey, via: 'password', created: new Date().toISOString() };
  const line = myKeyLine();
  refresh();
  const fn = (m, ns) => E.keys.sign(m, k, ns);
  const act = await E.makeActWith(ctx.registry, ctx.state, 'participant.apply', { by: id, key: line, ...(name ? { name } : {}) }, fn);
  offer(act, `Your application to join as ${id}, with a password`, async (send) => {
    await new Promise(r => setTimeout(r, 1100));
    await send(await E.makeActWith(ctx.registry, ctx.state, 'password.set', { by: id, key: line }, fn));
  });
}

async function joinWithPasskey() {
  const id = joinId(); if (!id) return;
  const name = $('#join-name').value.trim() || undefined;
  try {
    say('#join-result', 'Making a passkey on this device…');
    const line = await makePasskey(id, name);
    say('#join-result', 'Now confirm once more, to sign your application…');
    const act = await E.makeActWith(ctx.registry, ctx.state, 'participant.apply', { by: id, key: line, ...(name ? { name } : {}) }, (m, ns) => passkeySign(line, m, ns));
    ctx.ident = { id, name, passkey: line, via: 'passkey', created: new Date().toISOString() };
    await K.saveIdentity(ctx.state.entity.id, ctx.ident);
    refresh();
    offer(act, `Your application to join as ${id}, with a passkey`);
  } catch (e) { say('#join-result', `No passkey was made (${e.message}).`); }
}

// For a signed-in member: every way they can sign in, and adding or removing one.
function waysIn(p) {
  const pwKey = ctx.state.m.passwords?.[p.id]?.key;
  const named = Object.fromEntries((ctx.state.m.passkeys?.[p.id] || []).map(x => [x.key, x.name]));
  const rows = p.keys.map(k => {
    const kind = E.keys.isPasskey(k) ? `passkey${named[k] ? `: ${named[k]}` : ''}` : k === pwKey ? 'password' : 'key';
    const removable = p.keys.length > 1 && ((E.keys.isPasskey(k) && enabled('passkeys')) || (k === pwKey && enabled('passwords')));
    return h('li', {}, kind, k === E.keys.keyId(myKeyLine()) ? h('span', { class: 'category' }, 'this one') : null,
      removable ? [' ', h('button', { class: 'quiet', onclick: () => k === pwKey
        ? sign('password.remove', {}, 'Removing your password')
        : sign('passkey.remove', { key: k }, `Removing the passkey ${named[k] || ''}`) }, 'Remove')] : null);
  });
  const add = [];
  if (canPassword()) add.push(h('button', { class: 'quiet', onclick: async () => {
    const pw = prompt(`${pwKey ? 'A new' : 'A'} password (at least ${ctx.params.value('passwords.min_length')} characters):`); if (!pw) return;
    if (pw !== prompt('The same password again:')) return alert('The passwords differ. Nothing changed.');
    const why = E.passwordProblem(pw, p.id, ctx.params.value('passwords.min_length')); if (why) return alert(`Choose a stronger password: ${why}.`);
    const k = await E.passwordKey(ctx.state.entity.id, p.id, pw);
    sign('password.set', { key: E.keys.publicKeyLine(k.publicKey) }, pwKey ? 'Changing your password' : 'Adding a password');
  } }, pwKey ? 'Change my password' : 'Add a password'));
  if (canPasskey()) add.push(h('button', { class: 'quiet', onclick: async () => {
    const nm = prompt('A name for this device (e.g. "iPhone", "laptop"):', 'This device'); if (!nm) return;
    try { const line = await makePasskey(p.id, nm); sign('passkey.add', { key: line, name: nm }, `Adding the passkey ${nm}`); }
    catch (e) { alert(`No passkey was made (${e.message}).`); }
  } }, 'Add a passkey on this device'));
  return h('details', {}, h('summary', {}, `Ways to sign in (${p.keys.length})`), h('ul', {}, rows),
    add.length ? h('div', { class: 'buttons' }, add) : h('p', { class: 'fine' }, 'Password and passkey sign-in are modules this entity has not installed.'));
}

// ------------------------------------------------------------------ sending
function offer(act, label, then = null) {
  ctx.then = then;
  const d = $('#send');
  $('#send-what').textContent = `${label}. It is signed; nothing has been sent yet. Choose how to send it.`;
  const own = $('#own-node');
  own.value = localStorage.getItem(`entity:${ctx.state.entity.id}:node`) || (island.node ? new URL('.', location.href).href : 'http://localhost:7780/');
  $('#peer-node').value = '';
  const res = $('#send-result'); res.textContent = ''; res.className = '';
  d.querySelectorAll('[data-send]').forEach(b => { b.onclick = () => deliver(b.dataset.send, act); });
  d.showModal();
}

async function deliver(way, act) {
  const res = $('#send-result');
  const say = (t, ok) => { res.textContent = t; res.className = ok ? 'ok' : 'bad'; };
  if (way === 'file') {
    download(`${act.kind}-${E.actHash(act).slice(0, 12)}.act.json`, JSON.stringify(act, null, 2) + '\n', 'application/json');
    return say('Saved. Anyone holding a copy can add it with `entity absorb <file>`.', true);
  }
  const url = (way === 'own' ? $('#own-node') : $('#peer-node')).value.trim();
  if (!url) return say('Give the node\'s address first.', false);
  const problem = E.sendProblem(location.href, url);
  if (problem) return say(problem, false);
  try {
    const base = url.endsWith('/') ? url : url + '/';
    const { r, body } = await postAct(base, act, say);
    if (!r.ok || (body.refused && body.refused.length)) return say(`The node refused it: ${(body.refused && body.refused[0]?.why) || body.why || r.status}`, false);
    if (way === 'own') localStorage.setItem(`entity:${ctx.state.entity.id}:node`, url);
    say(body.settled ? 'Sent and settled. Reload to see it in the record.' : 'Sent. It enters the record when a node settles it.', true);
    if (ctx.then) {
      const next = ctx.then; ctx.then = null;
      say('Sent. Finishing…', true);
      await next(async (a) => {
        const { r: r2, body: b2 } = await postAct(base, a, say);
        if (!r2.ok || (b2.refused && b2.refused.length)) throw new Error((b2.refused && b2.refused[0]?.why) || b2.why || r2.status);
      }).then(() => say('Sent and settled. Reload to see it in the record.', true)).catch(e => say(`The first part was sent; the next was refused: ${e.message}`, false));
    }
  } catch (e) {
    say(`${url} could not be reached (${e.message}). If it is on this computer, check that \`entity serve\` is running. Saving as a file always works.`, false);
  }
}

// Send an act to a node. If the node asks for email two-factor (the twofactor
// module), confirm this browser with the emailed code, then send it again.
async function postAct(base, act, say) {
  const send = async () => { const r = await fetch(new URL('acts', base), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(act) }); return { r, body: await r.json().catch(() => ({})) }; };
  let x = await send();
  if (x.body.twofactor && new URL(base).origin === location.origin && ctx.ident) {
    say('This republic uses email two-factor: confirming this browser…', true);
    const T = await import('./twofactor.js');
    try {
      const fn = await signer('Confirm this browser for two-factor'); if (!fn) return x;
      await T.confirmBrowser({ id: ctx.ident.id, sign: fn, ask: T.promptAsk, base });
      x = await send();
    } catch (e) { if (e.message !== 'cancelled') say(`Two-factor: ${e.message}`, false); }
  }
  return x;
}

// The node this page talks to: the one serving it, or the one last used.
function nodeBase() {
  if (island.node) return new URL('.', location.href).href;
  const saved = localStorage.getItem(`entity:${ctx.state.entity.id}:node`);
  return saved ? (saved.endsWith('/') ? saved : saved + '/') : null;
}
async function toNode(method, p, payload) {
  const base = nodeBase();
  if (!base) throw new Error('this page is not served by a node, and no node has been used from it yet: send one act to your node first');
  const r = await fetch(new URL(p, base), { method, headers: { 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.why || `the node answered ${r.status}`);
  return b;
}

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// ------------------------------------------------------------------ votes
function statusOf(x) {
  return x.closed
    ? (x.closed.carried ? (x.enacted ? 'Carried and enacted' : x.awaiting ? `Carried; awaiting ${x.awaiting}` : `Carried but not enacted: ${x.notEnacted}`) : 'Not carried')
    : `Open until ${when(x.deadline)}`;
}
const stateClass = (x) => (x.closed ? (x.closed.carried ? 'state-carried' : 'state-failed') : '');

function effectsList(x) {
  const out = [];
  for (const [k, v] of Object.entries(x.changes || {})) out.push(h('li', {}, `Set ${k} to `, h('code', {}, JSON.stringify(v)), ` (now ${JSON.stringify(ctx.params.has(k) ? ctx.params.value(k) : null)})`));
  for (const id of x.admit || []) out.push(h('li', {}, `Admit ${id}`));
  if (x.paths) out.push(h('li', {}, `Approve changes to ${x.paths.join(', ')}`));
  if (x.install) for (const m of x.install) out.push(h('li', {}, `Install the ${m.name} module from ${m.source}, code ${short(m.digest)}`));
  if (x.adds) out.push(h('li', {}, `Add settings: ${Object.keys(x.adds).join(', ')}`));
  for (const e of x.effects || []) {
    const def = ctx.registry.effects.get(e.kind);
    const flag = e.kind === 'participant.rekey' || e.kind === 'participant.remove';
    out.push(h('li', { class: flag ? 'flag' : null }, def ? def.describe(e) : e.kind));
  }
  return out;
}

function tallyBar(x, t) {
  const e = t.electorate || 1;
  return [h('div', { class: 'bar', role: 'img', 'aria-label': `${t.for} for, ${t.against} against, ${t.abstain} abstaining of ${t.electorate}` },
    h('i', { class: 'f', style: `width:${(t.for / e) * 100}%` }), h('i', { class: 'a', style: `width:${(t.against / e) * 100}%` }), h('i', { class: 'b', style: `width:${(t.abstain / e) * 100}%` })),
  h('div', { class: 'tally' },
    h('span', {}, `${t.for} for`), h('span', {}, `${t.against} against`), h('span', {}, `${t.abstain} abstaining`),
    h('span', {}, `${t.cast} of ${t.electorate} ${t.weighted ? 'votes cast' : 'voted'}; quorum ${t.quorumNeeded} ${t.quorumMet ? 'met' : 'not met'}`),
    h('span', {}, `needs ${Math.round(x.terms.threshold * 100)}% of decisive votes`))];
}

function proposalRow(x) {
  const t = E.tally(ctx.state, x.id);
  return h('li', {}, h('h3', {}, link(`votes/${x.id}`, x.title)),
    h('p', { class: 'meta' }, `${x.id} · laid by `, who(x.by), ` on ${day(x.at)} under the ${x.rule} rule`),
    h('p', { class: stateClass(x) }, statusOf(x)), ...tallyBar(x, t), ballotButtons(x, t));
}

function ballotButtons(x, t) {
  const p = me();
  const mine = t.counted.find(b => b.by === p?.id);
  const kids = [];
  if (p && p.status === 'active' && !x.closed && x.roll.includes(p.id) && new Date().toISOString() <= x.deadline) {
    kids.push(h('div', { class: 'buttons' },
      ['for', 'against', 'abstain'].map(c => h('button', { class: mine?.choice === c ? '' : 'quiet',
        onclick: () => sign('ballot.cast', { proposal: x.id, choice: c }, `Your ballot: ${c} "${x.title}"`) },
      c === 'for' ? 'Vote for' : c === 'against' ? 'Vote against' : 'Abstain'))),
    mine ? h('p', { class: 'fine' }, `Your counted ballot: ${mine.choice}${mine.weight ? `, weighing ${mine.weight}` : ''}. A later ballot replaces it while the ${ctx.words.proposal} is open.`) : null);
  } else if (p && p.status === 'active' && !x.closed && !x.roll.includes(p.id)) {
    kids.push(h('p', { class: 'fine' }, 'You are not on this proposal\'s roll.'));
  }
  if (p && !x.closed && new Date().toISOString() >= x.deadline) {
    kids.push(h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => sign('proposal.close', { proposal: x.id }, `Closing "${x.title}"`) }, 'Close and count')));
  }
  return kids;
}

// What a proposal touches, as tags for filtering: settings, modules, code,
// members, a module's name for each of its effects, or a motion.
function tagsOf(x) {
  const t = new Set();
  const keys = Object.keys(x.changes || {});
  if (keys.some(k => k !== 'entity.modules')) t.add('settings');
  if (keys.includes('entity.modules') || x.install || x.adds) t.add('modules');
  if (x.paths) t.add('code');
  if (x.admit?.length) t.add('members');
  for (const e of x.effects || []) {
    const m = ctx.registry.effects.get(e.kind)?.module;
    t.add(m === 'kernel' ? 'members' : m || 'other');
  }
  if (!t.size) t.add('motion');
  return [...t];
}
const TAG = { settings: 'Settings', modules: 'Modules', code: 'Code', members: 'Members', motion: 'Motions' };
function proposalText(x) {
  return [x.id, x.title, x.text, x.rule, x.by, ...Object.keys(x.changes || {}), ...(x.effects || []).map(e => ctx.registry.effects.get(e.kind)?.describe(e) || e.kind)].filter(Boolean).join(' ');
}

function renderVotes(path) {
  if (path[0]) return renderProposal(path[0]);
  const all = Object.values(ctx.state.proposals);
  const p = me();
  const needsMe = (x) => p && !x.closed && x.roll.includes(p.id) && !E.tally(ctx.state, x.id).counted.some(b => b.by === p.id);
  const tags = [...new Set(all.flatMap(tagsOf))].sort();
  const votes = (x) => E.tally(ctx.state, x.id).cast;
  const out = [section(`Before the ${ctx.words.assembly}`, h('p', {}, decidesText()),
    listView({
      key: 'votes', items: all, noun: `${ctx.words.proposal}s`, render: proposalRow, text: proposalText,
      empty: `No ${ctx.words.proposal}s yet.`,
      mine: p ? (x) => needsMe(x) || x.by === p.id : null,
      sorts: [['Newest first', newest()], ['Oldest first', oldest()],
        ['Closing soonest', (a, b) => (!!a.closed - !!b.closed) || (a.deadline < b.deadline ? -1 : 1)],
        ['Most votes cast', (a, b) => votes(b) - votes(a)], ['Title, A–Z', byText(x => x.title)]],
      filters: [
        { label: 'Status', options: [['Any status', () => true], ['Open', (x) => !x.closed], ['Carried', (x) => x.closed?.carried], ['Not carried', (x) => x.closed && !x.closed.carried]] },
        { label: 'What it changes', options: [['Changes anything', () => true], ...tags.map(t => [TAG[t] || t[0].toUpperCase() + t.slice(1), (x) => tagsOf(x).includes(t)])] },
        { label: 'Rule', options: [['Any rule', () => true], ...ctx.params.ruleOrder().map(r => [`Under the ${r} rule`, (x) => x.rule === r])] },
      ],
    }))];
  if (p && p.status === 'active' && !electorate().frozen) out.push(section(null, layForm(), advancedProposalForm()));
  return out;
}

// Reversing a decision: the record is never edited, so a reversal is a new
// decision that undoes the old one's effects. Settings go back to their values
// just before it; effects with an opposite get that opposite; the rest is listed.
const UNDO = 'reversing an earlier decision';
const INVERSE = {
  'office.create': (e) => ({ kind: 'office.abolish', office: e.office }),
  'office.fill': (e) => ({ kind: 'office.vacate', office: e.office, holder: e.holder }),
  'office.vacate': (e) => ({ kind: 'office.fill', office: e.office, holder: e.holder }),
  'committee.create': (e) => ({ kind: 'committee.dissolve', committee: e.committee }),
  'committee.appoint': (e) => ({ kind: 'committee.remove', committee: e.committee, member: e.member }),
  'committee.remove': (e) => ({ kind: 'committee.appoint', committee: e.committee, member: e.member }),
  'authority.grant': (e) => ({ kind: 'authority.revoke', grant: e.grant, reason: UNDO }),
  'badge.create': (e) => ({ kind: 'badge.retire', badge: e.badge }),
  'badge.award': (e) => ({ kind: 'badge.revoke', badge: e.badge, from: e.to, reason: UNDO }),
  'budget.line': (e) => ({ kind: 'budget.close', line: e.line }),
  'deed.grant': (e) => ({ kind: 'deed.retire', deed: e.deed, reason: UNDO }),
  'meeting.call': (e) => ({ kind: 'meeting.cancel', meeting: e.meeting, reason: UNDO }),
  'participant.admit': (e) => ({ kind: 'participant.remove', id: e.id, reason: UNDO }),
  'value.issue': (e) => ({ kind: 'value.revoke', from: e.to, amount: e.amount, memo: UNDO }),
  'share.issue': (e) => ({ kind: 'share.redeem', class: e.class, from: e.to, count: e.count }),
};
function describeEffect(e) {
  const def = ctx.registry.effects.get(e.kind);
  try { return def?.describe ? def.describe(e) : e.kind; } catch { return e.kind; }
}
function reversalOf(x) {
  const at = ctx.records.findIndex(r => r.payload?.proposal === x.id);
  const changes = {};
  for (const k of Object.keys(x.changes || {})) {
    let prev;
    for (let i = 0; i < (at < 0 ? ctx.records.length : at); i++) { const r = ctx.records[i]; if (r.kind === 'parameters.changed' && k in (r.payload.changes || {})) prev = { v: r.payload.changes[k] }; }
    changes[k] = prev ? prev.v : ctx.params.def(k)?.default;
  }
  const effects = [], cannot = [];
  for (const e of [...(x.effects || [])].reverse()) {
    const f = INVERSE[e.kind];
    if (f) effects.push(f(e)); else cannot.push(e);
  }
  return { changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)), effects, cannot };
}
function reversalPanel(x) {
  if (!x.enacted || x.next) return null;
  const m = me();
  if (m?.status !== 'active') return null;
  const r = reversalOf(x);
  const what = [...Object.entries(r.changes).map(([k, v]) => `${k} back to ${JSON.stringify(v)}`), ...r.effects.map(describeEffect)];
  return h('details', { class: 'edit' }, h('summary', {}, 'Propose reversing this'),
    h('div', { class: 'inline-form' },
      what.length ? [h('p', {}, 'A new decision would undo it:'), h('ul', {}, what.map(t => h('li', {}, t)))] : null,
      r.cannot.length ? h('p', { class: 'hint' }, `Not undone automatically: ${r.cannot.map(e => e.kind).join(', ')}. Change these with Edit on their tab, or by a further decision.`) : null,
      what.length ? h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const title = `Reverse "${x.title}"`, act = { title, effects: r.effects, changes: r.changes };
        const rule = E.required(ctx.params, act, ctx.registry).name;
        sign('proposal.lay', { title, rule, text: `Reverses ${x.id}.`, ...(r.effects.length ? { effects: r.effects } : {}), ...(Object.keys(r.changes).length ? { changes: r.changes } : {}) }, `Your proposal to reverse "${x.title}" (${rule} rule)`);
      } }, 'Propose the reversal')) : h('p', { class: 'hint' }, 'Nothing in it can be undone automatically.')));
}

// A further reading: the same proposal again, under the same rule, naming the
// reading it follows, once the rule's waiting time has passed.
function nextReadingPanel(x) {
  const m = me();
  if (!x.closed?.carried || x.enacted || x.next || m?.status !== 'active') return null;
  const earliest = x.closed.awaiting?.match(/no sooner than (\S+)/)?.[1];
  const ready = !earliest || new Date() >= new Date(earliest);
  const copy = {};
  for (const k of ['changes', 'admit', 'paths', 'digest', 'effects', 'adds', 'install']) if (x[k] != null && !(Array.isArray(x[k]) && !x[k].length) && !(typeof x[k] === 'object' && !Array.isArray(x[k]) && !Object.keys(x[k]).length)) copy[k] = x[k];
  return h('div', { class: 'grant' }, h('h3', {}, `Reading ${x.reading + 1}`),
    h('p', { class: 'hint' }, ready ? `This carried at reading ${x.reading}. The ${x.rule} rule needs a further reading: the same proposal, laid again and voted again.` : `The next reading may be laid from ${day(earliest)}.`),
    h('div', { class: 'buttons' }, h('button', { disabled: !ready || null, onclick: () => sign('proposal.lay', { title: x.title, ...(x.text ? { text: x.text } : {}), rule: x.rule, ...copy, reading_of: x.id }, `Reading ${x.reading + 1} of "${x.title}"`) }, `Lay reading ${x.reading + 1}`)));
}

// Proposing anything: effects and settings written out as JSON, for what no tab
// has a form for. The rule is worked out as for any proposal.
function advancedProposalForm() {
  const title = h('input', { id: 'adv-title', placeholder: 'Re-anchor the validators' });
  const effects = h('textarea', { id: 'adv-effects', placeholder: '[{ "kind": "finality.reanchor", "checkpoint": 3 }]' });
  const changes = h('textarea', { id: 'adv-changes', placeholder: '{ "deliberation.period": 10 }' });
  return h('details', {}, h('summary', {}, 'Propose anything (written out)'), h('div', { class: 'inline-form' },
    h('p', { class: 'hint' }, 'For what no tab has a form for: effects as a JSON list, settings as a JSON object, or both. The rule is chosen for you, the strictest any part needs.'),
    h('label', { for: 'adv-title' }, 'Title'), title,
    h('label', { for: 'adv-effects' }, 'Effects (optional)'), effects,
    h('label', { for: 'adv-changes' }, 'Settings to change (optional)'), changes,
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      let fx, ch;
      try { fx = effects.value.trim() ? JSON.parse(effects.value) : undefined; ch = changes.value.trim() ? JSON.parse(changes.value) : undefined; } catch (e) { return alert(`That is not valid JSON: ${e.message}`); }
      if (fx !== undefined && !Array.isArray(fx)) return alert('Effects are a list: [ { "kind": … } ]');
      if (ch !== undefined && (typeof ch !== 'object' || Array.isArray(ch))) return alert('Settings are an object: { "key": value }');
      if (!fx && !ch) return alert('Write some effects, or some settings, or both.');
      if (!title.value.trim()) return alert('Give it a title.');
      const act = { title: title.value.trim(), ...(fx ? { effects: fx } : {}), ...(ch ? { changes: ch } : {}) };
      let rule;
      try { rule = E.required(ctx.params, act, ctx.registry).name; } catch (e) { return alert(e.message); }
      sign('proposal.lay', { ...act, rule }, `Your ${ctx.words.proposal} "${act.title}" (${rule} rule)`);
    } }, 'Sign'))));
}

function renderProposal(id) {
  const x = ctx.state.proposals[id];
  if (!x) return section('Not found', h('p', {}, `No ${ctx.words.proposal} ${id} is in this record.`), h('p', {}, link('votes', 'Every proposal')));
  const t = E.tally(ctx.state, id);
  const effects = effectsList(x);
  const chain = [];
  for (let q = x; q; q = q.reading_of ? ctx.state.proposals[q.reading_of] : null) chain.unshift(q);
  for (let q = x.next ? ctx.state.proposals[x.next] : null; q; q = q.next ? ctx.state.proposals[q.next] : null) chain.push(q);
  const timeline = [];
  for (const q of chain) {
    timeline.push(h('li', {}, `${when(q.at)}: reading ${q.reading} laid by `, who(q.by), q.id === id ? ' (this one)' : [' (', link(`votes/${q.id}`, q.id), ')']));
    if (q.closed) timeline.push(h('li', {}, `${when(q.closed.at)}: ${q.closed.carried ? 'carried' : 'not carried'}${q.closed.closedEarly ? ', closed as soon as the outcome could not change' : ''}${q.enacted && !q.next ? '; enacted' : ''}`));
  }
  const weighted = !!x.weights;
  return section(x.title,
    h('p', { class: 'meta' }, `${x.id} · laid by `, who(x.by), ` on ${when(x.at)} under the ${x.rule} rule${x.terms.readings > 1 ? `, reading ${x.reading} of ${x.terms.readings}` : ''}`),
    x.text ? h('p', { class: 'post-body' }, x.text) : null,
    effects.length ? [h('h3', {}, 'What it does'), h('ul', {}, effects)] : h('p', { class: 'hint' }, 'A motion: it changes nothing, and records what is decided.'),
    h('p', { class: stateClass(x) }, statusOf(x)), ...tallyBar(x, t), ballotButtons(x, t), nextReadingPanel(x), reversalPanel(x),
    h('h3', {}, 'Who could vote'),
    h('p', { class: 'fine' }, `${E.describeElectorate(ctx.registry, x.electorate || 'members')}, as they stood when it was laid: ${x.roll.length} ${x.roll.length === 1 ? 'voter' : 'voters'}${weighted ? `, ${t.electorate} votes in all` : ''}.`),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Voter'), weighted ? h('th', {}, 'Weight') : null, h('th', {}, 'Ballot'), h('th', {}, 'When'))),
      h('tbody', {}, x.roll.map(v => { const b = t.counted.find(c => c.by === v);
        return h('tr', {}, h('td', {}, who(v)), weighted ? h('td', {}, x.weights[v]) : null, h('td', {}, b ? b.choice : '—'), h('td', {}, b ? when(b.at) : '')); })))),
    t.replaced.length ? h('details', {}, h('summary', {}, `${t.replaced.length} ballot(s) replaced by a later one`), h('ul', {}, t.replaced.map(r => h('li', {}, r.by)))) : null,
    t.rejected.length ? h('details', { open: true }, h('summary', {}, `${t.rejected.length} ballot(s) not counted`), h('ul', {}, t.rejected.map(r => h('li', {}, `${r.by}: ${r.why}`)))) : null,
    h('h3', {}, 'Timeline'), h('ul', {}, timeline),
    h('p', {}, link('votes', `Every ${ctx.words.proposal}`)));
}

function layForm() {
  const P = ctx.params;
  const rules = P.ruleOrder();
  const groups = {};
  for (const k of P.keys()) if (P.rule(k).changeable !== false) (groups[P.def(k).group || 'Other'] ||= []).push(k);
  const keySel = h('select', { id: 'lay-key' }, h('option', { value: '' }, 'No change: a motion'),
    Object.entries(groups).map(([g, ks]) => h('optgroup', { label: g }, ks.map(k => h('option', { value: k }, k)))));
  const about = h('p', { class: 'fine', id: 'lay-about' });
  const valueBox = h('div', { id: 'lay-value-box' });
  const ruleSel = h('select', { id: 'lay-rule' }, rules.map(r => h('option', { value: r }, r)));
  const ruleWhy = h('p', { class: 'fine' });
  const terms = (n) => { const r = P.rules[n]; return `${Math.round(r.quorum * 100)}% must vote; ${Math.round(r.threshold * 100)}% of decisive votes${r.readings > 1 ? `; ${r.readings} readings ${r.apart} days apart` : ''}`; };
  const setRule = (min, why) => {
    for (const o of ruleSel.options) o.disabled = P.rank(o.value) < P.rank(min);
    ruleSel.value = min;
    ruleWhy.textContent = `${why} Rules weaker than "${min}" are unavailable. ${min}: ${terms(min)}.`;
  };
  keySel.addEventListener('change', () => {
    const k = keySel.value;
    valueBox.replaceChildren(); about.replaceChildren();
    if (!k) { setRule(rules[0], 'A motion changes nothing; it records what is decided.'); return; }
    const d = P.def(k), r = P.rule(k);
    about.append(d.describe || '', d.why ? ` (${d.why})` : '', h('br'), `Now: `, h('code', {}, JSON.stringify(d.value)), P.isSet(k) ? '' : ' (the default)', `. Changed under the ${r.name} rule.`);
    if (k === 'deeds.transferability') about.append(h('br'), h('strong', {}, 'Switching to "never" also freezes every deed already granted as transferable.'));
    if (k === 'decision.electorate') about.append(h('br'), h('strong', {}, 'This changes who decides everything from now on. "none" freezes the entity for good.'));
    valueBox.append(h('label', { for: 'lay-value' }, k === 'entity.modules' ? 'Modules this entity runs' : 'New value'), valueInput(k, d));
    setRule(r.name, `Changing ${k} needs the ${r.name} rule.`);
  });
  queueMicrotask(() => keySel.dispatchEvent(new Event('change')));
  return h('details', {}, h('summary', {}, `Lay a ${ctx.words.proposal}`),
    h('label', { for: 'lay-title' }, 'Title'), h('input', { id: 'lay-title' }),
    h('label', { for: 'lay-text' }, 'What it says'), h('textarea', { id: 'lay-text', style: 'font-family:inherit' }),
    h('label', { for: 'lay-key' }, 'What it changes'), keySel, about, valueBox,
    h('label', { for: 'lay-rule' }, 'Made under the rule'), ruleSel, ruleWhy,
    h('div', { class: 'buttons' }, h('button', { onclick: lay }, `Sign this ${ctx.words.proposal}`)));
}

// An input that can only express what the parameter accepts.
function valueInput(k, d) {
  const cur = d.value;
  if (k === 'entity.modules') {
    return h('div', { id: 'lay-value', 'data-kind': 'modules' }, (island.installed || cur).map(m => h('label', { style: 'font-weight:400' },
      h('input', { type: 'checkbox', value: m, checked: cur.includes(m), disabled: m === 'deliberation', style: 'width:auto;margin-right:.5rem' }),
      m, m === 'deliberation' ? ' (always on)' : '')));
  }
  if (d.one_of) return h('select', { id: 'lay-value' }, d.one_of.map(v => h('option', { value: JSON.stringify(v), disabled: v === cur }, `${v}${v === cur ? ' (current)' : ''}`)));
  if (d.type === 'boolean') return h('select', { id: 'lay-value' }, [true, false].map(v => h('option', { value: String(v), disabled: v === cur }, `${v ? 'yes' : 'no'}${v === cur ? ' (current)' : ''}`)));
  if (['integer', 'number', 'fraction'].includes(d.type)) {
    return h('input', { id: 'lay-value', type: 'number', value: cur, step: d.type === 'integer' ? 1 : d.type === 'fraction' ? 0.01 : 'any',
      min: d.type === 'fraction' ? 0 : d.min, max: d.type === 'fraction' ? 1 : d.max });
  }
  if (d.type === 'list') return h('input', { id: 'lay-value', value: cur.join(', '), placeholder: 'comma-separated' });
  return h('input', { id: 'lay-value', value: cur ?? '' });
}

function readValue(k, d) {
  const el = $('#lay-value');
  if (k === 'entity.modules') return [...el.querySelectorAll('input:checked')].map(i => i.value);
  if (d.one_of) {
    const opt = el.options[el.selectedIndex];
    if (!opt || opt.disabled) throw new Error('choose a value different from the current one');
    return JSON.parse(opt.value);
  }
  if (d.type === 'boolean') { const v = el.value === 'true'; if (v === d.value) throw new Error('choose a value different from the current one'); return v; }
  if (['integer', 'number', 'fraction'].includes(d.type)) { if (el.value === '') throw new Error('enter a number'); return Number(el.value); }
  if (d.type === 'list') return el.value.split(',').map(x => x.trim()).filter(Boolean);
  return el.value;
}

async function lay() {
  const title = $('#lay-title').value.trim();
  if (!title) return alert('Give it a title.');
  const fields = { title, text: $('#lay-text').value.trim() || undefined, rule: $('#lay-rule').value };
  const k = $('#lay-key').value;
  if (k) {
    const d = ctx.params.def(k);
    let v;
    try { v = readValue(k, d); } catch (e) { return alert(e.message); }
    const why = ctx.params.check(k, v);
    if (why) return alert(why);
    fields.changes = { [k]: v };
    if (k === 'decision.electorate' && v === 'none' && !confirm('"none" freezes this entity: once enacted, nothing can ever be decided again, including undoing this. Sign it?')) return;
  }
  sign('proposal.lay', fields, `Your ${ctx.words.proposal} "${title}"`);
}

// The authority grants the signed-in member can use to carry these effects
// without a vote: in force, held by a body they belong to, and permitting every
// effect within its limits. Settlement checks it all again.
function grantsFor(effects) {
  const A = ctx.authority, p = me();
  if (!A || !p || p.status !== 'active') return [];
  const at = new Date().toISOString();
  return Object.values(ctx.state.m.authority?.grants || {}).filter(g => A.inForce(ctx.state, g.id)
    && (A.body(ctx.state, g.to, at) || []).includes(p.id)
    && effects.every(e => g.may.includes(e.kind) && (e.kind === 'authority.grant' || e.kind === 'authority.revoke' || !A.outside(g.where, e))));
}

// A small dialog with a choice of buttons. → the chosen value, or null.
function choose(title, text, options) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'choose' }, h('form', { method: 'dialog', class: 'send' }, h('h2', {}, title), h('p', {}, text),
      h('div', { class: 'row end' }, h('button', { value: '', class: 'quiet' }, 'Cancel'), options.map(([label, value, quiet]) => h('button', { value, class: quiet ? 'quiet' : null }, label)))));
    document.body.append(d);
    d.addEventListener('close', () => { resolve(d.returnValue || null); d.remove(); }, { once: true });
    d.showModal();
  });
}

// For module pages: effects carried out under a grant the member holds, if
// they choose, or else a proposal under the rule the effects need.
async function propose(title, effects, text) {
  const grants = grantsFor(effects);
  if (grants.length) {
    const g = grants[0], A = ctx.authority;
    const n = A.needed(g, ctx.state, (A.body(ctx.state, g.to, new Date().toISOString()) || []).length);
    const pick = await choose('You can do this yourself', `You hold the grant "${g.id}", which permits this without a vote${n > 1 ? `, once ${n} of its holders have signed` : ''}. Every use of a grant is published, and the members can undo it.`,
      [[`Propose it to the ${ctx.words.assembly}`, 'propose', true], [`Use the grant ${g.id}`, 'grant']]);
    if (!pick) return;
    if (pick === 'grant') return sign('authority.exercise', { grant: g.id, effects, ...(text ? { note: String(text).slice(0, 1000) } : {}) }, `Using the grant ${g.id}: ${title}`);
  }
  const e = electorate();
  if (e.frozen) return alert('This entity is frozen: nothing can be decided.');
  const act = { title, effects, text };
  const rule = E.required(ctx.params, act, ctx.registry).name;
  sign('proposal.lay', { title, text: text || undefined, rule, effects }, `Your ${ctx.words.proposal} "${title}" (${rule} rule)`);
}

// ------------------------------------------------------------------ members
function statusText(p) {
  return { active: 'active', applicant: 'applying', left: `left ${day(p.left)}`, removed: `removed ${day(p.removed)}` }[p.status] || p.status;
}

function renderMembers(path) {
  if (path[0]) return renderMember(path[0]);
  const w = ctx.words;
  const all = ctx.state.order.map(id => ctx.state.participants[id]);
  const mine = me();
  const canPropose = mine?.status === 'active' && !electorate().frozen;
  const applicants = all.filter(p => p.status === 'applicant');
  const out = [];
  if (applicants.length) {
    out.push(section('Applications', h('p', { class: 'hint' }, `Admission is by decision, under the ${ctx.params.value('membership.admission_rule')} rule.`),
      h('ul', { class: 'items' }, applicants.map(a => h('li', {}, h('h3', {}, who(a.id)), h('p', { class: 'meta' }, `applied ${when(a.joined)}${a.name ? ` as ${a.name}` : ''}`),
        (() => { const why = E.admissionProblem(ctx.registry, ctx.state, ctx.params, a.id); return h('p', { class: why ? 'flag' : 'state-carried' }, why ? why.replace(/^.*cannot be admitted yet: /, 'Not ready to admit: ') : 'Ready to admit.'); })(),
        canPropose ? h('div', { class: 'buttons' },
          h('button', { onclick: () => propose(`Admit ${a.id}`, [{ kind: 'participant.admit', id: a.id }]) }, 'Propose admitting'),
          h('button', { class: 'quiet', onclick: () => { const r = prompt(`Why decline ${a.id}? (published)`); if (r) propose(`Decline ${a.id}`, [{ kind: 'participant.remove', id: a.id, reason: r }]); } }, 'Propose declining')) : null)))));
  }
  if (!ctx.views.members) ctx.views.members = { q: '', sort: 0, f: { 0: 1 }, others: false, page: 1 };
  out.push(section(`The ${w.many}`,
    h('p', { class: 'hint' }, `${all.filter(p => p.status === 'active').length} active. Membership cannot be transferred, and anyone may leave at any time.`),
    listView({
      key: 'members', items: all, noun: w.many, head: ['Id', 'Name', 'Status', 'Joined'],
      row: (p) => h('tr', { class: mine && p.id === mine.id ? 'you' : null }, h('td', {}, link(`members/${p.id}`, p.id)), h('td', {}, nameOf(p.id) === p.id ? '' : nameOf(p.id)),
        h('td', {}, statusText(p), p.recovered ? h('span', { class: 'flag' }, ` · key recovered by decision ${p.recovered.length}×`) : ''), h('td', {}, day(p.joined))),
      text: (p) => `${p.id} ${nameOf(p.id)}`,
      pin: mine ? (p) => p.id === mine.id : null,
      sorts: [['Joined first', oldest((p) => p.joined)], ['Joined last', newest((p) => p.joined)], ['Id, A–Z', byText((p) => p.id)], ['Name, A–Z', byText((p) => nameOf(p.id))]],
      filters: [{ label: 'Status', options: [['Everyone', () => true], ['Active', (p) => p.status === 'active'], ['Not active', (p) => p.status !== 'active'],
        ['Applying', (p) => p.status === 'applicant'], ['Left', (p) => p.status === 'left'], ['Removed', (p) => p.status === 'removed']] }],
    })));
  return out;
}

function renderMember(id) {
  const p = ctx.state.participants[id];
  if (!p) return section('Not found', h('p', {}, `${id} is not on the register.`), h('p', {}, link('members', 'The register')));
  const at = ctx.state.head.at;
  const offices = Object.values(ctx.state.m.offices || {}).filter(o => o.holders.some(x => x.id === id));
  const comms = Object.values(ctx.state.m.committees || {}).filter(c => c.members.some(x => x.id === id));
  const acts = ctx.records.filter(r => r.author === id && r.payload?.act).slice(-50).reverse();
  const badges = Object.values(ctx.state.m.badges || {}).filter(b => !b.retired && b.holders[id]);
  const mine = me();
  const canPropose = mine?.status === 'active' && !electorate().frozen && (p.status === 'active' || p.status === 'applicant');
  const kids = [
    h('p', { class: 'meta' }, `${statusText(p)} · joined ${when(p.joined)}${p.admitted ? ` · admitted ${when(p.admitted)}` : ''}`),
    p.status === 'removed' ? h('p', { class: 'flag' }, `Removed by decision: ${p.reason}`) : null,
    ...(p.recovered || []).map(r => h('p', { class: 'flag' }, `Key replaced ${when(r.at)} by ${r.proposal ? `decision ${r.proposal}` : `grant ${r.via}`}: ${r.reason}. Check with ${id} that they asked for it.`)),
    badges.length ? h('p', {}, badges.map(b => h('span', { class: 'badge', title: b.description || b.title }, b.title))) : null,
    h('h3', {}, 'Keys'), h('ul', {}, p.keys.map(k => h('li', { class: 'hash' }, k))),
  ];
  if (offices.length || comms.length) {
    kids.push(h('h3', {}, 'Offices and committees'), h('ul', {},
      offices.flatMap(o => o.holders.filter(x => x.id === id).map(x => h('li', {}, `${o.title}: ${day(x.since)}–${x.until && x.until <= at ? day(x.until) : 'now'}`))),
      comms.flatMap(c => c.members.filter(x => x.id === id).map(x => h('li', {}, `${c.title} (committee): ${day(x.since)}–${x.until && x.until <= at ? day(x.until) : 'now'}`)))));
  }
  kids.push(h('h3', {}, 'Acts signed'), acts.length
    ? h('div', { class: 'scroll' }, h('table', {}, h('tbody', {}, acts.map(r => h('tr', {}, h('td', {}, link(`record/${r.seq}`, `#${r.seq}`)), h('td', {}, when(r.at)), h('td', {}, r.kind))))))
    : h('p', { class: 'hint' }, 'None.'));
  if (canPropose && id !== mine.id) {
    kids.push(h('details', {}, h('summary', {}, `Propose removing ${id}`),
      h('p', { class: 'fine' }, `Under the ${ctx.params.value('membership.removal_rule')} rule. Their past acts stay in the record; they can no longer act. The reason is published.`),
      h('label', { for: 'rm-why' }, 'Reason'), h('input', { id: 'rm-why' }),
      h('div', { class: 'buttons' }, h('button', { class: 'danger', onclick: () => { const r = $('#rm-why').value.trim(); if (!r) return alert('Give a reason.'); propose(`Remove ${id}`, [{ kind: 'participant.remove', id, reason: r }]); } }, 'Sign this proposal'))));
  }
  if (canPropose) {
    kids.push(h('details', {}, h('summary', {}, `Propose a new key for ${id}`),
      h('p', { class: 'fine' }, `For a member who lost their key, under the ${ctx.params.value('membership.recovery_rule')} rule. It replaces every key they hold, so a majority could use it to vote as someone: only paste a key ${id} gave you themselves.`),
      h('label', { for: 'rk-key' }, 'Their new public key'), h('input', { id: 'rk-key', placeholder: 'ssh-ed25519 AAAA…', spellcheck: 'false' }),
      h('label', { for: 'rk-why' }, 'Reason'), h('input', { id: 'rk-why' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => { const key = $('#rk-key').value.trim(), r = $('#rk-why').value.trim(); if (!key || !r) return alert('Give the key and a reason.'); propose(`New key for ${id}`, [{ kind: 'participant.rekey', id, key, reason: r }]); } }, 'Sign this proposal'))));
  }
  return section(nameOf(id) === id ? id : `${nameOf(id)} (${id})`, ...kids, h('p', {}, link('members', 'The register')));
}

// ------------------------------------------------------------------ record
const PAGE = 50;
function renderRecord(path) {
  if (path[0] === 'page') return recordPage();
  if (path[0]) return recordOne(Number(path[0]));
  return recordPage();
}
function checkpointsSection() {
  const need = ctx.params.value('record.checkpoint_cosigners');
  const cps = ctx.checkpoints || [];
  const p = me();
  const active = p?.status === 'active';
  const last = cps[cps.length - 1] || null;
  const head = ctx.records.length;
  const rows = cps.slice().reverse().map((c, i) => {
    const st = ctx.seal.cps[cps.length - 1 - i];
    const mine = p && st.valid.includes(p.id);
    return h('li', {}, h('h3', {}, `Checkpoint ${c.number}: the first ${c.count} records`),
      h('p', { class: st.consistent === false ? 'meta flag' : 'meta' }, st.consistent === false ? 'CONTRADICTS this record. ' : '',
        st.binding ? `binding: signed by ${st.valid.join(', ')}` : `${st.valid.length} of ${need} signatures: ${st.valid.join(', ') || 'nobody yet'}`,
        st.invalid.length ? ` · ${st.invalid.length} signature(s) not counted` : ''),
      h('p', { class: 'fine' }, 'Root ', h('span', { class: 'hash' }, c.root)),
      active && !mine && st.consistent !== false ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => signCheckpoint(c) }, 'Co-sign')) : null);
  });
  return section('Checkpoints',
    h('p', { class: 'hint' }, `A checkpoint is a signed statement of exactly what the record held at a point. It binds once ${need} members have signed it. After that, anyone presenting a different history up to there is caught, even if every copy were rewritten.`),
    cps.length ? h('ul', { class: 'items' }, rows) : h('p', { class: 'hint' }, 'No checkpoints yet.'),
    active && (!last || last.count < head) ? h('div', { class: 'buttons' }, h('button', { onclick: () => signCheckpoint(E.makeCheckpoint(ctx.records, ctx.state.entity.id, last)) }, `Make a checkpoint at record ${head}`)) : null);
}

async function signCheckpoint(cp) {
  if (ctx.ident.passkey) return alert('Checkpoint files are signed with a key or a password; sign in one of those ways to co-sign this one. (Finality checkpoints, on the Finality tab, work with a passkey.)');
  const key = await unlock(`Your signature on checkpoint ${cp.number} (the first ${cp.count} records)`); if (!key) return;
  try {
    const signedCp = await E.cosign({ ...cp, signatures: cp.signatures.filter(s => s.by !== ctx.ident.id) }, ctx.ident.id, key);
    const r = await toNode('POST', 'checkpoints', signedCp);
    alert(r.binding ? `Checkpoint ${r.number} is now binding.` : `Signed. Checkpoint ${r.number} has ${r.signed.length} of ${ctx.params.value('record.checkpoint_cosigners')} signatures.`);
    location.reload();
  } catch (e) { alert(`Not saved: ${e.message}`); }
}

// With finality: is this record after the last final checkpoint?
function provisional(seq) {
  if (!enabled('finality')) return false;
  return seq > (ctx.state.m.finality?.finals?.slice(-1)[0]?.count || 0);
}

function recordPage() {
  const total = ctx.records.length;
  const kinds = [...new Set(ctx.records.map(r => r.kind))].sort();
  const family = [...new Set(kinds.map(k => k.split('.')[0]))];
  return [checkpointsSection(), section('The record',
    h('p', { class: 'hint' }, `${total} records. The whole of it is at `, h('a', { href: 'record/events.jsonl' }, 'record/events.jsonl'), ', one record per line.'),
    listView({
      key: 'record', items: ctx.records, noun: 'records', head: ['#', 'When', 'What', 'By', 'Hash'],
      row: (r) => h('tr', { class: provisional(r.seq) ? 'provisional' : null }, h('td', {}, link(`record/${r.seq}`, r.seq)), h('td', {}, when(r.at)), h('td', {}, r.kind, provisional(r.seq) ? h('span', { class: 'category' }, 'provisional') : null), h('td', {}, who(r.author)), h('td', { class: 'hash' }, short(r.hash))),
      text: (r) => `${r.seq} ${r.kind} ${r.author || ''} ${nameOf(r.author || '')} ${r.hash}`,
      sorts: [['Newest first', (a, b) => b.seq - a.seq], ['Oldest first', (a, b) => a.seq - b.seq]],
      filters: [{ label: 'Kind', options: [['Every kind', () => true], ...family.map(f => [`${f}.*`, (r) => r.kind.split('.')[0] === f])] }],
    }))];
}
function recordOne(seq) {
  const r = ctx.records[seq - 1];
  if (!r) return section('Not found', h('p', {}, `There is no record ${seq}.`), h('p', {}, link('record', 'The record')));
  const act = r.payload?.act;
  const cause = r.payload?.cause ? ctx.records.find(x => x.payload?.act && E.actHash(x.payload.act) === r.payload.cause) : null;
  const derived = act ? ctx.records.filter(x => x.payload?.cause === E.actHash(act)) : [];
  return section(`Record ${seq}`,
    h('dl', { class: 'facts' },
      h('dt', {}, 'Kind'), h('dd', {}, r.kind),
      enabled('finality') ? [h('dt', {}, 'Finality'), h('dd', {}, provisional(seq) ? 'provisional: no final checkpoint covers it yet' : `final: covered by checkpoint ${(ctx.state.m.finality.finals.find(f => f.count >= seq) || {}).number}`)] : null,
      h('dt', {}, 'When'), h('dd', {}, when(r.at)),
      h('dt', {}, 'By'), h('dd', {}, who(r.author)),
      h('dt', {}, 'Hash'), h('dd', { class: 'hash' }, r.hash),
      h('dt', {}, 'Follows'), h('dd', {}, seq > 1 ? link(`record/${seq - 1}`, h('span', { class: 'hash' }, r.prev)) : 'nothing: the first record'),
      seq < ctx.records.length ? [h('dt', {}, 'Followed by'), h('dd', {}, link(`record/${seq + 1}`, `record ${seq + 1}`))] : null,
      cause ? [h('dt', {}, 'Written by'), h('dd', {}, link(`record/${cause.seq}`, `the ${cause.payload.act.kind} act in record ${cause.seq}`), `, part ${r.payload.part}`)] : null,
      derived.length ? [h('dt', {}, 'Wrote'), h('dd', {}, derived.map(d => link(`record/${d.seq}`, `${d.kind} (#${d.seq})`)).reduce((a, b) => [a, ', ', b]))] : null,
      act ? [h('dt', {}, 'Signed act'), h('dd', {}, act.kind, ' by ', who(act.by), `, ${when(act.at)}`)] : null,
      act ? [h('dt', {}, 'Signature'), h('dd', {}, h('details', {}, h('summary', {}, 'SSHSIG, checked on this device'), h('pre', { class: 'hash' }, act.signature)))] : null),
    h('h3', {}, 'As recorded'), h('pre', { class: 'json' }, JSON.stringify(r, (k, v) => (k === 'signature' ? '…' : v), 2)),
    h('div', { class: 'buttons' }, seq > 1 ? link(`record/${seq - 1}`, 'Previous') : null, ' ', link('record', 'The record'), ' ', seq < ctx.records.length ? link(`record/${seq + 1}`, 'Next') : null));
}

// ------------------------------------------------------------------ law
function renderLaw(path) {
  const box = section('The law', h('p', { class: 'hint' }, 'Reading the law…'));
  (async () => {
    let files = [];
    try { const r = await fetch('law/index.json', { cache: 'no-store' }); if (r.ok) files = await r.json(); } catch { /* none */ }
    const approvals = (f) => Object.values(ctx.state.proposals).filter(p => p.approved && (p.paths || []).includes(`law/${f}`));
    const kids = [h('h2', {}, 'The law'), h('p', { class: 'hint' }, 'Files under law/. The charter changes by a constitutional decision and other law by an organic one; each file lists the decisions that approved it.')];
    if (!files.length && !Object.values(ctx.state.m.wiki?.pages || {}).some(p => p.statute)) kids.push(h('p', { class: 'hint' }, 'No law is published with this copy.'));
    const open = path.join('/');
    for (const f of files) {
      const ap = approvals(f);
      const d = h('details', { open: f === open || null }, h('summary', {}, f),
        h('p', { class: 'fine' }, ap.length ? ['Approved by ', ap.map(p => link(`votes/${p.id}`, `${p.title} (${p.id})`)).reduce((a, b) => [a, ', ', b])] : 'As founded; no decision since has changed it.'));
      d.addEventListener('toggle', async () => {
        if (!d.open || d.dataset.loaded) return;
        d.dataset.loaded = '1';
        try { const r = await fetch(`law/${f}`, { cache: 'no-store' }); d.append(h('pre', { class: 'law-text' }, r.ok ? await r.text() : `(${r.status})`)); } catch (e) { d.append(h('p', { class: 'hint' }, e.message)); }
      });
      kids.push(d);
      if (d.open) d.dispatchEvent(new Event('toggle'));
    }
    const statutes = Object.values(ctx.state.m.wiki?.pages || {}).filter(p => p.statute);
    if (statutes.length) kids.push(h('h3', {}, 'Statutes enacted from the wiki'), h('ul', {}, statutes.map(p => {
      const v = p.versions[p.statute.version - 1];
      return h('li', {}, link(`wiki/${p.id}/${v.n}`, v.title), ` · version ${v.n}, in force since ${day(p.statute.at)} by ${p.statute.by}`);
    })));
    box.replaceChildren(...kids);
  })();
  return box;
}

// ------------------------------------------------------------------ settings
// Installing and upgrading modules from the page. The node fetches the code
// from the entity's module source and checks it; the member signs the
// proposal here; the members decide. Shown only on a page served by a node.
function modulesOnline() {
  if (!island.node) return null;
  const list = h('div', { id: 'mod-list' }), prepared = h('div', { id: 'mod-prepared' });
  const json = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({ error: `the node answered ${r.status}` }));
    if (!r.ok || j.error) throw new Error(j.error || `the node answered ${r.status}`);
    return j;
  };
  const prepare = async (name, mode) => {
    prepared.replaceChildren(h('p', { class: 'hint' }, `Fetching and checking ${name}…`));
    let r;
    try { r = await json('modules/prepare', { name, mode }); } catch (x) { return prepared.replaceChildren(h('p', { class: 'flag' }, x.message)); }
    if (r.info.current) return prepared.replaceChildren(h('p', { class: 'state-carried' }, `${name} is up to date: the source holds exactly the code installed here.`));
    const i = r.info;
    prepared.replaceChildren(h('div', { class: 'grant' }, h('h3', {}, r.fields.title),
      h('dl', { class: 'facts' },
        h('dt', {}, 'From'), h('dd', {}, h('code', {}, i.source)),
        h('dt', {}, 'Exact code'), h('dd', {}, h('span', { class: 'hash' }, i.digest)),
        i.replaced ? [h('dt', {}, 'Replacing'), h('dd', {}, h('span', { class: 'hash' }, i.replaced))] : null,
        i.replays ? [h('dt', {}, 'Checked'), h('dd', {}, `the whole record (${i.replays} records) replays exactly with the new code`)] : null,
        h('dt', {}, 'Files'), h('dd', {}, i.files.join(', ')),
        h('dt', {}, 'Settings'), h('dd', {}, i.settings ? `${i.settings}, starting at the defaults in its code` : 'none'),
        h('dt', {}, 'Decided by'), h('dd', {}, `the ${i.rule} rule`)),
      h('p', { class: 'hint' }, 'Read the code at its source before voting. If the proposal carries, every copy fetches exactly this code, checks it, and installs it.'),
      me()?.status === 'active' ? h('div', { class: 'buttons' }, h('button', { onclick: () => sign('proposal.lay', r.fields, r.fields.title) }, 'Sign the proposal'))
        : h('p', { class: 'hint' }, 'Sign in to propose it.')));
  };
  const load = async () => {
    list.replaceChildren(h('p', { class: 'hint' }, 'Asking the module source…'));
    let r;
    try { r = await json('modules/available'); } catch (x) { return list.replaceChildren(h('p', { class: 'flag' }, x.message)); }
    if (!r.source) return list.replaceChildren(h('p', { class: 'hint' }, 'No module source is set for this entity. Its node sets one with: entity module source github:OWNER/REPO@main'));
    list.replaceChildren(h('p', { class: 'fine' }, `From ${r.source}`), h('div', { class: 'scroll' }, h('table', {}, h('tbody', {}, r.modules.map(m => h('tr', {},
      h('td', {}, h('strong', {}, m.name), h('div', { class: 'fine' }, m.about || '')),
      h('td', {}, m.core ? `needs core ${m.core}` : ''),
      h('td', {}, m.installed ? h('button', { class: 'quiet', onclick: () => prepare(m.name, 'upgrade') }, 'Check for an update')
        : h('button', { class: 'quiet', onclick: () => prepare(m.name, 'add') }, 'Propose installing'))))))));
  };
  return section('Install or upgrade modules',
    h('p', { class: 'hint' }, 'Modules add what an entity can do. Each is installed or upgraded only by decision, pinned to the exact code the members approve.'),
    h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: load }, 'See the modules available')), list, prepared);
}

function renderSettings(path) {
  const P = ctx.params;
  const history = (k) => ctx.records.filter(r => r.kind === 'parameters.changed' && k in (r.payload.changes || {}))
    .map(r => ({ at: r.at, to: r.payload.changes[k], proposal: r.payload.proposal }));
  if (path[0]) {
    const k = path[0], d = P.def(k);
    if (!d) return section('Not found', h('p', {}, `${k} is not a setting here.`));
    const r = P.rule(k), hs = history(k);
    return section(k, h('p', {}, d.describe || ''), d.why ? h('p', { class: 'fine' }, `Why: ${d.why}`) : null,
      h('dl', { class: 'facts' }, h('dt', {}, 'Value'), h('dd', {}, h('code', {}, JSON.stringify(d.value)), P.isSet(k) ? '' : ' (the default)'),
        d.default !== undefined ? [h('dt', {}, 'Default'), h('dd', {}, h('code', {}, JSON.stringify(d.default)))] : null,
        h('dt', {}, 'Changed by'), h('dd', {}, r.changeable === false ? 'nothing: it cannot be changed' : `the ${r.name} rule`)),
      h('h3', {}, 'History'), hs.length ? h('ul', {}, hs.map(x => h('li', {}, `${when(x.at)}: set to `, h('code', {}, JSON.stringify(x.to)), ' by ', link(`votes/${x.proposal}`, x.proposal)))) : h('p', { class: 'hint' }, 'Unchanged since founding.'),
      h('p', {}, link('settings', 'Every setting')));
  }
  const groups = {};
  for (const k of P.keys()) { const d = P.def(k); (groups[d.group || 'Other'] ||= []).push([k, d]); }
  const tables = Object.entries(groups).map(([g, rows]) => h('table', {}, h('caption', {}, g),
    h('tbody', {}, rows.map(([k, d]) => {
      const r = P.rule(k);
      return h('tr', {}, h('td', {}, link(`settings/${k}`, h('code', {}, k)), d.describe ? h('div', { class: 'fine' }, d.describe) : null),
        h('td', {}, h('code', {}, JSON.stringify(d.value)), P.isSet(k) ? '' : h('div', { class: 'fine' }, 'default')),
        h('td', {}, r.changeable === false ? `unchangeable${d.why ? `: ${d.why}` : ''}` : `by ${r.name}`));
    }))));
  const ruleRows = [...P.ruleOrder(), ...Object.keys(P.rules).filter(n => P.rules[n].changeable === false)].map(n => { const r = P.rules[n];
    return h('tr', {}, h('td', {}, n), h('td', {}, r.changeable === false ? 'cannot be changed' :
      `${Math.round(r.quorum * 100)}% must vote; ${Math.round(r.threshold * 100)}% of decisive votes; ${r.readings} reading${r.readings > 1 ? `s, ${r.apart} days apart` : ''}`)); });
  const mods = ctx.state.modules || {};
  const modRows = ['deliberation', ...Object.keys(mods).sort()].map(m => h('tr', {},
    h('td', {}, m), h('td', {}, enabled(m) || m === 'deliberation' ? 'on' : 'off'),
    h('td', {}, m === 'deliberation' ? 'the core' : [h('span', { class: 'hash' }, short(mods[m].digest)), ` from ${mods[m].source}`,
      mods[m].history?.length ? h('div', { class: 'fine' }, `upgraded ${mods[m].history.length}×; installed ${day(mods[m].at)} by ${mods[m].by}`) : h('div', { class: 'fine' }, `installed ${day(mods[m].at)} by ${mods[m].by}`)])));
  return [section('Settings',
    h('p', {}, decidesText()),
    h('div', { class: 'scroll' }, h('table', {}, h('caption', {}, 'Modules, and the exact code each runs'), h('tbody', {}, modRows)))),
  modulesOnline(),
  codeSection(),
  section('Every setting',
    h('p', { class: 'hint' }, 'These values are read from the record, which is the only place they live. A value marked default stands at what its module\'s code declares.'),
    h('div', { class: 'controls' }, h('input', { type: 'search', class: 'find', placeholder: 'Search settings', 'aria-label': 'Search settings', oninput: (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const t of e.target.closest('section').querySelectorAll('table')) {
        let any = false;
        for (const tr of t.querySelectorAll('tbody tr')) { const hit = !q || tr.textContent.toLowerCase().includes(q); tr.hidden = !hit; any ||= hit; }
        t.hidden = !any;
      }
    } })),
    h('div', { class: 'scroll' }, h('table', {}, h('caption', {}, 'How decisions are made'), h('tbody', {}, ruleRows))),
    h('div', { class: 'scroll' }, tables)),
  lookSection()];
}

// ------------------------------------------------------------------ looks
// How this page looks in this browser. A viewer's own choice: stored here, not
// in the record, and it changes nothing for anyone else.
const LOOKS = [['classic', 'Classic', 'Paper and ink.'], ['schoolbook', 'Schoolbook', 'The house style of tschoonover.com: Helvetica, hairlines, Century Schoolbook headings.'], ['terminal', 'Terminal', 'Dark, monospaced, phosphor green.'], ['minimal', 'Minimal', 'Plain type, lots of space, nothing extra: the default.']];
const COLOURS = [['system', 'As the system'], ['light', 'Light'], ['dark', 'Dark']];
function applyLook() {
  let look = (typeof island !== 'undefined' && island.look) || 'minimal', colour = (typeof island !== 'undefined' && island.colour) || 'dark';
  try { look = localStorage.getItem('entity:look') || look; colour = localStorage.getItem('entity:colour') || colour; } catch { /* storage off */ }
  const root = document.documentElement;
  root.dataset.look = look;
  if (colour === 'system') delete root.dataset.theme; else root.dataset.theme = colour;
  return { look, colour };
}
function lookSection() {
  const cur = applyLook();
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } applyLook(); refresh(); };
  return section('How this page looks',
    h('p', { class: 'hint' }, 'Your choice, kept in this browser. It changes nothing in the record, and nothing for anyone else.'),
    h('div', { class: 'looks' }, LOOKS.map(([id, name, what]) => h('button', { class: `look-card${id === cur.look ? ' chosen' : ''}`, 'data-preview': id, 'aria-pressed': String(id === cur.look), onclick: () => set('entity:look', id) },
      h('strong', {}, name), h('span', {}, what)))),
    h('div', { class: 'buttons', role: 'group', 'aria-label': 'Colours' }, COLOURS.map(([id, name]) =>
      h('button', { class: id === cur.colour ? '' : 'quiet', 'aria-pressed': String(id === cur.colour), onclick: () => set('entity:colour', id) }, name))));
}

// The core's own version, and upgrading it by decision through the node.
function codeSection() {
  const box = section('The code', h('p', { class: 'hint' }, 'Asking the node…'));
  (async () => {
    let u;
    try { u = await toNode('GET', 'upgrade'); }
    catch (e) { box.replaceChildren(h('h2', {}, 'The code'), h('p', { class: 'hint' }, `Upgrades go through a node: ${e.message}.`)); return; }
    const p = me(), active = p?.status === 'active';
    const kids = [h('h2', {}, 'The code'), h('p', {}, `This node runs entity ${u.current}. The core changes only by decision: a proposal approves exactly the new files, by their digest, and only then can they be installed.`)];
    if (!u.source) kids.push(h('p', { class: 'hint' }, 'No upgrade source is set on this node. Add "upgrade": { "source": "dir:~/entities/entity" } (or github:OWNER/REPO@main) to its node.json.'));
    const m = u.staged;
    if (m) {
      const open = Object.values(ctx.state.proposals).find(x => !x.closed && x.digest === m.digest);
      kids.push(h('div', { class: 'grant' },
        h('h3', {}, `entity ${m.version}, from ${m.pinned}`),
        h('p', { class: 'meta' }, `${m.paths.length} file(s) change · checked ${when(m.checked)} · digest `, h('span', { class: 'hash' }, short(m.digest))),
        h('p', { class: m.replays ? 'state-carried' : 'state-failed' }, m.replays ? 'This entity\'s record replays byte for byte with the new code.' : 'This entity\'s record does NOT replay with the new code. It must not be installed.'),
        h('details', {}, h('summary', {}, 'The files'), h('ul', {}, m.paths.map(f => h('li', { class: 'hash' }, f)))),
        u.approvedBy ? [h('p', {}, 'Approved by ', link(`votes/${u.approvedBy}`, u.approvedBy), '.'),
          h('div', { class: 'buttons' }, h('button', { onclick: async () => {
            if (!confirm(`Install entity ${m.version} on this node now?`)) return;
            try { const r = await toNode('POST', 'upgrade/apply'); alert(`Installed entity ${r.version}, permitted by ${r.decision}. Restart the node (stop \`entity serve\` and start it again) to run it.`); location.reload(); }
            catch (e) { alert(`Not installed: ${e.message}`); }
          } }, 'Install it'))]
          : open ? h('p', {}, 'Proposed: ', link(`votes/${open.id}`, open.title), '. It can be installed once that carries.')
          : active && m.replays ? h('div', { class: 'buttons' }, h('button', { onclick: () => sign('proposal.lay', u.proposal, `Your proposal to upgrade to entity ${m.version} (${u.proposal.rule} rule)`) }, `Propose upgrading to ${m.version}`)) : null));
    }
    if (u.source && active) kids.push(h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Fetching and replaying the record…';
      try { const r = await toNode('POST', 'upgrade/check'); if (!r.staged) alert(`This node already runs the latest code from ${u.source}.`); refresh(); }
      catch (e) { alert(e.message); refresh(); }
    } }, 'Check for a new version')));
    box.replaceChildren(...kids);
  })();
  return box;
}

boot().catch(e => fatal('Something failed while checking the record', e.message));
