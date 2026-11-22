// Sealed records (docs/SPEC-RECORD-V2.md). With records.sealing on, the
// record on disk holds ciphertext that only members can open; anyone can
// still check the chain, so tampering shows to everyone.
//
// Everything else in the kernel works on plaintext *views*: a view is the
// record as it would be in the clear ({ seq, at, author, kind, payload, prev })
// carrying the *stored* record's hash. So the head, the chain, checkpoints and
// attestations are unchanged; only the stored form differs.
//
//   stored (sealed) := { seq, prev, sealed: { v: 2, epoch, siv, kc, ct }, hash }
//   hash            := H(prev ‖ canonical(stored minus hash))      as for every record
//
// A key period (epoch) has a random 32-byte key E, opened by a public
// epoch.open act carrying E wrapped (HPKE) for every reader. A reader is an
// active member who has published a record key (member.recordkey), derived
// from the seed of their signing key, so it is the same on every device.
//
// A member who signs in more than one way (a key file and a password, say)
// still has one record key. Their other keys open it through a public
// member.keywrap act: the record secret key, sealed (HPKE) to the record key
// the other signing key derives. Whoever holds that key opens the wrap, then
// every key period the member can read. Nothing else about key periods changes.

import { canonical } from './canonical.js';
import { recordHash } from './record.js';
import * as C from './crypto.js';
import { Parameters } from './parameters.js';

export const SEALED_VERSION = 2;
// Kinds that are never sealed: everyone must read them to verify and to join.
export const ALWAYS_PUBLIC = Object.freeze(['entity.found', 'member.recordkey', 'epoch.open', 'member.keywrap']);
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ZERO32 = new Uint8Array(32);

// ── state ─────────────────────────────────────────────────────────────────
const sv = (state) => (state.sealing ||= { keys: {}, epochs: [], current: 0, keywraps: {} });
export const sealingState = (state) => sv(state);

export const sealingOn = (state) => !!paramValue(state, 'records.sealing');
function paramValue(state, key) {
  if (!state.doc) return undefined;
  const p = new Parameters(state.doc, state.catalog || null);
  return p.has(key) ? p.value(key) : undefined;
}
export function isPublicKind(state, kind) {
  if (ALWAYS_PUBLIC.includes(kind)) return true;
  const list = paramValue(state, 'records.public');
  return Array.isArray(list) && list.includes(kind);
}
export const shouldSeal = (state, kind) => sealingOn(state) && !isPublicKind(state, kind);

// Who can read: active members with a record key, sorted.
export function readers(state) {
  const k = sv(state).keys;
  return Object.keys(state.participants || {}).filter(id => state.participants[id].status === 'active' && k[id]).sort();
}
export const currentEpoch = (state) => { const s = sv(state); return s.epochs.find(e => e.n === s.current) || null; };

// A new key period is needed before anything more is sealed: someone in the
// current one is no longer a reader, or their record key changed. (A newcomer
// does not force one; they read from the next.)
export function rotationNeeded(state) {
  if (!sealingOn(state)) return false;
  const e = currentEpoch(state);
  if (!e) return true;
  const now = new Set(readers(state)), k = sv(state).keys;
  return e.members.some(id => !now.has(id) || k[id] !== e.keyOf[id]);
}
// The key period records are sealed under now, or 0 if none may be used.
export const usableEpoch = (state) => (sealingOn(state) && !rotationNeeded(state) ? sv(state).current : 0);
// Readers who would get a wrap in a new key period but are not in the current one.
export const waitingReaders = (state) => { const e = currentEpoch(state); return readers(state).filter(id => !e || !e.members.includes(id)); };

