// laws · a relational legal system. Every law has a type, tags, and the bodies
// it concerns: who enforces it and on whom it is enforced. Laws are made two
// ways: by Parliament (elected members vote on bills) or by referendum (every
// citizen votes, through the Assembly's own decisions). Editing a parameter is
// itself an act of law: a parametric law carries the changes, and enacting it
// makes them.
//
// Types are a parameter (laws.types), changed only by the constitutional rule.
// Each type names the rule a law of it needs, and may pair with a level:
//   constitutional  the functioning of the state            (constitutional rule)
//   organic         creates an institution, governs it      (organic rule)
//   statutory       ordinary legislation                    (ordinary rule)
//   ordinary        text on managing an institution; at the constitutional or
//                   statutory level, whose rule it takes
//   parametric      settings for how the republic runs; at the constitutional,
//                   statutory or organic level; carries parameter changes
// A law needs the strictest of its type's rule, its level's rule, and the rule
// of every parameter it changes.
//
// Every setting is governed by one parametric law: the last law in force that
// set it (laws.settings). While laws.settings_by_law is on, a setting changes
// only by a parametric law: an Assembly proposal may not carry bare changes
// (other than entity.modules, which installing and removing modules changes).
// A law that governs a setting cannot be repealed, nor amended to drop it, until
// another law sets it: so no setting is ever left without a law.
//
// A law := { law, title, text, type, level?, tags[], enforcers[], subjects[], changes?, note? }
// where enforcers and subjects are "public", "citizens", "office:ID",
// "committee:ID" or "member:ID".
//
// By referendum (effects, decided by the Assembly under the law's rule):
//   law.enact  { …a law }          enact it, or amend it to a new version
//   law.repeal { law, rule, reason }   rule: the law's own (the page fills it in)
//   law.ratify { bill, rule }      put into force a bill Parliament passed that
//                                  went to referendum, under the bill's rule
// By Parliament (acts; the members are laws.parliament, "office:ID" or "committee:ID"):
//   law.bill      { bill, action: enact, …a law } | { bill, action: repeal, law, reason }
//   law.vote      { bill, choice: for | against | abstain }   members on the bill's roll
//   law.close     { bill }   anyone, once it closes or its outcome is certain; counted
//                            under the law's rule (quorum and threshold of the members)
//   law.petition  { bill }   a citizen asks for a referendum on a passed bill, within
//                            laws.petition_days; at laws.petition_share of citizens,
//                            it goes to referendum instead of coming into force
//   law.promulgate { bill }  anyone, once the window has passed without a referendum
// A bill whose rule is stricter than laws.parliament_max_rule always goes to
// referendum once Parliament passes it.

import { originOf } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const TAG = /^[a-z0-9][a-z0-9 -]{0,29}$/;
const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
const book = (state) => { const b = (state.m.laws ||= { laws: {}, bills: {} }); b.settings ||= {}; return b; };
const P = (state) => new Parameters(state.doc, state.catalog);
const active = (state, id) => state.participants[id]?.status === 'active';
const PROTECTED = ['entity.modules'];

export const law = (state, id) => state.m.laws?.laws?.[id] || null;
export const bill = (state, id) => state.m.laws?.bills?.[id] || null;
export const inForce = (l) => !!l && l.status === 'in force';

// The types in force, as the parameter has them (entries that make no sense are skipped).
export function types(params) {
  const raw = params.has('laws.types') ? params.value('laws.types') : [];
  return (Array.isArray(raw) ? raw : []).filter(t => t && typeof t === 'object' && ID.test(t.id || '') && typeof t.rule === 'string');
}
export const typeOf = (params, id) => types(params).find(t => t.id === id) || null;

const stricter = (params, a, b) => (!a ? b : !b ? a : params.rank(b) > params.rank(a) ? b : a);
// The rule a law needs: its type's, its level's, and every changed parameter's.
export function ruleOf(params, d) {
  let r = typeOf(params, d.type)?.rule || null;
  if (d.level) r = stricter(params, r, typeOf(params, d.level)?.rule);
  for (const k of Object.keys(d.changes || {})) r = stricter(params, r, params.rule(k)?.name);
  return r || 'ordinary';
}

