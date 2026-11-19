// letters/render · a letter as LaTeX, on its letterhead. Pure: no files, no
// Node, so the page and the command line make the same source.
//
// renderLetter(letter, { entity, name(id), style, drawing(signatory), specimen })
//   → { tex, images: [{ file, dataUrl }] }
// The images are the signatories' drawn signatures; the .tex includes each one
// if the file is beside it, and leaves the space blank otherwise.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function formatDate(iso, how = 'us') {
  const [y, m, d] = iso.split('-').map(Number);
  if (how === 'iso') return iso;
  return how === 'eu' ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${d}, ${y}`;
}

// Text for LaTeX: every special character made literal, straight quotes curled.
export function tex(s) {
  return String(s ?? '')
    .replace(/\\/g, '\u0000')
    .replace(/([{}$&#%_])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/</g, '\\textless{}').replace(/>/g, '\\textgreater{}').replace(/\|/g, '\\textbar{}')
    .replace(/\u0000/g, '\\textbackslash{}')
    .replace(/(^|[\s([{])"/g, '$1``').replace(/"/g, "''")
    .replace(/(^|[\s([{])'/g, '$1`')
    .replace(/\.\.\./g, '\\ldots{}')
    .replace(/ -- /g, ' -- ').replace(/—/g, '---').replace(/–/g, '--');
}

// Text set along a path (the seal): every non-letter and every accented letter
// becomes one braced group, since decorations.text typesets character by character.
const ACCENTS = { '́': "\\'", '̀': '\\`', '̂': '\\^', '̈': '\\"', '̃': '\\~', '̧': '\\c', '̌': '\\v' };
const SPECIAL = { '★': '\\ding{72}', '·': '\\textperiodcentered', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '—': '---', '–': '--' };
export function texAscii(s) {
  const chars = [...String(s).normalize('NFD')], out = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], next = chars[i + 1];
    if (next && ACCENTS[next]) { out.push(`{${ACCENTS[next]}{${c}}}`); i++; continue; }
    if (/[̀-ͯ]/.test(c)) continue;
    if (SPECIAL[c]) { out.push(`{${SPECIAL[c]}}`); continue; }
    if (/[A-Za-z0-9 .,;:!?()'\-\/]/.test(c)) { out.push(c); continue; }
  }
  return out.join('');
}

