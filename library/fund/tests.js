import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../../kernel/index.js';
import { worldWith, decide } from '../../test/helpers.js';
import fund from './index.js';

async function club() {
  const w = await worldWith(['offices', 'authority', 'fund'], { people: 3 });
  const r = await decide(w, { title: 'Treasurer', rule: 'organic', effects: [
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 1 },
    { kind: 'office.fill', office: 'treasurer', holder: 'p-0002' },
    { kind: 'authority.grant', grant: 'books', to: { office: 'treasurer' }, may: ['fund.contribute', 'fund.fill', 'fund.valuation', 'fund.income', 'fund.expense'] }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const books = async (effects, by = 'p-0002') => w.settle(await w.sign('authority.exercise', by, { grant: 'books', effects }));
  return { w, books };
}

test('fund: payments in buy units at the unit value; trades only as the members authorized', async () => {
  const { w, books } = await club();
  for (const m of ['p-0001', 'p-0002', 'p-0003']) assert.equal((await books([{ kind: 'fund.contribute', member: m, amount: 100000 }])).applied.length, 1);
  let f = w.state.m.fund;
  assert.equal(f.cash, 300000); assert.equal(f.units['p-0001'], 100 * 1e6, '$1,000 at $10.00 a unit');

  // The treasurer cannot trade without the members' decision.
  assert.match((await books([{ kind: 'fund.fill', authorization: 'vti-1', quantity: 10, price: 24000 }])).refused[0].reason, /no open authorization/);
  const auth = await decide(w, { title: 'Buy VTI', rule: 'ordinary', effects: [{ kind: 'fund.authorize', id: 'vti-1', side: 'buy', symbol: 'VTI', quantity: 10, limit: 25000, days: 5 }] });
  assert.equal(auth.enacted, true, auth.refused?.[0]?.reason || auth.notEnacted);
  assert.match((await books([{ kind: 'fund.fill', authorization: 'vti-1', quantity: 10, price: 26000 }])).refused[0].reason, /limit of \$250\.00/);
  assert.match((await books([{ kind: 'fund.fill', authorization: 'vti-1', quantity: 11, price: 24000 }])).refused[0].reason, /exceeds the 10/);
  assert.match((await books([{ kind: 'fund.fill', authorization: 'vti-1', quantity: 10, price: 24000 }], 'p-0003')).refused[0].reason, /only members of the office treasurer/);
  assert.equal((await books([{ kind: 'fund.fill', authorization: 'vti-1', quantity: 10, price: 24000, fees: 100 }])).applied.length, 1);
  f = w.state.m.fund;
  assert.equal(f.cash, 300000 - 240100); assert.equal(f.holdings.VTI.qty, 10 * 1e6);

  // The price rises: a later payment buys fewer units, and the value is shared by units.
  await books([{ kind: 'fund.valuation', prices: { VTI: 30000 }, source: 'close' }]);
  f = w.state.m.fund;
  assert.equal(Number(fund.nav(f)), 59900 + 300000);
  await books([{ kind: 'fund.contribute', member: 'p-0001', amount: 100000 }]);
  f = w.state.m.fund;
  assert.ok(f.units['p-0001'] < 200 * 1e6 && f.units['p-0001'] > 183 * 1e6, 'bought at about $11.99 a unit');
  const p3 = fund.position(f, 'p-0003');
  assert.ok(Math.abs(p3.value - 119966) <= 2, `p-0003's third is worth ${p3.value}`);

  // Selling realises the gain; a withdrawal pays out a whole stake.
  await decide(w, { title: 'Sell half', rule: 'ordinary', effects: [{ kind: 'fund.authorize', id: 'vti-2', side: 'sell', symbol: 'VTI', quantity: 5, days: 5 }] });
  await books([{ kind: 'fund.fill', authorization: 'vti-2', quantity: 5, price: 31000, fees: 100 }]);
  f = w.state.m.fund;
  assert.equal(f.realized, 155000 - 100 - 120050, 'proceeds less fees less half the cost');
  const out = await decide(w, { title: 'p-0003 leaves', rule: 'ordinary', effects: [{ kind: 'fund.withdraw', member: 'p-0003', all: true }] });
  assert.equal(out.enacted, true, out.refused?.[0]?.reason || out.notEnacted);
  assert.equal(w.state.m.fund.units['p-0003'], undefined);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('fund: investing is never delegated; stale prices stop payments; the member cap holds', async () => {
  const { w, books } = await club();
  await decide(w, { title: 'Too much power', rule: 'organic', effects: [{ kind: 'authority.grant', grant: 'invest', to: { office: 'treasurer' }, may: ['fund.authorize'] }] });
  const r = await w.settle(await w.sign('authority.exercise', 'p-0002', { grant: 'invest', effects: [{ kind: 'fund.authorize', id: 'x', side: 'buy', symbol: 'ABC', quantity: 1, days: 1 }] }));
  assert.match(r.refused[0].reason, /made by the members, never under a grant/);
  await books([{ kind: 'fund.contribute', member: 'p-0001', amount: 50000 }]);
  await decide(w, { title: 'Buy', rule: 'ordinary', effects: [{ kind: 'fund.authorize', id: 'b', side: 'buy', symbol: 'ABC', quantity: 1, days: 30 }] });
  await books([{ kind: 'fund.fill', authorization: 'b', quantity: 1, price: 10000 }]);
  w.jump(8);
  assert.match((await books([{ kind: 'fund.contribute', member: 'p-0002', amount: 1000 }])).refused[0].reason, /value the holdings first/);
  await decide(w, { title: 'One member only', rule: 'constitutional', changes: { 'fund.max_members': 1 } });
});

test('fund: an existing club brings in its opening balances once, by decision, and they must add up', async () => {
  const { w, books } = await club();
  const opening = (extra = {}) => ({ kind: 'fund.opening', as_of: '2026-02-27', cash: 123456,
    holdings: [{ symbol: 'VTI', quantity: 12.5, cost: 280000, price: 28540 }, { symbol: 'BND', quantity: 20, cost: 150000, price: 7210 }],
    capital: { 'p-0001': 400000, 'p-0002': 249706, 'p-0003': 0 }, ...extra });
  // 1234.56 + 12.5 × 285.40 + 20 × 72.10 = 1234.56 + 3567.50 + 1442.00 = 6244.06
  assert.match((await books([opening({ capital: { 'p-0001': 624406 } })])).refused[0].reason, /does not permit fund.opening/);
  let r = await decide(w, { title: 'Open', rule: 'ordinary', effects: [opening()] });
  assert.match(r.refused?.[0]?.reason || r.notEnacted, /capital of p-0003/);
  r = await decide(w, { title: 'Open', rule: 'ordinary', effects: [opening({ capital: { 'p-0001': 400000, 'p-0002': 200000 } })] });
  assert.match(r.refused?.[0]?.reason || r.notEnacted, /add up to \$6000\.00, but the club is worth \$6244\.06/);
  r = await decide(w, { title: 'Open', rule: 'ordinary', effects: [opening({ capital: { 'p-0001': 400000, 'p-0002': 224406 } })] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const f = w.state.m.fund;
  assert.equal(f.cash, 123456); assert.equal(f.holdings.VTI.qty, 12.5e6); assert.equal(f.holdings.VTI.cost, 280000);
  assert.equal(Number(fund.nav(f)), 624406);
  assert.equal(f.units['p-0001'], 400 * 1e6, '$4,000 at $10.00 a unit');
  assert.equal(fund.position(f, 'p-0002').value, 224406);
  r = await decide(w, { title: 'Again', rule: 'ordinary', effects: [opening({ capital: { 'p-0001': 624406 } })] });
  assert.match(r.refused?.[0]?.reason || r.notEnacted, /already open/);
  // After opening, payments in buy units at the unit value as usual.
  assert.equal((await books([{ kind: 'fund.contribute', member: 'p-0003', amount: 62441 }])).applied.length, 1);
  assert.ok(Math.abs(fund.position(w.state.m.fund, 'p-0003').value - 62441) <= 1);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});
