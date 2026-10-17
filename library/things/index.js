// things · a library of things with cash deposits. Members lend each other
// what they own (a drill, a tent, a sewing machine), and the network lends
// what it holds in common; a borrower leaves a cash deposit with the lender,
// which comes back when the thing does. A member who cannot afford a deposit
// may ask the network's solidarity fund to stand behind it instead.
//
// The record keeps the books of every deposit: who holds whose money, for
// what, and what was kept and why. It does not move money: deposits are cash
// handed over in person, and the lender signs that they received it.
//
// Acts, signed by members:
//   thing.list     { thing, title, deposit, description?, category?, days?, where? }
//                  list something you own (deposit in the smallest unit; 0 for none)
//   thing.update   { thing, title?, deposit?, description?, category?, days?, where? }
//   thing.withdraw { thing }                  take it off the list (not while out)
//   thing.request  { thing, days?, cover? }   ask to borrow it; cover: ask the
//                  solidarity fund to stand behind the deposit
//   thing.cancel   { thing }                  withdraw your request
//   thing.lend     { thing, to, deposit }     the lender (owner, or keeper of a
//                  network thing) hands it over and signs that they received the
//                  deposit in cash (0 if the loan is covered)
//   thing.renew    { thing, days }            the lender gives the borrower longer
//   thing.return   { thing, kept?, note? }    the lender signs it came back; the
//                  deposit is refunded less `kept` (with a note saying why)
//   thing.returned { thing }                  the borrower says they gave it back,
//                  if the lender has not signed; it is shown, not decided
//   thing.dispute  { loan, reason }           the borrower disputes what was kept,
//                  within things.dispute_days
// Effects (by decision, or a grant, say to a librarian or a solidarity committee):
//   thing.add      { thing, title, keeper, deposit, … }   something the network owns
//   thing.keeper   { thing, keeper }          who keeps a network thing and lends it
//   thing.retire   { thing, reason }          a network thing leaves the library
//   thing.lost     { loan, note }             it never came back: the lender keeps the
//                  whole deposit (or is owed it by the fund, if covered)
//   thing.settle   { loan, refund, note }     resolve a dispute: the lender owes the
//                  borrower `refund` more (or the fund owes it less, if covered)
//   thing.pay      { claim, note? }           the fund has paid a lender's claim

import { originOf } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
const book = (state) => (state.m.things ||= { items: {}, loans: [], out: {}, requests: {}, claims: [] });
const P = (state) => new Parameters(state.doc, state.catalog);
const amount = (n) => Number.isSafeInteger(n) && n >= 0;
const text = (s, max) => s === undefined || (typeof s === 'string' && s.length <= max);
const active = (state, id) => state.participants[id]?.status === 'active';

export const item = (state, id) => state.m.things?.items?.[id] || null;
export const lender = (it) => (it.owner ?? it.keeper);
export const current = (state, id) => { const i = state.m.things?.out?.[id]; return i === undefined ? null : state.m.things.loans[i]; };
export const overdue = (loan, at) => !!loan && !loan.back && at > loan.due;
export const requestsFor = (state, id) => state.m.things?.requests?.[id] || [];
const loanAt = (state, n) => (Number.isInteger(n) ? state.m.things?.loans?.[n] || null : null);
// What a member holds in deposits for others, and has left with others, now.
export function deposits(state, who) {
  const out = (state.m.things?.loans || []).filter(l => !l.back && !l.lost);
  return { holding: out.filter(l => l.lender === who).reduce((a, l) => a + l.deposit, 0),
    left: out.filter(l => l.by === who).reduce((a, l) => a + l.deposit, 0) };
}
export const coverOpen = (state, who) => (state.m.things?.loans || []).filter(l => l.by === who && l.covered && !l.back && !l.lost).length;
export const claimsOwed = (state) => (state.m.things?.claims || []).filter(c => !c.paid).reduce((a, c) => a + c.amount, 0);

