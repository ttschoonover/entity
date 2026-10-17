// laws.js · the statute book of a relational legal system (the laws module).
// Every law has a type, tags, and the bodies that enforce it and on whom; you
// can find any law by any of them. Laws are made by Parliament or referendum.
//
//   laws.html                 the statute book
//   laws.html#law/ID[/N]      a law (version N), with its history and changes
//   laws.html#type/T  #tag/X  #body/office:president   laws related to each
//   laws.html#new  #amend/ID  draft a law or an amendment
//   laws.html#rules           the types of law and the rules they need
//   laws.html#settings        every setting, its majority and the law that governs it
import { start, onChange, onSigned, ctx, h, $, day, when, me, isCitizen, nameOf, renderText, moduleApi, enabled } from './common.js';

let L, UI; // the laws module and its ui (bodies, lawForm)
const CONST = 'constitution';
const state = () => ctx.r.state, params = () => ctx.r.params;
const all = () => Object.values(state().m.laws?.laws || {});
const lawOf = (id) => state().m.laws?.laws?.[id] || null;
const bills = () => Object.values(state().m.laws?.bills || {});
const typeTitle = (id) => L.typeOf(params(), id)?.title || id;
const typeLine = (l) => `${typeTitle(l.type)}${l.level ? ` · ${typeTitle(l.level)} level` : ''}`;
const body = (x) => UI.bodyName(state(), x);
const viaText = (via) => {
  const m = String(via).match(/^(?:referendum on )?parliament ([a-z0-9-]+)(?::? ?(.*))?$/);
  if (/^parliament /.test(via)) return ['Parliament, ', h('a', { href: `hall.html#/parliament/${via.split(' ')[1]}` }, `bill ${via.split(' ')[1]}`)];
  if (/^referendum on parliament/.test(via) && m) return ['referendum on Parliament’s ', h('a', { href: `hall.html#/parliament/${m[1]}` }, `bill ${m[1]}`)];
  const d = String(via).match(/decision (d-[0-9a-f]+)/);
  return d ? ['referendum, ', h('a', { href: `hall.html#/bills/${d[1]}` }, 'the citizens’ vote')] : [String(via)];
};
const link = (href, ...kids) => h('a', { href }, ...kids);
const chip = (href, text) => h('a', { class: 'chip', href }, text);

// ── the index ──────────────────────────────────────────────────────────────
function drawIndex(route) {
  const laws = all().filter(L.inForce);
  const tags = [...new Set(laws.flatMap(l => l.tags))].sort();
  const T = L.types(params());
  const cur = (href) => (route === href ? 'page' : null);
  const B = UI.bodies(state()).filter(([id]) => laws.some(l => [...l.enforcers, ...l.subjects].includes(id)));
  const pending = bills().filter(b => ['open', 'window', 'referendum'].includes(b.status)).length;
  $('#law-index').replaceChildren(...[
    link('#', 'The statute book'),
    h('h2', {}, 'By type'),
    h('ul', {}, T.map(t => h('li', {}, h('a', { href: `#type/${t.id}`, 'aria-current': cur(`type/${t.id}`) }, t.title), h('span', { class: 'sub' }, `${laws.filter(l => l.type === t.id || l.level === t.id).length} in force`)))),
    tags.length ? [h('h2', {}, 'By tag'), h('p', { class: 'chips' }, tags.map(t => h('a', { class: 'chip', href: `#tag/${encodeURIComponent(t)}`, 'aria-current': cur(`tag/${t}`) }, t)))] : null,
    B.length ? [h('h2', {}, 'By body'), h('ul', {}, B.map(([id, label]) => h('li', {}, h('a', { href: `#body/${id}`, 'aria-current': cur(`body/${id}`) }, label))))] : null,
    h('h2', {}, 'Making law'),
    h('ul', {}, h('li', {}, link('hall.html#/parliament', 'Parliament'), pending ? h('span', { class: 'sub' }, `${pending} bill${pending === 1 ? '' : 's'} pending`) : null),
      h('li', {}, h('a', { href: '#new', 'aria-current': cur('new') }, 'Draft a law')),
      h('li', {}, h('a', { href: '#settings', 'aria-current': cur('settings') }, 'Every setting')),
      h('li', {}, h('a', { href: '#rules', 'aria-current': cur('rules') }, 'Types and rules')))].flat().filter(Boolean));
  $('#law-index').firstChild.className = 'book';
}

