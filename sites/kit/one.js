// one.js · a page that is one module, full width: the library of things on
// library.html, the wiki on wiki.html. The page names its module:
//   <main data-module="things">…<div id="view"></div></main>
// The module draws itself through its ui.js, exactly as on the Institutions
// page; its own links stay on this page (#/…), links elsewhere go there.
import { start, onChange, onSigned, ctx, h, $, me, moduleApi, enabled, institutionTitle, W } from './common.js';

const M = $('main').dataset.module;
let tab = null;

const split = (path) => { const [first, ...rest] = String(path).split('/'); return { first, rest: rest.join('/') }; };
const link = (path, ...kids) => {
  const { first, rest } = split(path);
  return h('a', { href: tab && first === tab.id ? `#/${rest}` : `hall.html#/${path}` }, ...kids);
};
const go = (path) => {
  const { first, rest } = split(path);
  if (tab && first === tab.id) location.hash = `#/${rest}`; else location.href = `hall.html#/${path}`;
};

function draw() {
  const view = $('#view');
  if (!ctx.r.ok) { view.replaceChildren(h('p', { class: 'empty' }, 'The record did not verify, so nothing is shown.')); return; }
  if (!enabled(M) || !tab) {
    view.replaceChildren(h('p', { class: 'empty' }, `${institutionTitle(M)} is not switched on here. The ${W().many} can add it by vote, under `, h('a', { href: 'hall.html#/modules' }, 'Institutions › Modules'), '.'));
    return;
  }
  // #open=Words opens the form whose heading starts with them (library.html#open=Lend).
  const opening = (location.hash.match(/^#open=(.+)$/) || [])[1];
  const path = opening ? [] : decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  let el;
  try { el = tab.render(moduleApi({ link, go, refresh: draw }), path); }
  catch (e) { el = h('section', {}, h('p', { class: 'hint' }, `This page could not be shown: ${e.message}`)); console.error(e); }
  view.replaceChildren(el);
  if (opening) { const d = [...view.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent.startsWith(decodeURIComponent(opening))); if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ block: 'start' }), 0); } }
  if (!me()) view.append(h('p', { class: 'fine sign-hint' }, 'Sign in at the top of the page to take part. ', h('a', { href: 'index.html#join' }, `New here? Join ${W().body}.`)));
}
// Not while someone is typing, or has a form open.
const busy = () => { const a = document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#view').contains(a)) || [...document.querySelectorAll('#view details[open]')].some(d => d.querySelector('input:not([type=checkbox]):not([type=radio]), textarea')); };

onSigned(() => draw());
await start();
if (ctx.r.ok && enabled(M)) {
  try {
    const mod = await import(`${ctx.r.base}modules/${M}/ui.js`);
    tab = (mod.tabs || []).find(t => t.id === M) || (mod.tabs || [])[0] || (typeof mod.default === 'function' ? { id: M, render: (api) => mod.default(api) } : null);
  } catch (e) { console.error(e); }
}
draw();
let last = location.hash;
addEventListener('hashchange', () => { draw(); if (last.split('/')[1] !== location.hash.split('/')[1]) window.scrollTo({ top: 0 }); last = location.hash; });
onChange(() => { if (!busy() && !document.querySelector('dialog[open]')) draw(); });
