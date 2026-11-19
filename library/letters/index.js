// letters · official letters on standard letterheads, issued only by those
// with the authority to issue them, and signed by those who agreed to them.
//
// A letterhead belongs to one issuer:
//   entity          the members, by decision
//   office:ID       the holders of an office (a Finance Manager, a Minister)
//   committee:ID    a committee, jointly: by a majority of its members, or by
//                   all of them (joint: "majority" | "all")
// Letterheads are made, amended and retired by decision. Their look follows the
// entity's house style (letters.face, letters.accent, …); each letterhead may
// adjust it (style: { … }).
//
// A letter is issued with the effect letter.issue. Who may carry it is the
// whole point of the module:
//   - a letter on the entity's letterhead only by a carried decision;
//   - a letter on an office's or committee's letterhead only through an
//     authority grant (the authority module) held by that very office or
//     committee, so it takes effect only once the grant's signatures are in;
//   - a committee letterhead that says joint: "all" accepts only a grant
//     needing every member's signature.
// The Assembly cannot write in an officer's name, and an officer cannot write
// in the Assembly's, unless letters.assembly_may_issue_for_any says so.
//
// Signatures. A letter may carry its signatories (signatures: true): the
// officer who issued it, every committee member who signed the grant's use, or,
// for a decision, the members who voted for it. Each appears with their drawn
// signature if they have deposited one (letter.specimen), their name and their
// title. The drawn image is decoration; the signed acts on the record are the
// signature, and the letter's footer names them.
//
// Letters are withdrawn (letter.withdraw) under the same authority that may
// issue them, with a published reason. A withdrawn letter stays on the record.

import { hash } from '../../kernel/hash.js';
import { canonical } from '../../kernel/canonical.js';
import { Parameters } from '../../kernel/parameters.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LETTER_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,47}$/;
const HEX = /^[0-9A-Fa-f]{6}$/;
const FACES = ['palatino', 'computer-modern', 'times', 'garamond', 'baskerville'];
export const STYLE_KEYS = {
  face: (v) => (FACES.includes(v) ? null : `face is one of ${FACES.join(', ')}`),
  accent: (v) => (HEX.test(v) ? null : 'accent is a colour as six hex digits, e.g. 7A2E2E'),
  layout: (v) => (['centered', 'flush'].includes(v) ? null : 'layout is centered or flush'),
  rule: (v) => (['double', 'single', 'none'].includes(v) ? null : 'rule is double, single or none'),
  paper: (v) => (['letter', 'a4'].includes(v) ? null : 'paper is letter or a4'),
  dates: (v) => (['us', 'eu', 'iso'].includes(v) ? null : 'dates is us, eu or iso'),
  emblem: (v) => (['seal', 'ornament', 'none'].includes(v) ? null : 'emblem is seal, ornament or none'),
  emblem_text: (v) => (typeof v === 'string' && v.length <= 6 ? null : 'emblem_text is at most 6 characters (initials)'),
};
const TEXT = { name: 120, title: 120, subtitle: 160, motto: 160, closing: 60, footer: 300, seal_top: 60, seal_bottom: 60, signatory_role: 80 };
const LINES = { address: [6, 120], contact: [4, 120] };

const book = (state) => (state.m.letters ||= { heads: {}, letters: {}, specimens: {}, order: [] });
const headOf = (state, id) => state.m.letters?.heads?.[id] || null;
export const letterOf = (state, id) => state.m.letters?.letters?.[id] || null;

// Issuers: "entity" | "office:ID" | "committee:ID" → { kind, id }.
export function parseIssuer(spec) {
  if (spec === 'entity') return { kind: 'entity' };
  const m = /^(office|committee):([a-z0-9][a-z0-9-]{0,39})$/.exec(spec || '');
  return m ? { kind: m[1], id: m[2] } : null;
}
function issuerProblem(state, spec) {
  const is = parseIssuer(spec);
  if (!is) return 'issuer is "entity", "office:ID" or "committee:ID"';
  if (is.kind === 'office') { const o = state.m.offices?.[is.id]; if (!o || o.abolished) return `there is no office ${is.id}`; }
  if (is.kind === 'committee') { const c = state.m.committees?.[is.id]; if (!c || c.dissolved) return `there is no committee ${is.id}`; }
  return null;
}
export function issuerTitle(state, spec) {
  const is = parseIssuer(spec);
  if (!is || is.kind === 'entity') return 'the members';
  return is.kind === 'office' ? (state.m.offices?.[is.id]?.title || is.id) : (state.m.committees?.[is.id]?.title || is.id);
}

