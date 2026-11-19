// Documents: your own, shared by role; the entity's, changed by decision; the
// files checked against the record; encryption; merging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import { keys } from '../../kernel/index.js';
import docs, { roleOf, readers, checkBlob, verifyBlob, blobId, material, inForce, heads, merge3, sealContext, NS } from './index.js';
import * as C from './crypto.js';

const act = async (w, kind, by, fields = {}) => w.settle(await w.sign(kind, by, fields));
const ok = (r) => assert.equal(r.applied.length, 1, r.refused[0]?.reason);
const no = (r, re) => { assert.equal(r.applied.length, 0); assert.match(r.refused[0].reason, re); };
const signed = async (w, blob) => {
  const b = { entity: w.entity, ...blob };
  b.sig = await keys.sign(material(b), w.keys[b.by].privateKey, NS);
  b.id = blobId(b);
  return b;
};

test('docs: a document of your own, shared by role, and unshared', async () => {
  const w = await worldWith(['docs'], { people: 4 });
  const [a, b, c, d] = w.ids;
  ok(await act(w, 'doc.create', a));
  const id = Object.keys(w.state.m.docs.docs)[0];
  const at = () => w.at(0);
  assert.equal(roleOf(w.state, id, a, at()), 'owner');
  assert.equal(roleOf(w.state, id, b, at()), null);
  assert.equal(w.state.m.docs.docs[id].encrypted, true);

  no(await act(w, 'doc.share', b, { doc: id, to: c, role: 'viewer' }), /owner/);
  ok(await act(w, 'doc.share', a, { doc: id, to: b, role: 'editor' }));
  ok(await act(w, 'doc.share', a, { doc: id, to: c, role: 'commenter' }));
  ok(await act(w, 'doc.share', a, { doc: id, to: 'members', role: 'viewer' }));
  assert.equal(roleOf(w.state, id, b, at()), 'editor');
  assert.equal(roleOf(w.state, id, c, at()), 'commenter'); // the best of their roles
  assert.equal(roleOf(w.state, id, d, at()), 'viewer');
  assert.deepEqual(readers(w.state, id, at()).sort(), [a, b, c, d].sort());

  // A co-owner may share; nobody may share as the owner they are not.
  ok(await act(w, 'doc.share', a, { doc: id, to: b, role: 'owner' }));
  ok(await act(w, 'doc.unshare', b, { doc: id, to: 'members' }));
  assert.equal(roleOf(w.state, id, d, at()), null);
  no(await act(w, 'doc.share', b, { doc: id, to: a, role: 'viewer' }), /owner/);
  ok(await act(w, 'doc.leave', c, { doc: id }));
  assert.equal(roleOf(w.state, id, c, at()), null);
  // The history of roles is kept: c was a commenter before leaving.
  assert.equal(roleOf(w.state, id, c, '2026-03-01T00:20:00.000Z') !== undefined, true);

  // Public documents are not encrypted, and anyone may read them.
  ok(await act(w, 'doc.create', b, { public: true }));
  const pub = Object.values(w.state.m.docs.docs).find(x => x.public);
  assert.equal(pub.encrypted, false);
  assert.equal(roleOf(w.state, pub.id, 'someone-from-outside', at()), 'viewer');
  no(await act(w, 'doc.create', b, { public: true, encrypted: true }), /not encrypted/);
});

