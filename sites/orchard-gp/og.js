// og.js · what the Orchard site's own pages share: money and units as people
// read them, the books as the fund module keeps them, who holds which office,
// and what a partner still has to do.
import { ctx, h, me, nameOf, setting } from './common.js';

export const st = () => ctx.r.state;
export const money = (c, { sign = false, cents = true } = {}) => {
  const v = Number(c) || 0;
  const s = (Math.abs(v) / 100).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}$${s}`;
};
export const qty = (m) => (Number(m) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 });
export const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
export const updown = (c) => (c > 0 ? 'up' : c < 0 ? 'down' : null);
export const short = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
export const firstName = (id) => String(nameOf(id) || id).split(/\s+/)[0];

let F = null;
export async function fundCode() {
  if (!F) F = await import(new URL('modules/fund/index.js', ctx.r.base).href);
  return F;
}
export const EMPTY = { cash: 0, units: {}, holdings: {}, prices: {}, authorizations: {}, ledger: [], contributed: {}, withdrawn: {}, realized: 0, income: 0, expenses: 0 };
export const books = () => st().m.fund || EMPTY;

// The club's figures, as the fund module computes them.
export function figures(Fm) {
  const f = books(), value = Number(Fm.nav(f)), t = Fm.totalUnits(f);
  const uv = t === 0n ? setting('fund.initial_unit_value', 1000) : Number(Fm.nav(f) * 1000000n / t);
  const invested = value - f.cash;
  const cost = Object.values(f.holdings).reduce((a, x) => a + x.cost, 0);
  return { value, cash: f.cash, invested, cost, unrealized: invested - cost, unitValue: uv, units: Number(t), realized: f.realized, income: f.income, expenses: f.expenses };
}

export const now = () => new Date().toISOString();
export const holdersOf = (office) => (st().m.offices?.[office]?.holders || []).filter(x => !x.until || x.until > now()).map(x => x.id);
export const isOfficer = (office, id = me()?.id) => !!id && holdersOf(office).includes(id);
export const bookkeeper = () => setting('fund.bookkeeper', '') || 'treasurer';
// The grant the bookkeeper keeps the books under: the one to that office permitting fund.contribute.
export const booksGrant = () => Object.values(st().m.authority?.grants || {}).find(g => !g.revoked && g.to?.office === bookkeeper() && g.may.includes('fund.contribute'))?.id || 'books';

export const openVotes = () => Object.values(st().proposals).filter(p => !p.closed).sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
export const myBallot = (p, id = me()?.id) => p.ballots.filter(b => b.by === id).at(-1)?.choice || null;

// What this partner still has to do, most important first.
export function todo() {
  const p = me(); if (!p) return [];
  const out = [], A = ctx.agreements, P = ctx.r.params;
  const owes = A && P.value('entity.modules').includes('agreements') ? A.outstanding(st(), p.id, P) : [];
  const drawn = P.has('agreements.drawn_signature') && P.value('agreements.drawn_signature') === 'required';
  const sig = (st().m.agreements?.[p.id]?.['partnership-agreement'] || []).at(-1);
  if (owes.length) out.push(['Sign the partnership agreement', 'Read it and sign with your drawn signature.', 'hall.html#/agreements', 'Sign']);
  else if (drawn && sig && !sig.drawing) out.push(['Add your drawn signature', 'Your signature is on the record; add the drawn one for the signed copy.', 'hall.html#/agreements', 'Add']);
  if (P.value('entity.modules').includes('details') && !st().m.details?.[p.id]) out.push(['Give your particulars', 'Needed for the tax returns and your Schedule K-1. Encrypted; never on the record.', 'hall.html#/details', 'Open']);
  const need = openVotes().filter(v => v.roll.includes(p.id) && !myBallot(v));
  if (need.length) out.push([`${need.length} vote${need.length > 1 ? 's' : ''} waiting for you`, `The next closes ${short(need[0].deadline)}.`, 'hall.html#/resolutions', 'Vote']);
  const applicants = Object.values(st().participants).filter(x => x.status === 'applicant');
  if (applicants.length && p.status === 'active') out.push([`${applicants.length} applicant${applicants.length > 1 ? 's' : ''}`, applicants.map(x => nameOf(x.id)).join(', '), 'partners.html#applicants', 'Review']);
  return out;
}

export function todoList(items) {
  return items.length ? h('ul', { class: 'todo' }, items.map(([t, s, href, b]) => h('li', {}, h('div', {}, h('strong', {}, t), h('span', {}, s)), h('a', { class: 'button secondary', href }, b))))
    : h('p', { class: 'hint' }, 'You’re all caught up.');
}

const KIND = { contribution: 'Contribution', withdrawal: 'Payout', buy: 'Bought', sell: 'Sold', income: 'Income', expense: 'Expense', valuation: 'Prices updated', opening: 'Opening balances' };
export function describeEntry(e) {
  if (e.kind === 'buy' || e.kind === 'sell') return `${KIND[e.kind]} ${qty(e.quantity)} ${e.symbol} at ${money(e.price)}`;
  if (e.kind === 'contribution') return `${KIND[e.kind]} from ${nameOf(e.member)}`;
  if (e.kind === 'withdrawal') return `${KIND[e.kind]} to ${nameOf(e.member)}`;
  if (e.kind === 'income' || e.kind === 'expense') return `${KIND[e.kind]}: ${e.memo}`;
  if (e.kind === 'valuation') return `${KIND[e.kind]}: ${Object.entries(e.prices).map(([s, c]) => `${s} ${money(c)}`).join(', ')}`;
  if (e.kind === 'opening') return `${KIND[e.kind]} as of ${e.as_of}`;
  return e.kind;
}
