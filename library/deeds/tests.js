import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';

test('deeds: granted by decision, passed on, given back, retired', async () => {
  const w = await worldWith(['deeds']);
  const r = await decide(w, { title: 'Register the rooms', rule: 'ordinary', effects: [
    { kind: 'deed.grant', deed: 'room-3', title: 'Room 3', to: 'p-0002' },
    { kind: 'deed.grant', deed: 'cargo-bike', title: 'The cargo bike', to: null }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(w.state.m.deeds['room-3'].holder, 'p-0002');
  assert.equal(w.state.m.deeds['room-3'].transferable, true, 'follows deeds.default_transferable');
  assert.equal(w.state.m.deeds['cargo-bike'].holder, null, 'held by the entity');
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  assert.match((await act('deed.transfer', 'p-0001', { deed: 'room-3', to: 'p-0003' })).refused[0].reason, /you do not hold room-3/);
  assert.equal((await act('deed.transfer', 'p-0002', { deed: 'room-3', to: 'p-0003' })).applied.length, 1);
  assert.equal((await act('deed.release', 'p-0003', { deed: 'room-3' })).applied.length, 1);
  assert.equal(w.state.m.deeds['room-3'].holder, null);
  assert.equal(w.state.m.deeds['room-3'].history.length, 3);
  assert.match(w.state.m.deeds['room-3'].history[0].how, /^granted by decision d-/);
  const dup = await decide(w, { title: 'Again', rule: 'ordinary', effects: [{ kind: 'deed.grant', deed: 'room-3', title: 'Room 3' }] });
  assert.match(dup.refused[0].reason, /already exists/);
});

test('deeds: transferability is optional per deed, always, or never; never freezes existing deeds', async () => {
  const w = await worldWith(['deeds']);
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  await decide(w, { title: 'Two things', rule: 'ordinary', effects: [
    { kind: 'deed.grant', deed: 'key', title: 'Workshop key', to: 'p-0002', transferable: false },
    { kind: 'deed.grant', deed: 'bike', title: 'Bike', to: 'p-0002' }] });
  assert.match((await act('deed.transfer', 'p-0002', { deed: 'key', to: 'p-0003' })).refused[0].reason, /passes on only by decision/);
  assert.equal((await act('deed.transfer', 'p-0002', { deed: 'bike', to: 'p-0003' })).applied.length, 1);

  // A different default for new deeds, then a reassignment that changes one deed's own setting.
  await decide(w, { title: 'Not by default', rule: 'organic', changes: { 'deeds.default_transferable': false }, effects: [
    { kind: 'deed.grant', deed: 'room', title: 'Room', to: 'p-0001' }] });
  assert.equal(w.state.m.deeds.room.transferable, false, 'the default in force when it was granted');
  await decide(w, { title: 'The key may move', rule: 'ordinary', effects: [{ kind: 'deed.assign', deed: 'key', to: 'p-0002', transferable: true }] });
  assert.equal((await act('deed.transfer', 'p-0002', { deed: 'key', to: 'p-0001' })).applied.length, 1);

  // never: nothing moves without a decision, including deeds granted as transferable.
  await decide(w, { title: 'Freeze', rule: 'organic', changes: { 'deeds.transferability': 'never' } });
  assert.match((await act('deed.transfer', 'p-0003', { deed: 'bike', to: 'p-0001' })).refused[0].reason, /only by decision here/);
  const said = await decide(w, { title: 'Contradiction', rule: 'ordinary', effects: [{ kind: 'deed.grant', deed: 'x', title: 'X', transferable: true }] });
  assert.match(said.refused[0].reason, /no deed is transferable/);

  // always: every deed moves, whatever it said.
  await decide(w, { title: 'Free', rule: 'organic', changes: { 'deeds.transferability': 'always' } });
  assert.equal((await act('deed.transfer', 'p-0001', { deed: 'room', to: 'p-0002' })).applied.length, 1);
  const no = await decide(w, { title: 'Contradiction', rule: 'ordinary', effects: [{ kind: 'deed.grant', deed: 'y', title: 'Y', transferable: false }] });
  assert.match(no.refused[0].reason, /every deed is transferable/);
});
