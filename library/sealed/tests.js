// Sealed content: members read it, non-members hold it but cannot; removal
// closes the door going forward; newcomers get what the settings allow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keys, verifyRecords } from '../../kernel/index.js';
import { worldWith, decide } from '../../test/helpers.js';
import { memberKeys, sealTo, newGroupKey, encrypt, decrypt, groupKeys, b64 } from './box.js';

async function house(set = {}) {
  const w = await worldWith(['sealed'], { people: 4 });
  if (Object.keys(set).length) assert.equal((await decide(w, { title: 'settings', rule: 'organic', changes: set })).enacted, true);
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  const ok = async (kind, by, f) => { const x = await act(kind, by, f); assert.equal(x.applied.length, 1, `${kind} by ${by}: ${x.refused[0]?.reason}`); };
  const no = async (kind, by, f, re) => { const x = await act(kind, by, f); assert.equal(x.applied.length, 0, `${kind} by ${by} should be refused`); assert.match(x.refused[0].reason, re); };
  const seed = (id) => w.keys[id].privateKey.seed;
  const publish = async (id) => ok('seal.key', id, { pub: b64((await memberKeys(seed(id))).pub) });
  // Start the next period: a fresh key, sealed to every active member with a key.
  const epoch = async (by, { except = [] } = {}) => {
    const s = w.state.m.sealed, n = (s.epochs.at(-1)?.n || 0) + 1, gk = newGroupKey(), wraps = {};
    for (const [id, pub] of Object.entries(s.pubs)) if (w.state.participants[id].status === 'active' && !except.includes(id)) wraps[id] = await sealTo(pub, gk);
    return { n, gk, wraps, send: () => act('seal.epoch', by, { epoch: n, wraps }) };
  };
  const post = async (by, id, text, gk) => ok('seal.post', by, { post: id, epoch: w.state.m.sealed.epochs.at(-1).n, title: id, ...(await encrypt(gk, text)) });
  const read = async (who, postId) => {
    const p = w.state.m.sealed.posts.find(x => x.id === postId), k = (await groupKeys(w.state, who, seed(who)))[p.epoch];
    if (!k) return null;
    return decrypt(k, p);
  };
  return { w, act, ok, no, seed, publish, epoch, post, read };
}

test('sealed: members read what is sealed; anyone may hold the record, but only members can open it', async () => {
  const { w, ok, no, publish, epoch, post, read } = await house();
  await no('seal.post', 'p-0001', { post: 'x', epoch: 1, nonce: 'AAAA', ct: 'AAAA' }, /no key period/);
  for (const id of ['p-0001', 'p-0002', 'p-0003']) await publish(id);
  const e1 = await epoch('p-0001');
  assert.equal((await e1.send()).applied.length, 1);
  await post('p-0002', 'minutes-1', 'We agreed to buy the oven.', e1.gk);
  assert.equal(await read('p-0001', 'minutes-1'), 'We agreed to buy the oven.');
  assert.equal(await read('p-0003', 'minutes-1'), 'We agreed to buy the oven.');
  assert.equal(await read('p-0004', 'minutes-1'), null, 'p-0004 never published a key, so holds none');
  const onRecord = JSON.stringify(w.records);
  assert.equal(onRecord.includes('oven'), false, 'the record holds no readable content');
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true, 'and anyone can still verify it');
  await no('seal.post', 'p-0004', { post: 'y', epoch: 1, nonce: 'AAAA', ct: 'AAAA' }, /only a holder/);
});

