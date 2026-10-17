// federation · a federation of separate entities. Each state is its own entity,
// with its own record, citizens and government; this module runs in the
// federal entity and keeps what the federation knows about its states.
//
// A state speaks to the federation through its registrar: a key the state's
// own government holds, registered here when the state is admitted. With it
// the state certifies, from its own record, who its citizens are and whom it
// appoints to the senate and the assembly (`entity federation certify` reads
// the state's record and signs this for the registrar).
//
//   federation.admit_state   { state, name, entity, keys }   by decision, federation.admit_rule
//   federation.release_state { state, reason }               by decision, federation.release_rule:
//                                                            lawful secession; its citizens leave
//                                                            the federation with it
//   federation.registrar     { state, keys }                 by decision, federation.registrar_rule
//
//   state.certify   (signed by the state's registrar key)
//     { state, key, count, head, citizens: { id: [state keys] }, senate: [ids], assembly: [ids] }
//     count and head name the point in the state's own record it was read from.
//   state.registrar (signed by the registrar key)  { state, key, keys }   hand over to new keys
//
//   citizen.enroll  (signed with the citizen's new federal key)
//     { state, key, state_key, state_sig }   state_sig is the citizen's STATE key
//     signing "federation.enroll / federal entity / id / federal key", so only
//     the holder of a certified citizen's key can take up that federal citizenship.
//
// Citizenship: every federal citizen is a citizen of exactly one state. A
// state may not certify someone another state still certifies. When a state's
// certification no longer lists someone, their federal citizenship ends.
//
// Electorates: senate, assembly, parliament (both chambers together).
// Seats: each state appoints federation.senators_per_state senators; the
// assembly's federation.assembly_seats are shared by population, at least one
// each, by the method of equal proportions.

import { keys as K } from '../../kernel/index.js';
import { originOf } from '../../kernel/effects.js';

export const NS = 'entity.federation';
export const enrollMaterial = (e) => ['federation.enroll', e.entity, e.id, e.key].join('\n');
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const fed = (state) => (state.m.federation = state.m.federation || { states: {}, citizens: {} });
const st = (state, id) => state.m.federation?.states?.[id];
const live = (state) => Object.values(state.m.federation?.states || {}).filter(s => !s.released);
const keyLine = (l) => { try { K.parsePublicKeyLine(l); return true; } catch { return false; } };

// Assembly seats by population: every state one, the rest by the method of
// equal proportions (priority = population / sqrt(n (n + 1))). Ties go to the
// earlier state id.
export function apportion(populations, seats) {
  const ids = Object.keys(populations).sort();
  const out = Object.fromEntries(ids.map(id => [id, ids.length <= seats ? 1 : 0]));
  for (let s = ids.length; s < seats; s++) {
    let best = null;
    for (const id of ids) {
      const n = out[id], pr = populations[id] / Math.sqrt(n * (n + 1));
      if (!best || pr > best.pr) best = { id, pr };
    }
    if (!best || populations[best.id] <= 0) break;
    out[best.id]++;
  }
  return out;
}
export const populations = (state, override = {}) =>
  Object.fromEntries(live(state).map(s => [s.id, s.id in override ? override[s.id] : Object.keys(s.certified?.citizens || {}).length]));
export const seatsOf = (state, params, override) => apportion(populations(state, override), params.value('federation.assembly_seats'));
// The state a person is a citizen of, by the latest certifications.
export function stateOf(state, id) {
  for (const s of live(state)) if (s.certified?.citizens?.[id]) return s.id;
  return null;
}
const chamber = (state, which) => {
  const ids = new Set();
  for (const s of live(state)) for (const id of (s.certified?.[which] || [])) if (state.participants[id]?.status === 'active') ids.add(id);
  return [...ids].sort();
};