// The rule a law in force needs to be repealed or amended: the stricter of the
// rule recorded when its current version was enacted and the rule its current
// version needs now (types and setting rules may have changed since).
export function lawRule(params, l) {
  const v = l?.versions?.at(-1);
  if (!v) return 'ordinary';
  const now = typeOf(params, v.type) ? ruleOf(params, v) : null;
  return stricter(params, now, v.rule || null) || params.ruleOrder().at(-1);
}

// The settings a law governs now: those it set that no later law has set.
export const governs = (state, id) => Object.entries(state.m.laws?.settings || {}).filter(([, g]) => g.law === id).map(([k]) => k);

// Why a law cannot be repealed now, or null.
export function repealProblem(state, id) {
  const l = law(state, id);
  if (!inForce(l)) return `there is no law ${id} in force`;
  const keys = governs(state, id);
  return keys.length ? `it still governs ${keys.length} setting${keys.length === 1 ? '' : 's'} (${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}); enact another law setting them, or amend it, instead` : null;
}

// Who sits in Parliament now.
export function members(state, params, at) {
  const spec = params.has('laws.parliament') ? params.value('laws.parliament') : '';
  const [kind, id] = String(spec).split(':');
  const live = (list) => (list || []).filter(m => (!m.since || !at || m.since <= at) && (!m.until || !at || m.until > at)).map(m => m.id);
  const ids = kind === 'office' ? live(state.m.offices?.[id]?.holders) : kind === 'committee' ? live(state.m.committees?.[id]?.members) : [];
  return [...new Set(ids)].filter(x => active(state, x));
}

function partyProblem(state, x) {
  if (x === 'public' || x === 'citizens') return null;
  const m = String(x).match(/^(office|committee|member):([a-z0-9][a-z0-9-]{0,59})$/);
  if (!m) return `"${x}" is not a body: use public, citizens, office:ID, committee:ID or member:ID`;
  if (m[1] === 'office' && !state.m.offices?.[m[2]]) return `there is no office ${m[2]}`;
  if (m[1] === 'committee' && !state.m.committees?.[m[2]]) return `there is no committee ${m[2]}`;
  if (m[1] === 'member' && !state.participants[m[2]]) return `there is no member ${m[2]}`;
  return null;
}

// Is this a law that can be enacted (or this amendment made)? null, or why not.
export function lawProblem(state, params, d) {
  if (!ID.test(d.law || '')) return 'a law id is 1–60 lowercase letters, digits and -';
  if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 160) return 'a law needs a title of 1–160 characters';
  if (d.text !== undefined && (typeof d.text !== 'string' || d.text.length > 50000)) return 'the text is at most 50000 characters';
  if (d.note !== undefined && (typeof d.note !== 'string' || d.note.length > 300)) return 'a note is at most 300 characters';
  const t = typeOf(params, d.type);
  if (!t) return `the type must be one of ${types(params).map(x => x.id).join(', ')} (laws.types)`;
  const levels = Array.isArray(t.levels) ? t.levels : [];
  if (d.level !== undefined && d.level !== null) {
    if (!levels.includes(d.level)) return levels.length ? `a ${t.id} law's level is one of ${levels.join(', ')}` : `a ${t.id} law has no level`;
    if (!typeOf(params, d.level)) return `there is no type ${d.level}`;
  } else if (t.level_required) return `a ${t.id} law needs a level: ${levels.join(' or ')}`;
  if (!Array.isArray(d.tags) || !d.tags.length || d.tags.length > 12 || d.tags.some(x => typeof x !== 'string' || !TAG.test(x))) return 'give 1–12 tags, each 1–30 lowercase letters, digits, spaces or -';
  if (new Set(d.tags).size !== d.tags.length) return 'tags must differ';
  for (const [name, list] of [['enforcers', d.enforcers], ['subjects', d.subjects]]) {
    if (!Array.isArray(list) || !list.length || list.length > 20) return `name 1–20 ${name}: who ${name === 'enforcers' ? 'enforces the law' : 'it is enforced upon'}`;
    for (const x of list) { const why = partyProblem(state, x); if (why) return `${name}: ${why}`; }
  }
  const changes = d.changes || {};
  if (typeof changes !== 'object' || Array.isArray(changes)) return 'changes are { parameter: value }';
  const keys = Object.keys(changes);
  if (t.changes && !keys.length) return `a ${t.id} law changes at least one parameter`;
  if (!t.changes && keys.length) return `only a parametric law changes parameters (laws.types says which types may)`;
  for (const k of keys) if (PROTECTED.includes(k)) return `${k} is changed by installing modules, not by a law`;
  const { refused } = params.apply(changes);
  if (refused.length) return refused[0].why;
  if (!t.changes && !String(d.text || '').trim()) return 'a law needs its text';
  const old = law(state, d.law);
  const dropped = old?.status === 'in force' ? governs(state, d.law).filter(k => !(k in changes)) : [];
  if (old?.status === 'in force' && params.rank(ruleOf(params, d)) < params.rank(lawRule(params, old))) return `an amendment cannot lower the majority this law needs (${lawRule(params, old)}): keep its type and level`;
  if (dropped.length) return `this law governs ${dropped.join(', ')}; keep ${dropped.length === 1 ? 'it' : 'them'} in the amendment, or enact another law setting ${dropped.length === 1 ? 'it' : 'them'} first`;
  if (old?.status === 'in force') {
    const a = old.versions.at(-1);
    if (a.text === (d.text || '') && a.title === d.title && JSON.stringify([a.type, a.level || null, a.tags, a.enforcers, a.subjects, a.changes || {}]) === JSON.stringify([d.type, d.level || null, d.tags, d.enforcers, d.subjects, changes]))
      return 'nothing would change';
  }
  return null;
}

