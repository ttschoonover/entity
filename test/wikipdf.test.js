// Wiki pages as LaTeX (cli/wikipdf.js): the Markdown they are written in, set
// safely, and compiled when this machine has pdflatex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markdownTex } from '../cli/wikipdf.js';

test('wiki pdf: Markdown becomes LaTeX, and nothing in a page can run LaTeX of its own', () => {
  const files = {};
  const t = markdownTex([
    'Intro **bold** *it* `a_b` [site](https://example.org/x_y%20z) and [page](#/wiki/workshift). 50% & #1 $5 \\input{/etc/passwd} ✓',
    '', '## Part', '1. one', '2. two', '', '- a', '- b', '', '> quoted', '',
    '| A | B |', '|---|---|', '| 1 | 2 |', '', '```', 'raw \\end{verbatim}\\input{x}', '```', '', '![a picture](https://example.org/p.jpg "A caption")',
  ].join('\n'), { files, depth: 0 });
  assert.match(t, /\\textbf\{bold\}/); assert.match(t, /\\emph\{it\}/); assert.match(t, /\\texttt\{a\\_b\}/);
  assert.match(t, /\\href\{https:\/\/example\.org\/x_y\\%20z\}\{site\}\\footnote/);
  assert.match(t, /50\\% \\& \\#1 \\\$5 \\textbackslash\{\}input\\\{\/etc\/passwd\\\} \?/, 'every special character escaped');
  assert.match(t, /\\section\*\{Part\}/);
  assert.match(t, /\\begin\{enumerate\}[\s\S]*\\item one/); assert.match(t, /\\begin\{itemize\}[\s\S]*\\item a/);
  assert.match(t, /\\begin\{quote\}/); assert.match(t, /\\begin\{tabularx\}/);
  assert.equal((t.match(/\\end\{verbatim\}/g) || []).length, 1, 'a page cannot close the verbatim block itself');
  assert.match(t, /\[Picture: A caption\]/, 'a picture from elsewhere is named, not fetched');
  assert.deepEqual(Object.keys(files), []);
});

const hasTex = (() => { try { execFileSync('pdflatex', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } })();
test('wiki pdf: a page compiles', { skip: !hasTex && 'pdflatex is not installed' }, async () => {
  const { pageTex } = await import('../cli/wikipdf.js');
  const { pdf } = await import('../cli/documents.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikipdf-'));
  const e = { dir, params: { value: () => 'Test House' }, state: { participants: { tim: { name: 'Tim' } }, m: { wiki: { pages: { home: { versions: [
    { n: 1, by: 'tim', at: '2026-11-23T00:00:00.000Z', title: 'Home & hearth', body: '## Rules\n| Day | Shift |\n|---|---|\n| Mon | dishes |\n\nLothlórien — “quotes” 中文' }] } } } } } };
  const out = pdf(e, pageTex(e, 'home', { hub: 'Lothlórien Unofficial Minihub' }));
  assert.equal(out.subarray(0, 5).toString(), '%PDF-');
});
