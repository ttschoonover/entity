// docs · documents written together: your own, shared with whom you choose, or
// the entity's, changed only by its decisions. Text is end-to-end encrypted
// unless a document is public.
//
// What goes where:
//   the record      who may do what with each document, and which version of an
//                   entity's document is in force. Never a document's text.
//   documents/      the text: content-addressed files (documents/DOC/ID.json),
//                   each signed by its author and, for an encrypted document,
//                   sealed in the author's browser. They replicate with the
//                   entity's repository (Radicle) and every node serves them,
//                   but only the people the record names can read or add to them.
//
// Two kinds of document, from the same parts:
//
// Your own (docs.personal on): you create it and decide who may do what.
//   doc.create    { encrypted?, public? }             you own it. Public: anyone may read
//                                                      it, and it is not encrypted
//   doc.share     { doc, to, role }                   to: a member, members, office:ID or
//                                                      committee:ID; role: viewer,
//                                                      commenter, editor or owner
//   doc.unshare   { doc, to }                         by an owner
//   doc.leave     { doc }                             give up a role shared with you
//   doc.archive   { doc, archived }                   by an owner: set aside, or bring back
//
// The entity's (by decision):
//   docs.create   { doc, title, read, comment, draft, rule?, encrypted? }
//                 read / comment / draft: public (read only), members, office:ID or committee:ID
//                 rule: the least rule a change to it needs (docs.adopt_rule if not given)
//   docs.amend    { doc, title?, comment?, draft?, rule? }
//   docs.adopt    { doc, version, base }               makes a version the one in force;
//                 base must be the version in force now (null for the first), so nobody
//                 adopts over a change they have not seen
//   docs.retire   { doc }
// Anyone with draft rights writes drafts (versions) freely; a draft becomes the
// document only when a decision adopts it, or a committee or office granted
// docs.adopt (the authority module) does.
//
// The files (all signed in namespace entity.docs; id = hash of the rest):
//   version  { type, entity, doc, parent, by, at, note?, title, body }   or, sealed,
//            { ..., enc: { epoch, iv, ct } } holding JSON { title, body }
//   comment  { type, entity, doc, version, by, at, reply?, resolves?, quote, text } or enc
//   keys     { type, entity, doc, epoch, by, at, wraps: { xpk: { to, fromXpk, iv, ct } } }
//   xkey     { type, entity, by, at, xpk }   a member's encryption key, kept in documents/_keys/
// A node checks each file before keeping it, and every page checks every file
// again before showing it: the node is trusted with nothing.

import { actId } from '../../kernel/signed.js';
import { hash } from '../../kernel/hash.js';
import { canonical } from '../../kernel/canonical.js';
import { originOf } from '../../kernel/effects.js';

export const NS = 'entity.docs';
export const ROLES = ['viewer', 'commenter', 'editor', 'owner'];
const RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const atLeast = (role, want) => (RANK[role] || 0) >= RANK[want];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const LIMITS = { title: 200, body: 400000, note: 200, quote: 1000, comment: 4000, wraps: 200 };

export const docId = (act) => 'doc-' + actId(act).slice(0, 12);
const book = (state) => (state.m.docs ||= { docs: {} });
export const docOf = (state, id) => state.m.docs?.docs?.[id] || null;
export const allDocs = (state) => Object.values(state.m.docs?.docs || {});

