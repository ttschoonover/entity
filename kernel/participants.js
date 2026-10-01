// 2.8 · Participants, and the kernel's own kinds.
//
// participant := { id, keys[], status, joined, [left], [removed, reason], [recovered[]], [name] }
// status      := active | applicant | left | removed
//
// The self-signed first act: a participant's first act is verified against the
// key contained in it. That proves possession of the key and nothing else.

import { validateDocument, Parameters, loadDocument } from './parameters.js';
import { canonical } from './canonical.js';

// A module's origin, as a decision (or the founding) records it. The digest is
// what is trusted; the source is only where to find those bytes.
export function installProblem(list) {
  if (list === undefined) return null;
  if (!Array.isArray(list)) return 'install must be a list of { name, source, digest }';
  for (const m of list) {
    if (!m || !/^[a-z][a-z0-9-]{0,39}$/.test(m.name || '')) return 'a module name is lowercase letters, digits and -';
    if (m.name === 'deliberation') return 'deliberation is part of the core';
    if (typeof m.source !== 'string' || !m.source) return `module ${m.name} needs a source`;
    if (!/^[0-9a-f]{64}$/.test(m.digest || '')) return `module ${m.name} needs a digest`;
  }
  return null;
}

function sourceMismatch(act) {
  if (act.source === undefined) return null;
  try { return canonical(loadDocument(act.source)) === canonical(act.document) ? null : 'source text does not parse to the document it accompanies'; }
  catch (e) { return `source text does not parse: ${e.message}`; }
}
import { signerKeyLine, verify, keyId, parsePublicKeyLine } from './keys.js';
import { resolveElectorate, admissionProblem } from './effects.js';

// A fork names its parent: the entity, and its record at the fork point by
// count, head and prefix root. The parent's members at that point keep their
// ids here, claimable only with a key they held there. `carry` is module state
// taken over as of the fork point (balances, deeds): anyone holding the
// parent's record can check it, and `entity verify` does (see kernel/fork.js).
function forkProblem(act) {
  if (act.parent === undefined) return act.carry !== undefined ? 'only a fork carries state from a parent' : null;
  const p = act.parent;
  if (!p || typeof p !== 'object') return 'parent must be { entity, count, head, root, members }';
  if (!/^[a-z0-9-]{8,64}$/.test(p.entity || '') || p.entity === act.entity) return 'parent.entity must name another entity';
  if (!Number.isInteger(p.count) || p.count < 1) return 'parent.count is the number of the parent\'s records the fork starts from';
  if (!/^[0-9a-f]{64}$/.test(p.root || '') || !/^[0-9a-f]{64}$/.test(p.head || '')) return 'parent.root and parent.head are hashes';
  if (!p.members || typeof p.members !== 'object' || Object.values(p.members).some(k => !Array.isArray(k) || k.some(x => typeof x !== 'string'))) return 'parent.members is { id: [keys] }';
  const founderKeys = p.members[act.by];
  if (founderKeys && !founderKeys.includes(keyId(act.key))) return `${act.by} was a member of the parent: found the fork with a key ${act.by} held there, or choose another id`;
  if (act.carry !== undefined) {
    if (!act.carry || typeof act.carry !== 'object' || Array.isArray(act.carry)) return 'carry is { module: its state at the fork point }';
    const on = act.document?.parameters?.['entity.modules']?.value || [];
    const off = Object.keys(act.carry).filter(m => !on.includes(m));
    if (off.length) return `carried state of ${off.join(', ')} needs those modules enabled`;
  }
  return null;
}

