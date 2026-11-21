import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { worldWith } from '../../test/helpers.js';
import details from './index.js';
import * as D from '../../kernel/details.js';
import { recordKeyFromSeed } from '../../kernel/sealing.js';
import { b64 } from '../../kernel/crypto.js';

const FIELDS = { legal_name: 'Ana María López', date_of_birth: '2001-04-02', residence: '2400 Ridge Rd, Berkeley, CA 94709', email: 'ana@example.org', tax_status: 'us-person', tin_type: 'SSN', tin: '123-45-6789', certified: true };

test('details: particulars sealed to the partner and the officers; the record holds only a digest', async () => {
  const w = await worldWith(['details'], { people: 2 });
  const ana = await recordKeyFromSeed(crypto.randomBytes(32)), treas = await recordKeyFromSeed(crypto.randomBytes(32)), other = await recordKeyFromSeed(crypto.randomBytes(32));
  assert.deepEqual(D.problems(FIELDS), []);
  assert.match(D.problems({ ...FIELDS, date_of_birth: new Date(Date.now() - 10 * 365 * 864e5).toISOString().slice(0, 10) }).join(), /at least 18/);
  assert.match(D.problems({ ...FIELDS, tin: '12' }).join(), /nine digits/);
  const blob = await D.sealDetails({ entity: 'e-1', member: 'p-0002' }, FIELDS, [{ id: 'p-0002', key: b64(ana.pk) }, { id: 'treasurer-holder', key: b64(treas.pk) }]);
  assert.ok(!JSON.stringify(blob).includes('123-45-6789'));
  assert.deepEqual(await D.openDetails(blob, 'treasurer-holder', treas.sk), FIELDS);
  await assert.rejects(D.openDetails(blob, 'treasurer-holder', other.sk));
  await assert.rejects(D.openDetails({ ...blob, member: 'p-0001' }, 'p-0002', ana.sk), 'bound to the member');
  // A reader shares them with a new officer; the digest does not change.
  const more = await D.rewrap(blob, 'treasurer-holder', treas.sk, [{ id: 'new', key: b64(other.pk) }]);
  assert.deepEqual(await D.openDetails(more, 'new', other.sk), FIELDS);
  assert.equal(D.digestOf(more), D.digestOf(blob));
  const r = await w.settle(await w.sign('details.filed', 'p-0002', { digest: D.digestOf(blob) }));
  assert.equal(r.applied.length, 1);
  assert.equal(details.filed(w.state, 'p-0002').digest, D.digestOf(blob));
  assert.match((await w.settle(await w.sign('details.filed', 'p-0002', { digest: 'nope' }))).refused[0].reason, /SHA-256/);
});
