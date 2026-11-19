#!/usr/bin/env node
// publish-site.mjs · turn a site entity's record into the public website: plain
// HTML pages, an Atom feed, a sitemap, thumbnails, and a LaTeX PDF of every post
// and of the résumé. tsite serves the folder it writes.
//
//   node tools/publish-site.mjs ENTITY_DIR OUT_DIR [--domain tschoonover.com]
//        [--projects ~/tsite/sites/tschoonover/projects] [--watch] [--no-pdf]
//
// Only what changed is rebuilt: a PDF is made again only when its post is.
// With --watch it checks the record every few seconds and republishes when a
// new act is settled. Pandoc renders the Markdown for the pages and, with
// XeLaTeX, the PDFs; without them the pages use a small built-in renderer and
// the PDF links are left out.
//
// A hosted project with a bundle is unpacked into the projects folder at
// SLUG/, so it answers at SLUG.<domain>. A folder there that this tool did not
// make is never touched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEME = path.join(HERE, 'site-theme');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [DIR, OUT] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--domain', '--projects', '--every'].includes(args[i - 1])));
if (!DIR || !OUT) { console.log('usage: node tools/publish-site.mjs ENTITY_DIR OUT_DIR [--domain D] [--projects DIR] [--watch] [--no-pdf]'); process.exit(1); }
const DOMAIN = opt('domain', 'tschoonover.com');
const PROJECTS = opt('projects', '');
const say = (s) => console.log(`  ${s}`);

const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const PANDOC = has('pandoc');
const XELATEX = has('xelatex');
const CONVERT = has('convert');
const PDF = PANDOC && XELATEX && !flag('no-pdf');

// ── text helpers ──────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MONTHS = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] };
const LONG = { en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'] };
const ym = (d, l = 'en') => { const [y, m] = d.split('-'); return `${MONTHS[l][+m - 1]} ${y}`; };
const longDate = (d, l = 'en') => { const [y, m, day] = d.split('-'); return l === 'fr' ? `${+day} ${LONG.fr[+m - 1]} ${y}` : `${+day} ${LONG.en[+m - 1]} ${y}`; };
const words = (md) => String(md).replace(/!\[[^\]]*\]\([^)]*\)/g, '').split(/\s+/).filter(Boolean).length;
const FORMS = { essay: ['Essay', 'Essai'], note: ['Note', 'Note'], paper: ['Paper', 'Article'], post: ['Post', 'Billet'] };
const formName = (f, l = 'en') => (FORMS[f || 'post'] || FORMS.post)[l === 'fr' ? 1 : 0];
const bi = (en, fr, tag = 'span', attrs = '') => `<${tag}${attrs} data-en="${esc(en)}"${fr ? ` data-fr="${esc(fr)}"` : ''}>${esc(en)}</${tag}>`;

