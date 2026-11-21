// Sealed records (kernel/sealing.js, docs/SPEC-RECORD-V2.md): what members
// read, what everyone else can still check, determinism, and key periods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, verifyRecords, verifyStructure, serialise, sealing as S, attest, compare, emptyState, foldRecords } from '../kernel/index.js';
import { world, enact } from './helpers.js';

// A sealed world: the founder publishes a record key and opens key period 1.
async function sealedWorld({ people = 1 } = {}) {
  const w = await world({ set: { 'records.sealing': true }, people: 1 });
  w.rk = {}; w.rings = {};
  w.recordKey = async (id) => { w.rk[id] = await S.recordKeyFromSeed(w.keys[id].privateKey.seed); return w.rk[id]; };
  w.ring = (id) => { const r = S.keyring(id && w.rk[id] ? { id, sk: w.rk[id].sk } : null); for (const v of w.views) r.learn(v); return r; };
  w.views = [...w.records];
  const run = async (acts, by = w.ids[0]) => {
    const r = await settle(w.registry, w.state, Array.isArray(acts) ? acts : [acts], { sealer: w.ring(by) });
    w.state = r.state; w.records.push(...r.records); w.views.push(...r.views);
    return r;
  };
  w.run = run;
  w.open = async (by) => run(await w.sign('epoch.open', by, (await S.newEpoch(w.state, { ring: w.ring(by) })).fields), by);
  const f = w.ids[0];
  await w.recordKey(f);
  const k = await run(await w.sign('member.recordkey', f, { key: S.cryptoB64(w.rk[f].pk) }));
  assert.equal(k.refused.length, 0, k.refused[0]?.reason);
  const e = await w.open(f);
  assert.equal(e.refused.length, 0, e.refused[0]?.reason);
  for (let i = 2; i <= people; i++) {
    const id = `p-${String(i).padStart(4, '0')}`; await w.person(id); w.ids.push(id);
    const r = await run(await w.sign('participant.apply', id, { key: w.line(id) }));
    assert.equal(r.refused.length, 0, r.refused[0]?.reason);
  }
  return w;
}

test('sealing: records are ciphertext on disk, plaintext to a member, and verify', async () => {
  const w = await sealedWorld({ people: 2 });
  const sealed = w.records.filter(S.isSealed);
  assert.ok(sealed.length >= 1, 'the application was sealed');
  for (const r of w.records.filter(r => !S.isSealed(r))) assert.ok(S.ALWAYS_PUBLIC.includes(r.kind), `${r.kind} left public`);
  const disk = w.records.map(serialise).join('\n');
  assert.ok(!disk.includes('p-0002'), 'the applicant\'s id is not on disk in the clear');
  assert.ok(!disk.includes(w.line('p-0002').split(' ')[1]), 'nor their key');
  // A member opens and replays it all, byte for byte, ciphertext included.
  const ring = w.ring('p-0001');
  const { views, unreadable } = await S.openRecords(w.records, ring);
  assert.equal(unreadable, 0);
  assert.equal(views.find(v => v.kind === 'participant.apply').payload.act.by, 'p-0002');
  const v = await verifyRecords(w.registry, w.records, [], { views, sealer: ring });
  assert.ok(v.ok, JSON.stringify(v.problems));
  assert.equal(v.state.participants['p-0002'].status, 'active');
});

test('sealing: an outsider checks the chain, cannot read, and sees any tampering', async () => {
  const w = await sealedWorld({ people: 2 });
  const s = verifyStructure(w.records);
  assert.ok(s.ok); assert.ok(s.sealed >= 1);
  const { views, unreadable } = await S.openRecords(w.records, S.keyring(null));
  assert.ok(unreadable >= 1);
  const rep = await verifyRecords(w.registry, w.records, [], { views });
  assert.equal(rep.ok, false); assert.equal(rep.problems[0].kind, 'sealed');
  // Change one byte of ciphertext: everyone sees the chain break.
  const bent = structuredClone(w.records); const i = bent.findIndex(S.isSealed);
  bent[i].sealed.ct = (bent[i].sealed.ct[0] === 'A' ? 'B' : 'A') + bent[i].sealed.ct.slice(1);
  assert.equal(verifyStructure(bent).ok, false);
  // Rewrite it perfectly (rehash the chain): the chain holds, but an attestation made before catches it.
  const st = foldRecords(w.registry, w.views);
  const att = await attest(w.records, { entity: w.entity, by: 'p-0002', at: w.at() }, w.keys['p-0002'].privateKey);
  const { recordHash } = await import('../kernel/record.js');
  for (let k = i; k < bent.length; k++) { if (k > i) bent[k].prev = bent[k - 1].hash; bent[k].hash = recordHash(bent[k]); }
  assert.ok(verifyStructure(bent).ok, 'a perfect rewrite keeps the chain whole');
  const c = await compare(bent, st, [att]);
  assert.equal(c.diverged.length, 1, 'and an attestation over the ciphertext catches it');
});

