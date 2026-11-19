// refresh-website.mjs · bring one entity's website up to the kit and site in
// this copy of the code, keeping any file you changed by hand.
//
//   node tools/refresh-website.mjs ENTITY_FOLDER [NEW_CODE_FOLDER]
//
// A kit website (found-common.sh, install_site) is sites/kit with its site.css
// renamed kit.css, overlaid by sites/NAME. Which NAME is found by matching the
// website's config.js against the entity's own copy of sites/. Then, file by
// file, three ways: the copy the website was built from (the entity's sites/),
// the website as it is now, and the new code. A file still as it was built is
// replaced; a file you edited is kept, and the new one is written beside it as
// FILE.new for you to compare. Afterwards the entity's sites/ is the new copy,
// so the next refresh compares against what is now installed.
import fs from 'node:fs';
import path from 'node:path';

const [dir, srcArg] = process.argv.slice(2);
if (!dir) { console.log('usage: node tools/refresh-website.mjs ENTITY_FOLDER [NEW_CODE_FOLDER]'); process.exit(1); }
const src = srcArg || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const say = (s) => console.log(`  ${s}`);

let site = 'website';
try { site = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8')).site || 'website'; } catch { /* default */ }
const web = path.join(dir, site);
if (!fs.existsSync(path.join(web, 'config.js'))) { say(`no kit website in ${site}/; left alone`); process.exit(0); }

const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
const same = (a, b) => a && b && a.equals(b);
const walk = (root, rel = '') => {
  const d = path.join(root, rel);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(root, path.join(rel, e.name)) : [path.join(rel, e.name)]));
};
// The files of a kit website built from KIT and SITE: website path → source file.
const layout = (sites, name) => {
  const m = new Map();
  for (const r of walk(path.join(sites, 'kit'))) m.set(r === 'site.css' ? 'kit.css' : r, path.join(sites, 'kit', r));
  for (const r of walk(path.join(sites, name))) m.set(r, path.join(sites, name, r));
  return m;
};

const mine = read(path.join(web, 'config.js'));
const names = (sites) => (fs.existsSync(sites) ? fs.readdirSync(sites).filter(n => n !== 'kit' && fs.existsSync(path.join(sites, n, 'config.js'))) : []);
let name = names(path.join(dir, 'sites')).find(n => same(read(path.join(dir, 'sites', n, 'config.js')), mine))
  || names(path.join(src, 'sites')).find(n => same(read(path.join(src, 'sites', n, 'config.js')), mine));
if (!name) { say(`${site}/ was not built from a kit site this code knows (or its config.js was edited); left alone`); process.exit(0); }
if (!fs.existsSync(path.join(src, 'sites', name))) { say(`the new code has no sites/${name}; left alone`); process.exit(0); }

const before = layout(path.join(dir, 'sites'), name), after = layout(path.join(src, 'sites'), name);
let replaced = 0, added = 0, kept = [];
for (const [rel, from] of after) {
  const now = read(path.join(web, rel)), next = read(from), was = before.has(rel) ? read(before.get(rel)) : null;
  if (same(now, next)) continue;
  if (now === null || same(now, was)) {
    fs.mkdirSync(path.dirname(path.join(web, rel)), { recursive: true });
    fs.writeFileSync(path.join(web, rel), next);
    now === null ? added++ : replaced++;
  } else {
    fs.writeFileSync(path.join(web, `${rel}.new`), next);
    kept.push(rel);
  }
}
fs.rmSync(path.join(dir, 'sites'), { recursive: true, force: true });
fs.cpSync(path.join(src, 'sites'), path.join(dir, 'sites'), { recursive: true });
say(`${site}/ (the ${name} site): ${replaced} file(s) updated, ${added} added${kept.length ? `; your edits kept in ${kept.join(', ')} (the new versions are beside them as .new)` : ''}`);
