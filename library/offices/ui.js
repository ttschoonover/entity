// The offices section of the page.
import { current } from './index.js';

export default function render(api) {
  const { h, state, me, when, $ } = api;
  const at = state.head.at;
  const all = Object.values(state.m.offices || {}).filter(o => !o.abolished);
  const active = Object.values(state.participants).filter(p => p.status === 'active').map(p => p.id);
  const sec = h('section', {}, h('h2', {}, 'Offices'));
  const row = (o) => {
    const now = current(o, at);
    return h('li', {},
      h('h3', {}, api.link ? api.link(`offices/${o.id}`, o.title) : o.title),
      h('p', { class: 'meta' }, `${o.id} · ${now.length} of ${o.seats} seat${o.seats === 1 ? '' : 's'} filled${o.term_days ? ` · ${o.term_days}-day terms` : ''}`),
      now.length ? h('ul', {}, now.map(x => h('li', {}, x.id, x.until ? ` · until ${when(x.until)}` : ''))) : h('p', { class: 'hint' }, 'Vacant.'),
      me && now.some(x => x.id === me.id)
        ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => api.sign('office.resign', { office: o.id }, `Your resignation as ${o.title}`) }, 'Resign'))
        : null);
  };
  sec.append(api.list({
    key: 'offices',
    edit: (o) => (api.me?.status === 'active' ? api.editForm('Edit this office', [['title', 'Title', o.title], ['seats', 'Seats', o.seats, 'number'], ['term_days', 'Term in days (empty for none)', o.term_days, 'number']], (ch) => api.propose(`Amend the office ${o.title}`, [{ kind: 'office.amend', office: o.id, ...ch }])) : null), items: all, noun: 'offices', empty: 'No offices yet.', render: row,
    mine: me ? (o) => current(o, at).some(x => x.id === me.id) : null,
    text: (o) => `${o.id} ${o.title} ${current(o, at).map(x => x.id).join(' ')}`,
    sorts: [['Title, A–Z', api.sorts.byText((o) => o.title)], ['Vacant first', (a, b) => (current(a, at).length / a.seats) - (current(b, at).length / b.seats)], ['Newest first', api.sorts.newest((o) => o.created)]],
    filters: [{ label: 'Seats', options: [['Filled or not', () => true], ['With a vacancy', (o) => current(o, at).length < o.seats], ['Full', (o) => current(o, at).length >= o.seats]] }],
  }));
  if (me?.status !== 'active') return sec;
  sec.append(h('details', {}, h('summary', {}, 'Propose a new office'),
    h('div', { class: 'inline-form' },
      h('label', { for: 'of-title' }, 'Title'), h('input', { id: 'of-title', placeholder: 'Treasurer' }),
      h('label', { for: 'of-id' }, 'Id'), h('input', { id: 'of-id', placeholder: 'treasurer' }),
      h('label', { for: 'of-seats' }, 'Seats'), h('input', { id: 'of-seats', type: 'number', min: 1, max: 50, value: 1 }),
      h('label', { for: 'of-term' }, 'Term in days (empty: no end)'), h('input', { id: 'of-term', type: 'number', min: 1 }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const e = { kind: 'office.create', office: $('#of-id').value.trim(), title: $('#of-title').value.trim(), seats: Number($('#of-seats').value) };
        if ($('#of-term').value) e.term_days = Number($('#of-term').value);
        api.propose(`Create the office of ${e.title}`, [e]);
      } }, 'Sign this proposal')))));
  if (all.length) {
    sec.append(h('details', {}, h('summary', {}, 'Propose an appointment or a removal'),
      h('div', { class: 'inline-form' },
        h('label', { for: 'of-which' }, 'Office'), h('select', { id: 'of-which' }, all.map(o => h('option', { value: o.id }, o.title))),
        h('label', { for: 'of-who' }, 'Person'), h('select', { id: 'of-who' }, active.map(id => h('option', { value: id }, id))),
        h('div', { class: 'buttons' },
          h('button', { onclick: () => api.propose(`Appoint ${$('#of-who').value} as ${$('#of-which').selectedOptions[0].text}`, [{ kind: 'office.fill', office: $('#of-which').value, holder: $('#of-who').value }]) }, 'Propose appointing'),
          h('button', { class: 'quiet', onclick: () => api.propose(`Remove ${$('#of-who').value} as ${$('#of-which').selectedOptions[0].text}`, [{ kind: 'office.vacate', office: $('#of-which').value, holder: $('#of-who').value }]) }, 'Propose removing')))));
  }
  return sec;
}

// One office: every holder it has had, and any authority granted to it.
function one(api, id) {
  const { h, state, day, link, who } = api;
  const o = state.m.offices?.[id];
  if (!o) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `There is no office ${id}.`), link('offices', 'Every office'));
  const at = state.head.at;
  const grants = Object.values(state.m.authority?.grants || {}).filter(g => g.to.office === id);
  return h('section', {}, h('h2', {}, o.title),
    h('p', { class: 'meta' }, `${o.id} · ${o.seats} seat${o.seats === 1 ? '' : 's'}${o.term_days ? ` · ${o.term_days}-day terms` : ''} · created ${day(o.created)}${o.abolished ? ` · abolished ${day(o.abolished)}` : ''}`),
    h('h3', {}, 'Holders'), o.holders.length ? h('ul', {}, o.holders.map(x => h('li', {}, who(x.id), ` · ${day(x.since)}–${x.until && x.until <= at ? day(x.until) : x.until ? `now (until ${day(x.until)})` : 'now'}`))) : h('p', { class: 'hint' }, 'Nobody has held it.'),
    grants.length ? [h('h3', {}, 'Authority granted to it'), h('ul', {}, grants.map(g => h('li', {}, link(`authority/${g.id}`, g.id), `: may ${g.may.join(', ')}${g.revoked ? ' (revoked)' : ''}`)))] : null,
    h('p', {}, link('offices', 'Every office')));
}

export const tabs = [{ id: 'offices', title: 'Offices', render: (api, path) => (path[0] ? one(api, path[0]) : render(api)) }];