// Enough Markdown for a letter: paragraphs, **bold**, *italics*, lists,
// # a centred title card, ## a heading, #### a smaller one, --- a short rule,
// > a passage in smaller type, | tables |, ``` code, and pictures. A picture
// on a line of its own prints if opts.image(src) names a file beside the .tex
// (the command line fetches them); otherwise its description prints instead.
const segments = (src) => {
  const segs = [];
  for (const line of String(src).replace(/\r/g, '').split('\n')) {
    const q = /^>\s?/.test(line), text = q ? line.replace(/^>\s?/, '') : line;
    const last = segs[segs.length - 1];
    if (last && last.quote === q) last.lines.push(text); else segs.push({ quote: q, lines: [text] });
  }
  return segs;
};
export function body(src, opts = {}) {
  return segments(src).map(s => (s.quote ? `\\begin{quote}\\small\n${plain(s.lines.join('\n'), opts)}\n\\end{quote}` : plain(s.lines.join('\n'), opts))).join('\n\n');
}
const FIG = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;
const cellsOf = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
function plain(src, opts = {}) {
  // A Markdown link prints as its text, then the address in small type, broken
  // after slashes so a long one wraps; the address itself is escaped like any text.
  const url = (u) => `{\\small(${tex(u.replace(/^https?:\/\//, '')).replace(/\//g, '/\\allowbreak{}')})}`;
  const emph = (t) => tex(String(t).replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/~~(.+?)~~/g, '$1')).replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}').replace(/(^|[^*\w/])\*([^*\s][^*]*)\*/g, '$1\\emph{$2}');
  const inl = (t) => String(t).split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/).map(part => {
    const m = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (!m) return emph(part);
    // A link whose text is just the site's name ("bsc.coop") prints the address alone.
    const bare = m[2].replace(/^https?:\/\//, '');
    return bare.startsWith(m[1].replace(/\s*\(.*\)$/, '')) ? url(m[2]).replace(/^\{\\small\((.*)\)\}$/, '{\\small $1}') : `${emph(m[1])}~${url(m[2])}`;
  }).join('');
  const out = []; let list = null, para = [], table = null, code = null;
  const flushTable = () => {
    if (!table) return;
    const n = Math.max(...table.map(r => r.length)), row = (r) => [...r, ...Array(n - r.length).fill('')].map(c => inl(c)).join(' & ') + ' \\\\';
    out.push(`\\begin{center}\\small\\begin{tabularx}{\\linewidth}{@{}*{${n}}{>{\\raggedright\\arraybackslash}X}@{}}\\toprule\n${row(table[0])}\n\\midrule\n${table.slice(1).map(row).join('\n')}\n\\bottomrule\\end{tabularx}\\end{center}`);
    table = null;
  };
  const flushPara = () => { if (para.length) { out.push(inl(para.join(' '))); para = []; } };
  const flushList = () => { if (list) { out.push(`\\begin{${list.t}}[leftmargin=1.6em,itemsep=0.2em,topsep=0.4em]\n${list.i.map(x => `  \\item ${inl(x)}`).join('\n')}\n\\end{${list.t}}`); list = null; } };
  const lines = String(src).replace(/\r/g, '').split('\n');
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    let m;
    if (code) { if (/^\s*```/.test(line)) { out.push(`\\begin{quote}\\small\\raggedright\n${code.map(c => tex(c) || '~').join('\\\\\n')}\n\\end{quote}`); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flushPara(); flushList(); flushTable(); code = []; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList();
      if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)) continue;
      (table ||= []).push(cellsOf(line)); continue;
    }
    flushTable();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.trim().match(FIG))) {
      flushPara(); flushList();
      const file = opts.image?.(m[2]), words = m[3] || m[1];
      out.push(file
        ? `\\begin{center}\\includegraphics[width=0.82\\linewidth,height=0.36\\textheight,keepaspectratio]{${file}}${words ? `\\\\[4pt]{\\footnotesize\\itshape ${inl(words)}}` : ''}\\end{center}`
        : `\\begin{center}{\\footnotesize\\itshape [Picture${words ? `: ${inl(words)}` : ''}]}\\end{center}`);
      continue;
    }
    if ((m = line.match(/^####\s+(.*)$/))) { flushPara(); flushList(); out.push(`\\needspace{4\\baselineskip}\\vspace{4pt}{\\itshape ${inl(m[1])}}\\nopagebreak`); continue; }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/)) || (m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara(); const t = /^\s*\d/.test(line) ? 'enumerate' : 'itemize';
      if (list && list.t !== t) flushList(); (list ||= { t, i: [] }).i.push(m[2] ?? m[1]); continue;
    }
    if ((m = line.match(/^#\s+(.*)$/))) { flushPara(); flushList(); out.push(`\\needspace{7\\baselineskip}\\begin{center}\\vspace{2pt}{\\color{accent}\\rule{0.8cm}{0.4pt}}\\\\[3pt]{\\color{accent}\\textls[140]{\\textsc{${tex(m[1].toLowerCase())}}}}\\\\[1pt]{\\color{accent}\\rule{0.8cm}{0.4pt}}\\end{center}\\nopagebreak\\vspace{-6pt}`); continue; }
    if ((m = line.match(/^#{2,3}\s+(.*)$/))) { flushPara(); flushList(); out.push(`\\needspace{5\\baselineskip}\\vspace{6pt}{\\color{accent}\\textls[90]{\\textsc{${tex(m[1].toLowerCase())}}}}\\nopagebreak`); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); out.push('\\begin{center}{\\color{accent}\\rule{1.2cm}{0.5pt}}\\end{center}'); continue; }
    flushList(); para.push(line.trim());
  }
  if (code) out.push(`\\begin{quote}\\small\\raggedright\n${code.map(c => tex(c) || '~').join('\\\\\n')}\n\\end{quote}`);
  flushPara(); flushList(); flushTable();
  return out.join('\n\n');
}

const FACES = {
  palatino: '\\usepackage[T1]{fontenc}\n\\usepackage[sc,osf]{mathpazo}\n\\linespread{1.05}',
  'computer-modern': '% Computer Modern, LaTeX\'s own face, with its true small capitals',
  times: '\\usepackage[T1]{fontenc}\n\\usepackage{mathptmx}',
  garamond: '\\usepackage[T1]{fontenc}\n\\usepackage[osf]{ebgaramond}',
  baskerville: '\\usepackage[T1]{fontenc}\n\\usepackage[p,osf]{baskervillef}',
};

const initials = (s) => String(s).split(/\s+/).filter(w => /^[A-Za-zÀ-ÿ]/.test(w) && !/^(of|the|de|la|le|des|du|and|et|for)$/i.test(w)).map(w => w[0].toUpperCase()).join('').slice(0, 3);

function emblem(st, head, entity) {
  if (st.emblem === 'none') return '';
  if (st.emblem === 'ornament') {
    return `{\\color{accent}\\begin{tikzpicture}[baseline]
  \\draw[line width=0.5pt] (-1.6,0) -- (-0.22,0); \\draw[line width=0.5pt] (0.22,0) -- (1.6,0);
  \\fill (0,0.16) -- (0.16,0) -- (0,-0.16) -- (-0.16,0) -- cycle;
  \\fill (-1.7,0) circle (0.04); \\fill (1.7,0) circle (0.04);
\\end{tikzpicture}}\\par\\vspace{6pt}`;
  }
  // A round seal: the name over the top, the title under the bottom, both
  // upright; initials in the middle. Type is sized to fit each arc.
  const top = String(head.seal_top || head.name).toUpperCase(), bottom = String(head.seal_bottom ?? head.title ?? entity).toUpperCase();
  const fit = (text, arcPt) => Math.max(4.6, Math.min(7.6, (arcPt * 0.8) / (0.74 * Math.max(1, [...text].length)))).toFixed(1);
  const sTop = fit(top, Math.PI * 1.06 * 28.45), sBottom = fit(bottom, Math.PI * 1.27 * 28.45);
  const mid = texAscii(st.emblem_text || initials(head.title || head.name) || initials(head.name));
  const arc = (text, size, p) => `\\path[decorate, decoration={text along path, text align=center, text={|\\fontsize{${size}}{${size}}\\selectfont\\color{accent}|${texAscii(text)}}}] ${p};`;
  const big = [...mid].length > 2 ? 14 : 21;
  return `\\begin{tikzpicture}
  \\draw[accent, line width=1.3pt] (0,0) circle (1.52cm);
  \\draw[accent, line width=0.35pt] (0,0) circle (1.42cm);
  \\draw[accent, line width=0.35pt] (0,0) circle (0.92cm);
  ${arc(top, sTop, '(180:1.06) arc (180:0:1.06)')}
  ${arc(bottom, sBottom, '(180:1.27) arc (180:360:1.27)')}
  \\fill[accent] (180:1.17) circle (0.045); \\fill[accent] (0:1.17) circle (0.045);
  \\node[accent, font=\\fontsize{${big}}{${big}}\\selectfont] at (0,0) {${mid}};
\\end{tikzpicture}\\par\\vspace{5pt}`;
}

function rule(st) {
  if (st.rule === 'none') return '\\vspace{4pt}';
  if (st.rule === 'single') return '{\\color{accent}\\hrule height 0.6pt}';
  return '{\\color{accent}\\hrule height 1.2pt\\vskip 1.6pt\\hrule height 0.4pt}';
}

const dot = '\\enspace{\\color{accent}\\raisebox{0.15ex}{\\scalebox{0.7}{$\\bullet$}}}\\enspace ';
const sc = (s, ls = 100) => `\\textls[${ls}]{\\textsc{${tex(String(s).toLowerCase())}}}`;

function letterheadTex(head, st, entity) {
  const addr = [...(head.address || []), ...(head.contact || [])];
  if (st.layout === 'flush') {
    return `\\noindent\\begin{minipage}[b]{0.58\\linewidth}
  {\\fontsize{23}{26}\\selectfont\\textls[60]{\\textsc{${tex(head.name)}}}}\\par\\vspace{3pt}
  ${head.title ? `{\\small ${sc(head.title, 110)}}\\par` : ''}
  ${head.subtitle ? `{\\footnotesize\\itshape ${tex(head.subtitle)}}\\par` : ''}
\\end{minipage}\\hfill
\\begin{minipage}[b]{0.38\\linewidth}\\raggedleft\\footnotesize
  ${addr.map(a => `\\textls[40]{${tex(a)}}`).join('\\\\\n  ')}
\\end{minipage}\\par\\vspace{6pt}
${rule(st)}
${head.motto ? `\\vspace{3pt}{\\centering\\footnotesize\\itshape ${tex(head.motto)}\\par}` : ''}`;
  }
  return `{\\centering
${emblem(st, head, entity)}
{\\fontsize{24}{28}\\selectfont\\textls[90]{\\textsc{${tex(head.name)}}}}\\par\\vspace{4pt}
${head.title ? `{\\small ${sc(head.title, 140)}}\\par\\vspace{2pt}` : ''}
${head.subtitle ? `{\\footnotesize\\itshape ${tex(head.subtitle)}}\\par` : ''}
\\vspace{7pt}
}
${rule(st)}
${addr.length ? `\\vspace{4pt}{\\centering\\scriptsize ${addr.map(a => sc(a, 60)).join(dot)}\\par}` : ''}
${head.motto ? `\\vspace{3pt}{\\centering\\footnotesize\\itshape ${tex(head.motto)}\\par}` : ''}`;
}

function signatureBlock(l, opts) {
  const show = l.signatures ? l.signatories.slice(0, 12) : [];
  const cols = show.length > 4 ? 3 : 2, w = cols === 3 ? '0.31' : '0.46', ht = cols === 3 ? '1.0cm' : '1.25cm';
  const box = (s, i) => {
    const file = `${l.letter}-signature-${i + 1}.png`;
    const drawn = opts.drawing ? opts.drawing(s) : null;
    return `\\begin{minipage}[t]{${w}\\linewidth}
  \\vspace{0pt}${drawn ? `\\IfFileExists{${file}}{\\includegraphics[height=${ht},width=0.92\\linewidth,keepaspectratio]{${file}}}{\\rule{0pt}{${ht}}}` : `\\rule{0pt}{${ht}}`}\\par\\vspace{-2pt}
  {\\color{accent}\\rule{0.9\\linewidth}{0.4pt}}\\par\\vspace{2pt}
  {${cols === 3 ? '\\small' : ''}\\textsc{${tex(opts.name(s.id))}}}\\par
  {\\footnotesize\\itshape ${tex(s.role)}}\\par
\\end{minipage}`;
  };
  const rows = [];
  for (let i = 0; i < show.length; i += cols) { const row = show.slice(i, i + cols).map((s, j) => box(s, i + j)); rows.push(row.length < cols && cols === 3 ? `\\hfill${row.join('\\hspace{0.035\\linewidth}\n')}\\hfill\\mbox{}` : row.join('\\hfill\n')); }
  const more = l.signatures && l.signatories.length > show.length ? `\\par\\footnotesize and ${l.signatories.length - show.length} others who voted for it.` : '';
  // The signatures stay together on one page.
  return rows.length ? `\\begin{minipage}{\\linewidth}\n${rows.join('\\par\\vspace{12pt}\\noindent\n')}${more}\n\\end{minipage}` : '';
}

// Who issued it, in words: the line under the signatures.
export function authorityLine(l, issuerTitle) {
  if (l.joint) {
    return `Issued jointly by the ${issuerTitle}, ${l.joint.unanimous ? 'unanimously' : 'by a majority of its members'} (${l.joint.signed} of ${l.joint.of}).`;
  }
  if (l.authority?.proposal) return `Issued by resolution ${l.authority.proposal} of the members, carried ${l.authority.for} for${l.authority.against ? `, ${l.authority.against} against` : ''}.`;
  if (l.authority?.grant) return `Issued by the ${issuerTitle} under the grant of authority “${l.authority.grant}”.`;
  return '';
}

const letterTop = (l, st) => `\\noindent\\begin{minipage}[t]{0.6\\linewidth}
${l.to.length ? l.to.map(x => tex(x)).join('\\\\\n') : '\\mbox{}'}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.36\\linewidth}\\raggedleft
${tex(formatDate(l.date, st.dates))}\\\\
{\\footnotesize\\textsc{ref.}\\ ${tex(l.letter)}}
\\end{minipage}

\\vspace{8pt}
{\\color{accent}\\textsc{re:}}\\enspace\\textsc{${tex(l.subject)}}

${l.salutation ? tex(l.salutation) : ''}`;

const docTop = (l, doc) => `\\begin{center}
{\\Large\\textls[50]{\\textsc{${tex(l.subject)}}}}\\\\[5pt]
{\\footnotesize\\itshape ${tex(doc.subtitle)}}\\\\[2pt]
{\\color{accent}\\rule{1.2cm}{0.5pt}}
\\end{center}
\\vspace{2pt}`;

const letterEnd = (l, opts, closing, issuerTitle, head) => `
\\vspace{4pt}\\needspace{9\\baselineskip}
${tex(closing)}

\\vspace{6pt}\\noindent
${signatureBlock(l, opts) || `\\vspace{8pt}\\textsc{${tex(issuerTitle ? `The ${issuerTitle}` : head.name)}}`}

\\vspace{8pt}
{\\footnotesize\\color{black!70}${tex(authorityLine(l, issuerTitle))}}
${l.cc.length ? `\n{\\footnotesize\\textsc{cc:} ${l.cc.map(tex).join('; ')}}\n` : ''}${l.enclosures.length ? `\n{\\footnotesize\\textsc{encl.:} ${l.enclosures.map(tex).join('; ')}}\n` : ''}`;

export function renderLetter(l, opts) {
  const head = l.head, st = opts.style, entity = opts.entity || '';
  const issuerTitle = opts.issuerTitle || '';
  const closing = l.closing || head.closing || (l.joint ? `For the ${issuerTitle},` : 'Respectfully,');
  const images = [];
  if (l.signatures) l.signatories.slice(0, 12).forEach((s, i) => { const d = opts.drawing && opts.drawing(s); if (d) images.push({ file: `${l.letter}-signature-${i + 1}.png`, dataUrl: d }); });
  const fp = (l.fingerprint || '').slice(0, 16);
  // A document (a wiki page, say) set on a letterhead: a title in place of the
  // addressee and subject, and no closing, signatures or authority line.
  const doc = opts.document || null;
  const foot = doc
    ? `${tex(doc.footer)} \\textperiodcentered\\ fingerprint ${fp}`
    : opts.specimen
    ? `\\textsc{specimen} \\textperiodcentered\\ not issued`
    : `\\textsc{${tex(l.letter.toLowerCase())}} \\textperiodcentered\\ issued on the record of ${tex(entity)} \\textperiodcentered\\ fingerprint ${fp}`;
  const src = `% ${l.letter}: ${l.subject.replace(/\n/g, ' ')}
% Generated by the entity letters module from the record. The record, not this
% file, is the letter: verify it with \`entity verify\` and \`entity letter show ${l.letter}\`.
\\documentclass[11pt]{article}
${FACES[st.face] || FACES.palatino}
\\usepackage[${st.paper === 'a4' ? 'a4paper' : 'letterpaper'},top=0.7in,bottom=0.95in,left=1.05in,right=1.05in,headheight=0pt,footskip=0.45in]{geometry}
\\usepackage[letterspace=100]{microtype}
\\usepackage{xcolor,graphicx,tikz,enumitem,fancyhdr,lastpage,needspace,pifont,booktabs,tabularx}
\\usetikzlibrary{decorations.text}
\\definecolor{accent}{HTML}{${st.accent}}
\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{0.7\\baselineskip}
\\pagestyle{fancy}\\fancyhf{}\\renewcommand{\\headrulewidth}{0pt}
\\fancyfoot[C]{\\scriptsize\\color{black!55}${foot}\\\\[1pt]\\thepage\\ of \\pageref*{LastPage}}
\\fancypagestyle{first}{\\fancyhf{}\\renewcommand{\\headrulewidth}{0pt}\\fancyfoot[C]{\\scriptsize\\color{black!55}${head.footer ? `${tex(head.footer)}\\\\[1pt]` : ''}${foot}}}
\\begin{document}
\\thispagestyle{first}
${letterheadTex(head, st, entity)}
\\vspace{18pt}
${l.withdrawn ? `\\noindent\\fcolorbox{accent}{accent!6}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep-2\\fboxrule}{\\small\\textsc{withdrawn} on ${tex(formatDate(l.withdrawn.at.slice(0, 10), st.dates))}: ${tex(l.withdrawn.reason)}}}\\par\\vspace{6pt}` : ''}
${doc ? docTop(l, doc) : letterTop(l, st)}

${body(l.body, opts)}
${doc ? '' : letterEnd(l, opts, closing, issuerTitle, head)}
\\end{document}
`;
  return { tex: src, images };
}
