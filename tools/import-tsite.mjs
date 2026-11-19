#!/usr/bin/env node
// import-tsite.mjs · start your writing folder from what tschoonover.com shows
// now (tsite's content.json): the home page, the posts and projects listed
// there, the documents, the photographs and the résumé. It writes Markdown
// files only where none exist, so running it again never overwrites your edits.
//
//   node tools/import-tsite.mjs ~/tsite/sites/tschoonover ~/site [--domain tschoonover.com]
//
// Then read through ~/site, fill in the posts' texts, and sign it all with
//   node tools/site.mjs sync ~/site
import fs from 'node:fs';
import path from 'node:path';

const [SRC, OUT] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const DOMAIN = (() => { const i = process.argv.indexOf('--domain'); return i > 0 ? process.argv[i + 1] : 'tschoonover.com'; })();
if (!SRC || !OUT) { console.log('usage: node tools/import-tsite.mjs TSITE_SITE_FOLDER WRITING_FOLDER'); process.exit(1); }
const say = (s) => console.log(`  ${s}`);
const cfile = path.join(SRC, 'content.json');
if (!fs.existsSync(cfile)) { say(`no content.json in ${SRC}: nothing to import`); process.exit(0); }
const content = JSON.parse(fs.readFileSync(cfile, 'utf8'));
const home = content.pages.find(p => p.slug === '') || content.pages[0];
const blocks = home?.blocks || [];
const of = (type) => blocks.filter(b => b.type === type);

// Old addresses: poezine.org is offline now.
const fix = (s) => typeof s !== 'string' ? s : s
  .replace(/https?:\/\/([a-z0-9-]+)\.poezine\.org/g, (m, sub) => sub === 'www' ? `https://${DOMAIN}/athenes` : `https://${sub}.${DOMAIN}`)
  .replace(/https?:\/\/(www\.)?poezine\.org\/?/g, `https://${DOMAIN}/athenes`)
  .replace(/(?<![\w./-])poezine\.org/g, `${DOMAIN}/athenes`)
  .replace(/\s*—\s*/g, ', ');
const q = (s) => JSON.stringify(fix(String(s ?? '')));
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'untitled';
const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function date(s) {
  const m = String(s || '').match(/([A-Za-z]{3,})\.?\s+(\d{4})/); if (m && MONTH[m[1].slice(0, 3).toLowerCase()]) return `${m[2]}-${String(MONTH[m[1].slice(0, 3).toLowerCase()]).padStart(2, '0')}-01`;
  const y = String(s || '').match(/\d{4}/); return y ? `${y[0]}-01-01` : new Date().toISOString().slice(0, 10);
}
let wrote = 0, kept = 0;
function put(rel, text) {
  const f = path.join(OUT, rel);
  if (fs.existsSync(f)) { kept++; return; }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); wrote++;
}
const yamlList = (name, items, fields) => items.length ? `${name}:\n${items.map(it => fields.map((k, i) => it[k] !== undefined && it[k] !== '' ? `${i === 0 ? '  - ' : '    '}${k}: ${q(it[k])}` : null).filter(Boolean).join('\n')).join('\n')}\n` : '';

