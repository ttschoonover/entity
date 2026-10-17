// fund · the books of an investment club: members' capital in units, cash,
// holdings, trades the members voted for, income, expenses and withdrawals.
//
// The unit value method. The club's value (cash plus every holding at its last
// recorded price) is divided into units. A member who pays in buys units at the
// current unit value; a member who withdraws sells units back at it. So every
// member's share of the club is their units ÷ all units, however much and
// whenever each paid in.
//
// Every member decides every investment. A trade happens in two steps:
//   fund.authorize  a DECISION of the members: buy or sell up to a quantity of a
//                   security, optionally within a price limit, before a date
//   fund.fill       the treasurer records what was actually traded at the broker,
//                   within that authorization and no further
// fund.fill, and the treasurer's other bookkeeping (fund.contribute, fund.income,
// fund.expense, fund.valuation), are effects: granted to a treasurer office with
// the authority module, or recorded by decision. Nothing can be bought or sold
// that the members did not vote for.
//
// Amounts are in cents; unit counts and share quantities in millionths
// (integers), so the arithmetic is exact and every copy agrees.

import { originOf } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const M = 1_000_000n;          // millionths
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SYM = /^[A-Z0-9.\-]{1,12}$/;
const DAY = 86400000;
const book = (state) => (state.m.fund ||= { cash: 0, units: {}, holdings: {}, prices: {}, authorizations: {}, ledger: [], contributed: {}, withdrawn: {}, realized: 0, income: 0, expenses: 0 });
const cents = (n) => Number.isSafeInteger(n) && n > 0;
const params = (state) => new Parameters(state.doc, state.catalog);

// A quantity given as a number (e.g. 12.5 shares) → millionths, exactly, or null.
export function micro(x) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return null;
  const q = Math.round(x * 1e6);
  return Math.abs(q - x * 1e6) < 1e-6 && Number.isSafeInteger(q) ? q : null;
}
const fromMicro = (q) => Number(q) / 1e6;

// The club's value in cents: cash plus every holding at its last price.
export function nav(f) {
  let v = BigInt(f.cash);
  for (const [s, h] of Object.entries(f.holdings)) v += BigInt(h.qty) * BigInt(f.prices[s]?.price ?? 0) / M;
  return v;
}
export const totalUnits = (f) => Object.values(f.units).reduce((a, u) => a + BigInt(u), 0n);
// Cents per whole unit, as a BigInt; the initial value before anyone has units.
export function unitValue(f, initial) {
  const u = totalUnits(f);
  return u === 0n ? BigInt(initial) : nav(f) * M / u;
}
// A member's position: units (millionths), value in cents, share of the club.
export function position(f, id) {
  const u = BigInt(f.units[id] || 0), t = totalUnits(f);
  const value = t === 0n ? 0n : nav(f) * u / t;
  return { units: Number(u), value: Number(value), share: t === 0n ? 0 : Number(u * 10000n / t) / 10000, contributed: f.contributed[id] || 0, withdrawn: f.withdrawn[id] || 0 };
}
// Holdings whose last price is older than allowed: contributions and
// withdrawals would be priced on stale values.
function stale(state, at) {
  const f = state.m.fund, max = params(state).value('fund.valuation_max_days');
  return Object.keys(f?.holdings || {}).filter(s => !f.prices[s] || Date.parse(at) - Date.parse(f.prices[s].at) > max * DAY);
}
const holders = (f) => Object.keys(f.units).filter(id => f.units[id] > 0);

