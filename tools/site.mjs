#!/usr/bin/env node
// site.mjs · write your website as a folder of Markdown, sign what changed.
//
//   node tools/site.mjs sync FOLDER --entity DIR --as ID     sign every change in FOLDER
//   node tools/site.mjs new post "A title" FOLDER            start a post (posts/a-title.md)
//   node tools/site.mjs new project "A name" FOLDER          start a project
//   node tools/site.mjs status FOLDER --entity DIR           what would change, without signing
//   node tools/site.mjs init FOLDER                          a folder to start from
//   node tools/site.mjs watch FOLDER --entity DIR --as ID    sync whenever a file in FOLDER changes
//
// The folder:
//   profile.md            the home page: name, sub, lede, lately, reading, contact,
//                         elsewhere, documents, building, footer (front matter only)
//   resume.md             your résumé in Markdown; "### Role | dates" for each entry
//   posts/SLUG.md         front matter: title, date, form (essay | note | paper | post),
//                         tags, summary, status (published | draft | hidden), lang, of
//   projects/SLUG.md      front matter: name, summary, type (hosted | app | link | archive),
//                         address, status, live, order, cover, folder; the text is the write-up
//                         folder: a directory of a static site (relative to the .md),
//                         published at SLUG.<your domain>
//   photos/               pictures, in the order of their names; captions.yml gives
//                         each a caption:  "001-telegraph.jpg: Telegraph Avenue · Berkeley"
//   images/               pictures used in posts, e.g. ![The kitchen](images/kitchen.jpg)
//
// Pictures are kept in the entity's media/ folder under their own hash, and the
// text that is signed points at them there. Nothing is ever deleted from the
// record: removing a post's file does nothing; set status: hidden to take it down.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--dry'].includes(argv[i - 1])));
const say = (s) => console.log(`  ${s}`);
const die = (s) => { console.error(s); process.exit(1); };
const { parse: yaml } = await import(path.join(HERE, '..', 'kernel', 'yaml.js'));

// ── reading the folder ───────────────────────────────────────────────────
function frontMatter(text) {
  const m = String(text).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: String(text).trim() };
  let meta;
  try { meta = yaml(m[1]) || {}; } catch (x) { throw new Error(`the front matter does not parse: ${x.message}`); }
  return { meta, body: m[2].replace(/^\s*\n/, '').replace(/\s+$/, '') };
}
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'untitled';
const dateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const list = (v) => (v === undefined || v === null || v === '' ? undefined : Array.isArray(v) ? v.map(String) : String(v).split(',').map(s => s.trim()).filter(Boolean));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ── signing, through the entity's own command line ───────────────────────
function makeSigner(DIR, ME, dry) {
  const cli = path.join(DIR, 'cli', 'index.js');
  if (!fs.existsSync(cli)) die(`No entity at ${DIR}`);
  const { keep } = { keep: null };
  return {
    async media(file) {
      const { keep } = await import(path.join(DIR, 'cli', 'media.js'));
      let buf = fs.readFileSync(file);
      // Over 8 MB, a camera picture is made smaller first (ImageMagick), as the record keeps pictures up to 8 MB.
      if (buf.length > 7.5 * 1024 * 1024) {
        const r = spawnSync('convert', [file + '[0]', '-auto-orient', '-resize', '3200x3200>', '-quality', '86', 'jpg:-'], { maxBuffer: 64 << 20 });
        if (r.status !== 0 || !r.stdout?.length) throw new Error(`${path.basename(file)} is over 8 MB; install ImageMagick (sudo apt install imagemagick) or make it smaller`);
        buf = r.stdout;
      }
      return dry ? { path: `media/${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}.jpg` } : keep(DIR, buf);
    },
    act(kind, fields, what) {
      if (dry) { say(`would sign ${kind}: ${what}`); return true; }
      const json = JSON.stringify(fields);
      if (json.length > 120000) { say(`${what}: too long to sign in one act (${json.length} characters; the limit is 120,000)`); return false; }
      try {
        const out = execFileSync('node', [cli, 'act', kind, '--as', ME, '--json', json, '--settle'], { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        if (/(^|\s)0 settled/.test(out) || (/refused/.test(out) && !/\b0 refused/.test(out))) { say(`${what}: refused: ${(out.match(/refused[^\n]*:\s*(.*)/) || [])[1] || out.trim().split('\n').pop()}`); return false; }
        say(`signed ${what}`); return true;
      } catch (x) { say(`${what}: ${(x.stderr || x.message).toString().trim().split('\n').pop()}`); return false; }
    },
  };
}

async function state(DIR) {
  const store = await import(path.join(DIR, 'kernel', 'store.js'));
  const e = await store.open(DIR);
  if (e.foldError) die(`the record cannot be read: ${e.foldError}`);
  return e.state;
}
const latest = (d) => d?.versions?.[d.versions.length - 1] || null;
const strip = (v) => { if (!v) return null; const { n, by, at, note, ...rest } = v; return rest; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Compare ignoring key order: the record keeps the order the act was signed in.
const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sortKeys(o[k])])) : o;
const equal = (a, b) => same(sortKeys(a), sortKeys(b));

