// The shares tab: each class's cap table, your holdings first.
import { outstanding } from './index.js';

export default function render(api) {
  const { h, state, me, $, day, who, params } = api;
  const classes = Object.values(state.m.shares?.classes || {});
  const people = Object.values(state.participants).filter(p => p.status === 'active').map(p => p.id);
  const sec = h('section', {}, h('h2', {}, 'Shares'), h('p', { class: 'hint' }, 'Who holds what. Shares are issued, redeemed and paid dividends only by decision; transferable ones may also be passed on by their holders.'));
  if (!classes.length) sec.append(h('p', { class: 'hint' }, 'No share classes yet.'));
  for (const c of classes) {
    const total = outstanding(c);
    const rows = Object.entries(c.holders);
    const mine = me ? c.holders[me.id] || 0 : 0;
    sec.append(h('h3', {}, c.title),
      me?.status === 'active' ? api.editForm('Edit this class', [['title', 'Title', c.title], ['voting', 'Voting', c.voting, 'bool'], ['transferable', 'Transferable', c.transferable, 'bool']], (ch) => api.propose(`Amend the share class ${c.title}`, [{ kind: 'share.amend', class: c.id, ...ch }])) : null,
      h('p', { class: 'meta' }, `${c.id} · ${total} outstanding · ${c.voting ? 'voting' : 'non-voting'} · ${c.transferable ? 'transferable' : 'not transferable'}${mine ? ` · you hold ${mine} (${((mine / total) * 100).toFixed(1)}%)` : ''}`),
      rows.length ? api.list({
        key: `shares:${c.id}`, items: rows, noun: 'holders', head: ['Holder', 'Shares', 'Of the class'],
        row: ([id, n]) => h('tr', {}, h('td', {}, who(id)), h('td', {}, String(n)), h('td', {}, `${((n / total) * 100).toFixed(1)}%`)),
        mine: me ? ([id]) => id === me.id : null, text: ([id]) => `${id} ${api.nameOf(id)}`,
        sorts: [['Most first', (a, b) => b[1] - a[1]], ['Fewest first', (a, b) => a[1] - b[1]], ['Holder, A–Z', api.sorts.byText(([id]) => id)]],
      }) : h('p', { class: 'hint' }, 'None issued.'),
      me && mine && c.transferable ? h('div', { class: 'row' },
        h('select', { id: `sh-to-${c.id}`, 'aria-label': 'To' }, people.filter(p => p !== me.id).map(p => h('option', { value: p }, p))),
        h('input', { id: `sh-n-${c.id}`, type: 'number', min: 1, max: mine, value: 1, style: 'width:6rem', 'aria-label': 'How many' }),
        h('button', { class: 'quiet', onclick: () => api.sign('share.transfer', { class: c.id, to: $(`#sh-to-${c.id}`).value, count: Number($(`#sh-n-${c.id}`).value) }, `Passing ${c.title} shares`) }, 'Pass on')) : null);
  }
  const hist = state.m.shares?.history || [];
  if (hist.length) sec.append(h('details', {}, h('summary', {}, `History (${hist.length})`), api.list({ key: 'shares-history', items: hist, noun: 'events', head: ['When', 'What', 'By'],
    row: (x) => h('tr', {}, h('td', {}, day(x.at)), h('td', {}, x.what), h('td', {}, x.by)), text: (x) => x.what, sorts: [['Newest first', api.sorts.newest()], ['Oldest first', api.sorts.oldest()]] })));
  if (me?.status !== 'active') return sec;
  sec.append(h('details', {}, h('summary', {}, 'Propose'), h('div', { class: 'inline-form' },
    h('label', { for: 'sh-what' }, 'What'), h('select', { id: 'sh-what' }, h('option', { value: 'issue' }, 'Issue shares'), h('option', { value: 'redeem' }, 'Redeem shares'),
      params.has('value.name') ? h('option', { value: 'dividend' }, 'Pay a dividend') : null, h('option', { value: 'class' }, 'Create a class')),
    h('label', { for: 'sh-class' }, 'Class id'), h('input', { id: 'sh-class', list: 'sh-classes', placeholder: 'member' }), h('datalist', { id: 'sh-classes' }, classes.map(c => h('option', { value: c.id }))),
    h('label', { for: 'sh-who' }, 'Member (issue or redeem)'), h('select', { id: 'sh-who' }, people.map(p => h('option', { value: p }, p))),
    h('label', { for: 'sh-n' }, 'Count, or dividend per share'), h('input', { id: 'sh-n', type: 'number', min: 0 }),
    h('label', { for: 'sh-title' }, 'Title (new class)'), h('input', { id: 'sh-title', placeholder: 'Member shares' }),
    h('label', { style: 'font-weight:400' }, h('input', { type: 'checkbox', id: 'sh-voting', checked: true, style: 'width:auto;margin-right:.5rem' }), 'Voting (new class)'),
    h('label', { style: 'font-weight:400' }, h('input', { type: 'checkbox', id: 'sh-transferable', style: 'width:auto;margin-right:.5rem' }), 'Transferable (new class)'),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const what = $('#sh-what').value, c = $('#sh-class').value.trim(), n = Number($('#sh-n').value), m = $('#sh-who').value;
      const e = what === 'class' ? { kind: 'share.class', class: c, title: $('#sh-title').value.trim(), voting: $('#sh-voting').checked, transferable: $('#sh-transferable').checked }
        : what === 'issue' ? { kind: 'share.issue', class: c, to: m, count: n }
        : what === 'redeem' ? { kind: 'share.redeem', class: c, from: m, count: n }
        : { kind: 'share.dividend', class: c, per_share: n };
      api.propose(api.registry.effects.get(e.kind).describe(e), [e]);
    } }, 'Sign this proposal')))));
  return sec;
}