// ── keys ──────────────────────────────────────────────────────────────────
// A member's record key, from the seed of their signing key.
export async function recordKeyFromSeed(seed) {
  const sk = C.clamp(await C.hkdf(seed, { salt: ZERO32, info: C.utf8('entity/record/member-key/v1'), length: 32 }));
  return { sk, pk: await C.x25519Public(sk) };
}
const wrapInfo = (entity, n) => C.utf8(`entity/epoch/v1\n${entity}\n${n}`);
const actInfo = (entity, n) => C.utf8(`entity/act/v1\n${entity}\n${n}`);
export async function applicantKeyOf(E, entity) {
  const sk = C.clamp(await C.hkdf(E, { salt: C.utf8(entity), info: C.utf8('entity/record/v2/applicant'), length: 32 }));
  return { sk, pk: await C.x25519Public(sk) };
}
const macKeyOf = (E, entity) => C.hkdf(E, { salt: C.utf8(entity), info: C.utf8('entity/record/v2/mac'), length: 32 });

// The fields of an epoch.open act: a fresh key E wrapped for every reader,
// and, with records.history "full", every earlier key period's key wrapped for
// each reader new to this one (grants), so their copy can read, and so replay,
// the whole record. Signed by a reader; settlement checks only its shape.
// ring: the signer's keyring, which holds the earlier keys.
export async function newEpoch(state, { E = C.random(32), ring = null } = {}) {
  const entity = state.entity.id, s = sv(state), n = s.current + 1, k = s.keys;
  const wrap = async (id, key, m) => { const w = await C.hpkeSeal(C.unb64(k[id]), key, { info: wrapInfo(entity, m) }); return { enc: C.b64(w.enc), ct: C.b64(w.ct) }; };
  const wraps = {};
  for (const id of readers(state)) wraps[id] = await wrap(id, E, n);
  const fields = { n, applicantPk: C.b64((await applicantKeyOf(E, entity)).pk), wraps };
  const fresh = grantsNeeded(state);
  if (fresh.length) {
    if (!ring) throw new Error('earlier key periods must be granted to new readers: pass the signer\'s keyring');
    fields.grants = {};
    for (const id of fresh) {
      fields.grants[id] = {};
      for (let m = 1; m <= s.current; m++) {
        const Em = await ring.epochKey(m);
        if (!Em) throw new Error(`this copy holds no key for key period ${m}, so it cannot grant it`);
        fields.grants[id][m] = await wrap(id, Em, m);
      }
    }
  }
  return { E, fields };
}
// Readers who must be granted the earlier key periods in the next epoch.open:
// those new to the current one, and those whose record key changed since (a
// member who rotated or recovered their key opens nothing old with the new one).
export function grantsNeeded(state) {
  const s = sv(state);
  if (!s.current || historyOf(state) !== 'full') return [];
  const e = currentEpoch(state);
  return readers(state).filter(id => !e.members.includes(id) || e.keyOf[id] !== s.keys[id]);
}
const historyOf = (state) => paramValue(state, 'records.history') || 'full';
// member.keywrap: a member's record secret key, sealed to the record key of
// another of their signing keys (their password key, say).
const keywrapInfo = (entity, member) => C.utf8(`entity/keywrap/v1\n${entity}\n${member}`);
export async function makeKeywrap({ entity, member, recordSk, toPk }) {
  const w = await C.hpkeSeal(toPk, recordSk, { info: keywrapInfo(entity, member) });
  return { key: C.b64(toPk), enc: C.b64(w.enc), ct: C.b64(w.ct) };
}
export async function openKeywrap({ entity, member, wrap, sk }) {
  return C.hpkeOpen(sk, C.unb64(wrap.enc), C.unb64(wrap.ct), { info: keywrapInfo(entity, member) });
}
// A member's record secret key from any of their signing keys' seeds: the key
// it derives if that is their record key, else through their keywrap to it.
export async function memberSecret(state, id, seed) {
  const own = await recordKeyFromSeed(seed), s = state.sealing || {};
  if (s.keys?.[id] === C.b64(own.pk)) return own.sk;
  const w = (s.keywraps?.[id] || []).find(x => x.key === C.b64(own.pk) && x.enc);
  if (w) { try { return await openKeywrap({ entity: state.entity.id, member: id, wrap: w, sk: own.sk }); } catch { /* fall through */ } }
  return own.sk;
}
export async function openWrap(entity, n, wrap, sk) {
  return C.hpkeOpen(sk, C.unb64(wrap.enc), C.unb64(wrap.ct), { info: wrapInfo(entity, n) });
}

