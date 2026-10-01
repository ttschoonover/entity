// budget · money the members approve, and what is spent from it. The budget
// records decisions about real money (in the bank, in a till); it does not hold
// or move money itself. Amounts are whole smallest units (cents with
// budget.decimals 2) of budget.currency.
//
// Effects (by decision, or by a grant):
//   budget.line   { line, title, amount, period?, note? }   approve a line
//   budget.adjust { line, amount, note? }                  change what it may spend
//   budget.spend  { line, amount, payee, memo }            record spending against it;
//                 refused if it would exceed what is left
//   budget.close  { line }                                 no more spending
//
// The usual arrangement: the members approve lines by decision, and grant a
// Treasurer office `budget.spend` (the authority module). The Treasurer then
// records spending without a vote, never beyond a line, every entry published.

import { originOf } from '../../kernel/effects.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const whole = (n) => Number.isSafeInteger(n) && n > 0;
const line = (state, id) => state.m.budget?.lines?.[id] || null;
export const spent = (l) => l.spending.reduce((a, s) => a + s.amount, 0);
export const left = (l) => l.amount - spent(l);

function install(r) {
  // Amending: everything about it but its id, under the rule that created it.
  const amend = ({ name, of, key, label, fields, extra, apply }) => {
    r.registerEffect({
      name, module: of,
      rule: (p, e, registry) => registry.effects.get(of === 'authority' ? 'authority.grant' : extra.createKind).rule(p, e, registry),
      describe: (e) => `Amend ${label} ${e[key]}: ${Object.keys(e).filter(k => fields[k]).map(k => `${k} → ${JSON.stringify(e[k])}`).join(', ')}`,
      check(state, e, params, at, ctx = {}) {
        const it = extra.get(state, e[key]);
        if (!it) return `there is no ${label} ${e[key]}`;
        const changes = Object.keys(e).filter(k => fields[k]);
        if (!changes.length) return `say what to change: ${Object.keys(fields).join(', ')}`;
        for (const k of changes) { const why = fields[k](e[k], it, state, e); if (why) return why; }
        return extra.also ? extra.also(state, e, it, params, at, ctx) : null;
      },
    });
    r.registerRecord(name, (state, rec) => {
      const e = rec.payload, it = extra.get(state, e[key]);
      for (const k of Object.keys(e)) if (fields[k]) apply ? apply(it, k, e[k], rec) : (it[k] = e[k]);
      (it.amended ||= []).push({ at: rec.at, by: originOf(e), fields: Object.keys(e).filter(k => fields[k]) });
    });
  };
  amend({ name: 'budget.amend', of: 'budget', key: 'line', label: 'the budget line',
    extra: { createKind: 'budget.line', get: (s, id) => s.m.budget?.lines?.[id] || null },
    fields: {
      title: (v) => (typeof v === 'string' && v.trim() && v.length <= 80 ? null : 'a title is 1–80 characters'),
      period: (v) => (typeof v === 'string' && v.length <= 40 ? null : 'a period is at most 40 characters'),
      note: (v) => (typeof v === 'string' && v.length <= 500 ? null : 'a note is at most 500 characters'),
    } });

  r.registerEffect({
    name: 'budget.line', module: 'budget',
    rule: (p) => p.value('budget.approve_rule'),
    describe: (e) => `Approve the budget line "${e.title}": ${e.amount}${e.period ? ` for ${e.period}` : ''}`,
    check(state, e) {
      if (!ID.test(e.line || '')) return 'a line id is 1–40 lowercase letters, digits and -';
      if (line(state, e.line)) return `the line ${e.line} already exists`;
      if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 80) return 'a line needs a title of 1–80 characters';
      if (e.period !== undefined && (typeof e.period !== 'string' || e.period.length > 40)) return 'a period is at most 40 characters (e.g. "Fall 2026")';
      return whole(e.amount) ? null : 'amount is a whole number of smallest units, above zero';
    },
  });
  r.registerEffect({
    name: 'budget.adjust', module: 'budget',
    rule: (p) => p.value('budget.approve_rule'),
    describe: (e) => `Set the budget line ${e.line} to ${e.amount}${e.note ? ` (${e.note})` : ''}`,
    check(state, e) {
      const l = line(state, e.line);
      if (!l || l.closed) return `there is no open line ${e.line}`;
      if (!Number.isSafeInteger(e.amount) || e.amount < 0) return 'amount is a whole number of smallest units';
      return e.amount < spent(l) ? `${spent(l)} has already been spent from ${e.line}` : null;
    },
  });
  r.registerEffect({
    name: 'budget.spend', module: 'budget',
    rule: (p) => p.value('budget.spend_rule'),
    describe: (e) => `Spend ${e.amount} from ${e.line}, to ${e.payee}: ${e.memo}`,
    check(state, e) {
      const l = line(state, e.line);
      if (!l || l.closed) return `there is no open line ${e.line}`;
      if (!whole(e.amount)) return 'amount is a whole number of smallest units, above zero';
      if (typeof e.payee !== 'string' || !e.payee.trim() || e.payee.length > 120) return 'name the payee (1–120 characters)';
      if (typeof e.memo !== 'string' || !e.memo.trim() || e.memo.length > 300) return 'say what it was for (1–300 characters)';
      return e.amount > left(l) ? `only ${left(l)} is left on ${e.line}` : null;
    },
  });
  r.registerEffect({
    name: 'budget.close', module: 'budget',
    rule: (p) => p.value('budget.approve_rule'),
    describe: (e) => `Close the budget line ${e.line}`,
    check: (state, e) => (line(state, e.line) && !line(state, e.line).closed ? null : `there is no open line ${e.line}`),
  });

  r.registerRecord('budget.line', (state, rec) => {
    const e = rec.payload;
    (state.m.budget ||= { lines: {} }).lines[e.line] = { id: e.line, title: e.title, amount: e.amount, period: e.period || '', note: e.note || '',
      approved: rec.at, by: originOf(e), closed: null, spending: [], changes: [] };
  });
  r.registerRecord('budget.adjust', (state, rec) => {
    const l = line(state, rec.payload.line);
    l.changes.push({ at: rec.at, from: l.amount, to: rec.payload.amount, note: rec.payload.note || '', by: originOf(rec.payload) });
    l.amount = rec.payload.amount;
  });
  r.registerRecord('budget.spend', (state, rec) => {
    const e = rec.payload;
    line(state, e.line).spending.push({ at: rec.at, amount: e.amount, payee: e.payee, memo: e.memo, by: originOf(e) });
  });
  r.registerRecord('budget.close', (state, rec) => { line(state, rec.payload.line).closed = rec.at; });
}

export default { name: 'budget', core: '0.7.7', install, spent, left, parameterKeys: ['budget.currency', 'budget.decimals', 'budget.approve_rule', 'budget.spend_rule'] };
