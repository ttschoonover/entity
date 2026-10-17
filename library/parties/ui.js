// The parties tab: every party with its leader, members and platform, and the
// buttons to found, join, leave or call for a new leader.

const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);
export default function render(api) {
  const { h, state, me, $, day, who, params } = api;
  const all = Object.values(state.m.parties?.parties || {});
  const live = all.filter(p => !p.dissolved);
  const min = params.value('parties.min_members');
  const mine = me ? live.find(p => p.members.some(m => m.id === me.id && !m.until)) : null;
  const active = (id) => state.participants[id]?.status === 'active';
  const membersOf = (p) => p.members.filter(m => !m.until && active(m.id)).map(m => m.id);
  const sec = h('section', {}, h('h2', {}, 'Parties'),
    h('p', { class: 'hint' }, `Groups of members who stand together. A party counts as registered once it has ${min} member${min === 1 ? '' : 's'}.${params.value('parties.exclusive') ? ' A member belongs to one party at a time.' : ''}`));
  if (!live.length) sec.append(h('p', { class: 'hint' }, 'No parties yet.'));
  sec.append(api.list({
    key: 'parties', items: live, noun: 'parties', mine: me ? (p) => p === mine : null,
    text: (p) => `${p.id} ${p.title} ${p.platform} ${membersOf(p).map(x => nm(api, x)).join(' ')}`,
    sorts: [['Most members', (x, y) => membersOf(y).length - membersOf(x).length], ['Name, A–Z', api.sorts.byText((p) => p.title)], ['Newest first', api.sorts.newest((p) => p.founded)]],
    render: (p) => {
      const ms = membersOf(p), am = me && ms.includes(me.id), asked = me && p.asking.includes(me.id), lead = me && p.leader === me.id;
      const calls = Object.entries(p.calls || {}).filter(([, v]) => v.length);
      return h('li', {},
        h('h3', {}, p.title, ' ', h('span', { class: 'hint' }, ms.length >= min ? '· registered' : `· ${ms.length} of ${min} members to register`)),
        h('p', { class: 'meta' }, 'Led by ', who(p.leader), ` · founded ${day(p.founded)} · ${p.joining === 'approval' ? 'joining by the leader’s approval' : 'open to join'}`),
        p.platform ? h('details', {}, h('summary', {}, 'Platform'), h('div', { class: 'post-body' }, p.platform)) : null,
        h('p', {}, `${ms.length} member${ms.length === 1 ? '' : 's'}: `, ...ms.flatMap((x, i) => [i ? ', ' : '', who(x)])),
        calls.length ? h('p', { class: 'hint' }, 'Calls for a new leader: ', calls.map(([to, v]) => `${nm(api, to)} (${v.length} of ${Math.floor(ms.length / 2) + 1} needed)`).join('; ')) : null,
        lead && p.asking.length ? h('div', {}, h('p', {}, 'Asking to join:'), h('ul', {}, p.asking.map(x => h('li', {}, who(x), ' ',
          h('button', { class: 'quiet', onclick: () => api.sign('party.accept', { party: p.id, member: x }, `Admitting ${nm(api, x)} to ${p.title}`) }, 'Admit'))))) : null,
        me?.status === 'active' ? h('div', { class: 'buttons' },
          !am && !asked && !mine ? h('button', { class: 'quiet', onclick: () => api.sign('party.join', { party: p.id }, p.joining === 'approval' ? `Asking to join ${p.title}` : `Joining ${p.title}`) }, p.joining === 'approval' ? 'Ask to join' : 'Join') : null,
          am || asked ? h('button', { class: 'quiet', onclick: () => api.sign('party.leave', { party: p.id }, `Leaving ${p.title}`) }, asked ? 'Withdraw request' : 'Leave') : null,
          am && !lead && ms.length > 1 ? [h('select', { id: `pl-${p.id}`, 'aria-label': 'New leader' }, ms.filter(x => x !== p.leader).map(x => h('option', { value: x }, nm(api, x)))),
            h('button', { class: 'quiet', onclick: () => api.sign('party.leader', { party: p.id, to: $(`#pl-${p.id}`).value }, `Calling for a new leader of ${p.title}`) }, 'Call for this leader')] : null,
          lead && ms.length > 1 ? [h('select', { id: `ph-${p.id}`, 'aria-label': 'Hand over to' }, ms.filter(x => x !== me.id).map(x => h('option', { value: x }, nm(api, x)))),
            h('button', { class: 'quiet', onclick: () => api.sign('party.leader', { party: p.id, to: $(`#ph-${p.id}`).value }, `Handing over ${p.title}`) }, 'Hand over the lead')] : null,
          lead ? h('button', { class: 'quiet', onclick: () => { const t = prompt('The platform', p.platform); if (t !== null) api.sign('party.platform', { party: p.id, platform: t }, `New platform for ${p.title}`); } }, 'Rewrite the platform') : null) : null,
        me?.status === 'active' ? h('p', {}, h('button', { class: 'linklike', onclick: () => { const why = prompt(`Why should ${p.title} be dissolved? The reason is published.`); if (why) api.propose(`Dissolve ${p.title}`, [{ kind: 'party.dissolve', party: p.id, reason: why }]); } }, 'Propose dissolving it')) : null);
    },
  }));
  const gone = all.filter(p => p.dissolved);
  if (gone.length) sec.append(h('details', {}, h('summary', {}, `Dissolved parties (${gone.length})`), h('ul', {}, gone.map(p => h('li', {}, `${p.title}: ${p.dissolved.reason}, ${day(p.dissolved.at)}`)))));
  if (me?.status === 'active' && !mine) sec.append(h('details', {}, h('summary', {}, 'Found a party'), h('div', { class: 'inline-form' },
    h('label', { for: 'pa-title' }, 'Name'), h('input', { id: 'pa-title', placeholder: 'The Green Party' }),
    h('label', { for: 'pa-id' }, 'Id'), h('input', { id: 'pa-id', placeholder: 'greens' }),
    h('label', { for: 'pa-join' }, 'Who may join'), h('select', { id: 'pa-join' }, h('option', { value: 'open' }, 'Any member'), h('option', { value: 'approval' }, 'Those the leader admits')),
    h('label', { for: 'pa-plat' }, 'Platform'), h('textarea', { id: 'pa-plat', rows: 4 }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('party.found', { party: $('#pa-id').value.trim(), title: $('#pa-title').value.trim(), joining: $('#pa-join').value, ...($('#pa-plat').value.trim() ? { platform: $('#pa-plat').value.trim() } : {}) }, `Founding ${$('#pa-title').value.trim()}`) }, 'Found it')))));
  return sec;
}
