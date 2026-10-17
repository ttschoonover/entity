// Builds the static site. It copies files and writes one JSON island into the
// HTML template. It never writes JavaScript: a builder that concatenates code
// will one day emit a syntax error and the page will fail silently.

import fs from 'node:fs';
import path from 'node:path';
import { paramsOf } from '../kernel/state.js';

export function island(state, { node = false, installed = [], look = null, colour = null } = {}) {
  const p = paramsOf(state);
  return { id: state.entity.id, name: p.value('entity.name'), modules: p.value('entity.modules'), installed, node, ...(look ? { look } : {}), ...(colour ? { colour } : {}) };
}

// The law as the page lists it: every .md under law/, except READMEs.
export function lawIndex(dir) {
  const root = path.join(dir, 'law'), out = [];
  const walk = (d, rel) => { if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (fs.statSync(path.join(d, n)).isDirectory()) walk(path.join(d, n), r);
    else if (n.endsWith('.md') && n !== 'README.md') out.push(r);
  } };
  walk(root, '');
  return out;
}

// JSON inside <script type="application/json">: only "<" needs escaping.
export function renderIndex(template, data) {
  return template.replace('__ENTITY__', JSON.stringify(data).replace(/</g, '\\u003c'));
}

function copyDir(from, to, filter = () => true) {
  if (!fs.existsSync(from)) return;
  for (const n of fs.readdirSync(from)) {
    const s = path.join(from, n), d = path.join(to, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter);
    else if (filter(s)) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

// Only what the browser needs: kernel modules that do not touch the disk.
const BROWSER_SAFE = (f) => (f.endsWith('.js') || f.endsWith('parameters.yml')) && !/[\/](store|compose)\.js$/.test(f) && !/tests?\.js$/.test(f);

export function build(dir, out, state) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const tpl = fs.readFileSync(path.join(dir, 'interface', 'index.html'), 'utf8');
  const installed = fs.readdirSync(path.join(dir, 'modules')).filter(n => fs.existsSync(path.join(dir, 'modules', n, 'index.js'))).sort();
  fs.writeFileSync(path.join(out, 'index.html'), renderIndex(tpl, island(state, { installed })));
  // The site mirrors the repository's layout, so every import resolves the
  // same way in both, and the page runs exactly the files the engine runs.
  fs.mkdirSync(path.join(out, 'interface'), { recursive: true });
  fs.copyFileSync(path.join(dir, 'interface', 'style.css'), path.join(out, 'interface', 'style.css'));
  copyDir(path.join(dir, 'interface', 'js'), path.join(out, 'interface', 'js'));
  copyDir(path.join(dir, 'kernel'), path.join(out, 'kernel'), BROWSER_SAFE);
  copyDir(path.join(dir, 'modules'), path.join(out, 'modules'), BROWSER_SAFE);
  copyDir(path.join(dir, 'record'), path.join(out, 'record'), (f) => !/before-repair|\.tmp-/.test(f));
  copyDir(path.join(dir, 'law'), path.join(out, 'law'), (f) => f.endsWith('.md'));
  fs.mkdirSync(path.join(out, 'law'), { recursive: true });
  fs.writeFileSync(path.join(out, 'law', 'index.json'), JSON.stringify(lawIndex(dir)) + '\n');
  return out;
}
