// Key files locked with a passphrase (cli/keyfile.js, `entity key lock`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { keys } from '../kernel/index.js';
import { lockText, unlockText, isLocked } from '../cli/keyfile.js';
import { entityOnDisk } from './helpers.js';

test('keyfile: a locked key opens only with its passphrase, and refuses tampering', async () => {
  const plain = keys.exportPrivateKey((await keys.generate()).privateKey, 'p-0001@e-test');
  const locked = lockText(plain, 'correct horse battery');
  assert.ok(isLocked(locked) && !isLocked(plain));
  assert.ok(!locked.includes(plain.split('\n')[1]), 'nothing of the key shows through');
  assert.equal(unlockText(locked, 'correct horse battery'), plain);
  assert.throws(() => unlockText(locked, 'wrong'), /wrong passphrase/);
  const lines = locked.split('\n'); const mid = lines[2]; lines[2] = mid.slice(0, 10) + (mid[10] === 'A' ? 'B' : 'A') + mid.slice(11);
  assert.throws(() => unlockText(lines.join('\n'), 'correct horse battery'));
  assert.notEqual(lockText(plain, 'x'.repeat(8)), lockText(plain, 'x'.repeat(8)), 'fresh salt each time');
});

test('keyfile: entity key lock, signing with a locked key, and unlock', async () => {
  const dir = await entityOnDisk({ preset: 'assembly', people: 1 });
  const entity = fs.readdirSync(process.env.ENTITY_KEYS).find(n => n.startsWith('e-'));
  const kf = path.join(process.env.ENTITY_KEYS, entity, 'p-0001');
  const cli = (args, env = {}) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const before = fs.readFileSync(kf, 'utf8');

  assert.match(cli(['key', 'status']), /p-0001\s+NOT locked/);
  assert.match(cli(['key', 'lock', '--as', 'p-0001'], { ENTITY_PASSPHRASE: 'a good passphrase' }), /is locked/);
  assert.ok(isLocked(fs.readFileSync(kf, 'utf8')));
  assert.equal((fs.statSync(kf).mode & 0o777).toString(8), '600');
  assert.match(cli(['key', 'status']), /p-0001\s+locked/);

  // Signing works with the passphrase, and the act is the member's.
  const out = cli(['propose', '--title', 'Signed with a locked key', '--changes', '{"entity.name":"Renamed"}', '--as', 'p-0001'], { ENTITY_PASSPHRASE: 'a good passphrase' });
  assert.match(out, /pending|signed/i);
  assert.throws(() => cli(['propose', '--title', 'Wrong passphrase', '--changes', '{"entity.name":"Again"}', '--as', 'p-0001'], { ENTITY_PASSPHRASE: 'not it' }), /wrong passphrase/);

  // Unlock gives back exactly the key that was there.
  assert.match(cli(['key', 'unlock', '--as', 'p-0001'], { ENTITY_PASSPHRASE: 'a good passphrase' }), /unlocked/);
  assert.equal(fs.readFileSync(kf, 'utf8'), before);

  // A key linked to Radicle's is never rewritten here.
  const other = path.join(path.dirname(kf), 'elsewhere'); fs.copyFileSync(kf, other);
  fs.renameSync(kf, `${kf}.real`); fs.symlinkSync(other, kf);
  assert.throws(() => cli(['key', 'lock', '--as', 'p-0001'], { ENTITY_PASSPHRASE: 'a good passphrase' }), /Radicle/);
  assert.equal(fs.readFileSync(other, 'utf8'), before);
});

test('keyfile: ENTITY_LOCK_KEYS locks new keys as they are made', async () => {
  process.env.ENTITY_LOCK_KEYS = '1'; process.env.ENTITY_PASSPHRASE = 'locked from the start';
  try {
    const dir = await entityOnDisk({ preset: 'assembly', people: 2 });
    const entity = fs.readdirSync(process.env.ENTITY_KEYS).find(n => n.startsWith('e-'));
    for (const id of ['p-0001', 'p-0002']) assert.ok(isLocked(fs.readFileSync(path.join(process.env.ENTITY_KEYS, entity, id), 'utf8')), `${id} locked`);
    assert.ok(fs.existsSync(path.join(dir, 'record', 'events.jsonl')), 'founding and joining still signed');
  } finally { delete process.env.ENTITY_LOCK_KEYS; delete process.env.ENTITY_PASSPHRASE; }
});
