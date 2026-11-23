// wikipdf.js · wiki pages as LaTeX, compiled to PDF (Latin Modern), for the
// "Open as PDF" link on the page: one page, or the whole wiki as a booklet.
//
//   pageTex(e, id, { version, hub })   one page (the latest version, or one asked for)
//   wikiTex(e, { hub })                every page, by category, with a contents page
//
// The Markdown the wiki is written in becomes LaTeX: headings, paragraphs,
// **bold**, *italic*, `code`, links (with their address), bullet and numbered
// lists, > quotations, tables, ``` code blocks, --- rules, and pictures kept in
// the entity's media folder (figures with their captions). A picture from
// elsewhere is named, not fetched. Compiled by documents.js (pdflatex, cached).

import fs from 'node:fs';
import path from 'node:path';

// Characters pdflatex (T1, utf8) cannot set become their nearest ASCII.
const SUBS = { '–': '--', '—': '---', '‘': '`', '’': "'", '“': '``', '”': "''", '…': '\\ldots{}', '·': '\\textperiodcentered{}', '→': '\\textrightarrow{}', '←': '\\textleftarrow{}',
  '≤': '$\\leq$', '≥': '$\\geq$', '×': '\\texttimes{}', '§': '\\S{}', '°': '\\textdegree{}', '€': '\\texteuro{}', '•': '\\textbullet{}', ' ': '~', '½': '\\textonehalf{}' };
function tx(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    if ('\\{}$&#^_%~'.includes(ch)) out += { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '#': '\\#', '^': '\\^{}', _: '\\_', '%': '\\%', '~': '\\textasciitilde{}' }[ch];
    else if (SUBS[ch]) out += SUBS[ch];
    else if (ch.codePointAt(0) < 0x250) out += ch;               // Latin and Latin Extended: T1 sets these
    else out += '?';
  }
  return out.replace(/"([^"]*)"/g, "``$1''");
}
const MEDIA = /^media\/[a-f0-9]{16,64}\.(?:jpe?g|png)$/;      // pdflatex reads JPEG and PNG