// Pictures in a text: local paths become media/… paths, kept in the entity.
async function withMedia(signer, body, baseDir) {
  let out = body;
  for (const m of [...body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g)]) {
    const src = m[2];
    if (/^(https?:|data:|media\/)/.test(src)) continue;
    const f = path.resolve(baseDir, src);
    if (!fs.existsSync(f)) { say(`a picture is missing: ${src}`); continue; }
    const k = await signer.media(f);
    out = out.split(`](${src}`).join(`](${k.path}`);
  }
  return out;
}

// A hosted project's folder, packed so the same files always give the same hash.
function bundle(DIR, folder, dry) {
  const files = [];
  const walk = (d, rel = '') => { for (const x of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { if (x.name.startsWith('.')) continue; const r = path.join(rel, x.name); if (x.isDirectory()) walk(path.join(d, x.name), r); else if (x.isFile()) files.push(r); } };
  walk(folder);
  if (!files.length) throw new Error(`${folder} is empty`);
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(f + '\0'); h.update(fs.readFileSync(path.join(folder, f))); h.update('\0'); }
  const hash = h.digest('hex'), rel = `bundles/${hash}.tgz`, dest = path.join(DIR, rel);
  if (!dry && !fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = spawnSync('tar', ['czf', dest + '.tmp', '-C', folder, '--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=@0', ...files]);
    if (r.status !== 0) throw new Error(`could not pack ${folder}: ${r.stderr}`);
    fs.renameSync(dest + '.tmp', dest);
  }
  return { path: rel, hash, files: files.length };
}