const draftOf = (d) => ({ law: d.law, title: d.title.trim(), text: d.text || '', type: d.type, ...(d.level ? { level: d.level } : {}), tags: d.tags.map(x => x.trim()),
  enforcers: d.enforcers, subjects: d.subjects, ...(d.changes && Object.keys(d.changes).length ? { changes: d.changes } : {}), ...(d.note ? { note: d.note } : {}) });

// Bring a law into force (or amend it). Changes parameters a parametric law carries.
function enact(state, d, at, via) {
  const b = book(state);
  const l = b.laws[d.law] ||= { id: d.law, versions: [], created: at, status: null, repealed: null };
  let changed = [];
  const rule = ruleOf(P(state), d);
  if (d.changes) { const r = P(state).apply(d.changes); state.doc = r.doc; changed = r.changed; }
  const v = { n: l.versions.length + 1, ...draftOf(d), rule, at, via, ...(changed.length ? { changed } : {}) };
  l.versions.push(v);
  for (const k of Object.keys(d.changes || {})) b.settings[k] = { law: d.law, version: v.n, at };
  Object.assign(l, { title: v.title, type: v.type, level: v.level || null, tags: v.tags, enforcers: v.enforcers, subjects: v.subjects, status: 'in force', since: at, repealed: null });
  return v;
}
function repeal(state, id, at, via, reason) {
  const l = law(state, id);
  l.status = 'repealed'; l.repealed = { at, via, reason: reason || '' };
}

// The count on a bill: Parliament's members on its roll, under the law's rule.
export function tally(params, b) {
  const r = params.rules[b.rule] || params.rules.ordinary;
  const votes = Object.values(b.votes || {});
  const n = (c) => votes.filter(v => v === c).length;
  const f = n('for'), a = n('against'), ab = n('abstain'), cast = f + a + ab, roll = b.roll.length, left = roll - cast;
  const quorumNeeded = Math.max(1, Math.ceil((r.quorum || 0) * roll - 1e-9));
  const share = f + a ? f / (f + a) : 0;
  const passes = cast >= quorumNeeded && f > a && share >= (r.threshold || 0.5) - 1e-9;
  const certainPass = cast >= quorumNeeded && f / (f + a + left) >= (r.threshold || 0.5) - 1e-9 && f > a + left;
  const certainFail = f + left <= a || (f + left) / (f + left + a) < (r.threshold || 0.5) - 1e-9;
  return { for: f, against: a, abstain: ab, cast, roll, quorumNeeded, passes, certain: certainPass ? 'passed' : certainFail ? 'failed' : null, threshold: r.threshold, quorum: r.quorum };
}
export const petitionsNeeded = (state, params) => Math.max(1, Math.ceil(params.value('laws.petition_share') * state.order.filter(id => active(state, id)).length - 1e-9));

