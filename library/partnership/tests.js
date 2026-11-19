// The partnership: associations joined and claims granted by concurrent
// majorities of partners and units; certificates read from the record;
// offices one person may not hold together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide, enact, propose, vote } from '../../test/helpers.js';
import partnership, { certificates, profitShare } from './index.js';

const extra = {
  rules: {
    joint: { quorum: 0.5, threshold: 0.5, readings: 1, concurrent: 'shares:units' },
    associate: { quorum: 0.5, threshold: 0.6, readings: 1, concurrent: 'shares:units' },
    'joint-super': { quorum: 0.5, threshold: 0.6666, readings: 1, concurrent: 'shares:units' },
  },
  order: ['ordinary', 'joint', 'associate', 'organic', 'joint-super', 'constitutional', 'entrenched'],
};
const set = { 'partnership.join_rule': 'associate', 'partnership.profits_rule': 'joint', 'partnership.assets_rule': 'joint-super',
  'elections.incompatible': [['treasurer', 'audit-committee']] };

async function club() {
  const w = await worldWith(['shares', 'offices', 'elections', 'partnership'], { people: 3, extra });
  const [a, b, c] = w.ids;
  const r = await enact(w, { title: 'Units', rule: 'constitutional', changes: set, effects: [
    { kind: 'share.class', class: 'units', title: 'Partnership units', voting: true, transferable: false },
    { kind: 'share.issue', class: 'units', to: a, count: 50 }, { kind: 'share.issue', class: 'units', to: b, count: 30 }, { kind: 'share.issue', class: 'units', to: c, count: 20 }] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  return w;
}
const join = { kind: 'partnership.join', association: 'bay-clubs', name: 'Bay Area Investment Clubs', terms: 'Members share research and may pool profits as resolved.' };
async function put(w, rule, effects, yes, no = []) {
  const p = await propose(w, yes[0], { title: 'Resolution', rule, effects });
  if (p.refused.length) return { refused: p.refused[0].reason };
  for (const id of yes) await vote(w, p.id, id, 'for');
  for (const id of no) await vote(w, p.id, id, 'against');
  return w.state.proposals[p.id];
}

test('partnership: joining an association needs 60% of the partners and 60% of the units', async () => {
  const w = await club();
  const [a, b, c] = w.ids;
  // The rule is chosen for it: anything less is refused when laid.
  assert.match((await put(w, 'joint', [join], [a, b])).refused, /associate/);
  // a alone: half the units, a third of the partners.
  assert.equal((await put(w, 'associate', [join], [a], [b, c])).closed.carried, false);
  // b and c: two thirds of the partners, half the units.
  assert.equal((await put(w, 'associate', [join], [b, c], [a])).closed.carried, false);
  // a and b: two thirds of the partners, 80% of the units.
  const ok = await put(w, 'associate', [join], [a, b], [c]);
  assert.equal(ok.closed.carried, true); assert.ok(ok.enacted);
  assert.equal(w.state.m.partnership.associations['bay-clubs'].name, 'Bay Area Investment Clubs');
});

test('partnership: claims on profits by a majority of both, on assets by two thirds of both', async () => {
  const w = await club();
  const [a, b, c] = w.ids;
  await put(w, 'associate', [join], [a, b]);
  const profits = { kind: 'partnership.claim', association: 'bay-clubs', claim: 'pool', on: 'profits', share: 1000 };
  assert.match((await put(w, 'ordinary', [profits], [a])).refused, /joint/);
  // a and c: two thirds of partners, 70% of units: a majority of both.
  assert.ok((await put(w, 'joint', [profits], [a, c], [b])).enacted);
  assert.equal(profitShare(w.state), 1000);
  const assets = { kind: 'partnership.claim', association: 'bay-clubs', claim: 'guarantee', on: 'assets', share: 2500, cap: 500000 };
  assert.match((await put(w, 'joint', [assets], [a])).refused, /joint-super/);
  // a and b: two thirds of partners, 80% of units.
  const g = await put(w, 'joint-super', [assets], [a, b], [c]);
  assert.ok(g.enacted, g.notEnacted);
  // b and c: two thirds of partners but half the units: not enough.
  const g2 = await put(w, 'joint-super', [{ ...assets, claim: 'second' }], [b, c], [a]);
  assert.equal(g2.closed.carried, false);
  // Claims on profits never exceed the whole; leaving needs claims released.
  assert.match((await put(w, 'joint', [{ ...profits, claim: 'too-much', share: 9500 }], [a, b])).refused, /exceed the whole/);
  assert.match((await put(w, 'associate', [{ kind: 'partnership.leave', association: 'bay-clubs' }], [a, b])).refused, /end bay-clubs's claims first/);
  assert.ok((await put(w, 'joint-super', [{ kind: 'partnership.release', association: 'bay-clubs', claim: 'guarantee', on: 'assets' },
    { kind: 'partnership.release', association: 'bay-clubs', claim: 'pool', on: 'profits' }, { kind: 'partnership.leave', association: 'bay-clubs' }], [a, b])).enacted);
  assert.ok(w.state.m.partnership.associations['bay-clubs'].left);
});

test('partnership: certificates are issued from the record, and reissued when units change', async () => {
  const w = await club();
  const [a, b, c] = w.ids;
  const certs = certificates(w.records);
  const now = (id) => certs.filter(x => x.partner === id && !x.cancelled);
  assert.equal(now(a).length, 1); assert.equal(now(a)[0].units, 50);
  assert.equal(now(c)[0].units, 20);
  assert.ok(certs.some(x => x.cancelled), 'the founding certificate was replaced when units were issued');
  assert.deepEqual(certs.map(x => x.number), certs.map((_, i) => i + 1));
  await w.settle(await w.sign('participant.leave', c));
  assert.equal(certificates(w.records).filter(x => x.partner === c && !x.cancelled).length, 0);
  assert.equal(partnership.name, 'partnership');
});

test('partnership: the treasurer may not stand for the audit committee', async () => {
  const w = await club();
  const [a, b] = w.ids;
  const r = await decide(w, { title: 'Offices', rule: 'organic', effects: [
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 1 },
    { kind: 'office.create', office: 'audit-committee', title: 'Audit Committee', seats: 2 },
    { kind: 'office.fill', office: 'treasurer', holder: a },
    { kind: 'election.call', election: 'audit-1', office: 'audit-committee', method: 'approval', stand_days: 7, vote_days: 7 }] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  const stand = async (by) => w.settle(await w.sign('election.stand', by, { election: 'audit-1' }));
  assert.match((await stand(a)).refused[0].reason, /hold the office treasurer/);
  assert.equal((await stand(b)).refused.length, 0);
});

test('partnership: only the audit committee signs checkpoints', async () => {
  const w = await worldWith(['shares', 'offices', 'elections', 'finality', 'partnership'], { people: 3, extra });
  const [a, b, c] = w.ids;
  const r = await enact(w, { title: 'The audit committee validates', rule: 'constitutional', changes: { 'finality.signers': 'office:audit-committee' }, effects: [
    { kind: 'office.create', office: 'audit-committee', title: 'Audit Committee', seats: 2 },
    { kind: 'office.fill', office: 'audit-committee', holder: b }, { kind: 'office.fill', office: 'audit-committee', holder: c }] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  const sign = async (by) => { const at = w.at(); return w.settle(await w.sign('checkpoint.sign', by, { number: 1, count: w.state.head.seq, head: w.state.head.hash, at })); };
  assert.match((await sign(a)).refused[0].reason, /not among the signers/);
  const cp = { number: 1, count: w.state.head.seq, head: w.state.head.hash };
  assert.equal((await w.settle(await w.sign('checkpoint.sign', b, cp))).refused.length, 0);
  assert.equal((await w.settle(await w.sign('checkpoint.sign', c, cp))).refused.length, 0);
  assert.equal(w.state.m.finality.finals.length, 1, 'two of the two auditors made it final');
});