test('sealing: two copies settling the same acts write the same bytes; a fork never reuses a key', async () => {
  const w = await sealedWorld({ people: 1 });
  const base = structuredClone(w.state);
  await w.person('p-0002'); await w.person('p-0003');
  const a2 = await w.sign('participant.apply', 'p-0002', { key: w.line('p-0002') });
  const a3 = await w.sign('participant.apply', 'p-0003', { key: w.line('p-0003') });
  const one = await settle(w.registry, base, [a2, a3], { sealer: w.ring('p-0001') });
  const two = await settle(w.registry, structuredClone(base), [a3, a2], { sealer: w.ring('p-0001') });
  assert.deepEqual(one.records.map(serialise), two.records.map(serialise), 'byte-identical, ciphertext included');
  // Two copies that fork: different acts at the same seq, same key period.
  const onlyA2 = await settle(w.registry, base, [a2], { sealer: w.ring('p-0001') });
  const onlyA3 = await settle(w.registry, base, [a3], { sealer: w.ring('p-0001') });
  const [x, y] = [onlyA2.records[0], onlyA3.records[0]];
  assert.equal(x.seq, y.seq); assert.equal(x.sealed.epoch, y.sealed.epoch);
  assert.notEqual(x.sealed.siv, y.sealed.siv, 'a different act gets a different synthetic IV, so a different key');
  assert.notEqual(x.sealed.kc, y.sealed.kc);
});

test('sealing: a departure needs a new key period; waiting acts settle with it; the leaver cannot read on', async () => {
  const w = await sealedWorld({ people: 3 });
  for (const id of ['p-0002', 'p-0003']) {
    await w.recordKey(id);
    const r = await w.run(await w.sign('member.recordkey', id, { key: S.cryptoB64(w.rk[id].pk) }));
    assert.equal(r.refused.length, 0, r.refused[0]?.reason);
  }
  // Key period 2 includes everyone.
  assert.equal((await w.open('p-0001')).refused.length, 0);
  assert.deepEqual(S.currentEpoch(w.state).members, ['p-0001', 'p-0002', 'p-0003']);
  // p-0003 leaves: nothing more may be sealed under period 2.
  assert.equal((await w.run(await w.sign('participant.leave', 'p-0003', {}))).refused.length, 0);
  assert.ok(S.rotationNeeded(w.state));
  const leftAt = w.state.head.at;
  const late = await w.sign('participant.leave', 'p-0002', {});
  const waits = await w.run(late);
  assert.equal(waits.held.length, 1, 'held until a key period opens'); assert.match(waits.waitingFor[0], /key period/);
  // A reader opens period 3 (signed later); the waiting act settles in the same batch.
  const open3 = await w.sign('epoch.open', 'p-0001', (await S.newEpoch(w.state, { ring: w.ring('p-0001') })).fields);
  const both = await w.run([late, open3]);
  assert.equal(both.refused.length, 0, both.refused[0]?.reason);
  assert.deepEqual(both.applied.map(a => a.act.kind), ['epoch.open', 'participant.leave']);
  assert.equal(both.views[0].at, leftAt, 'the new key period takes effect at the head, so the waiting act is not too old');
  assert.deepEqual(S.currentEpoch(w.state).members, ['p-0001', 'p-0002']);
  // p-0003 opens period 2 but not 3.
  const theirs = await S.openRecords(w.records, w.ring('p-0003'));
  const last = w.records.at(-1);
  assert.equal(last.sealed.epoch, 3);
  assert.equal(theirs.views.at(-1), null, 'the leaver cannot read what came after');
  assert.ok(theirs.views.some(v => v && v.kind === 'participant.leave' && v.payload.act.by === 'p-0003'), 'but keeps what came before');
  // And the whole record still replays for a reader.
  const ring = w.ring('p-0001'); const { views } = await S.openRecords(w.records, ring);
  assert.ok((await verifyRecords(w.registry, w.records, [], { views, sealer: ring })).ok);
});

