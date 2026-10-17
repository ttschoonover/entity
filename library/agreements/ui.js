// The agreements tab: the documents members must sign, their text, who has
// signed which version, a pad to draw one's signature, and a signed copy to
// print or save as a PDF.
import { current, fingerprint, signaturesOf, unsigned } from './index.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Enough Markdown for a printed agreement: headings, bold, italics, lists, tables, paragraphs.
function md(src) {
  const inl = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  const out = []; let list = null, table = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.i.map(x => `<li>${inl(x)}</li>`).join('')}</${list.t}>`); list = null; }
    if (table) { out.push(`<table>${table.map((r, i) => `<tr>${r.map(c => `<${i ? 'td' : 'th'}>${inl(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`); table = null; } };
  for (const line of String(src).split('\n')) {
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length + 1}>${inl(m[2])}</h${m[1].length + 1}>`); continue; }
    if (/^\|/.test(line)) { if (/^\|[\s|:-]+\|$/.test(line)) continue; (table ||= []).push(line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())); continue; }
    if ((m = line.match(/^\s*(\d+)\.\s+(.*)$/)) || (m = line.match(/^\s*[-*]\s+(.*)$/))) { const t = /^\s*\d/.test(line) ? 'ol' : 'ul'; if (list && list.t !== t) flush(); (list ||= { t, i: [] }).i.push(m[2] ?? m[1]); continue; }
    flush(); out.push(`<p>${inl(line)}</p>`);
  }
  flush(); return out.join('');
}