fs.mkdirSync(OUT, { recursive: true });
for (const d of ['posts', 'projects', 'photos', 'images', 'sites']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// ── the cat ───────────────────────────────────────────────────────────────
let cat = '';
const catCandidates = [content.avatar, content.icon, content.cursor?.default, content.cursor?.image].filter(Boolean)
  .map(u => path.join(SRC, String(u).replace(/^\//, '')));
const findCat = (d) => { if (!fs.existsSync(d)) return null; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isFile() && /tisko/i.test(e.name) && /\.(png|gif|webp|jpe?g)$/i.test(e.name)) return f; if (e.isDirectory() && !e.name.startsWith('.') && !['projects', 'history', 'published'].includes(e.name)) { const r = findCat(f); if (r) return r; } } return null; };
const catFile = catCandidates.find(f => fs.existsSync(f)) || findCat(SRC) || findCat(path.dirname(path.dirname(SRC)));
if (catFile) { const ext = path.extname(catFile).toLowerCase(); fs.copyFileSync(catFile, path.join(OUT, `images/cat${ext}`)); cat = `images/cat${ext}`; say(`the cat: ${path.relative(SRC, catFile) || catFile}`); }
else say('the cat: not found (put the picture at images/cat.png and add "cat: images/cat.png" to profile.md)');

// ── the home page ─────────────────────────────────────────────────────────
const about = of('about')[0] || {};
const feature = of('feature')[0];
const links = of('links');
const docs = links.find(b => /document/i.test(b.title || '')) || null;
const elsewhere = links.find(b => /elsewhere|ailleurs|links/i.test(b.title || '')) || null;
const profile = [
  '---',
  `name: ${q(content.title || 'Timothy Schoonover')}`,
  content.subtitle ? `sub: ${q(content.subtitle)}` : null,
  content.description ? `description: ${q(content.description)}` : null,
  about.lede ? `lede: ${q(about.lede)}` : null, about.lede_fr ? `lede_fr: ${q(about.lede_fr)}` : null,
  about.text ? `more: ${q(about.text)}` : null, about.text_fr ? `more_fr: ${q(about.text_fr)}` : null,
  yamlList('lately', (about.now || []).map(x => ({ title: x.title, title_fr: x.title_fr, sub: x.sub, sub_fr: x.sub_fr })), ['title', 'title_fr', 'sub', 'sub_fr']).trimEnd() || null,
  (about.reading || []).length ? `reading:\n${about.reading.map(r => `  - ${q(r.text || r)}`).join('\n')}` : null,
  about.contact ? `contact: ${q(about.contact)}` : null, about.contact_fr ? `contact_fr: ${q(about.contact_fr)}` : null,
  feature ? `building:\n${['kicker', 'kicker_fr', 'title', 'title_fr', 'text', 'text_fr', 'url', 'button', 'button_fr'].filter(k => feature[k]).map(k => `  ${k}: ${q(k === 'url' ? fix(feature[k]) : feature[k])}`).join('\n')}` : null,
  docs ? yamlList('documents', docs.items || [], ['label', 'url', 'note']).trimEnd() : null,
  elsewhere ? yamlList('elsewhere', (elsewhere.items || []).filter(x => !/poezine/.test(x.url || '')), ['label', 'url']).trimEnd() : null,
  content.footer ? `footer: ${q(content.footer.replace(/\s*Also:.*$/, ''))}` : 'footer: "Made by hand, served from a Raspberry Pi in my room at a housing co-op."',
  content.footer_fr ? `footer_fr: ${q(content.footer_fr.replace(/\s*Voir aussi.*$/, ''))}` : null,
  cat ? `cat: ${cat}` : null,
  '---', '',
].filter(x => x !== null).join('\n');
put('profile.md', profile);

// ── posts ─────────────────────────────────────────────────────────────────
for (const b of of('posts')) for (const it of b.items || []) {
  const slug = slugify(it.title), form = /essay|essai/i.test(it.tag || '') ? 'essay' : /paper|article/i.test(it.tag || '') ? 'paper' : /note/i.test(it.tag || '') ? 'note' : 'post';
  const link = it.url ? fix(it.url) : '';
  const body = link ? `${fix(it.excerpt || '')}\n\n[Read it here](${link}).` : `${fix(it.excerpt || '')}\n\n<!-- Paste the full text here, then set status: published. -->`;
  put(`posts/${slug}.md`, `---\ntitle: ${q(it.title)}\ndate: ${date(it.date)}\nform: ${form}\nsummary: ${q(it.excerpt || '')}\nstatus: ${link ? 'published' : 'draft'}\n---\n\n${body}\n`);
  if (it.title_fr) put(`posts/${slug}-fr.md`, `---\ntitle: ${q(it.title_fr)}\ndate: ${date(it.date)}\nform: ${form}\nlang: fr\nof: ${slug}\nsummary: ${q(it.excerpt_fr || '')}\nstatus: draft\n---\n\n${fix(it.excerpt_fr || '')}\n`);
}

// ── projects: the work list, then project folders not listed there ────────
const seen = new Set(); let order = 0;
for (const b of of('work')) for (const it of b.items || []) {
  const url = fix(it.url || ''), slug = slugify(it.title);
  const sub = url.match(new RegExp(`^https?://([a-z0-9-]+)\\.${DOMAIN.replace(/\./g, '\\.')}`));
  const type = /athenes|entity/i.test(url) || /entity|athens/i.test(it.title) ? 'app' : sub ? 'hosted' : /^\/civil|archive/i.test(url + (it.status || '')) ? 'archive' : 'link';
  if (sub) seen.add(sub[1]);
  put(`projects/${sub ? sub[1] : slug}.md`, `---\nname: ${q(/^entity$/i.test(it.title) ? 'Athens' : it.title)}\nsummary: ${q(it.text || '')}\ntype: ${type}\n${url ? `address: ${q(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}\n` : ''}status: ${q(it.status || '')}\n${it.live ? 'live: true\n' : ''}order: ${order += 10}\n---\n`);
}
const pdir = path.join(SRC, 'projects');
for (const name of fs.existsSync(pdir) ? fs.readdirSync(pdir).sort() : []) {
  if (seen.has(name) || name.startsWith('.') || !fs.statSync(path.join(pdir, name)).isDirectory()) continue;
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(pdir, name, 'project.json'), 'utf8')); } catch { /* none */ }
  if (meta.hidden) continue;
  put(`projects/${name}.md`, `---\nname: ${q(meta.title || name)}\nsummary: ${q(meta.description || 'Class work and data.')}\ntype: hosted\nstatus: "Live"\norder: ${order += 10}\n---\n`);
}

// ── photographs ───────────────────────────────────────────────────────────
const caps = [];
let n = 0;
for (const b of of('gallery')) for (const im of b.images || []) {
  const src = path.join(SRC, String(im.src || im.url || '').replace(/^\//, ''));
  if (!fs.existsSync(src)) continue;
  const name = `${String(++n).padStart(3, '0')}-${slugify(path.basename(src, path.extname(src)))}${path.extname(src).toLowerCase()}`;
  if (!fs.existsSync(path.join(OUT, 'photos', name))) { fs.copyFileSync(src, path.join(OUT, 'photos', name)); wrote++; }
  if (im.caption || im.alt) caps.push(`${name}: ${q(im.caption || im.alt)}`);
}
put('photos/captions.yml', `# one line per picture:  file.jpg: "Caption · Place"\n${caps.join('\n')}\n`);

// ── the résumé ────────────────────────────────────────────────────────────
const rb = of('resume')[0];
if (rb) {
  const out = ['# Résumé', ''];
  for (const col of rb.columns || []) for (const s of col.sections || []) {
    if (/full|complet|pdf/i.test(s.label || '')) continue;
    out.push(`## ${s.label}`, '');
    for (const e of s.entries || []) { out.push(`### ${e.role} | ${e.date || ''}`.trim(), e.org || '', ''); }
    if (s.tags) out.push(String(s.tags).split(',').map(x => x.trim()).join(', '), '');
    if (s.text) out.push(fix(s.text).replace(/ · /g, ', '), '');
  }
  put('resume.md', out.join('\n'));
}
console.log(`${wrote} file(s) written to ${OUT}${kept ? `, ${kept} left as you had them` : ''}. Read through them, then sign: node tools/site.mjs sync ${OUT}`);
