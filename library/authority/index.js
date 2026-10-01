// authority · grants of power to act without a vote, within written limits.
//
// A grant lets the holders of an office, or the members of a committee, carry
// certain effects directly: the same effects a decision could carry, checked
// the same way, but signed by the grantee instead of voted by the electorate.
//
//   grant:     deed-manager
//   to:        { office: deed-manager }          or { committee: rooms }
//   may:       [deed.grant, deed.assign]         effect kinds it permits
//   where:     { deed: "room-*" }                optional limits on effect fields
//                                                (a pattern, or a list; * matches anything)
//   limit:     { count: 10, days: 30 }           optional: at most 10 uses in any 30 days
//   needs:     1 | 2 | majority | all            signatures from the grantee per use
//                                                (default: 1 for an office, the
//                                                committee's own rule for a committee)
//   delegable: false                             see below
//
// Grants are made and revoked by decision. A grant needs the strictest of
// authority.grant_rule and the rules of every effect it permits: delegating a
// power never lowers the bar for granting it.
//
// Using a grant: `authority.exercise { grant, effects }`, signed by a grantee.
// If the grant needs more than one signature, other grantees add theirs with
// `authority.cosign { exercise }` within authority.cosign_days; the effects
// happen when the last one needed arrives, checked again at that moment. Every
// use is published under the grant; the membership can undo any of them by
// decision, and revoke the grant.
//
// Never delegated by accident: a grant may permit office.create,
// committee.create, authority.grant or authority.revoke only if it says
// delegable: true. A grant made under another grant can be no wider than its
// parent (a subset of its effects, and every one of its limits), and falls
// with it.

import { actId } from '../../kernel/signed.js';
import { Parameters } from '../../kernel/parameters.js';
import { simulateEffects, electorateProblem, effectRecords, originOf } from '../../kernel/effects.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
export const PROTECTED = ['office.create', 'committee.create', 'authority.grant', 'authority.revoke'];
export const exerciseId = (act) => 'x-' + actId(act).slice(0, 12);

const book = (state) => (state.m.authority = state.m.authority || { grants: {}, exercises: {} });
const grantOf = (state, id) => state.m.authority?.grants?.[id] || null;

// Is the grant in force: not revoked, and every grant it was made under in force.
export function inForce(state, id) {
  for (let g = grantOf(state, id), n = 0; g && n < 50; g = g.parent ? grantOf(state, g.parent) : null, n++) {
    if (g.revoked) return false;
    if (!g.parent) return true;
  }
  return false;
}

// The grantee body's current members, read from the offices' or committees'
// state (this module imports neither). null if the body does not exist.
export function body(state, to, at) {
  const live = (id) => state.participants[id]?.status === 'active';
  if (to?.office) {
    const o = state.m.offices?.[to.office];
    return !o || o.abolished ? null : o.holders.filter(h => !h.until || h.until > at).map(h => h.id).filter(live);
  }
  if (to?.committee) {
    const c = state.m.committees?.[to.committee];
    return !c || c.dissolved ? null : c.members.filter(m => !m.until || m.until > at).map(m => m.id).filter(live);
  }
  return null;
}
export const bodyName = (to) => (to?.office ? `the office ${to.office}` : to?.committee ? `the committee ${to.committee}` : 'nobody');

function rule(g, state) {
  if (g.needs !== undefined) return g.needs;
  if (g.to.committee) return state.m.committees?.[g.to.committee]?.needs ?? 'majority';
  return 1;
}
export function needed(g, state, n) {
  const r = rule(g, state);
  return r === 'all' ? n : r === 'majority' ? Math.floor(n / 2) + 1 : r;
}

