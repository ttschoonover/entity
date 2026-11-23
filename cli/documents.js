// documents.js · partnership certificates and signed agreements, set in LaTeX
// (Latin Modern) and compiled to PDF with pdflatex.
//
//   certificateTex(e, number)   a certificate from the record (the partnership
//                               module), signed by every officer now in office
//   agreementTex(e, page)       an agreement as enacted, with a signature page:
//                               each signer's drawn signature, name and date
//   pdf(e, { tex, files })      compiled, cached in .entity/documents/
//
// The signatures are the drawings members made when they signed the agreement
// on the record (agreement.sign, the agreements module). Someone who signed
// without drawing appears as "/s/ Name", signed with their key.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const esc = (s) => String(s ?? '').replace(/[\\{}$&#^_%~]/g, (c) => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '#': '\\#', '^': '\\^{}', _: '\\_', '%': '\\%', '~': '\\textasciitilde{}' }[c]))
  .replace(/"([^"]*)"/g, "``$1''").replace(/’/g, "'").replace(/§/g, '\\S{}')
  .replace(/→/g, '\\textrightarrow{}').replace(/≤/g, '$\\leq$').replace(/≥/g, '$\\geq$').replace(/×/g, '\\texttimes{}').replace(/[\u2028\u2029]/g, ' ');
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}').replace(/\*([^*]+)\*/g, '\\emph{$1}').replace(/`([^`]+)`/g, '\\texttt{$1}');
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// Markdown as written in the wiki (headings, paragraphs, lists, emphasis) → LaTeX.
export function mdToTex(md) {
  const out = []; let list = false;
  const close = () => { if (list) { out.push('\\end{itemize}'); list = false; } };
  for (const raw of String(md).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { close(); out.push(''); continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { close(); out.push(`\\${['section*', 'section*', 'subsection*'][m[1].length - 1]}{${inline(m[2])}}`); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (!list) { out.push('\\begin{itemize}\\setlength\\itemsep{2pt}'); list = true; } out.push(`\\item ${inline(m[1])}`); continue; }
    close();
    // A numbered clause ("1.2 …") starts its own paragraph, as the agreement is written.
    if (/^\d+\.\d+\s/.test(line) && out.length && out[out.length - 1] !== '') out.push('');
    out.push(inline(line));
  }
  close();
  return out.join('\n');
}

const nameOf = (st, id) => { const t = st.m?.titles?.[id]; return (typeof t === 'string' ? t : t?.title) || st.participants[id]?.name || id; };
// A member's latest drawn signature, from what they signed on the record.
function drawingOf(st, id) {
  let best = null;
  for (const sigs of Object.values(st.m?.agreements?.[id] || {})) for (const s of sigs) if (s.drawing && (!best || s.at > best.at)) best = s;
  return best?.drawing || null;
}
// The key's SHA-256 fingerprint, as ssh-keygen -l shows it (shortened).
const keyOf = (st, id) => { const b = (st.participants[id]?.keys?.[0] || '').split(' ')[1]; return b ? `SHA256:${crypto.createHash('sha256').update(Buffer.from(b, 'base64')).digest('base64').replace(/=+$/, '').slice(0, 16)}` : ''; };
const pngFile = (dataUrl) => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

// Everyone now in an office, with the office's title.
export function officers(st, at = new Date().toISOString()) {
  const out = [];
  for (const o of Object.values(st.m?.offices || {})) {
    if (o.abolished) continue;
    for (const h of o.holders || []) if (!h.until || h.until > at) out.push({ id: h.id, office: o.title, name: nameOf(st, h.id) });
  }
  return out;
}

function signatureBlock(st, s, files) {
  const d = drawingOf(st, s.id);
  let mark;
  if (d) { const f = `sig-${s.id}.png`; files[f] = pngFile(d); mark = `\\includegraphics[height=1.6cm,width=5.2cm,keepaspectratio]{${f}}`; }
  else mark = `{\\itshape /s/ ${esc(s.name)}}`;
  return `\\begin{minipage}[b]{5.6cm}\\centering ${mark}\\\\[-2pt]\\rule{5.4cm}{0.4pt}\\\\[2pt]{\\small ${esc(s.name)}}\\\\{\\footnotesize\\scshape ${esc(s.office || '')}}\\end{minipage}`;
}

const PREAMBLE = (landscape) => `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}\\usepackage{lmodern}\\usepackage[utf8]{inputenc}\\usepackage{textcomp}
\\usepackage[letterpaper,${landscape ? 'landscape,margin=0.6in' : 'margin=1in'}]{geometry}
\\usepackage{graphicx}\\usepackage{tikz}\\usepackage{xcolor}\\usepackage{microtype}
\\definecolor{seal}{HTML}{9B3833}\\definecolor{dim}{HTML}{6B6A64}
\\pagestyle{empty}\\setlength\\parindent{0pt}\\setlength\\parskip{6pt}
`;

export function certificateTex(e, number, certs) {
  const st = e.state, c = certs.find(x => x.number === Number(number));
  if (!c) throw new Error(`there is no certificate no. ${number}`);
  const files = {}, name = st.entity && e.params.value('entity.name');
  const offs = officers(st);
  const pct = c.outstanding ? (100 * c.units / c.outstanding).toFixed(2) : null;
  const status = c.cancelled ? `\\par\\vspace{4pt}{\\color{seal}\\bfseries\\large CANCELLED ${esc(day(c.cancelled))}: ${esc(c.cancelledBy)}}` : '';
  const tex = `${PREAMBLE(true)}\\begin{document}
\\begin{tikzpicture}[remember picture,overlay]
\\draw[line width=2.4pt,color=black!85] ([xshift=0.45in,yshift=-0.45in]current page.north west) rectangle ([xshift=-0.45in,yshift=0.45in]current page.south east);
\\draw[line width=0.6pt,color=seal] ([xshift=0.55in,yshift=-0.55in]current page.north west) rectangle ([xshift=-0.55in,yshift=0.55in]current page.south east);
\\end{tikzpicture}
\\vspace*{0.15in}
{\\footnotesize\\scshape\\color{dim} Certificate No.~${c.number}\\hfill ${esc(c.units)} units}\\par
\\vspace{0.25in}
\\begin{center}
{\\fontsize{30}{36}\\selectfont ${esc(name)}}\\par\\vspace{4pt}
{\\scshape\\color{dim} a California general partnership}\\par\\vspace{0.3in}
{\\Large\\itshape Partnership Certificate}\\par\\vspace{0.25in}
\\begin{minipage}{7.2in}\\centering\\large
This certifies that \\textbf{${esc(nameOf(st, c.partner))}} is a partner of ${esc(name)}, holding
\\textbf{${esc(c.units)}} units${pct ? ` of ${esc(c.outstanding)} outstanding (${pct}\\%)` : ''} on ${esc(day(c.issued))}, under the partnership agreement and as its record shows.
\\end{minipage}${status}
\\end{center}
\\vfill
\\begin{center}
${offs.length ? offs.map(o => signatureBlock(st, o, files)).join('\\hspace{0.5cm}\n') : '{\\itshape No officer is in office.}'}
\\end{center}
\\vspace{0.2in}
{\\scriptsize\\color{dim} Issued ${esc(day(c.issued))} (${esc(c.why)}), record ${c.seq}, hash \\texttt{${c.record.slice(0, 16)}}. Evidence of units only: not a security, not negotiable, and transferable to no one (agreement section 5.4). Anyone holding the record can check it.}
\\end{document}
`;
  return { tex, files, name: `certificate-${c.number}` };
}

export function agreementTex(e, page, ag) {
  const st = e.state, p = st.m?.wiki?.pages?.[page];
  if (!p) throw new Error(`there is no page ${page}`);
  const v = ag.current(st, page, e.params);
  if (!v) throw new Error(`"${page}" has not been enacted yet`);
  const files = {}, name = e.params.value('entity.name');
  const signers = Object.keys(st.m?.agreements || {}).flatMap(id => (st.m.agreements[id][page] || []).filter(s => s.version === v.n).slice(-1).map(s => ({ id, ...s })))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const rows = signers.map(s => {
    let mark;
    if (s.drawing) { const f = `sig-${s.id}.png`; files[f] = pngFile(s.drawing); mark = `\\includegraphics[height=1.4cm,width=5cm,keepaspectratio]{${f}}`; }
    else mark = `{\\itshape /s/ ${esc(nameOf(st, s.id))}}`;
    return `\\begin{minipage}[b]{3.1in}${mark}\\\\[-2pt]\\rule{3in}{0.4pt}\\\\{\\small ${esc(nameOf(st, s.id))}}\\\\{\\footnotesize\\color{dim} signed ${esc(day(s.at))} · key \\texttt{${esc(keyOf(st, s.id))}}}\\end{minipage}`;
  });
  const grid = rows.length ? rows.map((r, i) => r + (i % 2 ? '\\par\\vspace{0.3in}\n' : '\\hfill\n')).join('') : '{\\itshape Nobody has signed this version yet.}';
  const tex = `${PREAMBLE(false)}\\pagestyle{plain}
\\begin{document}
{\\footnotesize\\scshape\\color{dim} ${esc(name)}}\\par\\vspace{6pt}
{\\LARGE ${esc(v.title)}}\\par\\vspace{2pt}
{\\small\\color{dim} Version ${v.n}${p.statute ? `, enacted ${esc(day(p.statute.at || v.at))}` : ''}. Fingerprint \\texttt{${ag.fingerprint(page, v).slice(0, 24)}}.}\\par
\\vspace{12pt}
${mdToTex(v.body)}
\\clearpage
\\section*{Signatures}
Each partner below signed version ${v.n} of this agreement on the partnership's record with their own key${signers.some(s => s.drawing) ? ', with the handwritten signature shown' : ''} (Civil Code section 1633.7).\\par\\vspace{0.3in}
${grid}
\\end{document}
`;
  return { tex, files, name: `${page}-v${v.n}` };
}

// Compile with pdflatex in a scratch folder; cache by content.
export function pdf(e, { tex, files, name }) {
  const key = crypto.createHash('sha256').update(tex).update(JSON.stringify(Object.keys(files).sort().map(f => [f, crypto.createHash('sha256').update(files[f]).digest('hex')]))).digest('hex').slice(0, 24);
  const cacheDir = path.join(e.dir, '.entity', 'documents'), cached = path.join(cacheDir, `${name}-${key}.pdf`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-doc-'));
  try {
    fs.writeFileSync(path.join(tmp, 'doc.tex'), tex);
    for (const [f, b] of Object.entries(files)) fs.writeFileSync(path.join(tmp, f), b);
    // Twice when a picture is placed on the page (the certificate's border needs the first pass's positions).
    try { for (let i = 0; i < (/remember picture|\\tableofcontents|\\label\{/.test(tex) ? 2 : 1); i++) execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'doc.tex'], { cwd: tmp, stdio: 'pipe', timeout: 60000 }); }
    catch (err) {
      if (err.code === 'ENOENT') throw new Error('pdflatex is not installed on this machine (sudo apt install texlive-latex-recommended texlive-pictures texlive-fonts-recommended)');
      const log = fs.existsSync(path.join(tmp, 'doc.log')) ? fs.readFileSync(path.join(tmp, 'doc.log'), 'utf8').split('\n').filter(l => l.startsWith('!')).slice(0, 3).join(' ') : err.message;
      throw new Error(`LaTeX failed: ${log}`);
    }
    const out = fs.readFileSync(path.join(tmp, 'doc.pdf'));
    fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cached, out);
    return out;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
