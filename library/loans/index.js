// loans · a revolving loan fund: money the society lends its members and they
// pay back, interest-free. Like the budget, it records decisions about real
// money (held by the treasurer, in a bank); it does not move money itself.
// Amounts are whole smallest units (cents) of loans.currency.
//
// Effects (by decision, or by a grant, say to a lending committee or the treasurer):
//   loan.fund    { amount, source?, note? }       add capital to the fund
//   loan.make    { loan, to, amount, due, purpose? }   lend to an active member,
//                refused beyond what is available, loans.max_amount, or while
//                the member has loans.max_open loans outstanding
//   loan.repay   { loan, amount }                  record a repayment, which
//                returns to the fund for the next borrower
//   loan.forgive { loan, reason }                  write off what is left
// Overdue loans are shown, not punished: what follows is for the members.
// The endowment module may add to the fund (in this shape: state.m.loans.funded).

import { originOf } from '../../kernel/effects.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const whole = (n) => Number.isSafeInteger(n) && n > 0;
const book = (state) => (state.m.loans ||= { funded: 0, forgiven: 0, loans: {}, history: [] });
export const get = (state, id) => state.m.loans?.loans?.[id] || null;
export const owing = (l) => l.amount - l.repaid - l.forgiven;
export const outstanding = (state) => Object.values(state.m.loans?.loans || {}).reduce((a, l) => a + owing(l), 0);
// What can be lent now: everything ever put in, less what was written off, less what is out.
export const available = (state) => { const b = state.m.loans; return b ? b.funded - b.forgiven - outstanding(state) : 0; };
const openFor = (state, who) => Object.values(state.m.loans?.loans || {}).filter(l => l.to === who && owing(l) > 0).length;

function install(r) {
  const effect = (name, ruleKey, describe, check, reduce) => {
    r.registerEffect({ name, module: 'loans', rule: (p) => p.value(ruleKey), describe, check });
    r.registerRecord(name, reduce);
  };
  effect('loan.fund', 'loans.fund_rule', (e) => `Add ${e.amount} to the loan fund${e.source ? ` from ${e.source}` : ''}`,
    (state, e) => (!whole(e.amount) ? 'amount is a whole number of smallest units, above zero'
      : e.source !== undefined && (typeof e.source !== 'string' || e.source.length > 80) ? 'source is at most 80 characters' : null),
    (state, rec) => { const e = rec.payload, b = book(state); b.funded += e.amount; b.history.push({ at: rec.at, what: 'fund', amount: e.amount, source: e.source || '', note: e.note || '', by: originOf(e) }); });

  effect('loan.make', 'loans.lend_rule', (e) => `Lend ${e.amount} to ${e.to}, due ${String(e.due).slice(0, 10)}${e.purpose ? `: ${e.purpose}` : ''}`,
    (state, e, params, at) => {
      if (!ID.test(e.loan || '')) return 'a loan id is 1–40 lowercase letters, digits and -';
      if (get(state, e.loan)) return `there is already a loan ${e.loan}`;
      if (state.participants[e.to]?.status !== 'active') return 'lend only to an active member';
      if (!whole(e.amount)) return 'amount is a whole number of smallest units, above zero';
      const max = params.value('loans.max_amount');
      if (max && e.amount > max) return `a single loan is at most ${max} here (loans.max_amount)`;
      if (Number.isNaN(Date.parse(e.due)) || (at && e.due <= at)) return 'due is a date in the future';
      if (e.purpose !== undefined && (typeof e.purpose !== 'string' || e.purpose.length > 200)) return 'purpose is at most 200 characters';
      if (openFor(state, e.to) >= params.value('loans.max_open')) return `${e.to} already has ${openFor(state, e.to)} loan(s) outstanding (loans.max_open)`;
      return e.amount > available(state) ? `only ${available(state)} is available to lend` : null;
    },
    (state, rec) => { const e = rec.payload; book(state).loans[e.loan] = { id: e.loan, to: e.to, amount: e.amount, due: e.due, purpose: e.purpose || '', made: rec.at, by: originOf(e), repaid: 0, forgiven: 0, payments: [] }; });

  effect('loan.repay', 'loans.lend_rule', (e) => `Record ${e.amount} repaid on the loan ${e.loan}`,
    (state, e) => { const l = get(state, e.loan); if (!l) return `there is no loan ${e.loan}`; if (!whole(e.amount)) return 'amount is a whole number of smallest units, above zero'; return e.amount > owing(l) ? `only ${owing(l)} is owed on ${e.loan}` : null; },
    (state, rec) => { const e = rec.payload, l = get(state, e.loan); l.repaid += e.amount; l.payments.push({ at: rec.at, amount: e.amount, by: originOf(e) }); if (!owing(l)) l.closed = rec.at; });

  effect('loan.forgive', 'loans.forgive_rule', (e) => `Forgive what is left of the loan ${e.loan}: ${e.reason}`,
    (state, e) => { const l = get(state, e.loan); if (!l || !owing(l)) return `there is no loan ${e.loan} with anything owed`; return typeof e.reason === 'string' && e.reason.trim() && e.reason.length <= 300 ? null : 'give a reason (up to 300 characters)'; },
    (state, rec) => { const e = rec.payload, l = get(state, e.loan), n = owing(l); l.forgiven += n; l.closed = rec.at; l.forgivenReason = e.reason; state.m.loans.forgiven += n; state.m.loans.history.push({ at: rec.at, what: 'forgive', loan: l.id, amount: n, by: originOf(e) }); });
}

export default { name: 'loans', core: '0.7.7', install, parameterKeys: ['loans.currency', 'loans.decimals', 'loans.max_amount', 'loans.max_open', 'loans.fund_rule', 'loans.lend_rule', 'loans.forgive_rule'] };
