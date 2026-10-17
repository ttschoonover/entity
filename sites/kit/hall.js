// hall.js · every institution of the entity. Its members, its proposals and the
// record are drawn here; every other tab is a module the Assembly installed,
// drawing itself through its own ui.js. A module installed tomorrow appears
// here tomorrow, with no change to this site.
//
//   hall.html#/members[/ID]   hall.html#/proposals[/ID]   hall.html#/record
//   (named in the entity's own words: #/citizens and #/bills in the VDR)
//   hall.html#/<module>/…      whatever the module draws
import { start, onChange, onSigned, ctx, h, $, day, when, me, isCitizen, nameOf, displayName, sign, moduleApi, listView, institutionTitle, INSTITUTIONS, enabled, W, SITE } from './common.js';

const ORDER = SITE.order.length ? SITE.order : ['elections', 'offices', 'committees', 'polls', 'meetings', 'wiki', 'badges', 'authority'];
let tabs = [];
const PLUMBING = new Set(['deliberation', 'titles', 'vocabulary', 'passwords', 'passkeys', 'page', 'republic']); // no page of their own

// ── the entity's own tabs ────────────────────────────────────────────────
const link = (path, ...kids) => {
  const [first, ...rest] = String(path).split('/');
  if (first === 'law') return h('a', { href: 'laws.html' }, ...kids);
  const map = { members: PEOPLE(), citizens: PEOPLE(), votes: BILLS(), bills: BILLS(), proposals: BILLS() };
  return h('a', { href: `#/${[map[first] || first, ...rest].join('/')}` }, ...kids);
};
const go = (path) => { location.hash = `#/${path}`; };
// The tabs for people and proposals, named as the entity names them.
const PEOPLE = () => W().many.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const BILLS = () => W().proposals.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function citizens(api, path) {
  const st = ctx.r.state;
  if (path[0]) return citizen(path[0]);
  const people = st.order.map(id => st.participants[id]);
  const offices = ctx.r.get('offices');
  const held = (id) => offices.filter(o => o.holders.some(x => x.id === id)).map(o => o.title);
  const w = W(), applicants = people.filter(p => p.status === 'applicant');
  return h('section', {}, h('h2', {}, w.Many),
    h('p', { class: 'hint' }, `${((n) => `${n} ${n === 1 ? w.one : w.many}`)(people.filter(p => p.status === 'active').length)}. Each has one vote, and signs everything they do with their own key.`),
    applicants.length ? applying(applicants) : null,
    listView({ key: 'citizens', items: people, noun: w.many, empty: 'No one yet.',
      text: (p) => `${p.id} ${displayName(p.id)} ${held(p.id).join(' ')}`,
      sorts: [['Longest standing', (a, b) => (a.joined < b.joined ? -1 : 1)], ['Newest', (a, b) => (a.joined < b.joined ? 1 : -1)], ['Name', (a, b) => nameOf(a.id).localeCompare(nameOf(b.id))]],
      filters: [{ label: 'Status', options: [[w.Many, (p) => p.status === 'active'], ['Everyone who has applied or joined', () => true], ['Applying', (p) => p.status === 'applicant'], ['Left or removed', (p) => p.status === 'left' || p.status === 'removed']] }],
      mine: me() ? (p) => p.id === me().id : null,
      row: (p) => h('tr', { class: me()?.id === p.id ? 'you' : null }, h('td', {}, link(`${PEOPLE()}/${p.id}`, displayName(p.id))), h('td', { class: 'fine' }, held(p.id).join(', ') || ''), h('td', { class: 'fine' }, p.status === 'active' ? `since ${day(p.admitted || p.joined)}` : p.status)),
      head: [w.One, 'Office', 'Standing'] }));
}