// ── sealing and opening one record ───────────────────────────────────────
const header = (entity, seq, prev, epoch) => C.utf8(canonical({ entity, seq, prev, epoch }));
export function pad(text) {
  const n = C.utf8(text).length, step = n > 16384 ? 4096 : 256;
  return text + ' '.repeat((Math.ceil((n + 1) / step) * step) - n);
}
// view → stored. Deterministic: the same view, epoch and key give the same bytes.
export async function sealRecord(view, { entity, epoch, E }) {
  const h = header(entity, view.seq, view.prev, epoch);
  const body = C.utf8(pad(canonical({ at: view.at, author: view.author, kind: view.kind, payload: view.payload })));
  const siv = await C.hmacSha256(await macKeyOf(E, entity), C.concat(h, Uint8Array.of(0), body));
  const encKey = await C.hkdf(E, { salt: siv, info: C.utf8('entity/record/v2/enc'), length: 32 });
  const ct = await C.aeadSeal(encKey, new Uint8Array(12), body, h);
  const kc = await C.hmacSha256(encKey, C.utf8('entity/record/v2/commit'));
  const stored = { seq: view.seq, prev: view.prev, sealed: { v: SEALED_VERSION, epoch, siv: C.b64(siv), kc: C.b64(kc), ct: C.b64(ct) } };
  stored.hash = recordHash(stored);
  return stored;
}
// stored → view, or throws. Checks the key commitment and the synthetic IV.
export async function openRecord(stored, { entity, E }) {
  const s = stored.sealed;
  if (!s || s.v !== SEALED_VERSION) throw new Error(`record ${stored.seq}: not a sealed record this code knows`);
  const h = header(entity, stored.seq, stored.prev, s.epoch), siv = C.unb64(s.siv);
  const encKey = await C.hkdf(E, { salt: siv, info: C.utf8('entity/record/v2/enc'), length: 32 });
  if (C.b64(await C.hmacSha256(encKey, C.utf8('entity/record/v2/commit'))) !== s.kc) throw new Error(`record ${stored.seq}: the key commitment does not match`);
  let body;
  try { body = await C.aeadOpen(encKey, new Uint8Array(12), C.unb64(s.ct), h); }
  catch { throw new Error(`record ${stored.seq}: does not open with key period ${s.epoch}'s key`); }
  if (C.b64(await C.hmacSha256(await macKeyOf(E, entity), C.concat(h, Uint8Array.of(0), body))) !== s.siv) throw new Error(`record ${stored.seq}: its synthetic IV does not match its contents`);
  const o = JSON.parse(new TextDecoder().decode(body));
  return { seq: stored.seq, at: o.at, author: o.author, kind: o.kind, payload: o.payload, prev: stored.prev, hash: stored.hash };
}
// Disclosure (spec §6): what to hand an outsider so they can check one record.
export async function disclose(stored, { entity, E }) {
  const encKey = await C.hkdf(E, { salt: C.unb64(stored.sealed.siv), info: C.utf8('entity/record/v2/enc'), length: 32 });
  return { seq: stored.seq, entity, encKey: C.b64(encKey) };
}
export async function checkDisclosure(stored, { entity, encKey }) {
  const k = C.unb64(encKey), s = stored.sealed;
  if (C.b64(await C.hmacSha256(k, C.utf8('entity/record/v2/commit'))) !== s.kc) throw new Error('the key does not match the record\'s commitment');
  const body = await C.aeadOpen(k, new Uint8Array(12), C.unb64(s.ct), header(entity, stored.seq, stored.prev, s.epoch));
  return JSON.parse(new TextDecoder().decode(body));
}
export const isSealed = (r) => !!(r && r.sealed);

