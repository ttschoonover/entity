import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide, enact } from '../../test/helpers.js';
import { hash } from '../../kernel/hash.js';

test('invites: a personal link admits its holder once they apply and sign; wrong, used, revoked or expired links do not', async () => {
  const w = await worldWith(['invites'], { people: 2 });
  assert.ok((await enact(w, { title: 'Admission by decision', rule: 'organic', changes: { 'membership.admission': 'decision' } })).enacted);
  const secret = 'k3y-0nly-ana-gets', other = 'someone-else';
  const r = await decide(w, { title: 'Invite Ana', rule: 'ordinary', effects: [{ kind: 'invite.create', invite: 'ana', name: 'Ana López', hash: hash(secret), days: 14 }] });
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  assert.equal(w.state.m.invites.ana.name, 'Ana López');
  await w.person('ana'); await w.settle(await w.sign('participant.apply', 'ana', { key: w.line('ana') }));
  assert.equal(w.state.participants.ana.status, 'applicant');
  assert.match((await w.settle(await w.sign('invite.accept', 'ana', { invite: 'ana', secret: other }))).refused[0].reason, /not this invitation/);
  const ok = await w.settle(await w.sign('invite.accept', 'ana', { invite: 'ana', secret }));
  assert.equal(ok.applied.length, 1, ok.refused[0]?.reason);
  assert.equal(w.state.participants.ana.status, 'active', 'admitted without a further vote');
  await w.person('bo'); await w.settle(await w.sign('participant.apply', 'bo', { key: w.line('bo') }));
  assert.match((await w.settle(await w.sign('invite.accept', 'bo', { invite: 'ana', secret }))).refused[0].reason, /has been used/);
  // Revoked and expired.
  await decide(w, { title: 'Invite Bo', rule: 'ordinary', effects: [{ kind: 'invite.create', invite: 'bo', name: 'Bo', hash: hash('b'), days: 1 }] });
  w.jump(2);
  assert.match((await w.settle(await w.sign('invite.accept', 'bo', { invite: 'bo', secret: 'b' }))).refused[0].reason, /expired/);
  await decide(w, { title: 'Invite Bo again', rule: 'ordinary', effects: [{ kind: 'invite.create', invite: 'bo-2', name: 'Bo', hash: hash('c'), days: 7 }] });
  await decide(w, { title: 'Withdraw it', rule: 'ordinary', effects: [{ kind: 'invite.revoke', invite: 'bo-2' }] });
  assert.match((await w.settle(await w.sign('invite.accept', 'bo', { invite: 'bo-2', secret: 'c' }))).refused[0].reason, /withdrawn/);
});
