// The fund tab: your stake, the club's value, holdings, investment decisions,
// who is taking part, the ledger, and the treasurer's bookkeeping.
import { nav, totalUnits, position } from './index.js';

const $$ = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const units = (u) => (u / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });
const shares = (q) => (q / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });

export default function render(api) {
  const { h, state, params, me, $, day, when, who, E } = api;
  const f = state.m.fund || { cash: 0, units: {}, holdings: {}, prices: {}, authorizations: {}, ledger: [], contributed: {}, withdrawn: {}, realized: 0, income: 0, expenses: 0 };
  const now = new Date().toISOString();
  const value = Number(nav(f)), t = totalUnits(f);
  const uv = t === 0n ? params.value('fund.initial_unit_value') : Number(nav(f) * 1000000n * 100n / t) / 100;
  const members = Object.keys(f.units).filter(id => f.units[id] > 0);
  const maxDays = params.value('fund.valuation_max_days');
  const staleSyms = Object.keys(f.holdings).filter(s => !f.prices[s] || Date.parse(now) - Date.parse(f.prices[s].at) > maxDays * 86400000);

  const sec = h('section', {}, h('h2', {}, 'The fund'),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Value'), h('dd', {}, h('strong', {}, $$(value)), ` · ${$$(f.cash)} cash, ${$$(value - f.cash)} invested`),
      h('dt', {}, 'Unit value'), h('dd', {}, `${$$(uv)} a unit · ${units(Number(t))} units`),
      h('dt', {}, 'Members with capital'), h('dd', {}, `${members.length} of at most ${params.value('fund.max_members')}`),
      h('dt', {}, 'Since founding'), h('dd', {}, `${$$(f.realized)} gains realised · ${$$(f.income)} income · ${$$(f.expenses)} expenses`)),
    staleSyms.length ? h('p', { class: 'flag' }, `No recent price for ${staleSyms.join(', ')}: record a valuation before anyone pays in or out.`) : null);

  // Your stake first.
  if (me && f.units[me.id]) {
    const p = position(f, me.id);
    sec.append(h('div', { class: 'grant' }, h('h3', {}, 'Your stake'),
      h('p', {}, h('strong', {}, $$(p.value)), ` · ${units(p.units)} units · ${(p.share * 100).toFixed(2)}% of the club`),
      h('p', { class: 'fine' }, `Paid in ${$$(p.contributed)}, taken out ${$$(p.withdrawn)}: ${p.value + p.withdrawn - p.contributed >= 0 ? 'up' : 'down'} ${$$(Math.abs(p.value + p.withdrawn - p.contributed))}.`)));
  }

  // Holdings.
  const hold = Object.entries(f.holdings);
  sec.append(h('h3', {}, 'Holdings'), hold.length ? api.list({
    key: 'fund-holdings', items: hold, noun: 'holdings', head: ['Security', 'Shares', 'Cost', 'Last price', 'Value', 'Gain'],
    row: ([s, x]) => { const pr = f.prices[s]; const v = pr ? Math.floor(x.qty * pr.price / 1e6) : 0;
      return h('tr', {}, h('td', {}, h('strong', {}, s)), h('td', {}, shares(x.qty)), h('td', {}, $$(x.cost)),
        h('td', { class: staleSyms.includes(s) ? 'flag' : null }, pr ? `${$$(pr.price)} · ${day(pr.at)}` : '—'), h('td', {}, $$(v)), h('td', {}, pr ? $$(v - x.cost) : '—')); },
    text: ([s]) => s, sorts: [['Largest first', (a, b) => (b[1].qty * (f.prices[b[0]]?.price || 0)) - (a[1].qty * (f.prices[a[0]]?.price || 0))], ['A–Z', api.sorts.byText(([s]) => s)]],
  }) : h('p', { class: 'hint' }, 'The club holds only cash.'));

  // Investment decisions.
  const auths = Object.values(f.authorizations);
  const open = (a) => !a.cancelled && now <= a.until && a.filled < a.max;
  sec.append(h('h3', {}, 'Investment decisions'),
    h('p', { class: 'fine' }, 'The members decide every purchase and sale by vote; the treasurer then trades at the broker within what was decided, and records it here.'),
    api.list({
      key: 'fund-auths', items: auths, noun: 'decisions', empty: 'No investment decisions yet.',
      render: (a) => h('li', {}, h('h3', {}, `${a.side === 'buy' ? 'Buy' : 'Sell'} ${shares(a.max)} ${a.symbol}`, h('span', { class: 'category' }, open(a) ? 'open' : a.cancelled ? 'cancelled' : a.filled >= a.max ? 'done' : 'expired')),
        h('p', { class: 'meta' }, `${a.limit ? `limit ${$$(a.limit)}` : 'at market'} · until ${day(a.until)} · ${shares(a.filled)} done · decided by ${a.by}${a.reason ? ` · ${a.reason}` : ''}`),
        a.fills.length ? h('ul', {}, a.fills.map(x => h('li', {}, `${when(x.at)}: ${shares(x.quantity)} at ${$$(x.price)}${x.fees ? `, fees ${$$(x.fees)}` : ''}`))) : null),
      text: (a) => `${a.id} ${a.symbol} ${a.reason}`,
      sorts: [['Newest first', api.sorts.newest()], ['Oldest first', api.sorts.oldest()]],
      filters: [{ label: 'Status', options: [['All', () => true], ['Open', open], ['Done or expired', (a) => !open(a)]] }],
    }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Propose a purchase or sale'), h('div', { class: 'inline-form' },
    h('label', { for: 'fa-side' }, 'Buy or sell'), h('select', { id: 'fa-side' }, h('option', { value: 'buy' }, 'Buy'), h('option', { value: 'sell' }, 'Sell')),
    h('label', { for: 'fa-sym' }, 'Ticker'), h('input', { id: 'fa-sym', placeholder: 'VTI', autocapitalize: 'characters' }),
    h('label', { for: 'fa-qty' }, 'Up to how many shares'), h('input', { id: 'fa-qty', type: 'number', min: 0, step: 'any' }),
    h('label', { for: 'fa-limit' }, 'Price limit, $ a share (optional)'), h('input', { id: 'fa-limit', type: 'number', min: 0, step: 0.01 }),
    h('label', { for: 'fa-days' }, 'Within how many days'), h('input', { id: 'fa-days', type: 'number', min: 1, max: 90, value: 7 }),
    h('label', { for: 'fa-why' }, 'Why (your study, in a sentence)'), h('input', { id: 'fa-why' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const sym = $('#fa-sym').value.trim().toUpperCase();
      const e = { kind: 'fund.authorize', id: `${sym.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`, side: $('#fa-side').value, symbol: sym, quantity: Number($('#fa-qty').value), days: Number($('#fa-days').value) };
      if ($('#fa-limit').value) e.limit = Math.round(Number($('#fa-limit').value) * 100);
      if ($('#fa-why').value.trim()) e.reason = $('#fa-why').value.trim();
      api.propose(`${e.side === 'buy' ? 'Buy' : 'Sell'} ${e.quantity} ${sym}`, [e]);
    } }, 'Sign this proposal')))));

  // Participation: every member should take part in investment decisions.
  const decisions = Object.values(state.proposals).filter(p => (p.effects || []).some(e => e.kind === 'fund.authorize')).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
  if (decisions.length) {
    const voted = (id) => decisions.filter(p => E.tally(state, p.id).counted.some(b => b.by === id) || (p.by === id)).length;
    const active = Object.values(state.participants).filter(p => p.status === 'active');
    sec.append(h('h3', {}, 'Taking part'),
      h('p', { class: 'fine' }, `How many of the last ${decisions.length} investment decisions each member voted on. The SEC's guidance is that a club whose members all actively take part in its investment decisions is probably not issuing securities; a club with even one passive member may be.`),
      api.list({ key: 'fund-part', items: active, noun: 'members', head: ['Member', 'Voted on', ''],
        row: (p) => { const n = voted(p.id); return h('tr', { class: n * 2 < decisions.length ? 'provisional' : null }, h('td', {}, who(p.id)), h('td', {}, `${n} of ${decisions.length}`), h('td', { class: 'flag' }, n * 2 < decisions.length ? 'taking little part' : '')); },
        pin: me ? (p) => p.id === me.id : null, sorts: [['Least first', (a, b) => voted(a.id) - voted(b.id)], ['Most first', (a, b) => voted(b.id) - voted(a.id)]] }));
  }

  // Members' capital accounts.
  if (members.length) sec.append(h('h3', {}, 'Capital accounts'), api.list({
    key: 'fund-members', items: members, noun: 'members', head: ['Member', 'Units', 'Value', 'Share', 'Paid in', 'Taken out'],
    row: (id) => { const p = position(f, id); return h('tr', {}, h('td', {}, who(id)), h('td', {}, units(p.units)), h('td', {}, $$(p.value)), h('td', {}, `${(p.share * 100).toFixed(2)}%`), h('td', {}, $$(p.contributed)), h('td', {}, $$(p.withdrawn))); },
    mine: me ? (id) => id === me.id : null, sorts: [['Largest first', (a, b) => f.units[b] - f.units[a]], ['A–Z', api.sorts.byText((id) => id)]],
  }));

  // The treasurer's bookkeeping: under their grant, or proposed to the members.
  if (me?.status === 'active') {
    const actives = Object.values(state.participants).filter(p => p.status === 'active').map(p => p.id);
    const openAuths = auths.filter(open);
    const tools = [];
    tools.push(h('details', {}, h('summary', {}, 'Record a payment in'), h('div', { class: 'inline-form' },
      h('label', { for: 'fc-m' }, 'From'), h('select', { id: 'fc-m' }, actives.map(id => h('option', { value: id }, id))),
      h('label', { for: 'fc-a' }, 'Amount ($)'), h('input', { id: 'fc-a', type: 'number', min: 0, step: 0.01 }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose(`Record $${$('#fc-a').value} from ${$('#fc-m').value}`, [{ kind: 'fund.contribute', member: $('#fc-m').value, amount: Math.round(Number($('#fc-a').value) * 100) }]) }, 'Sign')))));
    if (openAuths.length) tools.push(h('details', {}, h('summary', {}, 'Record a trade done at the broker'), h('div', { class: 'inline-form' },
      h('label', { for: 'ff-a' }, 'Under the decision'), h('select', { id: 'ff-a' }, openAuths.map(a => h('option', { value: a.id }, `${a.side} ${a.symbol} (${shares(a.max - a.filled)} left)`))),
      h('label', { for: 'ff-q' }, 'Shares'), h('input', { id: 'ff-q', type: 'number', min: 0, step: 'any' }),
      h('label', { for: 'ff-p' }, 'Price ($ a share)'), h('input', { id: 'ff-p', type: 'number', min: 0, step: 0.01 }),
      h('label', { for: 'ff-f' }, 'Fees ($)'), h('input', { id: 'ff-f', type: 'number', min: 0, step: 0.01, value: 0 }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose(`Record the trade for ${$('#ff-a').value}`, [{ kind: 'fund.fill', authorization: $('#ff-a').value, quantity: Number($('#ff-q').value), price: Math.round(Number($('#ff-p').value) * 100), fees: Math.round(Number($('#ff-f').value) * 100) }]) }, 'Sign')))));
    if (hold.length) tools.push(h('details', {}, h('summary', {}, 'Record today\'s prices'), h('div', { class: 'inline-form' },
      hold.map(([s]) => [h('label', { for: `fv-${s}` }, `${s} ($ a share)`), h('input', { id: `fv-${s}`, type: 'number', min: 0, step: 0.01, value: f.prices[s] ? (f.prices[s].price / 100).toFixed(2) : '' })]),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose('Record today\'s prices', [{ kind: 'fund.valuation', prices: Object.fromEntries(hold.map(([s]) => [s, Math.round(Number($(`#fv-${s}`).value) * 100)])), source: 'closing prices' }]) }, 'Sign')))));
    tools.push(h('details', {}, h('summary', {}, 'Record income or an expense'), h('div', { class: 'inline-form' },
      h('label', { for: 'fi-k' }, 'Kind'), h('select', { id: 'fi-k' }, h('option', { value: 'fund.income' }, 'Income (a dividend, interest)'), h('option', { value: 'fund.expense' }, 'Expense (a fee, a subscription)')),
      h('label', { for: 'fi-a' }, 'Amount ($)'), h('input', { id: 'fi-a', type: 'number', min: 0, step: 0.01 }),
      h('label', { for: 'fi-m' }, 'What it was'), h('input', { id: 'fi-m', placeholder: 'VTI dividend' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose(`Record ${$('#fi-m').value}`, [{ kind: $('#fi-k').value, amount: Math.round(Number($('#fi-a').value) * 100), memo: $('#fi-m').value.trim() }]) }, 'Sign')))));
    if (me && f.units[me.id]) tools.push(h('details', {}, h('summary', {}, 'Ask to withdraw'), h('div', { class: 'inline-form' },
      h('label', { for: 'fw-a' }, 'Amount ($), or leave empty for your whole stake'), h('input', { id: 'fw-a', type: 'number', min: 0, step: 0.01 }),
      h('div', { class: 'buttons' }, h('button', { class: 'danger', onclick: () => { const a = $('#fw-a').value; api.propose(a ? `Withdraw $${a} for ${me.id}` : `Pay out ${me.id}'s whole stake`, [a ? { kind: 'fund.withdraw', member: me.id, amount: Math.round(Number(a) * 100) } : { kind: 'fund.withdraw', member: me.id, all: true }]); } }, 'Sign this proposal')))));
    sec.append(h('h3', {}, 'Bookkeeping'), h('p', { class: 'fine' }, 'The treasurer records these under their grant; anyone else proposes them to the members.'), ...tools);
  }

  // The ledger, and a copy for the accountant.
  sec.append(h('h3', {}, 'Ledger'), api.list({
    key: 'fund-ledger', items: f.ledger, noun: 'entries', head: ['When', 'What', 'Amount', 'By'],
    row: (x) => h('tr', {}, h('td', {}, day(x.at)), h('td', {}, x.kind === 'contribution' ? `paid in by ${x.member}` : x.kind === 'withdrawal' ? `paid out to ${x.member}` : x.kind === 'buy' || x.kind === 'sell' ? `${x.kind} ${shares(x.quantity)} ${x.symbol} at ${$$(x.price)}` : x.kind === 'valuation' ? `prices recorded; value ${$$(x.nav)}` : `${x.kind}: ${x.memo}`),
      h('td', {}, x.amount !== undefined ? $$(x.amount) : ''), h('td', {}, x.by)),
    text: (x) => `${x.kind} ${x.member || ''} ${x.symbol || ''} ${x.memo || ''}`,
    sorts: [['Newest first', api.sorts.newest()], ['Oldest first', api.sorts.oldest()]],
    filters: [{ label: 'Kind', options: [['Everything', () => true], ...['contribution', 'withdrawal', 'buy', 'sell', 'income', 'expense', 'valuation'].map(k => [k, (x) => x.kind === k])] }],
  }), h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => {
    const rows = [['date', 'kind', 'member', 'symbol', 'quantity', 'price', 'fees', 'amount', 'units', 'realized', 'memo', 'by']].concat(f.ledger.map(x => [x.at, x.kind, x.member || '', x.symbol || '', x.quantity ? x.quantity / 1e6 : '', x.price ? x.price / 100 : '', x.fees ? x.fees / 100 : '', x.amount !== undefined ? x.amount / 100 : '', x.units ? x.units / 1e6 : '', x.realized ? x.realized / 100 : '', x.memo || '', x.by]));
    const csv = rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n';
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `fund-ledger-${now.slice(0, 10)}.csv` }); document.body.append(a); a.click(); a.remove();
  } }, 'Download the ledger (CSV) for the accountant')));
  return sec;
}