const card = (l) => h('li', {}, h('h3', {}, link(`#law/${l.id}`, l.title)),
  h('p', { class: 'meta' }, `${typeLine(l)} · ${l.status === 'in force' ? `in force since ${day(l.since)}` : `repealed ${day(l.repealed?.at)}`}${l.versions.length > 1 ? ` · ${l.versions.length - 1} amendment${l.versions.length > 2 ? 's' : ''}` : ''}`),
  h('p', { class: 'chips' }, l.tags.map(t => chip(`#tag/${encodeURIComponent(t)}`, t))),
  l.versions.at(-1).text ? h('p', { class: 'excerpt' }, excerpt(l.versions.at(-1).text)) : h('p', { class: 'excerpt' }, Object.entries(l.versions.at(-1).changes || {}).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(' · ')));
const excerpt = (body, n = 200) => { const t = String(body).replace(/^#+\s.*$/gm, '').replace(/^\s*(\d+\.|[-*])\s+/gm, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; };

function drawBook() {
  const c = lawOf(CONST), T = L.types(params());
  const laws = all().filter(l => L.inForce(l) && l.id !== CONST);
  const pending = bills().filter(b => ['open', 'window', 'referendum'].includes(b.status));
  return [
    c && L.inForce(c) ? h('article', { class: 'featured' },
      h('p', { class: 'kicker' }, `Fundamental law · ${typeLine(c)}`),
      h('h2', {}, link(`#law/${CONST}`, c.title)),
      h('p', { class: 'excerpt serif' }, excerpt(c.versions.at(-1).text.split(/\n\s*\n/)[0], 420)),
      h('ol', { class: 'toc' }, renderText(c.versions.at(-1).text, { anchors: 'a' }).heads.map(x => h('li', {}, link(`#law/${CONST}/@${x.id}`, x.text)))),
      h('p', { class: 'meta' }, `Version ${c.versions.length}, in force since ${day(c.since)}. Enforced by ${c.enforcers.map(body).join(' and ')}.`)) : null,
    pending.length ? h('section', { class: 'book-section' }, h('h2', {}, 'In progress'), h('ul', { class: 'law-list' }, pending.map(b => h('li', {},
      h('h3', {}, link(`hall.html#/parliament/${b.id}`, b.action === 'repeal' ? `Repeal of ${lawOf(b.law)?.title || b.law}` : b.title)),
      h('p', { class: 'meta' }, { open: `In Parliament, open until ${day(b.closes)}`, window: `Passed by Parliament. Takes effect ${day(b.window)} unless citizens petition for a referendum`, referendum: 'Waiting for a referendum' }[b.status]))))) : null,
    ...T.map(t => { const list = laws.filter(l => l.type === t.id); return list.length ? h('section', { class: 'book-section' }, h('h2', {}, `${t.title} laws`), h('p', { class: 'fine' }, t.describe || ''), h('ul', { class: 'law-list' }, list.sort((a, b) => a.title.localeCompare(b.title)).map(card))) : null; }),
    !laws.length ? h('p', { class: 'empty' }, 'No laws yet apart from the Constitution. Any citizen can draft one.') : null,
    h('p', {}, h('a', { class: 'primary', href: '#new', style: 'text-decoration:none;display:inline-block' }, 'Draft a law')),
  ];
}

function drawFiltered(kind, value) {
  const title = { type: `${typeTitle(value)} laws`, tag: `Laws tagged “${value}”`, body: `Laws involving ${body(value)}` }[kind];
  const match = { type: (l) => l.type === value || l.level === value, tag: (l) => l.tags.includes(value), body: (l) => l.enforcers.includes(value) || l.subjects.includes(value) }[kind];
  const laws = all().filter(match);
  const inforce = laws.filter(L.inForce), gone = laws.filter(l => !L.inForce(l));
  const kids = [h('p', { class: 'crumbs' }, link('#', 'The statute book'), ' › ', { type: 'By type', tag: 'By tag', body: 'By body' }[kind]), h('h2', { class: 'law-title' }, title)];
  if (kind === 'type') kids.push(h('p', { class: 'lede-sm' }, L.typeOf(params(), value)?.describe || ''));
  if (kind === 'body') {
    const enf = inforce.filter(l => l.enforcers.includes(value)), sub = inforce.filter(l => l.subjects.includes(value));
    kids.push(h('section', { class: 'book-section' }, h('h2', {}, `Enforced by ${body(value)}`), enf.length ? h('ul', { class: 'law-list' }, enf.map(card)) : h('p', { class: 'empty' }, 'None.')),
      h('section', { class: 'book-section' }, h('h2', {}, `Applies to ${body(value)}`), sub.length ? h('ul', { class: 'law-list' }, sub.map(card)) : h('p', { class: 'empty' }, 'None.')));
  } else kids.push(inforce.length ? h('ul', { class: 'law-list' }, inforce.map(card)) : h('p', { class: 'empty' }, 'No law in force.'));
  if (gone.length) kids.push(h('details', {}, h('summary', {}, `Repealed (${gone.length})`), h('ul', { class: 'law-list' }, gone.map(card))));
  // Related tags: what else the laws found here are about.
  const rel = [...new Set(inforce.flatMap(l => l.tags))].filter(t => !(kind === 'tag' && t === value));
  if (rel.length) kids.push(h('p', { class: 'chips' }, h('span', { class: 'fine' }, 'Related: '), rel.map(t => chip(`#tag/${encodeURIComponent(t)}`, t))));
  return kids;
}

// ── one law ────────────────────────────────────────────────────────────────
function drawLaw(id, n) {
  const l = lawOf(id);
  if (!l) return [h('h2', {}, 'No such law'), h('p', {}, `No law has the id ${id}. `, link('#', 'Back to the statute book'), '.')];
  const v = n ? l.versions[n - 1] : l.versions.at(-1);
  if (!v) return [h('h2', {}, 'No such version'), link(`#law/${id}`, 'The law as it stands')];
  const latest = v === l.versions.at(-1);
  const status = !latest ? h('p', { class: 'status-line draft' }, `This is version ${v.n} of ${l.versions.length} and is no longer current. `, link(`#law/${id}`, 'Read the current version'), '.')
    : L.inForce(l) ? h('p', { class: 'status-line in-force' }, h('span', { class: 'dot' }), `In force since ${when(l.since)}, made by `, ...viaText(v.via), '.')
    : h('p', { class: 'status-line repealed' }, `Repealed ${day(l.repealed.at)} by `, ...viaText(l.repealed.via), l.repealed.reason ? ` (${l.repealed.reason})` : '', '. Its last text is kept for the record.');
  const t = renderText(v.text, { anchors: 'a' }), art = h('article', { class: 'statute' }); art.innerHTML = t.html;
  const pending = bills().filter(b => ['open', 'window', 'referendum'].includes(b.status) && (b.law === id));
  const changes = Object.entries(v.changes || {});
  return [
    h('p', { class: 'crumbs' }, link('#', 'The statute book'), ' › ', link(`#type/${l.type}`, typeTitle(l.type)), l.level ? [' › ', link(`#type/${l.level}`, `${typeTitle(l.level)} level`)] : ''),
    h('h2', { class: 'law-title' }, v.title),
    status,
    pending.length ? h('div', { class: 'notice' }, h('strong', {}, 'Changes under way: '), pending.map((b, i) => [i ? '; ' : '', link(`hall.html#/parliament/${b.id}`, b.action === 'repeal' ? 'a bill to repeal it' : `a bill to amend it`), ` (${b.status === 'open' ? 'in Parliament' : b.status === 'window' ? 'open to petition' : 'awaiting a referendum'})`])) : null,
    h('dl', { class: 'law-facts' },
      h('dt', {}, 'Type'), h('dd', {}, link(`#type/${v.type}`, typeTitle(v.type)), v.level ? [', at the ', link(`#type/${v.level}`, typeTitle(v.level)), ' level'] : '', h('span', { class: 'fine' }, ` · changing it needs the ${L.lawRule(params(), l)} majority: ${majority(L.lawRule(params(), l))}`)),
      h('dt', {}, 'Tags'), h('dd', { class: 'chips' }, v.tags.map(x => chip(`#tag/${encodeURIComponent(x)}`, x))),
      h('dt', {}, 'Enforced by'), h('dd', {}, v.enforcers.map((x, i) => [i ? ', ' : '', link(`#body/${x}`, body(x))])),
      h('dt', {}, 'Applies to'), h('dd', {}, v.subjects.map((x, i) => [i ? ', ' : '', link(`#body/${x}`, body(x))]))),
    changes.length ? h('section', { class: 'book-section' }, h('h3', {}, 'Settings this law sets'), h('div', { class: 'scroll' }, h('table', { class: 'rules' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Setting'), h('th', {}, 'Set to'), h('th', {}, 'Before'), h('th', {}, 'Now'))),
      h('tbody', {}, changes.map(([k, val]) => { const before = v.changed?.find(c => c.key === k)?.from; const g = governor(k);
        return h('tr', {}, h('td', {}, h('code', {}, k), h('div', { class: 'fine' }, params().def(k)?.describe || '')), h('td', {}, show(val)), h('td', { class: 'fine' }, before === undefined ? '' : show(before)),
          h('td', { class: 'fine' }, show(params().value(k)), g && g.law !== id ? [h('br'), 'now set by ', link(`#law/${g.law}`, lawOf(g.law)?.title || g.law)] : '')); }))))) : null,
    t.heads.length > 2 ? h('nav', { class: 'articles', 'aria-label': 'Sections' }, h('ol', {}, t.heads.map(x => h('li', {}, h('a', { href: `#law/${id}${n ? `/${n}` : ''}/@${x.id}`, 'data-anchor': x.id }, x.text))))) : null,
    v.text ? art : null,
    v.n > 1 ? h('details', { class: 'diff' }, h('summary', {}, `Changes from version ${v.n - 1}`), diffView(l.versions[v.n - 2], v)) : null,
    h('section', { class: 'history' }, h('h3', {}, 'History'),
      h('ol', { class: 'timeline' }, [...l.versions.map(x => ({ at: x.at, kids: [link(`#law/${id}/${x.n}`, x.n === 1 ? 'Enacted' : `Amended (version ${x.n})`), ' by ', ...viaText(x.via), x.note ? `: “${x.note}”` : ''] })),
        ...(l.repealed ? [{ at: l.repealed.at, kids: [h('strong', {}, 'Repealed'), ' by ', ...viaText(l.repealed.via)] }] : [])].sort((a, b) => (a.at < b.at ? 1 : -1)).map(e => h('li', {}, h('time', { datetime: e.at }, day(e.at)), h('span', {}, ...e.kids))))),
    L.inForce(l) && latest ? h('section', { class: 'law-actions' }, h('h3', {}, 'Change this law'),
      h('p', { class: 'fine' }, isCitizen() ? 'Draft an amendment or propose a repeal, through Parliament if you are a member, or by referendum.' : 'Citizens can propose amendments or a repeal. Sign in first.'),
      isCitizen() ? h('div', { class: 'buttons' },
        h('a', { class: 'primary', href: `#amend/${id}`, style: 'text-decoration:none' }, 'Draft an amendment'),
        L.repealProblem(state(), id) ? h('p', { class: 'fine' }, `It cannot be repealed while it governs settings. Amend it, or enact another law that sets them first.`) : null,
        isMP() && !L.repealProblem(state(), id) ? h('button', { class: 'secondary', type: 'button', onclick: () => { const r = prompt('Why should it be repealed? This is published.'); if (r) api().sign('law.bill', { bill: `repeal-${id}-${Date.now().toString(36)}`, action: 'repeal', law: id, reason: r }, `Your bill to repeal ${l.title}`); } }, 'Introduce a bill to repeal it') : null,
        L.repealProblem(state(), id) ? null : h('button', { class: 'secondary', type: 'button', onclick: () => { const r = prompt('Why should it be repealed? This is published.'); if (r) api().propose(`Repeal ${l.title} (by referendum)`, [{ kind: 'law.repeal', law: id, rule: L.lawRule(params(), l), reason: r }]); } }, 'Put its repeal to a referendum')) : null) : null,
  ];
}
const governor = (k) => state().m.laws?.settings?.[k] || null;
// A value in a few words: a list of records (laws.types) by their titles, a list by its items.
const show = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? (v.every(x => x && typeof x === 'object') ? `${v.length}: ${v.map(x => x.title || x.id || '…').join(', ')}` : v.join(', ')) : JSON.stringify(v));
// A rule in plain words, from the rule as it now stands.
function majority(name) {
  const r = params().rules[name]; if (!r) return name;
  const f = (x) => ({ 0.5: 'a majority', 0.6: 'three-fifths', 0.66: 'two-thirds', 0.67: 'two-thirds', 0.75: 'three-quarters', 1: 'everyone' }[x] || `${Math.round(x * 100)}%`);
  return `${f(r.threshold)} of votes cast${r.quorum ? `, with ${Math.round(r.quorum * 100)}% of citizens voting` : ''}${(r.readings || 1) > 1 ? `, in ${r.readings} votes at least ${r.apart} days apart` : ''}`;
}

// ── every setting ──────────────────────────────────────────────────────────
// Grouped by the majority that changes it, strictest first, each with the law
// that set it. A setting no law has set yet stands at its default.
function drawSettings() {
  const P = params(), order = [...P.ruleOrder()].reverse();
  const keys = P.keys().filter(k => P.rule(k)?.changeable !== false && k !== 'entity.modules');
  const loose = keys.filter(k => !governor(k));
  return [h('p', { class: 'crumbs' }, link('#', 'The statute book'), ' › Every setting'),
    h('h2', { class: 'law-title' }, 'Every setting'),
    h('p', { class: 'lede-sm' }, `Each setting is part of a parametric law and changes only by law, under the majority shown. To change one, amend the law that governs it, or draft a parametric law that sets it.${P.value('laws.settings_by_law') ? '' : ' (laws.settings_by_law is off, so a bill to the citizens can also change settings directly.)'}`),
    loose.length ? h('div', { class: 'notice' }, h('strong', {}, `${loose.length} setting${loose.length === 1 ? ' has' : 's have'} no law yet`), ` and stand${loose.length === 1 ? 's' : ''} at ${loose.length === 1 ? 'its' : 'their'} default: ${loose.join(', ')}. A parametric law that sets ${loose.length === 1 ? 'it' : 'them'} brings ${loose.length === 1 ? 'it' : 'them'} under law.`) : null,
    ...order.map(rule => { const ks = keys.filter(k => P.rule(k).name === rule); return ks.length ? h('section', { class: 'book-section' },
      h('h2', {}, `${rule[0].toUpperCase()}${rule.slice(1)} settings`), h('p', { class: 'fine' }, `Changed by ${majority(rule)}.`),
      h('div', { class: 'scroll' }, h('table', { class: 'rules settings-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Setting'), h('th', {}, 'Value'), h('th', {}, 'Governed by'))),
        h('tbody', {}, ks.map(k => { const g = governor(k); return h('tr', {}, h('td', {}, h('code', {}, k), h('div', { class: 'fine' }, P.def(k)?.describe || '')), h('td', {}, show(P.value(k))),
          h('td', {}, g ? [link(`#law/${g.law}`, lawOf(g.law)?.title || g.law), h('div', { class: 'fine' }, `since ${day(g.at)}`)] : h('span', { class: 'fine' }, 'no law; default'))); }))))) : null; }),
    h('p', { class: 'fine' }, 'Fixed by the design and changed by no law: ', P.keys().filter(k => P.rule(k)?.changeable === false).join(', '), '. Installed modules (entity.modules) change by a bill to add or remove one.')];
}

