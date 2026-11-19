// Document files travel with the repository: a peer's files are taken only if
// they match their names (content addressing); everything else is left behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmp } from './helpers.js';
import { importDocuments, runner } from '../transports/radicle.js';
import { blobId } from '../library/docs/index.js';
import { RULES, classify } from '../kernel/gate.js';

test('documents: imported from a peer\'s branch only when each file matches its name', () => {
  const peer = tmp('docs-peer-'), me = tmp('docs-me-');
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  git(peer, 'init', '-q', '-b', 'main');
  const good = { type: 'version', entity: 'e-x', doc: 'notes', parent: null, by: 'p-0001', at: '2026-10-22T00:00:00.000Z', title: 'T', body: 'B', sig: 'x' };
  good.id = blobId(good);
  const bad = { ...good, body: 'tampered' };
  fs.mkdirSync(path.join(peer, 'documents', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(peer, 'documents', 'notes', `${good.id}.json`), JSON.stringify(good));
  fs.writeFileSync(path.join(peer, 'documents', 'notes', `${'0'.repeat(64)}.json`), JSON.stringify(bad));
  git(peer, 'add', '-A'); git(peer, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'docs');
  git(me, 'init', '-q', '-b', 'main'); git(me, 'remote', 'add', 'peer', peer); git(me, 'fetch', '-q', 'peer');
  assert.equal(importDocuments(runner(me), 'peer/main', me), 1);
  assert.ok(fs.existsSync(path.join(me, 'documents', 'notes', `${good.id}.json`)));
  assert.equal(importDocuments(runner(me), 'peer/main', me), 0);
  // Document files need no decision to change: the record decides who may write them.
  assert.equal(classify('documents/notes/abc.json', RULES).need, null);
});
