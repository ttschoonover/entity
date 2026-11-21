// portfolio.js · the books, open to every partner: the club's value, holdings,
// trades the partners approved and not yet done, every transaction, and each
// partner's capital account. Any partner proposes a trade (the partners decide
// it by joint resolution); only the Treasurer records anything on the books.
import { start, ctx, h, $, me, sign, propose, nameOf, onChange, onSigned, toast } from './common.js';
import { st, money, qty, pct, updown, short, fundCode, figures, books, isOfficer, bookkeeper, booksGrant, describeEntry, now } from './og.js';

const main = $('#main');
await start();
const Fm = await fundCode();
const cents = (v) => Math.round(Number(v) * 100);
const val = (id) => $(`#${id}`)?.value.trim() || '';

function summary() {
  const g = figures(Fm);
  return h('div', { class: 'stats' },
    h('div', { class: 'stat lead' }, h('div', { class: 'label' }, 'Total value'), h('div', { class: 'value' }, money(g.value)), h('div', { class: 'sub' }, `${money(g.unitValue)} a unit`)),
    h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Invested'), h('div', { class: 'value' }, money(g.invested)), h('div', { class: 'sub' }, `cost ${money(g.cost)}`)),
    h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Unrealized gain'), h('div', { class: `value ${updown(g.unrealized) || ''}` }, money(g.unrealized, { sign: true })), h('div', { class: 'sub' }, g.cost ? pct(g.unrealized / g.cost) : '—')),
    h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Cash'), h('div', { class: 'value' }, money(g.cash)), h('div', { class: 'sub' }, `${money(g.realized, { sign: true })} realized · ${money(g.income)} income`)));
}

function holdingsTable() {
  const f = books(), g = figures(Fm);
  const rows = Object.entries(f.holdings).map(([s, x]) => { const pr = f.prices[s]; const v = Math.floor(x.qty * (pr?.price || 0) / 1e6); return { s, x, pr, v, gain: v - x.cost }; }).sort((a, b) => b.v - a.v);
  const tot = rows.reduce((a, r) => ({ v: a.v + r.v, c: a.c + r.x.cost }), { v: 0, c: 0 });
  return h('section', { class: 'card' }, h('h2', {}, 'Holdings'),
    rows.length ? h('div', { class: 'scroll' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Security', 'Shares', 'Avg cost', 'Last price', 'Market value', 'Gain / loss', 'Weight'].map((c, i) => h('th', { class: i ? 'n' : null }, c)))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', { class: 'sym' }, r.s),
        h('td', { class: 'n' }, qty(r.x.qty)),
        h('td', { class: 'n' }, money(Math.round(r.x.cost * 1e6 / r.x.qty))),
        h('td', { class: 'n' }, r.pr ? money(r.pr.price) : '—', r.pr ? h('div', { class: 'fine' }, short(r.pr.at)) : null),
        h('td', { class: 'n' }, money(r.v)),
        h('td', { class: `n ${updown(r.gain) || ''}` }, money(r.gain, { sign: true }), h('div', { class: 'fine' }, r.x.cost ? pct(r.gain / r.x.cost) : '')),
        h('td', { class: 'n' }, pct(g.value ? r.v / g.value : 0), h('span', { class: 'weight', 'aria-hidden': 'true' }, h('i', { style: `width:${g.value ? 100 * r.v / g.value : 0}%` })))))),
      h('tfoot', {}, h('tr', {}, h('td', {}, 'Cash'), h('td', {}), h('td', {}), h('td', {}), h('td', { class: 'n' }, money(f.cash)), h('td', {}), h('td', { class: 'n' }, pct(g.value ? f.cash / g.value : 0))),
        h('tr', {}, h('td', {}, 'Total'), h('td', {}), h('td', {}), h('td', {}), h('td', { class: 'n' }, money(tot.v + f.cash)), h('td', { class: `n ${updown(tot.v - tot.c) || ''}` }, money(tot.v - tot.c, { sign: true })), h('td', { class: 'n' }, '100%')))))
      : h('p', { class: 'hint' }, `No securities yet. Cash: ${money(f.cash)}.`));
}

