// The wagers tab: your points, open markets with live prices, pools and lines
// with their odds, challenges to take, the arbiter's desk, and forms to open
// any kind of bet.
import { prices, tradeCost, pot, arbiters, stakeholders, balance } from './index.js';

const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);
const pct = (x) => `${Math.round(x * 100)}%`;
const KIND = { pool: 'Pool', line: 'Over/under', duel: 'Challenge', market: 'Market' };

function card(api, w, ctx) {
  const { h, me, who, when, state, params, $ } = api;
  const now = ctx.now, closed = now >= w.closes, value = params.value('wagers.share_value');
  const head = h('div', { class: 'bet-head' }, h('span', { class: `bet-kind k-${w.type}` }, KIND[w.type]), h('span', { class: 'bet-pot' }, `${pot(state, w)} pts in play`));
  const meta = h('p', { class: 'meta' }, 'opened by ', who(w.by), ` · ${w.status === 'open' || w.status === 'offered' ? (closed ? 'closed' : `closes ${when(w.closes)}`) : w.status}`);
  const body = [];
  const canBet = me?.status === 'active' && !ctx.iArbitrate && !closed;

  if (w.type === 'market') {
    const p = prices(w);
    body.push(h('div', { class: 'market' }, w.outcomes.map(o => h('div', { class: 'mk-row' },
      h('span', { class: 'mk-o' }, o), h('span', { class: 'mk-bar' }, h('span', { style: `width:${p[o] * 100}%` })), h('span', { class: 'mk-p' }, pct(p[o])),
      me && w.positions[me.id]?.[o] ? h('span', { class: 'fine' }, ` you hold ${w.positions[me.id][o]}`) : null))));
    if (canBet && w.status === 'open') {
      const out = h('span', { class: 'fine', 'aria-live': 'polite' });
      const preview = () => { const n = Math.trunc(Number($(`#mk-n-${w.id}`).value)); const o = $(`#mk-o-${w.id}`).value; out.textContent = n ? (n > 0 ? `costs ${tradeCost(w, o, n, value)} pts, pays ${n * value} if ${o}` : `returns ${-tradeCost(w, o, n, value)} pts`) : ''; };
      body.push(h('div', { class: 'row' },
        h('label', { class: 'visually-hidden', for: `mk-o-${w.id}` }, 'Outcome'), h('select', { id: `mk-o-${w.id}`, onchange: preview }, w.outcomes.map(o => h('option', { value: o }, o))),
        h('label', { class: 'visually-hidden', for: `mk-n-${w.id}` }, 'Shares (negative sells)'), h('input', { id: `mk-n-${w.id}`, type: 'number', step: 1, value: 1, oninput: preview, style: 'width:6rem' }),
        h('button', { onclick: () => { const shares = Math.trunc(Number($(`#mk-n-${w.id}`).value)); const outcome = $(`#mk-o-${w.id}`).value; api.sign('wager.trade', { wager: w.id, outcome, shares }, `${shares > 0 ? 'Buying' : 'Selling'} ${Math.abs(shares)} ${outcome}`); } }, 'Trade'), out));
    }
  } else if (w.type === 'pool' || w.type === 'line') {
    const total = w.stakes.reduce((a, s) => a + s.amount, 0);
    const by = Object.fromEntries(w.outcomes.map(o => [o, w.stakes.filter(s => s.outcome === o).reduce((a, s) => a + s.amount, 0)]));
    if (w.type === 'line') body.push(h('p', { class: 'bet-line' }, 'The line: ', h('strong', {}, String(w.line))));
    body.push(h('div', { class: 'pool' }, w.outcomes.map(o => h('div', { class: 'pl-row' }, h('span', { class: 'mk-o' }, o),
      h('span', { class: 'mk-bar' }, h('span', { style: `width:${total ? (by[o] / total) * 100 : 0}%` })),
      h('span', { class: 'mk-p' }, by[o] ? `pays ${(total / by[o]).toFixed(2)}×` : '—')))));
    if (canBet && w.status === 'open') body.push(h('div', { class: 'row' },
      h('select', { id: `pl-o-${w.id}`, 'aria-label': 'Outcome' }, w.outcomes.map(o => h('option', { value: o }, o))),
      h('input', { id: `pl-n-${w.id}`, type: 'number', min: 1, step: 1, value: 10, style: 'width:6rem', 'aria-label': 'Points' }),
      h('button', { onclick: () => api.sign('wager.stake', { wager: w.id, outcome: $(`#pl-o-${w.id}`).value, amount: Math.trunc(Number($(`#pl-n-${w.id}`).value)) }, 'Your stake') }, 'Stake')));
  } else if (w.type === 'duel') {
    body.push(h('p', { class: 'duel' }, who(w.by), ` puts up ${w.stake} against `, w.taker ? who(w.taker) : w.to ? who(w.to) : 'anyone', `'s ${w.against}.`));
    if (w.status === 'offered' && me && me.id !== w.by && (!w.to || w.to === me.id) && !ctx.iArbitrate && !closed)
      body.push(h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('wager.accept', { wager: w.id }, `Taking ${nm(api, w.by)}'s challenge for ${w.against}`) }, `Take it: risk ${w.against} to win ${w.stake}`)));
    if (w.status === 'open' && me && [w.by, w.taker].includes(me.id))
      body.push(h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => confirm('Concede: the other side wins the whole pot?') && api.sign('wager.concede', { wager: w.id }, 'Conceding') }, 'Concede')));
  }

  if (w.result && w.status !== 'settled') body.push(h('p', { class: 'bet-result' }, `Arbiter's result: `, h('strong', {}, w.result.outcome), w.result.value !== undefined ? ` (${w.result.value})` : '', w.result.note ? ` · ${w.result.note}` : '', w.status === 'resolved' ? ` · appeal until ${when(w.result.appealUntil)}` : ''));
  if (w.status === 'appealed') body.push(h('p', { class: 'flag' }, 'Appealed by ', who(w.appeal.by), `: ${w.appeal.reason}. A decision of the members settles it.`));
  if (w.settled) body.push(h('p', { class: 'bet-result' }, w.status === 'void' ? 'Void: every stake returned.' : ['Settled: ', h('strong', {}, w.settled.outcome), ` (${w.settled.how})`]));

  const btns = [];
  if (ctx.iArbitrate && w.status === 'open' && (closed || w.type === 'duel') && !stakeholders(w).has(me.id) && (w.type !== 'duel' || w.taker)) {
    if (w.type === 'line') btns.push(h('input', { id: `rs-v-${w.id}`, type: 'number', step: 'any', 'aria-label': 'The value it came to', style: 'width:7rem' }), h('button', { onclick: () => api.sign('wager.resolve', { wager: w.id, value: Number($(`#rs-v-${w.id}`).value), note: prompt('A note on the source (optional)') || undefined }, 'Your result') }, 'Resolve'));
    else btns.push(...w.outcomes.map(o => h('button', { class: 'quiet', onclick: () => api.sign('wager.resolve', { wager: w.id, outcome: o, note: prompt('A note on the source (optional)') || undefined }, `Resolving: ${o}`) }, `Resolve: ${o}`)));
  }
  if (w.status === 'resolved' && now >= w.result.appealUntil && me) btns.push(h('button', { onclick: () => api.sign('wager.settle', { wager: w.id }, 'Paying out') }, 'Pay out'));
  if (w.status === 'resolved' && now < w.result.appealUntil && me && stakeholders(w).has(me.id)) btns.push(h('button', { class: 'quiet', onclick: () => { const reason = prompt('Why is the result wrong?'); if (reason) api.sign('wager.appeal', { wager: w.id, reason }, 'Your appeal'); } }, 'Appeal'));
  if (me?.id === w.by && (w.status === 'offered' || (w.status === 'open' && w.type !== 'duel'))) btns.push(h('button', { class: 'danger', onclick: () => api.sign('wager.cancel', { wager: w.id }, 'Cancelling') }, 'Cancel'));
  if (me?.status === 'active' && ['open', 'resolved', 'appealed'].includes(w.status)) btns.push(h('button', { class: 'linklike', onclick: () => {
    const o = prompt(`Propose settling by vote. Outcome (${w.type === 'line' ? 'a number' : w.outcomes.join(', ')}), or "void":`); if (!o) return;
    if (o === 'void') api.propose(`Void “${w.question}”`, [{ kind: 'wager.void', wager: w.id, reason: prompt('Why?') || 'by vote' }]);
    else api.propose(`Settle “${w.question}”: ${o}`, [{ kind: 'wager.decide', wager: w.id, ...(w.type === 'line' ? { value: Number(o) } : { outcome: o }) }]);
  } }, 'Settle by vote…'));
  return h('li', { class: `bet bet-${w.type} st-${w.status}` }, head, h('h3', {}, w.question), meta, ...body, btns.length ? h('div', { class: 'buttons' }, ...btns) : null);
}

