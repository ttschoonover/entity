// The letters tab: the letters issued, each on its letterhead with its
// signatures; joint letters waiting for signatures; writing a letter on a
// letterhead you may issue on; the letterheads; and your drawn signature.
import { letterOf, issuerTitle, parseIssuer, styleOf, specimenOf, nextId } from './index.js';
import { renderLetter, formatDate, authorityLine } from './render.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);
const FONTS = { palatino: "'Palatino Linotype','Book Antiqua',Palatino,'TeX Gyre Pagella',serif", 'computer-modern': "'Latin Modern Roman','CMU Serif',serif",
  times: "'Times New Roman',Times,serif", garamond: "'EB Garamond',Garamond,serif", baskerville: "'Libre Baskerville',Baskerville,serif" };

function md(src) {
  const segs = [];
  for (const line of String(src).split('\n')) { const q = /^>\s?/.test(line); const l = segs[segs.length - 1]; const x = q ? line.replace(/^>\s?/, '') : line; if (l && l.q === q) l.lines.push(x); else segs.push({ q, lines: [x] }); }
  return segs.map(s => (s.q ? `<div style="font-size:9.5pt;margin:0 2rem">${mdPlain(s.lines.join('\n'))}</div>` : mdPlain(s.lines.join('\n')))).join('');
}
function mdPlain(src) {
  const inl = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  const out = []; let list = null, para = [];
  const fp = () => { if (para.length) { out.push(`<p>${inl(para.join(' '))}</p>`); para = []; } };
  const fl = () => { if (list) { out.push(`<${list.t}>${list.i.map(x => `<li>${inl(x)}</li>`).join('')}</${list.t}>`); list = null; } };
  for (const line of String(src).split('\n')) {
    let m;
    if (!line.trim()) { fp(); fl(); continue; }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/)) || (m = line.match(/^\s*[-*•]\s+(.*)$/))) { fp(); const t = /^\s*\d/.test(line) ? 'ol' : 'ul'; if (list && list.t !== t) fl(); (list ||= { t, i: [] }).i.push(m[2] ?? m[1]); continue; }
    if ((m = line.match(/^#\s+(.*)$/))) { fp(); fl(); out.push(`<p class="sc" style="color:var(--accent);letter-spacing:.18em;text-align:center;margin-top:1.4rem">${esc(m[1].toLowerCase())}</p>`); continue; }
    if ((m = line.match(/^#{2,3}\s+(.*)$/))) { fp(); fl(); out.push(`<p class="sc" style="color:var(--accent);letter-spacing:.12em;margin-top:1.2rem">${esc(m[1].toLowerCase())}</p>`); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { fp(); fl(); out.push('<hr style="width:3rem;border:0;border-top:.6px solid var(--accent)">'); continue; }
    fl(); para.push(line.trim());
  }
  fp(); fl(); return out.join('');
}

// The seal as SVG: the name over the top, the title under the bottom.
function sealSvg(head, st, entity) {
  const top = esc(String(head.seal_top || head.name).toUpperCase()), bottom = esc(String(head.seal_bottom ?? head.title ?? entity).toUpperCase());
  const mid = esc(st.emblem_text || String(head.title || head.name).split(/\s+/).filter(w => !/^(of|the|and|for)$/i.test(w)).map(w => w[0]).join('').slice(0, 3).toUpperCase());
  const c = `#${st.accent}`, id = `s${Math.random().toString(36).slice(2, 8)}`;
  return `<svg viewBox="-80 -80 160 160" width="112" height="112" aria-hidden="true" style="display:block;margin:0 auto 6px">
<circle r="76" fill="none" stroke="${c}" stroke-width="2.6"/><circle r="71" fill="none" stroke="${c}" stroke-width=".7"/><circle r="46" fill="none" stroke="${c}" stroke-width=".7"/>
<path id="${id}t" d="M -53 0 A 53 53 0 0 1 53 0" fill="none"/><path id="${id}b" d="M -63.5 0 A 63.5 63.5 0 0 0 63.5 0" fill="none"/>
<text fill="${c}" font-size="${Math.max(6.5, Math.min(10, 130 / Math.max(1, top.length)))}" letter-spacing="1"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">${top}</textPath></text>
<text fill="${c}" font-size="${Math.max(6.5, Math.min(10, 160 / Math.max(1, bottom.length)))}" letter-spacing="1" dominant-baseline="hanging"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">${bottom}</textPath></text>
<circle cx="-58.5" r="2" fill="${c}"/><circle cx="58.5" r="2" fill="${c}"/>
<text fill="${c}" font-size="${mid.length > 2 ? 24 : 34}" text-anchor="middle" dominant-baseline="central">${mid}</text></svg>`;
}

// A letter as a printable page, in the same design as its LaTeX.
export function letterHtml(api, l, { specimen = false } = {}) {
  const { state, params } = api, head = l.head, st = styleOf(params, head), entity = params.value('entity.name');
  const issuer = issuerTitle(state, head.issuer), accent = `#${st.accent}`;
  const closing = l.closing || head.closing || (l.joint ? `For the ${issuer},` : 'Respectfully,');
  const sigs = l.signatures ? l.signatories.slice(0, 12) : [];
  const addr = [...(head.address || []), ...(head.contact || [])];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(l.letter)}: ${esc(l.subject)}</title><style>
@page{size:${st.paper === 'a4' ? 'A4' : 'letter'};margin:.7in 1.05in .9in}
body{--accent:${accent};font:11pt/1.5 ${FONTS[st.face] || FONTS.palatino};color:#111;max-width:6.4in;margin:2rem auto;padding:0 1rem;font-variant-numeric:oldstyle-nums}
.sc{font-variant:small-caps;letter-spacing:.09em}.head{text-align:${st.layout === 'flush' ? 'left' : 'center'}}
.name{font-size:24pt;font-variant:small-caps;letter-spacing:.07em;margin:0}.title{font-variant:all-small-caps;letter-spacing:.16em;font-size:11pt;margin:.2rem 0}
.sub{font-style:italic;font-size:9pt}.rule{border-top:${st.rule === 'none' ? '0' : st.rule === 'single' ? '.8px' : '1.6px'} solid ${accent};${st.rule === 'double' ? `border-bottom:.6px solid ${accent};height:2px;` : ''}margin:.6rem 0 .3rem}
.addr{font-variant:all-small-caps;letter-spacing:.08em;font-size:8.5pt;text-align:center}.addr span+span:before{content:'•';color:${accent};margin:0 .6em;font-size:6pt;vertical-align:middle}
.meta{display:flex;justify-content:space-between;margin:1.6rem 0 1rem}.ref{font-size:9pt}.re{margin:1rem 0}.re b{color:${accent};font-weight:400}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem 2rem;margin-top:1rem}.sig img{height:48px;display:block}.sig .blank{height:48px}.sig .line{border-top:.6px solid ${accent};width:85%;margin-bottom:.2rem}.sig i{font-size:9pt}
.auth,.foot{font-size:8.5pt;color:#666}.foot{text-align:center;margin-top:2.5rem}.withdrawn{border:1px solid ${accent};padding:.5rem .8rem;font-size:10pt}
</style></head><body>
<div class="head">${st.emblem === 'seal' && st.layout !== 'flush' ? sealSvg(head, st, entity) : st.emblem === 'ornament' && st.layout !== 'flush' ? `<div style="color:${accent}">— ◆ —</div>` : ''}
<p class="name">${esc(head.name)}</p>${head.title ? `<p class="title">${esc(head.title)}</p>` : ''}${head.subtitle ? `<div class="sub">${esc(head.subtitle)}</div>` : ''}</div>
<div class="rule"></div>${addr.length ? `<div class="addr">${addr.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}${head.motto ? `<div class="sub" style="text-align:center">${esc(head.motto)}</div>` : ''}
${l.withdrawn ? `<p class="withdrawn"><span class="sc">withdrawn</span> on ${esc(formatDate(l.withdrawn.at.slice(0, 10), st.dates))}: ${esc(l.withdrawn.reason)}</p>` : ''}
<div class="meta"><div>${l.to.map(esc).join('<br>')}</div><div style="text-align:right">${esc(formatDate(l.date, st.dates))}<br><span class="ref"><span class="sc">ref.</span> ${esc(l.letter)}</span></div></div>
<p class="re"><b class="sc">re:</b> <span class="sc">${esc(l.subject)}</span></p>
${l.salutation ? `<p>${esc(l.salutation)}</p>` : ''}${md(l.body)}
<p>${esc(closing)}</p>
${sigs.length ? `<div class="sigs">${sigs.map(s => { const d = specimen ? null : specimenOf(state, s); return `<div class="sig">${d ? `<img src="${d}" alt="">` : '<div class="blank"></div>'}<div class="line"></div><span class="sc">${esc(nm(api, s.id))}</span><br><i>${esc(s.role)}</i></div>`; }).join('')}</div>` : `<p class="sc">The ${esc(issuer)}</p>`}
<p class="auth">${esc(authorityLine(l, issuer))}</p>
${l.cc.length ? `<p class="auth"><span class="sc">cc:</span> ${l.cc.map(esc).join('; ')}</p>` : ''}${l.enclosures.length ? `<p class="auth"><span class="sc">encl.:</span> ${l.enclosures.map(esc).join('; ')}</p>` : ''}
<p class="foot">${head.footer ? `${esc(head.footer)}<br>` : ''}${specimen ? 'Specimen · not issued' : `<span class="sc">${esc(l.letter.toLowerCase())}</span> · issued on the record of ${esc(entity)} · fingerprint ${esc((l.fingerprint || '').slice(0, 16))}`}</p>
</body></html>`;
}

function openPrint(html, print = true) {
  const w = window.open('', '_blank');
  if (!w) return alert('Allow pop-ups for this page to open the letter.');
  w.document.open(); w.document.write(html); w.document.close();
  if (print) setTimeout(() => w.print(), 400);
}
function save(name, data, type) {
  const a = document.createElement('a');
  a.href = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
}
function downloadTex(api, l) {
  const { tex, images } = renderLetter(l, { entity: api.params.value('entity.name'), issuerTitle: issuerTitle(api.state, l.head.issuer),
    name: (id) => nm(api, id), style: styleOf(api.params, l.head), drawing: (s) => specimenOf(api.state, s) });
  save(`${l.letter}.tex`, tex, 'application/x-tex');
  images.forEach((im, i) => setTimeout(() => save(im.file, im.dataUrl), 300 * (i + 1)));
}

// Letterheads the signed-in member may write on now.
function writable(api) {
  const heads = Object.values(api.state.m.letters?.heads || {}).filter(h => !h.retired);
  return heads.filter(h => h.issuer === 'entity' || (api.grantsFor && api.grantsFor([{ kind: 'letter.issue', letterhead: h.letterhead }]).length));
}

function pad(h) {
  const W = 520, H = 150;
  const canvas = h('canvas', { width: W, height: H, 'aria-label': 'Draw your signature here', style: 'width:100%;max-width:520px;height:auto;aspect-ratio:520/150;touch-action:none;border:0.5px solid currentColor;background:#fff;display:block' });
  const ctx = canvas.getContext('2d'); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let down = false, drawn = false, last = null;
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  canvas.addEventListener('pointerdown', (e) => { down = true; last = at(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => { if (!down) return; const p = at(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; drawn = true; });
  canvas.addEventListener('pointerup', () => { down = false; }); canvas.addEventListener('pointercancel', () => { down = false; });
  return { el: canvas, clear: () => { ctx.clearRect(0, 0, W, H); drawn = false; }, png: () => (drawn ? canvas.toDataURL('image/png') : null) };
}

function list(api) {
  const { h, state, me, link, day } = api;
  const b = state.m.letters || { heads: {}, letters: {}, order: [] };
  const sec = h('section', {}, h('h2', {}, 'Letters'),
    h('p', { class: 'hint' }, 'Official letters, each on the letterhead of whoever issued it. A letter is issued only by those with the authority: the members by decision, or an office or committee through its grant, and it shows the signatures of those who agreed to it.'));
  // Joint letters waiting for signatures.
  const waiting = Object.values(state.m.authority?.exercises || {}).filter(x => !x.enacted && x.expires > state.head.at && x.effects.some(e => e.kind === 'letter.issue'));
  if (waiting.length) sec.append(h('h3', {}, 'Waiting for signatures'), h('ul', {}, waiting.map(x => {
    const e = x.effects.find(f => f.kind === 'letter.issue');
    const g = state.m.authority.grants[x.grant], live = (m) => !m.until || m.until > state.head.at;
    const body = g.to.committee ? (state.m.committees?.[g.to.committee]?.members || []).filter(live).map(m => m.id) : (state.m.offices?.[g.to.office]?.holders || []).filter(live).map(m => m.id);
    const mine = me && body.includes(me.id) && !x.signers.includes(me.id);
    return h('li', {}, h('b', {}, e.subject), ` · ${e.letter} on ${e.letterhead} · signed by ${x.signers.map(s => nm(api, s)).join(', ')} (${x.signers.length} of ${x.needs}) · until ${day(x.expires)}`,
      h('details', {}, h('summary', {}, 'Read it'), h('div', { class: 'post-body' }, e.body)),
      mine ? h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('authority.cosign', { exercise: x.id }, `Your signature on letter ${e.letter}`) }, 'Sign this letter')) : null);
  })));
  const all = [...b.order].reverse().map(id => b.letters[id]);
  sec.append(all.length ? api.list({ key: 'letters', items: all, noun: 'letters', head: ['Letter', 'Date', 'From', 'Subject'],
    text: (l) => `${l.letter} ${l.subject} ${l.head.name} ${l.head.title || ''} ${l.to.join(' ')}`,
    sorts: [['Newest first', api.sorts.newest((l) => l.issued)], ['Oldest first', api.sorts.oldest((l) => l.issued)]],
    row: (l) => h('tr', {}, h('td', {}, link(`letters/${l.letter}`, l.letter)), h('td', {}, l.date), h('td', {}, l.head.title || l.head.name),
      h('td', { class: l.withdrawn ? 'flag' : null }, l.subject, l.withdrawn ? ' (withdrawn)' : '')) }) : h('p', { class: 'hint' }, 'No letters yet.'));
  if (me?.status === 'active') sec.append(writeForm(api), specimenForm(api));
  sec.append(wikiShelf(api), h('p', {}, link('letters/heads', 'The letterheads')));
  return sec;
}

// The wiki, set as letters by the node (`entity letter wiki --pdf`, or on its
// own when node.json says "wikiLetters"). Shown only if this node has them.
function wikiShelf(api) {
  const { h } = api;
  const box = h('div', {});
  fetch(`${location.origin}/letters/wiki/index.json`, { credentials: 'same-origin', cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(list => {
    if (!Array.isArray(list) || !list.length) return;
    const shelves = {};
    for (const x of list) (shelves[x.category || 'Pages'] ||= []).push(x);
    box.append(h('h3', {}, 'The wiki, as letters'),
      h('p', { class: 'hint' }, 'Every wiki page, set on the letterhead and kept current by this node: the version in force if the members adopted one, otherwise the latest.'),
      ...Object.entries(shelves).sort().map(([shelf, pages]) => h('div', {}, h('h4', { style: 'margin:.8rem 0 .2rem' }, shelf), h('ul', {},
        pages.sort((a, b) => a.title.localeCompare(b.title)).map(x => h('li', {}, h('a', { href: `${location.origin}/letters/wiki/${encodeURIComponent(x.page)}.pdf`, target: '_blank', rel: 'noopener' }, x.title),
          ` · version ${x.version}${x.statute ? ', adopted' : ''} · `, h('a', { href: `${location.origin}/letters/wiki/${encodeURIComponent(x.page)}.tex`, download: `${x.page}.tex` }, 'LaTeX')))))));
  }).catch(() => {});
  return box;
}

function writeForm(api) {
  const { h, $, state } = api;
  const heads = writable(api);
  if (!heads.length) return h('p', { class: 'hint' }, 'You hold no authority to issue letters. The members may write on their own letterhead by decision; an office or committee writes on its own through a grant.');
  const today = new Date().toISOString().slice(0, 10);
  const effect = () => {
    const head = state.m.letters.heads[$('#lt-head').value];
    const lines = (id) => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
    const e = { kind: 'letter.issue', letter: $('#lt-id').value.trim() || nextId(state, head, today.slice(0, 4)), letterhead: head.letterhead,
      subject: $('#lt-subject').value.trim(), body: $('#lt-body').value };
    if (lines('#lt-to').length) e.to = lines('#lt-to');
    if ($('#lt-sal').value.trim()) e.salutation = $('#lt-sal').value.trim();
    if ($('#lt-close').value.trim()) e.closing = $('#lt-close').value.trim();
    if (lines('#lt-cc').length) e.cc = lines('#lt-cc');
    if (!$('#lt-sigs').checked) e.signatures = false;
    return { e, head };
  };
  return h('details', {}, h('summary', {}, 'Write a letter'), h('div', { class: 'inline-form' },
    h('label', { for: 'lt-head' }, 'Letterhead'), h('select', { id: 'lt-head' }, heads.map(x => h('option', { value: x.letterhead }, `${x.name}${x.title ? `: ${x.title}` : ''} (${x.issuer === 'entity' ? 'by decision' : issuerTitle(state, x.issuer)})`))),
    h('label', { for: 'lt-to' }, 'To (one line each)'), h('textarea', { id: 'lt-to', rows: 3, style: 'font-family:inherit' }),
    h('label', { for: 'lt-subject' }, 'Subject'), h('input', { id: 'lt-subject' }),
    h('label', { for: 'lt-sal' }, 'Salutation'), h('input', { id: 'lt-sal', placeholder: 'Dear …,' }),
    h('label', { for: 'lt-body' }, 'Letter (blank lines between paragraphs; **bold**, *italics*, - lists)'), h('textarea', { id: 'lt-body', rows: 12, style: 'font-family:inherit' }),
    h('label', { for: 'lt-close' }, 'Closing (empty: the letterhead\'s own)'), h('input', { id: 'lt-close' }),
    h('label', { for: 'lt-cc' }, 'Copies to (one line each)'), h('textarea', { id: 'lt-cc', rows: 2, style: 'font-family:inherit' }),
    h('label', { for: 'lt-id' }, 'Reference (empty: the next number)'), h('input', { id: 'lt-id' }),
    h('label', { style: 'font-weight:400' }, h('input', { type: 'checkbox', id: 'lt-sigs', checked: true, style: 'width:auto;margin-right:.5rem' }), 'Show the signatures of those who agree to it'),
    h('div', { class: 'buttons' },
      h('button', { class: 'quiet', onclick: () => { const { e, head } = effect(); openPrint(letterHtml(api, { ...e, to: e.to || [], cc: e.cc || [], enclosures: [], closing: e.closing || '', salutation: e.salutation || '', date: today, head, signatures: e.signatures !== false, signatories: [], fingerprint: '' }, { specimen: true }), false); } }, 'Preview'),
      h('button', { onclick: () => { const { e } = effect(); if (!e.subject || !e.body.trim()) return alert('A letter needs a subject and a body.'); api.propose(`Letter ${e.letter}: ${e.subject}`, [e]); } }, 'Sign and issue'))));
}

function specimenForm(api) {
  const { h, state, me } = api;
  const mine = state.m.letters?.specimens?.[me.id]?.slice(-1)[0];
  const p = pad(h);
  return h('details', {}, h('summary', {}, 'Your drawn signature'), h('div', { class: 'grant' },
    h('p', { class: 'hint' }, 'Drawn once, shown on every letter you sign from now on. The signed acts on the record are your signature; the drawing is how it looks on paper.'),
    mine?.drawing ? h('img', { src: mine.drawing, alt: 'Your signature', style: 'height:48px;background:#fff;display:block;margin-bottom:.5rem' }) : null,
    p.el, h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => p.clear() }, 'Clear'),
      mine?.drawing ? h('button', { class: 'quiet', onclick: () => api.sign('letter.specimen', { drawing: null }, 'Removing your drawn signature') }, 'Remove mine') : null,
      h('button', { onclick: () => { const d = p.png(); if (!d) return alert('Draw your signature first.'); if (d.length > 80000) return alert('Too detailed: clear it and sign more simply.'); api.sign('letter.specimen', { drawing: d }, 'Your drawn signature for letters'); } }, 'Save it'))));
}

function one(api, id) {
  const { h, state, link, me } = api;
  const l = letterOf(state, id);
  if (!l) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `There is no letter ${id}.`), link('letters', 'Every letter'));
  const frame = h('iframe', { title: l.subject, style: 'width:100%;height:80vh;border:.5px solid currentColor;background:#fff' });
  frame.srcdoc = letterHtml(api, l);
  const canWithdraw = me?.status === 'active' && !l.withdrawn;
  return h('section', {}, h('h2', {}, `${l.letter}: ${l.subject}`),
    h('p', { class: 'meta' }, `${l.date} · on ${l.head.title || l.head.name} · ${l.signatures ? `signed by ${l.signatories.map(s => nm(api, s.id)).join(', ')}` : 'no signatures shown'} · fingerprint ${l.fingerprint.slice(0, 16)}`),
    h('div', { class: 'buttons' }, h('button', { onclick: () => openPrint(letterHtml(api, l)) }, 'Print or save as PDF'),
      h('button', { class: 'quiet', onclick: () => downloadTex(api, l) }, 'LaTeX source'),
      canWithdraw ? h('button', { class: 'quiet', onclick: () => { const r = prompt('Withdraw this letter? The reason is published.'); if (r && r.trim()) api.propose(`Withdraw letter ${l.letter}`, [{ kind: 'letter.withdraw', letter: l.letter, reason: r.trim() }]); } }, 'Withdraw it') : null),
    frame, h('p', {}, link('letters', 'Every letter')));
}

function heads(api) {
  const { h, state, me, $ } = api;
  const all = Object.values(state.m.letters?.heads || {});
  const sec = h('section', {}, h('h2', {}, 'Letterheads'), h('p', { class: 'hint' }, 'Each letterhead belongs to one issuer. They follow the house style (Settings → Letters (house style)); each may adjust it. Letterheads are made, changed and retired by decision.'));
  for (const x of all) {
    const is = parseIssuer(x.issuer);
    sec.append(h('div', { class: 'grant' }, h('h3', {}, `${x.name}${x.title ? `: ${x.title}` : ''}`),
      h('p', { class: 'meta' }, `${x.letterhead} · issued by ${is.kind === 'entity' ? 'the members, by decision' : `${issuerTitle(state, x.issuer)}${x.joint ? `, jointly (${x.joint === 'all' ? 'unanimously' : 'by majority'})` : ''}`}${x.retired ? ' · retired' : ''}`),
      h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => openPrint(letterHtml(api, { letter: 'SPECIMEN', letterhead: x.letterhead, head: x, date: new Date().toISOString().slice(0, 10), to: ['The Recipient'], salutation: 'Dear Recipient,', subject: 'A specimen of this letterhead', body: 'This is how a letter on this letterhead looks. It has not been issued.', closing: '', cc: [], enclosures: [], signatures: false, signatories: [] }, { specimen: true }), false) }, 'See a specimen'),
        me?.status === 'active' && !x.retired ? h('button', { class: 'quiet', onclick: () => api.propose(`Retire the letterhead ${x.letterhead}`, [{ kind: 'letterhead.retire', letterhead: x.letterhead }]) }, 'Propose retiring it') : null)));
  }
  if (me?.status !== 'active') return sec;
  const issuers = [['entity', 'The members (by decision)'],
    ...Object.values(state.m.offices || {}).filter(o => !o.abolished).map(o => [`office:${o.id}`, `Office: ${o.title}`]),
    ...Object.values(state.m.committees || {}).filter(c => !c.dissolved).map(c => [`committee:${c.id}`, `Committee: ${c.title}`])];
  sec.append(h('details', {}, h('summary', {}, 'Propose a letterhead'), h('div', { class: 'inline-form' },
    h('label', { for: 'lh-id' }, 'Id'), h('input', { id: 'lh-id', placeholder: 'finance' }),
    h('label', { for: 'lh-issuer' }, 'Issued by'), h('select', { id: 'lh-issuer' }, issuers.map(([v, t]) => h('option', { value: v }, t))),
    h('label', { for: 'lh-joint' }, 'A committee issues'), h('select', { id: 'lh-joint' }, h('option', { value: 'majority' }, 'by a majority of its members'), h('option', { value: 'all' }, 'unanimously')),
    h('label', { for: 'lh-name' }, 'Name (the large line)'), h('input', { id: 'lh-name', value: api.params.value('entity.name') }),
    h('label', { for: 'lh-title' }, 'Title'), h('input', { id: 'lh-title', placeholder: 'Office of the Finance Manager' }),
    h('label', { for: 'lh-sub' }, 'Subtitle'), h('input', { id: 'lh-sub' }),
    h('label', { for: 'lh-addr' }, 'Address and contact (one line each)'), h('textarea', { id: 'lh-addr', rows: 3, style: 'font-family:inherit' }),
    h('label', { for: 'lh-accent' }, 'Accent colour'), h('input', { id: 'lh-accent', type: 'color', value: `#${styleOf(api.params, null).accent}` }),
    h('label', { for: 'lh-layout' }, 'Layout'), h('select', { id: 'lh-layout' }, h('option', { value: 'centered' }, 'centred, with a seal'), h('option', { value: 'flush' }, 'flush, address on the right')),
    h('label', { for: 'lh-mid' }, 'Initials in the seal'), h('input', { id: 'lh-mid', maxlength: 6 }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const issuer = $('#lh-issuer').value;
      const e = { kind: 'letterhead.define', letterhead: $('#lh-id').value.trim(), issuer, name: $('#lh-name').value.trim(),
        style: { accent: $('#lh-accent').value.slice(1).toUpperCase(), layout: $('#lh-layout').value } };
      if (issuer.startsWith('committee:')) e.joint = $('#lh-joint').value;
      for (const [k, sel] of [['title', '#lh-title'], ['subtitle', '#lh-sub']]) if ($(sel).value.trim()) e[k] = $(sel).value.trim();
      const addr = $('#lh-addr').value.split('\n').map(s => s.trim()).filter(Boolean); if (addr.length) e.address = addr;
      if ($('#lh-mid').value.trim()) e.style.emblem_text = $('#lh-mid').value.trim();
      api.propose(`A letterhead: ${e.title || e.name}`, [e]);
    } }, 'Sign this proposal')))));
  return sec;
}

export const tabs = [{ id: 'letters', title: 'Letters', render: (api, path) => (path[0] === 'heads' ? heads(api) : path[0] ? one(api, path[0]) : list(api)) }];
