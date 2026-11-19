import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../../kernel/index.js';
import { worldWith, decide } from '../../test/helpers.js';
import { renderLetter, tex, body, formatDate } from './render.js';
import letters from './index.js';

const use = async (w, by, grant, effects) => w.settle(await w.sign('authority.exercise', by, { grant, effects }));
const cosign = async (w, by, exercise) => w.settle(await w.sign('authority.cosign', by, { exercise }));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function republic() {
  const w = await worldWith(['offices', 'committees', 'authority', 'letters'], { people: 4 });
  const r = await decide(w, { title: 'Offices, a committee and their letterheads', rule: 'organic', effects: [
    { kind: 'office.create', office: 'finance-manager', title: 'Finance Manager', seats: 1 },
    { kind: 'office.fill', office: 'finance-manager', holder: 'p-0002' },
    { kind: 'committee.create', committee: 'executive', title: 'Executive Committee', needs: 'majority' },
    { kind: 'committee.appoint', committee: 'executive', member: 'p-0001' },
    { kind: 'committee.appoint', committee: 'executive', member: 'p-0003' },
    { kind: 'committee.appoint', committee: 'executive', member: 'p-0004' },
    { kind: 'letterhead.define', letterhead: 'finance', issuer: 'office:finance-manager', name: 'Lothlórien', title: 'Office of the Finance Manager', address: ['2405 Prospect Street', 'Berkeley, California'] },
    { kind: 'letterhead.define', letterhead: 'executive', issuer: 'committee:executive', name: 'Virtual Democratic Republic', title: 'Executive Committee', joint: 'majority' },
    { kind: 'letterhead.define', letterhead: 'executive-unanimous', issuer: 'committee:executive', name: 'Virtual Democratic Republic', title: 'Executive Committee', joint: 'all' },
    { kind: 'letterhead.define', letterhead: 'assembly', issuer: 'entity', name: 'Virtual Democratic Republic', title: 'The Assembly' },
    { kind: 'authority.grant', grant: 'finance-letters', to: { office: 'finance-manager' }, may: ['letter.issue', 'letter.withdraw'], where: { letterhead: 'finance' } },
    { kind: 'authority.grant', grant: 'executive-letters', to: { committee: 'executive' }, may: ['letter.issue'], where: { letterhead: 'executive' } },
    { kind: 'authority.grant', grant: 'executive-weak', to: { committee: 'executive' }, may: ['letter.issue'], where: { letterhead: 'executive-unanimous' } },
  ] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  return w;
}
const letter = (id, letterhead, extra = {}) => ({ kind: 'letter.issue', letter: id, letterhead, subject: 'Spring charges', body: 'Dear members,\n\nThe charges are **due** on the *first*.\n\n- rent\n- board', to: ['All members'], ...extra });

test('letters: an officer issues on the office letterhead, and nobody else can', async () => {
  const w = await republic();
  await w.settle(await w.sign('letter.specimen', 'p-0002', { drawing: PNG }));
  const ok = await use(w, 'p-0002', 'finance-letters', [letter('FIN-2026-001', 'finance')]);
  assert.equal(ok.applied.length, 1, ok.refused[0]?.reason);
  const l = letters.letterOf(w.state, 'FIN-2026-001');
  assert.deepEqual(l.signatories.map(s => [s.id, s.role, s.specimen]), [['p-0002', 'Finance Manager', 0]]);
  assert.equal(l.authority.grant, 'finance-letters');
  assert.match(l.fingerprint, /^[0-9a-f]{64}$/);

  assert.match((await use(w, 'p-0003', 'finance-letters', [letter('FIN-2026-002', 'finance')])).refused[0].reason, /only members of the office finance-manager/);
  const byVote = await decide(w, { title: 'Write as the Finance Manager', rule: 'ordinary', effects: [letter('FIN-2026-003', 'finance')] });
  assert.match(byVote.refused[0].reason, /issued through a grant held by that office, not by decision/);
  // A grant to the wrong body cannot borrow the letterhead.
  await decide(w, { title: 'Exec writes finance letters', rule: 'organic', effects: [{ kind: 'authority.grant', grant: 'exec-fin', to: { committee: 'executive' }, may: ['letter.issue'], where: { letterhead: 'finance' }, needs: 1 }] });
  assert.match((await use(w, 'p-0001', 'exec-fin', [letter('FIN-2026-004', 'finance')])).refused[0].reason, /issued only by the office finance-manager/);
  assert.match((await use(w, 'p-0002', 'finance-letters', [letter('FIN-2026-001', 'finance')])).refused[0].reason, /already a letter/);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('letters: a committee issues jointly, and the letter carries those who signed', async () => {
  const w = await republic();
  const x = await use(w, 'p-0001', 'executive-letters', [letter('EX-2026-001', 'executive')]);
  assert.equal(x.applied.length, 1, x.refused[0]?.reason);
  assert.equal(letters.letterOf(w.state, 'EX-2026-001'), null, 'one of three is not a majority');
  const xid = Object.keys(w.state.m.authority.exercises).pop();
  await cosign(w, 'p-0003', xid);
  const l = letters.letterOf(w.state, 'EX-2026-001');
  assert.deepEqual(l.signatories.map(s => s.id), ['p-0001', 'p-0003']);
  assert.deepEqual(l.joint, { signed: 2, of: 3, unanimous: false });
  assert.equal(l.signatories[0].role, 'Member, Executive Committee');

  // A unanimous letterhead refuses a grant that a majority could use.
  assert.match((await use(w, 'p-0001', 'executive-weak', [letter('EX-2026-002', 'executive-unanimous')])).refused[0].reason, /issued unanimously.*needs only 2 of 3/);
  await decide(w, { title: 'Unanimity', rule: 'organic', effects: [{ kind: 'authority.amend', grant: 'executive-weak', may: ['letter.issue'], needs: 'all' }] });
  await use(w, 'p-0001', 'executive-weak', [letter('EX-2026-002', 'executive-unanimous')]);
  const y = Object.keys(w.state.m.authority.exercises).pop();
  await cosign(w, 'p-0003', y); assert.equal(letters.letterOf(w.state, 'EX-2026-002'), null);
  await cosign(w, 'p-0004', y);
  assert.deepEqual(letters.letterOf(w.state, 'EX-2026-002').joint, { signed: 3, of: 3, unanimous: true });
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('letters: the members issue on their own letterhead by decision, and withdraw', async () => {
  const w = await republic();
  const r = await decide(w, { title: 'A letter from the Assembly', rule: 'ordinary', effects: [letter('AS-2026-001', 'assembly', { signatures: true })] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const l = letters.letterOf(w.state, 'AS-2026-001');
  assert.equal(l.authority.proposal, r.id);
  assert.deepEqual(l.signatories.map(s => s.id), w.state.proposals[r.id].ballots.filter(b => b.choice === 'for').map(b => b.by), 'those who voted for it');
  assert.ok(l.signatories.length >= 3);
  assert.match((await use(w, 'p-0002', 'finance-letters', [{ kind: 'letter.withdraw', letter: 'AS-2026-001', reason: 'no' }])).refused[0].reason, /letterhead/);
  const wd = await decide(w, { title: 'Withdraw it', rule: 'ordinary', effects: [{ kind: 'letter.withdraw', letter: 'AS-2026-001', reason: 'Sent too soon.' }] });
  assert.equal(wd.enacted, true, wd.refused?.[0]?.reason || wd.notEnacted);
  assert.equal(letters.letterOf(w.state, 'AS-2026-001').withdrawn.reason, 'Sent too soon.');
});

test('letters: an amended letterhead never changes a letter already issued', async () => {
  const w = await republic();
  await use(w, 'p-0002', 'finance-letters', [letter('FIN-2026-001', 'finance')]);
  await decide(w, { title: 'New colours', rule: 'organic', effects: [{ kind: 'letterhead.amend', letterhead: 'finance', title: 'Finance Office', style: { accent: '1F3A5F', layout: 'flush' } }] });
  assert.equal(letters.letterOf(w.state, 'FIN-2026-001').head.title, 'Office of the Finance Manager');
  assert.equal(w.state.m.letters.heads.finance.style.layout, 'flush');
  const bad = await decide(w, { title: 'Move it', rule: 'organic', effects: [{ kind: 'letterhead.amend', letterhead: 'finance', issuer: 'entity' }] });
  assert.match(bad.refused[0].reason, /issuer cannot change/);
});

test('letters: the LaTeX escapes what it prints and shows who signed', () => {
  assert.equal(tex('50% & $5_x #1 {a}'), '50\\% \\& \\$5\\_x \\#1 \\{a\\}');
  assert.equal(tex('a\\b'), 'a\\textbackslash{}b');
  assert.match(body('One **two** *three*.\n\n1. a\n2. b'), /\\textbf\{two\} \\emph\{three\}[\s\S]*\\begin\{enumerate\}/);
  assert.equal(formatDate('2026-11-01', 'eu'), '1 November 2026');
  const l = { letter: 'EX-1', subject: 'S', body: 'B', date: '2026-11-01', to: [], cc: [], enclosures: [], signatures: true, closing: '',
    head: { name: 'Lothlórien', title: 'Executive Committee', address: [] }, joint: { signed: 2, of: 3, unanimous: false },
    signatories: [{ id: 'a', role: 'Member' }, { id: 'b', role: 'Member' }], fingerprint: 'ab'.repeat(32) };
  const { tex: src } = renderLetter(l, { entity: 'VDR', issuerTitle: 'Executive Committee', name: (id) => id.toUpperCase(), style: letters.styleOf(null, l.head) });
  assert.match(src, /by a majority of its members \(2 of 3\)/);
  assert.match(src, /\\textsc\{A\}[\s\S]*\\textsc\{B\}/);
  assert.match(src, /LOTHL\{\\'\{O\}\}RIEN/, 'the seal spells accents as LaTeX accents');
});
