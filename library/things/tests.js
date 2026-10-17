// A library of things with cash deposits, and a solidarity fund that stands
// behind the deposits of members who ask it to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import things from './index.js';

test('things: list, request, lend against a deposit, return with part kept, dispute, settle', async () => {
  const w = await worldWith(['things'], { people: 4 });
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  const ok = (r) => { assert.equal(r.applied.length, 1, r.refused?.[0]?.reason); return r; };
  const no = (r, re) => assert.match(r.refused?.[0]?.reason || '', re);
  const [a, b, c] = ['p-0001', 'p-0002', 'p-0003'];

  ok(await act('thing.list', a, { thing: 'drill', title: 'Cordless drill', deposit: 4000, category: 'tools', days: 10 }));
  no(await act('thing.list', b, { thing: 'drill', title: 'Another', deposit: 0 }), /already a thing drill/);
  no(await act('thing.list', b, { thing: 'piano', title: 'Piano', deposit: 999999 }), /at most 20000/);
  no(await act('thing.request', a, { thing: 'drill' }), /your own thing/);
  no(await act('thing.request', b, { thing: 'drill', days: 20 }), /from 1 to 10/);
  ok(await act('thing.request', b, { thing: 'drill', days: 5 }));
  ok(await act('thing.request', c, { thing: 'drill' }));
  no(await act('thing.lend', a, { thing: 'drill', to: 'p-0004', deposit: 4000 }), /has not asked/);
  no(await act('thing.lend', a, { thing: 'drill', to: b, deposit: 1000 }), /deposit of 4000/);
  no(await act('thing.lend', c, { thing: 'drill', to: b, deposit: 4000 }), /lent by p-0001/);
  ok(await act('thing.lend', a, { thing: 'drill', to: b, deposit: 4000 }));
  assert.deepEqual(things.deposits(w.state, a), { holding: 4000, left: 0 });
  assert.deepEqual(things.deposits(w.state, b), { holding: 0, left: 4000 });
  assert.equal(things.requestsFor(w.state, 'drill').length, 1, 'the other request waits its turn');
  no(await act('thing.withdraw', a, { thing: 'drill' }), /out on loan/);
  ok(await act('thing.renew', a, { thing: 'drill', days: 3 }));
  ok(await act('thing.returned', b, { thing: 'drill' }));
  no(await act('thing.return', a, { thing: 'drill', kept: 1500 }), /say why/);
  ok(await act('thing.return', a, { thing: 'drill', kept: 1500, note: 'chuck broken' }));
  assert.deepEqual(things.deposits(w.state, a), { holding: 0, left: 0 });
  const loan = w.state.m.things.loans[0];
  assert.equal(loan.kept, 1500);
  ok(await act('thing.dispute', b, { loan: 0, reason: 'It was broken when I got it' }));
  const r = await decide(w, { title: 'Settle the drill', rule: 'ordinary', effects: [{ kind: 'thing.settle', loan: 0, refund: 1500, note: 'the chuck was loose before' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(w.state.m.things.loans[0].settled.refund, 1500);
  // The next in line borrows it now.
  ok(await act('thing.lend', a, { thing: 'drill', to: c, deposit: 4000 }));
  w.jump(30);
  assert.equal(things.overdue(things.current(w.state, 'drill'), w.at()), true);
});

test('things: the solidarity fund covers deposits; losses become claims the fund pays; network things', async () => {
  const w = await worldWith(['things'], { people: 4 });
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  const ok = (r) => { assert.equal(r.applied.length, 1, r.refused?.[0]?.reason); return r; };
  const no = (r, re) => assert.match(r.refused?.[0]?.reason || '', re);
  const [a, b, c] = ['p-0001', 'p-0002', 'p-0003'];
  const r = await decide(w, { title: 'The library', rule: 'ordinary', changes: { 'things.cover_max_open': 1 }, effects: [
    { kind: 'thing.add', thing: 'tent', title: 'Four-person tent', keeper: c, deposit: 6000, where: 'the shed at 12 Elm St' },
    { kind: 'thing.add', thing: 'bike', title: 'Cargo bike', keeper: c, deposit: 15000 }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  no(await act('thing.request', b, { thing: 'bike', cover: true }), /up to 10000/);
  ok(await act('thing.request', b, { thing: 'tent', cover: true }));
  no(await act('thing.lend', c, { thing: 'tent', to: b, deposit: 6000 }), /covered by the solidarity fund/);
  ok(await act('thing.lend', c, { thing: 'tent', to: b, deposit: 0 }));
  assert.equal(things.coverOpen(w.state, b), 1);
  ok(await act('thing.list', a, { thing: 'sewing', title: 'Sewing machine', deposit: 3000 }));
  no(await act('thing.request', b, { thing: 'sewing', cover: true }), /the limit is 1/);
  ok(await act('thing.return', c, { thing: 'tent', kept: 2000, note: 'torn fly sheet' }));
  assert.equal(things.claimsOwed(w.state), 2000, 'the fund owes the keeper what a covered loan kept');
  // A cash loan that never comes back: the lender keeps the whole deposit.
  ok(await act('thing.request', b, { thing: 'sewing' }));
  ok(await act('thing.lend', a, { thing: 'sewing', to: b, deposit: 3000 }));
  const lost = await decide(w, { title: 'The sewing machine is gone', rule: 'ordinary', effects: [{ kind: 'thing.lost', loan: 1, note: 'not returned after 60 days' }, { kind: 'thing.pay', claim: 0, note: 'cash from the solidarity fund' }] });
  assert.equal(lost.enacted, true, lost.refused?.[0]?.reason || lost.notEnacted);
  assert.equal(w.state.m.things.loans[1].kept, 3000);
  assert.equal(w.state.m.things.items.sewing.withdrawn !== null, true);
  assert.equal(things.claimsOwed(w.state), 0);
  const keep = await decide(w, { title: 'New keeper', rule: 'ordinary', effects: [{ kind: 'thing.keeper', thing: 'bike', keeper: a }] });
  assert.equal(keep.enacted, true, keep.refused?.[0]?.reason || keep.notEnacted);
  assert.equal(things.lender(w.state.m.things.items.bike), a);
});