const isMP = () => me() && L.members(state(), params()).includes(me().id);
const api = () => moduleApi({ link: (p, ...kids) => h('a', { href: `hall.html#/${p}` }, ...kids), go: (p) => { location.href = `hall.html#/${p}`; }, refresh: draw });

function diffView(a, b) {
  const meta = [];
  for (const [k, label, f] of [['title', 'Title', (x) => x.title], ['type', 'Type', (x) => typeLine(x)], ['tags', 'Tags', (x) => x.tags.join(', ')], ['enforcers', 'Enforced by', (x) => x.enforcers.map(body).join(', ')], ['subjects', 'Applies to', (x) => x.subjects.map(body).join(', ')], ['changes', 'Settings', (x) => JSON.stringify(x.changes || {})]])
    if (f(a) !== f(b)) meta.push(h('li', {}, `${label}: `, h('del', {}, f(a)), ' → ', h('ins', {}, f(b)))), void k;
  const A = a.text.split('\n'), B = b.text.split('\n');
  const m = A.length, n = B.length, dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < m && j < n) { if (A[i] === B[j]) { out.push(['=', A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['-', A[i++]]); else out.push(['+', B[j++]]); }
  while (i < m) out.push(['-', A[i++]]); while (j < n) out.push(['+', B[j++]]);
  const changed = out.filter(([k]) => k !== '=');
  return [meta.length ? h('ul', { class: 'meta-diff' }, meta) : null,
    changed.length ? h('pre', { class: 'redline' }, out.filter((x, k) => x[0] !== '=' || out.slice(Math.max(0, k - 1), k + 2).some(y => y[0] !== '=')).map(([k, line]) => h(k === '+' ? 'ins' : k === '-' ? 'del' : 'span', {}, `${k === '=' ? ' ' : k} ${line}\n`))) : h('p', { class: 'fine' }, 'The text did not change.')];
}

// ── drafting ───────────────────────────────────────────────────────────────
function drawDraft(amendId) {
  const l = amendId ? lawOf(amendId) : null;
  if (amendId && !L.inForce(l)) return [h('h2', {}, 'No law in force to amend'), link('#', 'The statute book')];
  if (!isCitizen()) return [h('h2', { class: 'law-title' }, l ? `Amend ${l.title}` : 'Draft a law'), h('p', {}, 'Sign in to draft a law. Any citizen can put a law to a referendum, and members of Parliament can also introduce it in Parliament.')];
  return [h('p', { class: 'crumbs' }, link('#', 'The statute book'), ' › ', l ? link(`#law/${l.id}`, l.title) : 'Drafting'),
    h('h2', { class: 'law-title' }, l ? `Amend ${l.title}` : 'Draft a law'),
    h('p', { class: 'lede-sm' }, 'A law needs a type, at least one tag, and who enforces it and who it applies to. The form shows which majority it needs and whether Parliament can pass it on its own.'),
    h('div', { class: 'hall-view drafting' }, UI.lawForm(api(), { amend: l, onDone: (d, how) => { location.href = how.parliament ? `hall.html#/parliament/${how.parliament}` : 'hall.html#/bills'; } }))];
}

// ── types and rules ────────────────────────────────────────────────────────
function drawRules() {
  const P = params(), T = L.types(P);
  const words = majority;
  const outside = ctx.r.records.filter(r => r.kind === 'parameters.changed' && Object.keys(r.payload.changes || {}).some(k => k !== 'entity.modules'));
  return [h('p', { class: 'crumbs' }, link('#', 'The statute book'), ' › Types and rules'),
    h('h2', { class: 'law-title' }, 'Types of law and the majorities they need'),
    h('p', { class: 'lede-sm' }, `The list of types is itself part of the constitutional settings, so changing it takes a constitutional majority. Parliament can pass laws up to the ${P.value('laws.parliament_max_rule')} majority on its own; anything stricter also needs a referendum. A law Parliament passes takes effect after ${P.value('laws.petition_days')} days, unless ${Math.round(P.value('laws.petition_share') * 100)}% of citizens petition for a referendum first.`),
    h('div', { class: 'scroll' }, h('table', { class: 'rules' }, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Rule'), h('th', {}, 'Levels'), h('th', {}, 'What it is'))),
      h('tbody', {}, T.map(t => h('tr', {}, h('th', { scope: 'row' }, link(`#type/${t.id}`, t.title)), h('td', {}, `${t.rule}: ${words(t.rule)}`), h('td', { class: 'fine' }, (t.levels || []).map(typeTitle).join(', ') || '—', t.level_required ? ' (required)' : ''), h('td', { class: 'fine' }, t.describe || '', t.changes ? ' Carries setting changes.' : '')))))),
    h('p', { class: 'fine' }, 'A law needs the strictest majority of its type, its level and any setting it changes. An amendment cannot lower the majority a law needs. ', link('#settings', 'Every setting and the law that governs it'), '.'),
    outside.length ? h('div', { class: 'notice' }, h('strong', {}, `${outside.length} setting change${outside.length === 1 ? ' was' : 's were'} made outside a law`), ' (by a bill with direct changes, before the laws module or from the command line): ',
      outside.slice(-5).map((r, i) => [i ? '; ' : '', `${day(r.at)}: ${Object.keys(r.payload.changes).join(', ')}`])) : null];
}

// ── routing ────────────────────────────────────────────────────────────────
let route = null;
function draw() {
  if (!ctx.r.ok) { $('#law-view').replaceChildren(h('p', { class: 'empty' }, 'The record did not verify, so no law is shown.')); return; }
  const parts = location.hash.replace(/^#/, '').split('/').map(decodeURIComponent);
  const anchor = parts.at(-1)?.startsWith('@') ? parts.pop().slice(1) : null;
  const [a, ...rest] = parts, arg = rest.join('/');
  const key = a === 'law' ? `law/${rest[0]}` : a ? `${a}/${arg}`.replace(/\/$/, '') : '';
  drawIndex(key);
  const kids = a === 'law' ? drawLaw(rest[0], /^\d+$/.test(rest[1] || '') ? Number(rest[1]) : null)
    : ['type', 'tag', 'body'].includes(a) ? drawFiltered(a, arg)
    : a === 'rules' ? drawRules() : a === 'settings' ? drawSettings() : a === 'new' ? drawDraft(null) : a === 'amend' ? drawDraft(arg) : drawBook();
  const view = $('#law-view');
  view.replaceChildren(...[].concat(kids).flat(Infinity).filter(Boolean));
  for (const el of view.querySelectorAll('a[data-anchor]')) el.addEventListener('click', (ev) => { const t = document.getElementById(el.dataset.anchor); if (t) { ev.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); } });
  const page = location.hash.replace(/\/@.*$/, '');
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else if (route !== null && route !== page) window.scrollTo({ top: 0 });
  route = page;
}
const busy = () => { const a = document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#law-view').contains(a)) || !!document.querySelector('#law-view .law-form'); };

await start();
if (ctx.r.ok && !enabled('laws')) { (await import('./laws-wiki.js')).run(); }
else {
  L = await import('./modules/laws/index.js');
  UI = await import('./modules/laws/ui.js');
  onSigned(() => { if (!document.querySelector('#law-view .law-form')) draw(); });
  draw();
  addEventListener('hashchange', draw);
  onChange(() => { if (!busy() && !document.querySelector('dialog[open]')) draw(); });
}
void nameOf;
