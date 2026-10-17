// Radicle: runs the two-peer scenario against real nodes when Radicle is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const bin = process.env.RADICLE_BIN || '/opt/radicle/bin';
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
const has = (c) => env.PATH.split(path.delimiter).some(d => fs.existsSync(path.join(d, c)));
const ready = has('rad') && has('radicle-node') && has('git-remote-rad');

test('two peers over Radicle: publish, clone, join, decide, adopt, diverge, merge, converge',
  { skip: !ready && 'Radicle (rad, radicle-node, git-remote-rad) is not installed', timeout: 300000 }, () => {
    const out = execFileSync('bash', [path.join(ROOT, 'test/radicle/two-peers.sh')], { env: { ...env, RADICLE_BIN: bin }, encoding: 'utf8', timeout: 290000 });
    assert.match(out, /1 records verified by replay/);
    assert.match(out, /pull .*peer-\w+ .*1 act\(s\) now pending/, 'an applicant is followed before they are registered');
    assert.match(out, /published to radicle/, 'settling published by itself');
    assert.match(out, /fast-forwarded \(\+1 records\)/, 'bob received what alice only settled');
    assert.match(out, /REFUSED: law\/statutes\/public-meetings\.md requires a decision under "organic"/);
    assert.match(out, /ADOPTED: permitted by decision d-\w+ under "organic"\. Approved by p-0001, p-0002/);
    assert.match(out, /DIVERGED at record \d+\. Nothing was folded in/);
    assert.match(out, /CONVERGED: RECORDS BYTE-IDENTICAL/);
    assert.equal((out.match(/^Verified\.$/gm) || []).length >= 3, true);
    assert.match(out, /TWO-PEERS OK/);
  });
