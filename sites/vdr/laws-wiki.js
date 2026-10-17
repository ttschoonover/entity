// laws-wiki.js · the statute book of a republic without the laws module: the Constitution and every law in force, their
// versions and the decisions that made them, drafts and bills before the
// Assembly, laws repealed, and the standing rules by which laws are made.
//
//   laws.html                      the statute book
//   laws.html#law/ID               a law as in force (or a draft's latest text)
//   laws.html#law/ID/N             version N of it, compared with the law in force
//   laws.html#rules                the standing rules
import { start, onChange, onSigned, ctx, h, $, day, when, isCitizen, nameOf, signAll, renderText, toast, E } from './common.js';

const CONST = 'constitution';
const wiki = () => ctx.r.state.m.wiki?.pages || {};
const latest = (p) => p.versions[p.versions.length - 1];
const inForce = (p) => (p.statute ? p.versions[p.statute.version - 1] : null);
const isLaw = (p) => !!p.statute;
const isDraft = (p) => !p.statute && (latest(p).category === 'Laws' || pendingFor(p.id).length > 0) && !p.enactments.length;
const isRepealed = (p) => !p.statute && p.enactments.some(x => x.action === 'repealed');
const openBills = () => Object.values(ctx.r.state.proposals).filter(p => !p.closed);
const pendingFor = (id) => openBills().filter(b => (b.effects || []).some(e => (e.kind === 'wiki.enact' || e.kind === 'wiki.repeal') && e.page === id));
const bill = (id) => ctx.r.state.proposals[id];
const billLink = (id) => (bill(id) ? h('a', { href: `hall.html#/bills/${id}` }, bill(id).title) : id);
const lawLink = (id, n) => `#law/${id}${n ? `/${n}` : ''}`;
const title = (p) => (inForce(p) || latest(p)).title;

// ── the rules, said plainly ────────────────────────────────────────────────
const frac = (x) => ({ 0.5: 'a majority', 0.51: 'a majority', 0.6: 'three-fifths', 0.66: 'two-thirds', 0.67: 'two-thirds', 0.75: 'three-quarters', 1: 'all' }[x] || `${Math.round(x * 100)}%`);
export function ruleText(name) {
  const r = ctx.r.params.rules?.[name];
  if (!r) return `the ${name} rule`;
  const q = r.quorum ? `, with at least ${r.quorum >= 0.5 ? frac(r.quorum) : `${Math.round(r.quorum * 100)}%`} of citizens voting` : '';
  const readings = (r.readings || 1) > 1 ? `, in ${r.readings} votes${r.apart ? ` at least ${r.apart} days apart` : ''}` : '';
  return `${frac(r.threshold)} of the votes cast${q}${readings}`;
}
const rank = (n) => ctx.r.params.rank(n);
const stricter = (a, b) => (rank(a) >= rank(b) ? a : b);
// The rule a bill on this law is laid under: what the law requires, and for
// the Constitution never less than the constitutional rule (Article VIII).
function ruleFor(id, effects, entrenched = false) {
  let rule = E.required(ctx.r.params, { effects }, ctx.registry).name;
  if (id === CONST) rule = stricter(rule, entrenched ? 'entrenched' : 'constitutional');
  return rule;
}

// ── the index ──────────────────────────────────────────────────────────────
function drawIndex(route) {
  const pages = Object.values(wiki());
  const laws = pages.filter(isLaw).filter(p => p.id !== CONST).sort((a, b) => title(a).localeCompare(title(b)));
  const drafts = pages.filter(isDraft), repealed = pages.filter(isRepealed);
  const cur = (href) => (route === href ? 'page' : null);
  const item = (p, sub) => h('li', {}, h('a', { href: lawLink(p.id), 'aria-current': cur(`law/${p.id}`) }, title(p)), sub ? h('span', { class: 'sub' }, sub) : null);
  const c = wiki()[CONST];
  $('#law-index').replaceChildren(...[
    h('a', { class: 'book', href: '#', 'aria-current': cur('') }, 'The statute book'),
    h('h2', {}, 'Fundamental law'),
    h('ul', {}, c ? item(c, c.statute ? `version ${c.statute.version}` : 'not yet enacted') : h('li', { class: 'empty' }, 'No Constitution has been written.')),
    h('h2', {}, 'Laws in force'),
    h('ul', {}, laws.length ? laws.map(p => item(p)) : h('li', { class: 'empty' }, 'None besides the Constitution yet.')),
    drafts.length ? [h('h2', {}, 'Before the Assembly'), h('ul', {}, drafts.map(p => item(p, pendingFor(p.id).length ? 'being voted on' : 'draft')))] : null,
    repealed.length ? [h('h2', {}, 'Repealed'), h('ul', {}, repealed.map(p => item(p)))] : null,
    h('h2', {}, 'How laws are made'),
    h('ul', {}, h('li', {}, h('a', { href: '#rules', 'aria-current': cur('rules') }, 'The standing rules')))].flat().filter(Boolean));
}

