// shares · share classes, a cap table, transfers, dividends, and voting by
// shares. For co-operatives (one member share each, plus investor shares), a
// company's founders and investors, or any entity that counts stakes.
//
// Effects (by decision, or by a grant):
//   share.class    { class, title, voting, transferable, note? }   a new class
//   share.issue    { class, to, count, note? }                      new shares
//   share.redeem   { class, from, count, note? }                    cancelled shares
//   share.dividend { class, per_share, note? }                      pays per_share of the
//                  entity's unit (the value module) on every share of the class; each
//                  holder's payment is rounded down to a whole smallest unit, and the
//                  rounding is published
// Acts:
//   share.transfer { class, to, count }   if the class is transferable
//
// decision.electorate "shares:CLASS" (or "shares" for every voting class): the
// holders vote, one vote per share, counted when a proposal is laid.

import { originOf } from '../../kernel/effects.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const whole = (n) => Number.isSafeInteger(n) && n > 0;
const book = (state) => (state.m.shares ||= { classes: {}, history: [] });
export const cls = (state, id) => state.m.shares?.classes?.[id] || null;
export const held = (state, c, id) => cls(state, c)?.holders[id] || 0;
export const outstanding = (c) => Object.values(c.holders).reduce((a, b) => a + b, 0);
const member = (state, id) => ['active', 'applicant'].includes(state.participants[id]?.status);

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
  amend({ name: 'share.amend', of: 'shares', key: 'class', label: 'the share class',
    extra: { createKind: 'share.class', get: (s, id) => s.m.shares?.classes?.[id] || null },
    fields: {
      title: (v) => (typeof v === 'string' && v.trim() && v.length <= 60 ? null : 'a title is 1–60 characters'),
      voting: (v) => (typeof v === 'boolean' ? null : 'voting is true or false'),
      transferable: (v) => (typeof v === 'boolean' ? null : 'transferable is true or false'),
      note: (v) => (typeof v === 'string' && v.length <= 500 ? null : 'a note is at most 500 characters'),
    } });

  r.registerEffect({
    name: 'share.class', module: 'shares',
    rule: (p) => p.value('shares.class_rule'),
    describe: (e) => `Create the share class "${e.title}" (${e.voting ? 'voting' : 'non-voting'}, ${e.transferable ? 'transferable' : 'not transferable'})`,
    check(state, e) {
      if (!ID.test(e.class || '')) return 'a class id is 1–40 lowercase letters, digits and -';
      if (cls(state, e.class)) return `the class ${e.class} already exists`;
      if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 60) return 'a class needs a title of 1–60 characters';
      if (typeof e.voting !== 'boolean' || typeof e.transferable !== 'boolean') return 'say whether the class votes and whether it may be transferred (true or false)';
      return null;
    },
  });
  r.registerEffect({
    name: 'share.issue', module: 'shares',
    rule: (p) => p.value('shares.issue_rule'),
    describe: (e) => `Issue ${e.count} ${e.class} share(s) to ${e.to}${e.note ? ` (${e.note})` : ''}`,
    check(state, e) {
      if (!cls(state, e.class)) return `there is no share class ${e.class}`;
      if (!member(state, e.to)) return `${e.to} is not a member`;
      return whole(e.count) ? null : 'count is a whole number above zero';
    },
  });
  r.registerEffect({
    name: 'share.redeem', module: 'shares',
    rule: (p) => p.value('shares.issue_rule'),
    describe: (e) => `Redeem ${e.count} ${e.class} share(s) from ${e.from}${e.note ? ` (${e.note})` : ''}`,
    check(state, e) {
      if (!cls(state, e.class)) return `there is no share class ${e.class}`;
      if (!whole(e.count)) return 'count is a whole number above zero';
      return held(state, e.class, e.from) >= e.count ? null : `${e.from} holds only ${held(state, e.class, e.from)}`;
    },
  });
  r.registerEffect({
    name: 'share.dividend', module: 'shares',
    rule: (p) => p.value('shares.dividend_rule'),
    describe: (e) => `Pay a dividend of ${e.per_share} per ${e.class} share${e.note ? ` (${e.note})` : ''}`,
    check(state, e, p) {
      const c = cls(state, e.class);
      if (!c) return `there is no share class ${e.class}`;
      if (!p.has('value.name')) return 'dividends are paid in the entity\'s unit: enable the value module';
      if (!(typeof e.per_share === 'number' && e.per_share > 0 && e.per_share <= 1e12)) return 'per_share is a positive number of smallest units';
      const total = Object.values(c.holders).reduce((a, n) => a + Math.floor(n * e.per_share), 0);
      if (!total) return 'nobody holds enough shares for this to pay anything';
      const max = p.value('value.max_supply');
      return max && (state.m.value?.supply || 0) + total > max ? `this would pay ${total}, beyond value.max_supply` : null;
    },
  });

  const log = (state, rec, what) => book(state).history.push({ at: rec.at, what, by: originOf(rec.payload) });
  r.registerRecord('share.class', (state, rec) => {
    const e = rec.payload;
    book(state).classes[e.class] = { id: e.class, title: e.title, voting: e.voting, transferable: e.transferable, note: e.note || '', created: rec.at, holders: {} };
    log(state, rec, `class ${e.class} created`);
  });
  r.registerRecord('share.issue', (state, rec) => {
    const e = rec.payload, c = cls(state, e.class);
    c.holders[e.to] = (c.holders[e.to] || 0) + e.count;
    log(state, rec, `${e.count} ${e.class} issued to ${e.to}`);
  });
  r.registerRecord('share.redeem', (state, rec) => {
    const e = rec.payload, c = cls(state, e.class);
    c.holders[e.from] -= e.count; if (!c.holders[e.from]) delete c.holders[e.from];
    log(state, rec, `${e.count} ${e.class} redeemed from ${e.from}`);
  });
  // A dividend pays through the value module's ledger, directly: each holder's
  // share, rounded down; the rounding left over is published, never paid.
  r.registerRecord('share.dividend', (state, rec) => {
    const e = rec.payload, c = cls(state, e.class);
    const l = (state.m.value ||= { balances: {}, supply: 0 });
    let paid = 0, exact = 0;
    for (const [id, n] of Object.entries(c.holders)) {
      const amt = Math.floor(n * e.per_share); exact += n * e.per_share;
      if (amt > 0) { l.balances[id] = (l.balances[id] || 0) + amt; paid += amt; }
    }
    l.supply += paid;
    log(state, rec, `dividend of ${e.per_share} per ${e.class} share: ${paid} paid, ${Math.round((exact - paid) * 1000) / 1000} lost to rounding`);
  });

  r.registerKind({
    name: 'share.transfer', module: 'shares',
    check(state, act) {
      const c = cls(state, act.class);
      if (!c) return `there is no share class ${act.class}`;
      if (!c.transferable) return `${c.title} shares are not transferable`;
      if (!whole(act.count)) return 'count is a whole number above zero';
      if (held(state, act.class, act.by) < act.count) return `you hold only ${held(state, act.class, act.by)}`;
      if (act.to === act.by) return 'you already hold them';
      return member(state, act.to) ? null : `${act.to} is not a member`;
    },
    reduce(state, rec) {
      const a = rec.payload.act, c = cls(state, a.class);
      c.holders[a.by] -= a.count; if (!c.holders[a.by]) delete c.holders[a.by];
      c.holders[a.to] = (c.holders[a.to] || 0) + a.count;
      book(state).history.push({ at: rec.at, what: `${a.count} ${a.class} passed from ${a.by} to ${a.to}`, by: a.by });
    },
  });

  // "shares:CLASS" or "shares": holders of voting shares, one vote per share.
  r.registerElectorate({
    name: 'shares', module: 'shares',
    describe: (c) => (c ? `holders of ${c} shares, one vote per share` : 'holders of voting shares, one vote per share'),
    check: (state, c) => (c && !cls(state, c) ? `there is no share class ${c}` : c && !cls(state, c).voting ? `${c} shares do not vote` : null),
    roll(state, c) {
      const out = {};
      for (const k of Object.values(state.m.shares?.classes || {})) {
        if (c ? k.id !== c : !k.voting) continue;
        for (const [id, n] of Object.entries(k.holders)) out[id] = (out[id] || 0) + n;
      }
      return out;
    },
  });
}

export default { name: 'shares', core: '0.7.7', install, held, outstanding, parameterKeys: ['shares.class_rule', 'shares.issue_rule', 'shares.dividend_rule'] };