function openTrades() {
  const f = books(), t = now();
  const list = Object.values(f.authorizations).filter(a => !a.cancelled && a.until > t && a.filled < a.max);
  return h('section', { class: 'card' }, h('h2', {}, 'Approved trades awaiting execution'),
    list.length ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['', 'Security', 'Approved', 'Done', 'Limit', 'Expires'].map((c, i) => h('th', { class: i > 1 ? 'n' : null }, c)))),
      h('tbody', {}, list.map(a => h('tr', {}, h('td', {}, h('span', { class: `pill ${a.side}` }, a.side)), h('td', { class: 'sym' }, a.symbol), h('td', { class: 'n' }, qty(a.max)), h('td', { class: 'n' }, qty(a.filled)),
        h('td', { class: 'n' }, a.limit ? money(a.limit) : 'market'), h('td', { class: 'n' }, short(a.until))))))
      : h('p', { class: 'hint' }, 'None. A trade is placed only after the partners approve it by joint resolution.'));
}

function proposeTrade() {
  if (me()?.status !== 'active') return null;
  const go = () => {
    const side = val('pt-side'), symbol = val('pt-sym').toUpperCase(), quantity = Number(val('pt-qty')), days = Number(val('pt-days') || 7), reason = val('pt-why');
    const limit = val('pt-limit') ? cents(val('pt-limit')) : undefined;
    if (!symbol || !(quantity > 0)) return toast('Give the ticker and the number of shares.', true);
    const id = `${symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`.slice(0, 40);
    propose(`${side === 'buy' ? 'Buy' : 'Sell'} up to ${quantity} ${symbol}${limit ? ` at ${side === 'buy' ? 'most' : 'least'} ${money(limit)}` : ''}`,
      [{ kind: 'fund.authorize', id, side, symbol, quantity, days, ...(limit ? { limit } : {}), ...(reason ? { reason } : {}) }], reason || undefined);
  };
  return h('section', { class: 'card' }, h('h2', {}, 'Propose a trade'),
    h('p', { class: 'desk-note' }, 'Every purchase or sale is a joint resolution: a majority of the partners and of the units. Once it passes, the Treasurer places it at the broker and records it.'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Action', h('select', { id: 'pt-side' }, h('option', { value: 'buy' }, 'Buy'), h('option', { value: 'sell' }, 'Sell'))),
      h('label', {}, 'Ticker', h('input', { id: 'pt-sym', placeholder: 'VTI', autocomplete: 'off' })),
      h('label', {}, 'Up to (shares)', h('input', { id: 'pt-qty', type: 'number', min: 0, step: 'any' })),
      h('label', {}, 'Price limit ($, optional)', h('input', { id: 'pt-limit', type: 'number', min: 0, step: '0.01' })),
      h('label', {}, 'Valid for (days)', h('input', { id: 'pt-days', type: 'number', min: 1, max: 90, value: 7 }))),
    h('div', { class: 'form-grid', style: 'margin-top:.75rem' }, h('label', {}, 'Why (shown with the vote)', h('input', { id: 'pt-why', placeholder: 'Broad US market exposure at low cost' }))),
    h('div', { class: 'buttons', style: 'margin-top:1rem' }, h('button', { class: 'primary', onclick: go }, 'Put it to a vote')));
}

