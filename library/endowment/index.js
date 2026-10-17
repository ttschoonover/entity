// endowment · a permanent fund the society owns. Gifts become principal, which
// is never spent; the treasurer records its market value; each year the members
// may draw up to endowment.spend_rate of its latest value, and never so much
// that it falls below its principal. Like the budget, it records decisions
// about real money held elsewhere (a brokerage or bank account).
//
// Effects (by decision, or by a grant to the treasurer):
//   endowment.gift  { amount, from?, note? }         principal, kept forever
//   endowment.value { value, note? }                 the market value now
//   endowment.draw  { amount, to, note? }            to: "loans" (adds to the
//                   loan fund, in its shape) or "budget" (for budget lines)
// A year is endowment.year_start (MM-DD) to the same day the next year.

import { originOf } from '../../kernel/effects.js';

const whole = (n) => Number.isSafeInteger(n) && n > 0;
const book = (state) => (state.m.endowment ||= { principal: 0, value: 0, valued: null, gifts: [], values: [], draws: [] });
export const yearOf = (at, start = '01-01') => { const y = Number(at.slice(0, 4)); return at.slice(5, 10) >= start ? y : y - 1; };
export const drawnIn = (state, year, start) => (state.m.endowment?.draws || []).filter(d => yearOf(d.at, start) === year).reduce((a, d) => a + d.amount, 0);
export function drawable(state, params, at) {
  const b = state.m.endowment; if (!b) return 0;
  const start = params.value('endowment.year_start');
  const cap = Math.floor(b.value * params.value('endowment.spend_rate') / 10000) - drawnIn(state, yearOf(at, start), start);
  return Math.max(0, Math.min(cap, b.value - b.principal));
}

function install(r) {
  const effect = (name, describe, check, reduce) => {
    r.registerEffect({ name, module: 'endowment', rule: (p) => p.value(name === 'endowment.draw' ? 'endowment.draw_rule' : 'endowment.books_rule'), describe, check });
    r.registerRecord(name, reduce);
  };
  effect('endowment.gift', (e) => `Receive a gift of ${e.amount} into the endowment${e.from ? ` from ${e.from}` : ''}`,
    (state, e) => (whole(e.amount) ? (e.from !== undefined && (typeof e.from !== 'string' || e.from.length > 80) ? 'from is at most 80 characters' : null) : 'amount is a whole number of smallest units, above zero'),
    (state, rec) => { const e = rec.payload, b = book(state); b.principal += e.amount; b.value += e.amount; b.gifts.push({ at: rec.at, amount: e.amount, from: e.from || '', note: e.note || '', by: originOf(e) }); });
  effect('endowment.value', (e) => `Record the endowment's value: ${e.value}`,
    (state, e) => (Number.isSafeInteger(e.value) && e.value >= 0 ? null : 'value is a whole number of smallest units'),
    (state, rec) => { const e = rec.payload, b = book(state); b.value = e.value; b.valued = rec.at; b.values.push({ at: rec.at, value: e.value, note: e.note || '', by: originOf(e) }); });
  effect('endowment.draw', (e) => `Draw ${e.amount} from the endowment for ${e.to === 'loans' ? 'the loan fund' : 'the budget'}${e.note ? `: ${e.note}` : ''}`,
    (state, e, params, at) => {
      if (!whole(e.amount)) return 'amount is a whole number of smallest units, above zero';
      if (!['loans', 'budget'].includes(e.to)) return 'to is "loans" or "budget"';
      if (e.to === 'loans' && !params.value('entity.modules').includes('loans')) return 'the loans module is not installed';
      const max = drawable(state, params, at || new Date().toISOString());
      return e.amount > max ? `at most ${max} may be drawn now (the yearly limit, and never below the principal)` : null;
    },
    (state, rec) => {
      const e = rec.payload, b = book(state); b.value -= e.amount;
      b.draws.push({ at: rec.at, amount: e.amount, to: e.to, note: e.note || '', by: originOf(e) });
      if (e.to === 'loans') { const l = (state.m.loans ||= { funded: 0, forgiven: 0, loans: {}, history: [] }); l.funded += e.amount; l.history.push({ at: rec.at, what: 'fund', amount: e.amount, source: 'the endowment', note: e.note || '', by: originOf(e) }); }
    });
}

export default { name: 'endowment', core: '0.7.7', install, parameterKeys: ['endowment.currency', 'endowment.spend_rate', 'endowment.year_start', 'endowment.books_rule', 'endowment.draw_rule'] };