// Living holders of an office or members of a committee, at a moment.
function holders(state, is, at) {
  const live = (id) => state.participants[id]?.status === 'active';
  if (is.kind === 'office') return (state.m.offices?.[is.id]?.holders || []).filter(h => !h.until || h.until > at).map(h => h.id).filter(live);
  if (is.kind === 'committee') return (state.m.committees?.[is.id]?.members || []).filter(m => !m.until || m.until > at).map(m => m.id).filter(live);
  return [];
}

// How many of n signatures a grant's use needs (the authority module's rule,
// read from state so this module imports nothing it does not own).
function grantNeeds(state, g, n) {
  const r = g.needs !== undefined ? g.needs : g.to.committee ? (state.m.committees?.[g.to.committee]?.needs ?? 'majority') : 1;
  return r === 'all' ? n : r === 'majority' ? Math.floor(n / 2) + 1 : r;
}

// May this effect, on this letterhead, be carried this way? ctx.via names the
// grant when it is carried under one; otherwise it is a decision.
function authorityProblem(state, head, params, at, ctx) {
  const is = parseIssuer(head.issuer);
  const any = params.has('letters.assembly_may_issue_for_any') && params.value('letters.assembly_may_issue_for_any');
  if (!ctx.via) {
    if (is.kind === 'entity' || any) return null;
    return `the letterhead "${head.letterhead}" belongs to ${is.kind === 'office' ? 'the office' : 'the committee'} ${is.id}: its letters are issued through a grant held by ${is.kind === 'office' ? 'that office' : 'that committee'}, not by decision`;
  }
  const g = state.m.authority?.grants?.[ctx.via];
  if (!g) return `there is no grant ${ctx.via}`;
  if (is.kind === 'entity') return `the letterhead "${head.letterhead}" is the members' own: its letters are issued only by decision`;
  if ((is.kind === 'office' && g.to.office !== is.id) || (is.kind === 'committee' && g.to.committee !== is.id)) {
    return `the letterhead "${head.letterhead}" is issued only by ${is.kind === 'office' ? 'the office' : 'the committee'} ${is.id}; the grant ${g.id} belongs to ${g.to.office ? `the office ${g.to.office}` : `the committee ${g.to.committee}`}`;
  }
  if (is.kind === 'committee') {
    const n = holders(state, is, at).length;
    if (!n) return `the committee ${is.id} has no members`;
    const need = grantNeeds(state, g, n), floor = head.joint === 'all' ? n : Math.floor(n / 2) + 1;
    if (need < floor) return `letters on "${head.letterhead}" are issued ${head.joint === 'all' ? 'unanimously' : 'by a majority'} of the ${issuerTitle(state, head.issuer)}: the grant ${g.id} needs only ${need} of ${n} signatures`;
  }
  return null;
}

function linesProblem(name, v, [max, len]) {
  if (v === undefined) return null;
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || x.length > len)) return `${name} is a list of at most ${max} lines of at most ${len} characters`;
  return null;
}
function styleProblem(style) {
  if (style === undefined) return null;
  if (!style || typeof style !== 'object' || Array.isArray(style)) return 'style is { face, accent, layout, rule, paper, dates, emblem, emblem_text }';
  for (const [k, v] of Object.entries(style)) {
    if (!STYLE_KEYS[k]) return `style has no setting "${k}" (it has ${Object.keys(STYLE_KEYS).join(', ')})`;
    const why = STYLE_KEYS[k](v); if (why) return `style: ${why}`;
  }
  return null;
}
function headFieldsProblem(e, state, { creating }) {
  if (creating || e.issuer !== undefined) { const why = issuerProblem(state, e.issuer); if (why) return why; }
  if (creating && (typeof e.name !== 'string' || !e.name.trim())) return 'a letterhead needs a name: the largest line, usually the entity or house';
  for (const [k, n] of Object.entries(TEXT)) if (e[k] !== undefined && (typeof e[k] !== 'string' || e[k].length > n)) return `${k} is text of at most ${n} characters`;
  for (const [k, lim] of Object.entries(LINES)) { const why = linesProblem(k, e[k], lim); if (why) return why; }
  const is = parseIssuer(e.issuer);
  if (e.joint !== undefined && !['majority', 'all'].includes(e.joint)) return 'joint is "majority" or "all"';
  if (e.joint !== undefined && is && is.kind !== 'committee') return 'only a committee issues letters jointly';
  return styleProblem(e.style);
}

