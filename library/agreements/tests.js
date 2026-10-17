import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../../kernel/index.js';
import { worldWith, decide, enact } from '../../test/helpers.js';
import agreements from './index.js';

async function club(extra = []) {
  const w = await worldWith(['wiki', 'agreements', ...extra]);
  const edit = async (body, base) => w.settle(await w.sign('wiki.edit', 'p-0001', { page: 'partnership-agreement', title: 'Partnership agreement', body, base }));
  await edit('Every partner takes part in every investment decision.', 0);
  await decide(w, { title: 'Enact it', rule: 'organic', effects: [{ kind: 'wiki.enact', page: 'partnership-agreement', version: 1 }] });
  const r = await enact(w, { title: 'Signing required', rule: 'constitutional', changes: { 'agreements.required': ['partnership-agreement'], 'membership.admission': 'decision' } });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  await w.person('p-new'); await w.settle(await w.sign('participant.apply', 'p-new', { key: w.line('p-new') }));
  const sign = async (by, version = 1, text) => {
    const P = (await import('../../kernel/parameters.js')).Parameters;
    const v = agreements.current(w.state, 'partnership-agreement', new P(w.state.doc, w.state.catalog));
    return w.settle(await w.sign('agreement.sign', by, { page: 'partnership-agreement', version, text: text ?? agreements.fingerprint('partnership-agreement', v) }));
  };
  return { w, edit, sign };
}

test('agreements: an applicant is admitted only after signing the exact text in force', async () => {
  const { w, sign } = await club();
  const early = await decide(w, { title: 'Admit', rule: 'ordinary', admit: ['p-new'] });
  assert.equal(early.enacted, false);
  assert.match(early.notEnacted, /p-new cannot be admitted yet: has not signed "Partnership agreement"/);
  assert.match((await sign('p-new', 1, 'f'.repeat(64))).refused[0].reason, /not the text of this version/);
  assert.match((await sign('p-new', 2)).refused[0].reason, /version to sign is 1/);
  assert.equal((await sign('p-new')).applied.length, 1);
  assert.match((await sign('p-new')).refused[0].reason, /already signed/);
  const ok = await decide(w, { title: 'Admit', rule: 'ordinary', admit: ['p-new'] });
  assert.equal(ok.enacted, true, ok.notEnacted);
  assert.equal(w.state.participants['p-new'].status, 'active');
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('agreements: amendments carry earlier signatures, or require signing again', async () => {
  const { w, edit, sign } = await club();
  await sign('p-new');
  await edit('Every partner takes part in every investment decision. Partners pay in monthly.', 1);
  await decide(w, { title: 'Amend', rule: 'organic', effects: [{ kind: 'wiki.enact', page: 'partnership-agreement', version: 2 }] });
  const P = (await import('../../kernel/parameters.js')).Parameters;
  const params = () => new P(w.state.doc, w.state.catalog);
  assert.equal(agreements.unsigned(w.state, 'p-new', 'partnership-agreement', params()), null, 'carry: the earlier signature counts');
  await enact(w, { title: 'Sign again', rule: 'constitutional', changes: { 'agreements.amendments': 'resign' } });
  assert.match(agreements.unsigned(w.state, 'p-new', 'partnership-agreement', params()), /current version.*version 2/);
  await sign('p-new', 2);
  assert.equal(agreements.unsigned(w.state, 'p-new', 'partnership-agreement', params()), null);
});

test('agreements: a grant cannot admit an unsigned applicant, and the fund takes no money from one', async () => {
  const { w, sign } = await club(['offices', 'authority', 'fund']);
  await decide(w, { title: 'Admissions officer', rule: 'organic', effects: [
    { kind: 'office.create', office: 'admissions', title: 'Admissions', seats: 1 },
    { kind: 'office.fill', office: 'admissions', holder: 'p-0002' },
    { kind: 'authority.grant', grant: 'admit', to: { office: 'admissions' }, may: ['participant.admit'] },
    { kind: 'authority.grant', grant: 'books', to: { office: 'admissions' }, may: ['fund.contribute'] }] });
  const use = async (grant, effects) => w.settle(await w.sign('authority.exercise', 'p-0002', { grant, effects }));
  assert.match((await use('admit', [{ kind: 'participant.admit', id: 'p-new' }])).refused[0].reason, /has not signed/);
  assert.match((await use('books', [{ kind: 'fund.contribute', member: 'p-0003', amount: 10000 }])).refused[0].reason, /p-0003 has not signed/);
  await sign('p-0003');
  assert.equal((await use('books', [{ kind: 'fund.contribute', member: 'p-0003', amount: 10000 }])).applied.length, 1);
  await sign('p-new');
  assert.equal((await use('admit', [{ kind: 'participant.admit', id: 'p-new' }])).applied.length, 1);
});

test('agreements: a drawn signature is sealed into the signed act; it can be required', async () => {
  const { w, sign } = await club();
  const P = (await import('../../kernel/parameters.js')).Parameters;
  const v = () => agreements.current(w.state, 'partnership-agreement', new P(w.state.doc, w.state.catalog));
  const signWith = async (by, extra) => w.settle(await w.sign('agreement.sign', by, { page: 'partnership-agreement', version: 1, text: agreements.fingerprint('partnership-agreement', v()), ...extra }));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.match((await signWith('p-new', { drawing: 'data:image/svg+xml;base64,PHN2Zz4=' })).refused[0].reason, /must be a PNG/);
  assert.match((await signWith('p-new', { drawing: 'data:image/png;base64,' + 'A'.repeat(90000) })).refused[0].reason, /too large/);
  assert.equal((await signWith('p-new', { drawing: png })).applied.length, 1);
  assert.equal(agreements.signaturesOf(w.state, 'p-new', 'partnership-agreement')[0].drawing, png);
  await decide(w, { title: 'Draw it', rule: 'organic', changes: { 'agreements.drawn_signature': 'required' } });
  assert.match((await signWith('p-0003', {})).refused[0].reason, /draw your signature/);
  assert.equal((await signWith('p-0003', { drawing: png })).applied.length, 1);
});