// ── a keyring: the epoch keys one reader holds ────────────────────────────
// opener: { id, sk } — a member's id and record secret key. Epoch keys are
// found in the public epoch.open records' wraps, opened on demand.
export function keyring(opener) {
  const wraps = new Map(), cache = new Map(), keywraps = [];
  let entity = null, mine = null, myPk = null;
  // The secret keys this reader may try: their own record key, then any it
  // opens through a member.keywrap addressed to it.
  async function secrets() {
    if (!opener) return [];
    if (!myPk) myPk = C.b64(await C.x25519Public(opener.sk));
    if (mine === null) {
      mine = [];
      for (const w of keywraps) if (w.member === opener.id && w.key === myPk) {
        try { mine.push(await openKeywrap({ entity, member: w.member, wrap: w, sk: opener.sk })); } catch { /* not ours after all */ }
      }
    }
    return [opener.sk, ...mine];
  }
  return {
    get entity() { return entity; },
    learn(view) {                    // feed every public view, in order
      if (!view) return;
      if (view.kind === 'entity.found') entity = view.payload.act.entity;
      if (view.kind === 'epoch.open') {
        const a = view.payload.act;
        wraps.set(a.n, { ...(wraps.get(a.n) || {}), ...a.wraps });
        for (const [id, byPeriod] of Object.entries(a.grants || {})) for (const [m, g] of Object.entries(byPeriod)) {
          const n = Number(m); wraps.set(n, { ...(wraps.get(n) || {}), [id]: g });
        }
      }
      if (view.kind === 'member.keywrap') { const a = view.payload.act; keywraps.push({ member: a.by, key: a.key, enc: a.enc, ct: a.ct }); mine = null; }
    },
    remember(n, E) { cache.set(n, E); },
    async epochKey(n) {
      if (cache.has(n)) return cache.get(n);
      const w = opener && wraps.get(n)?.[opener.id];
      if (!w || !entity) return null;
      for (const sk of await secrets()) {
        try { const E = await openWrap(entity, n, w, sk); cache.set(n, E); return E; } catch { /* the next */ }
      }
      return null;
    },
    async applicantKey(n) { const E = await this.epochKey(n); return E && entity ? applicantKeyOf(E, entity) : null; },
  };
}

// Stored records → views, opening what this keyring can. A record it cannot
// open becomes null; the views stop being foldable there.
export async function openRecords(records, ring) {
  const views = [];
  let unreadable = 0;
  // Key periods are public: learn them all first, since a later one may grant
  // the key to an earlier one.
  for (const r of records) if (!isSealed(r)) ring.learn(r);
  for (const r of records) {
    if (!isSealed(r)) { views.push(r); continue; }
    const E = await ring.epochKey(r.sealed.epoch);
    if (!E) { views.push(null); unreadable++; continue; }
    const v = await openRecord(r, { entity: ring.entity, E });
    views.push(v); ring.learn(v);
  }
  return { views, unreadable };
}

// ── acts in transit (spec §4) ─────────────────────────────────────────────
export async function sealAct(state, act) {
  const e = currentEpoch(state);
  if (!e) throw new Error('no key period yet: nothing can be sealed');
  return sealActTo({ entity: state.entity.id, n: e.n, applicantPk: e.applicantPk }, act);
}
// To a key period's public key: anyone can, member or not.
export async function sealActTo({ entity, n, applicantPk }, act) {
  const s = await C.hpkeSeal(C.unb64(applicantPk), C.utf8(canonical(act)), { info: actInfo(entity, n) });
  return { sealedAct: { entity, epoch: n, enc: C.b64(s.enc), ct: C.b64(s.ct) } };
}
// The latest key period, read from the public records alone (no keys needed).
export function latestPeriod(records) {
  let entity = null, last = null;
  for (const r of records) {
    if (r.sealed) continue;
    if (r.kind === 'entity.found') entity = r.payload.act.entity;
    if (r.kind === 'epoch.open') last = r.payload.act;
  }
  return entity && last ? { entity, n: last.n, applicantPk: last.applicantPk } : null;
}
export async function openAct(sealedAct, ring) {
  const k = await ring.applicantKey(sealedAct.epoch);
  if (!k) return null;
  const pt = await C.hpkeOpen(k.sk, C.unb64(sealedAct.enc), C.unb64(sealedAct.ct), { info: actInfo(sealedAct.entity, sealedAct.epoch) });
  return JSON.parse(new TextDecoder().decode(pt));
}