// ── sync ─────────────────────────────────────────────────────────────────
async function sync(FOLDER, DIR, ME, dry) {
  if (!fs.existsSync(FOLDER)) die(`No folder at ${FOLDER}. Make one with: node tools/site.mjs init ${FOLDER}`);
  const st = await state(DIR), s = st.m.site || { posts: {}, projects: {}, photos: {}, resume: { versions: [] }, profile: { versions: [] } };
  if (!st.participants[ME]) die(`${ME} is not an author of ${st.entity?.name || DIR}`);
  const signer = makeSigner(DIR, ME, dry);
  let n = 0, problems = 0;
  const count = (ok) => { ok ? n++ : problems++; };

  // The home page
  const pf = path.join(FOLDER, 'profile.md');
  if (fs.existsSync(pf)) {
    const { meta } = frontMatter(fs.readFileSync(pf, 'utf8'));
    if (meta.cat && !String(meta.cat).startsWith('media/')) { const f = path.resolve(FOLDER, meta.cat); if (fs.existsSync(f)) meta.cat = (await signer.media(f)).path; else { say(`the cat picture is missing: ${meta.cat}`); delete meta.cat; } }
    const cur = latest(s.profile)?.profile;
    if (!equal(cur, meta)) count(signer.act('site.profile', { base: latest(s.profile)?.n || 0, profile: meta }, 'the home page'));
  }

  // The résumé
  const rf = path.join(FOLDER, 'resume.md');
  if (fs.existsSync(rf)) {
    const body = await withMedia(signer, frontMatter(fs.readFileSync(rf, 'utf8')).body, FOLDER);
    if (latest(s.resume)?.body !== body) count(signer.act('site.resume', { body, base: latest(s.resume)?.n || 0 }, 'the résumé'));
  }

  // Posts
  const pd = path.join(FOLDER, 'posts');
  for (const f of fs.existsSync(pd) ? fs.readdirSync(pd).filter(x => x.endsWith('.md')).sort() : []) {
    try {
      const { meta, body: raw } = frontMatter(fs.readFileSync(path.join(pd, f), 'utf8'));
      const slug = meta.slug || f.replace(/\.md$/, '');
      if (!meta.title) { say(`posts/${f}: needs a title in its front matter`); problems++; continue; }
      if (!meta.date) { say(`posts/${f}: needs a date (YYYY-MM-DD)`); problems++; continue; }
      const body = await withMedia(signer, raw, pd);
      const fields = clean({ slug, title: String(meta.title), body, date: dateStr(meta.date), form: meta.form || meta.kind, tags: list(meta.tags), lang: meta.lang, of: meta.of, summary: meta.summary, status: meta.status });
      const doc = s.posts[slug], cur = strip(latest(doc));
      if (equal(cur, fields)) continue;
      count(signer.act('site.post', { ...fields, base: latest(doc)?.n || 0, ...(meta.note ? { note: String(meta.note) } : {}) }, `${doc ? 'a new version of' : 'the post'} “${fields.title}”`));
    } catch (x) { say(`posts/${f}: ${x.message}`); problems++; }
  }

  // Projects
  const jd = path.join(FOLDER, 'projects');
  for (const f of fs.existsSync(jd) ? fs.readdirSync(jd).filter(x => x.endsWith('.md')).sort() : []) {
    try {
      const { meta, body: raw } = frontMatter(fs.readFileSync(path.join(jd, f), 'utf8'));
      const slug = meta.slug || f.replace(/\.md$/, '');
      if (!meta.name || !meta.summary) { say(`projects/${f}: needs a name and a summary`); problems++; continue; }
      const body = raw ? await withMedia(signer, raw, jd) : undefined;
      let cover, b;
      if (meta.cover) { const cf = path.resolve(jd, meta.cover); if (fs.existsSync(cf)) cover = (await signer.media(cf)).path; else say(`projects/${f}: the cover is missing: ${meta.cover}`); }
      if (meta.folder) { const dir = path.resolve(jd, meta.folder); if (fs.existsSync(dir)) { const k = bundle(DIR, dir, dry); b = { path: k.path, hash: k.hash }; } else say(`projects/${f}: the folder is missing: ${meta.folder}`); }
      const fields = clean({ slug, name: String(meta.name), summary: String(meta.summary), type: meta.type, address: meta.address, status: meta.status, live: typeof meta.live === 'boolean' ? meta.live : undefined, body, cover, bundle: b, order: Number.isInteger(meta.order) ? meta.order : undefined, hidden: meta.hidden === true ? true : undefined });
      const doc = s.projects[slug], cur = strip(latest(doc));
      if (equal(cur, fields)) continue;
      count(signer.act('site.project', { ...fields, base: latest(doc)?.n || 0 }, `${doc ? 'a new version of' : 'the project'} “${fields.name}”`));
    } catch (x) { say(`projects/${f}: ${x.message}`); problems++; }
  }

  // Photographs
  const phd = path.join(FOLDER, 'photos');
  if (fs.existsSync(phd)) {
    let caps = {};
    const cf = ['captions.yml', 'captions.yaml'].map(x => path.join(phd, x)).find(fs.existsSync);
    if (cf) { try { caps = yaml(fs.readFileSync(cf, 'utf8')) || {}; } catch (x) { say(`photos/${path.basename(cf)}: ${x.message}`); } }
    const pics = fs.readdirSync(phd).filter(x => /\.(jpe?g|png|webp|gif)$/i.test(x)).sort();
    let order = 0;
    for (const f of pics) {
      order += 10;
      const id = slugify(f.replace(/\.[^.]+$/, ''));
      const c = caps[f];
      const [caption, place] = typeof c === 'string' ? c.split(' · ').map(x => x.trim()) : [c?.caption, c?.place];
      const k = await signer.media(path.join(phd, f));
      const fields = clean({ id, src: k.path, caption, place, date: c?.date ? dateStr(c.date) : undefined, order });
      const cur = s.photos[id] ? (({ by, at, created, ...rest }) => rest)(s.photos[id]) : null;
      if (equal(cur, fields)) continue;
      count(signer.act('site.photo', fields, `the photograph ${f}`));
    }
    // A picture taken out of the folder is hidden on the site (it stays in the record).
    for (const [id, p] of Object.entries(s.photos)) {
      if (p.hidden || pics.some(f => slugify(f.replace(/\.[^.]+$/, '')) === id)) continue;
      const { by, at, created, ...rest } = p;
      count(signer.act('site.photo', { ...rest, hidden: true }, `hiding the photograph ${id} (no longer in photos/)`));
    }
  }
  console.log(dry ? `${n} change(s) to sign.` : `${n} change(s) signed${problems ? `, ${problems} problem(s) above` : ''}.`);
  return problems ? 1 : 0;
}