export default function render(api) {
  const { h, state, me, $, params, who } = api;
  const now = new Date().toISOString();
  const arbs = arbiters(state, params, now), iArbitrate = !!(me && arbs.includes(me.id));
  const all = Object.values(state.m.wagers?.items || {}).sort((a, b) => (a.at < b.at ? 1 : -1));
  const live = all.filter(w => ['open', 'offered', 'resolved', 'appealed'].includes(w.status));
  const done = all.filter(w => !live.includes(w));
  const ctx = { now, iArbitrate };
  const sec = h('section', { class: 'wagers' }, h('h2', {}, 'Wagers'),
    h('p', { class: 'hint' }, 'Bets in points, never money. ', arbs.length ? ['The arbiter: ', ...arbs.flatMap((a, i) => [i ? ', ' : '', who(a)]), '.'] : 'There is no arbiter yet: elect one, or settle bets by vote.'),
    me ? h('p', { class: 'bet-wallet' }, 'You hold ', h('strong', {}, String(balance(state, me.id))), ' points.') : null);
  if (iArbitrate) sec.append(h('p', { class: 'hint' }, 'You are the arbiter: you resolve bets once they close, and do not bet while in office.'));
  sec.append(api.list({
    key: 'bets', items: live, noun: 'bets', empty: 'No open bets. Open one below.',
    mine: me ? (w) => stakeholders(w).has(me.id) || (w.to === me.id && w.status === 'offered') : null,
    text: (w) => `${w.question} ${(w.outcomes || []).join(' ')} ${KIND[w.type]} ${nm(api, w.by)}`,
    sorts: [['Closing soonest', (a, b) => (a.closes < b.closes ? -1 : 1)], ['Biggest pot', (a, b) => pot(state, b) - pot(state, a)], ['Newest first', api.sorts.newest()]],
    render: (w) => card(api, w, ctx),
  }));
  if (done.length) sec.append(h('details', {}, h('summary', {}, `Settled (${done.length})`), h('ul', { class: 'items' }, done.slice(0, 50).map(w => card(api, w, ctx)))));

  if (me?.status === 'active' && !iArbitrate) {
    const field = (id, label, el) => [h('label', { for: id }, label), el];
    sec.append(h('details', {}, h('summary', {}, 'Open a bet'), h('div', { class: 'inline-form' },
      ...field('bt-t', 'Kind', h('select', { id: 'bt-t' }, h('option', { value: 'pool' }, 'Pool: pick an outcome, winners share the pot'), h('option', { value: 'line' }, 'Over/under a number'), h('option', { value: 'market' }, 'Prediction market: trade shares, price is the crowd’s odds'))),
      ...field('bt-q', 'Question', h('input', { id: 'bt-q', placeholder: 'Who wins the house cook-off?' })),
      ...field('bt-o', 'Outcomes, one per line (pools and markets)', h('textarea', { id: 'bt-o', rows: 3 })),
      ...field('bt-l', 'The line (over/under)', h('input', { id: 'bt-l', type: 'number', step: 'any' })),
      ...field('bt-b', 'Depth (markets): higher moves less per share, costs you more to back', h('input', { id: 'bt-b', type: 'number', min: 1, value: 10 })),
      ...field('bt-d', 'Days it takes bets', h('input', { id: 'bt-d', type: 'number', min: 1, value: 7 })),
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const type = $('#bt-t').value, f = { type, question: $('#bt-q').value.trim(), days: Number($('#bt-d').value) };
        if (type === 'line') f.line = Number($('#bt-l').value); else f.outcomes = $('#bt-o').value.split('\n').map(x => x.trim()).filter(Boolean);
        if (type === 'market') f.liquidity = Number($('#bt-b').value);
        api.sign('wager.open', f, `Your ${KIND[type].toLowerCase()}`);
      } }, 'Open it')))),
    h('details', {}, h('summary', {}, 'Challenge someone'), h('div', { class: 'inline-form' },
      ...field('dl-t', 'The bet: what you claim will happen', h('textarea', { id: 'dl-t', rows: 2 })),
      ...field('dl-s', 'Your stake', h('input', { id: 'dl-s', type: 'number', min: 1, value: 20 })),
      ...field('dl-a', 'Their stake', h('input', { id: 'dl-a', type: 'number', min: 1, value: 20 })),
      ...field('dl-w', 'Who (empty: anyone)', h('select', { id: 'dl-w' }, h('option', { value: '' }, 'anyone'), state.order.filter(id => id !== me.id && state.participants[id]?.status === 'active').map(id => h('option', { value: id }, nm(api, id))))),
      ...field('dl-d', 'Days it stands', h('input', { id: 'dl-d', type: 'number', min: 1, value: 14 })),
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const f = { terms: $('#dl-t').value.trim(), stake: Number($('#dl-s').value), against: Number($('#dl-a').value), days: Number($('#dl-d').value) };
        if ($('#dl-w').value) f.to = $('#dl-w').value;
        api.sign('wager.duel', f, 'Your challenge');
      } }, 'Lay down the challenge')))));
  }
  return sec;
}