// Applicants waiting to be admitted: what they still have to sign, and a
// proposal to admit them (participant.admit, under membership.admission_rule).
function applying(list) {
  const w = W(), A = ctx.agreements, P = ctx.r.params, st = ctx.r.state;
  const owes = (id) => (A && enabled('agreements') ? A.outstanding(st, id, P) : []);
  return h('div', { class: 'notice' }, h('h3', {}, `Applying to join (${list.length})`),
    h('ul', { class: 'items' }, list.map(p => { const o = owes(p.id); return h('li', {}, link(`${PEOPLE()}/${p.id}`, displayName(p.id)), h('span', { class: 'fine' }, ` · applied ${day(p.joined)}${o.length ? ` · ${o.join('; ')}` : ''}`),
      isCitizen() && !o.length ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', type: 'button', onclick: () => moduleApi({ link, go, refresh: draw }).propose(`Admit ${displayName(p.id)}`, [{ kind: 'participant.admit', id: p.id }]) }, `Propose admitting ${nameOf(p.id)}`)) : null); })),
    h('p', { class: 'fine' }, `The ${w.assembly} admits new ${w.many} by vote. Anyone may propose it once an applicant has signed what joining requires.`));
}

function citizen(id) {
  const st = ctx.r.state, p = st.participants[id];
  if (!p) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `No one has the id ${id}. `, link(PEOPLE(), `All ${W().many}`)));
  const offices = ctx.r.get('offices').filter(o => o.holders.some(x => x.id === id)).map(o => o.title);
  const comms = ctx.r.get('committees').filter(c => c.members.includes(id)).map(c => c.title);
  const honours = Object.values(st.m.badges || {}).filter(b => !b.retired && b.holders[id]);
  const ballots = Object.values(st.proposals).flatMap(b => b.ballots.filter(x => x.by === id).map(x => ({ ...x, bill: b })));
  const laid = Object.values(st.proposals).filter(b => b.by === id);
  return h('section', {}, h('p', { class: 'crumbs' }, link(PEOPLE(), W().Many), ' › ', displayName(id)),
    h('h2', {}, nameOf(id)), nameOf(id) !== id ? h('p', { class: 'meta' }, `Id: ${id}`) : null,
    h('dl', { class: 'facts' },
            h('dt', {}, 'Standing'), h('dd', {}, p.status === 'active' ? `${W().One} since ${day(p.admitted || p.joined)}` : p.status === 'applicant' ? `Applied ${day(p.joined)}` : p.status),
      offices.length ? [h('dt', {}, 'Office'), h('dd', {}, offices.join(', '))] : null,
      comms.length ? [h('dt', {}, 'Serves on'), h('dd', {}, comms.join(', '))] : null,
      honours.length ? [h('dt', {}, 'Honours'), h('dd', {}, honours.map(b => h('span', { class: 'badge' }, b.title)))] : null,
      h('dt', {}, 'Votes cast'), h('dd', {}, String(new Set(ballots.map(b => b.bill.id)).size)),
      h('dt', {}, `${W().Proposals} laid`), h('dd', {}, String(laid.length))),
    laid.length ? [h('h3', {}, `${W().Proposals} laid`), h('ul', { class: 'items' }, laid.slice().reverse().slice(0, 20).map(b => h('li', {}, link(`${BILLS()}/${b.id}`, b.title), h('p', { class: 'meta' }, `${day(b.at)} · ${status(b)}`))))] : null);
}

const status = (b) => (!b.closed ? `open until ${day(b.deadline)}` : b.closed.carried ? (b.enacted ? 'passed' : 'passed, needs a second vote') : 'rejected');
const describe = (e) => { try { return ctx.registry.effects.get(e.kind)?.describe?.(e) || e.kind; } catch { return e.kind; } };
const choiceWord = { for: 'for', against: 'against', abstain: 'abstained' };

function bills(api, path) {
  if (path[0]) return oneBill(path[0]);
  const all = Object.values(ctx.r.state.proposals);
  const w = W();
  return h('section', {}, h('h2', {}, w.Proposals),
    h('p', { class: 'hint' }, `Everything put to a vote of all ${w.many}, open or decided. You can vote on open ${w.proposals} here or on the `, h('a', { href: 'index.html' }, 'home page'), '.'),
    listView({ key: 'bills', items: all, noun: w.proposals, empty: `No ${w.proposals} yet.`,
      text: (b) => `${b.title} ${b.text || ''} ${displayName(b.by)} ${(b.effects || []).map(describe).join(' ')}`,
      sorts: [['Newest first', (a, b) => (a.at < b.at ? 1 : -1)], ['Oldest first', (a, b) => (a.at < b.at ? -1 : 1)]],
      filters: [{ label: 'Status', options: [['Open and decided', () => true], ['Open', (b) => !b.closed], ['Passed', (b) => b.closed?.carried], ['Rejected', (b) => b.closed && !b.closed.carried]] }],
      pin: (b) => !b.closed,
      render: (b) => { const t = ctx.r.get('proposals').find(x => x.id === b.id) || b.closed?.tally || {};
        return h('li', {}, h('h3', {}, link(`${BILLS()}/${b.id}`, b.title)), h('p', { class: 'meta' }, `proposed by ${displayName(b.by)} · ${day(b.at)} · ${b.rule} rule · ${status(b)} · ${t.for ?? 0} for, ${t.against ?? 0} against, ${t.abstain ?? 0} abstaining`)); } }));
}

function oneBill(id) {
  const b = ctx.r.state.proposals[id];
  if (!b) return h('section', {}, h('h2', {}, 'Not found'), link(BILLS(), `All ${W().proposals}`));
  const live = ctx.r.get('proposals').find(x => x.id === id);
  const t = live || b.closed?.tally || {};
  const roll = new Set(b.roll || []), latest = new Map();
  for (const x of [...b.ballots].sort((p, q) => (p.at < q.at ? -1 : 1))) latest.set(x.by, x);
  const mine = me() && latest.get(me().id);
  return h('section', {}, h('p', { class: 'crumbs' }, link(BILLS(), W().Proposals), ' › ', id),
    h('h2', {}, b.title),
    h('p', { class: 'meta' }, `Proposed by `, link(`${PEOPLE()}/${b.by}`, displayName(b.by)), ` on ${when(b.at)} under the ${b.rule} rule · ${status(b)}`),
    b.text ? h('div', { class: 'post-body serif' }, b.text) : null,
    (b.effects || []).length || Object.keys(b.changes || {}).length ? [h('h3', {}, 'If it passes'), h('ul', {}, (b.effects || []).map(e => h('li', {}, describe(e))), Object.entries(b.changes || {}).map(([k, v]) => h('li', {}, `Set ${k} to ${JSON.stringify(v)}`)))] : h('p', { class: 'fine' }, `A resolution. It records what the ${W().many} think and changes nothing by itself.`),
    h('h3', {}, 'Votes'),
    h('p', { class: 'tally-line' }, h('strong', {}, String(t.for ?? 0)), ' for · ', h('strong', {}, String(t.against ?? 0)), ' against · ', h('strong', {}, String(t.abstain ?? 0)), ` abstaining · of ${roll.size} on the roll`),
    !b.closed && isCitizen() && roll.has(me().id) ? h('div', { class: 'buttons' }, ['for', 'against', 'abstain'].map(c => h('button', { class: mine?.choice === c ? 'primary' : 'secondary', type: 'button', onclick: () => sign('ballot.cast', { proposal: id, choice: c }, `Your vote ${c === 'abstain' ? 'to abstain on' : c} "${b.title}"`) }, c === 'abstain' ? 'Abstain' : `Vote ${c}`))) : null,
    !b.closed && isCitizen() && !roll.has(me().id) ? h('p', { class: 'fine' }, `You joined after this ${W().proposal} opened, so you can vote from the next one.`) : null,
    h('h3', {}, 'Ballots'),
    latest.size ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, W().One), h('th', {}, 'Vote'), h('th', {}, 'Signed'))),
      h('tbody', {}, [...latest.values()].map(x => h('tr', {}, h('td', {}, link(`${PEOPLE()}/${x.by}`, displayName(x.by))), h('td', {}, roll.has(x.by) ? choiceWord[x.choice] : `${choiceWord[x.choice]} (not counted: joined after the ${W().proposal} opened)`), h('td', { class: 'fine' }, when(x.at))))))) : h('p', { class: 'fine' }, 'No ballots yet.'));
}