// The Treasurer's desk: shown only to the bookkeeper. Each entry is signed as
// the use of the grant to that office, and checked like everything else.
function desk() {
  const office = bookkeeper();
  if (!isOfficer(office)) return null;
  const f = books(), t = now(), grant = booksGrant();
  const record = (label, effects) => sign('authority.exercise', { grant, effects }, label);
  const partners = Object.values(st().participants).filter(p => p.status === 'active');
  const open = Object.values(f.authorizations).filter(a => !a.cancelled && a.until > t && a.filled < a.max);
  const syms = [...new Set([...Object.keys(f.holdings), ...open.map(a => a.symbol)])];
  const pick = (id) => h('select', { id }, partners.map(p => h('option', { value: p.id }, nameOf(p.id))));
  return h('section', { class: 'card' }, h('h2', {}, h('span', {}, 'Treasurer’s desk ', h('span', { class: 'badge-treasurer' }, 'only you see this'))),
    h('p', { class: 'desk-note' }, 'You alone keep the books. Every entry is signed by you, recorded on the partnership’s record and visible to every partner.'),
    h('details', { class: 'desk' }, h('summary', {}, 'Record a payment in'),
      h('div', { class: 'form-grid' }, h('label', {}, 'Partner', pick('d-pm')), h('label', {}, 'Amount ($)', h('input', { id: 'd-pa', type: 'number', min: 0, step: '0.01' }))),
      h('div', { class: 'buttons', style: 'margin-top:.8rem' }, h('button', { class: 'primary', onclick: () => record(`Payment in from ${nameOf(val('d-pm'))}`, [{ kind: 'fund.contribute', member: val('d-pm'), amount: cents(val('d-pa')) }]) }, 'Record'))),
    h('details', { class: 'desk' }, h('summary', {}, 'Record an executed trade'),
      open.length ? [h('div', { class: 'form-grid' },
        h('label', {}, 'Approved trade', h('select', { id: 'd-ta' }, open.map(a => h('option', { value: a.id }, `${a.side} ${a.symbol} (${qty(a.max - a.filled)} left)`)))),
        h('label', {}, 'Shares', h('input', { id: 'd-tq', type: 'number', min: 0, step: 'any' })),
        h('label', {}, 'Price per share ($)', h('input', { id: 'd-tp', type: 'number', min: 0, step: '0.0001' })),
        h('label', {}, 'Fees ($)', h('input', { id: 'd-tf', type: 'number', min: 0, step: '0.01', value: 0 }))),
      h('div', { class: 'buttons', style: 'margin-top:.8rem' }, h('button', { class: 'primary', onclick: () => record('An executed trade', [{ kind: 'fund.fill', authorization: val('d-ta'), quantity: Number(val('d-tq')), price: cents(val('d-tp')), ...(Number(val('d-tf')) ? { fees: cents(val('d-tf')) } : {}) }]) }, 'Record'))]
        : h('p', { class: 'hint' }, 'No approved trade is waiting.')),
    h('details', { class: 'desk' }, h('summary', {}, 'Update market prices'),
      syms.length ? [h('div', { class: 'form-grid' }, syms.map(s => h('label', {}, `${s} ($)`, h('input', { id: `d-v-${s}`, type: 'number', min: 0, step: '0.01', value: f.prices[s] ? (f.prices[s].price / 100).toFixed(2) : '' }))),
        h('label', {}, 'Source', h('input', { id: 'd-vs', placeholder: 'Broker close' }))),
      h('div', { class: 'buttons', style: 'margin-top:.8rem' }, h('button', { class: 'primary', onclick: () => {
        const prices = Object.fromEntries(syms.map(s => [s, cents(val(`d-v-${s}`))]).filter(([, c]) => c > 0));
        record('Market prices', [{ kind: 'fund.valuation', prices, ...(val('d-vs') ? { source: val('d-vs') } : {}) }]);
      } }, 'Record'))] : h('p', { class: 'hint' }, 'Nothing is held to price.')),
    h('details', { class: 'desk' }, h('summary', {}, 'Record income or an expense'),
      h('div', { class: 'form-grid' },
        h('label', {}, 'Type', h('select', { id: 'd-it' }, h('option', { value: 'fund.income' }, 'Income (dividend, interest)'), h('option', { value: 'fund.expense' }, 'Expense (fee, filing)'))),
        h('label', {}, 'Amount ($)', h('input', { id: 'd-ia', type: 'number', min: 0, step: '0.01' })),
        h('label', {}, 'What it was', h('input', { id: 'd-im', placeholder: 'VTI dividend' }))),
      h('div', { class: 'buttons', style: 'margin-top:.8rem' }, h('button', { class: 'primary', onclick: () => record(val('d-im'), [{ kind: val('d-it'), amount: cents(val('d-ia')), memo: val('d-im') }]) }, 'Record'))),
    h('details', { class: 'desk' }, h('summary', {}, 'Pay out a partner'),
      h('p', { class: 'desk-note' }, 'For a withdrawal the partners agreed under section 12 of the agreement. Paid at the current unit value.'),
      h('div', { class: 'form-grid' }, h('label', {}, 'Partner', pick('d-wm')), h('label', {}, 'Amount ($, empty for the whole stake)', h('input', { id: 'd-wa', type: 'number', min: 0, step: '0.01' }))),
      h('div', { class: 'buttons', style: 'margin-top:.8rem' }, h('button', { class: 'primary', onclick: () => record(`Payout to ${nameOf(val('d-wm'))}`, [val('d-wa') ? { kind: 'fund.withdraw', member: val('d-wm'), amount: cents(val('d-wa')) } : { kind: 'fund.withdraw', member: val('d-wm'), all: true }]) }, 'Record'))));
}

