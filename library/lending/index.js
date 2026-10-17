// lending · the entity's things, borrowed and returned: the cargo bike, the
// projector, the guest room. Anything registered as a deed and held by the
// entity itself (holder: null) can be lent, unless lending.except names it.
//
//   loan.borrow  { deed, days? }     an active member borrows it, until a due date
//   loan.renew   { deed, days? }     the borrower extends it, up to lending.max_renewals times
//   loan.return  { deed }            the borrower gives it back
//   loan.recall  { deed, reason }    an effect: a decision (or a grant, say to a
//                                    librarian office) ends a loan early
//
// Overdue loans are shown, not punished: what follows is for the members to
// decide. This module reads the deeds module's state and imports none of it.

import { originOf } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
const book = (state) => (state.m.lending = state.m.lending || { loans: [], out: {} });
const deed = (state, id) => state.m.deeds?.[id] || null;

// The loan currently out on this deed, if any. A deed that has since left the
// entity's hands (assigned or retired by decision) is no longer on loan.
export function current(state, id) {
  const i = state.m.lending?.out?.[id];
  if (i === undefined) return null;
  const d = deed(state, id);
  return d && !d.retired && d.holder === null ? state.m.lending.loans[i] : null;
}
export const overdue = (loan, at) => !!loan && at > loan.due;

function lendable(state, id, params) {
  const d = deed(state, id);
  if (!d || d.retired) return `there is no deed ${id}`;
  if (d.holder !== null) return `${id} is held by ${d.holder}, not by the entity`;
  if (params.value('lending.except').includes(id)) return `${id} is not lent out`;
  return null;
}
const daysWhy = (days, params) => {
  const max = params.value('lending.max_days');
  return days === undefined || (Number.isInteger(days) && days >= 1 && days <= max) ? null : `days is a whole number from 1 to ${max}`;
};

function install(r) {
  r.registerKind({
    name: 'loan.borrow', module: 'lending',
    check(state, act, { params }) {
      if (state.participants[act.by].status !== 'active') return 'only active members may borrow';
      const why = lendable(state, act.deed, params); if (why) return why;
      const out = current(state, act.deed);
      if (out) return `${act.deed} is out with ${out.by} until ${out.due}`;
      const mine = Object.keys(state.m.lending?.out || {}).filter(d => current(state, d)?.by === act.by);
      const max = params.value('lending.max_per_member');
      if (max > 0 && mine.length >= max) return `you already have ${mine.length} thing(s) out; the limit is ${max}`;
      return daysWhy(act.days, params);
    },
    reduce(state, rec) {
      const a = rec.payload.act, l = book(state);
      // A loan left open when its deed passed out of the entity's hands ends here.
      const stale = l.out[a.deed] !== undefined ? l.loans[l.out[a.deed]] : null;
      if (stale && !stale.returned) { stale.returned = rec.at; stale.how = 'ended: the deed left the entity'; }
      const days = a.days ?? new Parameters(state.doc, state.catalog).value('lending.default_days');
      l.loans.push({ deed: a.deed, by: a.by, at: rec.at, due: addDays(rec.at, days), renewals: 0, returned: null, how: null });
      l.out[a.deed] = l.loans.length - 1;
    },
  });
  r.registerKind({
    name: 'loan.renew', module: 'lending',
    check(state, act, { params }) {
      const out = current(state, act.deed);
      if (!out || out.by !== act.by) return `you have not borrowed ${act.deed}`;
      if (out.renewals >= params.value('lending.max_renewals')) return `renewed ${out.renewals} time(s) already, the limit`;
      return daysWhy(act.days, params);
    },
    reduce(state, rec) {
      const a = rec.payload.act, out = current(state, a.deed);
      const days = a.days ?? new Parameters(state.doc, state.catalog).value('lending.default_days');
      out.due = addDays(rec.at > out.due ? rec.at : out.due, days); out.renewals++;
    },
  });
  r.registerKind({
    name: 'loan.return', module: 'lending',
    check(state, act) { const out = current(state, act.deed); return out && out.by === act.by ? null : `you have not borrowed ${act.deed}`; },
    reduce(state, rec) { end(state, rec.payload.act.deed, rec.at, rec.at > current(state, rec.payload.act.deed).due ? 'returned late' : 'returned'); },
  });

  r.registerEffect({
    name: 'loan.recall', module: 'lending',
    rule: (p) => p.value('lending.recall_rule'),
    describe: (e) => `Recall ${e.deed} from its borrower (${e.reason})`,
    check(state, e) {
      if (!current(state, e.deed)) return `${e.deed} is not out on loan`;
      return typeof e.reason === 'string' && e.reason.trim() ? null : 'give a reason; it is published';
    },
  });
  r.registerRecord('loan.recall', (state, rec) => end(state, rec.payload.deed, rec.at, `recalled by ${originOf(rec.payload)}: ${rec.payload.reason}`));
}

function end(state, id, at, how) {
  const l = state.m.lending, out = l.loans[l.out[id]];
  out.returned = at; out.how = how;
  delete l.out[id];
}

export default { name: 'lending', core: '0.4.1', install, current, overdue,
  parameterKeys: ['lending.default_days', 'lending.max_days', 'lending.max_renewals', 'lending.max_per_member', 'lending.except', 'lending.recall_rule'] };
