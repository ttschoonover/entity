// Pictures for texts: cli/media.js keeps them under their own hash, and the
// letters renderer sets pictures, tables and code from Markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as media from '../cli/media.js';
import { body } from '../library/letters/render.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a20000000049454e44ae426082', 'hex');

test('a picture is kept under its hash, once, and checked against its name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  const a = media.keep(dir, PNG);
  assert.match(a.path, /^media\/[a-f0-9]{32}\.png$/);
  assert.equal(a.existed, false);
  assert.equal(media.keep(dir, PNG).existed, true);
  assert.deepEqual(media.check(dir).bad, []);
  fs.writeFileSync(path.join(dir, a.path), Buffer.concat([PNG, Buffer.from('x')]));
  assert.equal(media.check(dir).bad[0].why, 'its content does not match its name');
});

test('only real pictures are kept, whatever they are called', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  assert.throws(() => media.keep(dir, Buffer.from('<svg onload="x()"></svg>')), /not a JPEG, PNG, WebP or GIF/);
  assert.throws(() => media.keep(dir, Buffer.alloc(0)), /no picture/);
  assert.equal(media.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), '.jpg');
});

test('the pictures a text shows are found, with their captions', () => {
  const got = media.imagesIn('a\n![The hall](media/0123456789abcdef0123456789abcdef.jpg "Built 1906")\n![b](https://x.org/b.png)');
  assert.deepEqual(got.map(g => [g.src, g.caption]), [['media/0123456789abcdef0123456789abcdef.jpg', 'Built 1906'], ['https://x.org/b.png', '']]);
});

test('letters set pictures, tables and code, and describe a picture they cannot print', () => {
  const t = body('![House](media/a.jpg "The house")\n\n![Gone](https://x/y.jpg)\n\n| A | B |\n|---|---|\n| 1 | **2** |\n\n```\nx_1 & y\n```', { image: (s) => (s === 'media/a.jpg' ? 'a.jpg' : null) });
  assert.match(t, /\\includegraphics\[[^\]]+\]\{a\.jpg\}/);
  assert.match(t, /\[Picture: Gone\]/);
  assert.match(t, /\\begin\{tabularx\}.*\\toprule\nA & B \\\\\n\\midrule\n1 & \\textbf\{2\} \\\\/s);
  assert.match(t, /x\\_1 \\& y/);
});