function fields(a, params, partial) {
  if (!partial) {
    if (!ID.test(a.thing || '')) return 'a thing id is 1–40 lowercase letters, digits and -';
    if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 80) return 'a title is 1–80 characters';
    if (!amount(a.deposit)) return 'deposit is a whole number of the smallest unit (cents), 0 for none';
  }
  if (a.title !== undefined && (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 80)) return 'a title is 1–80 characters';
  if (a.deposit !== undefined) {
    if (!amount(a.deposit)) return 'deposit is a whole number of the smallest unit (cents), 0 for none';
    const max = params.value('things.max_deposit');
    if (max && a.deposit > max) return `a deposit is at most ${max}`;
  }
  if (!text(a.description, 600)) return 'a description is at most 600 characters';
  if (!text(a.category, 40)) return 'a category is at most 40 characters';
  if (!text(a.where, 120)) return 'where is at most 120 characters';
  if (a.days !== undefined && (!Number.isInteger(a.days) || a.days < 1 || a.days > params.value('things.max_days'))) return `days is a whole number from 1 to ${params.value('things.max_days')}`;
  return null;
}
const pick = (a) => Object.fromEntries(['title', 'deposit', 'description', 'category', 'days', 'where'].filter(k => a[k] !== undefined).map(k => [k, typeof a[k] === 'string' ? a[k].trim() : a[k]]));

