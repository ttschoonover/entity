// The federation: states admitted and released by decision, certifications
// signed by each state's registrar, one state per citizen, enrolment proved
// with the citizen's state key, chambers appointed by the states, seats by
// population, and one currency across the states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, enact } from '../../test/helpers.js';
import { keys } from '../../kernel/index.js';
import federation, { apportion, enrollMaterial, NS } from './index.js';
import { resolveElectorate } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const H = (n) => n.toString(16).padStart(64, '0');
const ok = (r) => assert.equal(r.applied.length, 1, r.refused[0]?.reason);
const no = (r, re) => { assert.equal(r.applied.length, 0, 'should be refused'); assert.match(r.refused[0].reason, re); };
const line = (k) => keys.publicKeyLine(k.publicKey);

test('federation: seats by equal proportions, every state at least one', () => {
  assert.deepEqual(apportion({ a: 300, b: 100 }, 4), { a: 3, b: 1 });
  assert.deepEqual(apportion({ a: 1, b: 1000 }, 3), { a: 1, b: 2 });
  assert.deepEqual(apportion({ a: 5, b: 5 }, 3), { a: 2, b: 1 }, 'ties go to the earlier id');
});

test('federation: two states, exclusive citizenship, chambers, one currency, lawful secession', async () => {
  const w = await worldWith(['federation', 'value'], { people: 2 });
  const P = () => new Parameters(w.state.doc, w.state.catalog);
  const roll = (spec) => Object.keys(resolveElectorate(w.registry, w.state, P(), w.at(), spec).roll).sort();
  const reg = { a: await keys.generate(), b: await keys.generate() };
  const sk = {}; for (const id of ['ana', 'ben', 'cy']) sk[id] = await keys.generate();   // their keys in their states
  const admit = await enact(w, { title: 'Admit two states', rule: 'entrenched', effects: [
    { kind: 'federation.admit_state', state: 'a', name: 'Alpha', entity: 'e-aaaa0001', keys: [line(reg.a)] },
    { kind: 'federation.admit_state', state: 'b', name: 'Beta', entity: 'e-bbbb0002', keys: [line(reg.b)] }] });
  assert.equal(admit.enacted, true, admit.refused?.[0]?.reason || admit.notEnacted);

  const certify = async (st, count, citizens, senate = [], assembly = [], key = reg[st]) =>
    w.settle(await w.sign('state.certify', st, { state: st, key: line(key), count, head: H(count), citizens: Object.fromEntries(citizens.map(id => [id, [line(sk[id])]])), senate, assembly }, key.privateKey));
  no(await certify('a', 5, ['ana'], [], [], reg.b), /registrar key/);
  ok(await certify('a', 5, ['ana', 'cy'], ['ana'], ['cy']));
  no(await certify('a', 5, ['ana', 'cy']), /later point/);
  no(await certify('b', 3, ['ben', 'ana']), /citizen of a/);
  no(await certify('b', 3, ['ben'], ['ben'], ['ben']), /both chambers/);
  ok(await certify('b', 3, ['ben'], ['ben']));
  assert.deepEqual(federation.seatsOf(w.state, P()), { a: 7, b: 3 }, 'two citizens to one');

  const fk = {};
  const enroll = async (id, st, stateKey = sk[id]) => {
    fk[id] = await keys.generate();
    const state_sig = await keys.sign(enrollMaterial({ entity: w.entity, id, key: keys.keyId(line(fk[id])) }), stateKey.privateKey, NS);
    const r = await w.settle(await w.sign('citizen.enroll', id, { state: st, key: line(fk[id]), state_key: line(stateKey), state_sig }, fk[id].privateKey));
    if (r.applied.length) { w.keys[id] = fk[id]; if (!w.ids.includes(id)) w.ids.push(id); }
    return r;
  };
  no(await enroll('ana', 'a', sk.ben), /not a key a certified/);
  no(await enroll('ben', 'a'), /has not certified ben/);
  for (const [id, st] of [['ana', 'a'], ['ben', 'b'], ['cy', 'a']]) ok(await enroll(id, st));
  no(await enroll('ana', 'a'), /already a citizen/);
  assert.deepEqual(roll('senate'), ['ana', 'ben']);
  assert.deepEqual(roll('assembly'), ['cy']);
  assert.deepEqual(roll('parliament'), ['ana', 'ben', 'cy']);

  // One currency, across the states.
  const issue = await enact(w, { title: 'Issue', rule: 'organic', effects: [{ kind: 'value.issue', to: 'ana', amount: 100 }] });
  assert.equal(issue.enacted, true, issue.refused?.[0]?.reason || issue.notEnacted);
  ok(await w.settle(await w.sign('value.transfer', 'ana', { to: 'ben', amount: 40 })));
  ok(await w.settle(await w.sign('value.transfer', 'ana', { to: 'cy', amount: 10 })));
  assert.equal(w.state.m.value.balances.ben, 40);

  // Cy leaves Alpha: federal citizenship lapses with it, until Beta certifies them.
  ok(await certify('a', 6, ['ana'], ['ana']));
  assert.equal(w.state.participants.cy.status, 'removed');
  no(await w.settle(await w.sign('value.transfer', 'cy', { to: 'ana', amount: 1 })), /removed/);
  ok(await certify('b', 4, ['ben', 'cy'], ['ben'], ['cy']));
  ok(await enroll('cy', 'b'));
  assert.equal(w.state.participants.cy.state, 'b');
  assert.equal(w.state.m.value.balances.cy, 10, 'a balance survives the move');

  // Secession is lawful only by the federation's decision; Beta's citizens go with it.
  const weak = await enact(w, { title: 'Let Beta go', rule: 'constitutional', effects: [{ kind: 'federation.release_state', state: 'b', reason: 'Beta asked to leave' }] });
  assert.match(weak.refused[0].reason, /entrenched/);
  const rel = await enact(w, { title: 'Let Beta go', rule: 'entrenched', effects: [{ kind: 'federation.release_state', state: 'b', reason: 'Beta asked to leave' }] });
  assert.equal(rel.enacted, true, rel.refused?.[0]?.reason || rel.notEnacted);
  assert.equal(w.state.participants.ben.status, 'removed');
  assert.deepEqual(roll('senate'), ['ana']);
  no(await certify('b', 9, ['ben']), /not a state/);
});
