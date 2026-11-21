// partnership · what a general partnership adds to an entity: the associations
// it joins, the claims they may make on its profits and assets, and the
// partnership certificates that evidence each partner's interest.
//
// Associations (by decision):
//   partnership.join    { association, name, terms }    the partnership joins it;
//                       rule partnership.join_rule (a concurrent rule: a share of the
//                       partners and a share of the units, e.g. 60% of each)
//   partnership.claim   { association, claim, on, share, cap?, terms? }
//                       grants the association a claim:
//                         on "profits": share, in basis points, of each distribution of
//                                       profits (rule partnership.profits_rule)
//                         on "assets":  share, in basis points, of the net assets on a
//                                       distribution of assets or dissolution, up to cap
//                                       (in cents) if given (rule partnership.assets_rule)
//                       Claims on profits together may never exceed the whole.
//   partnership.release { association, claim }        ends a claim, under the rule that granted it
//   partnership.leave   { association }                once its claims are released
//
// Certificates are not acts at all: they are read from the record. Every
// partner holds one, numbered in order, from the moment they are admitted; each
// change to their units cancels it and issues the next. So a certificate is
// issued automatically, and anyone holding the record can check it.

import { originOf } from '../../kernel/effects.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const book = (state) => (state.m.partnership ||= { associations: {} });
export const association = (state, id) => state.m.partnership?.associations?.[id] || null;
export const liveClaims = (a) => Object.values(a?.claims || {}).filter(c => !c.released);
export const profitShare = (state) => Object.values(state.m.partnership?.associations || {})
  .flatMap(liveClaims).filter(c => c.on === 'profits').reduce((n, c) => n + c.share, 0);

// A rule this module names must exist in the entity's document.
const ruleMissing = (params, key) => { const n = params.value(key); return n in params.rules ? null : `${key} names the rule "${n}", which this entity does not have`; };

function install(r) {
  const member = (state, id) => { const a = association(state, id); return a && !a.left ? a : null; };

  r.registerEffect({
    name: 'partnership.join', module: 'partnership',
    rule: (p) => p.value('partnership.join_rule'),
    describe: (e) => `Join the association "${e.name}" (${e.association})`,
    check(state, e, params) {
      const rm = ruleMissing(params, 'partnership.join_rule'); if (rm) return rm;
      if (!ID.test(e.association || '')) return 'an association id is 1–40 lowercase letters, digits and -';
      if (member(state, e.association)) return `the partnership already belongs to ${e.association}`;
      if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120) return 'an association needs a name of 1–120 characters';
      if (typeof e.terms !== 'string' || !e.terms.trim() || e.terms.length > 20000) return 'state the terms of membership (up to 20,000 characters): what it may ask of the partnership';
      return null;
    },
  });
  r.registerRecord('partnership.join', (state, rec) => {
    const e = rec.payload, was = association(state, e.association);
    book(state).associations[e.association] = { id: e.association, name: e.name.trim(), terms: e.terms, joined: rec.at, by: originOf(e), left: null,
      claims: was?.claims || {}, history: [...(was?.history || []), { at: rec.at, what: 'joined', by: originOf(e) }] };
  });

  r.registerEffect({
    name: 'partnership.claim', module: 'partnership',
    rule: (p, e) => p.value(e.on === 'assets' ? 'partnership.assets_rule' : 'partnership.profits_rule'),
    describe: (e) => `Grant ${e.association} a claim to ${(e.share / 100).toFixed(2)}% of the partnership's ${e.on === 'assets' ? 'net assets' : 'profits'}${e.cap ? `, up to ${(e.cap / 100).toFixed(2)}` : ''}`,
    check(state, e, params) {
      const rm = ruleMissing(params, e.on === 'assets' ? 'partnership.assets_rule' : 'partnership.profits_rule'); if (rm) return rm;
      const a = member(state, e.association);
      if (!a) return `the partnership does not belong to ${e.association}`;
      if (!ID.test(e.claim || '')) return 'a claim id is 1–40 lowercase letters, digits and -';
      if (a.claims[e.claim]) return `${e.association} already has a claim ${e.claim}`;
      if (!['profits', 'assets'].includes(e.on)) return 'a claim is on "profits" or on "assets"';
      if (!Number.isInteger(e.share) || e.share < 1 || e.share > 10000) return 'share is in basis points, 1 to 10000 (100 = 1%)';
      if (e.on === 'profits' && profitShare(state) + e.share > 10000) return `claims on profits would exceed the whole: ${(profitShare(state) / 100).toFixed(2)}% is already claimed`;
      if (e.cap !== undefined && (e.on !== 'assets' || !Number.isSafeInteger(e.cap) || e.cap < 1)) return 'a cap, in cents, applies only to a claim on assets';
      if (e.terms !== undefined && (typeof e.terms !== 'string' || e.terms.length > 5000)) return 'terms are at most 5,000 characters';
      return null;
    },
  });
  r.registerRecord('partnership.claim', (state, rec) => {
    const e = rec.payload, a = association(state, e.association);
    a.claims[e.claim] = { id: e.claim, on: e.on, share: e.share, ...(e.cap ? { cap: e.cap } : {}), terms: e.terms || '', since: rec.at, by: originOf(e), released: null };
    a.history.push({ at: rec.at, what: `claim ${e.claim} on ${e.on} granted`, by: originOf(e) });
  });

  r.registerEffect({
    name: 'partnership.release', module: 'partnership',
    rule: (p, e) => p.value(e.on === 'assets' ? 'partnership.assets_rule' : 'partnership.profits_rule'),
    describe: (e) => `End ${e.association}'s claim ${e.claim} on the partnership's ${e.on}`,
    check(state, e) {
      const c = association(state, e.association)?.claims?.[e.claim];
      if (!c || c.released) return `${e.association} has no claim ${e.claim} in force`;
      return c.on === e.on ? null : `that claim is on ${c.on}: say on "${c.on}"`;
    },
  });
  r.registerRecord('partnership.release', (state, rec) => {
    const e = rec.payload, a = association(state, e.association);
    a.claims[e.claim].released = rec.at;
    a.history.push({ at: rec.at, what: `claim ${e.claim} ended`, by: originOf(e) });
  });

  r.registerEffect({
    name: 'partnership.leave', module: 'partnership',
    rule: (p) => p.value('partnership.join_rule'),
    describe: (e) => `Leave the association ${e.association}`,
    check(state, e) {
      const a = member(state, e.association);
      if (!a) return `the partnership does not belong to ${e.association}`;
      return liveClaims(a).length ? `end ${e.association}'s claims first (${liveClaims(a).map(c => c.id).join(', ')}), as its terms allow` : null;
    },
  });
  r.registerRecord('partnership.leave', (state, rec) => {
    const a = association(state, rec.payload.association);
    a.left = rec.at; a.history.push({ at: rec.at, what: 'left', by: originOf(rec.payload) });
  });
}

