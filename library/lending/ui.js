// The lending tab.
import { current, overdue } from './index.js';

export default function render(api) {
  const { h, state, params, me, $, day, when, who } = api;
  const now = new Date().toISOString();
  const except = params.value('lending.except');
  const things = Object.values(state.m.deeds || {}).filter(d => !d.retired && d.holder === null && !except.includes(d.id));
  const loans = state.m.lending?.loans || [];
  const sec = h('section', {}, h('h2', {}, 'Lending'),
    h('p', { class: 'hint' }, `Things the entity holds, lent to members for up to ${params.value('lending.max_days')} days. Register something as a deed held by the entity to lend it.`));
  if (!things.length) sec.append(h('p', { class: 'hint' }, 'Nothing to lend yet.'));
  sec.append(api.list({
    key: 'lending', items: things, noun: 'lending', mine: me ? (d) => current(state, d.id)?.by === me.id : null,
    text: (d) => `${d.id} ${d.title} ${d.description}`,
    sorts: [['Title, A–Z', api.sorts.byText((d) => d.title)], ['Available first', (a, b) => !!current(state, a.id) - !!current(state, b.id)]],
    render: (d => {
    const out = current(state, d.id);
    const mine = me && out?.by === me.id;
    return h('li', {}, h('h3', {}, d.title),
      h('p', { class: overdue(out, now) ? 'meta flag' : 'meta' }, out ? ['out with ', who(out.by), ` since ${day(out.at)}, due ${when(out.due)}${overdue(out, now) ? ' (overdue)' : ''}`] : 'available'),
      me?.status === 'active' ? h('div', { class: 'buttons' },
        !out ? [h('input', { id: `ln-${d.id}`, type: 'number', min: 1, max: params.value('lending.max_days'), placeholder: `${params.value('lending.default_days')} days`, style: 'width:7rem', 'aria-label': 'days' }),
          h('button', { onclick: () => { const v = $(`#ln-${d.id}`).value; api.sign('loan.borrow', { deed: d.id, ...(v ? { days: Number(v) } : {}) }, `Borrowing ${d.title}`); } }, 'Borrow')] : null,
        mine ? h('button', { class: 'quiet', onclick: () => api.sign('loan.return', { deed: d.id }, `Returning ${d.title}`) }, 'Return it') : null,
        mine && out.renewals < params.value('lending.max_renewals') ? h('button', { class: 'quiet', onclick: () => api.sign('loan.renew', { deed: d.id }, `Keeping ${d.title} longer`) }, 'Keep it longer') : null,
        out && !mine ? h('button', { class: 'quiet', onclick: () => { const r = prompt('Why recall it? (published)'); if (r) api.propose(`Recall ${d.title}`, [{ kind: 'loan.recall', deed: d.id, reason: r }]); } }, 'Propose recalling') : null) : null);
  }),
  }));
  if (loans.length) sec.append(h('details', {}, h('summary', {}, `Every loan (${loans.length})`), api.list({
    key: 'loans', items: loans, noun: 'loans', head: ['What', 'Who', 'Out', 'Back'],
    row: (l) => h('tr', {}, h('td', {}, state.m.deeds?.[l.deed]?.title || l.deed), h('td', {}, who(l.by)), h('td', {}, day(l.at)),
      h('td', {}, l.returned ? `${day(l.returned)}${l.how !== 'returned' ? ` · ${l.how}` : ''}` : `due ${day(l.due)}`)),
    mine: me ? (l) => l.by === me.id : null,
    text: (l) => `${l.deed} ${state.m.deeds?.[l.deed]?.title || ''} ${l.by}`,
    sorts: [['Newest first', api.sorts.newest()], ['Oldest first', api.sorts.oldest()]],
    filters: [{ label: 'Returned', options: [['Out or back', () => true], ['Still out', (l) => !l.returned], ['Returned', (l) => !!l.returned]] }],
  })));
  return sec;
}
