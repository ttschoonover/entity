import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, sealGeometry } from '../interface/js/seal.js';

const h1 = 'bb27acd6d4c9720f' + '0'.repeat(48), h2 = '99fffc53ead49955' + 'f'.repeat(48);
test('the same first record always draws the same seal', () => {
  assert.equal(seal(h1, { name: 'A', founded: '2026-10-18' }), seal(h1, { name: 'A', founded: '2026-10-18' }));
  assert.notEqual(sealGeometry(h1).star, sealGeometry(h2).star);
  assert.equal(sealGeometry(h1).points, 8);
  assert.equal(sealGeometry(h2).points, 6);
});
test('a seal needs a whole hash', () => {
  assert.throws(() => sealGeometry('abc'));
  assert.equal(sealGeometry('sha256:' + h1).hex, h1);
});
test('names are escaped in the seal', () => {
  assert.ok(!seal(h1, { name: '<b>' }).includes('<b>'));
});
