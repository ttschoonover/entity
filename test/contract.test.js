// The module contract: what every module in the pack must ship, and what the
// repository must not hide from git. A module whose parameters.yml was never
// committed passes on its author's machine and fails on every fresh clone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { yaml, PARAMETER_TYPES } from '../kernel/index.js';
import { ROOT } from './helpers.js';

const LIB = path.join(ROOT, 'library');
const modules = fs.readdirSync(LIB, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const TYPES = new Set(PARAMETER_TYPES);
// Every parameter is shown in the settings screen from these fields alone.
const NEEDS = ['value', 'type', 'changed_by', 'group', 'describe'];

test('contract: every module ships index.js and parameters.yml', () => {
  const missing = [];
  for (const m of modules) for (const f of ['index.js', 'parameters.yml']) {
    if (!fs.existsSync(path.join(LIB, m, f))) missing.push(`${m}/${f}`);
  }
  assert.deepEqual(missing, [], `missing from library/: ${missing.join(', ')}`);
});

test('contract: every parameter is fully described, so a screen can be drawn from it', () => {
  const files = [path.join(ROOT, 'kernel/parameters.base.yml'),
    ...modules.map(m => path.join(LIB, m, 'parameters.yml')).filter(f => fs.existsSync(f))];
  const problems = [];
  for (const f of files) {
    const doc = yaml.parse(fs.readFileSync(f, 'utf8')) || {};
    for (const [key, def] of Object.entries(doc.parameters || {})) {
      const where = `${path.relative(ROOT, f)}: ${key}`;
      for (const n of NEEDS) if (def?.[n] === undefined) problems.push(`${where} lacks ${n}`);
      if (def?.type && !TYPES.has(def.type)) problems.push(`${where} has unknown type "${def.type}"`);
      if (typeof def?.describe === 'string' && !def.describe.trim()) problems.push(`${where} has an empty describe`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('contract: git ignores no file a module or site needs', (t) => {
  let inRepo = false;
  try { inRepo = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true'; }
  catch { /* git absent, or not a checkout: e.g. a distribution archive */ }
  if (!inRepo) return t.skip('not a git checkout');
  const paths = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else paths.push(path.relative(ROOT, p));
    }
  };
  for (const d of ['library', 'modules', 'kernel', 'interface', 'presets']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  let ignored = '';
  try {
    ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: paths.join('\n'), stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  } catch (e) { ignored = e.stdout?.toString() || ''; } // exit 1 means none ignored
  const hit = ignored.split('\n').filter(Boolean);
  assert.deepEqual(hit, [], `ignored by .gitignore but needed: ${hit.join(', ')}`);
});