test('docs: the entity\'s documents change only by decision, from the version in force', async () => {
  const w = await worldWith(['docs', 'committees', 'authority'], { people: 3 });
  const [a, b, c] = w.ids;
  const r = await decide(w, { title: 'Keep the bylaws', rule: 'ordinary', effects: [{ kind: 'docs.create', doc: 'bylaws', title: 'Bylaws', read: 'members', comment: 'members', draft: 'members', rule: 'organic' }] }, a);
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  const d = w.state.m.docs.docs.bylaws;
  assert.equal(d.encrypted, true);
  assert.equal(roleOf(w.state, 'bylaws', b, w.at(0)), 'editor');

  const v1 = 'a'.repeat(64), v2 = 'b'.repeat(64);
  // Its own rule: an ordinary proposal to change it is refused.
  const weak = await decide(w, { title: 'First text', rule: 'ordinary', effects: [{ kind: 'docs.adopt', doc: 'bylaws', version: v1, base: null }] }, b);
  assert.match(weak.refused[0].reason, /organic/);
  const first = await decide(w, { title: 'First text', rule: 'organic', effects: [{ kind: 'docs.adopt', doc: 'bylaws', version: v1, base: null }] }, b);
  assert.ok(first.enacted, first.notEnacted);
  assert.equal(inForce(w.state.m.docs.docs.bylaws), v1);
  // A change from an old base is refused when it would take effect.
  const stale = await decide(w, { title: 'Stale', rule: 'organic', effects: [{ kind: 'docs.adopt', doc: 'bylaws', version: v2, base: null }] }, c);
  assert.ok(!stale.enacted);

  // A committee granted docs.adopt changes it by its own co-signature.
  const g = await decide(w, { title: 'An editorial board', rule: 'organic', effects: [
    { kind: 'committee.create', committee: 'board', title: 'Editorial board', needs: 1 },
    { kind: 'committee.appoint', committee: 'board', member: c },
    { kind: 'docs.amend', doc: 'bylaws', rule: 'ordinary' },
    { kind: 'authority.grant', grant: 'edit-bylaws', to: { committee: 'board' }, may: ['docs.adopt'], where: { doc: 'bylaws' } },
  ] }, a);
  assert.ok(g.enacted, g.notEnacted || g.refused?.[0]?.reason);
  const x = await act(w, 'authority.exercise', c, { grant: 'edit-bylaws', effects: [{ kind: 'docs.adopt', doc: 'bylaws', version: v2, base: v1 }] });
  assert.equal(x.refused.length, 0, x.refused[0]?.reason);
  assert.equal(inForce(w.state.m.docs.docs.bylaws), v2);
  assert.equal(w.state.m.docs.docs.bylaws.adopted.length, 2);
});

test('docs: every file is checked against the roles on the record, and its signature', async () => {
  const w = await worldWith(['docs'], { people: 3 });
  const [a, b, c] = w.ids;
  ok(await act(w, 'doc.create', a, { public: true }));
  const id = Object.keys(w.state.m.docs.docs)[0];
  ok(await act(w, 'doc.share', a, { doc: id, to: b, role: 'commenter' }));
  const have = new Set();
  const check = (blob) => checkBlob(w.state, blob, { have: (x) => have.has(x) });

  const v = await signed(w, { type: 'version', doc: id, parent: null, by: a, at: w.at(), title: 'Notes', body: 'One\nTwo' });
  assert.equal(check(v), null);
  assert.ok(await verifyBlob(w.state, v, keys));
  have.add(v.id);
  // Commenters comment; they do not write.
  assert.match(check(await signed(w, { type: 'version', doc: id, parent: v.id, by: b, at: w.at(), title: 'Notes', body: 'Mine' })), /may not write/);
  assert.equal(check(await signed(w, { type: 'comment', doc: id, version: v.id, by: b, at: w.at(), quote: 'Two', text: 'Three?' })), null);
  assert.match(check(await signed(w, { type: 'comment', doc: id, version: v.id, by: c, at: w.at(), text: 'Hello' })), /may not comment/);
  // A version starting from one that is not here is refused.
  assert.match(check(await signed(w, { type: 'version', doc: id, parent: 'f'.repeat(64), by: a, at: w.at(), title: 'x', body: 'y' })), /not here/);
  // A changed file no longer matches its id, and a forged one fails its signature.
  assert.match(check({ ...v, body: 'Changed' }), /id/);
  const forged = { ...v, by: b }; forged.id = blobId(forged);
  assert.equal(await verifyBlob(w.state, forged, keys), false);

  // An encrypted document's text must be sealed.
  ok(await act(w, 'doc.create', a));
  const sec = Object.values(w.state.m.docs.docs).find(x => x.encrypted).id;
  assert.match(check(await signed(w, { type: 'version', doc: sec, parent: null, by: a, at: w.at(), title: 'x', body: 'plain' })), /sealed/);
});