function drawBook() {
  const pages = Object.values(wiki());
  const c = wiki()[CONST], laws = pages.filter(isLaw).filter(p => p.id !== CONST);
  const bills = openBills().filter(b => (b.effects || []).some(e => e.kind === 'wiki.enact' || e.kind === 'wiki.repeal'));
  const card = (p) => {
    const v = inForce(p);
    return h('li', {}, h('h3', {}, h('a', { href: lawLink(p.id) }, v.title)),
      h('p', { class: 'meta' }, `Version ${p.statute.version} · in force since ${day(p.statute.at)}${p.enactments.length > 1 ? ` · amended ${p.enactments.filter(x => x.action === 'amended').length} time${p.enactments.filter(x => x.action === 'amended').length === 1 ? '' : 's'}` : ''}`),
      h('p', { class: 'excerpt' }, excerpt(v.body)));
  };
  return [
    c?.statute ? h('article', { class: 'featured' },
      h('p', { class: 'kicker' }, 'Fundamental law'),
      h('h2', {}, h('a', { href: lawLink(CONST) }, inForce(c).title)),
      h('p', { class: 'excerpt serif' }, excerpt(inForce(c).body.split(/\n\s*\n/)[0], 420)),
      h('ol', { class: 'toc' }, renderText(inForce(c).body, { anchors: 'a' }).heads.map(x => h('li', {}, h('a', { href: `${lawLink(CONST)}/@${x.id}` }, x.text)))),
      h('p', { class: 'meta' }, `Version ${c.statute.version}, in force since ${day(c.statute.at)}. Amending it takes ${ruleText(ruleFor(CONST, [{ kind: 'wiki.enact', page: CONST, version: 1 }]))}.`)) : null,
    h('section', { class: 'book-section' }, h('h2', {}, 'Laws in force'),
      laws.length ? h('ul', { class: 'law-list' }, laws.map(card)) : h('p', { class: 'empty' }, 'The Assembly has passed no laws besides the Constitution yet. Any citizen can propose one.')),
    bills.length ? h('section', { class: 'book-section' }, h('h2', {}, 'Bills on the laws, open for a vote'),
      h('ul', { class: 'law-list' }, bills.map(b => h('li', {}, h('h3', {}, billLink(b.id)),
        h('p', { class: 'meta' }, `Open until ${day(b.deadline)} · needs ${ruleText(b.rule)}`),
        h('p', {}, (b.effects || []).filter(e => e.kind.startsWith('wiki.')).map(e => h('span', { class: 'effect' }, e.kind === 'wiki.repeal' ? 'Repeals ' : `Enacts version ${e.version} of `, h('a', { href: lawLink(e.page, e.kind === 'wiki.enact' ? e.version : null) }, wiki()[e.page] ? title(wiki()[e.page]) : e.page)))))))) : null,
    newLawForm(),
  ];
}