function billProblem(state, params, a) {
  if (a.action === 'repeal') {
    const why = repealProblem(state, a.law);
    if (why) return why;
    return typeof a.reason === 'string' && a.reason.trim() && a.reason.length <= 300 ? null : 'give a reason (up to 300 characters)';
  }
  if (a.action !== 'enact') return 'action is enact or repeal';
  return lawProblem(state, params, a);
}
const billRule = (state, params, a) => (a.action === 'repeal' ? lawRule(params, law(state, a.law)) : stricter(params, ruleOf(params, a), inForce(law(state, a.law)) ? lawRule(params, law(state, a.law)) : null));
const viaBill = (id) => `parliament ${id}`;

function install(r) {
  // ── Settings change only by law ─────────────────────────────────────────
  r.registerProposalCheck({ module: 'laws', check(state, act, params) {
    if (!(params.has('laws.settings_by_law') && params.value('laws.settings_by_law'))) return null;
    const keys = Object.keys(act.changes || {}).filter(k => k !== 'entity.modules');
    return keys.length ? `settings change only by a parametric law (laws.settings_by_law): put ${keys.join(', ')} in a law, from the statute book` : null;
  } });

  // ── Parliament ───────────────────────────────────────────────────────────
  r.registerKind({
    name: 'law.bill', module: 'laws',
    check(state, a, { params }) {
      if (!members(state, params, a.at).includes(a.by)) return 'only a member of Parliament lays a bill';
      if (!ID.test(a.bill || '')) return 'a bill id is 1–60 lowercase letters, digits and -';
      if (bill(state, a.bill)) return `there is already a bill ${a.bill}`;
      return billProblem(state, params, a);
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = P(state), rule = billRule(state, p, a), id = a.bill;
      const rest = a.action === 'repeal' ? { action: 'repeal', law: a.law, reason: a.reason } : { action: 'enact', ...draftOf(a) };
      book(state).bills[id] = { id, by: a.by, at: rec.at, ...rest, rule, refer: p.rank(rule) > p.rank(p.value('laws.parliament_max_rule')),
        roll: members(state, p, rec.at), closes: addDays(rec.at, p.value('laws.parliament_days')), votes: {}, status: 'open', petitions: {}, window: null, outcome: null };
    },
  });
  r.registerKind({
    name: 'law.vote', module: 'laws',
    check(state, a) {
      const b = bill(state, a.bill);
      if (!b || b.status !== 'open') return `bill ${a.bill} is not open for votes`;
      if (Date.parse(a.at) > Date.parse(b.closes)) return 'voting on this bill has closed';
      if (!b.roll.includes(a.by)) return 'only the members of Parliament when the bill was laid vote on it';
      return ['for', 'against', 'abstain'].includes(a.choice) ? null : 'choice is for, against or abstain';
    },
    reduce(state, rec) { const a = rec.payload.act; bill(state, a.bill).votes[a.by] = a.choice; },
  });
  r.registerKind({
    name: 'law.close', module: 'laws',
    check(state, a, { params }) {
      const b = bill(state, a.bill);
      if (!b || b.status !== 'open') return `bill ${a.bill} is not open`;
      if (!active(state, a.by)) return 'only an active member may close a bill';
      if (Date.parse(a.at) <= Date.parse(b.closes) && !tally(params, b).certain) return `it is open until ${b.closes}, and its outcome is not yet certain`;
      if (tally(params, b).passes && b.action === 'enact' && !b.refer && !params.value('laws.petition_days')) { const why = lawProblem(state, params, b); if (why) return `it can no longer be enacted: ${why}`; }
      return null;
    },
    reduce(state, rec) {
      const b = bill(state, rec.payload.act.bill), p = P(state), t = tally(p, b);
      b.outcome = { at: rec.at, ...t };
      if (!t.passes) { b.status = 'failed'; return; }
      if (b.refer) { b.status = 'referendum'; b.referred = 'its rule needs the citizens'; return; }
      const days = p.value('laws.petition_days');
      if (days > 0) { b.status = 'window'; b.window = addDays(rec.at, days); return; }
      into(state, b, rec.at, viaBill(b.id));
    },
  });
  r.registerKind({
    name: 'law.petition', module: 'laws',
    check(state, a) {
      const b = bill(state, a.bill);
      if (!active(state, a.by)) return 'only citizens petition';
      if (!b || b.status !== 'window' || Date.parse(a.at) > Date.parse(b.window)) return `bill ${a.bill} is not open to petition`;
      return b.petitions[a.by] ? 'you have petitioned already' : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, b = bill(state, a.bill);
      b.petitions[a.by] = rec.at;
      if (Object.keys(b.petitions).length >= petitionsNeeded(state, P(state))) { b.status = 'referendum'; b.referred = 'the citizens petitioned'; }
    },
  });
  r.registerKind({
    name: 'law.promulgate', module: 'laws',
    check(state, a, { params }) {
      const b = bill(state, a.bill);
      if (!active(state, a.by)) return 'only an active member may promulgate';
      if (!b || b.status !== 'window') return `bill ${a.bill} is not waiting to come into force`;
      if (Date.parse(a.at) <= Date.parse(b.window)) return `citizens may petition for a referendum until ${b.window}`;
      return b.action === 'enact' ? lawProblem(state, params, b) : repealProblem(state, b.law);
    },
    reduce(state, rec) { into(state, bill(state, rec.payload.act.bill), rec.at, viaBill(rec.payload.act.bill)); },
  });

  // ── Referendum: the Assembly's own decisions ─────────────────────────────
  const effect = (name, rule, describe, check, reduce) => { r.registerEffect({ name, module: 'laws', rule, describe, check }); r.registerRecord(name, reduce); };
  effect('law.enact', (p, e) => ruleOf(p, e),
    (e) => `Enact the ${e.level ? `${e.type} (${e.level})` : e.type} law "${e.title}" [${(e.tags || []).join(', ')}]${e.changes ? `, setting ${Object.entries(e.changes).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')}` : ''}`,
    (state, e, params) => lawProblem(state, params, e),
    (state, rec) => { enact(state, rec.payload, rec.at, `referendum: ${originOf(rec.payload)}`); });
  // A repeal and a ratification carry the rule they need, checked against the law
  // or bill: that rule or a stricter one.
  const ruleCheck = (params, e, want) => (typeof e.rule !== 'string' || !(e.rule in params.rules) || params.rank(e.rule) < params.rank(want) ? `this needs the ${want} rule or a stricter one: give rule "${want}"` : null);
  effect('law.repeal', (p, e) => e.rule,
    (e) => `Repeal the law ${e.law} (${e.reason})`,
    (state, e, params) => repealProblem(state, e.law) || ruleCheck(params, e, lawRule(params, law(state, e.law))) || (typeof e.reason === 'string' && e.reason.trim() ? null : 'give a reason'),
    (state, rec) => repeal(state, rec.payload.law, rec.at, `referendum: ${originOf(rec.payload)}`, rec.payload.reason));
  effect('law.ratify', (p, e) => e.rule,
    (e) => `Ratify bill ${e.bill}, passed by Parliament, by referendum`,
    (state, e, params) => {
      const b = bill(state, e.bill);
      if (!b || b.status !== 'referendum') return `bill ${e.bill} is not awaiting a referendum`;
      const why = ruleCheck(params, e, b.rule); if (why) return why;
      return b.action === 'enact' ? lawProblem(state, params, b) : repealProblem(state, b.law);
    },
    (state, rec) => into(state, bill(state, rec.payload.bill), rec.at, `referendum on ${viaBill(rec.payload.bill)}: ${originOf(rec.payload)}`));
}

function into(state, b, at, via) {
  if (b.action === 'repeal') repeal(state, b.law, at, via, b.reason);
  else enact(state, b, at, via);
  b.status = 'in force'; b.inForce = at;
}

export default { name: 'laws', core: '0.9.8', install, law, bill, inForce, types, typeOf, ruleOf, lawRule, governs, repealProblem, members, lawProblem, tally, petitionsNeeded,
  parameterKeys: ['laws.types', 'laws.parliament', 'laws.parliament_days', 'laws.parliament_max_rule', 'laws.petition_days', 'laws.petition_share', 'laws.settings_by_law'] };
