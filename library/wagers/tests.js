// Wagers: pools split the pot; lines refund a push; duels by concession or by
// the arbiter; markets priced by the market maker and paid per share; the
// arbiter's neutrality, the appeal window, and decisions that overrule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import wagers, { prices, tradeCost, subsidy } from './index.js';

const act = async (w, kind, by, fields = {}) => w.settle(await w.sign(kind, by, fields));
const ok = (r) => assert.equal(r.applied.length, 1, r.refused[0]?.reason);
const no = (r, re) => { assert.equal(r.applied.length, 0); assert.match(r.refused[0].reason, re); };
const bal = (w, id) => w.state.m.value?.balances?.[id] || 0;
const supply = (w) => Object.values(w.state.m.value.balances).reduce((a, b) => a + b, 0) + Object.values(w.state.m.value.held || {}).reduce((a, h) => a + h.amount, 0);

async function setup() {
  const w = await worldWith(['value', 'offices', 'wagers'], { people: 5 });
  const [a, b, c, d, arb] = w.ids;
  const r = await decide(w, { title: 'Points and an arbiter', rule: 'organic', effects: [
    ...[a, b, c, d].map(to => ({ kind: 'value.issue', to, amount: 1000 })),
    { kind: 'office.create', office: 'arbiter', title: 'Arbiter', seats: 1, term_days: 90 },
    { kind: 'office.fill', office: 'arbiter', holder: arb }] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  return { w, a, b, c, d, arb };
}
const open = async (w, by, f) => { const x = await w.sign('wager.open', by, f); ok(await w.settle(x)); return wagers.wagerId(x); };

test('wagers: a pool splits its pot among the winners, through the arbiter and the appeal window', async () => {
  const { w, a, b, c, arb } = await setup();
  no(await act(w, 'wager.open', arb, { type: 'pool', question: 'x?', outcomes: ['y', 'n'], days: 1 }), /arbiter does not bet/);
  const id = await open(w, a, { type: 'pool', question: 'Who wins the cup?', outcomes: ['Reds', 'Blues', 'Greens'], days: 2 });
  ok(await act(w, 'wager.stake', a, { wager: id, outcome: 'Reds', amount: 100 }));
  ok(await act(w, 'wager.stake', b, { wager: id, outcome: 'Reds', amount: 300 }));
  ok(await act(w, 'wager.stake', c, { wager: id, outcome: 'Blues', amount: 400 }));
  no(await act(w, 'wager.stake', c, { wager: id, outcome: 'Pinks', amount: 1 }), /one of/);
  no(await act(w, 'wager.resolve', arb, { wager: id, outcome: 'Reds' }), /resolve it after/);
  w.jump(3);
  no(await act(w, 'wager.stake', a, { wager: id, outcome: 'Reds', amount: 1 }), /closed/);
  no(await act(w, 'wager.resolve', a, { wager: id, outcome: 'Reds' }), /only the arbiter/);
  ok(await act(w, 'wager.resolve', arb, { wager: id, outcome: 'Reds', note: 'Final score 2–1' }));
  no(await act(w, 'wager.settle', c, { wager: id }), /settle it after/);
  w.jump(3);
  ok(await act(w, 'wager.settle', c, { wager: id }));
  assert.equal(bal(w, a), 900 + 200);   // 100 of 400 on Reds → a quarter of 800
  assert.equal(bal(w, b), 700 + 600);
  assert.equal(bal(w, c), 600);
  assert.equal(supply(w), 4000);
});

test('wagers: an appeal sends the result to a vote; a line refunds a push', async () => {
  const { w, a, b, arb } = await setup();
  const id = await open(w, a, { type: 'line', question: 'Rainfall in October, mm', line: 40, days: 1 });
  ok(await act(w, 'wager.stake', a, { wager: id, outcome: 'over', amount: 50 }));
  ok(await act(w, 'wager.stake', b, { wager: id, outcome: 'under', amount: 50 }));
  w.jump(2);
  no(await act(w, 'wager.resolve', arb, { wager: id, outcome: 'over' }), /value it came to/);
  ok(await act(w, 'wager.resolve', arb, { wager: id, value: 55 }));
  ok(await act(w, 'wager.appeal', b, { wager: id, reason: 'The station read 40 exactly.' }));
  w.jump(3);
  no(await act(w, 'wager.settle', a, { wager: id }), /under appeal/);
  const r = await decide(w, { title: 'It was 40', rule: 'ordinary', effects: [{ kind: 'wager.decide', wager: id, value: 40, note: 'official reading' }] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  assert.equal(w.state.m.wagers.items[id].status, 'void');
  assert.equal(bal(w, a), 1000); assert.equal(bal(w, b), 1000);
});

test('wagers: duels, by concession or the arbiter; the arbiter never judges their own stake', async () => {
  const { w, a, b, c, arb } = await setup();
  const x = await w.sign('wager.duel', a, { terms: 'I finish the marathon under four hours.', stake: 50, against: 30, to: b, days: 30 });
  ok(await w.settle(x)); const id = wagers.wagerId(x);
  no(await act(w, 'wager.accept', c, { wager: id }), /for p-0002/);
  ok(await act(w, 'wager.accept', b, { wager: id }));
  assert.equal(bal(w, a), 950); assert.equal(bal(w, b), 970);
  ok(await act(w, 'wager.concede', b, { wager: id }));
  assert.equal(bal(w, a), 1030); assert.equal(bal(w, b), 970);
  // An open challenge; resolved by the arbiter, who has no stake in it.
  const y = await w.sign('wager.duel', c, { terms: 'It snows in Berkeley this year.', stake: 10, against: 100, days: 10 });
  ok(await w.settle(y)); const id2 = wagers.wagerId(y);
  no(await act(w, 'wager.accept', arb, { wager: id2 }), /arbiter does not bet/);
  ok(await act(w, 'wager.accept', a, { wager: id2 }));
  ok(await act(w, 'wager.resolve', arb, { wager: id2, outcome: 'taker' }));
  w.jump(3);
  ok(await act(w, 'wager.settle', a, { wager: id2 }));
  assert.equal(bal(w, a), 1030 + 10); assert.equal(bal(w, c), 990);
});

test('wagers: a prediction market moves its price, pays per share, returns the rest to its backer', async () => {
  const { w, a, b, c, arb } = await setup();
  const need = subsidy(100, 2, 100);
  assert.equal(need, 6932); // 100 × ln 2 × 100, rounded up
  no(await act(w, 'wager.open', a, { type: 'market', question: 'Does the measure pass?', outcomes: ['yes', 'no'], liquidity: 100, days: 7 }), /sets aside 6932/);
  const id = await open(w, a, { type: 'market', question: 'Does the measure pass?', outcomes: ['yes', 'no'], liquidity: 10, days: 7 });
  const m = () => w.state.m.wagers.items[id];
  assert.equal(bal(w, a), 1000 - subsidy(10, 2, 100));
  assert.equal(Math.round(prices(m()).yes * 100), 50);
  const cost = tradeCost(m(), 'yes', 10, 100);
  ok(await act(w, 'wager.trade', b, { wager: id, outcome: 'yes', shares: 10 }));
  assert.equal(bal(w, b), 1000 - cost);
  assert.ok(prices(m()).yes > 0.7);
  ok(await act(w, 'wager.trade', c, { wager: id, outcome: 'no', shares: 4 }));
  no(await act(w, 'wager.trade', c, { wager: id, outcome: 'yes', shares: -1 }), /hold 0 shares/);
  ok(await act(w, 'wager.trade', b, { wager: id, outcome: 'yes', shares: -2 }));
  no(await act(w, 'wager.trade', arb, { wager: id, outcome: 'yes', shares: 1 }), /arbiter does not bet/);
  w.jump(8);
  ok(await act(w, 'wager.resolve', arb, { wager: id, outcome: 'yes' }));
  w.jump(3);
  const before = bal(w, b);
  ok(await act(w, 'wager.settle', c, { wager: id }));
  assert.equal(bal(w, b), before + 8 * 100);
  assert.equal(w.state.m.wagers.items[id].holds.length, 0);
  assert.equal(supply(w), 4000);
});