test('sealing: a newcomer is granted every earlier key period, and then reads the whole record', async () => {
  const w = await sealedWorld({ people: 2 });
  await w.recordKey('p-0002');
  assert.equal((await w.run(await w.sign('member.recordkey', 'p-0002', { key: S.cryptoB64(w.rk['p-0002'].pk) }))).refused.length, 0);
  assert.deepEqual(S.grantsNeeded(w.state), ['p-0002']);
  // Without grants, refused; with them, accepted.
  const bare = (await S.newEpoch({ ...w.state, doc: w.state.doc }, { ring: w.ring('p-0001') })).fields; delete bare.grants;
  assert.match((await w.run(await w.sign('epoch.open', 'p-0001', bare))).refused[0].reason, /grants of the earlier key periods are due/);
  assert.equal((await w.open('p-0001')).refused.length, 0);
  // Before: p-0002's own application was sealed in period 1, which they were not in. Now they open it all.
  const theirs = await S.openRecords(w.records, w.ring('p-0002'));
  assert.equal(theirs.unreadable, 0);
  const ring = w.ring('p-0002');
  const { views } = await S.openRecords(w.records, ring);
  assert.ok((await verifyRecords(w.registry, w.records, [], { views, sealer: ring })).ok, 'and replay it, byte for byte');
});

test('sealing: epoch.open must wrap for exactly the readers; only readers open one', async () => {
  const w = await sealedWorld({ people: 2 });
  const { fields } = await S.newEpoch(w.state);
  const extra = { ...fields, wraps: { ...fields.wraps, 'p-0002': fields.wraps['p-0001'] } };
  assert.match((await w.run(await w.sign('epoch.open', 'p-0001', extra))).refused[0].reason, /exactly the readers/);
  assert.match((await w.run(await w.sign('epoch.open', 'p-0002', fields))).refused[0].reason, /only a reader/);
  assert.match((await w.run(await w.sign('epoch.open', 'p-0001', { ...fields, n: 7 }))).refused[0].reason, /next key period is 2/);
});

test('sealing: a copy without the key holds acts rather than settle differently', async () => {
  const w = await sealedWorld({ people: 1 });
  await w.person('p-0002');
  const a = await w.sign('participant.apply', 'p-0002', { key: w.line('p-0002') });
  const r = await settle(w.registry, w.state, [a], { sealer: S.keyring(null) });
  assert.equal(r.applied.length, 0); assert.equal(r.held.length, 1); assert.match(r.waitingFor[0], /cannot seal/);
});

test('sealing: acts sealed in transit, and one record disclosed to an outsider', async () => {
  const w = await sealedWorld({ people: 1 });
  await w.person('p-0002');
  const act = await w.sign('participant.apply', 'p-0002', { key: w.line('p-0002') });
  const box = await S.sealAct(w.state, act);
  assert.ok(!JSON.stringify(box).includes('p-0002'));
  assert.deepEqual(await S.openAct(box.sealedAct, w.ring('p-0001')), act);
  assert.equal(await S.openAct(box.sealedAct, S.keyring(null)), null, 'an outsider cannot open it');
  const r = await w.run(act); const stored = r.records[0];
  const E = await w.ring('p-0001').epochKey(stored.sealed.epoch);
  const d = await S.disclose(stored, { entity: w.entity, E });
  const body = await S.checkDisclosure(stored, d);
  assert.equal(body.payload.act.by, 'p-0002');
  const wrongKey = { ...d, encKey: S.cryptoB64(new Uint8Array(32)) };
  await assert.rejects(S.checkDisclosure(stored, wrongKey), /commitment/);
});

test('sealing: off by default; an entity founded before reads the same', async () => {
  const w = await world({ people: 2 });
  assert.equal(S.sealingOn(w.state), false);
  assert.equal(w.records.filter(S.isSealed).length, 0);
  assert.ok((await verifyRecords(w.registry, w.records)).ok);
  void emptyState;
});

test('sealing: an existing republic seals by decision; what came before stays public, all of it replays', async () => {
  const w = await world({ people: 2 });
  const before = w.records.length;
  const r = await enact(w, { title: 'Seal the record', rule: 'constitutional', changes: { 'records.sealing': true } });
  assert.ok(r.enacted, 'carried and enacted');
  assert.ok(S.sealingOn(w.state));
  assert.equal(w.records.filter(S.isSealed).length, 0, 'nothing before is sealed');
  // Readers publish keys; a key period opens; from then on, sealed.
  const rk = {}; for (const id of w.ids) rk[id] = await S.recordKeyFromSeed(w.keys[id].privateKey.seed);
  const ring = (id) => { const g = S.keyring({ id, sk: rk[id].sk }); for (const v of w.views || w.records) g.learn(v); return g; };
  w.views = [...w.records];
  const run = async (act) => { const x = await settle(w.registry, w.state, [act], { sealer: ring('p-0001') }); w.state = x.state; w.records.push(...x.records); w.views.push(...x.views); return x; };
  for (const id of w.ids) assert.equal((await run(await w.sign('member.recordkey', id, { key: S.cryptoB64(rk[id].pk) }))).refused.length, 0);
  assert.equal((await run(await w.sign('epoch.open', 'p-0001', (await S.newEpoch(w.state, { ring: ring('p-0001') })).fields))).refused.length, 0);
  assert.equal((await run(await w.sign('participant.leave', 'p-0002', {}))).refused.length, 0);
  assert.ok(S.isSealed(w.records.at(-1)));
  assert.ok(w.records.length > before);
  const g = ring('p-0001'); const { views } = await S.openRecords(w.records, g);
  assert.ok((await verifyRecords(w.registry, w.records, [], { views, sealer: g })).ok);
});

