// home.js · the solidarity network's front page: what is on the shelf, how
// borrowing works, open votes, the solidarity fund, the texts, and joining.
// Everything is worked out in this browser from the public record.
import { start, onChange, onSigned, ctx, h, $, me, displayName, joinDialog, signInDialog, W, enabled, setting, institutionTitle, INSTITUTIONS } from './common.js';
import { drawOpen } from './floor.js';

let T = null; // the things module: who holds what
const PLUMBING = new Set(['deliberation', 'titles', 'vocabulary', 'passwords', 'passkeys', 'page', 'republic']);

// Money in the smallest unit, shown in the module's currency.
function money(n, mod = 'things') {
  const d = setting(`${mod}.decimals`, 2), cur = setting(`${mod}.currency`, 'USD');
  const sym = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$' }[cur];
  const s = (n / 10 ** d).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  return sym ? `${sym}${s}` : `${s} ${cur}`;
}

function items() {
  return Object.values(ctx.r.state.m.things?.items || {}).filter(i => !i.withdrawn);
}
const isOut = (i) => !!(T && T.current(ctx.r.state, i.id));
const lenderOf = (i) => (i.owner ? displayName(i.owner) : `the network${i.keeper ? `, kept by ${displayName(i.keeper)}` : ''}`);
const terms = (i) => (i.deposit ? `${money(i.deposit)} deposit` : 'no deposit');

// ── the shelf ──────────────────────────────────────────────────────────────
function drawShelf() {
  const all = items(), free = all.filter(i => !isOut(i));
  const newest = (a, b) => (a.listed < b.listed ? 1 : -1);
  $('#shelf-now').replaceChildren(...(free.length ? free.sort(newest).slice(0, 5).map(i => h('li', {},
    h('a', { href: 'library.html' }, i.title), h('span', { class: 'fine' }, ` · ${terms(i)} · ${lenderOf(i)}`)))
    : [h('li', { class: 'empty' }, all.length ? 'Everything is out on loan right now.' : 'Nothing listed yet. Members list what they are willing to lend.')]));
  $('#shelf-caption').textContent = all.length ? `${free.length} of ${all.length} thing${all.length === 1 ? '' : 's'} available to borrow.` : '';
  $('#library-meta').textContent = all.length
    ? `${all.length} thing${all.length === 1 ? '' : 's'} listed, ${all.filter(i => !i.owner).length} of them held in common. ${all.length - free.length} out on loan now.`
    : 'What members lend, and what the network holds in common.';
  $('#shelf').replaceChildren(...(all.length ? all.sort(newest).slice(0, 8).map(i => h('li', { class: 'thing' },
    h('h3', {}, h('a', { href: 'library.html' }, i.title)),
    h('p', { class: 'fine' }, `${terms(i)}${i.days ? ` · up to ${i.days} days` : ''}${i.where ? ` · ${i.where}` : ''}`),
    h('p', { class: 'fine' }, lenderOf(i)),
    h('p', { class: isOut(i) ? 'state out' : 'state in' }, isOut(i) ? 'Out on loan' : 'Available')))
    : [h('li', { class: 'empty' }, 'Nothing listed yet. Once you are a member, list anything you are willing to lend.')]));
}

// ── the fund ───────────────────────────────────────────────────────────────
function drawFund() {
  const box = $('#fund-lines');
  if (!enabled('budget')) { box.replaceChildren(h('p', { class: 'empty' }, 'The budget is not switched on, so no money has been set aside.')); return; }
  const lines = Object.values(ctx.r.state.m.budget?.lines || {}).filter(l => !l.closed);
  if (!lines.length) { box.replaceChildren(h('p', { class: 'empty' }, 'No money has been set aside yet. The Assembly approves the fund each year.')); return; }
  const spent = (l) => (l.spending || []).reduce((a, s) => a + s.amount, 0);
  box.replaceChildren(h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'What for'), h('th', {}, 'Set aside'), h('th', {}, 'Left'))),
    h('tbody', {}, lines.map(l => h('tr', {}, h('td', {}, l.title, l.period ? h('div', { class: 'fine' }, l.period) : null), h('td', {}, money(l.amount, 'budget')), h('td', {}, money(l.amount - spent(l), 'budget'))))))),
    h('p', { class: 'more' }, h('a', { href: 'hall.html#/budget' }, 'Every payment')));
}