// Is this person, at this time, among those a spec names?
//   members | office:ID | committee:ID | a member's id | public (anyone at all)
export function inSpec(state, spec, who, at) {
  if (spec === 'public') return true;
  const p = state.participants[who];
  if (!p || p.status !== 'active') return false;
  if (spec === 'members') return true;
  const live = (list) => (list || []).some(m => m.id === who && (!m.since || m.since <= at) && (!m.until || m.until > at));
  const [kind, id] = String(spec).split(':');
  if (kind === 'office' && id) return live(state.m.offices?.[id]?.holders);
  if (kind === 'committee' && id) return live(state.m.committees?.[id]?.members);
  return spec === who;
}
export function specWhy(state, spec, { allowPublic = false, allowMember = false } = {}) {
  if (spec === 'members' || (allowPublic && spec === 'public')) return null;
  const [kind, id] = String(spec || '').split(':');
  if (kind === 'office' && id) return state.m.offices?.[id] && !state.m.offices[id].abolished ? null : `there is no office ${id}`;
  if (kind === 'committee' && id) return state.m.committees?.[id] && !state.m.committees[id].dissolved ? null : `there is no committee ${id}`;
  if (allowMember && state.participants[spec]) return null;
  return `say who: members${allowPublic ? ', public' : ''}, office:ID, committee:ID${allowMember ? ' or a member' : ''}`;
}
const live = (s, at) => s.since <= at && (!s.until || s.until > at);

// What someone may do with a document at a moment: owner, editor, commenter,
// viewer, or null. For the entity's documents, draft rights are "editor".
export function roleOf(state, id, who, at) {
  const d = docOf(state, id);
  if (!d) return null;
  if (d.mode === 'personal') {
    if (who && d.owner === who) return 'owner';
    let best = null;
    for (const [to, list] of Object.entries(d.shares)) {
      if (!inSpec(state, to, who, at)) continue;
      for (const s of list) if (live(s, at) && (!best || RANK[s.role] > RANK[best])) best = s.role;
    }
    if (!best && d.public) return 'viewer';
    return d.archived && best && best !== 'owner' ? 'viewer' : best;
  }
  if (d.retired) return inSpec(state, d.read, who, at) ? 'viewer' : null;
  if (inSpec(state, d.draft, who, at)) return 'editor';
  if (inSpec(state, d.comment, who, at)) return 'commenter';
  if (inSpec(state, d.read, who, at)) return 'viewer';
  return null;
}
export const isEncrypted = (d) => !!d && d.encrypted;
// The members who may read an encrypted document now: whose keys its key is wrapped for.
export function readers(state, id, at) {
  return Object.keys(state.participants).filter(p => state.participants[p].status === 'active' && roleOf(state, id, p, at));
}
// The version in force, for an entity's document.
export const inForce = (d) => (d?.adopted?.length ? d.adopted[d.adopted.length - 1].version : null);

// ── the files ────────────────────────────────────────────────────────────
export const material = (blob) => { const { sig, id, ...rest } = blob; return canonical(rest); };
export const blobId = (blob) => hash(material(blob));
const str = (v, max) => typeof v === 'string' && v.length <= max;
const sealedOk = (x) => x && typeof x === 'object' && Number.isInteger(x.epoch) && x.epoch >= 1 && typeof x.iv === 'string' && B64.test(x.iv) && x.iv.length <= 24 && typeof x.ct === 'string' && B64.test(x.ct);