function install(r) {
  r.registerEffect({
    name: 'federation.admit_state', module: 'federation',
    rule: (p) => p.value('federation.admit_rule'),
    describe: (e) => `Admit the state ${e.name} (${e.state})`,
    check(state, e) {
      if (!ID.test(e.state || '')) return 'a state id is lowercase letters, digits and -';
      if (st(state, e.state) && !st(state, e.state).released) return `${e.state} is already a state of the federation`;
      if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120) return 'a state needs a name';
      if (!/^e-[0-9a-f]{8,64}$/.test(e.entity || '')) return 'entity is the state entity\'s id (e-…)';
      if (live(state).some(s => s.entity === e.entity)) return `the entity ${e.entity} is already a state`;
      if (!Array.isArray(e.keys) || !e.keys.length || !e.keys.every(keyLine)) return 'keys are the registrar\'s public key lines';
      return null;
    },
  });
  r.registerRecord('federation.admit_state', (state, rec) => {
    const e = rec.payload;
    fed(state).states[e.state] = { id: e.state, name: e.name, entity: e.entity, keys: e.keys.map(K.keyId), admitted: rec.at, by: originOf(e), certified: null, history: [] };
  });

  r.registerEffect({
    name: 'federation.release_state', module: 'federation',
    rule: (p) => p.value('federation.release_rule'),
    describe: (e) => `Release ${e.state} from the federation (${e.reason})`,
    check(state, e) {
      if (!st(state, e.state) || st(state, e.state).released) return `${e.state} is not a state of the federation`;
      if (typeof e.reason !== 'string' || !e.reason.trim()) return 'a release needs a published reason';
      return null;
    },
  });
  r.registerRecord('federation.release_state', (state, rec) => {
    const s = st(state, rec.payload.state);
    s.released = { at: rec.at, reason: rec.payload.reason, by: originOf(rec.payload) };
    for (const id of Object.keys(s.certified?.citizens || {})) end(state, id, rec.at, `${s.name} left the federation`);
  });

  r.registerEffect({
    name: 'federation.registrar', module: 'federation',
    rule: (p) => p.value('federation.registrar_rule'),
    describe: (e) => `Give ${e.state} new registrar keys`,
    check(state, e) {
      if (!st(state, e.state) || st(state, e.state).released) return `${e.state} is not a state of the federation`;
      if (!Array.isArray(e.keys) || !e.keys.length || !e.keys.every(keyLine)) return 'keys are public key lines';
      return null;
    },
  });
  r.registerRecord('federation.registrar', (state, rec) => { st(state, rec.payload.state).keys = rec.payload.keys.map(K.keyId); });

  // Signed by the state's registrar, not a federal citizen.
  const byRegistrar = (state, act) => {
    const s = st(state, act.state);
    if (!s || s.released) return `${act.state} is not a state of the federation`;
    if (act.by !== act.state) return 'a state signs as itself: by is the state\'s id';
    if (typeof act.key !== 'string' || !s.keys.includes(K.keyId(act.key))) return `not signed with ${act.state}'s registrar key`;
    return null;
  };

  r.registerKind({
    name: 'state.registrar', module: 'federation', selfSigned: true,
    check(state, act) {
      const why = byRegistrar(state, act); if (why) return why;
      if (!Array.isArray(act.keys) || !act.keys.length || !act.keys.every(keyLine)) return 'keys are public key lines';
      return null;
    },
    reduce(state, rec) { st(state, rec.payload.act.state).keys = rec.payload.act.keys.map(K.keyId); },
  });

  r.registerKind({
    name: 'state.certify', module: 'federation', selfSigned: true,
    check(state, act, { params }) {
      const why = byRegistrar(state, act); if (why) return why;
      const s = st(state, act.state);
      if (!Number.isInteger(act.count) || act.count < 1 || !/^[0-9a-f]{64}$/.test(act.head || '')) return 'count and head name the point in the state\'s record this was read from';
      if (s.certified && act.count <= s.certified.count) return `${act.state} has already certified its record up to ${s.certified.count}; certify from a later point`;
      const c = act.citizens;
      if (!c || typeof c !== 'object' || Array.isArray(c)) return 'citizens is { id: [key lines] }';
      const ids = Object.keys(c);
      if (ids.length > 100000) return 'too many citizens in one certification';
      for (const id of ids) {
        if (!ID.test(id)) return `"${id}" is not a valid id`;
        if (!Array.isArray(c[id]) || !c[id].length || !c[id].every(x => typeof x === 'string')) return `${id}: give their keys`;
        const other = stateOf(state, id);
        if (other && other !== act.state) return `${id} is a citizen of ${other}; nobody is a citizen of two states. ${other} must certify without them first`;
      }
      for (const which of ['senate', 'assembly']) {
        const list = act[which] || [];
        if (!Array.isArray(list) || new Set(list).size !== list.length) return `${which} is a list of distinct ids`;
        for (const id of list) if (!c[id]) return `${id} is appointed to the ${which} but is not certified as a citizen of ${act.state}`;
      }
      const both = (act.senate || []).filter(id => (act.assembly || []).includes(id));
      if (both.length) return `${both.join(', ')} cannot sit in both chambers`;
      const per = params.value('federation.senators_per_state');
      if ((act.senate || []).length > per) return `each state appoints at most ${per} senator${per === 1 ? '' : 's'}`;
      const seats = seatsOf(state, params, { [act.state]: ids.length })[act.state];
      if ((act.assembly || []).length > seats) return `${act.state} has ${seats} seat${seats === 1 ? '' : 's'} in the assembly with ${ids.length} citizens`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, s = st(state, a.state);
      const before = Object.keys(s.certified?.citizens || {});
      s.certified = { at: rec.at, count: a.count, head: a.head, citizens: a.citizens, senate: a.senate || [], assembly: a.assembly || [] };
      s.history.push({ at: rec.at, count: a.count, head: a.head, citizens: Object.keys(a.citizens).length });
      for (const id of Object.keys(a.citizens)) fed(state).citizens[id] = a.state;
      for (const id of before) if (!a.citizens[id]) end(state, id, rec.at, `no longer a citizen of ${s.name}`);
    },
  });

  // Taking up federal citizenship: proved with the citizen's own state key.
  r.registerKind({
    name: 'citizen.enroll', module: 'federation', selfSigned: true,
    async check(state, act) {
      const s = st(state, act.state);
      if (!s || s.released) return `${act.state} is not a state of the federation`;
      if (!ID.test(act.by || '')) return `"${act.by}" is not a valid id`;
      const certified = s.certified?.citizens?.[act.by];
      if (!certified) return `${act.state} has not certified ${act.by} as its citizen`;
      if (!certified.map(K.keyId).includes(K.keyId(act.state_key || ''))) return `that is not a key ${act.state} certified for ${act.by}`;
      const p = state.participants[act.by];
      if (p && p.status === 'active') return `${act.by} is already a citizen of the federation`;
      if (p && p.status === 'applicant') return `${act.by} has applied by another way`;
      if (p && p.status === 'removed' && !p.lapsed) return `${act.by} was removed from the federation by its decision`;
      for (const q of Object.values(state.participants)) if (q.id !== act.by && q.keys.includes(K.keyId(act.key))) return 'this key already belongs to someone else';
      const v = await K.verify(enrollMaterial({ entity: act.entity, id: act.by, key: K.keyId(act.key) }), act.state_sig, [act.state_key], NS);
      return v.ok ? null : `the state signature does not check: ${v.error}`;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = state.participants[a.by];
      if (p) { Object.assign(p, { keys: [K.keyId(a.key)], status: 'active', rejoined: rec.at }); delete p.removed; delete p.reason; delete p.lapsed; delete p.left; }
      else { state.participants[a.by] = { id: a.by, keys: [K.keyId(a.key)], status: 'active', joined: a.at, state: a.state }; state.order.push(a.by); }
      state.participants[a.by].state = a.state;
      fed(state).citizens[a.by] = a.state;
    },
  });

  // The only way into the federation is through a state.
  r.registerAdmissionCheck({ module: 'federation',
    check: () => 'federal citizenship comes only through a state: a certified citizen takes it up with `entity federation enroll`' });

  for (const [name, describe, pick] of [
    ['senate', 'the senators the states appoint', (s) => chamber(s, 'senate')],
    ['assembly', 'the members of the assembly the states appoint', (s) => chamber(s, 'assembly')],
    ['parliament', 'the senate and the assembly together', (s) => [...new Set([...chamber(s, 'senate'), ...chamber(s, 'assembly')])].sort()],
  ]) {
    r.registerElectorate({ name, module: 'federation', describe: () => describe,
      check: (state, arg) => (arg ? `"${name}" takes no argument` : null),
      roll: (state) => Object.fromEntries(pick(state).map(id => [id, 1])) });
  }
}

// Federal citizenship ends with state citizenship. The founder of the
// federation is never removed this way, so the federation always has someone.
function end(state, id, at, reason) {
  const p = state.participants[id];
  if (!p || p.status !== 'active' || id === state.entity?.founder) return;
  p.status = 'removed'; p.removed = at; p.reason = reason; p.lapsed = true;
}

export default { name: 'federation', core: '0.9.8', install, apportion, seatsOf, populations, stateOf, enrollMaterial, NS,
  parameterKeys: ['federation.senators_per_state', 'federation.assembly_seats', 'federation.admit_rule', 'federation.release_rule', 'federation.registrar_rule'] };