function transactions() {
  const all = books().ledger.slice().reverse();
  return h('section', { class: 'card' }, h('h2', {}, 'Transactions'),
    all.length ? h('div', { class: 'scroll' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Description'), h('th', { class: 'n' }, 'Amount'), h('th', {}, 'Recorded by'))),
      h('tbody', {}, all.slice(0, 200).map(e => h('tr', {}, h('td', { class: 'fine' }, short(e.at)), h('td', {}, describeEntry(e)),
        h('td', { class: `n ${updown(e.amount) || ''}` }, e.amount ? money(e.amount, { sign: true }) : ''), h('td', { class: 'fine' }, String(e.by || '').replace(/^grant .*/, 'Treasurer')))))))
      : h('p', { class: 'hint' }, 'No transactions yet.'));
}

function capital() {
  const f = books();
  const ids = [...new Set([...Object.keys(f.units), ...Object.keys(f.contributed)])];
  const rows = ids.map(id => ({ id, ...Fm.position(f, id) })).sort((a, b) => b.units - a.units);
  return h('section', { class: 'card' }, h('h2', {}, 'Capital accounts'),
    rows.length ? h('div', { class: 'scroll' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Partner', 'Paid in', 'Taken out', 'Units', 'Value', 'Share'].map((c, i) => h('th', { class: i ? 'n' : null }, c)))),
      h('tbody', {}, rows.map(r => h('tr', { class: me()?.id === r.id ? 'you' : null }, h('td', {}, nameOf(r.id)), h('td', { class: 'n' }, money(r.contributed)), h('td', { class: 'n' }, money(r.withdrawn)),
        h('td', { class: 'n' }, qty(r.units)), h('td', { class: 'n' }, money(r.value)), h('td', { class: 'n' }, pct(r.share, 2)))))))
      : h('p', { class: 'hint' }, 'No capital recorded yet.'));
}

function draw() {
  if (!ctx.r?.ok) return;
  const busy = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (busy) return;
  const openDesk = [...document.querySelectorAll('details.desk')].map(d => d.open);
  main.replaceChildren(h('div', { class: 'og-page' },
    h('div', { class: 'og-head' }, h('div', {}, h('h1', {}, 'Portfolio'), h('p', {}, `The books, open to every partner. Kept by the ${st().m.offices?.[bookkeeper()]?.title || bookkeeper()} alone.`))),
    summary(),
    h('div', { class: 'stack' }, holdingsTable(),
      h('div', { class: 'grid grid-even' }, openTrades(), proposeTrade()),
      desk(), transactions(), capital())));
  document.querySelectorAll('details.desk').forEach((d, i) => { if (openDesk[i]) d.open = true; });
}
onChange(draw); onSigned(() => { document.activeElement?.blur?.(); draw(); }); draw();