// Is this file one the record allows? PURE, apart from `have`: the ids of the
// files already kept for this document (a version's parent, a comment's version).
// Signatures are checked separately (verifyBlob), as they are asynchronous.
export function checkBlob(state, blob, { have = () => true } = {}) {
  if (!blob || typeof blob !== 'object') return 'not a document file';
  if (blob.entity !== state.entity?.id) return 'this file belongs to another entity';
  if (!state.participants[blob.by]) return `${blob.by} is not a member`;
  if (typeof blob.at !== 'string' || isNaN(Date.parse(blob.at))) return 'a file needs a time';
  if (typeof blob.sig !== 'string') return 'a file must be signed';
  if (blob.id !== undefined && blob.id !== blobId(blob)) return 'the file does not match its id';
  if (blob.type === 'xkey') {
    if (state.participants[blob.by].status !== 'active') return 'only members register keys';
    return typeof blob.xpk === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(blob.xpk) ? null : 'not an encryption key';
  }
  const d = docOf(state, blob.doc);
  if (!d) return `there is no document ${blob.doc}`;
  const role = roleOf(state, blob.doc, blob.by, blob.at);
  const enc = isEncrypted(d);
  if (blob.type === 'version') {
    if (!atLeast(role, 'editor')) return `${blob.by} may not write in this document`;
    if (d.mode === 'governed' && d.retired) return 'this document is retired';
    if (blob.parent !== null && !(typeof blob.parent === 'string' && HEX.test(blob.parent))) return 'parent is the id of a version, or null';
    if (blob.parent && !have(blob.parent)) return 'the version this one starts from is not here';
    if (blob.note !== undefined && !str(blob.note, LIMITS.note)) return `a note is at most ${LIMITS.note} characters`;
    if (enc) {
      if (blob.body !== undefined || blob.title !== undefined) return 'this document is encrypted: its text must be sealed';
      if (!sealedOk(blob.enc) || blob.enc.ct.length > Math.ceil((LIMITS.body + LIMITS.title + 64) * 4 / 3) * 4) return 'the sealed text is not well formed, or too long';
    } else {
      if (blob.enc !== undefined) return 'this document is public: it is not sealed';
      if (!str(blob.title, LIMITS.title) || !str(blob.body, LIMITS.body)) return `a version is a title of at most ${LIMITS.title} and a text of at most ${LIMITS.body} characters`;
    }
    return null;
  }
  if (blob.type === 'comment') {
    if (!atLeast(role, 'commenter')) return `${blob.by} may not comment on this document`;
    if (!(typeof blob.version === 'string' && HEX.test(blob.version)) || !have(blob.version)) return 'a comment is on a version that is here';
    for (const k of ['reply', 'resolves']) if (blob[k] !== undefined && !(typeof blob[k] === 'string' && HEX.test(blob[k]) && have(blob[k]))) return `${k} is the id of a comment that is here`;
    if (enc) {
      if (blob.text !== undefined || blob.quote !== undefined) return 'this document is encrypted: comments are sealed';
      if (!sealedOk(blob.enc) || blob.enc.ct.length > (LIMITS.comment + LIMITS.quote) * 6) return 'the sealed comment is not well formed, or too long';
    } else if (!str(blob.text, LIMITS.comment) || (blob.quote !== undefined && !str(blob.quote, LIMITS.quote))) return `a comment is at most ${LIMITS.comment} characters`;
    return null;
  }
  if (blob.type === 'keys') {
    if (!enc) return 'this document is not encrypted';
    if (!role) return `${blob.by} cannot read this document`;
    if (!Number.isInteger(blob.epoch) || blob.epoch < 1) return 'an epoch is a whole number from 1';
    const w = blob.wraps;
    if (!w || typeof w !== 'object' || !Object.keys(w).length || Object.keys(w).length > LIMITS.wraps) return 'wraps is one or more wrapped keys';
    for (const [xpk, x] of Object.entries(w)) {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(xpk) || !x || !roleOf(state, blob.doc, x.to, blob.at)) return 'a key was wrapped for someone who cannot read this document';
      if (!/^[A-Za-z0-9+/]{43}=$/.test(x.fromXpk || '') || !str(x.iv, 24) || !str(x.ct, 200) || !B64.test(x.iv) || !B64.test(x.ct)) return 'a wrapped key is not well formed';
    }
    return null;
  }
  return 'a file is a version, a comment, keys or an xkey';
}
// The signature, against the author's keys on the record. keys: kernel/keys.js.
export async function verifyBlob(state, blob, keys) {
  const p = state.participants[blob.by];
  if (!p) return false;
  const v = await keys.verify(material(blob), blob.sig, p.keys, NS).catch(() => ({ ok: false }));
  return !!v.ok;
}
// What a sealed file's encryption is bound to: where it is and who wrote it.
export const sealContext = (blob) => ['docs.sealed', blob.entity, blob.doc, blob.type, blob.by, blob.at, blob.parent ?? blob.version ?? ''].join('\n');