// ── the texts and the institutions ─────────────────────────────────────────
function drawTexts() {
  const pages = Object.values(ctx.r.state.m.wiki?.pages || {});
  const title = (p) => p.versions.at(-1)?.title || p.id;
  const rank = (p) => (p.statute ? 0 : 1);
  $('#text-list').replaceChildren(...(pages.length ? pages.sort((a, b) => rank(a) - rank(b) || title(a).localeCompare(title(b))).slice(0, 9).map(p => h('li', {},
    h('a', { href: `wiki.html#/${p.id}` }, title(p)), h('div', { class: 'fine' }, p.statute ? 'Adopted by the Assembly' : `${p.versions.length} version${p.versions.length === 1 ? '' : 's'}`)))
    : [h('li', { class: 'empty' }, 'Nothing written yet.')]));
}
function drawInstitutions() {
  const mods = ctx.r.params.value('entity.modules').filter(m => !PLUMBING.has(m));
  const href = (m) => (m === 'things' ? 'library.html' : m === 'wiki' ? 'wiki.html' : `hall.html#/${m}`);
  $('#inst-list').replaceChildren(h('li', {}, h('a', { href: 'hall.html#/members' }, W().Many), h('div', { class: 'fine' }, `${ctx.r.get('member-count')} ${ctx.r.get('member-count') === 1 ? W().one : W().many}, one vote each.`)),
    ...mods.map(m => h('li', {}, h('a', { href: href(m) }, institutionTitle(m)), h('div', { class: 'fine' }, INSTITUTIONS[m]?.[1] || ''))));
}

// ── joining ────────────────────────────────────────────────────────────────
function drawJoin() {
  const btn = $('#join'), note = $('#join-note'), p = me();
  if (!p) {
    btn.hidden = false; btn.textContent = setting('membership.admission', 'open') === 'open' ? `Become ${W().a} ${W().one}` : 'Apply to join';
    btn.onclick = () => joinDialog();
    note.replaceChildren('Already a member? ', h('button', { class: 'linklike', type: 'button', onclick: () => signInDialog() }, 'Sign in'), '.');
  } else if (p.status === 'applicant') {
    btn.hidden = true;
    const owes = ctx.agreements && enabled('agreements') ? ctx.agreements.outstanding(ctx.r.state, p.id, ctx.r.params) : [];
    note.replaceChildren(owes.length ? `Your application is in, but you ${owes.join('; ')}. Sign it from ` : `Your application is in. The ${W().assembly} votes on admitting you; you can follow it under `,
      h('a', { href: owes.length ? 'hall.html#/agreements' : 'hall.html#/proposals' }, owes.length ? 'The Pledge' : 'Votes'), '.');
  } else {
    btn.hidden = true;
    note.replaceChildren(`Signed in as ${displayName(p.id)}. `, h('a', { href: 'library.html' }, 'Your loans and requests'), ' are at the top of the library.');
  }
}

function draw() {
  if (!ctx.r.ok) { $('#shelf-now').replaceChildren(h('li', { class: 'empty' }, 'The record did not verify, so nothing is shown.')); return; }
  drawShelf(); drawOpen($('#bills')); drawFund(); drawTexts(); drawInstitutions(); drawJoin();
}

await start();
if (ctx.r.ok && enabled('things')) { try { T = await import('./modules/things/index.js'); } catch { /* not here */ } }
draw();
onChange(() => { if (!document.querySelector('dialog[open]')) draw(); });
onSigned(draw);
if (location.hash === '#join' && !me()) joinDialog();
