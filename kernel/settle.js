// 2.7 · Settlement.
//
//  1. Sort acts by `at`, ties by hash(canonical(act)).
//  2. For each: verify the signature via signedMaterial; run check; on failure
//     set it aside with the reason and continue.
//  3. On success run apply; append the act's record and apply's records, each
//     bearing the ACT's time.
//
// The governing invariant: two copies settled independently, at different
// times, on different machines, produce byte-identical record files.
// Nothing here reads a clock.
//
// Sealed records (kernel/sealing.js): when records.sealing is on, an act's
// records are sealed under the current key period, decided from the state
// before the act. `sealer.epochKey(n)` gives this copy's key for period n; a
// copy without it holds the act and everything after it, as for a missing
// module. An act that needs a key period which does not exist yet (after a
// member left, say) waits, with everything after it, until an epoch.open in
// the same batch opens one; then it is tried again. `records` are what goes on
// disk; `views` are the same records in the clear, for the caller to fold.

import { makeRecord } from './record.js';
import { signedMaterial, actHash, actId } from './signed.js';
import { verify } from './keys.js';
import { reduceRecord, paramsOf, enabledModules, knownModules } from './state.js';
import { shouldSeal, usableEpoch, sealRecord, recordTime } from './sealing.js';

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function sortActs(acts) {
  return acts.map(a => ({ a, h: actHash(a) }))
    .sort((x, y) => x.a.at < y.a.at ? -1 : x.a.at > y.a.at ? 1 : x.h < y.h ? -1 : x.h > y.h ? 1 : 0)
    .map(x => x.a);
}

function shape(act) {
  if (!act || typeof act !== 'object') return 'not an object';
  for (const f of ['kind', 'by', 'at', 'salt', 'signature']) if (typeof act[f] !== 'string') return `missing ${f}`;
  if (!AT.test(act.at)) return `"at" must be an ISO-8601 UTC timestamp with milliseconds, e.g. 2026-03-12T09:30:00.000Z`;
  return null;
}

// inPlace skips the defensive copy; replay uses it, nothing else should.
export async function settle(registry, state, acts, { dry = false, inPlace = false, sealer = null } = {}) {
  const s = inPlace && !dry ? state : structuredClone(state);
  s.catalog = registry.catalog;
  const applied = [], refused = [], records = [], views = [], held = [];
  const seen = new Set();
  let waitingFor = [];

  let queue = sortActs(acts);
  for (;;) {
    const later = [];            // waiting for a key period, in order
    let deferring = false, opened = false, stopped = false;
    for (let n = 0; n < queue.length; n++) {
      const act = queue[n];
      // A copy without the code for every module the entity relies on settles
      // nothing: it could reach a different result from a copy that has it. Its
      // acts wait; they are never refused for this.
      if (s.entity) {
        const missing = knownModules(s).filter(m => !registry.modules.has(m))
          .map(m => registry.incompatible.has(m) ? `${m} (needs core ${registry.incompatible.get(m)} or later)` : m);
        if (missing.length) { waitingFor = missing; held.push(...queue.slice(n), ...later); stopped = true; break; }
      }
      // Once one act waits for a key period, everything after it waits too, so
      // the record stays in time order. Only a key period can go ahead.
      if (deferring && act.kind !== 'epoch.open') { later.push(act); continue; }
      const h = actHash(act);
      const refuse = (reason) => refused.push({ act, hash: h, reason });

      const bad = shape(act);
      if (bad) { refuse(`malformed act: ${bad}`); continue; }
      // An act is identified by what was signed, not by its signature's text: a
      // signature can be re-encoded (a line break, armour) without the key, and a
      // re-encoded copy must not count as a second act.
      const id = actId(act);
      if (s.acts.has(id) || seen.has(id)) { refuse('already recorded'); continue; }
      const def = registry.get(act.kind);
      if (!def) { refuse(`unknown kind "${act.kind}"`); continue; }

      if (act.kind !== 'entity.found') {
        if (!s.entity) { refuse('this entity has not been founded'); continue; }
        if (act.entity !== s.entity.id) { refuse(`signed for entity "${act.entity}", not "${s.entity.id}"`); continue; }
        if (def.module && !enabledModules(s).includes(def.module)) { refuse(`module "${def.module}" is not enabled in this entity`); continue; }
      }
      if (s.head.at && act.at < s.head.at) {
        refuse(`dated ${act.at}, before the head of the record (${s.head.at}); re-sign it with a current time`); continue;
      }

      let keys;
      if (def.selfSigned) keys = [act.key];
      else {
        const p = s.participants[act.by];
        if (!p) { refuse(`${act.by} is not on the register`); continue; }
        if (p.status === 'left') { refuse(`${act.by} has left`); continue; }
        if (p.status === 'removed') { refuse(`${act.by} has been removed`); continue; }
        keys = p.keys;
      }
      if (typeof keys[0] !== 'string') { refuse('no key to verify against'); continue; }

      const { message, namespace } = signedMaterial(registry, act);
      const v = await verify(message, act.signature, keys, namespace);
      if (!v.ok) { refuse(`signature invalid: ${v.error}`); continue; }

      const ctx = { params: paramsOf(s), registry };
      // A check may be asynchronous (checking a signature inside an act, say).
      const reason = await def.check(s, act, ctx);
      if (reason) { refuse(reason); continue; }

      // Sealed or public, under which key period: decided before the act.
      const seal = s.entity ? shouldSeal(s, act.kind) : false;
      let epoch = 0, E = null;
      if (seal) {
        epoch = usableEpoch(s);
        if (!epoch) { deferring = true; later.push(act); continue; }
        E = sealer ? await sealer.epochKey(epoch) : null;
        if (!E) { waitingFor = [`the key of key period ${epoch}: this copy cannot seal (it is not a reader's)`]; held.push(...queue.slice(n), ...later); stopped = true; break; }
      }
      const at = recordTime(s, act);

      const derived = (await def.apply(s, act, ctx)) || [];
      const out = [{ kind: act.kind, payload: { act } },
        ...derived.map((d, i) => ({ kind: d.kind, payload: { ...d.payload, cause: h, part: i + 1 } }))];
      for (const o of out) {
        let view = makeRecord(s.head, { at, author: act.by, kind: o.kind, payload: o.payload }), stored = view;
        if (seal) { stored = await sealRecord(view, { entity: s.entity.id, epoch, E }); view = { ...view, hash: stored.hash }; }
        reduceRecord(registry, s, view);
        sealer?.learn?.(view);   // a key period opened here can seal what follows
        records.push(stored); views.push(view);
      }
      seen.add(id);
      applied.push({ act, hash: h, records: out.length });
      if (act.kind === 'epoch.open') opened = true;
    }
    if (stopped || !later.length) break;
    if (!opened) { held.push(...later); waitingFor = ['a new key period: a reader must sign epoch.open (entity records rotate)']; break; }
    queue = later;                // a key period opened: try the waiting acts again
  }
  return { applied, refused, records, views, held, waitingFor, state: dry ? state : s };
}
