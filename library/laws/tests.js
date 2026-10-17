// A relational legal system: types, tags and the bodies a law concerns;
// Parliament and referendum; parameters changed only by parametric laws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide, enact } from '../../test/helpers.js';
import laws from './index.js';

const setup = async () => {
  const w = await worldWith(['offices', 'committees', 'laws'], { people: 5 });
  const r = await decide(w, { title: 'Parliament', rule: 'organic', effects: [
    { kind: 'office.create', office: 'member-of-parliament', title: 'Member of Parliament', seats: 3, term_days: 365 },
    { kind: 'office.create', office: 'president', title: 'President', seats: 1 },
    { kind: 'committee.create', committee: 'supreme-court', title: 'Supreme Court', remit: 'justice' },
    ...['p-0001', 'p-0002', 'p-0003'].map(holder => ({ kind: 'office.fill', office: 'member-of-parliament', holder }))] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  return { w, act };
};
const ok = (r) => { assert.equal(r.applied.length, 1, r.refused?.[0]?.reason); return r; };
const no = (r, re) => assert.match(r.refused?.[0]?.reason || '', re);
// A parametric law at the constitutional level, decided by referendum.
const setting = (w, law, changes) => enact(w, { title: law, rule: 'entrenched', effects: [{ kind: 'law.enact', law, title: law, type: 'parametric', level: 'constitutional', tags: ['settings'], enforcers: ['citizens'], subjects: ['citizens'], changes }] });
const C = { law: 'constitution', title: 'The Constitution', text: '## Article I\n1. The republic is democratic.', type: 'constitutional', tags: ['state', 'rights'], enforcers: ['committee:supreme-court'], subjects: ['public'] };

test('laws: types, levels, tags and parties are checked; the Constitution is enacted by referendum', async () => {
  const { w } = await setup();
  const bad = async (e, re) => { const r = await decide(w, { title: 'x', rule: 'entrenched', effects: [{ kind: 'law.enact', ...e }] }); assert.match(r.refused?.[0]?.reason || r.notEnacted || '', re); };
  await bad({ ...C, type: 'royal' }, /type must be one of constitutional, organic, statutory, ordinary, parametric/);
  await bad({ ...C, tags: [] }, /1–12 tags/);
  await bad({ ...C, enforcers: ['office:nobody'] }, /no office nobody/);
  await bad({ ...C, type: 'ordinary' }, /needs a level/);
  await bad({ ...C, type: 'ordinary', level: 'organic' }, /constitutional, statutory/);
  await bad({ ...C, changes: { 'laws.parliament_days': 9 } }, /only a parametric law changes parameters/);
  const weak = await decide(w, { title: 'Constitution', rule: 'organic', effects: [{ kind: 'law.enact', ...C }] });
  assert.match(weak.refused?.[0]?.reason || '', /constitutional/);
  const r = await enact(w, { title: 'Constitution', rule: 'constitutional', effects: [{ kind: 'law.enact', ...C }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  const c = laws.law(w.state, 'constitution');
  assert.equal(c.status, 'in force'); assert.deepEqual(c.tags, ['state', 'rights']); assert.match(c.versions[0].via, /^referendum: decision d-/);
});

test('laws: Parliament passes a statutory law; a petition window; promulgation; repeal', async () => {
  const { w, act } = await setup();
  const L = { bill: 'b-parks', action: 'enact', law: 'parks-act', title: 'Parks Act', text: 'Parks are open to all.', type: 'statutory', tags: ['parks'], enforcers: ['office:president'], subjects: ['public'] };
  no(await act('law.bill', 'p-0004', L), /only a member of Parliament/);
  ok(await act('law.bill', 'p-0001', L));
  no(await act('law.vote', 'p-0004', { bill: 'b-parks', choice: 'for' }), /only the members of Parliament/);
  ok(await act('law.vote', 'p-0001', { bill: 'b-parks', choice: 'for' }));
  no(await act('law.close', 'p-0005', { bill: 'b-parks' }), /not yet certain/);
  ok(await act('law.vote', 'p-0002', { bill: 'b-parks', choice: 'for' }));
  ok(await act('law.close', 'p-0005', { bill: 'b-parks' }));
  assert.equal(laws.bill(w.state, 'b-parks').status, 'window');
  assert.equal(laws.law(w.state, 'parks-act'), null, 'not in force during the window');
  no(await act('law.promulgate', 'p-0004', { bill: 'b-parks' }), /may petition/);
  ok(await act('law.petition', 'p-0004', { bill: 'b-parks' }));
  assert.equal(laws.bill(w.state, 'b-parks').status, 'referendum', '5% of five citizens is one petition');
  // A bill nobody petitions against comes into force once the window has passed.
  ok(await act('law.bill', 'p-0002', { ...L, bill: 'b-libs', law: 'libraries-act', title: 'Libraries Act' }));
  for (const m of ['p-0001', 'p-0002', 'p-0003']) ok(await act('law.vote', m, { bill: 'b-libs', choice: 'for' }));
  ok(await act('law.close', 'p-0004', { bill: 'b-libs' }));
  w.jump(15);
  ok(await act('law.promulgate', 'p-0004', { bill: 'b-libs' }));
  assert.equal(laws.law(w.state, 'libraries-act').status, 'in force');
  assert.equal(laws.law(w.state, 'libraries-act').versions[0].via, 'parliament b-libs');
  // Parliament repeals it too.
  ok(await act('law.bill', 'p-0003', { bill: 'b-rep', action: 'repeal', law: 'libraries-act', reason: 'merged into the Parks Act' }));
  for (const m of ['p-0001', 'p-0002', 'p-0003']) ok(await act('law.vote', m, { bill: 'b-rep', choice: 'for' }));
  ok(await act('law.close', 'p-0004', { bill: 'b-rep' }));
  w.jump(15);
  ok(await act('law.promulgate', 'p-0004', { bill: 'b-rep' }));
  assert.equal(laws.law(w.state, 'libraries-act').status, 'repealed');
});

test('laws: a petition sends a bill to referendum; ratified by the Assembly', async () => {
  const { w, act } = await setup();
  assert.equal((await setting(w, 'petitions', { 'laws.petition_share': 0.4 })).enacted, true);
  const L = { bill: 'b1', action: 'enact', law: 'a1', title: 'Act One', text: 'Text.', type: 'statutory', tags: ['misc'], enforcers: ['office:president'], subjects: ['citizens'] };
  ok(await act('law.bill', 'p-0002', L));
  for (const m of ['p-0001', 'p-0002', 'p-0003']) ok(await act('law.vote', m, { bill: 'b1', choice: 'for' }));
  ok(await act('law.close', 'p-0001', { bill: 'b1' }));
  ok(await act('law.petition', 'p-0004', { bill: 'b1' }));
  assert.equal(laws.bill(w.state, 'b1').status, 'window');
  ok(await act('law.petition', 'p-0005', { bill: 'b1' }));
  assert.equal(laws.bill(w.state, 'b1').status, 'referendum');
  // The bill's rule, or a stricter one.
  const r = await decide(w, { title: 'Ratify Act One', rule: 'organic', effects: [{ kind: 'law.ratify', bill: 'b1', rule: 'organic' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(laws.law(w.state, 'a1').status, 'in force');
  assert.match(laws.law(w.state, 'a1').versions[0].via, /^referendum on parliament b1/);
});

test('laws: parametric laws change parameters; above Parliament’s rule they go to referendum', async () => {
  const { w, act } = await setup();
  assert.equal((await setting(w, 'no-window', { 'laws.petition_days': 0 })).enacted, true);
  const P1 = { bill: 'p1', action: 'enact', law: 'sitting-days', title: 'Sitting days', type: 'parametric', level: 'statutory', tags: ['parliament'], enforcers: ['office:member-of-parliament'], subjects: ['office:member-of-parliament'], changes: { 'laws.parliament_days': 10 } };
  no(await act('law.bill', 'p-0001', { ...P1, changes: {} }), /changes at least one parameter/);
  no(await act('law.bill', 'p-0001', { ...P1, changes: { 'entity.modules': [] } }), /installing modules/);
  ok(await act('law.bill', 'p-0001', P1));
  for (const m of ['p-0001', 'p-0002', 'p-0003']) ok(await act('law.vote', m, { bill: 'p1', choice: 'for' }));
  ok(await act('law.close', 'p-0003', { bill: 'p1' }));
  assert.equal(laws.bill(w.state, 'p1').status, 'in force');
  assert.equal(new (await import('../../kernel/parameters.js')).Parameters(w.state.doc, w.state.catalog).value('laws.parliament_days'), 10);
  assert.deepEqual(laws.law(w.state, 'sitting-days').versions[0].changed, [{ key: 'laws.parliament_days', from: 7, to: 10 }]);
  // Changing the types of law is constitutional: Parliament can pass it, the citizens decide.
  const P2 = { ...P1, bill: 'p2', law: 'more-days', title: 'Petition share', level: 'constitutional', changes: { 'laws.petition_share': 0.1 } };
  ok(await act('law.bill', 'p-0001', P2));
  assert.equal(laws.bill(w.state, 'p2').refer, true);
  for (const m of ['p-0001', 'p-0002', 'p-0003']) ok(await act('law.vote', m, { bill: 'p2', choice: 'for' }));
  ok(await act('law.close', 'p-0003', { bill: 'p2' }));
  assert.equal(laws.bill(w.state, 'p2').status, 'referendum');
  // A law that still governs a setting cannot be repealed; once another law sets it, it can,
  // under the rule it was enacted under (organic: laws.parliament_days is an organic setting).
  const held = await decide(w, { title: 'Repeal', rule: 'organic', effects: [{ kind: 'law.repeal', law: 'sitting-days', rule: 'organic', reason: 'back to the default' }] });
  assert.match(held.refused?.[0]?.reason || '', /still governs 1 setting \(laws.parliament_days\)/);
  const back = await decide(w, { title: 'Default days', rule: 'organic', effects: [{ kind: 'law.enact', law: 'default-days', title: 'Default days', type: 'parametric', level: 'statutory', tags: ['parliament'], enforcers: ['citizens'], subjects: ['citizens'], changes: { 'laws.parliament_days': 7 } }] });
  assert.equal(back.enacted, true, back.refused?.[0]?.reason || back.notEnacted);
  assert.deepEqual(laws.governs(w.state, 'default-days'), ['laws.parliament_days']);
  const weak = await decide(w, { title: 'Repeal', rule: 'ordinary', effects: [{ kind: 'law.repeal', law: 'sitting-days', rule: 'ordinary', reason: 'back to the default' }] });
  assert.match(weak.refused?.[0]?.reason || '', /needs the organic rule/);
  const r = await decide(w, { title: 'Repeal', rule: 'organic', effects: [{ kind: 'law.repeal', law: 'sitting-days', rule: 'organic', reason: 'back to the default' }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  assert.equal(laws.law(w.state, 'sitting-days').status, 'repealed');
});

test('laws: settings change only by law; amendments keep what a law governs and its majority', async () => {
  const { w } = await setup();
  const bare = await decide(w, { title: 'Bare', rule: 'organic', changes: { 'laws.parliament_days': 9 } });
  assert.match(bare.refused?.[0]?.reason || '', /settings change only by a parametric law/);
  assert.equal((await setting(w, 'settings', { 'laws.parliament_days': 9, 'laws.petition_days': 3 })).enacted, true);
  assert.deepEqual(laws.governs(w.state, 'settings').sort(), ['laws.parliament_days', 'laws.petition_days']);
  // An amendment may not drop a setting the law governs, nor lower its majority.
  const { n, at, via, rule, changed, ...s } = laws.law(w.state, 'settings').versions[0]; void [n, at, via, rule, changed];
  const drop = await enact(w, { title: 'x', rule: 'entrenched', effects: [{ kind: 'law.enact', ...s, changes: { 'laws.parliament_days': 9 } }] });
  assert.match(drop.refused?.[0]?.reason || '', /governs laws.petition_days/);
  const lower = await enact(w, { title: 'x', rule: 'entrenched', effects: [{ kind: 'law.enact', ...s, level: 'statutory', changes: { 'laws.parliament_days': 8, 'laws.petition_days': 3 }, }] });
  assert.equal(lower.enacted, true, 'laws.petition_days keeps it constitutional: '+ (lower.refused?.[0]?.reason || lower.notEnacted));
  // The Constitution cannot be amended down to a statute.
  assert.equal((await enact(w, { title: 'C', rule: 'constitutional', effects: [{ kind: 'law.enact', ...C }] })).enacted, true);
  const demote = await decide(w, { title: 'Demote', rule: 'ordinary', effects: [{ kind: 'law.enact', ...C, type: 'statutory', text: 'Nothing.' }] });
  assert.match(demote.refused?.[0]?.reason || '', /cannot lower the majority this law needs \(constitutional\)/);
  // Modules are still switched on and off by a bill of their own.
  const mods = await decide(w, { title: 'Modules', rule: 'organic', changes: { 'entity.modules': new (await import('../../kernel/parameters.js')).Parameters(w.state.doc, w.state.catalog).value('entity.modules') } });
  assert.equal(mods.refused?.length || 0, 0, mods.refused?.[0]?.reason);
});
