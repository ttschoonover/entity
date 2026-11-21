// home.js · the overview a partner lands on: the club's value, their stake,
// what needs them, the votes before the partners, top holdings and recent
// activity. Worked out in the partner's browser from the record.
import { start, ctx, h, $, me, sign, nameOf, onChange, onSigned, fullName } from './common.js';
import { st, money, qty, pct, updown, short, firstName, fundCode, figures, books, openVotes, myBallot, todo, todoList, describeEntry, holdersOf } from './og.js';

const main = $('#main');
await start();
const Fm = await fundCode();
const T = await import(new URL('modules/deliberation/count.js', ctx.r.base).href);

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

function stats() {
  const g = figures(Fm), p = me(), f = books();
  const pos = p && f.units[p.id] ? Fm.position(f, p.id) : null;
  const gain = pos ? pos.value + pos.withdrawn - pos.contributed : 0;
  const partners = Object.values(st().participants).filter(x => x.status === 'active').length;
  return h('div', { class: 'stats' },
    h('div', { class: 'stat lead' }, h('div', { class: 'label' }, 'Club value'), h('div', { class: 'value' }, money(g.value, { cents: false })), h('div', { class: 'sub' }, `${money(g.cash, { cents: false })} cash · ${money(g.invested, { cents: false })} invested`)),
    h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Unit value'), h('div', { class: 'value' }, money(g.unitValue)), h('div', { class: 'sub' }, `${qty(g.units)} units outstanding`)),
    h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Your stake'), h('div', { class: 'value' }, pos ? money(pos.value) : '—'),
      h('div', { class: 'sub' }, pos ? [pct(pos.share, 2), ' of the club · ', h('span', { class: updown(gain) }, `${money(gain, { sign: true })} all time`)] : 'No capital recorded yet')),
    h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Partners'), h('div', { class: 'value' }, String(partners)), h('div', { class: 'sub' }, `Treasurer: ${holdersOf('treasurer').map(nameOf).join(', ') || 'vacant'}`)));
}

function votes() {
  const mine = me()?.status === 'active' ? me().id : null;
  const list = openVotes().slice(0, 4);
  return h('section', { class: 'card' }, h('h2', {}, 'Votes', h('a', { href: 'hall.html#/resolutions' }, 'All votes →')),
    list.length ? list.map(p => {
      const t = T.tallyOf(p), of = t.electorate || 1, v = myBallot(p, mine);
      const cast = (choice) => sign('ballot.cast', { proposal: p.id, choice }, `Your vote ${choice}: ${p.title}`);
      return h('div', { class: 'vote' }, h('h3', {}, p.title),
        h('p', { class: 'meta' }, `Closes ${short(p.deadline)} · ${t.for} for, ${t.against} against of ${t.electorate}`),
        h('div', { class: 'bar2', 'aria-hidden': 'true' }, h('span', { class: 'aye', style: `width:${100 * t.for / of}%` }), h('span', { class: 'no', style: `width:${100 * t.against / of}%` })),
        mine && p.roll.includes(mine) ? h('div', { class: 'row' },
          h('button', { class: v === 'for' ? 'primary' : 'secondary', onclick: () => cast('for') }, 'For'),
          h('button', { class: v === 'against' ? 'primary' : 'secondary', onclick: () => cast('against') }, 'Against'),
          h('a', { href: `hall.html#/resolutions/${p.id}` }, 'Details'),
          v ? h('span', { class: 'fine' }, `You voted ${v}.`) : null) : null);
    }) : h('p', { class: 'hint' }, 'Nothing is before the partners right now.'));
}

function holdings() {
  const f = books(), g = figures(Fm);
  const rows = Object.entries(f.holdings).map(([s, x]) => ({ s, v: Math.floor(x.qty * (f.prices[s]?.price || 0) / 1e6), cost: x.cost })).sort((a, b) => b.v - a.v).slice(0, 6);
  return h('section', { class: 'card' }, h('h2', {}, 'Top holdings', h('a', { href: 'portfolio.html' }, 'Portfolio →')),
    rows.length ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Security'), h('th', { class: 'n' }, 'Value'), h('th', { class: 'n' }, 'Gain'), h('th', { class: 'n' }, 'Weight'))),
      h('tbody', {}, rows.map(r => h('tr', {}, h('td', { class: 'sym' }, r.s), h('td', { class: 'n' }, money(r.v, { cents: false })),
        h('td', { class: `n ${updown(r.v - r.cost) || ''}` }, money(r.v - r.cost, { sign: true, cents: false })),
        h('td', { class: 'n' }, pct(g.value ? r.v / g.value : 0), h('span', { class: 'weight', 'aria-hidden': 'true' }, h('i', { style: `width:${g.value ? 100 * r.v / g.value : 0}%` })))))))
      : h('p', { class: 'hint' }, 'The partnership holds no securities yet. Every purchase is voted on by the partners.'));
}

function activity() {
  const ledger = books().ledger.map(e => ({ at: e.at, text: describeEntry(e), amount: e.amount }));
  const decided = Object.values(st().proposals).filter(p => p.closed).map(p => ({ at: p.closed.at || p.deadline, text: `${p.closed.carried ? 'Passed' : 'Rejected'}: ${p.title}` }));
  const all = [...ledger, ...decided].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);
  return h('section', { class: 'card' }, h('h2', {}, 'Recent activity'),
    all.length ? h('ul', { class: 'activity' }, all.map(x => h('li', {}, h('span', {}, x.text, x.amount ? h('span', { class: `fine ${updown(x.amount) || ''}` }, ` ${money(x.amount, { sign: true })}`) : null), h('span', { class: 'when' }, short(x.at)))))
      : h('p', { class: 'hint' }, 'Nothing yet.'));
}

function draw() {
  if (!ctx.r?.ok) return;
  const p = me();
  main.replaceChildren(h('div', { class: 'og-page' },
    h('div', { class: 'og-head' }, h('div', {}, h('h1', {}, p ? `${greeting()}, ${firstName(p.id)}` : fullName()), h('p', {}, `${fullName()} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`))),
    stats(),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'stack' }, votes(), holdings()),
      h('div', { class: 'stack' }, h('section', { class: 'card' }, h('h2', {}, 'For you'), todoList(todo())), activity()))));
}
onChange(draw); onSigned(draw); draw();
