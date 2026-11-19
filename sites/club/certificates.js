// certificates.js · every partnership certificate, issued automatically from
// the record: one for each partner when admitted, reissued whenever their
// units change. Each names the record entry that issued it, so anyone holding
// the record can check it. Print to keep a paper copy, one to a page.
import { start, ctx, h, $, displayName, day, fullName, setting, onChange } from './common.js';

const main = $('#main');
await start();
const P = await import(new URL('modules/partnership/index.js', ctx.r.base).href);
const paint = (...k) => main.replaceChildren(...k.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
const words = (n) => {
  const a = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const t = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const w = (x) => x < 20 ? a[x] : x < 100 ? t[Math.floor(x / 10)] + (x % 10 ? '-' + a[x % 10] : '') : x < 1000 ? a[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' and ' + w(x % 100) : '') : x < 1e6 ? w(Math.floor(x / 1000)) + ' thousand' + (x % 1000 ? (x % 1000 < 100 ? ' and ' : ' ') + w(x % 1000) : '') : x.toLocaleString();
  return w(n);
};
const seal = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('class', 'seal'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width=".8"/>'
    + Array.from({ length: 36 }, (_, i) => `<line x1="50" y1="6" x2="50" y2="10" stroke="currentColor" stroke-width=".8" transform="rotate(${i * 10} 50 50)"/>`).join('')
    + '<path d="M30 60l9-11 8 6 18-20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="68" cy="34" r="3" fill="currentColor"/>';
  s.style.color = 'var(--brass)';
  return s;
};

function draw() {
  if (!ctx.r?.ok) return;
  const all = P.certificates(ctx.r.records, setting('partnership.unit_class', 'units'));
  const showAll = location.hash === '#all';
  const list = (showAll ? all : all.filter(c => !c.cancelled)).slice().reverse();
  paint(
    h('div', { class: 'page-head' }, h('h1', {}, 'Partnership certificates'),
      h('p', { class: 'lede' }, 'A certificate is issued automatically to every partner when they are admitted, and again whenever their units change; the one before is cancelled. Each names the record entry that issued it. A certificate is evidence of a partner’s units: it is not a security, not negotiable, and transfers nothing.')),
    h('div', { class: 'cert-tools' },
      h('a', { href: showAll ? '#' : '#all', onclick: () => setTimeout(draw, 0) }, showAll ? 'Show only certificates in force' : `Show cancelled certificates too (${all.filter(c => c.cancelled).length})`),
      h('button', { class: 'secondary', onclick: () => print() }, 'Print')),
    h('div', { class: 'cert-list' }, list.length ? list.map(c => h('article', { class: `certificate${c.cancelled ? ' cancelled' : ''}`, id: `no-${c.number}`, 'aria-label': `Certificate number ${c.number}${c.cancelled ? ', cancelled' : ''}` },
      h('span', { class: 'units-box' }, `${c.units.toLocaleString()} units`),
      h('span', { class: 'no' }, `No. ${String(c.number).padStart(4, '0')}`),
      h('p', { class: 'kicker' }, 'Partnership certificate'),
      h('h2', {}, fullName()),
      h('p', { class: 'body' }, 'This certifies that', h('span', { class: 'who' }, displayName(c.partner)),
        `is a partner of ${fullName()}, a general partnership under the laws of the State of California, holding ${words(c.units)} (${c.units.toLocaleString()}) units of the partnership, on the terms of its partnership agreement. Transferable only as that agreement allows.`),
      h('div', { class: 'foot' },
        h('div', {}, h('div', {}, `Issued ${day(c.issued)}: ${c.why}`), h('div', {}, `Record entry ${c.seq}`), h('code', {}, c.record)),
        seal(),
        h('div', { class: 'r' }, c.cancelled ? h('div', {}, `Cancelled ${day(c.cancelled)}: ${c.cancelledBy}`) : h('div', {}, 'In force'), h('div', {}, 'Issued automatically from the partnership’s signed record')))))
      : h('p', { class: 'empty' }, 'No certificates yet.')));
  if (location.hash.startsWith('#no-')) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
onChange(draw); window.addEventListener('hashchange', draw); draw();