test('sealing: a member who changes their key is granted every key period again', async () => {
  const w = await sealedWorld({ people: 2 });
  await w.recordKey('p-0002');
  await w.run(await w.sign('member.recordkey', 'p-0002', { key: S.cryptoB64(w.rk['p-0002'].pk) }));
  assert.equal((await w.open('p-0001')).refused.length, 0);
  // p-0002 replaces their signing key (as after losing a device).
  const old = w.keys['p-0002'];
  const fresh = await (await import('../kernel/index.js')).keys.generate();
  const { keys } = await import('../kernel/index.js');
  assert.equal((await w.run(await w.sign('participant.key', 'p-0002', { add: keys.publicKeyLine(fresh.publicKey), revoke: keys.publicKeyLine(old.publicKey) }, old.privateKey))).refused.length, 0);
  w.keys['p-0002'] = fresh;
  await w.recordKey('p-0002');   // their new record key, from the new seed
  assert.equal((await w.run(await w.sign('member.recordkey', 'p-0002', { key: S.cryptoB64(w.rk['p-0002'].pk) }))).refused.length, 0);
  assert.ok(S.rotationNeeded(w.state), 'their old record key is no longer theirs: a new key period');
  assert.deepEqual(S.grantsNeeded(w.state), ['p-0002']);
  assert.equal((await w.open('p-0001')).refused.length, 0);
  const theirs = await S.openRecords(w.records, w.ring('p-0002'));
  assert.equal(theirs.unreadable, 0, 'with the new key they read the whole record');
});

test('sealing: a member\'s other key (their password) opens the records through a keywrap, and nobody else\'s does', async () => {
  const w = await sealedWorld({ people: 2 });
  const f = w.ids[0];
  // A second signing key of the founder's, as a password makes one.
  const { keys } = await import('../kernel/index.js');
  const other = await keys.generate();
  const otherRk = await S.recordKeyFromSeed(other.privateKey.seed);
  const ringOf = (sk, id = f) => { const r = S.keyring({ id, sk }); for (const v of w.views) r.learn(v); return r; };
  assert.ok((await S.openRecords(w.records, ringOf(otherRk.sk))).unreadable >= 1, 'before the keywrap, the other key reads nothing sealed');
  // The founder wraps their record secret to it, in public.
  const fields = await S.makeKeywrap({ entity: w.state.entity.id, member: f, recordSk: w.rk[f].sk, toPk: otherRk.pk });
  const r = await w.run(await w.sign('member.keywrap', f, fields));
  assert.equal(r.refused.length, 0, r.refused[0]?.reason);
  assert.ok(!S.isSealed(r.records[0]), 'a keywrap is public: every copy must read it to open with it');
  const opened = await S.openRecords(w.records, ringOf(otherRk.sk));
  assert.equal(opened.unreadable, 0, 'with the keywrap, the other key reads the whole record');
  assert.equal(opened.views.find(v => v?.kind === 'participant.apply').payload.act.by, 'p-0002');
  // It is the founder's alone: under another member's name the same key opens nothing.
  assert.ok((await S.openRecords(w.records, ringOf(otherRk.sk, 'p-0002'))).unreadable >= 1);
  // Checks: only an active member with a record key, never their record key itself, a 32-byte wrap.
  assert.match((await w.run(await w.sign('member.keywrap', f, { ...fields, key: S.cryptoB64(w.rk[f].pk) }))).refused[0].reason, /your record key itself/);
  assert.match((await w.run(await w.sign('member.keywrap', f, { ...fields, ct: fields.enc }))).refused[0].reason, /not a sealed 32-byte key/);
  // Later key periods open too.
  await w.recordKey('p-0002');
  await w.run(await w.sign('member.recordkey', 'p-0002', { key: S.cryptoB64(w.rk['p-0002'].pk) }));
  assert.equal((await w.open(f)).refused.length, 0);
  assert.equal((await S.openRecords(w.records, ringOf(otherRk.sk))).unreadable, 0, 'and every later key period');
});