// At founding the founder is the only member, and no module has any state yet:
// the electorate the document names must already be someone, or be "none".
function foundingElectorateProblem(registry, act, founder) {
  const st = { entity: { id: act.entity, founder }, participants: { [founder]: { id: founder, status: 'active', keys: [] } }, order: [founder], m: {}, proposals: {}, modules: {} };
  const params = new Parameters(act.document, registry.catalog);
  const e = resolveElectorate(registry, st, params, act.at);
  if (e.frozen) return null;
  if (e.why) return `decision.electorate: ${e.why}`;
  return e.total > 0 ? null : `decision.electorate "${e.spec}" would have nobody on it at founding; found with "founder" or "members" and change it by decision once it exists`;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const participants = (state) => state.order.map(id => state.participants[id]);
export const active = (state) => participants(state).filter(p => p.status === 'active');
export const participant = (state, id) => state.participants[id] || null;

function keyOwner(state, line) {
  const k = keyId(line);
  return participants(state).find(p => p.keys.map(keyId).includes(k)) || null;
}

export async function whoSigned(state, message, signature, namespace) {
  const line = signerKeyLine(signature);
  if (!line) return null;
  const p = keyOwner(state, line);
  if (!p) return null;
  const r = await verify(message, signature, p.keys, namespace);
  return r.ok ? p.id : null;
}

export function install(registry) {
  installElectorates(registry);
  installEffects(registry);
  registry.registerKind({
    name: 'entity.found',
    selfSigned: true,
    check(state, act, { registry }) {
      if (state.entity) return 'this entity has already been founded';
      if (!ID.test(act.by || '')) return `founder id "${act.by}" is not a valid id`;
      if (!/^[a-z0-9-]{8,64}$/.test(act.entity || '')) return 'entity id must be 8–64 characters of a-z, 0-9 and -';
      const problems = validateDocument(act.document);
      if (problems.length) return `the parameter document is invalid: ${problems.join('; ')}`;
      const bad = installProblem(act.install);
      if (bad) return bad;
      const fork = forkProblem(act);
      if (fork) return fork;
      return sourceMismatch(act) || foundingElectorateProblem(registry, act, act.by);
    },
    reduce(state, rec) {
      const act = rec.payload.act;
      const doc = structuredClone(act.document);
      if (doc.parameters['entity.founded']) doc.parameters['entity.founded'].value = act.at;
      state.entity = { id: act.entity, founded: act.at, founder: act.by };
      if (act.parent) state.entity.parent = structuredClone(act.parent);
      for (const [k, v] of Object.entries(act.carry || {})) state.m[k] = structuredClone(v);
      state.modules = {};
      for (const m of act.install || []) state.modules[m.name] = { source: m.source, digest: m.digest, at: act.at, by: 'founding' };
      state.doc = doc;
      state.source = act.source || null;
      state.participants[act.by] = { id: act.by, keys: [keyId(act.key)], status: 'active', joined: act.at };
      state.order.push(act.by);
    },
  });

  // Applying a preset is part of founding, and only founding.
  registry.registerKind({
    name: 'entity.preset',
    check(state, act, { registry }) {
      if (act.by !== state.entity.founder) return 'only the founder may apply a preset';
      if (state.order.length > 1) return 'the founding window has closed: a second participant exists, so the values belong to the membership';
      if (state.decisions > 0) return 'the founding window has closed: a decision has been made';
      const problems = validateDocument(act.document);
      if (problems.length) return `the parameter document is invalid: ${problems.join('; ')}`;
      return sourceMismatch(act) || foundingElectorateProblem(registry, { ...act, entity: state.entity.id }, state.entity.founder);
    },
    reduce(state, rec) {
      const doc = structuredClone(rec.payload.act.document);
      if (doc.parameters['entity.founded']) doc.parameters['entity.founded'].value = state.entity.founded;
      state.doc = doc;
      state.source = rec.payload.act.source || null;
    },
  });

  registry.registerKind({
    name: 'participant.apply',
    selfSigned: true,
    check(state, act) {
      if (!ID.test(act.by || '')) return `"${act.by}" is not a valid participant id`;
      if (state.participants[act.by]) return `the id ${act.by} is already taken`;
      const held = state.entity.parent?.members?.[act.by];
      if (held && !held.includes(keyId(act.key))) return `${act.by} was a member of ${state.entity.parent.name || state.entity.parent.entity}, which this entity forked from; the id is theirs, claimed by applying with a key it held there`;
      if (keyOwner(state, act.key)) return 'this key already belongs to a participant; a key is one participant';
      return null;
    },
    reduce(state, rec) {
      const act = rec.payload.act;
      const open = new Parameters(state.doc, state.catalog).value('membership.admission') === 'open';
      state.participants[act.by] = { id: act.by, keys: [keyId(act.key)], status: open ? 'active' : 'applicant', joined: act.at, ...(act.name ? { name: act.name } : {}) };
      state.order.push(act.by);
    },
    records: {
      'participant.admitted'(state, rec) {
        const p = state.participants[rec.payload.id];
        p.status = 'active'; p.admitted = rec.at;
      },
    },
  });

  // Exit is unconditional: the only check is that there is something to leave.
  registry.registerKind({
    name: 'participant.leave',
    check(state, act) {
      const s = state.participants[act.by].status;
      return s === 'left' ? 'already left' : s === 'removed' ? 'already removed' : null;
    },
    reduce(state, rec) {
      const p = state.participants[rec.payload.act.by];
      p.status = 'left'; p.left = rec.at;
    },
  });

  registry.registerKind({
    name: 'participant.key',
    check(state, act) {
      const p = state.participants[act.by];
      if (!act.add && !act.revoke) return 'nothing to change: give add or revoke';
      if (act.add) {
        const o = keyOwner(state, act.add);
        if (o) return o.id === act.by ? 'that key is already yours' : 'that key belongs to another participant';
      }
      if (act.revoke) {
        if (!p.keys.includes(keyId(act.revoke))) return 'cannot revoke a key you do not hold';
        if (p.keys.length === 1 && !act.add) return 'cannot revoke your only key without adding another';
      }
      return null;
    },
    reduce(state, rec) {
      const { by, add, revoke } = rec.payload.act;
      const p = state.participants[by];
      if (add) p.keys.push(keyId(add));
      if (revoke) { p.keys = p.keys.filter(k => k !== keyId(revoke)); retire(p, [keyId(revoke)], rec.at); }
    },
  });
}

// A key a participant no longer holds is remembered with the time it stopped
// being theirs, so a signature it made before then (on a checkpoint, say)
// still counts.
function retire(p, keys, at) { p.retired = [...(p.retired || []), ...keys.map(key => ({ key, until: at }))]; }
export const keysAt = (p, at) => [...p.keys, ...(p.retired || []).filter(r => at && r.until > at).map(r => r.key)];

// ── the kernel's own electorates ─────────────────────────────────────────────

export function installElectorates(registry) {
  registry.registerElectorate({
    name: 'members', module: 'kernel',
    describe: () => 'every active member, one vote each',
    check: (state, arg) => (arg ? '"members" takes no argument' : null),
    roll: (state) => Object.fromEntries(active(state).map(p => [p.id, 1])),
  });
  registry.registerElectorate({
    name: 'founder', module: 'kernel',
    describe: () => 'the founder alone',
    check: (state, arg) => (arg ? '"founder" takes no argument' : null),
    roll: (state) => ({ [state.entity.founder]: 1 }),
  });
  registry.registerElectorate({
    name: 'member', module: 'kernel',
    describe: (id) => `${id} alone`,
    check: (state, id) => (!id ? 'name the member: member:ID' : !state.participants[id] ? `${id} is not on the register` : null),
    roll: (state, id) => ({ [id]: 1 }),
  });
}

// ── removal, recovery and admission, by decision ─────────────────────────────

const REASON = (r) => (typeof r !== 'string' || !r.trim() || r.length > 500 ? 'give a reason of 1–500 characters; it is published' : null);

export function installEffects(registry) {
  registry.registerEffect({
    name: 'participant.remove', module: 'kernel',
    rule: (p) => p.value('membership.removal_rule'),
    describe: (e) => `Remove ${e.id} (${e.reason})`,
    check(state, e) {
      const p = state.participants[e.id];
      if (!p) return `${e.id} is not on the register`;
      if (p.status !== 'active' && p.status !== 'applicant') return `${e.id} has ${p.status === 'removed' ? 'already been removed' : 'left'}`;
      const why = REASON(e.reason); if (why) return why;
      if (p.status === 'active' && active(state).length <= 1) return 'this would leave the entity with no active member';
      return null;
    },
  });
  registry.registerRecord('participant.remove', (state, rec) => {
    const p = state.participants[rec.payload.id];
    p.status = 'removed'; p.removed = rec.at; p.reason = rec.payload.reason;
  });

  registry.registerEffect({
    name: 'participant.rekey', module: 'kernel',
    rule: (p) => p.value('membership.recovery_rule'),
    describe: (e) => `Give ${e.id} a new key, replacing every key they hold (${e.reason})`,
    check(state, e) {
      const p = state.participants[e.id];
      if (!p) return `${e.id} is not on the register`;
      if (p.status !== 'active' && p.status !== 'applicant') return `${e.id} is no longer a member`;
      try { parsePublicKeyLine(e.key); } catch { return 'key must be an ssh-ed25519 public key line'; }
      const o = keyOwner(state, e.key);
      if (o) return o.id === e.id ? `${e.id} already holds that key` : 'that key belongs to another participant';
      return REASON(e.reason);
    },
  });
  registry.registerRecord('participant.rekey', (state, rec) => {
    const p = state.participants[rec.payload.id];
    retire(p, p.keys, rec.at);
    p.keys = [keyId(rec.payload.key)];
    p.recovered = [...(p.recovered || []), { at: rec.at, reason: rec.payload.reason, ...(rec.payload.proposal ? { proposal: rec.payload.proposal } : {}), ...(rec.payload.via ? { via: rec.payload.via } : {}) }];
  });

  registry.registerEffect({
    name: 'participant.admit', module: 'kernel',
    rule: (p) => p.value('membership.admission_rule'),
    describe: (e) => `Admit ${e.id}`,
    check: (state, e, params, at, ctx = {}) => (state.participants[e.id]?.status === 'applicant' ? admissionProblem(ctx.registry, state, params, e.id) : `${e.id} is not an applicant`),
  });
  registry.registerRecord('participant.admit', (state, rec) => {
    const p = state.participants[rec.payload.id];
    p.status = 'active'; p.admitted = rec.at;
  });
}