// Inline Markdown → LaTeX. Code and links are taken out first so their insides stay literal.
function inline(s, ctx) {
  const keep = [];
  const stash = (t) => `\u0000${keep.push(t) - 1}\u0000`;
  let t = String(s)
    .replace(/`([^`]+)`/g, (_, c) => stash(`\\texttt{${tx(c)}}`))
    // Markdown footnotes: [^1] where it is cited, [^1]: the source, on its own line.
    .replace(/\[\^([A-Za-z0-9-]{1,20})\]/g, (all, id) => (ctx.notes?.has(id) ? stash(`\\footnote{${inline(ctx.notes.get(id), { ...ctx, notes: null })}}`) : all))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt) => stash(`[${tx(alt || 'picture')}]`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
      if (/^https?:\/\//i.test(url)) return stash(`\\href{${url.replace(/[\\{}%#]/g, (c) => `\\${c}`)}}{${tx(text)}}\\footnote{\\url{${url.replace(/[\\{}%#]/g, (c) => `\\${c}`)}}}`);
      if (/^#\/wiki\/([a-z0-9-]+)/.test(url) && ctx.anchors) { const id = url.match(/^#\/wiki\/([a-z0-9-]+)/)[1]; return stash(ctx.anchors.has(id) ? `\\hyperref[wiki:${id}]{${tx(text)}}` : tx(text)); }
      return stash(tx(text));
    });
  t = tx(t)
    .replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*/g, '$1\\emph{$2}')
    .replace(/~~(.+?)~~/g, '$1');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}
const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

// Block Markdown → LaTeX. depth 0: ## is a \section; inside the booklet, a \subsection.
export function markdownTex(md, ctx = {}) {
  if (!ctx.notes) {
    const notes = new Map();
    md = String(md).split('\n').filter(l => { const m = l.match(/^\[\^([A-Za-z0-9-]{1,20})\]:\s*(.+)$/); if (m) { notes.set(m[1], m[2]); return false; } return true; }).join('\n');
    ctx = { ...ctx, notes };
  }
  const lvl = ['section', 'subsection', 'subsubsection', 'paragraph', 'paragraph'].slice(ctx.depth || 0);
  const out = []; let para = [], list = null, quote = null, table = null, code = null;
  const flushP = () => { if (para.length) out.push(inline(para.join(' '), ctx), ''); para = []; };
  const flushL = () => { if (list) out.push(`\\begin{${list.env}}`, ...list.items.map(i => `\\item ${inline(i, ctx)}`), `\\end{${list.env}}`, ''); list = null; };
  const flushQ = () => { if (quote) out.push('\\begin{quote}', markdownTex(quote.join('\n'), { ...ctx, depth: 4 }), '\\end{quote}', ''); quote = null; };
  const flushT = () => {
    if (!table) return;
    const [head, ...rows] = table, n = head.length;
    out.push('\\begin{center}\\small', `\\begin{tabularx}{\\linewidth}{${'>{\\raggedright\\arraybackslash}X'.repeat(n)}}`, '\\toprule',
      `${head.map(c => `\\textbf{${inline(c, ctx)}}`).join(' & ')} \\\\`, '\\midrule',
      ...rows.map(r => `${Array.from({ length: n }, (_, i) => inline(r[i] || '', ctx)).join(' & ')} \\\\`), '\\bottomrule', '\\end{tabularx}', '\\end{center}', '');
    table = null;
  };
  const all = () => { flushP(); flushL(); flushQ(); flushT(); };
  const lines = String(md ?? '').replace(/\r/g, '').split('\n');
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k], l = raw.trim();
    if (code) { if (/^```/.test(l)) { out.push('\\begin{verbatim}', ...code.map(c => c.replace(/\\end\{verbatim\}/g, '\\end {verbatim}')), '\\end{verbatim}', ''); code = null; } else code.push(raw.replace(/[^\x09\x20-\x7e]/g, '?')); continue; }
    if (/^```/.test(l)) { all(); code = []; continue; }
    if (!l) { all(); continue; }
    if (/^>/.test(l)) { flushP(); flushL(); flushT(); (quote ||= []).push(l.replace(/^>\s?/, '')); continue; }
    if (quote) flushQ();
    if (/^\|.*\|$/.test(l)) {
      flushP(); flushL();
      if (!table) { const sep = (lines[k + 1] || '').trim(); if (/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(sep)) { table = [cells(l)]; k++; continue; } }
      else { table.push(cells(l)); continue; }
    }
    if (table) flushT();
    const fig = l.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (fig) {
      all();
      const src = fig[2], file = MEDIA.test(src) && ctx.dir ? path.join(ctx.dir, src) : null;
      if (file && fs.existsSync(file)) {
        const name = `img-${path.basename(src)}`; ctx.files[name] = fs.readFileSync(file);
        out.push('\\begin{figure}[htbp]\\centering', `\\includegraphics[width=0.8\\linewidth,height=0.4\\textheight,keepaspectratio]{${name}}`, fig[3] || fig[1] ? `\\caption*{\\small ${inline(fig[3] || fig[1], ctx)}}` : '', '\\end{figure}', '');
      } else out.push(`\\begin{center}\\small\\itshape [Picture: ${tx(fig[3] || fig[1] || src)}]\\end{center}`, '');
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) { all(); out.push('\\begin{center}\\rule{0.4\\linewidth}{0.4pt}\\end{center}', ''); continue; }
    const hd = l.match(/^(#{1,4})\s+(.*)/), num = l.match(/^\d+[.)]\s+(.*)/), bul = l.match(/^[-*+]\s+(.*)/);
    if (hd) { all(); out.push(`\\${lvl[Math.max(0, hd[1].length - (hd[1].length > 1 ? 2 : 1))] || 'paragraph'}*{${inline(hd[2], ctx)}}`, ''); continue; }
    if (num || bul) { flushP(); flushQ(); flushT(); const env = num ? 'enumerate' : 'itemize'; if (list?.env !== env) { flushL(); list = { env, items: [] }; } list.items.push((num || bul)[1]); continue; }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ` ${l}`; continue; }
    if (list) flushL();
    para.push(l);
  }
  if (code) out.push('\\begin{verbatim}', ...code, '\\end{verbatim}');
  all();
  return out.join('\n');
}

const PREAMBLE = `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}\\usepackage{lmodern}\\usepackage[utf8]{inputenc}\\usepackage{textcomp}
\\usepackage[letterpaper,margin=1in]{geometry}
\\usepackage{graphicx}\\usepackage{xcolor}\\usepackage{microtype}\\usepackage{tabularx}\\usepackage{booktabs}\\usepackage{array}\\usepackage{caption}
\\usepackage[hidelinks]{hyperref}
\\definecolor{dim}{HTML}{6B6A64}
\\setlength\\parindent{0pt}\\setlength\\parskip{6pt}
\\renewcommand{\\footnotesize}{\\scriptsize}
`;
const nameOf = (st, id) => { const t = st.m?.titles?.[id]; return (typeof t === 'string' ? t : t?.title) || st.participants[id]?.name || id; };
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const pagesOf = (st) => Object.entries(st.m?.wiki?.pages || {}).filter(([, p]) => p.versions?.length && !p.deleted);
const categoryOf = (p) => p.versions[p.versions.length - 1].category || p.category || 'Pages';

export function pageTex(e, id, { version = null, hub = null } = {}) {
  const st = e.state, p = st.m?.wiki?.pages?.[id];
  if (!p || !p.versions?.length) throw new Error(`there is no page ${id}`);
  const v = version ? p.versions[version - 1] : p.versions[p.versions.length - 1];
  if (!v) throw new Error(`${id} has no version ${version}`);
  const n = p.versions.indexOf(v) + 1, files = {}, name = hub || e.params.value('entity.name');
  const body = markdownTex(v.body, { dir: e.dir, files, depth: 0 });
  const tex = `${PREAMBLE}\\pagestyle{plain}
\\begin{document}
{\\footnotesize\\scshape\\color{dim} ${tx(name)}}\\par\\vspace{4pt}
{\\LARGE ${tx(v.title)}}\\par\\vspace{3pt}
{\\small\\color{dim} Version ${n} of ${p.versions.length}, by ${tx(nameOf(st, v.by))}, ${tx(day(v.at))}${p.statute ? '. Adopted as a house rule' : ''}.}\\par
\\vspace{2pt}\\rule{\\linewidth}{0.4pt}\\par\\vspace{6pt}
${body}
\\vfill{\\scriptsize\\color{dim} From the wiki of ${tx(name)}, as of ${tx(day(new Date().toISOString()))}. Every version of this page is kept on the record.}
\\end{document}
`;
  return { tex, files, name: `wiki-${id}-v${n}` };
}

export function wikiTex(e, { hub = null } = {}) {
  const st = e.state, files = {}, name = hub || e.params.value('entity.name');
  const pages = pagesOf(st);
  if (!pages.length) throw new Error('the wiki has no pages yet');
  const anchors = new Set(pages.map(([id]) => id));
  const byCat = new Map();
  for (const [id, p] of pages) { const c = categoryOf(p); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push([id, p]); }
  const cats = [...byCat.keys()].sort((a, b) => (a === 'Start here' ? -1 : b === 'Start here' ? 1 : a.localeCompare(b)));
  const parts = cats.map(c => [`\\clearpage\\part*{${tx(c)}}\\addcontentsline{toc}{part}{${tx(c)}}`,
    ...byCat.get(c).sort((a, b) => a[1].versions.at(-1).title.localeCompare(b[1].versions.at(-1).title)).map(([id, p], i) => {
      const v = p.versions[p.versions.length - 1];
      return `${i ? '\\clearpage' : ''}\\section{${tx(v.title)}}\\label{wiki:${id}}
{\\small\\color{dim} Version ${p.versions.length}, by ${tx(nameOf(st, v.by))}, ${tx(day(v.at))}.}\\par
${markdownTex(v.body, { dir: e.dir, files, depth: 1, anchors })}`;
    })].join('\n')).join('\n');
  const tex = `${PREAMBLE}\\pagestyle{plain}
\\begin{document}
\\begin{titlepage}\\centering\\vspace*{2in}
{\\Huge ${tx(name)}}\\par\\vspace{12pt}
{\\Large The wiki}\\par\\vspace{24pt}
{\\color{dim} ${pages.length} pages, as of ${tx(day(new Date().toISOString()))}}\\par
\\vfill{\\small\\color{dim} Every version of every page is kept on the record; this is the latest of each.}
\\end{titlepage}
\\tableofcontents
${parts}
\\end{document}
`;
  return { tex, files, name: 'wiki-all' };
}