function install(r) {
  // ── listing ──────────────────────────────────────────────────────────────
  r.registerKind({
    name: 'thing.list', module: 'things',
    check(state, a, { params }) {
      if (!active(state, a.by)) return 'only active members may lend things';
      if (item(state, a.thing)) return `there is already a thing ${a.thing}`;
      return fields(a, params);
    },
    reduce(state, rec) { const a = rec.payload.act; book(state).items[a.thing] = { id: a.thing, owner: a.by, keeper: null, ...pick(a), listed: rec.at, withdrawn: null }; },
  });
  r.registerKind({
    name: 'thing.update', module: 'things',
    check(state, a, { params }) {
      const it = item(state, a.thing);
      if (!it || it.withdrawn) return `there is no thing ${a.thing}`;
      if (lender(it) !== a.by) return `only ${lender(it)} may change ${a.thing}`;
      return fields(a, params, true);
    },
    reduce(state, rec) { Object.assign(item(state, rec.payload.act.thing), pick(rec.payload.act)); },
  });
  r.registerKind({
    name: 'thing.withdraw', module: 'things',
    check(state, a) {
      const it = item(state, a.thing);
      if (!it || it.withdrawn) return `there is no thing ${a.thing}`;
      if (it.owner !== a.by) return it.owner ? `only ${it.owner} may withdraw ${a.thing}` : 'a network thing is retired by decision';
      return current(state, a.thing) ? `${a.thing} is out on loan` : null;
    },
    reduce(state, rec) { const it = item(state, rec.payload.act.thing); it.withdrawn = rec.at; delete book(state).requests[it.id]; },
  });

  // ── borrowing ────────────────────────────────────────────────────────────
  r.registerKind({
    name: 'thing.request', module: 'things',
    check(state, a, { params }) {
      if (!active(state, a.by)) return 'only active members may borrow';
      const it = item(state, a.thing);
      if (!it || it.withdrawn) return `there is no thing ${a.thing}`;
      if (lender(it) === a.by) return 'you cannot borrow your own thing';
      if (current(state, a.thing)?.by === a.by) return `you have ${a.thing} already`;
      if (requestsFor(state, a.thing).some(q => q.by === a.by)) return `you have asked for ${a.thing} already`;
      const max = params.value('things.max_out');
      const mine = (state.m.things?.loans || []).filter(l => l.by === a.by && !l.back && !l.lost).length;
      if (max && mine >= max) return `you have ${mine} thing(s) out; the limit is ${max}`;
      if (a.days !== undefined && (!Number.isInteger(a.days) || a.days < 1 || a.days > (it.days || params.value('things.max_days')))) return `days is a whole number from 1 to ${it.days || params.value('things.max_days')}`;
      if (a.cover !== undefined && typeof a.cover !== 'boolean') return 'cover is true or false';
      if (a.cover && it.deposit > 0) {
        if (!params.value('things.cover')) return 'the solidarity fund does not cover deposits at present';
        const lim = params.value('things.cover_limit');
        if (lim && it.deposit > lim) return `the solidarity fund covers deposits of up to ${lim}; this one is ${it.deposit}`;
        if (coverOpen(state, a.by) >= params.value('things.cover_max_open')) return `you have ${coverOpen(state, a.by)} covered loan(s) out; the limit is ${params.value('things.cover_max_open')}`;
      }
      return null;
    },
    reduce(state, rec) { const a = rec.payload.act; (book(state).requests[a.thing] ||= []).push({ by: a.by, at: rec.at, ...(a.days ? { days: a.days } : {}), cover: !!a.cover }); },
  });
  r.registerKind({
    name: 'thing.cancel', module: 'things',
    check: (state, a) => (requestsFor(state, a.thing).some(q => q.by === a.by) ? null : `you have not asked for ${a.thing}`),
    reduce(state, rec) { const a = rec.payload.act, b = book(state); b.requests[a.thing] = b.requests[a.thing].filter(q => q.by !== a.by); },
  });
  r.registerKind({
    name: 'thing.lend', module: 'things',
    check(state, a) {
      const it = item(state, a.thing);
      if (!it || it.withdrawn) return `there is no thing ${a.thing}`;
      if (lender(it) !== a.by) return `${a.thing} is lent by ${lender(it)}`;
      if (current(state, a.thing)) return `${a.thing} is out with ${current(state, a.thing).by}`;
      const q = requestsFor(state, a.thing).find(x => x.by === a.to);
      if (!q) return `${a.to} has not asked to borrow ${a.thing}`;
      if (!active(state, a.to)) return `${a.to} is not an active member`;
      const want = q.cover ? 0 : it.deposit;
      if (a.deposit !== want) return q.cover ? 'this loan is covered by the solidarity fund: no cash deposit (deposit 0)' : `sign for the deposit of ${it.deposit} you received`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, b = book(state), it = item(state, a.thing);
      const q = b.requests[a.thing].find(x => x.by === a.to);
      const days = q.days || it.days || P(state).value('things.default_days');
      b.loans.push({ n: b.loans.length, thing: a.thing, lender: a.by, by: a.to, at: rec.at, due: addDays(rec.at, days),
        deposit: a.deposit, covered: q.cover ? it.deposit : 0, back: null, kept: 0, note: '', said: null, dispute: null, lost: null, settled: null });
      b.out[a.thing] = b.loans.length - 1;
      b.requests[a.thing] = b.requests[a.thing].filter(x => x.by !== a.to);
    },
  });
  r.registerKind({
    name: 'thing.renew', module: 'things',
    check(state, a, { params }) {
      const l = current(state, a.thing);
      if (!l || l.lender !== a.by) return `you have not lent ${a.thing}`;
      return Number.isInteger(a.days) && a.days >= 1 && a.days <= params.value('things.max_days') ? null : `days is a whole number from 1 to ${params.value('things.max_days')}`;
    },
    reduce(state, rec) { const a = rec.payload.act, l = current(state, a.thing); l.due = addDays(rec.at > l.due ? rec.at : l.due, a.days); },
  });
  r.registerKind({
    name: 'thing.return', module: 'things',
    check(state, a) {
      const l = current(state, a.thing);
      if (!l || l.lender !== a.by) return `you have not lent ${a.thing}`;
      const kept = a.kept ?? 0, held = l.deposit || l.covered;
      if (!amount(kept) || kept > held) return `kept is a whole number from 0 to the deposit, ${held}`;
      if (kept > 0 && (typeof a.note !== 'string' || !a.note.trim() || a.note.length > 300)) return 'say why part of the deposit is kept (up to 300 characters); it is published';
      return text(a.note, 300) ? null : 'a note is at most 300 characters';
    },
    reduce(state, rec) {
      const a = rec.payload.act, b = book(state), l = current(state, a.thing);
      l.back = rec.at; l.kept = a.kept ?? 0; l.note = a.note || '';
      if (l.covered && l.kept) b.claims.push({ n: b.claims.length, loan: l.n, lender: l.lender, amount: l.kept, at: rec.at, paid: null });
      delete b.out[a.thing];
    },
  });
  r.registerKind({
    name: 'thing.returned', module: 'things',
    check(state, a) { const l = current(state, a.thing); return l && l.by === a.by ? (l.said ? 'you have said so already' : null) : `you have not borrowed ${a.thing}`; },
    reduce(state, rec) { current(state, rec.payload.act.thing).said = rec.at; },
  });
  r.registerKind({
    name: 'thing.dispute', module: 'things',
    check(state, a, { params }) {
      const l = loanAt(state, a.loan);
      if (!l || l.by !== a.by) return `you did not borrow on loan ${a.loan}`;
      if (!l.back || !l.kept) return 'only a returned loan with part of the deposit kept can be disputed';
      if (l.dispute) return 'it is disputed already';
      if (Date.parse(a.at) > Date.parse(l.back) + params.value('things.dispute_days') * DAY) return `disputes are made within ${params.value('things.dispute_days')} days of the return`;
      return typeof a.reason === 'string' && a.reason.trim() && a.reason.length <= 600 ? null : 'give your reason (up to 600 characters); it is published';
    },
    reduce(state, rec) { const a = rec.payload.act; loanAt(state, a.loan).dispute = { at: rec.at, reason: a.reason }; },
  });

  // ── what the network decides ─────────────────────────────────────────────
  const effect = (name, describe, check, reduce) => {
    r.registerEffect({ name, module: 'things', rule: (p) => p.value('things.rule'), describe, check });
    r.registerRecord(name, reduce);
  };
  effect('thing.add', (e) => `Add ${e.title} to the network's library, kept by ${e.keeper}, deposit ${e.deposit}`,
    (state, e, params) => (item(state, e.thing) ? `there is already a thing ${e.thing}` : !active(state, e.keeper) ? 'the keeper must be an active member' : fields(e, params)),
    (state, rec) => { const e = rec.payload; book(state).items[e.thing] = { id: e.thing, owner: null, keeper: e.keeper, ...pick(e), listed: rec.at, withdrawn: null, by: originOf(e) }; });
  effect('thing.keeper', (e) => `${e.keeper} keeps the network's ${e.thing}`,
    (state, e) => { const it = item(state, e.thing); return !it || it.withdrawn || it.owner ? `there is no network thing ${e.thing}` : current(state, e.thing) ? `${e.thing} is out on loan; change its keeper when it is back` : !active(state, e.keeper) ? 'the keeper must be an active member' : null; },
    (state, rec) => { item(state, rec.payload.thing).keeper = rec.payload.keeper; });
  effect('thing.retire', (e) => `Retire the network's ${e.thing} (${e.reason})`,
    (state, e) => { const it = item(state, e.thing); return !it || it.withdrawn || it.owner ? `there is no network thing ${e.thing}` : current(state, e.thing) ? `${e.thing} is out on loan` : typeof e.reason === 'string' && e.reason.trim() ? null : 'give a reason'; },
    (state, rec) => { const it = item(state, rec.payload.thing); it.withdrawn = rec.at; it.retired = rec.payload.reason; delete book(state).requests[it.id]; });
  effect('thing.lost', (e) => `Declare loan ${e.loan} lost: the lender keeps the deposit (${e.note})`,
    (state, e) => { const l = loanAt(state, e.loan); return !l || l.back || l.lost ? `loan ${e.loan} is not out` : typeof e.note === 'string' && e.note.trim() && e.note.length <= 300 ? null : 'give a note (up to 300 characters)'; },
    (state, rec) => {
      const e = rec.payload, b = book(state), l = loanAt(state, e.loan);
      l.lost = rec.at; l.kept = l.deposit || l.covered; l.note = e.note;
      if (l.covered) b.claims.push({ n: b.claims.length, loan: l.n, lender: l.lender, amount: l.covered, at: rec.at, paid: null });
      delete b.out[l.thing];
      const it = item(state, l.thing); if (it.owner) it.withdrawn = rec.at; else { it.withdrawn = rec.at; it.retired = 'lost'; }
    });
  effect('thing.settle', (e) => `Settle the dispute on loan ${e.loan}: ${e.refund} more back to the borrower (${e.note})`,
    (state, e) => {
      const l = loanAt(state, e.loan);
      if (!l || !l.dispute || l.settled) return `loan ${e.loan} has no open dispute`;
      if (!amount(e.refund) || e.refund > l.kept) return `refund is a whole number from 0 to what was kept, ${l.kept}`;
      return typeof e.note === 'string' && e.note.trim() && e.note.length <= 300 ? null : 'give the reasons (up to 300 characters)';
    },
    (state, rec) => {
      const e = rec.payload, l = loanAt(state, e.loan);
      l.settled = { at: rec.at, refund: e.refund, note: e.note, by: originOf(e) };
      if (l.covered) { const c = state.m.things.claims.find(x => x.loan === l.n && !x.paid); if (c) c.amount -= e.refund; }
    });
  effect('thing.pay', (e) => `Record that the solidarity fund paid claim ${e.claim}`,
    (state, e) => { const c = state.m.things?.claims?.[e.claim]; return !c || c.paid ? `claim ${e.claim} is not owed` : null; },
    (state, rec) => { state.m.things.claims[rec.payload.claim].paid = { at: rec.at, note: rec.payload.note || '', by: originOf(rec.payload) }; });
}

export default { name: 'things', core: '0.7.7', install, item, lender, current, overdue, deposits, coverOpen, claimsOwed, requestsFor,
  parameterKeys: ['things.currency', 'things.decimals', 'things.default_days', 'things.max_days', 'things.max_out', 'things.max_deposit',
    'things.cover', 'things.cover_limit', 'things.cover_max_open', 'things.dispute_days', 'things.rule'] };