// Inline Markdown for short fields (lede, lately…): links, emphasis, code.
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u.replace(/"/g, '%22')}"${/^https?:/.test(u) ? ' class="ext"' : ''}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

// Markdown to HTML: Pandoc when it is here (footnotes, tables, math), or a
// small renderer that covers paragraphs, headings, lists, quotes, code, images.
const mdCache = new Map();
function md(text) {
  const src = String(text || '');
  if (mdCache.has(src)) return mdCache.get(src);
  let html;
  if (PANDOC) {
    const r = spawnSync('pandoc', ['-f', 'markdown+smart', '-t', 'html5', '--mathml', '--wrap=none'], { input: src, encoding: 'utf8', maxBuffer: 64 << 20 });
    html = r.status === 0 ? r.stdout : basicMd(src);
  } else html = basicMd(src);
  html = html.replace(/(src|href)="media\//g, '$1="/media/');
  mdCache.set(src, html);
  return html;
}
function basicMd(src) {
  const out = []; const lines = src.replace(/\r/g, '').split('\n'); let i = 0;
  const para = (buf) => buf.length && out.push(`<p>${inline(buf.join(' '))}</p>`);
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    const img = l.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/); if (img) { out.push(`<figure><img src="${esc(img[2])}" alt="${esc(img[1])}">${img[3] || img[1] ? `<figcaption>${esc(img[3] || img[1])}</figcaption>` : ''}</figure>`); i++; continue; }
    if (/^>\s?/.test(l)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${basicMd(q.join('\n'))}</blockquote>`); continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const ol = /^\s*\d+\./.test(l); const items = []; while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '')); out.push(`<${ol ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`); continue; }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s|!\[)/.test(lines[i])) buf.push(lines[i++]); para(buf);
  }
  return out.join('\n');
}

// The smallest line diff, for the versions pages.
function diffLines(a, b) {
  const x = String(a).split('\n'), y = String(b).split('\n'), n = x.length, m = y.length;
  if (n * m > 4e6) return [...x.map(l => ['-', l]), ...y.map(l => ['+', l])];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { out.push([' ', x[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', x[i++]]); else out.push(['+', y[j++]]); }
  while (i < n) out.push(['-', x[i++]]); while (j < m) out.push(['+', y[j++]]);
  return out;
}

// ── files ─────────────────────────────────────────────────────────────────
let written = 0;
const wanted = new Set();
function write(rel, data) {
  const f = path.join(OUT, rel); wanted.add(rel);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (fs.existsSync(f) && fs.readFileSync(f).equals(buf)) return;
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f); written++;
}
const keep = (rel) => wanted.add(rel);

// ── the record ────────────────────────────────────────────────────────────
async function load() {
  const store = await import(path.join(path.resolve(DIR), 'kernel', 'store.js'));
  const e = await store.open(path.resolve(DIR));
  if (e.foldError) throw new Error(`the record cannot be read: ${e.foldError}`);
  const modFile = [path.join(path.resolve(DIR), 'modules', 'site', 'index.js'), path.join(HERE, '..', 'library', 'site', 'index.js')].find(f => fs.existsSync(f));
  const site = (await import(modFile)).default;
  return { e, pub: site.published(e.state), state: e.state };
}

// ── the page frame ────────────────────────────────────────────────────────
function frame(ctx, { title, desc = '', here = '', body, canonical = '/', lang = 'en', head = '' }) {
  const P = ctx.profile, name = P.name || ctx.state.entity?.name || 'Home';
  const nav = [['/', 'Home', 'Accueil', 'home'], ['/writing/', 'Writing', 'Écrits', 'writing'], ['/projects/', 'Projects', 'Projets', 'projects'],
    ...(ctx.pub.photos.length ? [['/photographs/', 'Photographs', 'Photographies', 'photographs']] : []), ...(ctx.pub.resume ? [['/resume/', 'Résumé', 'CV', 'resume']] : [])];
  const cat = ctx.catSrc
    ? `<button id="cat" class="img" type="button" aria-label="The cat. Click to spin."><img src="${ctx.catSrc}" alt=""></button>`
    : `<button id="cat" type="button" aria-label="The cat. Click to spin."><svg viewBox="0 0 64 64" aria-hidden="true"><path class="body" d="M14 60 C9 48 10 36 16 28 L14 10 L25 19 C29 18 35 18 39 19 L50 10 L48 28 C54 36 55 48 50 60 Z"/><path d="M48 56 C58 56 60 46 56 40" fill="none" stroke="currentColor" style="stroke:var(--ink)" stroke-width="4" stroke-linecap="round"/><ellipse class="eye" cx="25" cy="34" rx="4.6" ry="5.2"/><ellipse class="eye" cx="39" cy="34" rx="4.6" ry="5.2"/><circle class="pupil" cx="25" cy="34" r="2.2"/><circle class="pupil" cx="39" cy="34" r="2.2"/><path class="nose" d="M30 41 h4 l-2 2.4 z"/></svg></button>`;
  const url = `https://${DOMAIN}${canonical}`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title === name ? name : `${title} · ${name}`)}</title>
<meta name="description" content="${esc(desc || P.description || '')}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:url" content="${esc(url)}"><meta property="og:site_name" content="${esc(name)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}
<link rel="icon" href="${ctx.catSrc || '/assets/cat.svg'}">
<link rel="alternate" type="application/atom+xml" title="${esc(name)}" href="/feed.xml">
<link rel="preload" href="/assets/fonts/lmroman10-regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css?v=${ctx.v}">
${head}</head>
<body>
<a class="skip" href="#main">Skip to the text</a>
<header class="mast col">
  <div class="mast-row">
    <div>
      <a class="name" href="/">${esc(name)}</a>
      ${P.sub ? `<p class="sub"${P.sub_fr ? ` data-en="${esc(P.sub)}" data-fr="${esc(P.sub_fr)}"` : ''}>${esc(P.sub)}</p>` : ''}
    </div>
    <div class="controls">
      <div class="pill" role="group" aria-label="Text size"><button type="button" data-size="-1" aria-label="Smaller text">−</button><button type="button" data-size="0" aria-label="Default text size">A</button><button type="button" data-size="1" aria-label="Larger text">+</button></div>
      <div class="pill" role="group" aria-label="Language"><button type="button" data-lang="en" aria-pressed="true">EN</button><button type="button" data-lang="fr" aria-pressed="false">FR</button></div>
      <div class="pill"><button type="button" id="mode" aria-label="Switch between light and dark">◐</button></div>
    </div>
  </div>
  <nav class="top" aria-label="Site">
    ${nav.map(([h, en, fr, k]) => `<a href="${h}"${here === k ? ' aria-current="page"' : ''} data-en="${en}" data-fr="${fr}">${en}</a>`).join('\n    ')}
  </nav>
</header>
<main id="main" class="col">
${body}
</main>
<footer class="foot col">
  ${P.footer ? `<p${P.footer_fr ? ` data-html data-en="${esc(inline(P.footer))}" data-fr="${esc(inline(P.footer_fr))}"` : ''}>${inline(P.footer)}</p>` : ''}
</footer>
${cat}
<span class="cat-note" id="cat-note" aria-hidden="true">${esc(P.cat_says || 'mrrp')}</span>
<script src="/assets/site.js?v=${ctx.v}" defer></script>
</body>
</html>
`;
}

// ── pieces ────────────────────────────────────────────────────────────────
const label = (n, en, fr) => `<div class="label">${n ? `<span class="n">§${String(n).padStart(2, '0')}</span>` : ''}${bi(en, fr)}</div>`;
const postRow = (p, { pdf = false, short = false } = {}) => `<li data-form="${esc(p.form || 'post')}"><a href="/writing/${p.slug}/"><span class="d">${esc(short ? MONTHS.en[+p.date.slice(5, 7) - 1] : ym(p.date))}</span><span><span class="t">${esc(p.title)}</span>${p.summary ? `<span class="x">${esc(p.summary)}</span>` : ''}</span>${pdf ? '<span class="pdf-tag">PDF</span>' : `<span class="k">${esc(formName(p.form))}</span>`}</a></li>`;
const projHref = (p) => p.address ? (/^https?:\/\//.test(p.address) || p.address.startsWith('/') ? p.address : `https://${p.address}`) : p.type === 'hosted' ? `https://${p.slug}.${DOMAIN}/` : p.body ? `/projects/${p.slug}/` : '';
const projAddr = (p) => (p.address || (p.type === 'hosted' ? `${p.slug}.${DOMAIN}` : '')).replace(/^https?:\/\//, '').replace(/\/$/, '');
function projRow(p) {
  const href = p.body ? `/projects/${p.slug}/` : projHref(p);
  const live = p.live ?? (p.type === 'hosted');
  const inner = `<span class="pn">${esc(p.name)}</span>${p.status || live ? `<span class="ps${live ? ' live' : ''}">${esc(p.status || 'Live')}</span>` : ''}<span class="pd">${esc(p.summary)}</span>${projAddr(p) ? `<span class="ph">${esc(projAddr(p))}</span>` : ''}`;
  return href ? `<a class="proj" href="${esc(href)}">${inner}</a>` : `<div class="proj">${inner}</div>`;
}
const GROUPS = [['hosted', 'Sites I host', 'Sites que j’héberge'], ['app', 'Running on Athens', 'Sur Athènes'], ['link', 'Elsewhere', 'Ailleurs'], ['archive', 'Archive', 'Archives']];
function photoCell(ctx, ph) {
  const full = `/media/${path.basename(ph.src)}`, thumb = ctx.thumbs.get(ph.src) || full;
  const cap = [ph.caption, ph.place].filter(Boolean).join(' · ');
  return `<button type="button" class="photo" data-full="${full}" data-caption="${esc(cap)}"><img src="${thumb}" alt="${esc(cap)}" loading="lazy" decoding="async">${cap ? `<span>${esc(cap)}</span>` : ''}</button>`;
}

// ── pages ─────────────────────────────────────────────────────────────────
function home(ctx) {
  const P = ctx.profile, out = []; let n = 0;
  const posts = ctx.listed.slice(0, P.home_posts || 4);
  out.push(`<section class="hello">${label(++n, 'Hello', 'Bonjour')}
    ${P.lede ? `<p class="lede"${P.lede_fr ? ` data-html data-en="${esc(inline(P.lede))}" data-fr="${esc(inline(P.lede_fr))}"` : ''}>${inline(P.lede)}</p>` : ''}
    ${P.more ? `<p class="more"${P.more_fr ? ` data-html data-en="${esc(inline(P.more))}" data-fr="${esc(inline(P.more_fr))}"` : ''}>${inline(P.more)}</p>` : ''}
    ${(P.lately || []).length ? `<div class="lately">${P.lately.map(x => `<div><b${x.title_fr ? ` data-en="${esc(x.title)}" data-fr="${esc(x.title_fr)}"` : ''}>${esc(x.title)}</b><span${x.sub_fr ? ` data-html data-en="${esc(inline(x.sub || ''))}" data-fr="${esc(inline(x.sub_fr))}"` : ''}>${inline(x.sub || '')}</span></div>`).join('')}</div>` : ''}
    ${(P.reading || []).length ? `<p class="reading">${bi('Reading', 'Je lis')}: ${P.reading.map(r => inline(r)).join(', ')}</p>` : ''}
  </section>`);
  out.push(`<section>${label(++n, 'Writing', 'Écrits')}${posts.length ? `<ul class="rows">${posts.map(p => postRow(p)).join('')}</ul><a class="all" href="/writing/" data-en="All writing (${ctx.listed.length}) →" data-fr="Tous les écrits (${ctx.listed.length}) →">All writing (${ctx.listed.length}) →</a>` : '<p class="empty">Nothing yet.</p>'}</section>`);
  if (P.building?.title) {
    const b = P.building;
    out.push(`<section><div class="feature"><p class="kick">${bi(b.kicker || 'What I’m building', b.kicker_fr || 'Ce que je construis')}</p><h2${b.title_fr ? ` data-en="${esc(b.title)}" data-fr="${esc(b.title_fr)}"` : ''}>${esc(b.title)}</h2>${b.text ? `<p${b.text_fr ? ` data-html data-en="${esc(inline(b.text))}" data-fr="${esc(inline(b.text_fr))}"` : ''}>${inline(b.text)}</p>` : ''}${b.url ? `<a class="go" href="${esc(b.url)}">${esc(b.button || 'How it works')}</a>` : ''}</div></section>`);
  }
  const featured = ctx.pub.projects.filter(p => p.featured !== false).slice(0, P.home_projects || 3);
  if (featured.length) out.push(`<section>${label(++n, 'Projects', 'Projets')}<div>${featured.map(projRow).join('')}</div><a class="all" href="/projects/" data-en="All projects →" data-fr="Tous les projets →">All projects →</a></section>`);
  if (ctx.pub.photos.length) {
    const per = P.photos_per || 6;
    out.push(`<section>${label(++n, 'Photographs', 'Photographies')}<div class="photos" data-gallery data-per="${per}">${ctx.pub.photos.map(ph => photoCell(ctx, ph)).join('')}</div><div class="gal-foot"><a class="count" href="/photographs/"></a><button class="plus" type="button" aria-label="Show more photographs">+</button></div></section>`);
  }
  if ((P.documents || []).length) out.push(`<section>${label(++n, 'Documents', 'Documents')}<ul class="docs">${P.documents.map(d => `<li><a href="${esc(d.url)}">${esc(d.label)}</a>${d.note ? `<span>${esc(d.note)}</span>` : ''}</li>`).join('')}</ul></section>`);
  const links = P.elsewhere || [];
  if (links.length || P.contact) out.push(`<section>${label(++n, 'Elsewhere', 'Ailleurs')}${links.length ? `<div class="else">${links.map(l => `<a${/^https?:/.test(l.url) ? ' class="ext"' : ''} href="${esc(l.url)}">${esc(l.label)}</a>`).join('')}</div>` : ''}${P.contact ? `<p class="contact"${P.contact_fr ? ` data-html data-en="${esc(inline(P.contact))}" data-fr="${esc(inline(P.contact_fr))}"` : ''}>${inline(P.contact)}</p>` : ''}</section>`);
  write('index.html', frame(ctx, { title: P.name || 'Home', here: 'home', body: out.join('\n'), canonical: '/' }));
}

function writingIndex(ctx) {
  const forms = [...new Set(ctx.listed.map(p => p.form || 'post'))];
  let html = `<h1 class="page-title" data-en="Writing" data-fr="Écrits">Writing</h1><p class="page-intro" data-en="Essays, notes and papers. Each one can be read here or opened as a PDF, typeset in LaTeX." data-fr="Essais, notes et articles, à lire ici ou en PDF, composés en LaTeX.">Essays, notes and papers. Each one can be read here or opened as a PDF, typeset in LaTeX.</p>`;
  if (forms.length > 1) html += `<div class="tags" role="group" aria-label="Filter"><button type="button" data-tag="all" aria-pressed="true" data-en="All" data-fr="Tout">All</button>${forms.map(f => `<button type="button" data-tag="${f}" aria-pressed="false" data-en="${formName(f)}s" data-fr="${formName(f, 'fr')}s">${formName(f)}s</button>`).join('')}</div>`;
  let y = '';
  for (const p of ctx.listed) {
    if (p.date.slice(0, 4) !== y) { if (y) html += '</ul>'; y = p.date.slice(0, 4); html += `<p class="year">${y}</p><ul class="rows">`; }
    html += postRow(p, { pdf: ctx.pdfs.has(p.slug), short: true });
  }
  if (y) html += '</ul>'; else html += '<p class="empty">Nothing yet.</p>';
  write('writing/index.html', frame(ctx, { title: 'Writing', here: 'writing', body: html, canonical: '/writing/' }));
}

function postPage(ctx, p, i) {
  const l = p.lang || 'en';
  const translation = ctx.pub.posts.find(x => x.of === p.slug) || (p.of && ctx.pub.posts.find(x => x.slug === p.of));
  const listIdx = ctx.listed.indexOf(p);
  const earlier = listIdx >= 0 ? ctx.listed[listIdx + 1] : null, later = listIdx > 0 ? ctx.listed[listIdx - 1] : null;
  const mins = Math.max(1, Math.round(words(p.body) / 230));
  const body = `<a class="back" href="/writing/">← ${l === 'fr' ? 'Écrits' : 'Writing'}</a>
  <article>
  <div class="post-head">
    <h1 class="page-title">${esc(p.title)}</h1>
    <div class="post-meta"><span class="tag">${esc(formName(p.form, l))}</span><span>${longDate(p.date, l)}</span><span>${l === 'fr' ? `${mins} min de lecture` : `${mins} minute read`}</span>${(p.tags || []).map(t => `<span>#${esc(t)}</span>`).join('')}</div>
    <div class="post-actions">
      ${ctx.pdfs.has(p.slug) ? `<a class="btn pdf" href="/writing/${p.slug}.pdf" target="_blank" rel="noopener">PDF</a>` : ''}
      ${translation ? `<a class="btn" href="/writing/${translation.slug}/" hreflang="${translation.lang || 'en'}">${(translation.lang || 'en') === 'fr' ? 'Lire en français' : 'Read in English'}</a>` : ''}
      ${p.versions > 1 ? `<a class="btn" href="/writing/${p.slug}/versions/">${p.versions} versions</a>` : ''}
    </div>
  </div>
  <div class="prose">${md(p.body)}</div>
  </article>
  ${earlier || later ? `<div class="next">${earlier ? `<a href="/writing/${earlier.slug}/"><small>${l === 'fr' ? 'Avant' : 'Earlier'}</small><span>${esc(earlier.title)}</span></a>` : ''}${later ? `<a class="later" href="/writing/${later.slug}/"><small>${l === 'fr' ? 'Après' : 'Later'}</small><span>${esc(later.title)}</span></a>` : ''}</div>` : ''}`;
  write(`writing/${p.slug}/index.html`, frame(ctx, { title: p.title, desc: p.summary || '', here: 'writing', body, canonical: `/writing/${p.slug}/`, lang: l }));
  versionsPage(ctx, ctx.state.m.site.posts[p.slug], `writing/${p.slug}`, p.title, 'writing', `/writing/${p.slug}/`);
}

function versionsPage(ctx, doc, rel, title, here, back) {
  if (!doc || doc.versions.length < 2) return;
  let html = `<a class="back" href="${back}">← ${esc(title)}</a><h1 class="page-title" style="margin-top:26px">Versions</h1><p class="page-intro">Every change to this page, newest first, each one signed in the record.</p><div style="margin-top:26px">`;
  const vs = doc.versions;
  for (let k = vs.length - 1; k >= 0; k--) {
    const v = vs[k], prev = vs[k - 1];
    const text = (x) => `${x.title || x.name || ''}\n\n${x.body ?? x.summary ?? ''}`;
    const d = prev ? diffLines(text(prev), text(v)).filter(([op]) => op !== ' ') : null;
    html += `<div class="version"><h2>Version ${v.n}${v.status && v.status !== 'published' ? ` · ${esc(v.status)}` : ''}</h2><p class="when">${longDate(v.at.slice(0, 10))}, signed by ${esc(ctx.nameOf(v.by))}${v.note ? ` · ${esc(v.note)}` : ''}</p>${d ? `<div class="diff">${d.length ? d.slice(0, 400).map(([op, line]) => `<span class="${op === '+' ? 'add' : 'del'}">${op} ${esc(line) || ' '}</span>`).join('') : '<span>Only the details changed (date, tags or status).</span>'}</div>` : '<p class="when">The first version.</p>'}</div>`;
  }
  write(`${rel}/versions/index.html`, frame(ctx, { title: `Versions · ${title}`, here, body: html + '</div>', canonical: `/${rel}/versions/` }));
}

function projectsPage(ctx) {
  let html = `<h1 class="page-title" data-en="Projects" data-fr="Projets">Projects</h1><p class="page-intro" data-en="Things I’ve made. Most of them live at their own address on this server." data-fr="Ce que j’ai fait. La plupart ont leur propre adresse sur ce serveur.">Things I’ve made. Most of them live at their own address on this server.</p><div style="margin-top:30px">`;
  for (const [type, en, fr] of GROUPS) {
    const ps = ctx.pub.projects.filter(p => (p.type || 'link') === type);
    if (ps.length) html += `<p class="kind" data-en="${en}" data-fr="${fr}">${en}</p>${ps.map(projRow).join('')}`;
  }
  if (!ctx.pub.projects.length) html += '<p class="empty">Nothing yet.</p>';
  write('projects/index.html', frame(ctx, { title: 'Projects', here: 'projects', body: html + '</div>', canonical: '/projects/' }));
  for (const p of ctx.pub.projects.filter(x => x.body)) {
    const href = projHref({ ...p, body: '' });
    const body = `<a class="back" href="/projects/">← Projects</a><div class="post-head"><h1 class="page-title">${esc(p.name)}</h1><div class="post-meta">${p.status ? `<span class="tag">${esc(p.status)}</span>` : ''}${projAddr(p) ? `<span>${esc(projAddr(p))}</span>` : ''}</div><div class="post-actions">${href ? `<a class="btn pdf" href="${esc(href)}">Open it</a>` : ''}${p.versions > 1 ? `<a class="btn" href="/projects/${p.slug}/versions/">${p.versions} versions</a>` : ''}</div></div>${p.cover ? `<div class="cover"><img src="/media/${path.basename(p.cover)}" alt=""></div>` : ''}<div class="prose">${md(p.body)}</div>`;
    write(`projects/${p.slug}/index.html`, frame(ctx, { title: p.name, desc: p.summary, here: 'projects', body, canonical: `/projects/${p.slug}/` }));
    versionsPage(ctx, ctx.state.m.site.projects[p.slug], `projects/${p.slug}`, p.name, 'projects', `/projects/${p.slug}/`);
  }
}

function photosPage(ctx) {
  if (!ctx.pub.photos.length) return;
  const P = ctx.profile;
  const html = `<h1 class="page-title" data-en="Photographs" data-fr="Photographies">Photographs</h1>${P.photos_intro ? `<p class="page-intro">${inline(P.photos_intro)}</p>` : ''}<div class="photos" data-gallery data-per="12" style="margin-top:30px">${ctx.pub.photos.map(ph => photoCell(ctx, ph)).join('')}</div><div class="gal-foot"><span class="count"></span><button class="plus" type="button" aria-label="Show more photographs">+</button></div>`;
  write('photographs/index.html', frame(ctx, { title: 'Photographs', here: 'photographs', body: html, canonical: '/photographs/' }));
}

// The résumé's Markdown: "### Role | dates" lines become an entry with the
// dates set apart, on the page and in the PDF.
const ENTRY = /^###\s+(.+?)\s+\|\s+(.+?)\s*$/gm;
function resumePage(ctx) {
  const r = ctx.pub.resume; if (!r) return;
  const html = md(r.body.replace(ENTRY, (_, a, b) => `### ${a} [${b}]{.when}`));
  const body = `<div class="cv-head"><div><h1 class="page-title" data-en="Résumé" data-fr="CV">Résumé</h1>${ctx.profile.sub ? `<p class="page-intro">${esc(ctx.profile.sub)}</p>` : ''}</div>${ctx.pdfs.has(':resume') ? '<a class="btn pdf" href="/resume.pdf" target="_blank" rel="noopener">PDF</a>' : ''}</div><div class="cv">${html}</div>`;
  write('resume/index.html', frame(ctx, { title: 'Résumé', here: 'resume', body, canonical: '/resume/' }));
}

function feeds(ctx) {
  const name = ctx.profile.name || 'Home', base = `https://${DOMAIN}`;
  const entries = ctx.listed.slice(0, 30).map(p => `  <entry>\n    <title>${esc(p.title)}</title>\n    <link href="${base}/writing/${p.slug}/"/>\n    <id>${base}/writing/${p.slug}/</id>\n    <updated>${p.at}</updated>\n    <published>${p.date}T12:00:00Z</published>\n    ${p.summary ? `<summary>${esc(p.summary)}</summary>\n    ` : ''}<content type="html">${esc(md(p.body))}</content>\n  </entry>`).join('\n');
  write('feed.xml', `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${esc(name)}</title>\n  <link href="${base}/"/>\n  <link rel="self" href="${base}/feed.xml"/>\n  <id>${base}/</id>\n  <updated>${ctx.lastAt}</updated>\n  <author><name>${esc(name)}</name></author>\n${entries}\n</feed>\n`);
  const urls = ['/', '/writing/', '/projects/', ...(ctx.pub.photos.length ? ['/photographs/'] : []), ...(ctx.pub.resume ? ['/resume/'] : []), ...ctx.pub.posts.map(p => `/writing/${p.slug}/`), ...ctx.pub.projects.filter(p => p.body).map(p => `/projects/${p.slug}/`)];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
  write('404.html', frame(ctx, { title: 'Not here', body: '<h1 class="page-title">Nothing at this address</h1><p class="page-intro">It may have moved. <a href="/">Back to the start</a>, or see <a href="/writing/">everything I’ve written</a>.</p>' }));
}

// ── PDFs ──────────────────────────────────────────────────────────────────
function latexEsc(s) { return String(s).replace(/[\\{}$&#^_%~]/g, c => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[c] || `\\${c}`)); }
function pdf(ctx, key, rel, markdown, template, vars) {
  const sig = sha(JSON.stringify([markdown, vars, fs.readFileSync(path.join(THEME, template), 'utf8')]));
  const target = path.join(OUT, rel);
  if (ctx.cache[key] === sig && fs.existsSync(target)) { keep(rel); return true; }
  const tmp = fs.mkdtempSync(path.join(OUT, '.pdf-'));
  try {
    const a = ['-f', 'markdown+smart', '--template', path.join(THEME, template), '--pdf-engine=xelatex', '--resource-path', path.resolve(DIR), '-o', path.join(tmp, 'out.pdf')];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined && v !== '') a.push('-V', `${k}=${v}`);
    const r = spawnSync('pandoc', a, { input: markdown, encoding: 'utf8', cwd: path.resolve(DIR), timeout: 180000, maxBuffer: 64 << 20 });
    if (r.status !== 0) { say(`PDF of ${rel} failed: ${(r.stderr || '').trim().split('\n').slice(-3).join(' ')}`); return fs.existsSync(target) ? (keep(rel), true) : false; }
    write(rel, fs.readFileSync(path.join(tmp, 'out.pdf')));
    ctx.cache[key] = sig;
    return true;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── media and thumbnails ──────────────────────────────────────────────────
function media(ctx) {
  const used = new Set();
  const scan = (s) => { for (const m of String(s || '').matchAll(/media\/[a-f0-9]{32}\.(?:jpg|png|webp|gif)/g)) used.add(m[0]); };
  for (const p of ctx.pub.posts) scan(p.body);
  for (const p of ctx.pub.projects) { scan(p.body); if (p.cover) used.add(p.cover); }
  for (const ph of ctx.pub.photos) used.add(ph.src);
  if (ctx.profile.cat) used.add(ctx.profile.cat);
  scan(ctx.pub.resume?.body);
  for (const rel of used) {
    const src = path.join(DIR, rel);
    if (!fs.existsSync(src)) { say(`missing picture ${rel} (it is in the record but not in media/)`); continue; }
    const dest = path.join(OUT, rel);
    wanted.add(rel);
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); written++; }
  }
  // Thumbnails for the gallery, 900 px on the long side, when ImageMagick is here.
  for (const ph of ctx.pub.photos) {
    const rel = `media/thumbs/${path.basename(ph.src, path.extname(ph.src))}.jpg`, dest = path.join(OUT, rel);
    if (fs.existsSync(dest)) { wanted.add(rel); ctx.thumbs.set(ph.src, '/' + rel); continue; }
    if (!CONVERT || !fs.existsSync(path.join(DIR, ph.src))) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = spawnSync('convert', [path.join(DIR, ph.src) + '[0]', '-auto-orient', '-resize', '900x900>', '-strip', '-quality', '82', dest]);
    if (r.status === 0) { wanted.add(rel); ctx.thumbs.set(ph.src, '/' + rel); written++; }
  }
}

// ── hosted projects: unpack each bundle into the projects folder ──────────
function bundles(ctx) {
  if (!PROJECTS) return;
  for (const p of ctx.pub.projects.filter(x => x.type === 'hosted' && x.bundle)) {
    const dest = path.join(PROJECTS, p.slug), mark = path.join(dest, '.athens-bundle');
    const tgz = path.join(DIR, p.bundle.path);
    if (fs.existsSync(mark) && fs.readFileSync(mark, 'utf8').trim() === p.bundle.hash) continue;
    if (fs.existsSync(dest) && fs.readdirSync(dest).length && !fs.existsSync(mark)) { say(`${p.slug}: ${dest} was not made from the record; left alone (move it aside to let the record take over)`); continue; }
    if (!fs.existsSync(tgz)) { say(`${p.slug}: its files (${p.bundle.path}) are not on this machine yet`); continue; }
    const tmp = `${dest}.new-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const r = spawnSync('tar', ['xzf', tgz, '-C', tmp, '--no-same-owner', '--no-same-permissions']);
    if (r.status !== 0) { say(`${p.slug}: could not unpack ${p.bundle.path}`); fs.rmSync(tmp, { recursive: true, force: true }); continue; }
    fs.writeFileSync(path.join(tmp, '.athens-bundle'), p.bundle.hash + '\n');
    // tsite lists a project's files from project.json; keep it public with a title.
    if (!fs.existsSync(path.join(tmp, 'project.json'))) fs.writeFileSync(path.join(tmp, 'project.json'), JSON.stringify({ title: p.name, description: p.summary }, null, 2) + '\n');
    const old = `${dest}.old-${process.pid}`;
    if (fs.existsSync(dest)) fs.renameSync(dest, old);
    fs.renameSync(tmp, dest); fs.rmSync(old, { recursive: true, force: true });
    say(`${p.slug}: now serving its files at ${p.slug}.${DOMAIN}`);
  }
}

// ── one pass ──────────────────────────────────────────────────────────────
async function publish() {
  const { e, pub, state } = await load();
  fs.mkdirSync(OUT, { recursive: true });
  wanted.clear(); written = 0;
  const cacheFile = path.join(OUT, '.publish-cache.json');
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* first run */ }
  const last = e.records[e.records.length - 1];
  const profile = pub.profile || { name: state.entity?.name };
  const titles = state.m.titles || {};
  const ctx = {
    e, pub, state, profile, cache, thumbs: new Map(), pdfs: new Set(),
    acts: e.records.length, head: last?.hash || '', lastAt: last?.at || new Date().toISOString(),
    nameOf: (id) => { const t = titles[id]; return (typeof t === 'string' ? t : t?.title) || state.participants?.[id]?.name || id; },
    // Posts in the lists: everything published, except translations (reached from their original).
    listed: pub.posts.filter(p => !p.of),
    catSrc: profile.cat ? `/${profile.cat}` : '',
  };
  // The theme: stylesheet, script, fonts, a drawn cat for the favicon.
  const themeFiles = ['site.css', 'site.js', ...fs.readdirSync(path.join(THEME, 'fonts')).filter(f => f.endsWith('.woff2')).map(f => `fonts/${f}`)];
  ctx.v = sha(themeFiles.map(f => fs.readFileSync(path.join(THEME, f))).join('')).slice(0, 10);
  for (const f of themeFiles) write(`assets/${f}`, fs.readFileSync(path.join(THEME, f)));
  write('assets/cat.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 60 C9 48 10 36 16 28 L14 10 L25 19 C29 18 35 18 39 19 L50 10 L48 28 C54 36 55 48 50 60 Z" fill="#111110"/><ellipse cx="25" cy="34" rx="4.6" ry="5.2" fill="#F7F5F0"/><ellipse cx="39" cy="34" rx="4.6" ry="5.2" fill="#F7F5F0"/><circle cx="25" cy="34" r="2.2" fill="#111110"/><circle cx="39" cy="34" r="2.2" fill="#111110"/></svg>\n');
  media(ctx);
  // PDFs first, so the pages know which ones exist.
  if (PDF) {
    for (const p of pub.posts) {
      const l = p.lang || 'en';
      const ok = pdf(ctx, `post:${p.slug}`, `writing/${p.slug}.pdf`, p.body, 'post.latex', {
        title: p.title, author: profile.name || '', date: longDate(p.date, l), form: formName(p.form, l), site: DOMAIN,
        url: `https://${DOMAIN}/writing/${p.slug}/`, 'url-text': `${DOMAIN}/writing/${p.slug}`, ...(l === 'fr' ? { 'lang-fr': 'true' } : {}),
      });
      if (ok) ctx.pdfs.add(p.slug);
    }
    if (pub.resume) {
      const body = pub.resume.body.replace(/^#\s+.*$/m, '').replace(ENTRY, (_, a, b) => `\`\`\`{=latex}\n\\entry{${latexEsc(a)}}{${latexEsc(b)}}\n\`\`\``);
      if (pdf(ctx, 'resume', 'resume.pdf', body, 'resume.latex', { author: profile.name || '', contact: profile.resume_contact || profile.sub || '' })) ctx.pdfs.add(':resume');
    }
  }
  home(ctx); writingIndex(ctx);
  pub.posts.forEach((p, i) => postPage(ctx, p, i));
  projectsPage(ctx); photosPage(ctx); resumePage(ctx); feeds(ctx);
  bundles(ctx);
  // Take away pages for things no longer published (hidden posts, removed photos).
  const walk = (d, rel = '') => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.name.startsWith('.') ? [] : x.isDirectory() ? walk(path.join(d, x.name), path.join(rel, x.name)) : [path.join(rel, x.name)]) : [];
  let removed = 0;
  for (const rel of walk(OUT)) if (!wanted.has(rel)) { fs.rmSync(path.join(OUT, rel)); removed++; }
  const prune = (d) => { for (const x of fs.readdirSync(d, { withFileTypes: true })) if (x.isDirectory() && !x.name.startsWith('.')) { const f = path.join(d, x.name); prune(f); if (!fs.readdirSync(f).length) fs.rmdirSync(f); } };
  prune(OUT);
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  fs.writeFileSync(path.join(OUT, '.published'), JSON.stringify({ at: new Date().toISOString(), head: ctx.head, acts: ctx.acts }) + '\n');
  say(`published ${pub.posts.length} post(s), ${pub.projects.length} project(s), ${pub.photos.length} photograph(s)${pub.resume ? ', the résumé' : ''}: ${written} file(s) written, ${removed} removed${PDF ? `, ${ctx.pdfs.size} PDF(s)` : PANDOC ? ' (no XeLaTeX: no PDFs)' : ' (no Pandoc: basic Markdown, no PDFs)'}`);
  return ctx.head;
}

if (flag('watch')) {
  const every = Number(opt('every', 5)) * 1000;
  let head = '';
  const headOf = () => { try { const t = fs.readFileSync(path.join(DIR, 'record', 'events.jsonl'), 'utf8').trimEnd(); return sha(t.slice(-4000)) + ':' + t.length; } catch { return ''; } };
  for (;;) {
    const h = headOf();
    if (h && h !== head) { try { await publish(); head = h; } catch (x) { say(`could not publish: ${x.message}`); } }
    await new Promise(r => setTimeout(r, every));
  }
} else {
  await publish();
}
