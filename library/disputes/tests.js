// The haircut, every way it can go. p-0001 cuts hair (provider); p-0002 is the
// neighbour (payer); p-0003 is the House Arbitrator; p-0004 and p-0005 sit on
// the Arbitration Council; p-0006 is anyone else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../../kernel/index.js';
import { worldWith, decide } from '../../test/helpers.js';

const EV = (name) => ({ name, sha256: 'a'.repeat(64), note: `${name}, attached` });

async function house(set = {}) {
  const w = await worldWith(['value', 'offices', 'committees', 'contracts', 'disputes'], { people: 6 });
  const r = await decide(w, { title: 'The house', rule: 'organic', changes: set, effects: [
    { kind: 'value.issue', to: 'p-0002', amount: 100, memo: 'house dollars' },
    { kind: 'value.issue', to: 'p-0001', amount: 10, memo: 'house dollars' },
    { kind: 'office.create', office: 'arbitrator', title: 'House Arbitrator', seats: 1 },
    { kind: 'office.fill', office: 'arbitrator', holder: 'p-0003' },
    { kind: 'committee.create', committee: 'arbitration-council', title: 'Arbitration Council', remit: 'appeals' },
    { kind: 'committee.appoint', committee: 'arbitration-council', member: 'p-0004' },
    { kind: 'committee.appoint', committee: 'arbitration-council', member: 'p-0005' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  const ok = async (kind, by, f) => { const x = await act(kind, by, f); assert.equal(x.applied.length, 1, `${kind} by ${by}: ${x.refused[0]?.reason}`); return x; };
  const no = async (kind, by, f, re) => { const x = await act(kind, by, f); assert.equal(x.applied.length, 0, `${kind} by ${by} should be refused`); assert.match(x.refused[0].reason, re); };
  const bal = (id) => w.state.m.value.balances[id] || 0;
  const held = () => Object.values(w.state.m.value.held || {}).reduce((a, h) => a + h.amount, 0);
  const deal = async (id) => {
    await ok('contract.offer', 'p-0001', { contract: id, with: 'p-0002', role: 'provider', amount: 25, title: 'Haircut', terms: 'One haircut, Saturday at 2pm, in my room. $25.' });
    await ok('contract.accept', 'p-0002', { contract: id });
  };
  return { w, act, ok, no, bal, held, deal };
}

test('contracts: the ideal path — offered, accepted into escrow, done, confirmed, paid', async () => {
  const { w, ok, no, bal, held } = await house();
  await ok('contract.offer', 'p-0001', { contract: 'haircut', with: 'p-0002', role: 'provider', amount: 25, title: 'Haircut', terms: 'One haircut, Saturday.' });
  assert.equal(w.state.m.contracts.haircut.status, 'offered');
  await no('contract.accept', 'p-0001', { contract: 'haircut' }, /only the member it was offered to/);
  await no('contract.confirm', 'p-0002', { contract: 'haircut' }, /no active contract/);
  await ok('contract.accept', 'p-0002', { contract: 'haircut' });
  assert.equal(bal('p-0002'), 75); assert.equal(held(), 25);
  await no('contract.done', 'p-0002', { contract: 'haircut' }, /only the provider/);
  await ok('contract.done', 'p-0001', { contract: 'haircut', note: 'Cut and styled.' });
  await no('contract.confirm', 'p-0001', { contract: 'haircut' }, /only the payer/);
  await ok('contract.confirm', 'p-0002', { contract: 'haircut' });
  assert.equal(bal('p-0001'), 35); assert.equal(bal('p-0002'), 75); assert.equal(held(), 0);
  assert.equal(w.state.m.contracts.haircut.status, 'paid');
  assert.equal(w.state.m.value.supply, 110, 'escrow never creates or destroys units');
});

test('contracts: offers that never start, a payer who cannot pay, cancelling by both, and collecting when the payer goes quiet', async () => {
  const { w, act, ok, no, bal, held } = await house();
  await no('contract.offer', 'p-0001', { contract: 'x', with: 'p-0001', role: 'provider', amount: 5, title: 'x', terms: 'x' }, /another active member/);
  await no('contract.offer', 'p-0001', { contract: 'x', with: 'p-0002', role: 'provider', amount: 0, title: 'x', terms: 'x' }, /above zero/);
  await ok('contract.offer', 'p-0001', { contract: 'big', with: 'p-0002', role: 'provider', amount: 500, title: 'Big', terms: 'Too much.' });
  await no('contract.accept', 'p-0002', { contract: 'big' }, /does not have 500|do not have 500/);
  await ok('contract.decline', 'p-0002', { contract: 'big' });
  await ok('contract.offer', 'p-0002', { contract: 'w', with: 'p-0001', role: 'payer', amount: 5, title: 'W', terms: 'w' });
  await no('contract.withdraw', 'p-0001', { contract: 'w' }, /only the member who offered/);
  await ok('contract.withdraw', 'p-0002', { contract: 'w' });
  // cancelled by both: the escrow goes back
  await ok('contract.offer', 'p-0001', { contract: 'c', with: 'p-0002', role: 'provider', amount: 20, title: 'C', terms: 'c' });
  await ok('contract.accept', 'p-0002', { contract: 'c' });
  await ok('contract.cancel', 'p-0001', { contract: 'c', reason: 'I am sick' });
  assert.equal(held(), 20, 'one side alone cannot cancel');
  await no('contract.cancel', 'p-0001', { contract: 'c' }, /already agreed/);
  await no('contract.cancel', 'p-0006', { contract: 'c' }, /only the two parties/);
  await ok('contract.cancel', 'p-0002', { contract: 'c' });
  assert.equal(held(), 0); assert.equal(bal('p-0002'), 100); assert.equal(w.state.m.contracts.c.status, 'refunded');
  // the payer goes quiet: collected after contracts.release_days
  await ok('contract.offer', 'p-0001', { contract: 'q', with: 'p-0002', role: 'provider', amount: 15, title: 'Q', terms: 'q' });
  await ok('contract.accept', 'p-0002', { contract: 'q' });
  await no('contract.collect', 'p-0001', { contract: 'q' }, /only a contract marked done/);
  await ok('contract.done', 'p-0001', { contract: 'q' });
  await no('contract.collect', 'p-0001', { contract: 'q' }, /3 days/);
  w.jump(4);
  await no('contract.collect', 'p-0002', { contract: 'q' }, /only the provider/);
  await ok('contract.collect', 'p-0001', { contract: 'q' });
  assert.equal(bal('p-0001'), 25); assert.equal(w.state.m.contracts.q.status, 'paid');
  void act;
});

test('disputes: the no-show — refunded by the Arbitrator, then reversed on appeal by the Council', async () => {
  const { w, ok, no, bal, held, deal } = await house();
  await deal('haircut');
  // the neighbour says I never showed, and asks for the $25 back
  await no('dispute.open', 'p-0006', { dispute: 'd1', contract: 'haircut', amount: 25, claim: 'x' }, /only a party/);
  await no('dispute.open', 'p-0002', { dispute: 'd1', contract: 'haircut', amount: 30, claim: 'x' }, /cannot claim more/);
  await ok('dispute.open', 'p-0002', { dispute: 'd1', contract: 'haircut', amount: 25, claim: 'They never turned up on Saturday. I waited an hour.', evidence: [EV('screenshot of my messages')] });
  assert.equal(w.state.m.contracts.haircut.dispute, 'd1');
  // the escrow is frozen: neither side can move it
  await no('contract.cancel', 'p-0001', { contract: 'haircut' }, /dispute .* is open/);
  await no('contract.confirm', 'p-0002', { contract: 'haircut' }, /dispute .* is open/);
  await no('dispute.open', 'p-0001', { dispute: 'd2', contract: 'haircut', amount: 25, claim: 'x' }, /already open/);
  // the Arbitrator may not rule before I answer (or my 3 days run out); parties never rule
  await no('dispute.rule', 'p-0003', { dispute: 'd1', amount: 25, reasons: 'No answer was filed.' }, /3 days to answer/);
  await no('dispute.rule', 'p-0002', { dispute: 'd1', amount: 25, reasons: 'I am obviously right.' }, /own dispute/);
  await no('dispute.rule', 'p-0006', { dispute: 'd1', amount: 25, reasons: 'I have opinions.' }, /only office:arbitrator/);
  await ok('dispute.file', 'p-0001', { dispute: 'd1', statement: 'I was there. I just had the wrong time.' });
  assert.equal(w.state.m.disputes.d1.answered !== null, true);
  // the Arbitrator refunds the neighbour; the ruling waits out the appeal window
  await no('dispute.rule', 'p-0003', { dispute: 'd1', amount: 25, reasons: 'short' }, /give reasons/);
  await ok('dispute.rule', 'p-0003', { dispute: 'd1', amount: 25, reasons: 'The provider admits the time was wrong. Refund in full.' });
  assert.equal(w.state.m.disputes.d1.status, 'ruled'); assert.equal(held(), 25, 'nothing moves until the appeal window passes');
  await no('dispute.execute', 'p-0002', { dispute: 'd1' }, /7 days for appeal/);
  // I appeal, with receipts showing they cancelled
  await no('dispute.appeal', 'p-0006', { dispute: 'd1', statement: 'x' }, /only the two sides/);
  await ok('dispute.appeal', 'p-0001', { dispute: 'd1', statement: 'They cancelled by text the night before. Receipts attached.', evidence: [EV('their cancellation text'), EV('my calendar')] });
  assert.equal(w.state.m.disputes.d1.status, 'appealed');
  await no('dispute.rule', 'p-0003', { dispute: 'd1', amount: 0, reasons: 'Changing my mind now.' }, /only committee:arbitration-council/);
  // the Council (2 members: a majority is 2) reverses it: the $25 is mine
  await ok('dispute.rule', 'p-0004', { dispute: 'd1', amount: 0, reasons: 'The texts show the payer cancelled. The provider is owed the fee.' });
  assert.equal(w.state.m.disputes.d1.status, 'appealed', 'one of two council members is not a majority');
  await ok('dispute.rule', 'p-0005', { dispute: 'd1', amount: 0, reasons: 'Agreed: the cancellation was the payer’s.' });
  const d = w.state.m.disputes.d1;
  assert.equal(d.status, 'final'); assert.equal(d.rulings.length, 2); assert.deepEqual(d.rulings[1].by, ['p-0004', 'p-0005']);
  assert.equal(bal('p-0001'), 35); assert.equal(bal('p-0002'), 75); assert.equal(held(), 0);
  assert.equal(w.state.m.contracts.haircut.status, 'paid'); assert.equal(w.state.m.contracts.haircut.dispute, null);
  assert.equal(d.filings.length, 3); assert.equal(d.filings[2].evidence.length, 2);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true, 'the whole story replays exactly');
});

test('disputes: no answer, no appeal — the ruling is carried out after the window; deposits; a dispute outside any contract', async () => {
  const { w, ok, no, bal, held, deal } = await house({ 'disputes.deposit': 2 });
  await deal('haircut');
  await ok('dispute.open', 'p-0002', { dispute: 'd1', contract: 'haircut', amount: 25, claim: 'No-show, and no reply since.' });
  assert.equal(bal('p-0002'), 73, '75 less the deposit of 2'); assert.equal(held(), 27);
  w.jump(4);                                                       // I never answer
  await ok('dispute.rule', 'p-0003', { dispute: 'd1', amount: 25, reasons: 'No answer in three days; the claim stands.' });
  w.jump(8);                                                       // nobody appeals
  await no('dispute.appeal', 'p-0001', { dispute: 'd1', statement: 'Too late?' }, /appeals close/);
  await ok('dispute.execute', 'p-0006', { dispute: 'd1' });
  assert.equal(bal('p-0002'), 100, 'refunded, and the deposit returned to the winner'); assert.equal(held(), 0);
  assert.equal(w.state.m.contracts.haircut.status, 'refunded');
  // outside any contract: the award is paid from the respondent's balance, and what they lack is owed
  await ok('dispute.open', 'p-0002', { dispute: 'd2', against: 'p-0001', amount: 40, claim: 'They broke my clippers.' });
  await ok('dispute.file', 'p-0001', { dispute: 'd2', statement: 'They were already broken.' });
  await ok('dispute.rule', 'p-0003', { dispute: 'd2', amount: 30, reasons: 'The clippers worked the day before. Thirty for a replacement.' });
  w.jump(8);
  await ok('dispute.execute', 'p-0002', { dispute: 'd2' });
  assert.equal(bal('p-0001'), 0); assert.equal(w.state.m.disputes.d2.owed, 20, 'p-0001 had 10: 20 is still owed');
  // opening needs the deposit; a claimant who loses forfeits it to the other side
  await no('dispute.open', 'p-0001', { dispute: 'd3', against: 'p-0002', amount: 5, claim: 'A claim.' }, /deposit of 2/);
  await ok('dispute.open', 'p-0002', { dispute: 'd4', against: 'p-0006', amount: 5, claim: 'They owe me five.' });
  await ok('dispute.file', 'p-0006', { dispute: 'd4', statement: 'I owe nothing.' });
  await ok('dispute.rule', 'p-0003', { dispute: 'd4', amount: 0, reasons: 'Nothing shows a debt. Claim dismissed.' });
  w.jump(8);
  await ok('dispute.execute', 'p-0006', { dispute: 'd4' });
  assert.equal(bal('p-0006'), 2, 'the losing claimant’s deposit goes to the other side');
});

test('disputes: when the members hear appeals, the appeal is a proposal', async () => {
  const { w, ok, bal, deal } = await house({ 'disputes.appeal': 'assembly' });
  await deal('haircut');
  await ok('dispute.open', 'p-0002', { dispute: 'd1', contract: 'haircut', amount: 25, claim: 'No-show.' });
  await ok('dispute.file', 'p-0001', { dispute: 'd1', statement: 'They cancelled.' });
  await ok('dispute.rule', 'p-0003', { dispute: 'd1', amount: 25, reasons: 'Refund: the provider did not show.' });
  await ok('dispute.appeal', 'p-0001', { dispute: 'd1', statement: 'They cancelled; see the texts.' });
  const r = await decide(w, { title: 'Decide the haircut appeal', rule: 'ordinary', effects: [{ kind: 'dispute.decide', dispute: 'd1', amount: 10, reasons: 'Both were at fault: split it.' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(w.state.m.disputes.d1.status, 'final');
  assert.equal(bal('p-0002'), 85, '75 + 10 back'); assert.equal(bal('p-0001'), 25, '10 + 15');
  assert.equal(w.state.m.contracts.haircut.status, 'split');
});

test('disputes: an unpaid ruling blocks new contracts until paid; whoever ruled first never hears the appeal; departed council members stop counting', async () => {
  const { w, ok, no, bal, deal } = await house();
  await ok('dispute.open', 'p-0002', { dispute: 'd1', against: 'p-0001', amount: 40, claim: 'They broke my clippers.' });
  await ok('dispute.file', 'p-0001', { dispute: 'd1', statement: 'They were already broken.' });
  await ok('dispute.rule', 'p-0003', { dispute: 'd1', amount: 30, reasons: 'Thirty for a replacement pair.' });
  w.jump(8); await ok('dispute.execute', 'p-0002', { dispute: 'd1' });
  assert.equal(w.state.m.disputes.d1.owed, 20);
  await no('contract.offer', 'p-0001', { contract: 'h', with: 'p-0002', role: 'provider', amount: 5, title: 'H', terms: 'h' }, /still owes 20/);
  await no('contract.offer', 'p-0002', { contract: 'h', with: 'p-0001', role: 'payer', amount: 5, title: 'H', terms: 'h' }, /still owes 20/);
  await decide(w, { title: 'Pay p-0001', rule: 'organic', effects: [{ kind: 'value.issue', to: 'p-0001', amount: 50, memo: 'wages' }] });
  await no('dispute.pay', 'p-0002', { dispute: 'd1', amount: 20 }, /only p-0001 pays/);
  await ok('dispute.pay', 'p-0001', { dispute: 'd1', amount: 20 });
  assert.equal(w.state.m.disputes.d1.owed, 0); assert.equal(bal('p-0001'), 30);
  await deal('h2');                                                     // contracts open again
  // the Arbitrator also sits on the Council: they may not hear the appeal of their own ruling
  await decide(w, { title: 'Seat the Arbitrator on the Council', rule: 'organic', effects: [{ kind: 'committee.appoint', committee: 'arbitration-council', member: 'p-0003' }] });
  await ok('dispute.open', 'p-0002', { dispute: 'd2', contract: 'h2', amount: 25, claim: 'No-show.' });
  await ok('dispute.file', 'p-0001', { dispute: 'd2', statement: 'They cancelled.' });
  await ok('dispute.rule', 'p-0003', { dispute: 'd2', amount: 25, reasons: 'Refund: no-show established.' });
  await ok('dispute.appeal', 'p-0001', { dispute: 'd2', statement: 'They cancelled the night before.' });
  await no('dispute.rule', 'p-0003', { dispute: 'd2', amount: 25, reasons: 'I stand by my ruling.' }, /first ruling may not hear its appeal/);
  // a council member signs, then leaves the council: their signature no longer counts
  await ok('dispute.rule', 'p-0004', { dispute: 'd2', amount: 0, reasons: 'The payer cancelled.' });
  await decide(w, { title: 'p-0004 steps down', rule: 'organic', effects: [{ kind: 'committee.remove', committee: 'arbitration-council', member: 'p-0004' }] });
  await ok('dispute.rule', 'p-0005', { dispute: 'd2', amount: 0, reasons: 'The payer cancelled; the fee is owed.' });
  // the council is now p-0003 (barred: they ruled first) and p-0005: p-0004’s
  // signature no longer counts, and p-0005 alone is a majority of who may hear it
  const d2 = w.state.m.disputes.d2;
  assert.equal(d2.status, 'final'); assert.deepEqual(d2.rulings[1].by, ['p-0005']);
  assert.equal(w.state.m.contracts.h2.status, 'paid');
});
