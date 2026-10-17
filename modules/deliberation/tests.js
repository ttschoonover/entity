// The deliberation module's own tests: counting, in isolation from everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyOf } from './count.js';

const P = (roll, ballots, terms = { quorum: 0.5, threshold: 0.5 }, deadline = '2026-02-01T00:00:00.000Z') =>
  ({ roll, deadline, terms, ballots: ballots.map(([by, choice, at = '2026-01-10T00:00:00.000Z', afterClose = false], i) => ({ by, choice, at, afterClose, hash: `h${i}` })) });
const roll = ['a', 'b', 'c', 'd', 'e'];

test('abstentions count toward quorum and not toward the share', () => {
  const t = tallyOf(P(roll, [['a', 'for'], ['b', 'abstain'], ['c', 'abstain']]));
  assert.equal(t.quorumMet, true); assert.equal(t.share, 1); assert.equal(t.thresholdMet, true);
});

test('a tie does not carry, whatever the threshold', () => {
  const t = tallyOf(P(roll, [['a', 'for'], ['b', 'against'], ['c', 'abstain']]));
  assert.equal(t.share, 0.5); assert.equal(t.thresholdMet, false);
});

test('a later ballot replaces an earlier one and the replacement is reported', () => {
  const t = tallyOf(P(roll, [['a', 'against'], ['a', 'for']]));
  assert.equal(t.for, 1); assert.equal(t.against, 0);
  assert.deepEqual(t.replaced.map(r => r.by), ['a']);
});

test('rejections are published with their reasons', () => {
  const t = tallyOf(P(roll, [['z', 'for'], ['a', 'for', '2026-03-01T00:00:00.000Z'], ['b', 'for', '2026-01-10T00:00:00.000Z', true]]));
  assert.deepEqual(t.rejected.map(r => [r.by, r.why]), [
    ['z', 'not on the roll when the proposal was laid'], ['a', 'cast after close'], ['b', 'cast after close']]);
});

test('certainty: closes as soon as the outcome cannot change, and not before', () => {
  assert.equal(tallyOf(P(roll, [['a', 'for'], ['b', 'for']])).certain, null);
  assert.equal(tallyOf(P(roll, [['a', 'for'], ['b', 'for'], ['c', 'for']])).certain, 'carried');
  assert.equal(tallyOf(P(roll, [['a', 'against'], ['b', 'against'], ['c', 'against']])).certain, 'failed');
});

test('0.67 is not two thirds: 2 of 3 does not meet a 0.67 threshold', () => {
  const t = tallyOf(P(['a', 'b', 'c'], [['a', 'for'], ['b', 'for'], ['c', 'against']], { quorum: 0.5, threshold: 0.67 }));
  assert.equal(t.thresholdMet, false);
});

test('weights: every figure is a sum of weights, and certainty follows them', () => {
  const p = P(['a', 'b', 'c'], [['a', 'for'], ['b', 'against']], { quorum: 0.5, threshold: 0.5 });
  p.weights = { a: 70, b: 20, c: 10 };
  const t = tallyOf(p);
  assert.equal(t.electorate, 100); assert.equal(t.cast, 90); assert.equal(t.for, 70); assert.equal(t.against, 20);
  assert.equal(t.voters, 3);
  assert.equal(t.certain, 'carried', '70 for cannot be overturned by the 10 outstanding');
  assert.equal(t.counted.find(b => b.by === 'a').weight, 70);
});
