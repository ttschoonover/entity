// The wiki tab: #/wiki, #/wiki/PAGE, #/wiki/PAGE/VERSION.
import { latest, diffLines, categoryOf } from './index.js';

const redline = (h, a, b) => h('pre', { class: 'redline' }, diffLines(a, b).map(([k, line]) =>
  h(k === '+' ? 'ins' : k === '-' ? 'del' : 'span', {}, `${k} ${line}\n`)));

function list(api) {
  const { h, state, me, $, day, link } = api;
  const pages = Object.values(state.m.wiki?.pages || {});
  const cats = [...new Set(pages.map(categoryOf))].sort();
  const sec = h('section', {}, h('h2', {}, 'Wiki'), h('p', { class: 'hint' }, 'Pages any member may write. Every version is signed and kept for good. A page can be enacted as a statute by decision.'));
  sec.append(api.list({
    key: 'wiki', items: pages, noun: 'pages', empty: 'No pages yet.',
    render: (p) => h('li', {}, h('h3', {}, link(`wiki/${p.id}`, latest(p).title), h('span', { class: 'category' }, categoryOf(p))),
      h('p', { class: 'meta' }, `${p.id} · version ${latest(p).n} · edited ${day(latest(p).at)}`, p.statute ? h('span', { class: 'badge', style: 'margin-left:.6rem' }, `statute: version ${p.statute.version}`) : null)),
    text: (p) => `${p.id} ${latest(p).title} ${latest(p).body} ${categoryOf(p)}`,
    sorts: [['Recently edited', api.sorts.newest((p) => latest(p).at)], ['Title, A–Z', api.sorts.byText((p) => latest(p).title)], ['Most versions', (a, b) => b.versions.length - a.versions.length], ['Oldest first', api.sorts.oldest((p) => p.created)]],
    filters: [{ label: 'Category', options: [['Every category', () => true], ...cats.map(c => [c, (p) => categoryOf(p) === c])] },
      { label: 'Law', options: [['Law or not', () => true], ['Statutes only', (p) => !!p.statute], ['Not law', (p) => !p.statute]] }],
  }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Write a new page'), h('div', { class: 'inline-form' },
    h('label', { for: 'wk-title' }, 'Title'), h('input', { id: 'wk-title' }),
    h('label', { for: 'wk-id' }, 'Id (its address)'), h('input', { id: 'wk-id', placeholder: 'house-rules' }),
    h('label', { for: 'wk-cat' }, 'Category'), h('input', { id: 'wk-cat', list: 'wk-cats', placeholder: 'recipes, how-to, policies…' }), h('datalist', { id: 'wk-cats' }, cats.filter(c => c !== 'Uncategorised').map(c => h('option', { value: c }))),
    h('label', { for: 'wk-body' }, 'Text'), h('textarea', { id: 'wk-body', style: 'font-family:inherit;min-height:12rem' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('wiki.edit', { page: $('#wk-id').value.trim(), title: $('#wk-title').value.trim(), body: $('#wk-body').value, base: 0, ...($('#wk-cat').value.trim() ? { category: $('#wk-cat').value.trim() } : {}) }, 'Your new page') }, 'Sign this page')))));
  return sec;
}

function one(api, id, n) {
  const { h, state, me, $, when, link, who } = api;
  const p = state.m.wiki?.pages?.[id];
  if (!p) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `There is no page ${id}.`), link('wiki', 'Every page'));
  const top = latest(p), v = n ? p.versions[n - 1] : top;
  if (!v) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `${id} has no version ${n}.`), link(`wiki/${id}`, 'The page'));
  const prev = v.n > 1 ? p.versions[v.n - 2] : null;
  const law = p.statute ? p.versions[p.statute.version - 1] : null;
  const can = me?.status === 'active';
  return h('section', {}, h('p', { class: 'fine' }, link('wiki', 'Wiki'), ' › ', categoryOf(p)), h('h2', {}, v.title),
    h('p', { class: 'meta' }, `version ${v.n} of ${top.n} · by `, who(v.by), ` · ${when(v.at)}${v.note ? ` · ${v.note}` : ''}`),
    law ? h('p', { class: law === v ? 'state-carried' : 'flag' }, law === v ? `This version is the statute in force, enacted ${when(p.statute.at)} by ${p.statute.by}.` : ['The statute in force is ', link(`wiki/${id}/${law.n}`, `version ${law.n}`), '. This text is a draft; enacting it amends the statute.']) : null,
    h('div', { class: 'post-body wiki-body' }, v.body),
    law && law !== v ? h('details', {}, h('summary', {}, `How this differs from the statute (version ${law.n})`), redline(h, law.body, v.body)) : null,
    prev ? h('details', {}, h('summary', {}, `What changed from version ${prev.n}`), redline(h, prev.body, v.body)) : null,
    h('h3', {}, 'History'), h('ul', {}, p.versions.slice().reverse().map(x => h('li', {}, link(`wiki/${id}/${x.n}`, `version ${x.n}`), ` · `, who(x.by), ` · ${when(x.at)}${x.note ? ` · ${x.note}` : ''}`,
      p.statute?.version === x.n ? h('strong', {}, ' · the statute') : ''))),
    p.enactments.length ? [h('h3', {}, 'As law'), h('ul', {}, p.enactments.map(x => h('li', {}, `${when(x.at)}: version ${x.version} ${x.action} by ${x.by}${x.reason ? ` (${x.reason})` : ''}`)))] : null,
    can && v === top ? h('details', {}, h('summary', {}, 'Edit this page'), h('div', { class: 'inline-form' },
      h('label', { for: 'wk-t' }, 'Title'), h('input', { id: 'wk-t', value: top.title }),
      h('label', { for: 'wk-c' }, 'Category'), h('input', { id: 'wk-c', value: top.category || '' }),
      h('label', { for: 'wk-b' }, 'Text'), h('textarea', { id: 'wk-b', style: 'font-family:inherit;min-height:14rem' }, top.body),
      h('label', { for: 'wk-n' }, 'What you changed (optional, public)'), h('input', { id: 'wk-n' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('wiki.edit', { page: id, title: $('#wk-t').value.trim(), body: $('#wk-b').value, base: top.n, ...($('#wk-n').value.trim() ? { note: $('#wk-n').value.trim() } : {}), ...($('#wk-c').value.trim() ? { category: $('#wk-c').value.trim() } : {}) }, `Your edit to ${top.title}`) }, 'Sign this version')))) : null,
    can ? h('div', { class: 'buttons' },
      p.statute?.version !== v.n ? h('button', { class: 'quiet', onclick: () => api.propose(`${p.statute ? 'Amend' : 'Enact'} ${v.title} (version ${v.n})`, [{ kind: 'wiki.enact', page: id, version: v.n }]) }, p.statute ? `Propose making version ${v.n} the statute` : `Propose enacting version ${v.n} as a statute`) : null,
      p.statute ? h('button', { class: 'danger', onclick: () => { const r = prompt('Why repeal it? (published)'); if (r !== null) api.propose(`Repeal ${v.title}`, [{ kind: 'wiki.repeal', page: id, ...(r ? { reason: r } : {}) }]); } }, 'Propose repealing') : null) : null,
    h('p', {}, link('wiki', 'Every page')));
}

export const tabs = [{ id: 'wiki', title: 'Wiki', render: (api, path) => (path[0] ? one(api, path[0], path[1] ? Number(path[1]) : null) : list(api)) }];