const excerpt = (body, n = 220) => { const t = String(body).replace(/^#+\s.*$/gm, '').replace(/^\s*(\d+\.|[-*])\s+/gm, '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; };

// ── one law ────────────────────────────────────────────────────────────────
function drawLaw(id, n) {
  const p = wiki()[id];
  if (!p) return [h('h2', {}, 'No such law'), h('p', {}, `There is no text called ${id}. `, h('a', { href: '#' }, 'Back to the statute book'), '.')];
  const law = inForce(p), top = latest(p);
  const v = n ? p.versions[n - 1] : (law || top);
  if (!v) return [h('h2', {}, 'No such version'), h('p', {}, h('a', { href: lawLink(id) }, 'The law as in force'))];
  const status = law === v ? h('p', { class: 'status-line in-force' }, h('span', { class: 'dot' }), `In force since ${when(p.statute.at)}, enacted by `, enactedBy(p.statute.by), '.')
    : law ? h('p', { class: 'status-line draft' }, `This is version ${v.n}, not the law in force. `, h('a', { href: lawLink(id) }, `Read version ${law.n}, in force`), ' — or compare them below.')
    : isRepealed(p) ? h('p', { class: 'status-line repealed' }, `Repealed ${day(p.enactments.at(-1).at)}. This is its last text, for the record.`)
    : h('p', { class: 'status-line draft' }, 'A draft: not law until the Assembly enacts it.');
  const body = renderText(v.body, { anchors: 'a' });
  const art = h('article', { class: 'statute' });
  art.innerHTML = body.html;
  const pending = pendingFor(id);
  const kids = [
    h('p', { class: 'crumbs' }, h('a', { href: '#' }, 'The statute book'), ' › ', id === CONST ? 'Fundamental law' : law ? 'Laws in force' : 'Drafts'),
    h('h2', { class: 'law-title' }, v.title),
    status,
    pending.length ? h('div', { class: 'notice' }, h('strong', {}, 'Before the Assembly now: '), pending.map((b, i) => [i ? '; ' : '', billLink(b.id), ` (open until ${day(b.deadline)})`])) : null,
    body.heads.length > 2 ? h('nav', { class: 'articles', 'aria-label': 'Articles' }, h('ol', {}, body.heads.map(x => h('li', {}, h('a', { href: `#law/${id}${n ? `/${n}` : ''}/@${x.id}`, 'data-anchor': x.id }, x.text))))) : null,
    art,
    law && v !== law ? h('details', { class: 'diff', open: true }, h('summary', {}, `How version ${v.n} differs from the law in force (version ${law.n})`), redline(law.body, v.body)) : null,
    v.n > 1 ? h('details', { class: 'diff' }, h('summary', {}, `What changed from version ${v.n - 1}`), redline(p.versions[v.n - 2].body, v.body)) : null,
    h('section', { class: 'history' }, h('h3', {}, 'History'),
      h('ol', { class: 'timeline' }, timeline(p).map(e => h('li', {}, h('time', { datetime: e.at }, day(e.at)), h('span', {}, ...e.text))))),
    actions(p, v),
  ];
  return kids;
}

function enactedBy(origin) {
  const [how, id] = String(origin).split(' ');
  if (how === 'decision' && bill(id)) return h('span', {}, 'the Assembly’s decision on ', billLink(id));
  if (how === 'grant') return h('span', {}, `an officer, using the power ${id}`);
  return h('span', {}, String(origin));
}

function timeline(p) {
  const ev = [];
  for (const v of p.versions) ev.push({ at: v.at, text: [h('a', { href: lawLink(p.id, v.n) }, `Version ${v.n}`), ` written by ${nameOf(v.by)}${v.note ? `: “${v.note}”` : ''}`] });
  for (const e of p.enactments) ev.push({ at: e.at, text: [h('strong', {}, e.action[0].toUpperCase() + e.action.slice(1)), e.action === 'repealed' ? '' : [' as ', h('a', { href: lawLink(p.id, e.version) }, `version ${e.version}`)], ' by ', enactedBy(e.by), e.reason ? ` (${e.reason})` : ''] });
  return ev.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function redline(a, b) {
  const W = ctx.wikiModule;
  const lines = W?.diffLines ? W.diffLines(a, b) : simpleDiff(a, b);
  return h('pre', { class: 'redline' }, lines.map(([k, line]) => h(k === '+' ? 'ins' : k === '-' ? 'del' : 'span', {}, `${k === ' ' ? '  ' : k + ' '}${line}\n`)));
}
function simpleDiff(a, b) { const A = a.split('\n'), B = b.split('\n'); return [...A.filter(l => !B.includes(l)).map(l => ['-', l]), ...B.filter(l => !A.includes(l)).map(l => ['+', l])]; }

// ── what a citizen can do with a law ──────────────────────────────────────
function actions(p, v) {
  if (!ctx.r.params.value('entity.modules').includes('wiki')) return null;
  const top = latest(p), law = inForce(p), id = p.id;
  const signIn = h('p', { class: 'fine' }, 'Citizens can propose amendments to this law, its repeal, or the enactment of a draft. ', isCitizen() ? '' : 'Sign in to do so.');
  const box = h('section', { class: 'law-actions' }, h('h3', {}, 'Change this law'), signIn);
  if (law && v !== law && v.n <= top.n) box.append(h('div', { class: 'buttons' }, h('button', { class: 'secondary', type: 'button', onclick: () => {
    const effects = [{ kind: 'wiki.enact', page: id, version: v.n }];
    const rule = ruleFor(id, effects);
    signAll([['proposal.lay', { title: `Amend ${law.title}: adopt version ${v.n}`, rule, effects }, `Your bill to make version ${v.n} the law`]], 'Propose adopting this version');
  } }, `Propose making version ${v.n} the law`)));
  if (!law && !isRepealed(p)) box.append(h('div', { class: 'buttons' }, h('button', { class: 'secondary', type: 'button', onclick: () => {
    const effects = [{ kind: 'wiki.enact', page: id, version: v.n }];
    signAll([['proposal.lay', { title: `Enact ${v.title}`, rule: ruleFor(id, effects), effects }, `Your bill to enact ${v.title}`]], 'Propose enacting this text');
  } }, `Propose enacting version ${v.n}`)));
  // Amend: a new version, then a bill to enact it.
  const isC = id === CONST;
  const form = h('form', { class: 'inline-form' },
    h('label', { for: 'am-body' }, 'The text as amended'),
    h('textarea', { id: 'am-body', rows: 18, class: 'serif' }, top.body),
    h('label', { for: 'am-note' }, 'What the amendment does, in a sentence (public)'),
    h('input', { id: 'am-note', maxlength: 200, required: true, placeholder: isC ? 'Adds a right to privacy to Article III' : 'Extends the notice period to 14 days' }),
    isC ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'am-entrenched' }), 'It changes a right in Article III or open citizenship (needs the entrenched rule)') : null,
    h('p', { class: 'fine', id: 'am-rule' }),
    h('div', { class: 'buttons' }, h('button', { class: 'primary', type: 'submit' }, 'Sign the amendment and the bill')));
  const showRule = () => { const r = ruleFor(id, [{ kind: 'wiki.enact', page: id, version: 1 }], $('#am-entrenched', form)?.checked); $('#am-rule', form).textContent = `Two signatures: the amended text, then a bill to enact it, which passes with ${ruleText(r)} (the ${r} rule).`; };
  form.addEventListener('change', showRule); showRule();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const body = $('#am-body', form).value, note = $('#am-note', form).value.trim();
    if (body === top.body) return toast('The text is unchanged.', true);
    const effects = [{ kind: 'wiki.enact', page: id, version: top.n + 1 }];
    const rule = ruleFor(id, effects, $('#am-entrenched', form)?.checked);
    signAll([
      ['wiki.edit', { page: id, title: top.title, body, base: top.n, note, ...(top.category ? { category: top.category } : {}) }, `Version ${top.n + 1} of ${top.title}`],
      ['proposal.lay', { title: `Amend ${top.title}: ${note}`, text: note, rule, effects }, `Your bill to enact it (${rule} rule)`],
    ], `Propose an amendment to ${top.title}`).then(ok => { if (ok) location.hash = lawLink(id); });
  });
  box.append(h('details', { class: 'propose' }, h('summary', {}, law ? 'Propose an amendment' : 'Revise this draft and propose it'), form));
  if (law) box.append(h('details', { class: 'propose' }, h('summary', {}, 'Propose repealing it'), h('form', { class: 'inline-form', onsubmit: (ev) => {
    ev.preventDefault();
    const reason = ev.target.querySelector('input').value.trim();
    const effects = [{ kind: 'wiki.repeal', page: id, ...(reason ? { reason } : {}) }];
    signAll([['proposal.lay', { title: `Repeal ${law.title}`, text: reason || undefined, rule: ruleFor(id, effects), effects }, `Your bill to repeal ${law.title}`]], 'Propose a repeal');
  } }, h('label', {}, 'Why (public)'), h('input', { maxlength: 200 }), h('p', { class: 'fine' }, isC ? 'Repealing the Constitution would leave the Republic without one. It needs the constitutional rule at least.' : `A repeal passes with ${ruleText(ruleFor(id, [{ kind: 'wiki.repeal', page: id }]))}.`),
    h('div', { class: 'buttons' }, h('button', { class: 'secondary', type: 'submit' }, 'Sign the bill')))));
  return box;
}

