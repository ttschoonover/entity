// The badges tab.
export default function render(api) {
  const { h, state, me, $, day, who } = api;
  const all = Object.values(state.m.badges || {}).filter(b => !b.retired);
  const people = Object.values(state.participants).filter(p => p.status === 'active').map(p => p.id);
  const sec = h('section', {}, h('h2', {}, 'Badges'), h('p', { class: 'hint' }, 'Marks of recognition, given by the members. Anyone may give back a badge of their own.'));
  if (!all.length) sec.append(h('p', { class: 'hint' }, 'No badges yet.'));
  sec.append(api.list({
    key: 'badges',
    edit: (b) => (api.me?.status === 'active' ? api.editForm('Edit this badge', [['title', 'Title', b.title], ['description', 'Description', b.description, 'textarea']], (ch) => api.propose(`Amend the badge ${b.title}`, [{ kind: 'badge.amend', badge: b.id, ...ch }])) : null), items: all, noun: 'badges', mine: me ? (b) => !!b.holders[me.id] : null,
    text: (b) => `${b.id} ${b.title} ${b.description} ${Object.keys(b.holders).join(' ')}`,
    sorts: [['Title, A–Z', api.sorts.byText((b) => b.title)], ['Most held', (x, y) => Object.keys(y.holders).length - Object.keys(x.holders).length], ['Newest first', api.sorts.newest((b) => b.created)]],
    render: (b => {
    const holders = Object.entries(b.holders);
    return h('li', {}, h('h3', {}, b.title), b.description ? h('p', {}, b.description) : null,
      holders.length ? h('ul', {}, holders.map(([id, x]) => h('li', {}, who(id), ` · since ${day(x.since)}${x.note ? ` · ${x.note}` : ''}`,
        me && id === me.id ? [' ', h('button', { class: 'quiet', onclick: () => api.sign('badge.return', { badge: b.id }, `Giving back ${b.title}`) }, 'Give it back')] : null)))
        : h('p', { class: 'hint' }, 'Nobody holds it.'),
      me?.status === 'active' ? h('div', { class: 'row' }, h('select', { id: `bg-${b.id}`, 'aria-label': 'Award to' }, people.filter(p => !b.holders[p]).map(p => h('option', { value: p }, p))),
        h('button', { class: 'quiet', onclick: () => api.propose(`Award ${b.title} to ${$(`#bg-${b.id}`).value}`, [{ kind: 'badge.award', badge: b.id, to: $(`#bg-${b.id}`).value }]) }, 'Propose awarding')) : null);
  }),
  }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Propose a new badge'), h('div', { class: 'inline-form' },
    h('label', { for: 'bg-title' }, 'Title'), h('input', { id: 'bg-title', placeholder: 'Founding member' }),
    h('label', { for: 'bg-id' }, 'Id'), h('input', { id: 'bg-id', placeholder: 'founding-member' }),
    h('label', { for: 'bg-desc' }, 'What it recognises'), h('input', { id: 'bg-desc' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose(`Create the badge ${$('#bg-title').value.trim()}`,
      [{ kind: 'badge.create', badge: $('#bg-id').value.trim(), title: $('#bg-title').value.trim(), ...($('#bg-desc').value.trim() ? { description: $('#bg-desc').value.trim() } : {}) }]) }, 'Sign this proposal')))));
  return sec;
}
