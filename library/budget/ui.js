// The budget tab: every line, what is left on it, and every payment.
import { spent, left } from './index.js';

export default function render(api) {
  const { h, state, params, me, $, day, when } = api;
  const d = params.value('budget.decimals'), cur = params.value('budget.currency');
  const fmt = (n) => `${(n / 10 ** d).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
  const parse = (s) => Math.round(Number(s) * 10 ** d);
  const lines = Object.values(state.m.budget?.lines || {});
  const open = lines.filter(l => !l.closed);
  const tot = open.reduce((a, l) => a + l.amount, 0), sp = open.reduce((a, l) => a + spent(l), 0);
  const sec = h('section', {}, h('h2', {}, 'Budget'),
    h('p', { class: 'hint' }, `Money the members have approved, and what has been spent from it. ${lines.length ? `Open lines: ${fmt(tot)} approved, ${fmt(sp)} spent, ${fmt(tot - sp)} left.` : ''}`));
  sec.append(api.list({
    key: 'budget',
    edit: (l) => (api.me?.status === 'active' && !l.closed ? api.editForm('Edit this line', [['title', 'Title', l.title], ['period', 'Period', l.period], ['note', 'Note', l.note, 'textarea']], (ch) => api.propose(`Amend the budget line ${l.title}`, [{ kind: 'budget.amend', line: l.id, ...ch }])) : null), items: lines, noun: 'lines', empty: 'No budget lines yet.',
    render: (l) => h('li', {}, h('h3', {}, l.title, l.period ? h('span', { class: 'category' }, l.period) : null),
      h('p', { class: 'meta' }, `${l.id} · ${fmt(spent(l))} of ${fmt(l.amount)} spent · ${fmt(left(l))} left${l.closed ? ` · closed ${day(l.closed)}` : ''} · approved by ${l.by}`),
      h('div', { class: 'bar', role: 'img', 'aria-label': `${fmt(spent(l))} of ${fmt(l.amount)} spent` }, h('i', { class: 'a', style: `width:${l.amount ? Math.min(100, (spent(l) / l.amount) * 100) : 0}%` })),
      l.spending.length ? h('details', {}, h('summary', {}, `${l.spending.length} payment(s)`), h('ul', {}, l.spending.slice().reverse().map(s => h('li', {}, `${when(s.at)} · ${fmt(s.amount)} to ${s.payee}: ${s.memo} (${s.by})`)))) : null,
      me?.status === 'active' && !l.closed ? h('details', {}, h('summary', {}, 'Record spending'), h('div', { class: 'inline-form' },
        h('label', { for: `bs-a-${l.id}` }, `Amount (${cur})`), h('input', { id: `bs-a-${l.id}`, type: 'number', min: 0, step: 1 / 10 ** d }),
        h('label', { for: `bs-p-${l.id}` }, 'Paid to'), h('input', { id: `bs-p-${l.id}` }),
        h('label', { for: `bs-m-${l.id}` }, 'For'), h('input', { id: `bs-m-${l.id}` }),
        h('div', { class: 'buttons' }, h('button', { onclick: () => {
          const e = { kind: 'budget.spend', line: l.id, amount: parse($(`#bs-a-${l.id}`).value), payee: $(`#bs-p-${l.id}`).value.trim(), memo: $(`#bs-m-${l.id}`).value.trim() };
          api.propose(`Spend ${fmt(e.amount)} from ${l.title}`, [e]);
        } }, 'Sign')))) : null),
    text: (l) => `${l.id} ${l.title} ${l.period} ${l.spending.map(s => `${s.payee} ${s.memo}`).join(' ')}`,
    sorts: [['Most left', (a, b) => left(b) - left(a)], ['Most spent', (a, b) => spent(b) - spent(a)], ['Title, A–Z', api.sorts.byText((l) => l.title)], ['Newest first', api.sorts.newest((l) => l.approved)]],
    filters: [{ label: 'Open', options: [['Open', (l) => !l.closed], ['Closed', (l) => !!l.closed], ['All', () => true]] }],
  }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Propose a budget line'), h('div', { class: 'inline-form' },
    h('label', { for: 'bl-title' }, 'Title'), h('input', { id: 'bl-title', placeholder: 'Flour and ingredients' }),
    h('label', { for: 'bl-id' }, 'Id'), h('input', { id: 'bl-id', placeholder: 'ingredients' }),
    h('label', { for: 'bl-amount' }, `Amount (${cur})`), h('input', { id: 'bl-amount', type: 'number', min: 0, step: 1 / 10 ** d }),
    h('label', { for: 'bl-period' }, 'Period (optional)'), h('input', { id: 'bl-period', placeholder: 'Fall 2026' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const e = { kind: 'budget.line', line: $('#bl-id').value.trim(), title: $('#bl-title').value.trim(), amount: parse($('#bl-amount').value) };
      if ($('#bl-period').value.trim()) e.period = $('#bl-period').value.trim();
      api.propose(`Budget: ${e.title} (${fmt(e.amount)})`, [e]);
    } }, 'Sign this proposal')))));
  return sec;
}