// ── certificates, read from the record ───────────────────────────────────
// records: the entity's records in order. Returns every certificate ever
// issued: { number, partner, units, issued, record, seq, cancelled, cancelledBy }.
// A certificate is issued when a partner is admitted (or at founding, for the
// founder) and each time their units of the class change, and to anyone who
// receives units without one; the one before is cancelled. A partner who leaves has their certificate cancelled.
export function certificates(records, unitClass = 'units') {
  const out = [], current = {}, units = {};
  let n = 0;
  const issue = (who, rec, i, why) => {
    if (current[who]) { current[who].cancelled = rec.at; current[who].cancelledBy = why; }
    const outstanding = Object.values(units).reduce((t, u) => t + (u > 0 ? u : 0), 0);
    const c = { number: ++n, partner: who, units: units[who] || 0, outstanding, issued: rec.at, record: rec.hash, seq: i + 1, why, cancelled: null, cancelledBy: null };
    out.push(c); current[who] = c;
  };
  records.forEach((rec, i) => {
    const k = rec.kind, p = rec.payload || {};
    if (k === 'entity.found') issue(p.act?.by || rec.author, rec, i, 'founded the partnership');
    else if (k === 'participant.admitted' || k === 'participant.admit') issue(p.id, rec, i, 'admitted as a partner');
    else if (k === 'share.issue' && p.class === unitClass) { units[p.to] = (units[p.to] || 0) + p.count; issue(p.to, rec, i, `${p.count} units issued`); }
    else if (k === 'share.redeem' && p.class === unitClass) { units[p.from] = (units[p.from] || 0) - p.count; if (current[p.from]) issue(p.from, rec, i, `${p.count} units redeemed`); }
    else if (k === 'share.transfer' && p.act?.class === unitClass) {
      const a = p.act; units[a.by] -= a.count; units[a.to] = (units[a.to] || 0) + a.count;
      if (current[a.by]) issue(a.by, rec, i, `${a.count} units transferred out`);
      issue(a.to, rec, i, `${a.count} units transferred in`);
    } else if (k === 'participant.leave' || k === 'participant.remove') {
      const who = k === 'participant.leave' ? p.act?.by : p.id;
      if (current[who]) { current[who].cancelled = rec.at; current[who].cancelledBy = k === 'participant.leave' ? 'left the partnership' : 'removed from the partnership'; delete current[who]; }
    }
  });
  return out;
}

export default { name: 'partnership', core: '0.7.7', install, association, liveClaims, profitShare, certificates,
  parameterKeys: ['partnership.join_rule', 'partnership.profits_rule', 'partnership.assets_rule', 'partnership.unit_class', 'partnership.ein', 'partnership.office'] };