// ── a document's versions ────────────────────────────────────────────────
// The heads: versions nothing starts from. Two heads mean two people wrote
// from the same version at once; the next save merges them.
export function heads(versions) {
  const parents = new Set(versions.map(v => v.parent).filter(Boolean));
  return versions.filter(v => !parents.has(v.id)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}
export const latestHead = (versions) => heads(versions).at(-1) || null;
export function lineage(versions, id) {
  const by = new Map(versions.map(v => [v.id, v])), out = [];
  for (let v = by.get(id); v; v = v.parent ? by.get(v.parent) : null) out.push(v);
  return out;
}

// Lines removed and added between two texts (the smallest diff).
export function diffLines(a, b) {
  const x = String(a).split('\n'), y = String(b).split('\n');
  const n = x.length, m = y.length;
  if (n * m > 4e6) return [...x.map(l => ['-', l]), ...y.map(l => ['+', l])];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push([' ', x[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', x[i++]]);
    else out.push(['+', y[j++]]);
  }
  while (i < n) out.push(['-', x[i++]]);
  while (j < m) out.push(['+', y[j++]]);
  return out;
}
// For each line of a, the index of the line of b it is kept as, or -1.
function match(a, b) {
  const map = new Array(a.length).fill(-1);
  let i = 0, j = 0;
  for (const [op] of diffLines(a.join('\n'), b.join('\n'))) {
    if (op === ' ') { map[i] = j; i++; j++; } else if (op === '-') i++; else j++;
  }
  return map;
}
// Three-way merge by lines: what both sides did to their common version.
// Returns { text, conflicts }; conflicting passages carry markers to resolve.
export function merge3(base, ours, theirs, { ourName = 'yours', theirName = 'theirs' } = {}) {
  const O = String(base).split('\n'), A = String(ours).split('\n'), B = String(theirs).split('\n');
  const ma = match(O, A), mb = match(O, B);
  const out = []; let conflicts = 0, o = 0, a = 0, b = 0;
  const eq = (x, y) => x.length === y.length && x.every((l, k) => l === y[k]);
  while (o <= O.length) {
    // the next base line kept unchanged on both sides
    let s = o;
    while (s < O.length && !(ma[s] >= a && mb[s] >= b)) s++;
    const ae = s < O.length ? ma[s] : A.length, be = s < O.length ? mb[s] : B.length;
    const oc = O.slice(o, s), ac = A.slice(a, ae), bc = B.slice(b, be);
    if (eq(ac, oc)) out.push(...bc);
    else if (eq(bc, oc) || eq(ac, bc)) out.push(...ac);
    else { conflicts++; out.push(`<<<<<<< ${ourName}`, ...ac, '=======', ...bc, `>>>>>>> ${theirName}`); }
    if (s >= O.length) break;
    out.push(O[s]); o = s + 1; a = ae + 1; b = be + 1;
  }
  return { text: out.join('\n'), conflicts };
}

// ── the record ───────────────────────────────────────────────────────────
function install(r) {
  const active = (state, id) => state.participants[id]?.status === 'active';
  const personal = (state, id) => { const d = docOf(state, id); return d && d.mode === 'personal' ? d : null; };

  r.registerKind({
    name: 'doc.create', module: 'docs',
    check(state, a, { params }) {
      if (!params.value('docs.personal')) return 'members do not keep documents of their own here (docs.personal is off)';
      if (!active(state, a.by)) return 'only members create documents';
      if (a.public !== undefined && typeof a.public !== 'boolean') return 'public is true or false';
      if (a.encrypted !== undefined && typeof a.encrypted !== 'boolean') return 'encrypted is true or false';
      if (a.public && a.encrypted) return 'a public document is not encrypted';
      if (a.public && !params.value('docs.public_allowed')) return 'documents here are never public (docs.public_allowed is off)';
      const mine = allDocs(state).filter(d => d.mode === 'personal' && d.owner === a.by && !d.archived).length;
      return mine >= params.value('docs.max_per_member') ? `you already have ${mine} documents: archive one first` : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = docId(a);
      book(state).docs[id] = { id, mode: 'personal', owner: a.by, created: rec.at, public: !!a.public, encrypted: !a.public && a.encrypted !== false, shares: {}, archived: false };
    },
  });
  const ownerOnly = (state, a) => {
    const d = personal(state, a.doc);
    if (!d) return `there is no document ${a.doc} of a member's own`;
    return roleOf(state, a.doc, a.by, a.at) === 'owner' ? null : 'only an owner of the document may do that';
  };
  r.registerKind({
    name: 'doc.share', module: 'docs',
    check(state, a) {
      const why = ownerOnly(state, a); if (why) return why;
      if (!ROLES.includes(a.role)) return 'role is viewer, commenter, editor or owner';
      const s = specWhy(state, a.to, { allowMember: true }); if (s) return s;
      if (a.to === docOf(state, a.doc).owner) return 'that is the document\'s owner';
      const cur = (docOf(state, a.doc).shares[a.to] || []).find(x => live(x, a.at));
      return cur && cur.role === a.role ? `${a.to} is already ${a.role === 'owner' ? 'an' : 'a'} ${a.role}` : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, d = docOf(state, a.doc), list = (d.shares[a.to] ||= []);
      for (const s of list) if (live(s, rec.at)) s.until = rec.at;
      list.push({ role: a.role, since: rec.at, until: null, by: a.by });
    },
  });
  r.registerKind({
    name: 'doc.unshare', module: 'docs',
    check(state, a) {
      const why = ownerOnly(state, a); if (why) return why;
      return (docOf(state, a.doc).shares[a.to] || []).some(x => live(x, a.at)) ? null : `nothing is shared with ${a.to}`;
    },
    reduce(state, rec) { const a = rec.payload.act; for (const s of docOf(state, a.doc).shares[a.to]) if (live(s, rec.at)) s.until = rec.at; },
  });
  r.registerKind({
    name: 'doc.leave', module: 'docs',
    check(state, a) {
      const d = personal(state, a.doc);
      if (!d) return `there is no document ${a.doc} of a member's own`;
      return (d.shares[a.by] || []).some(x => live(x, a.at)) ? null : 'nothing is shared with you by name here';
    },
    reduce(state, rec) { const a = rec.payload.act; for (const s of docOf(state, a.doc).shares[a.by]) if (live(s, rec.at)) s.until = rec.at; },
  });
  r.registerKind({
    name: 'doc.archive', module: 'docs',
    check(state, a) {
      const why = ownerOnly(state, a); if (why) return why;
      if (typeof a.archived !== 'boolean') return 'archived is true or false';
      return docOf(state, a.doc).archived === a.archived ? (a.archived ? 'it is already archived' : 'it is not archived') : null;
    },
    reduce(state, rec) { const a = rec.payload.act; docOf(state, a.doc).archived = a.archived; },
  });

  // The entity's documents, by decision.
  const settingsWhy = (state, e, d = {}) => {
    if (e.title !== undefined && !(typeof e.title === 'string' && e.title.trim() && e.title.length <= LIMITS.title)) return `a title is 1–${LIMITS.title} characters`;
    for (const k of ['comment', 'draft']) if (e[k] !== undefined) { const w = specWhy(state, e[k]); if (w) return `${k}: ${w}`; }
    if (e.rule !== undefined && !['ordinary', 'organic', 'constitutional', 'entrenched'].includes(e.rule)) return 'rule is ordinary, organic, constitutional or entrenched';
    return null;
  };
  r.registerEffect({
    name: 'docs.create', module: 'docs',
    rule: (p) => p.value('docs.create_rule'),
    describe: (e) => `Keep the document "${e.title}" (${e.doc}): read by ${e.read}, drafted by ${e.draft}`,
    check(state, e) {
      if (!ID.test(e.doc || '')) return 'a document id is 1–40 lowercase letters, digits and -';
      if (docOf(state, e.doc)) return `there is already a document ${e.doc}`;
      if (typeof e.title !== 'string') return 'a document needs a title';
      const w = specWhy(state, e.read, { allowPublic: true }); if (w) return `read: ${w}`;
      if (e.comment === undefined || e.draft === undefined) return 'say who may comment and who may draft';
      if (e.encrypted !== undefined && typeof e.encrypted !== 'boolean') return 'encrypted is true or false';
      if (e.read === 'public' && e.encrypted) return 'a public document is not encrypted';
      return settingsWhy(state, e);
    },
  });
  r.registerRecord('docs.create', (state, rec) => {
    const e = rec.payload;
    book(state).docs[e.doc] = { id: e.doc, mode: 'governed', title: e.title.trim(), read: e.read, comment: e.comment, draft: e.draft, rule: e.rule || null,
      encrypted: e.read !== 'public' && e.encrypted !== false, created: rec.at, by: originOf(e), adopted: [], retired: null };
  });
  r.registerEffect({
    name: 'docs.amend', module: 'docs',
    rule: (p) => p.value('docs.create_rule'),
    describe: (e) => `Change the document ${e.doc}: ${['title', 'comment', 'draft', 'rule'].filter(k => e[k] !== undefined).map(k => `${k} → ${e[k]}`).join(', ')}`,
    check(state, e) {
      const d = docOf(state, e.doc);
      if (!d || d.mode !== 'governed') return `there is no document ${e.doc} of the entity's`;
      if (!['title', 'comment', 'draft', 'rule'].some(k => e[k] !== undefined)) return 'say what to change: title, comment, draft or rule';
      return settingsWhy(state, e, d);
    },
  });
  r.registerRecord('docs.amend', (state, rec) => {
    const e = rec.payload, d = docOf(state, e.doc);
    for (const k of ['title', 'comment', 'draft', 'rule']) if (e[k] !== undefined) d[k] = k === 'title' ? e[k].trim() : e[k];
  });
  r.registerEffect({
    name: 'docs.adopt', module: 'docs',
    rule: (p) => p.value('docs.adopt_rule'),
    describe: (e) => `Adopt version ${String(e.version).slice(0, 8)} of the document ${e.doc}`,
    check(state, e) {
      const d = docOf(state, e.doc);
      if (!d || d.mode !== 'governed') return `there is no document ${e.doc} of the entity's`;
      if (d.retired) return `${e.doc} is retired`;
      if (!HEX.test(e.version || '')) return 'version is the id of a version';
      if ((e.base ?? null) !== inForce(d)) return inForce(d) ? `${e.doc} has changed since: the version in force is ${inForce(d).slice(0, 8)}. Bring the draft up to date first` : `${e.doc} has no version in force yet: base is null`;
      return e.version === inForce(d) ? 'that version is already in force' : null;
    },
  });
  r.registerRecord('docs.adopt', (state, rec) => {
    const e = rec.payload;
    docOf(state, e.doc).adopted.push({ version: e.version, base: e.base ?? null, at: rec.at, by: originOf(e), ...(e.proposal ? { proposal: e.proposal } : {}), ...(e.via ? { via: e.via } : {}) });
  });
  r.registerEffect({
    name: 'docs.retire', module: 'docs',
    rule: (p) => p.value('docs.create_rule'),
    describe: (e) => `Retire the document ${e.doc}`,
    check: (state, e) => { const d = docOf(state, e.doc); return !d || d.mode !== 'governed' ? `there is no document ${e.doc} of the entity's` : d.retired ? 'it is already retired' : null; },
  });
  r.registerRecord('docs.retire', (state, rec) => { docOf(state, rec.payload.doc).retired = rec.at; });

  // A document may ask more of a change than docs.adopt_rule: its own rule.
  r.registerProposalCheck({ module: 'docs', check(state, act, params) {
    for (const e of act.effects || []) {
      if (e.kind !== 'docs.adopt') continue;
      const d = docOf(state, e.doc);
      if (d?.rule && params.rank(act.rule) < params.rank(d.rule)) return `a change to ${d.title} needs the ${d.rule} rule`;
    }
    return null;
  } });
}

export default { name: 'docs', core: '0.9.9', install, roleOf, readers, inForce, checkBlob, verifyBlob, blobId, material, heads, latestHead, merge3, diffLines, NS,
  parameterKeys: ['docs.personal', 'docs.public_allowed', 'docs.max_per_member', 'docs.create_rule', 'docs.adopt_rule'] };
