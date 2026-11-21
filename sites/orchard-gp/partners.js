// partners.js · who the partners are: the register with units and interest,
// the officers and their elections, and anyone applying to join.
import { start, ctx, h, $, me, propose, nameOf, onChange, onSigned, setting } from './common.js';
import { st, money, pct, short, fundCode, books, holdersOf, now } from './og.js';
import { blocked } from './og.js';

const main = $('#main');
await start();
const Fm = await fundCode();
const P = await import(new URL('modules/partnership/index.js', ctx.r.base).href);
const UNIT = () => setting('partnership.unit_class', 'units');

function register() {
  const people = Object.values(st().participants).filter(p => p.status === 'active');
  const holders = st().m.shares?.classes?.[UNIT()]?.holders || {};
  const total = Object.values(holders).reduce((a, b) => a + b, 0) || 1;
  const certs = Object.fromEntries(P.certificates(ctx.r.records, UNIT()).filter(c => !c.cancelled).map(c => [c.partner, c]));
  const f = books();
  const office = (id) => ['treasurer', 'secretary'].filter(o => holdersOf(o).includes(id)).map(o => st().m.offices[o].title);
  const rows = people.map(p => ({ id: p.id, units: holders[p.id] || 0, value: f.units[p.id] ? Fm.position(f, p.id).value : null, since: p.admitted || p.joined })).sort((a, b) => b.units - a.units);
  return h('section', { class: 'card' }, h('h2', {}, `Partners (${people.length})`, h('a', { href: 'hall.html#/partnership' }, 'Certificates with signatures →')),
    h('div', { class: 'scroll' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Partner', 'Office', 'Partner since', 'Voting units', 'Interest', 'Capital', 'Certificate'].map((c, i) => h('th', { class: i > 2 ? 'n' : null }, c)))),
      h('tbody', {}, rows.map(r => h('tr', { class: me()?.id === r.id ? 'you' : null },
        h('td', {}, h('strong', {}, nameOf(r.id))), h('td', { class: 'fine' }, office(r.id).join(', ')), h('td', { class: 'fine' }, short(r.since)),
        h('td', { class: 'n' }, r.units.toLocaleString()), h('td', { class: 'n' }, pct(r.units / total)),
        h('td', { class: 'n' }, r.value === null ? '—' : money(r.value, { cents: false })),
        h('td', { class: 'n' }, certs[r.id] ? h('a', { href: `documents/certificate/${certs[r.id].number}.pdf`, target: '_blank', rel: 'noopener' }, `No. ${certs[r.id].number} (PDF)`) : '—')))))));
}

function officers() {
  const t = now();
  const elections = Object.values(st().m.elections || {}).filter(e => !e.counted);
  return h('section', { class: 'card' }, h('h2', {}, 'Officers'),
    h('table', { class: 'data' }, h('tbody', {}, ['treasurer', 'secretary'].filter(o => st().m.offices?.[o]).map(o => {
      const el = elections.find(e => e.office === o);
      return h('tr', {}, h('td', {}, h('strong', {}, st().m.offices[o].title)), h('td', {}, holdersOf(o).map(nameOf).join(', ') || h('em', {}, 'vacant')),
        h('td', { class: 'fine' }, el ? [t <= el.standUntil ? `Candidacy open until ${short(el.standUntil)} · ` : `Voting until ${short(el.voteUntil)} · `, h('a', { href: `hall.html#/elections/${el.id}` }, t <= el.standUntil ? 'Stand' : 'Vote')] : ''));
    }))),
    h('p', { class: 'fine' }, 'The Treasurer keeps the books and the accounts; the Secretary keeps the roll, calls meetings and sends invitations. Each is elected for a year, and nobody holds both.'));
}

function applicants() {
  const list = Object.values(st().participants).filter(p => p.status === 'applicant');
  if (!list.length) return null;
  const A = ctx.agreements, Pm = ctx.r.params;
  const owes = (id) => (A ? A.outstanding(st(), id, Pm) : []);
  return h('section', { class: 'card', id: 'applicants' }, h('h2', {}, 'Applying to join'),
    h('table', { class: 'data' }, h('tbody', {}, list.map(p => h('tr', {}, h('td', {}, h('strong', {}, nameOf(p.id))), h('td', { class: 'fine' }, `applied ${short(p.joined)}`),
      h('td', { class: 'fine' }, owes(p.id).length ? 'has not signed the agreement' : 'has signed the agreement'),
      h('td', { class: 'n' }, me()?.status === 'active' && !owes(p.id).length ? h('button', { class: 'secondary', onclick: () => propose(`Admit ${nameOf(p.id)} as a partner`, [{ kind: 'participant.admit', id: p.id }]) }, 'Propose admitting') : null))))),
    h('p', { class: 'fine' }, 'Admitting a partner is a joint resolution. Someone the partners have already agreed on can be sent a personal invitation instead.'));
}

function draw() {
  if (!ctx.r?.ok) { main.replaceChildren(blocked()); return; }
  main.replaceChildren(h('div', { class: 'og-page' },
    h('div', { class: 'og-head' }, h('div', {}, h('h1', {}, 'Partners'), h('p', {}, 'Each partner has one vote and votes their units with it.')),
      ctx.r.params.value('entity.modules').includes('invites') ? h('a', { class: 'button primary', href: 'hall.html#/invites' }, 'Invite someone') : null),
    h('div', { class: 'stack' }, register(), h('div', { class: 'grid grid-even' }, officers(), applicants() || h('section', { class: 'card' }, h('h2', {}, 'Applying to join'), h('p', { class: 'hint' }, 'No one is applying right now.'))))));
}
onChange(draw); onSigned(draw); draw();