const HEAD_FIELDS = ['issuer', 'name', 'title', 'subtitle', 'motto', 'address', 'contact', 'closing', 'footer', 'seal_top', 'seal_bottom', 'signatory_role', 'joint', 'style'];

// What a letter's text is, for its fingerprint: everything that is printed.
export const letterFingerprint = (l) => hash(canonical({
  letter: l.letter, letterhead: l.letterhead, date: l.date, to: l.to || [], salutation: l.salutation || '', subject: l.subject,
  body: l.body, closing: l.closing || '', cc: l.cc || [], enclosures: l.enclosures || [],
}));

// The signatories of a letter as it is enacted, from where its authority came.
function signatories(state, head, e, rec) {
  const is = parseIssuer(head.issuer);
  const roleOf = (id) => {
    if (head.signatory_role) return head.signatory_role;
    if (is.kind === 'office') return state.m.offices?.[is.id]?.title || is.id;
    if (is.kind === 'committee') return `Member, ${state.m.committees?.[is.id]?.title || is.id}`;
    return 'Member';
  };
  let ids = [], how = null;
  if (rec.payload.exercise && state.m.authority?.exercises?.[rec.payload.exercise]) {
    const x = state.m.authority.exercises[rec.payload.exercise];
    ids = [...x.signers];
    how = { grant: x.grant, exercise: x.id };
  } else if (rec.payload.proposal && state.proposals?.[rec.payload.proposal]) {
    const p = state.proposals[rec.payload.proposal];
    ids = p.ballots.filter(b => b.choice === 'for').map(b => b.by);
    ids = [...new Set(ids)];
    how = { proposal: p.id, for: ids.length, against: new Set(p.ballots.filter(b => b.choice === 'against').map(b => b.by)).size, roll: (p.roll || []).length };
  }
  const spec = (id) => { const s = state.m.letters?.specimens?.[id]; return s && s.length && s[s.length - 1].drawing ? s.length - 1 : null; };
  return { how, list: ids.map(id => ({ id, role: roleOf(id), specimen: spec(id) })) };
}

