// The loans tab: the fund, every loan, what is owed, and what is overdue.
import { available, outstanding, owing } from './index.js';

export default function render(api) {
  const { h, state, params, me, $, day, who } = api;
  const d = params.value('loans.decimals'), cur = params.value('loans.currency');
  const fmt = (n) => `${(n / 10 ** d).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
  const parse = (s) => Math.round(Number(s) * 10 ** d);
  const b = state.m.loans || { funded: 0, forgiven: 0, loans: {} };
  const now = new Date().toISOString();
  const loans = Object.values(b.loans);
  const sec = h('section', {}, h('h2', {}, 'Loans'),
    h('p', { class: 'hint' }, `An interest-free fund the members lend from and pay back into. ${fmt(available(state))} available to lend · ${fmt(outstanding(state))} out on loan · ${fmt(b.funded)} put in so far${b.forgiven ? ` · ${fmt(b.forgiven)} forgiven` : ''}. A single loan is at most ${params.value('loans.max_amount') ? fmt(params.value('loans.max_amount')) : 'unlimited'}.`));
  sec.append(api.list({
    key: 'loans', items: loans, noun: 'loans', empty: 'No loans yet.',
    mine: me ? (l) => l.to === me.id : null,
    text: (l) => `${l.id} ${l.to} ${l.purpose}`,
    sorts: [['Newest first', api.sorts.newest((l) => l.made)], ['Most owed', (x, y) => owing(y) - owing(x)]],
    filters: [{ label: 'Status', options: [['Outstanding', (l) => owing(l) > 0], ['Overdue', (l) => owing(l) > 0 && l.due < now], ['Closed', (l) => !owing(l)], ['Everything', () => true]] }],
    render: (l) => h('li', {}, h('h3', {}, `${l.id}: `, who(l.to), h('span', { class: 'category' }, !owing(l) ? (l.forgiven ? 'forgiven' : 'repaid') : l.due < now ? 'overdue' : 'outstanding')),
      h('p', { class: 'meta' }, `${fmt(l.amount)} lent ${day(l.made)} · ${fmt(l.repaid)} repaid · ${fmt(owing(l))} owed · due ${day(l.due)}${l.purpose ? ` · ${l.purpose}` : ''} · by ${l.by}`),
      l.payments.length ? h('details', {}, h('summary', {}, `${l.payments.length} repayment(s)`), h('ul', {}, l.payments.map(p => h('li', { class: 'fine' }, `${day(p.at)} · ${fmt(p.amount)} (${p.by})`)))) : null,
      me?.status === 'active' && owing(l) ? h('details', {}, h('summary', {}, 'Record a repayment, or propose forgiving it'), h('div', { class: 'inline-form' },
        h('label', { for: `lr-${l.id}` }, `Amount repaid (${cur})`), h('input', { id: `lr-${l.id}`, type: 'number', min: 0, step: 1 / 10 ** d }),
        h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose(`Repayment on ${l.id}`, [{ kind: 'loan.repay', loan: l.id, amount: parse($(`#lr-${l.id}`).value) }]) }, 'Sign the repayment'),
          h('button', { class: 'quiet', onclick: () => { const reason = prompt('Why forgive what is left?'); if (reason) api.propose(`Forgive the loan ${l.id}`, [{ kind: 'loan.forgive', loan: l.id, reason }]); } }, 'Propose forgiving it')))) : null),
  }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Propose a loan'), h('div', { class: 'inline-form' },
    h('label', { for: 'ln-to' }, 'To'), h('select', { id: 'ln-to' }, state.order.filter(id => state.participants[id]?.status === 'active').map(id => h('option', { value: id }, id))),
    h('label', { for: 'ln-a' }, `Amount (${cur})`), h('input', { id: 'ln-a', type: 'number', min: 0, step: 1 / 10 ** d }),
    h('label', { for: 'ln-d' }, 'Due'), h('input', { id: 'ln-d', type: 'date' }),
    h('label', { for: 'ln-p' }, 'Purpose (optional, readable by every member: keep details in a sealed post)'), h('input', { id: 'ln-p' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const e = { kind: 'loan.make', loan: `l-${Date.now().toString(36)}`, to: $('#ln-to').value, amount: parse($('#ln-a').value), due: new Date($('#ln-d').value).toISOString(), ...($('#ln-p').value.trim() ? { purpose: $('#ln-p').value.trim() } : {}) };
      api.propose(`Lend ${fmt(e.amount)} to ${e.to}`, [e]);
    } }, 'Sign')))));
  return sec;
}