// ── new, init ────────────────────────────────────────────────────────────
function scaffold(kind, title, FOLDER) {
  const slug = slugify(title), today = new Date().toISOString().slice(0, 10);
  const dir = path.join(FOLDER, kind === 'post' ? 'posts' : 'projects'), f = path.join(dir, `${slug}.md`);
  if (fs.existsSync(f)) die(`${f} already exists`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, kind === 'post'
    ? `---\ntitle: ${JSON.stringify(title)}\ndate: ${today}\nform: essay\ntags: []\nsummary: ""\nstatus: draft\n---\n\nWrite here. Footnotes work like this.[^1]\n\n<!-- A picture: put it in images/ and write ![A caption](../images/name.jpg) -->\n\n[^1]: A footnote.\n`
    : `---\nname: ${JSON.stringify(title)}\nsummary: ""\ntype: hosted\n# folder: ../sites/${slug}      a static site published at ${slug}.<your domain>\n# address: https://…           or where it lives, for an app or a link\nstatus: Live\n---\n\nA write-up, if you want a page for it. Leave empty for none.\n`);
  console.log(`${f} is ready. Write in it and save: it is signed and published within a minute${kind === 'post' ? ' once you set status: published (until then it is a draft, signed but not shown)' : ''}.`);
}
function init(FOLDER) {
  if (fs.existsSync(path.join(FOLDER, 'profile.md'))) die(`${FOLDER} already has a profile.md`);
  for (const d of ['posts', 'projects', 'photos', 'images', 'sites']) fs.mkdirSync(path.join(FOLDER, d), { recursive: true });
  fs.writeFileSync(path.join(FOLDER, 'profile.md'), `---\nname: Your Name\nsub: Where you are · how to reach you\nlede: A sentence or two about you.\nmore: A little more.\nlately:\n  - title: Something you are doing\n    sub: A line about it.\nreading: []\ncontact: you [at] example.org\nelsewhere:\n  - label: GitHub\n    url: https://github.com/you\nfooter: Made by hand.\n---\n`);
  fs.writeFileSync(path.join(FOLDER, 'resume.md'), `# Résumé\n\n## Education\n\n### A university | 2023 – 2027\nA degree\n\n## Experience\n\n### A role | 2024 – now\nAn organisation\n\n- What you did.\n`);
  fs.writeFileSync(path.join(FOLDER, 'photos', 'captions.yml'), '# one line per picture:  file.jpg: Caption · Place\n');
  console.log(`${FOLDER} is ready: edit profile.md and resume.md, add posts with \`node tools/site.mjs new post "A title" ${FOLDER}\`.`);
}

const [cmd, a1, a2, a3] = pos;
const DIR = path.resolve(opt('entity', process.env.SITE_ENTITY || path.join(process.env.ENTITIES || path.join(process.env.HOME, 'entities'), 'site')));
// Newest change anywhere in the folder, to sync only when something was saved.
function newest(d) { let t = 0; const walk = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const f = path.join(x, e.name); const st = fs.statSync(f); t = Math.max(t, st.mtimeMs); if (e.isDirectory()) walk(f); } }; if (fs.existsSync(d)) walk(d); return t; }
if (cmd === 'watch') {
  const F = path.resolve(a1 || '.'), every = Number(opt('every', 15)) * 1000;
  let seen = 0;
  for (;;) {
    const t = newest(F);
    if (t > seen) { seen = t; try { await sync(F, DIR, opt('as', process.env.SITE_AUTHOR || 'tim'), false); } catch (x) { say(`sync failed: ${x.message}`); } }
    await new Promise(r => setTimeout(r, every));
  }
}
if (cmd === 'sync' || cmd === 'status') process.exit(await sync(path.resolve(a1 || '.'), DIR, opt('as', process.env.SITE_AUTHOR || 'tim'), cmd === 'status'));
else if (cmd === 'new' && (a1 === 'post' || a1 === 'project') && a2) scaffold(a1, a2, path.resolve(a3 || '.'));
else if (cmd === 'init') init(path.resolve(a1 || '.'));
else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 26).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