function install(r) {
  const eff = (def) => r.registerEffect({ module: 'fund', ...def });

  // ── the members' decisions ────────────────────────────────────────────────
  eff({
    name: 'fund.authorize',
    rule: (p) => p.value('fund.trade_rule'),
    describe: (e) => `Authorize the treasurer to ${e.side} up to ${e.quantity} ${e.symbol}${e.limit ? ` at ${e.side === 'buy' ? 'no more than' : 'no less than'} $${(e.limit / 100).toFixed(2)} a share` : ' at market'}, within ${e.days} days${e.reason ? ` (${e.reason})` : ''}`,
    check(state, e, p, at, ctx = {}) {
      if (ctx.via) return 'investment decisions are made by the members, never under a grant';
      if (!ID.test(e.id || '')) return 'an authorization id is 1–40 lowercase letters, digits and -';
      if (state.m.fund?.authorizations?.[e.id]) return `the authorization ${e.id} already exists`;
      if (!['buy', 'sell'].includes(e.side)) return 'side is buy or sell';
      if (!SYM.test(e.symbol || '')) return 'symbol is a ticker, e.g. VTI or BRK.B';
      if (micro(e.quantity) === null) return 'quantity is a positive number of shares (up to six decimals)';
      if (e.limit !== undefined && !cents(e.limit)) return 'limit is a price in cents';
      if (!Number.isInteger(e.days) || e.days < 1 || e.days > 90) return 'days is a whole number from 1 to 90';
      if (e.side === 'sell' && !(state.m.fund?.holdings?.[e.symbol]?.qty >= micro(e.quantity))) return `the club does not hold ${e.quantity} ${e.symbol}`;
      return null;
    },
  });
  r.registerRecord('fund.authorize', (state, rec) => {
    const e = rec.payload;
    book(state).authorizations[e.id] = { id: e.id, side: e.side, symbol: e.symbol, max: micro(e.quantity), limit: e.limit ?? null, until: new Date(Date.parse(rec.at) + e.days * DAY).toISOString(),
      reason: e.reason || '', filled: 0, fills: [], at: rec.at, by: originOf(e), cancelled: null };
  });
  eff({
    name: 'fund.cancel',
    rule: (p) => p.value('fund.trade_rule'),
    describe: (e) => `Cancel the authorization ${e.id}`,
    check: (state, e) => { const a = state.m.fund?.authorizations?.[e.id]; return !a || a.cancelled ? `there is no open authorization ${e.id}` : null; },
  });
  r.registerRecord('fund.cancel', (state, rec) => { book(state).authorizations[rec.payload.id].cancelled = rec.at; });

  eff({
    name: 'fund.withdraw',
    rule: (p) => p.value('fund.withdraw_rule'),
    describe: (e) => e.all ? `Pay out ${e.member}'s whole stake` : `Pay ${e.member} $${(e.amount / 100).toFixed(2)} from their stake`,
    check(state, e, p, at) {
      const f = state.m.fund;
      if (!f || !f.units[e.member]) return `${e.member} holds no units`;
      const s = stale(state, at); if (s.length) return `value the holdings first (no recent price for ${s.join(', ')})`;
      const pos = position(f, e.member);
      if (!e.all && !cents(e.amount)) return 'give an amount in cents, or all: true';
      const gross = e.all ? pos.value : e.amount;
      if (gross > pos.value) return `${e.member}'s stake is worth $${(pos.value / 100).toFixed(2)}`;
      return gross > f.cash ? `the club has $${(f.cash / 100).toFixed(2)} in cash: sell holdings first` : null;
    },
  });
  r.registerRecord('fund.withdraw', (state, rec) => {
    const e = rec.payload, f = book(state), p = params(state);
    const pos = position(f, e.member);
    const gross = e.all ? pos.value : e.amount;
    const units = e.all ? BigInt(f.units[e.member]) : BigInt(gross) * totalUnits(f) / nav(f) + 1n;
    const burn = units > BigInt(f.units[e.member]) ? BigInt(f.units[e.member]) : units;
    const fee = Math.floor(gross * p.value('fund.withdrawal_fee'));
    f.units[e.member] = Number(BigInt(f.units[e.member]) - burn); if (!f.units[e.member]) delete f.units[e.member];
    f.cash -= gross - fee;
    f.withdrawn[e.member] = (f.withdrawn[e.member] || 0) + gross - fee;
    f.ledger.push({ at: rec.at, kind: 'withdrawal', member: e.member, amount: -(gross - fee), units: -Number(burn), fee, by: originOf(e) });
  });

  // ── the treasurer's bookkeeping (a grant, or a decision) ──────────────────
  eff({
    name: 'fund.contribute',
    rule: (p) => p.value('fund.books_rule'),
    describe: (e) => `Record $${(e.amount / 100).toFixed(2)} paid in by ${e.member}`,
    check(state, e, p, at, ctx = {}) {
      if (!['active'].includes(state.participants[e.member]?.status)) return `${e.member} is not an active member`;
      // Whatever admission requires (a signed partnership agreement, say), paying in requires too.
      for (const c of ctx.registry?.admissionChecks || []) {
        if (!p.value('entity.modules').includes(c.module)) continue;
        const why = c.check(state, e.member, p); if (why) return `${e.member} ${why}`;
      }
      if (!cents(e.amount)) return 'amount is in cents, above zero';
      const f = state.m.fund || { units: {}, holdings: {} };
      if (!f.units[e.member] && holders(f).length >= p.value('fund.max_members')) return `the club already has ${p.value('fund.max_members')} members with capital, its limit`;
      const s = stale(state, at); if (s.length) return `value the holdings first (no recent price for ${s.join(', ')})`;
      const max = p.value('fund.max_share');
      if (max < 1 && f.units && totalUnits(f) > 0n) {
        const after = BigInt(position(f, e.member).value + e.amount), whole = nav(f) + BigInt(e.amount);
        if (after * 10000n > whole * BigInt(Math.round(max * 10000))) return `this would give ${e.member} more than ${Math.round(max * 100)}% of the club`;
      }
      return null;
    },
  });
  r.registerRecord('fund.contribute', (state, rec) => {
    const e = rec.payload, f = book(state);
    // Units in exact proportion to the club's value: no rounding of the unit
    // value first, so earlier members are never diluted by a fraction of a cent.
    const total = totalUnits(f), before = nav(f);
    const units = total === 0n ? BigInt(e.amount) * M / BigInt(params(state).value('fund.initial_unit_value')) : BigInt(e.amount) * total / before;
    const uv = total === 0n ? BigInt(params(state).value('fund.initial_unit_value')) * 1000n : before * M * 1000n / total;
    f.units[e.member] = Number(BigInt(f.units[e.member] || 0) + units);
    f.cash += e.amount;
    f.contributed[e.member] = (f.contributed[e.member] || 0) + e.amount;
    f.ledger.push({ at: rec.at, kind: 'contribution', member: e.member, amount: e.amount, units: Number(units), unitValue: Number(uv) / 1000, by: originOf(e) });
  });

  eff({
    name: 'fund.fill',
    rule: (p) => p.value('fund.books_rule'),
    describe: (e) => `Record the ${e.authorization} trade: ${e.quantity} at $${(e.price / 100).toFixed(2)}${e.fees ? ` (fees $${(e.fees / 100).toFixed(2)})` : ''}`,
    check(state, e, p, at) {
      const a = state.m.fund?.authorizations?.[e.authorization];
      if (!a || a.cancelled) return `there is no open authorization ${e.authorization}`;
      if (at > a.until) return `the authorization ${a.id} expired on ${a.until.slice(0, 10)}`;
      const q = micro(e.quantity);
      if (q === null) return 'quantity is a positive number of shares';
      if (a.filled + q > a.max) return `that exceeds the ${fromMicro(a.max)} the members authorized (${fromMicro(a.filled)} done)`;
      if (!cents(e.price)) return 'price is in cents a share';
      if (e.fees !== undefined && !(Number.isSafeInteger(e.fees) && e.fees >= 0)) return 'fees are in cents';
      if (a.limit && (a.side === 'buy' ? e.price > a.limit : e.price < a.limit)) return `the members set a limit of $${(a.limit / 100).toFixed(2)}`;
      const f = state.m.fund;
      const cost = Number(BigInt(q) * BigInt(e.price) / M) + (e.fees || 0);
      if (a.side === 'buy' && cost > f.cash) return `the club has $${(f.cash / 100).toFixed(2)} in cash; this costs $${(cost / 100).toFixed(2)}`;
      if (a.side === 'sell' && !(f.holdings[a.symbol]?.qty >= q)) return `the club holds only ${fromMicro(f.holdings[a.symbol]?.qty || 0)} ${a.symbol}`;
      return null;
    },
  });
  r.registerRecord('fund.fill', (state, rec) => {
    const e = rec.payload, f = book(state), a = f.authorizations[e.authorization], q = micro(e.quantity), fees = e.fees || 0;
    const gross = Number(BigInt(q) * BigInt(e.price) / M);
    const h = (f.holdings[a.symbol] ||= { qty: 0, cost: 0 });
    let realized = 0;
    if (a.side === 'buy') { h.qty += q; h.cost += gross + fees; f.cash -= gross + fees; }
    else {
      const basis = Number(BigInt(h.cost) * BigInt(q) / BigInt(h.qty));
      realized = gross - fees - basis;
      h.qty -= q; h.cost -= basis; f.cash += gross - fees; f.realized += realized;
      if (!h.qty) delete f.holdings[a.symbol];
    }
    f.prices[a.symbol] = { price: e.price, at: rec.at, source: `trade ${a.id}` };
    a.filled += q; a.fills.push({ at: rec.at, quantity: q, price: e.price, fees });
    f.ledger.push({ at: rec.at, kind: a.side, symbol: a.symbol, quantity: q, price: e.price, fees, amount: a.side === 'buy' ? -(gross + fees) : gross - fees, realized, authorization: a.id, by: originOf(e) });
  });

  eff({
    name: 'fund.valuation',
    rule: (p) => p.value('fund.books_rule'),
    describe: (e) => `Record market prices: ${Object.entries(e.prices || {}).map(([s, c]) => `${s} $${(c / 100).toFixed(2)}`).join(', ')}${e.source ? ` (${e.source})` : ''}`,
    check(state, e) {
      if (!e.prices || typeof e.prices !== 'object' || !Object.keys(e.prices).length) return 'prices is { SYMBOL: cents, … }';
      for (const [s, c] of Object.entries(e.prices)) { if (!SYM.test(s)) return `${s} is not a ticker`; if (!cents(c)) return `the price of ${s} is in cents`; }
      return null;
    },
  });
  r.registerRecord('fund.valuation', (state, rec) => {
    const e = rec.payload, f = book(state);
    for (const [s, c] of Object.entries(e.prices)) f.prices[s] = { price: c, at: rec.at, source: e.source || originOf(e) };
    f.ledger.push({ at: rec.at, kind: 'valuation', prices: e.prices, nav: Number(nav(f)), by: originOf(e) });
  });

  for (const [name, sign] of [['fund.income', 1], ['fund.expense', -1]]) {
    eff({
      name,
      rule: (p) => p.value('fund.books_rule'),
      describe: (e) => `Record ${sign > 0 ? 'income' : 'an expense'} of $${(e.amount / 100).toFixed(2)}: ${e.memo}`,
      check(state, e) {
        if (!cents(e.amount)) return 'amount is in cents, above zero';
        if (typeof e.memo !== 'string' || !e.memo.trim() || e.memo.length > 200) return 'say what it was (1–200 characters)';
        return sign < 0 && e.amount > (state.m.fund?.cash || 0) ? 'the club does not have that much cash' : null;
      },
    });
    r.registerRecord(name, (state, rec) => {
      const e = rec.payload, f = book(state);
      f.cash += sign * e.amount;
      if (sign > 0) f.income += e.amount; else f.expenses += e.amount;
      f.ledger.push({ at: rec.at, kind: sign > 0 ? 'income' : 'expense', amount: sign * e.amount, memo: e.memo, symbol: e.symbol || null, by: originOf(e) });
    });
  }

  // decision.electorate "fund": members vote in proportion to their units, for
  // clubs that decide by capital rather than one member, one vote.
  r.registerElectorate({
    name: 'fund', module: 'fund',
    describe: () => 'members, in proportion to their units in the club',
    check: (state, arg) => (arg ? '"fund" takes no argument' : null),
    roll: (state) => Object.fromEntries(Object.entries(state.m.fund?.units || {}).map(([id, u]) => [id, Math.max(1, Math.round(u / 1e6))])),
  });
}

export default { name: 'fund', core: '0.7', install, nav, unitValue, totalUnits, position, micro,
  parameterKeys: ['fund.currency', 'fund.initial_unit_value', 'fund.max_members', 'fund.max_share', 'fund.withdrawal_fee', 'fund.valuation_max_days', 'fund.trade_rule', 'fund.books_rule', 'fund.withdraw_rule'] };