function newLawForm() {
  if (!ctx.r.params.value('entity.modules').includes('wiki')) return null;
  const form = h('form', { class: 'inline-form' },
    h('label', { for: 'nl-title' }, 'Title'), h('input', { id: 'nl-title', required: true, maxlength: 120, placeholder: 'The Public Records Act' }),
    h('label', { for: 'nl-body' }, 'Text'), h('textarea', { id: 'nl-body', rows: 14, class: 'serif', required: true, placeholder: '## Section 1 · Purpose\n1. …\n\n## Section 2 · …' }),
    h('p', { class: 'fine' }, `Headings start with ##; numbered clauses with 1. Two signatures: the text, then a bill to enact it, which passes with ${ruleText(ruleFor('new', [{ kind: 'wiki.enact', page: 'x', version: 1 }]))}.`),
    h('div', { class: 'buttons' }, h('button', { class: 'primary', type: 'submit' }, 'Sign the text and the bill')));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = $('#nl-title', form).value.trim(), body = $('#nl-body', form).value;
    let id = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'law';
    for (let i = 2; wiki()[id]; i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
    const effects = [{ kind: 'wiki.enact', page: id, version: 1 }];
    signAll([
      ['wiki.edit', { page: id, title: t, body, base: 0, category: 'Laws' }, `The text of ${t}`],
      ['proposal.lay', { title: `Enact ${t}`, rule: ruleFor(id, effects), effects }, `Your bill to enact ${t}`],
    ], `Propose a new law: ${t}`).then(ok => { if (ok) location.hash = lawLink(id); });
  });
  return h('section', { class: 'book-section' }, h('details', { class: 'propose' }, h('summary', {}, 'Propose a new law'), form));
}