function record() {
  const recs = ctx.r.records.slice().reverse();
  return h('section', {}, h('h2', {}, 'The record'),
    h('p', { class: 'hint' }, `Everything that has happened in ${W().body}, newest first. ${ctx.r.records.length} records, each signed by the person who made it and linked to the one before, so none can be changed without it showing. This browser has checked them all. `, h('a', { href: 'record/events.jsonl' }, 'Download the record'), '.'),
    listView({ key: 'record', items: recs, noun: 'records', size: 30,
      text: (x) => `${x.kind} ${x.author ? displayName(x.author) : ''}`,
      row: (x) => h('tr', {}, h('td', { class: 'fine' }, when(x.at)), h('td', {}, x.author ? displayName(x.author) : ''), h('td', {}, h('code', {}, x.kind)), h('td', {}, h('span', { class: 'hash' }, String(x.hash).slice(0, 12)))),
      head: ['When', 'By', 'Act', 'Hash'] }));
}

// ── modules: what is installed, and what can be added ─────────────────────
// Offices and committees are abolished or dissolved from their own tabs; this
// tab adds and removes whole modules, each by a bill.
const CORE = new Set(['deliberation']);
function modules() {
  const st = ctx.r.state, P = ctx.r.params;
  const can = isCitizen();
  const json = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({ error: `the server answered ${r.status}` }));
    if (!r.ok || j.error) throw new Error(j.error || `the server answered ${r.status}`);
    return j;
  };
  const pending = Object.values(st.proposals).filter(b => !b.closed && (b.install?.length || b.changes?.['entity.modules']));
  const available = h('div', {}, h('p', { class: 'hint' }, 'Checking what can be added…'));
  (async () => {
    let r;
    try { r = await json('modules/available'); } catch (x) { return available.replaceChildren(h('p', { class: 'hint' }, `The list could not be loaded (${x.message}). New modules can still be proposed from the server: entity module add NAME.`)); }
    if (!r.source) return available.replaceChildren(h('p', { class: 'hint' }, 'No module source is set up, so there is nothing to add yet.'));
    const fresh = r.modules.filter(m => !m.installed);
    available.replaceChildren(fresh.length ? h('ul', { class: 'items' }, fresh.map(m => h('li', {},
      h('h3', {}, institutionTitle(m.name), h('span', { class: 'category' }, m.name)),
      h('p', { class: 'meta' }, INSTITUTIONS[m.name]?.[1] || m.description || ''),
      can ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', type: 'button', onclick: async (ev) => {
        ev.target.disabled = true; ev.target.textContent = 'Checking its code…';
        try { const x = await json('modules/prepare', { name: m.name, mode: 'add' }); await sign('proposal.lay', x.fields, x.fields.title); }
        catch (e) { alert(e.message); }
        ev.target.disabled = false; ev.target.textContent = 'Propose adding it';
      } }, 'Propose adding it')) : null))) : h('p', { class: 'hint' }, 'Everything on offer is already installed.'));
  })();
  const installed = P.value('entity.modules').filter(m => !CORE.has(m));
  const remove = (m) => {
    const reason = prompt(`Propose removing ${institutionTitle(m)}?\n\nIts history stays on the record; it only stops being used.\n\nWhy? (optional, published with the ${W().proposal})`);
    if (reason === null) return;
    const next = P.value('entity.modules').filter(x => x !== m);
    sign('proposal.lay', { title: `Remove ${institutionTitle(m)} (the ${m} module)`, rule: P.rule('entity.modules').name, changes: { 'entity.modules': next }, ...(reason.trim() ? { text: reason.trim() } : {}) }, `Your ${W().proposal} to remove ${institutionTitle(m)}`);
  };
  return h('section', {}, h('h2', {}, 'Modules'),
    h('p', { class: 'hint' }, `Each part of ${W().body} is a module the ${W().many} voted to install, and they can vote to remove it. To abolish an office or dissolve a committee, use the button on it under Offices or Committees.`),
    pending.length ? [h('h3', {}, 'Being voted on'), h('ul', { class: 'items' }, pending.map(b => h('li', {}, link(`bills/${b.id}`, b.title), h('p', { class: 'meta' }, `open until ${day(b.deadline)}`))))] : null,
    h('h3', {}, 'Installed'),
    h('ul', { class: 'items' }, installed.map(m => h('li', {}, h('strong', {}, institutionTitle(m)), h('span', { class: 'category' }, m),
      INSTITUTIONS[m] ? h('p', { class: 'meta' }, INSTITUTIONS[m][1]) : null,
      can ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', type: 'button', onclick: () => remove(m) }, 'Propose removing it')) : null))),
    h('h3', {}, 'Available to add'), available,
    me() && !can ? h('p', { class: 'fine' }, `Only ${W().many} can propose changes.`) : null);
}

// ── tabs: the entity's own, then every installed module's ────────────────
async function collectTabs() {
  const out = [{ id: PEOPLE(), title: W().Many, render: citizens }, { id: BILLS(), title: W().Proposals, render: bills }];
  const mods = ctx.r.params.value('entity.modules').slice().sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  for (const m of mods) {
    if (PLUMBING.has(m)) continue;
    let mod;
    try { mod = await import(`${ctx.r.base}modules/${m}/ui.js`); } catch { continue; } // from the node of the entity shown
    if (Array.isArray(mod.tabs)) for (const t of mod.tabs) out.push({ ...t, title: t.id === m ? institutionTitle(m) : t.title, module: m });
    else if (typeof mod.default === 'function') out.push({ id: m, title: institutionTitle(m), module: m, render: (api) => mod.default(api) });
  }
  out.push({ id: 'record', title: 'The record', render: record }, { id: 'modules', title: 'Modules', render: modules });
  return out;
}

function draw() {
  if (!ctx.r.ok) { $('#view').replaceChildren(h('p', { class: 'empty' }, 'The record did not verify, so nothing is shown.')); return; }
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  if (path[0] === 'manage') path[0] = 'modules';
  if (['citizens', 'members', 'people'].includes(path[0])) path[0] = PEOPLE();
  if (['bills', 'proposals', 'votes'].includes(path[0])) path[0] = BILLS();
  const tab = tabs.find(t => t.id === (path[0] || '')) || tabs[0];
  $('#tabs').replaceChildren(...tabs.map(t => h('a', { href: `#/${t.id}`, 'aria-current': t === tab ? 'page' : null }, t.title)));
  const intro = null; // each institution introduces itself
  let el;
  try { el = tab.render(moduleApi({ link, go, refresh: draw }), path.slice(1)); }
  catch (e) { el = h('section', {}, h('p', { class: 'hint' }, `This page could not be shown: ${e.message}`)); console.error(e); }
  const view = $('#view');
  view.replaceChildren(...[intro].concat(el).filter(Boolean));
  if (!me()) view.append(h('p', { class: 'fine sign-hint' }, 'Sign in at the top of the page to vote, stand for office or take part. ', h('a', { href: 'index.html#join' }, `New here? Join ${W().body}.`)));
  $('#tabs a[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}
const busy = () => { const a = document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#view').contains(a)) || [...document.querySelectorAll('#view details[open]')].some(d => d.querySelector('input:not([type=checkbox]):not([type=radio]), textarea')); };

onSigned(() => draw());
await start();
if (ctx.r.ok) tabs = await collectTabs();
draw();
let last = location.hash;
addEventListener('hashchange', () => { const a = last.split('/')[1], b = location.hash.split('/')[1]; last = location.hash; draw(); if (a !== b) window.scrollTo({ top: 0 }); });
onChange(async () => {
  const mods = ctx.r.params.value('entity.modules').join();
  if (mods !== tabs.mods) { tabs = await collectTabs(); tabs.mods = mods; }
  if (!busy() && !document.querySelector('dialog[open]')) draw();
});
tabs.mods = ctx.r.ok ? ctx.r.params.value('entity.modules').join() : '';