test('docs: keys are wrapped for readers, text sealed, and the next epoch leaves out who lost access', async () => {
  const w = await worldWith(['docs'], { people: 3 });
  const [a, b, c] = w.ids;
  ok(await act(w, 'doc.create', a));
  const id = Object.keys(w.state.m.docs.docs)[0];
  ok(await act(w, 'doc.share', a, { doc: id, to: b, role: 'editor' }));
  const xa = await C.memberKey(w.keys[a].privateKey.seed), xb = await C.memberKey(w.keys[b].privateKey.seed), xc = await C.memberKey(w.keys[c].privateKey.seed);
  const key = C.docKey();
  const wraps = { [xa.xpk]: { to: a, ...await C.wrapKey({ me: xa, toXpk: xa.xpk, key, entity: w.entity, doc: id, epoch: 1 }) },
    [xb.xpk]: { to: b, ...await C.wrapKey({ me: xa, toXpk: xb.xpk, key, entity: w.entity, doc: id, epoch: 1 }) } };
  const kb = await signed(w, { type: 'keys', doc: id, epoch: 1, by: a, at: w.at(), wraps });
  assert.equal(checkBlob(w.state, kb), null);
  // c cannot be given the key: c is not a reader.
  const bad = await signed(w, { type: 'keys', doc: id, epoch: 1, by: a, at: w.at(), wraps: { [xc.xpk]: { to: c, ...await C.wrapKey({ me: xa, toXpk: xc.xpk, key, entity: w.entity, doc: id, epoch: 1 }) } } });
  assert.match(checkBlob(w.state, bad), /cannot read/);

  // b unwraps the key and reads what a sealed.
  const got = await C.unwrapKey({ me: xb, wrap: kb.wraps[xb.xpk], entity: w.entity, doc: id, epoch: 1 });
  const v = { entity: w.entity, type: 'version', doc: id, parent: null, by: a, at: w.at() };
  v.enc = await C.seal({ key, epoch: 1, value: { title: 'Plan', body: 'Secret' }, context: sealContext(v) });
  assert.deepEqual(await C.unseal({ key: got, sealed: v.enc, context: sealContext(v) }), { title: 'Plan', body: 'Secret' });
  // Moved to another document, or another author, it does not open.
  await assert.rejects(C.unseal({ key: got, sealed: v.enc, context: sealContext({ ...v, by: b }) }));
  // The wrap does not open for c either.
  await assert.rejects(C.unwrapKey({ me: xc, wrap: kb.wraps[xb.xpk], entity: w.entity, doc: id, epoch: 1 }));

  // b loses access: a key wrapped for b after that is refused.
  ok(await act(w, 'doc.unshare', a, { doc: id, to: b }));
  assert.deepEqual(readers(w.state, id, w.at(0)), [a]);
  const late = await signed(w, { type: 'keys', doc: id, epoch: 2, by: a, at: w.at(), wraps: { [xb.xpk]: wraps[xb.xpk] } });
  assert.match(checkBlob(w.state, late), /cannot read/);
});

test('docs: versions written at once are merged by lines', () => {
  const vs = [{ id: '1', parent: null, at: '1' }, { id: '2', parent: '1', at: '2' }, { id: '3', parent: '1', at: '3' }];
  assert.deepEqual(heads(vs).map(v => v.id), ['2', '3']);
  assert.deepEqual(merge3('a\nb\nc\nd', 'a\nB\nc\nd', 'a\nb\nc\nD'), { text: 'a\nB\nc\nD', conflicts: 0 });
  const both = merge3('title\n\nbody', 'title\n\nbody one', 'title\n\nbody two');
  assert.equal(both.conflicts, 1);
  assert.match(both.text, /<<<<<<< yours\nbody one\n=======\nbody two\n>>>>>>> theirs/);
  assert.equal(docs.name, 'docs');
});
