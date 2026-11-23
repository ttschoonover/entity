// markdown.js · the safe Markdown the wiki and notices are written in, drawn on
// the standard page (the site kit draws the same, sites/kit/common.js).
// Headings, **bold**, *italic*, `code`, links, images and figures, lists,
// > quotations, ``` code blocks, | tables |, --- rules. Every character is
// escaped first; a link or image keeps only an http(s) address, a page of
// this site (#/…), or a picture in the entity's media folder (media/…).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MEDIA = /^media\/[a-f0-9]{16,64}\.(?:jpe?g|png|webp|gif)$/;
const safeUrl = (u, base) => {
  const raw = String(u).replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(raw)) return esc(raw);
  if (/^#\//.test(raw)) return esc(raw);
  if (MEDIA.test(raw)) return esc(base ? new URL(raw, base).href : raw);
  return null;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function inlineMd(s, base) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^"]*?)&quot;)?\)/g, (all, alt, u, title) => {
    const src = safeUrl(u, base); if (!src) return alt;
    return `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`;
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text, u) => {
    const href = safeUrl(u, base); if (!href) return text;
    return /^#\//.test(href) ? `<a href="${href}">${text}</a>` : `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w/*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}
const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
export function renderText(md, { anchors = '', base = '' } = {}) {
  const inline = (s) => inlineMd(s, base);
  const out = [], heads = []; let para = [], list = null, quote = null, table = null, code = null;
  const flushP = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushL = () => { if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
  const flushQ = () => { if (quote) out.push(`<blockquote>${renderText(quote.join('\n'), { base }).html}</blockquote>`); quote = null; };
  const flushT = () => {
    if (!table) return;
    const [head, ...rows] = table, align = table.align || [];
    const td = (tag, c, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${inline(c)}</${tag}>`;
    out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, i) => td('th', c, i)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => td('td', c, i)).join('')}</tr>`).join('')}</tbody></table></div>`);
    table = null;
  };
  const flushAll = () => { flushP(); flushL(); flushQ(); flushT(); };
  const lines = String(md).replace(/\r/g, '').split('\n');
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k], l = raw.trim();
    if (code) { if (/^```/.test(l)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(raw); continue; }
    if (/^```/.test(l)) { flushAll(); code = []; continue; }
    if (!l) { flushAll(); continue; }
    if (/^>/.test(l)) { flushP(); flushL(); flushT(); (quote ||= []).push(l.replace(/^>\s?/, '')); continue; }
    if (quote) flushQ();
    if (/^\|.*\|$/.test(l)) {
      flushP(); flushL();
      if (!table) {
        const sep = (lines[k + 1] || '').trim();
        if (/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(sep)) {
          table = [cells(l)]; table.align = cells(sep).map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '')); k++; continue;
        }
      } else { table.push(cells(l)); continue; }
    }
    if (table) flushT();
    const fig = l.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (fig) {
      flushAll(); const src = safeUrl(fig[2], base);
      if (src) out.push(`<figure><img src="${src}" alt="${esc(fig[1])}" loading="lazy">${fig[3] ? `<figcaption>${inline(fig[3])}</figcaption>` : ''}</figure>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) { flushAll(); out.push('<hr>'); continue; }
    const hd = l.match(/^(#{1,4})\s+(.*)/), n = l.match(/^\d+[.)]\s+(.*)/), u = l.match(/^[-*+]\s+(.*)/);
    if (hd) {
      flushAll(); const lvl = Math.min(hd[1].length + 1, 5), id = anchors ? `${anchors}-${slug(hd[2])}` : '';
      heads.push({ id, text: hd[2], level: hd[1].length }); out.push(`<h${lvl}${id ? ` id="${id}"` : ''}>${inline(hd[2])}</h${lvl}>`); continue;
    }
    if (n || u) { flushP(); const tag = n ? 'ol' : 'ul'; if (list?.tag !== tag) { flushL(); list = { tag, items: [] }; } list.items.push((n || u)[1]); continue; }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ' ' + l; continue; }
    if (list) flushL();
    para.push(l);
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flushAll();
  return { html: out.join(''), heads };
}