// ── the standing rules ─────────────────────────────────────────────────────
function drawRules() {
  const P = ctx.r.params, rules = P.ruleNames();
  const groups = {};
  for (const k of P.keys()) {
    if (k.startsWith('amendment.rules.') || k.startsWith('entity.') || k.startsWith('vocabulary.')) continue;
    const d = P.def(k); (groups[d.group || 'General'] ||= []).push([k, d]);
  }
  const show = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
  return [
    h('p', { class: 'crumbs' }, h('a', { href: '#' }, 'The statute book'), ' › How laws are made'),
    h('h2', { class: 'law-title' }, 'The standing rules'),
    h('p', { class: 'lede-sm' }, 'Every bill is decided under one of these rules. The stricter the rule, the more a bill must win. A bill may always be laid under a stricter rule than it needs, never a weaker one.'),
    h('div', { class: 'scroll' }, h('table', { class: 'rules' }, h('thead', {}, h('tr', {}, h('th', {}, 'Rule'), h('th', {}, 'To pass, a bill needs'), h('th', {}, 'Used for'))),
      h('tbody', {}, rules.map(n => h('tr', {}, h('th', { scope: 'row' }, n[0].toUpperCase() + n.slice(1)), h('td', {}, ruleText(n)), h('td', { class: 'fine' }, USED_FOR[n] || '')))))),
    h('p', { class: 'fine' }, `Bills stay open ${P.value('deliberation.period')} days, and close sooner once the outcome cannot change. Only citizens who were citizens when a bill was laid vote on it.`),
    h('h3', {}, 'Settings in force'),
    h('p', { class: 'fine' }, 'The Republic’s other standing rules. Each can be changed only by a bill under the rule shown.'),
    Object.entries(groups).sort().map(([g, rows]) => h('details', { class: 'setting-group' }, h('summary', {}, g),
      h('dl', { class: 'settings' }, rows.map(([k, d]) => [h('dt', {}, d.describe || k, h('span', { class: 'key' }, k)), h('dd', {}, h('strong', {}, show(d.value)), d.changed_by ? h('span', { class: 'fine' }, ` · changed by the ${d.changed_by} rule`) : null)])))),
  ];
}
const USED_FOR = {
  ordinary: 'Resolutions and day-to-day decisions.',
  organic: 'Laws, offices and powers, and most settings.',
  constitutional: 'Amending the Constitution, and the rules themselves.',
  entrenched: 'Changing citizens’ rights or open citizenship.',
};

// ── routing and drawing ────────────────────────────────────────────────────
let route = null;
function draw() {
  if (!ctx.r.ok) { $('#law-view').replaceChildren(h('p', { class: 'empty' }, 'The record did not verify, so no law is shown.')); return; }
  const parts = location.hash.replace(/^#/, '').split('/');
  const anchor = parts.at(-1)?.startsWith('@') ? parts.pop().slice(1) : null;
  const [a, id, n] = parts;
  const key = a === 'law' ? `law/${id}` : a || '';
  drawIndex(key);
  const view = $('#law-view');
  const kids = a === 'law' ? drawLaw(id, /^\d+$/.test(n || '') ? Number(n) : null) : a === 'rules' ? drawRules() : drawBook();
  view.replaceChildren(...[].concat(kids).flat().filter(Boolean));
  for (const el of view.querySelectorAll('a[data-anchor]')) el.addEventListener('click', (ev) => { const t = document.getElementById(el.dataset.anchor); if (t) { ev.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  const page = location.hash.replace(/\/@.*$/, '');
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else if (route !== null && route !== page) window.scrollTo({ top: 0 });
  route = page;
}
const busy = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#law-view').contains(a); };

// Run by laws.js, after it has connected, when the laws module is not installed.
export async function run() {
  onSigned(() => draw());
  try { ctx.wikiModule = await import('./modules/wiki/index.js'); } catch { /* the wiki is not installed */ }
  draw();
  addEventListener('hashchange', draw);
  onChange(() => { if (!busy() && !document.querySelector('dialog[open]')) draw(); });
}