function install(r) {
  r.registerEffect({
    name: 'letterhead.define', module: 'letters',
    rule: (p) => p.value('letters.letterhead_rule'),
    describe: (e) => `Make the letterhead "${e.title || e.name}" (${e.letterhead}) for ${e.issuer === 'entity' ? 'the members' : e.issuer}${e.joint ? `, issued jointly by ${e.joint === 'all' ? 'all members' : 'a majority'}` : ''}`,
    check(state, e) {
      if (!ID.test(e.letterhead || '')) return 'a letterhead id is 1–40 lowercase letters, digits and -';
      if (headOf(state, e.letterhead)) return `the letterhead ${e.letterhead} already exists (ids are never reused)`;
      return headFieldsProblem(e, state, { creating: true });
    },
  });
  r.registerEffect({
    name: 'letterhead.amend', module: 'letters',
    rule: (p) => p.value('letters.letterhead_rule'),
    describe: (e) => `Amend the letterhead ${e.letterhead}: ${HEAD_FIELDS.filter(k => e[k] !== undefined).join(', ')}`,
    check(state, e) {
      const h = headOf(state, e.letterhead);
      if (!h || h.retired) return `there is no letterhead ${e.letterhead} in use`;
      if (!HEAD_FIELDS.some(k => e[k] !== undefined)) return `say what to change: ${HEAD_FIELDS.join(', ')}`;
      if (e.issuer !== undefined && e.issuer !== h.issuer && Object.values(state.m.letters.letters).some(l => l.letterhead === h.letterhead)) {
        return `letters have been issued on ${e.letterhead}: its issuer cannot change. Retire it and make another`;
      }
      return headFieldsProblem({ ...h, ...e, style: e.style }, state, { creating: false });
    },
  });
  r.registerEffect({
    name: 'letterhead.retire', module: 'letters',
    rule: (p) => p.value('letters.letterhead_rule'),
    describe: (e) => `Retire the letterhead ${e.letterhead}`,
    check: (state, e) => { const h = headOf(state, e.letterhead); return !h || h.retired ? `there is no letterhead ${e.letterhead} in use` : null; },
  });

  r.registerEffect({
    name: 'letter.issue', module: 'letters',
    rule: (p) => p.value('letters.issue_rule'),
    describe: (e) => `Issue letter ${e.letter} on the letterhead ${e.letterhead}: "${e.subject}"`,
    check(state, e, params, at, ctx = {}) {
      if (!LETTER_ID.test(e.letter || '')) return 'a letter id is 1–48 letters, digits and - (e.g. FIN-2026-004)';
      if (letterOf(state, e.letter)) return `there is already a letter ${e.letter}`;
      const head = headOf(state, e.letterhead);
      if (!head) return `there is no letterhead ${e.letterhead}`;
      if (head.retired) return `the letterhead ${e.letterhead} has been retired`;
      const why = authorityProblem(state, head, params, at, ctx);
      if (why) return why;
      if (typeof e.subject !== 'string' || !e.subject.trim() || e.subject.length > 200) return 'a letter needs a subject of 1–200 characters';
      const max = params.value('letters.max_length');
      if (typeof e.body !== 'string' || !e.body.trim()) return 'a letter needs a body';
      if (e.body.length > max) return `the body is ${e.body.length} characters; letters.max_length is ${max}`;
      if (e.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return 'date, if given, is YYYY-MM-DD';
      if (e.date !== undefined && e.date > at.slice(0, 10)) return 'a letter cannot be dated in the future';
      for (const [k, lim] of [['to', [8, 120]], ['cc', [10, 120]], ['enclosures', [10, 160]]]) { const w = linesProblem(k, e[k], lim); if (w) return w; }
      if (e.salutation !== undefined && (typeof e.salutation !== 'string' || e.salutation.length > 120)) return 'a salutation is at most 120 characters';
      if (e.closing !== undefined && (typeof e.closing !== 'string' || e.closing.length > 60)) return 'a closing is at most 60 characters';
      if (e.signatures !== undefined && typeof e.signatures !== 'boolean') return 'signatures is true or false';
      const mode = params.value('letters.signatures');
      if (mode === 'never' && e.signatures === true) return 'letters here carry no signatures (letters.signatures is never)';
      if (mode === 'always' && e.signatures === false) return 'every letter here carries its signatures (letters.signatures is always)';
      return null;
    },
  });
  r.registerEffect({
    name: 'letter.withdraw', module: 'letters',
    rule: (p) => p.value('letters.issue_rule'),
    describe: (e) => `Withdraw letter ${e.letter}${e.reason ? `: ${e.reason}` : ''}`,
    check(state, e, params, at, ctx = {}) {
      const l = letterOf(state, e.letter);
      if (!l) return `there is no letter ${e.letter}`;
      if (l.withdrawn) return `${e.letter} was withdrawn on ${l.withdrawn.at.slice(0, 10)}`;
      if (typeof e.reason !== 'string' || !e.reason.trim() || e.reason.length > 500) return 'give a reason (at most 500 characters): it is published';
      return authorityProblem(state, headOf(state, l.letterhead), params, at, ctx);
    },
  });

  r.registerRecord('letterhead.define', (state, rec) => {
    const e = rec.payload, b = book(state);
    b.heads[e.letterhead] = { letterhead: e.letterhead, ...Object.fromEntries(HEAD_FIELDS.filter(k => e[k] !== undefined).map(k => [k, e[k]])),
      joint: e.joint || (parseIssuer(e.issuer).kind === 'committee' ? 'majority' : undefined), created: rec.at, retired: null, versions: 1 };
  });
  r.registerRecord('letterhead.amend', (state, rec) => {
    const e = rec.payload, h = state.m.letters.heads[e.letterhead];
    for (const k of HEAD_FIELDS) if (e[k] !== undefined) h[k] = k === 'style' ? { ...(h.style || {}), ...e.style } : e[k];
    h.versions++;
  });
  r.registerRecord('letterhead.retire', (state, rec) => { state.m.letters.heads[rec.payload.letterhead].retired = rec.at; });

  r.registerRecord('letter.issue', (state, rec) => {
    const e = rec.payload, b = book(state), head = b.heads[e.letterhead];
    const mode = new Parameters(state.doc, state.catalog).value('letters.signatures');
    const l = {
      letter: e.letter, letterhead: e.letterhead, head_version: head.versions, issuer: head.issuer,
      date: e.date || rec.at.slice(0, 10), issued: rec.at, record: rec.hash || null,
      to: e.to || [], salutation: e.salutation || '', subject: e.subject, body: e.body, closing: e.closing || '',
      cc: e.cc || [], enclosures: e.enclosures || [], signatures: mode === 'never' ? false : mode === 'always' ? true : e.signatures !== false, withdrawn: null,
    };
    const s = signatories(state, head, e, rec);
    l.authority = s.how;
    l.signatories = s.list;
    if (parseIssuer(head.issuer).kind === 'committee') {
      const n = holders(state, parseIssuer(head.issuer), rec.at).length;
      l.joint = { signed: s.list.length, of: n, unanimous: s.list.length >= n };
    }
    // The letterhead as it stood, so later amendments never alter a letter issued.
    l.head = JSON.parse(JSON.stringify({ ...head, versions: undefined }));
    l.fingerprint = letterFingerprint(l);
    b.letters[e.letter] = l; b.order.push(e.letter);
  });
  r.registerRecord('letter.withdraw', (state, rec) => {
    state.m.letters.letters[rec.payload.letter].withdrawn = { at: rec.at, reason: rec.payload.reason, ...(rec.payload.proposal ? { proposal: rec.payload.proposal } : { grant: rec.payload.via }) };
  });

  // A member deposits the drawing of their signature, used on letters they sign
  // from then on. null takes it away. Earlier letters keep the one they had.
  r.registerKind({
    name: 'letter.specimen', module: 'letters',
    check(state, act) {
      if (state.participants[act.by]?.status !== 'active') return `${act.by} is not an active member`;
      if (act.drawing === null) return null;
      if (typeof act.drawing !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(act.drawing)) return 'the drawing is a PNG image (a data: URL), or null to remove it';
      if (act.drawing.length > 80000) return 'the drawing is too large (at most about 60 KB)';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      (book(state).specimens[a.by] ||= []).push({ drawing: a.drawing, at: rec.at });
    },
  });
}

// The drawing a signatory had deposited when the letter was issued, or null.
export const specimenOf = (state, s) => (s.specimen === null || s.specimen === undefined ? null : state.m.letters?.specimens?.[s.id]?.[s.specimen]?.drawing || null);

// The house style, with a letterhead's own adjustments over it.
export function styleOf(params, head) {
  const pick = (k, d) => (params && params.has(`letters.${k}`) ? params.value(`letters.${k}`) : d);
  return { face: pick('face', 'palatino'), accent: pick('accent', '6B1E1E'), layout: pick('layout', 'centered'), rule: pick('rule', 'double'),
    paper: pick('paper', 'letter'), dates: pick('dates', 'us'), emblem: pick('emblem', 'seal'), emblem_text: '', ...(head?.style || {}) };
}

// The next free letter id on a letterhead: PREFIX-YEAR-NNN.
export function nextId(state, head, year) {
  const prefix = head.letterhead.split('-').slice(0, 3).map(w => w.slice(0, 3)).join('-').toUpperCase();
  const pre = `${prefix}-${year}-`;
  const used = Object.keys(state.m.letters?.letters || {}).filter(k => k.startsWith(pre)).map(k => Number(k.slice(pre.length)) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}

export default { name: 'letters', core: '0.7.7', install, parseIssuer, issuerTitle, letterOf, specimenOf, styleOf, nextId, letterFingerprint,
  parameterKeys: ['letters.letterhead_rule', 'letters.issue_rule', 'letters.signatures', 'letters.max_length', 'letters.assembly_may_issue_for_any',
    'letters.face', 'letters.accent', 'letters.layout', 'letters.rule', 'letters.paper', 'letters.dates', 'letters.emblem'] };
