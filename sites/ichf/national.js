// national.js · one national federation, on the ICHF's site: its names in each
// of its official languages, its motto, its officers, its open votes and its
// wiki. national.html?e=KEY (the key in entities.json).
import { start, onChange, onSigned, ctx, h, $, joinDialog, withEntity } from './common.js';
import { drawOpen } from './floor.js';
import { t, lang, setLang, names, officialLanguages, half, LANGS } from './i18n.js';
const NAV = { Federations: 'Fédérations', 'Labor credits': 'Crédits de travail', Letters: 'Lettres', Chat: 'Discussion', 'Sign in': 'Se connecter' };

const now = () => new Date().toISOString();
const person = (x, id) => { const tt = x.r.state.m.titles?.[id]; return (typeof tt === 'string' ? tt : tt?.title) || x.r.state.participants[id]?.name || id; };

function draw() {
  const sw = document.querySelector('.masthead .lang-switch') || (() => { const s = h('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Language · Langue' }); document.querySelector('.masthead')?.append(s); return s; })();
  sw.replaceChildren(...['en', 'fr'].map(l => h('button', { type: 'button', 'aria-pressed': String(lang() === l), lang: l, onclick: () => { setLang(l); draw(); } }, l === 'en' ? 'EN' : 'FR')));
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const a of document.querySelectorAll('.masthead nav a, .masthead .who a, .masthead .who button')) { if (a.closest('#entities')) continue; const en = a.dataset.en || a.textContent.trim(); if (en in NAV) { a.dataset.en = en; a.textContent = lang() === 'fr' ? NAV[en] : en; } }
  const x = ctx.all.find(e => e.key === ctx.key) || ctx.all[1];
  if (!x?.r?.ok) { $('#name').textContent = t('unreachable'); return; }
  const i = ctx.all.indexOf(x) - 1, langs = officialLanguages(x.r), own = names(x.r), shown = names(x.r, lang());
  document.body.style.setProperty('--h', `var(--f${Math.max(0, i) % 4})`);
  document.title = `${own.acronym} · ICHF`;
  $('#name').textContent = shown.name; $('#name').lang = shown.lang;
  $('#names').replaceChildren(...langs.filter(l => l !== shown.lang).map(l => { const n = names(x.r, l); return n.lang === l ? h('p', { class: 'other-name', lang: l }, `${n.name} (${n.acronym})`) : null; }));
  $('#motto').textContent = shown.motto || own.motto;
  const bn = document.getElementById('brand-name'), bm = document.getElementById('brand-motto'); if (bn) bn.textContent = shown.name; if (bm) bm.textContent = shown.motto || own.motto;
  $('#langs').replaceChildren(h('span', { class: 'fine' }, `${t('languages')}: `), ...langs.map((l, k) => h('span', { class: `lang-chip${k === 0 ? ' first' : ''}` }, `${LANGS[l] || l}`)));
  const me = ctx.ident?.id, mine = me && x.r.state.participants[me];
  $('#actions').replaceChildren(h('a', { class: 'secondary', href: `hall.html?e=${encodeURIComponent(x.key)}` }, t('institutions')),
    !mine ? h('button', { class: 'primary', type: 'button', onclick: async () => { if (await withEntity(x.key, joinDialog)) draw(); } }, t('apply')) : null);
  const offices = Object.values(x.r.state.m.offices || {}).filter(o => !o.abolished);
  $('#officer-list').replaceChildren(...offices.map(o => h('div', { class: 'officer' }, h('h3', {}, half(o.title)),
    h('p', {}, o.holders.filter(k => !k.until || k.until > now()).map(k => person(x, k.id)).join(', ') || h('span', { class: 'vacant' }, t('vacant'))))));
  drawOpen($('#votes'), { key: x.key, empty: t('nothingOpen') });
  const pages = Object.entries(x.r.state.m.wiki?.pages || {});
  $('#pages').replaceChildren(h('div', { class: 'text-cards' }, ...pages.map(([id, p]) => { const v = p.versions.at(-1);
    return h('a', { class: 'text-card', href: `hall.html?e=${encodeURIComponent(x.key)}#/wiki/${id}` }, h('span', { class: 'text-lang' }, own.acronym), h('b', {}, v.title), h('span', { class: 'fine' }, `v${v.n}`)); })));
}
onChange(draw);
onSigned(draw);
await start();
draw();