// A signature pad: draw with a finger, stylus or mouse. → { el, png(): data URL | null, clear() }
function pad(h) {
  const W = 520, H = 150;
  const canvas = h('canvas', { width: W, height: H, class: 'sig-pad', 'aria-label': 'Draw your signature here', style: 'width:100%;max-width:520px;height:auto;aspect-ratio:520/150;touch-action:none;border:0.5px solid currentColor;background:#fff;border-radius:0;display:block' });
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let drawing = false, drawn = false, last = null;
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = at(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = at(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; drawn = true;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  return {
    el: canvas,
    clear: () => { ctx.clearRect(0, 0, W, H); drawn = false; },
    png: () => (drawn ? canvas.toDataURL('image/png') : null),
  };
}

// The signed copy: the text, then each signature with what verifies it.
function signedCopy(state, id, v, params) {
  const people = state.order.map(pid => state.participants[pid]);
  const rows = people.map(p => ({ p, s: signaturesOf(state, p.id, id).filter(x => x.version === v.n).slice(-1)[0] })).filter(x => x.s);
  const name = (p) => state.m.titles?.[p.id]?.title || p.name || p.id;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.title)}, version ${v.n}, signed</title>
<style>
body{font:11pt/1.55 'Century Schoolbook','TeX Gyre Schola',Georgia,serif;color:#111;max-width:46rem;margin:2.5rem auto;padding:0 1.5rem}
h1{font:600 1.5rem 'Helvetica Neue',Helvetica,Arial,sans-serif;margin:0 0 .3rem}
.meta{font:9pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#666;margin-bottom:1.5rem}
.text h2,.text h3{font:600 1rem 'Helvetica Neue',Helvetica,Arial,sans-serif;margin:1.4rem 0 .4rem}.text p{margin:0 0 .6rem}.text table{border-collapse:collapse;width:100%;font-size:9pt}.text th,.text td{border-bottom:.5px solid #ccc;text-align:left;padding:3px 6px}
h2{font:600 1.05rem 'Helvetica Neue',Helvetica,Arial,sans-serif;margin:2.5rem 0 .8rem;border-top:1px solid #111;padding-top:.8rem}
.sig{display:grid;grid-template-columns:240px 1fr;gap:.2rem 1.2rem;padding:.9rem 0;border-bottom:.5px solid #ccc;break-inside:avoid}
.sig img{width:240px;height:auto;border-bottom:1px solid #111}
.sig .none{height:50px;border-bottom:1px solid #111;font:9pt 'Helvetica Neue',sans-serif;color:#999;display:flex;align-items:end}
.who{font:600 11pt 'Helvetica Neue',Helvetica,Arial,sans-serif}
.d{font:8.5pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#555;word-break:break-all}
.foot{font:8.5pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#666;margin-top:2rem}
@media print{body{margin:0}}
</style></head><body>
<h1>${esc(v.title)}</h1>
<div class="meta">Version ${v.n}${state.m.wiki.pages[id].statute ? `, enacted ${esc(state.m.wiki.pages[id].statute.at.slice(0, 10))}` : ''} · ${esc(state.entity.id)} · text fingerprint (SHA-256) ${esc(fingerprint(id, v))}</div>
<div class="text">${md(v.body)}</div>
<h2>Signatures</h2>
${rows.map(({ p, s }) => `<div class="sig"><div>${s.drawing ? `<img src="${s.drawing}" alt="Signature of ${esc(name(p))}">` : '<div class="none">signed electronically</div>'}</div>
<div><div class="who">${esc(name(p))}</div><div class="d">Partner id ${esc(p.id)}<br>Signed ${esc(s.at.replace('T', ' ').slice(0, 19))} UTC<br>Version ${s.version} · fingerprint ${esc(s.text)}</div></div></div>`).join('') || '<p>No one has signed this version yet.</p>'}
<p class="foot">Each signature above is a signed act on the record of ${esc(params.value('entity.name'))}, made with the signer's own key, naming this document, its version and the fingerprint of its exact text; the drawn image is sealed inside that act. Anyone holding a copy of the record can verify every signature by replaying it. Printed ${esc(new Date().toISOString().replace('T', ' ').slice(0, 16))} UTC.</p>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return alert('Allow pop-ups for this page to open the signed copy.');
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 400);
}

export default function render(api) {
  const { h, state, params, me, $, when, who, link } = api;
  const required = params.value('agreements.required');
  const drawnMode = params.has('agreements.drawn_signature') ? params.value('agreements.drawn_signature') : 'optional';
  const sec = h('section', {}, h('h2', {}, 'Agreements'),
    h('p', { class: 'hint' }, required.length
      ? 'Every member signs these documents; nobody is admitted without having signed them. A signature records exactly which text was signed, and is kept for good.'
      : 'No document is required yet. The members can require one by setting agreements.required (Settings) to wiki pages.'));
  for (const id of required) {
    const v = current(state, id, params);
    if (!v) { sec.append(h('p', { class: 'flag' }, ...(state.m.wiki?.pages?.[id] ? [`"${id}" has not been enacted yet. Nobody can sign it, or be admitted, until the members enact it: `, link(`wiki/${id}`, 'open it on the Wiki')] : [`The required document "${id}" does not exist yet: write it on the Wiki tab.`]))); continue; }
    const page = state.m.wiki.pages[id];
    const mine = me ? unsigned(state, me.id, id, params) : 'not signed in';
    const people = state.order.map(pid => state.participants[pid]).filter(p => p.status === 'active' || p.status === 'applicant');
    const sp = drawnMode !== 'off' ? pad(h) : null;
    sec.append(h('h3', {}, v.title),
      h('p', { class: 'meta' }, `version ${v.n}${page.statute ? `, enacted ${when(page.statute.at)}` : ', not yet enacted'} · `, link(`wiki/${id}/${v.n}`, 'open on the Wiki')),
      h('details', { open: me && mine ? true : null }, h('summary', {}, 'Read it'), h('div', { class: 'post-body wiki-body' }, v.body)),
      me && mine ? h('div', { class: 'grant' },
        sp ? [h('label', {}, drawnMode === 'required' ? 'Draw your signature' : 'Draw your signature (optional)'), sp.el,
          h('div', { class: 'buttons', style: 'margin-top:.4rem' }, h('button', { class: 'quiet', onclick: () => sp.clear() }, 'Clear'))] : null,
        h('label', { style: 'font-weight:400;margin-top:.8rem;display:block' }, h('input', { type: 'checkbox', id: `ag-${id}`, style: 'width:auto;margin-right:.5rem' }), `I have read version ${v.n} of "${v.title}" and I agree to it.`),
        h('div', { class: 'buttons' }, h('button', { onclick: () => {
          if (!$(`#ag-${id}`).checked) return alert('Tick the box to confirm you have read it and agree.');
          const drawing = sp?.png() || null;
          if (drawnMode === 'required' && !drawing) return alert('Draw your signature in the box first.');
          if (drawing && drawing.length > 80000) return alert('The drawing is too detailed to store: clear it and sign more simply.');
          api.sign('agreement.sign', { page: id, version: v.n, text: fingerprint(id, v), ...(drawing ? { drawing } : {}) }, `Your signature on "${v.title}", version ${v.n}`);
        } }, 'Sign'))) : me ? h('p', { class: 'state-carried' }, 'You have signed it.') : null,
      api.list({ key: `ag-${id}`, items: people, noun: 'members', head: ['Member', 'Status', 'Signature', 'Signed'],
        row: (p) => { const s = signaturesOf(state, p.id, id).slice(-1)[0]; const why = unsigned(state, p.id, id, params);
          return h('tr', {}, h('td', {}, who(p.id)), h('td', {}, p.status === 'applicant' ? 'applying' : 'member'),
            h('td', {}, s?.drawing ? h('img', { src: s.drawing, alt: `Signature of ${p.id}`, style: 'height:34px;width:auto;background:#fff;display:block' }) : (s ? 'electronic' : '')),
            h('td', { class: why ? 'flag' : null }, s ? `version ${s.version}, ${when(s.at)}${why ? ' (not the current version)' : ''}` : 'not yet')); },
        pin: me ? (p) => p.id === me.id : null,
        filters: [{ label: 'Signed', options: [['Everyone', () => true], ['Not signed', (p) => !!unsigned(state, p.id, id, params)], ['Signed', (p) => !unsigned(state, p.id, id, params)]] }] }),
      h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => signedCopy(state, id, v, params) }, 'Print or save a signed copy (PDF)')));
  }
  return sec;
}