// ── the kinds ─────────────────────────────────────────────────────────────
export function installSealing(registry) {
  registry.registerKind({
    name: 'member.recordkey',
    check(state, act) {
      const p = state.participants[act.by];
      if (!p || p.status !== 'active') return 'only an active member publishes a record key';
      if (!B64_32.test(act.key || '')) return 'key must be 32 bytes, base64 (an X25519 public key)';
      if (Object.entries(sv(state).keys).some(([id, k]) => k === act.key && id !== act.by)) return 'that record key belongs to another member';
      if (sv(state).keys[act.by] === act.key) return 'that is already your record key';
      return null;
    },
    reduce(state, rec) { sv(state).keys[rec.payload.act.by] = rec.payload.act.key; },
  });

  registry.registerKind({
    name: 'member.keywrap',
    check(state, act) {
      const p = state.participants[act.by];
      if (!p || p.status !== 'active') return 'only an active member wraps their record key';
      if (!sv(state).keys[act.by]) return 'publish your record key first (member.recordkey)';
      if (!B64_32.test(act.key || '')) return 'key must be 32 bytes, base64 (the X25519 record key of your other signing key)';
      if (act.key === sv(state).keys[act.by]) return 'that is your record key itself';
      if (!B64_32.test(act.enc || '') || !B64.test(act.ct || '') || C.unb64(act.ct).length !== 48) return 'the wrap is not a sealed 32-byte key';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, s = sv(state); s.keywraps ||= {};
      s.keywraps[a.by] = [...(s.keywraps[a.by] || []).filter(w => w.key !== a.key), { key: a.key, enc: a.enc, ct: a.ct, at: rec.at }];
    },
  });

  registry.registerKind({
    name: 'epoch.open',
    check(state, act) {
      if (!sealingOn(state)) return 'records are not sealed here (records.sealing is off)';
      const who = readers(state);
      if (!who.includes(act.by)) return 'only a reader (an active member with a record key) opens a key period';
      if (act.n !== sv(state).current + 1) return `the next key period is ${sv(state).current + 1}`;
      if (!B64_32.test(act.applicantPk || '')) return 'applicantPk must be 32 bytes, base64';
      const w = act.wraps;
      if (!w || typeof w !== 'object' || Array.isArray(w)) return 'wraps: one per reader';
      const ids = Object.keys(w).sort();
      if (ids.join() !== who.join()) return `wraps must be for exactly the readers: ${who.join(', ')}`;
      const bad = (x) => !B64_32.test(x?.enc || '') || !B64.test(x?.ct || '') || C.unb64(x.ct).length !== 48;
      for (const id of ids) if (bad(w[id])) return `the wrap for ${id} is not a sealed 32-byte key`;
      // Grants: every earlier key period, for exactly the readers new to this one.
      const need = grantsNeeded(state), g = act.grants;
      if (!need.length) { if (g !== undefined) return 'no grants are due in this key period'; return null; }
      if (!g || typeof g !== 'object' || Object.keys(g).sort().join() !== need.join()) return `grants of the earlier key periods are due for exactly: ${need.join(', ')}`;
      const periods = Array.from({ length: sv(state).current }, (_, i) => String(i + 1));
      for (const id of need) {
        if (!g[id] || Object.keys(g[id]).sort((a, b) => a - b).join() !== periods.join()) return `${id} must be granted key periods ${periods.join(', ')}`;
        for (const m of periods) if (bad(g[id][m])) return `the grant of key period ${m} for ${id} is not a sealed 32-byte key`;
      }
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, s = sv(state);
      const members = Object.keys(a.wraps).sort();
      s.epochs.push({ n: a.n, members, keyOf: Object.fromEntries(members.map(id => [id, s.keys[id]])), applicantPk: a.applicantPk, at: rec.at, by: a.by });
      s.current = a.n;
    },
  });
}

// For settlement: the time an act's records bear. A key period opened because
// one was needed takes effect at the head, so acts waiting on it (dated
// between the change and the new period) are not too old to settle.
export const recordTime = (state, act) => (act.kind === 'epoch.open' && rotationNeeded(state) && state.head.at ? state.head.at : act.at);
export const cryptoB64 = C.b64;
