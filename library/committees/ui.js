// The committees tab.
import { members, needed } from './index.js';

function list(api) {
  const { h, state, me, $, day, link, who } = api;
  const at = state.head.at;
  const all = Object.values(state.m.committees || {}).filter(c => !c.dissolved);
  const active = Object.values(state.participants).filter(p => p.status === 'active').map(p => p.id);
  const sec = h('section', {}, h('h2', {}, 'Committees'),
    h('p', { class: 'hint' }, 'Bodies inside the entity. A committee acts only through the authority granted to it, and decides among itself by co-signature.'));
  if (!all.length) sec.append(h('p', { class: 'hint' }, 'No committees yet.'));
  sec.append(api.list({
    key: 'committees',
    edit: (c) => (api.me?.status === 'active' ? api.editForm('Edit this committee', [['title', 'Title', c.title], ['remit', 'Remit', c.remit, 'textarea'], ['needs', 'Decides by', String(c.needs), 'select', ['majority', 'all', '1', '2', '3', '4', '5']]], (ch) => api.propose(`Amend the committee ${c.title}`, [{ kind: 'committee.amend', committee: c.id, ...ch }])) : null), items: all, noun: 'committees', mine: me ? (c) => members(c, at).includes(me.id) : null,
    text: (c) => `${c.id} ${c.title} ${c.remit}`,
    sorts: [['Name, A–Z', api.sorts.byText((c) => c.title)], ['Newest first', api.sorts.newest((c) => c.created)], ['Most members', (a, b) => members(b, at).length - members(a, at).length]],
    render: (c => {
    const now = members(c, at);
    return h('li', {}, h('h3', {}, link(`committees/${c.id}`, c.title)),
      h('p', { class: 'meta' }, `${c.id} · ${now.length}${c.seats ? ` of ${c.seats}` : ''} member${now.length === 1 ? '' : 's'} · decides by ${c.needs} (${now.length ? needed(c.needs, now.length) : 0} signature${now.length && needed(c.needs, now.length) === 1 ? '' : 's'} now)`),
      now.length ? h('p', {}, now.map(who).reduce((a, b) => [a, ', ', b])) : h('p', { class: 'hint' }, 'Nobody on it.'),
      me && now.includes(me.id) ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => api.sign('committee.leave', { committee: c.id }, `Leaving ${c.title}`) }, 'Leave this committee')) : null);
  }),
  }));
  if (me?.status !== 'active') return sec;
  sec.append(h('details', {}, h('summary', {}, 'Propose a new committee'), h('div', { class: 'inline-form' },
    h('label', { for: 'cm-title' }, 'Name'), h('input', { id: 'cm-title', placeholder: 'Maintenance Committee' }),
    h('label', { for: 'cm-id' }, 'Id'), h('input', { id: 'cm-id', placeholder: 'maintenance' }),
    h('label', { for: 'cm-remit' }, 'What it is for'), h('textarea', { id: 'cm-remit', style: 'font-family:inherit' }),
    h('label', { for: 'cm-seats' }, 'Seats (empty: no limit)'), h('input', { id: 'cm-seats', type: 'number', min: 1 }),
    h('label', { for: 'cm-needs' }, 'How it decides'), h('select', { id: 'cm-needs' }, h('option', { value: 'majority' }, 'a majority of its members'), h('option', { value: 'all' }, 'all of its members'), h('option', { value: '1' }, 'any one member')),
    h('label', { for: 'cm-members' }, 'Members (optional)'), h('select', { id: 'cm-members', multiple: true, size: Math.min(6, active.length) }, active.map(id => h('option', { value: id }, id))),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const id = $('#cm-id').value.trim(), title = $('#cm-title').value.trim(), nv = $('#cm-needs').value;
      const e = { kind: 'committee.create', committee: id, title, needs: nv === '1' ? 1 : nv };
      if ($('#cm-remit').value.trim()) e.remit = $('#cm-remit').value.trim();
      if ($('#cm-seats').value) e.seats = Number($('#cm-seats').value);
      const picks = [...$('#cm-members').selectedOptions].map(o => ({ kind: 'committee.appoint', committee: id, member: o.value }));
      api.propose(`Create the ${title}`, [e, ...picks]);
    } }, 'Sign this proposal')))));
  return sec;
}

function one(api, id) {
  const { h, state, me, $, day, link, who } = api;
  const c = state.m.committees?.[id];
  if (!c) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `There is no committee ${id}.`), link('committees', 'Every committee'));
  const at = state.head.at, now = members(c, at);
  const active = Object.values(state.participants).filter(p => p.status === 'active' && !now.includes(p.id)).map(p => p.id);
  const grants = Object.values(state.m.authority?.grants || {}).filter(g => g.to.committee === id);
  const can = me?.status === 'active' && !c.dissolved;
  return h('section', {}, h('h2', {}, c.title),
    h('p', { class: 'meta' }, `${c.id} · created ${day(c.created)}${c.dissolved ? ` · dissolved ${day(c.dissolved)}` : ''} · decides by ${c.needs}`),
    c.remit ? h('p', { class: 'post-body' }, c.remit) : null,
    h('h3', {}, 'Members'), c.members.length ? h('ul', {}, c.members.map(m => h('li', {}, who(m.id), ` · ${day(m.since)}–${m.until && m.until <= at ? day(m.until) : 'now'}`,
      can && (!m.until || m.until > at) ? [' ', h('button', { class: 'quiet', onclick: () => api.propose(`Remove ${m.id} from the ${c.title}`, [{ kind: 'committee.remove', committee: id, member: m.id }]) }, 'Propose removing')] : null))) : h('p', { class: 'hint' }, 'Nobody has served on it.'),
    can && active.length ? h('div', { class: 'row' }, h('select', { id: 'cm-add', 'aria-label': 'Member to appoint' }, active.map(p => h('option', { value: p }, p))),
      h('button', { class: 'quiet', onclick: () => api.propose(`Appoint ${$('#cm-add').value} to the ${c.title}`, [{ kind: 'committee.appoint', committee: id, member: $('#cm-add').value }]) }, 'Propose appointing')) : null,
    grants.length ? [h('h3', {}, 'Authority granted to it'), h('ul', {}, grants.map(g => h('li', {}, link(`authority/${g.id}`, g.id), `: may ${g.may.join(', ')}${g.revoked ? ' (revoked)' : ''}`)))] : h('p', { class: 'hint' }, 'It holds no authority yet.'),
    can ? h('div', { class: 'buttons' }, h('button', { class: 'danger', onclick: () => confirm(`Propose dissolving the ${c.title}?`) && api.propose(`Dissolve the ${c.title}`, [{ kind: 'committee.dissolve', committee: id }]) }, 'Propose dissolving')) : null,
    h('p', {}, link('committees', 'Every committee')));
}

export const tabs = [{ id: 'committees', title: 'Committees', render: (api, path) => (path[0] ? one(api, path[0]) : list(api)) }];
