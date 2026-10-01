import fs from 'node:fs';
import path from 'node:path';
import { entityDir, out, refuse } from '../context.js';
import { tarGz, listTarGz } from '../tar.js';

// What a distribution is: the code, the law templates, the presets.
// Never the state. An archive holding record/ or participants/ — even empty —
// extracted over a running entity destroys its records. This has happened.
export const CODE = ['kernel', 'modules', 'interface', 'cli', 'transports', 'hardware', 'presets', 'law', 'test', 'docs', 'library.yml', 'package.json', 'README.md', 'LICENSE'];
export const NEVER = [/^record(\/|$)/, /^participants(\/|$)/, /^pending(\/|$)/, /^settled(\/|$)/, /^refused(\/|$)/,
  /^site(\/|$)/, /^node\.json$/, /^parameters\.yml$/, /\.bundle\.json$/, /(^|\/)\.git(\/|$)/, /(^|\/)node_modules(\/|$)/, /\.tmp-\d+$/, /^\.entity(\/|$)/, /^\.staged(\/|$)/];

export function walk(root, rel = '') {
  const d = path.join(root, rel);
  if (!fs.existsSync(d)) return [];
  if (fs.statSync(d).isFile()) return [rel];
  return fs.readdirSync(d).sort().flatMap(n => walk(root, rel ? `${rel}/${n}` : n));
}

export function codeFiles(root) {
  return CODE.flatMap(c => walk(root, c)).filter(f => !NEVER.some(re => re.test(f)));
}

export function copyCode(from, to) {
  for (const f of codeFiles(from)) {
    const dst = path.join(to, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(from, f), dst);
  }
}

// The module pack: every module in library/, as entity-modules/NAME/…
// Publish it as one repository; sources then read github:YOU/entity-modules/NAME@COMMIT.
async function pack(dir, opt) {
  const files = walk(dir, 'library').filter(f => !NEVER.some(re => re.test(f)));
  if (!files.length) refuse('no library/ here to pack');
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  const buf = tarGz(files.map(f => ({ name: `entity-modules/${f.slice('library/'.length)}`, data: fs.readFileSync(path.join(dir, f)) })));
  const target = opt.out || `entity-modules-${version}.tar.gz`;
  fs.writeFileSync(target, buf);
  out(`${target}: ${files.length} files, ${new Set(files.map(f => f.split('/')).filter(p => p.length > 2).map(p => p[1])).size} modules.`);
}

export async function dist({ opt }) {
  const dir = entityDir(opt);
  if (opt.pack) return pack(dir, opt);
  const files = codeFiles(dir);
  const bad = files.filter(f => NEVER.some(re => re.test(f)));
  if (bad.length) refuse(`refusing to package state: ${bad.join(', ')}`);
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  const name = `entity-${version}`;
  const buf = tarGz(files.map(f => {
    const st = fs.statSync(path.join(dir, f));
    return { name: `${name}/${f}`, data: fs.readFileSync(path.join(dir, f)), mode: st.mode & 0o111 ? 0o755 : 0o644 };
  }));
  const target = opt.out || `${name}.tar.gz`;
  fs.writeFileSync(target, buf);
  const listed = listTarGz(buf);
  const leaked = listed.map(n => n.slice(name.length + 1)).filter(n => NEVER.some(re => re.test(n)));
  if (leaked.length) { fs.unlinkSync(target); refuse(`archive would contain state: ${leaked.join(', ')}`); }
  out(`${target}: ${listed.length} files, no state directories.`);
}