const glob = (pat) => new RegExp('^' + String(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
export function outside(where, e) {
  for (const [field, pats] of Object.entries(where || {})) {
    const list = Array.isArray(pats) ? pats : [pats];
    const v = e[field];
    if (v === undefined || v === null || typeof v === 'object') return `${field} must be given, and be one of ${list.join(', ')}`;
    if (!list.some(p => glob(p).test(String(v)))) return `${field} "${v}" is outside this grant (${list.join(', ')})`;
  }
  return null;
}

function usedWithin(state, g, at) {
  if (!g.limit) return 0;
  const since = addDays(at, -g.limit.days);
  return g.exercises.map(x => state.m.authority.exercises[x]).filter(x => x.enacted && x.enacted > since).length;
}

function grantShape(state, e, registry) {
  if (!ID.test(e.grant || '')) return 'a grant id is 1–40 lowercase letters, digits and -';
  if (grantOf(state, e.grant)) return `the grant ${e.grant} already exists (grant ids are never reused)`;
  const to = e.to;
  if (!to || typeof to !== 'object' || Object.keys(to).length !== 1 || !(to.office || to.committee)) return 'to is { office: ID } or { committee: ID }';
  if (!Array.isArray(e.may) || !e.may.length || e.may.some(k => typeof k !== 'string')) return 'may is a list of effect kinds';
  for (const k of e.may) {
    if (!registry.effects.has(k)) return `"${k}" is not an effect this entity knows`;
    if (PROTECTED.includes(k) && e.delegable !== true) return `${k} can be delegated only by a grant that says delegable: true`;
  }
  if (e.where !== undefined) {
    if (!e.where || typeof e.where !== 'object' || Array.isArray(e.where)) return 'where is { field: pattern or [patterns] }';
    for (const v of Object.values(e.where)) if (!(typeof v === 'string' || (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')))) return 'each where limit is a pattern or a list of patterns';
  }
  if (e.limit !== undefined && !(e.limit && Number.isInteger(e.limit.count) && e.limit.count >= 1 && Number.isInteger(e.limit.days) && e.limit.days >= 1 && Object.keys(e.limit).length === 2)) return 'limit is { count, days }, whole numbers of at least 1';
  if (e.needs !== undefined && !(e.needs === 'majority' || e.needs === 'all' || (Number.isInteger(e.needs) && e.needs >= 1 && e.needs <= 50))) return 'needs is a whole number from 1 to 50, "majority" or "all"';
  if (e.delegable !== undefined && typeof e.delegable !== 'boolean') return 'delegable is true or false';
  if (e.note !== undefined && (typeof e.note !== 'string' || e.note.length > 1000)) return 'a note is at most 1000 characters';
  return null;
}

// A grant made under a grant is no wider than the grant it is made under.
function narrower(parent, e) {
  const extra = e.may.filter(k => !parent.may.includes(k));
  if (extra.length) return `the grant ${parent.id} does not itself permit ${extra.join(', ')}`;
  for (const [f, v] of Object.entries(parent.where || {})) {
    if (JSON.stringify(e.where?.[f]) !== JSON.stringify(v)) return `a grant made under ${parent.id} keeps its limit on ${f} (${[].concat(v).join(', ')})`;
  }
  if (parent.limit && !(e.limit && e.limit.count <= parent.limit.count && e.limit.days >= parent.limit.days)) return `a grant made under ${parent.id} keeps its rate limit`;
  if (e.delegable && !parent.delegable) return `${parent.id} is not delegable`;
  return null;
}

// Everything checked when a grant is used, now.
function useProblem(state, g, effects, params, registry, at) {
  if (!Array.isArray(effects) || !effects.length || effects.length > 20) return 'effects is a list of 1–20 effects';
  for (const [i, e] of effects.entries()) {
    if (!e || typeof e.kind !== 'string') return `effect ${i + 1}: an effect is { kind, … }`;
    if (!g.may.includes(e.kind)) return `effect ${i + 1}: the grant ${g.id} does not permit ${e.kind} (it permits ${g.may.join(', ')})`;
    // A grant's limits bind the effects it carries out. Granting and revoking
    // under it are held to them differently: a grant made under it must keep
    // them (see narrower), and may revoke only its own descendants.
    const out = e.kind === 'authority.grant' || e.kind === 'authority.revoke' ? null : outside(g.where, e);
    if (out) return `effect ${i + 1}: ${out}`;
  }
  if (g.limit && usedWithin(state, g, at) >= g.limit.count) return `the grant ${g.id} has been used ${g.limit.count} time(s) in the last ${g.limit.days} days, its limit`;
  const sim = simulateEffects(state, effects, params, registry, at, { via: g.id });
  if (sim.why) return sim.why;
  return electorateProblem(registry, state, params, sim.state, params, at);
}

function enact(x, g) {
  return [{ kind: 'authority.enacted', payload: { exercise: x, grant: g.id } }, ...effectRecords(g.effectsOf, { via: g.id, exercise: x })];
}

function install(r) {
  // Amending a grant: its title, note, holder, powers, limits or signatures.
  // A change to what it may do is checked exactly as a new grant would be,
  // under the strictest rule among its powers. Never done under a grant.
  const POWERS = ['to', 'may', 'where', 'limit', 'needs', 'delegable'];
  r.registerEffect({
    name: 'authority.amend', module: 'authority',
    rule: (p, e, registry) => registry.effects.get('authority.grant').rule(p, e, registry),
    describe: (e) => `Amend the grant ${e.grant}: ${Object.keys(e).filter(k => ['title', 'note', ...POWERS].includes(k)).join(', ')}`,
    check(state, e, params, at, ctx = {}) {
      if (ctx.via) return 'grants are amended by the members, never under a grant';
      const g = grantOf(state, e.grant);
      if (!g || g.revoked) return `there is no grant ${e.grant} in force`;
      const keys = Object.keys(e).filter(k => ['title', 'note', ...POWERS].includes(k));
      if (!keys.length) return 'say what to change: title, note, to, may, where, limit, needs or delegable';
      if (e.title !== undefined && (typeof e.title !== 'string' || e.title.length > 80)) return 'a title is at most 80 characters';
      if (e.note !== undefined && (typeof e.note !== 'string' || e.note.length > 1000)) return 'a note is at most 1000 characters';
      if (keys.some(k => POWERS.includes(k))) {
        if (!e.may) return 'changing what a grant may do, or whom it is for, restates its powers: include may (the full list)';
        const merged = { grant: g.id, to: e.to ?? g.to, may: e.may, delegable: e.delegable ?? g.delegable, needs: e.needs ?? g.needs, note: e.note ?? g.note };
        const where = e.where === undefined ? g.where : e.where; if (where) merged.where = where;
        const limit = e.limit === undefined ? g.limit : e.limit; if (limit) merged.limit = limit;
        const others = { ...state.m.authority.grants }; delete others[g.id];
        const bad = grantShape({ ...state, m: { ...state.m, authority: { ...state.m.authority, grants: others } } }, merged, ctx.registry);
        if (bad) return bad;
        if (!body(state, merged.to, at)) return `there is no ${bodyName(merged.to).replace('the ', '')}`;
      }
      return null;
    },
  });
  r.registerRecord('authority.amend', (state, rec) => {
    const e = rec.payload, g = book(state).grants[e.grant];
    for (const k of ['title', 'note', ...POWERS]) if (e[k] !== undefined) g[k] = e[k];
    (g.amended ||= []).push({ at: rec.at, by: originOf(e), fields: Object.keys(e).filter(k => ['title', 'note', ...POWERS].includes(k)) });
  });

  r.registerEffect({
    name: 'authority.grant', module: 'authority',
    rule(p, e, registry) {
      let best = p.value('authority.grant_rule');
      for (const k of (e && e.may) || []) {
        const d = registry?.effects.get(k);
        if (!d || k === 'authority.grant') continue;
        try { const n = d.rule(p, { kind: k }, registry); if (p.rank(n) > p.rank(best)) best = n; } catch { /* its own check reports it */ }
      }
      return best;
    },
    describe: (e) => `Grant "${e.grant}" to ${bodyName(e.to)}: may ${(e.may || []).join(', ')}${e.where ? ` where ${Object.entries(e.where).map(([k, v]) => `${k} is ${[].concat(v).join(' or ')}`).join(', ')}` : ''}${e.limit ? `, at most ${e.limit.count} in ${e.limit.days} days` : ''}${e.needs && e.needs !== 1 ? `, needing ${e.needs} signatures` : ''}${e.delegable ? ', delegable' : ''}`,
    check(state, e, params, at, ctx = {}) {
      const bad = grantShape(state, e, ctx.registry);
      if (bad) return bad;
      if (!body(state, e.to, at)) return `there is no ${bodyName(e.to).replace('the ', '')}`;
      if (ctx.via) return narrower(grantOf(state, ctx.via), e);
      return null;
    },
  });
  r.registerEffect({
    name: 'authority.revoke', module: 'authority',
    rule: (p) => p.value('authority.grant_rule'),
    describe: (e) => `Revoke the grant ${e.grant}${e.reason ? ` (${e.reason})` : ''}`,
    check(state, e, params, at, ctx = {}) {
      const g = grantOf(state, e.grant);
      if (!g || g.revoked) return `there is no grant ${e.grant} in force`;
      if (ctx.via) {
        let a = g; for (let n = 0; a && a.id !== ctx.via && n < 50; n++) a = a.parent ? grantOf(state, a.parent) : null;
        if (!a) return `the grant ${ctx.via} may revoke only grants made under it`;
      }
      return null;
    },
  });
  r.registerRecord('authority.grant', (state, rec) => {
    const e = rec.payload;
    book(state).grants[e.grant] = {
      id: e.grant, to: e.to, may: e.may, where: e.where || null, limit: e.limit || null, needs: e.needs, delegable: !!e.delegable, note: e.note || '',
      parent: e.via || null, origin: originOf(e), created: rec.at, revoked: null, exercises: [],
    };
  });
  r.registerRecord('authority.revoke', (state, rec) => {
    book(state).grants[rec.payload.grant].revoked = { at: rec.at, by: originOf(rec.payload), reason: rec.payload.reason || '' };
  });

  r.registerKind({
    name: 'authority.exercise', module: 'authority',
    check(state, act, { params, registry }) {
      const g = grantOf(state, act.grant);
      if (!g) return `there is no grant ${act.grant}`;
      if (!inForce(state, g.id)) return `the grant ${g.id} is no longer in force`;
      const who = body(state, g.to, act.at);
      if (!who) return `${bodyName(g.to)} no longer exists`;
      if (!who.includes(act.by)) return `only members of ${bodyName(g.to)} may use the grant ${g.id}`;
      const n = needed(g, state, who.length);
      if (n > who.length) return `the grant needs ${n} signatures and ${bodyName(g.to)} has ${who.length} member(s)`;
      if (act.note !== undefined && (typeof act.note !== 'string' || act.note.length > 1000)) return 'a note is at most 1000 characters';
      return useProblem(state, g, act.effects, params, registry, act.at);
    },
    apply(state, act) {
      const g = grantOf(state, act.grant);
      const n = needed(g, state, body(state, g.to, act.at).length);
      return n <= 1 ? enact(exerciseId(act), { ...g, effectsOf: act.effects }) : [];
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = exerciseId(a), g = grantOf(state, a.grant);
      book(state).exercises[id] = { id, grant: a.grant, by: a.by, at: rec.at, effects: a.effects, note: a.note || '',
        needs: needed(g, state, body(state, g.to, rec.at).length), signers: [a.by], enacted: null,
        expires: addDays(rec.at, new Parameters(state.doc, state.catalog).value('authority.cosign_days')) };
      g.exercises.push(id);
    },
    records: {
      'authority.enacted'(state, rec) { state.m.authority.exercises[rec.payload.exercise].enacted = rec.at; },
    },
  });

  r.registerKind({
    name: 'authority.cosign', module: 'authority',
    check(state, act, { params, registry }) {
      const x = state.m.authority?.exercises?.[act.exercise];
      if (!x) return `there is no use of a grant ${act.exercise}`;
      if (x.enacted) return `${x.id} has already taken effect`;
      if (act.at > x.expires) return `${x.id} waited for signatures until ${x.expires}, and lapsed`;
      const g = grantOf(state, x.grant);
      if (!inForce(state, g.id)) return `the grant ${g.id} is no longer in force`;
      const who = body(state, g.to, act.at) || [];
      if (!who.includes(act.by)) return `only members of ${bodyName(g.to)} may sign for the grant ${g.id}`;
      if (x.signers.includes(act.by)) return 'you have already signed this';
      const signers = [...x.signers, act.by].filter(s => who.includes(s));
      if (signers.length < x.needs) return null;
      return useProblem(state, g, x.effects, params, registry, act.at);
    },
    apply(state, act) {
      const x = state.m.authority.exercises[act.exercise], g = grantOf(state, x.grant);
      const who = body(state, g.to, act.at) || [];
      const signers = [...x.signers, act.by].filter(s => who.includes(s));
      return signers.length >= x.needs ? enact(x.id, { ...g, effectsOf: x.effects }) : [];
    },
    reduce(state, rec) { state.m.authority.exercises[rec.payload.act.exercise].signers.push(rec.payload.act.by); },
  });
}

export default { name: 'authority', core: '0.7.7', install, inForce, body, needed, outside, exerciseId, PROTECTED,
  parameterKeys: ['authority.grant_rule', 'authority.cosign_days'] };