test('sealed: after a removal, nothing new is sealed until a new period that leaves them out', async () => {
  const { w, ok, no, publish, epoch, post, read } = await house();
  for (const id of ['p-0001', 'p-0002', 'p-0003']) await publish(id);
  const e1 = await epoch('p-0001'); await e1.send();
  await post('p-0001', 'before', 'Sealed while p-0003 was a member.', e1.gk);
  assert.equal((await decide(w, { title: 'Remove p-0003', rule: 'ordinary', effects: [{ kind: 'participant.remove', id: 'p-0003', reason: 'left the house' }] })).enacted, true);
  // The door is shut: no new sealed content, no handing out the old key.
  await no('seal.post', 'p-0001', { post: 'after', epoch: 1, nonce: 'AAAA', ct: 'AAAA' }, /p-0003 held the current key .* start a new key period/);
  // A new period must leave p-0003 out: sealing it to them is refused.
  const wrong = await epoch('p-0001'); wrong.wraps['p-0003'] = await sealTo(w.state.m.sealed.pubs['p-0003'], wrong.gk);
  assert.match((await wrong.send()).refused[0].reason, /exactly the members with keys/);
  const e2 = await epoch('p-0001'); assert.equal((await e2.send()).applied.length, 1);
  await post('p-0002', 'after', 'Sealed after p-0003 left.', e2.gk);
  assert.equal(await read('p-0002', 'after'), 'Sealed after p-0003 left.');
  assert.equal(await read('p-0003', 'after'), null, 'the removed member cannot read what came after');
  assert.equal(await read('p-0003', 'before'), 'Sealed while p-0003 was a member.', 'but can still read what they already had');
});

test('sealed: a newcomer is given the keys; sealed.history decides whether they read what came before', async () => {
  for (const [history, readsOld] of [['all', true], ['current', false]]) {
    const { w, ok, no, publish, epoch, post, read, seed } = await house({ 'sealed.history': history });
    for (const id of ['p-0001', 'p-0002']) await publish(id);
    const e1 = await epoch('p-0001'); await e1.send();
    await post('p-0001', 'old', 'Before the newcomer.', e1.gk);
    const e2 = await epoch('p-0001'); await e2.send();
    await publish('p-0004');
    await no('seal.grant', 'p-0004', { member: 'p-0004', epoch: 2, wrap: await sealTo(w.state.m.sealed.pubs['p-0004'], e2.gk) }, /only a holder/);
    await ok('seal.grant', 'p-0002', { member: 'p-0004', epoch: 2, wrap: await sealTo(w.state.m.sealed.pubs['p-0004'], e2.gk) });
    const r = await (async () => { const x = await w.settle(await w.sign('seal.grant', 'p-0001', { member: 'p-0004', epoch: 1, wrap: await sealTo(w.state.m.sealed.pubs['p-0004'], e1.gk) })); return x; })();
    assert.equal(r.applied.length === 1, readsOld, `history ${history}`);
    await post('p-0004', 'new', 'The newcomer writes.', e2.gk);
    assert.equal(await read('p-0001', 'new'), 'The newcomer writes.');
    assert.equal((await read('p-0004', 'old')) !== null, readsOld, `history ${history}: reads the old post?`);
    void seed;
  }
});

test('sealed: periods are numbered in order, started by a holder, and sealed to exactly the members with keys', async () => {
  const { w, no, publish, epoch } = await house();
  for (const id of ['p-0001', 'p-0002']) await publish(id);
  const e = await epoch('p-0001');
  await no('seal.epoch', 'p-0001', { epoch: 2, wraps: e.wraps }, /next period is 1/);
  await no('seal.epoch', 'p-0003', { epoch: 1, wraps: e.wraps }, /publish your own encryption key first/);
  const partial = { 'p-0001': e.wraps['p-0001'] };
  await no('seal.epoch', 'p-0001', { epoch: 1, wraps: partial }, /exactly the members with keys: p-0001, p-0002/);
  await e.send();
  await publish('p-0003');
  const next = await epoch('p-0003');
  await no('seal.epoch', 'p-0003', { epoch: 2, wraps: next.wraps }, /only a holder of the current key/);
  await no('seal.key', 'p-0001', { pub: 'not a key' }, /32-byte key/);
  void keys;
});
