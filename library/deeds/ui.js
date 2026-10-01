// The deeds tab.
import { mode, passable } from './index.js';

export default function render(api) {
  const { h, state, params, me, $, day, who } = api;
  const deeds = Object.values(state.m.deeds || {}).filter(d => !d.retired);
  const others = Object.values(state.participants).filter(p => p.status === 'active' && p.id !== me?.id).map(p => p.id);
  const m = mode(params);
  const modeText = { optional: 'Each deed says whether its holder may pass it on.', always: 'Every deed may be passed on by its holder.', never: 'No deed may be passed on without a decision.' }[m];
  const sec = h('section', {}, h('h2', {}, 'Deeds'), h('p', { class: 'hint' }, `What the entity has registered, and who holds each. ${modeText}`));
  const row = (d) => {
    const mine = me && d.holder === me.id;
    const can = passable(d, params);
    return h('li', {}, h('h3', {}, d.title),
      h('p', { class: 'meta' }, `${d.id} · held by `, d.holder ? (who ? who(d.holder) : d.holder) : 'the entity', ` · registered ${day(d.granted)} · ${can.ok ? 'may be passed on' : 'moves only by decision'}`),
      d.description ? h('p', {}, d.description) : null,
      h('details', {}, h('summary', {}, 'History'), h('ul', {}, d.history.map(x => h('li', {}, `${day(x.at)}: to ${x.to || 'the entity'}, ${x.how}`)))),
      mine ? h('div', { class: 'buttons' },
        can.ok && others.length ? h('select', { id: `dd-${d.id}`, 'aria-label': 'Pass to' }, others.map(id => h('option', { value: id }, id))) : null,
        can.ok && others.length ? h('button', { class: 'quiet', onclick: () => api.sign('deed.transfer', { deed: d.id, to: $(`#dd-${d.id}`).value }, `Passing ${d.title} to ${$(`#dd-${d.id}`).value}`) }, 'Pass on') : null,
        h('button', { class: 'quiet', onclick: () => api.sign('deed.release', { deed: d.id }, `Giving ${d.title} back to the entity`) }, 'Give back')) : null);
  };
  sec.append(api.list({
    key: 'deeds',
    edit: (d) => (api.me?.status === 'active' && !d.retired ? api.editForm('Edit this deed', [['title', 'Title', d.title], ['description', 'Description', d.description, 'textarea']], (ch) => api.propose(`Amend the deed ${d.title}`, [{ kind: 'deed.amend', deed: d.id, ...ch }])) : null), items: deeds, noun: 'deeds', empty: 'Nothing registered yet.', render: row,
    mine: me ? (d) => d.holder === me.id : null,
    text: (d) => `${d.id} ${d.title} ${d.description} ${d.holder || 'entity'}`,
    sorts: [['Title, A–Z', api.sorts.byText((d) => d.title)], ['Newest first', api.sorts.newest((d) => d.granted)], ['Oldest first', api.sorts.oldest((d) => d.granted)]],
    filters: [{ label: 'Held by', options: [['Held by anyone', () => true], ['Held by the entity', (d) => d.holder === null], ['Held by a member', (d) => d.holder !== null]] },
      { label: 'Passing on', options: [['Passable or not', () => true], ['May be passed on', (d) => passable(d, params).ok], ['Only by decision', (d) => !passable(d, params).ok]] }],
  }));
  if (me?.status !== 'active') return sec;
  sec.append(h('details', {}, h('summary', {}, 'Propose registering something'), h('div', { class: 'inline-form' },
    h('label', { for: 'dd-title' }, 'What it is'), h('input', { id: 'dd-title', placeholder: 'Room 3' }),
    h('label', { for: 'dd-id' }, 'Id'), h('input', { id: 'dd-id', placeholder: 'room-3' }),
    h('label', { for: 'dd-desc' }, 'Description'), h('textarea', { id: 'dd-desc', style: 'font-family:inherit' }),
    h('label', { for: 'dd-to' }, 'Held by'), h('select', { id: 'dd-to' }, h('option', { value: '' }, 'the entity'), Object.values(state.participants).filter(p => p.status === 'active').map(p => h('option', { value: p.id }, p.id))),
    m === 'optional' ? [h('label', { for: 'dd-tr' }, 'May its holder pass it on?'), h('select', { id: 'dd-tr' },
      h('option', { value: '' }, `as the entity's default (${params.value('deeds.default_transferable') ? 'yes' : 'no'})`), h('option', { value: 'true' }, 'yes'), h('option', { value: 'false' }, 'no, only by decision'))] : null,
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const e = { kind: 'deed.grant', deed: $('#dd-id').value.trim(), title: $('#dd-title').value.trim(), description: $('#dd-desc').value.trim() || undefined, to: $('#dd-to').value || null };
      const tr = $('#dd-tr')?.value; if (tr) e.transferable = tr === 'true';
      api.propose(`Register ${e.title}`, [e]);
    } }, 'Sign this proposal')))));
  return sec;
}
