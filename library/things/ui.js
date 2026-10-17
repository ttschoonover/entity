// The library of things: what members and the network lend, who has what, and
// every deposit, held and returned.
import { item, lender, current, overdue, deposits, claimsOwed, requestsFor } from './index.js';

export const tabs = [{ id: 'things', title: 'Library of things', render: (api) => render(api) }];

export default function render(api) {
  const { h, state, params, me, $, day, when, who } = api;
  const nm = (id) => (api.nameOf ? api.nameOf(id) : id);
  const d = params.value('things.decimals'), cur = params.value('things.currency');
  const sym = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$' }[cur];
  const fmt = (n) => { const s = (n / 10 ** d).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); return sym ? `${sym}${s}` : `${s} ${cur}`; };
  const parse = (s) => Math.round(Number(String(s).replace(/[^0-9.]/g, '')) * 10 ** d);
  const b = state.m.things || { items: {}, loans: [], out: {}, requests: {}, claims: [] };
  const now = new Date().toISOString();
  const can = me?.status === 'active';
  const items = Object.values(b.items).filter(i => !i.withdrawn);
  const title = (id) => b.items[id]?.title || id;
  const by = (it) => (it.owner ? ['lent by ', who(it.owner)] : ['the network’s, kept by ', who(it.keeper)]);
  const coverOn = params.value('things.cover'), coverLim = params.value('things.cover_limit');
  const held = b.loans.filter(l => !l.back && !l.lost);

  const sec = h('section', {}, h('h2', {}, 'Library of things'),
    h('p', { class: 'hint' }, `What members lend one another, and what the network holds in common. A borrower leaves a cash deposit with the lender, which comes back with the thing${coverOn ? `; a member who cannot afford one may ask the solidarity fund to stand behind it (deposits up to ${coverLim ? fmt(coverLim) : 'any amount'})` : ''}. ${items.length} thing${items.length === 1 ? '' : 's'} listed · ${held.length} out now · ${fmt(held.reduce((a, l) => a + l.deposit, 0))} in deposits held${claimsOwed(state) ? ` · the fund owes ${fmt(claimsOwed(state))} in claims` : ''}.`));

  // ── yours: deposits, and what is waiting on you ──────────────────────────
  if (me) {
    const dep = deposits(state, me.id);
    const asks = items.filter(it => lender(it) === me.id && !current(state, it.id) && requestsFor(state, it.id).length);
    const lent = held.filter(l => l.lender === me.id), borrowed = held.filter(l => l.by === me.id);
    const owed = b.claims.filter(c => c.lender === me.id && !c.paid);
    if (asks.length || lent.length || borrowed.length || dep.holding || dep.left || owed.length) {
      const box = h('div', { class: 'grant' }, h('h3', {}, 'Yours'),
        h('p', { class: 'meta' }, `You hold ${fmt(dep.holding)} in deposits for others, and have ${fmt(dep.left)} in deposits with others.${owed.length ? ` The solidarity fund owes you ${fmt(owed.reduce((a, c) => a + c.amount, 0))}.` : ''}`));
      for (const it of asks) for (const q of requestsFor(state, it.id)) box.append(h('div', { class: 'row', style: 'margin:.5rem 0' },
        h('p', {}, who(q.by), ` asks to borrow ${it.title}${q.days ? ` for ${q.days} days` : ''}. `, q.cover && it.deposit ? h('strong', {}, 'The solidarity fund stands behind the deposit: take no cash.') : it.deposit ? `Take a ${fmt(it.deposit)} cash deposit when you hand it over.` : 'No deposit.'),
        h('button', { onclick: () => api.sign('thing.lend', { thing: it.id, to: q.by, deposit: q.cover ? 0 : it.deposit }, q.cover || !it.deposit ? `Lending ${it.title} to ${nm(q.by)}` : `Lending ${it.title} to ${nm(q.by)}: I received ${fmt(it.deposit)} in cash`) }, q.cover || !it.deposit ? 'I handed it over' : `I handed it over and received ${fmt(it.deposit)}`)));
      for (const l of lent) {
        const deposit = l.deposit || l.covered, keepId = `th-keep-${l.n}`, noteId = `th-note-${l.n}`;
        box.append(h('div', { style: 'margin:.75rem 0' },
          h('p', { class: overdue(l, now) ? 'flag' : '' }, `${title(l.thing)} is out with `, who(l.borrower || l.by), `, due ${day(l.due)}${overdue(l, now) ? ' (overdue)' : ''}. `, l.covered ? `Deposit covered by the solidarity fund (${fmt(l.covered)}).` : l.deposit ? `You hold their ${fmt(l.deposit)} deposit.` : '', l.said ? h('strong', {}, ` They say they returned it on ${day(l.said)}.`) : ''),
          h('div', { class: 'buttons' },
            h('button', { onclick: () => api.sign('thing.return', { thing: l.thing }, l.deposit ? `${title(l.thing)} is back; I returned the ${fmt(l.deposit)} deposit` : `${title(l.thing)} is back`) }, l.deposit ? `It’s back: I returned ${fmt(l.deposit)}` : 'It’s back'),
            h('button', { class: 'quiet', onclick: () => api.sign('thing.renew', { thing: l.thing, days: 7 }, `Giving ${nm(l.by)} 7 more days with ${title(l.thing)}`) }, '7 more days')),
          deposit ? h('details', {}, h('summary', {}, 'It came back damaged: keep part of the deposit'), h('div', { class: 'inline-form' },
            h('label', { for: keepId }, `Keep how much? (of ${fmt(deposit)}${l.covered ? ', claimed from the solidarity fund' : ''})`), h('input', { id: keepId, inputmode: 'decimal', placeholder: '0.00' }),
            h('label', { for: noteId }, 'Why (published; the borrower may dispute it)'), h('input', { id: noteId, maxlength: 300 }),
            h('div', { class: 'buttons' }, h('button', { onclick: () => { const kept = parse($(`#${keepId}`).value); api.sign('thing.return', { thing: l.thing, kept, note: $(`#${noteId}`).value.trim() }, `${title(l.thing)} is back; keeping ${fmt(kept)}${l.deposit ? ` and returning ${fmt(l.deposit - kept)}` : ' (claimed from the fund)'}`); } }, 'Sign the return')))) : null));
      }
      for (const l of borrowed) box.append(h('p', { class: overdue(l, now) ? 'flag' : '' }, `You have ${title(l.thing)}, lent by `, who(l.lender), `, due ${day(l.due)}${overdue(l, now) ? ' (overdue: please return it)' : ''}. ${l.covered ? 'The solidarity fund stands behind your deposit.' : l.deposit ? `They hold your ${fmt(l.deposit)} deposit.` : ''} `,
        l.said ? `You said you returned it on ${day(l.said)}.` : h('button', { class: 'quiet', onclick: () => api.sign('thing.returned', { thing: l.thing }, `I gave ${title(l.thing)} back to ${nm(l.lender)}`) }, 'I gave it back')));
      sec.append(box);
    }
  }

  // ── the library ───────────────────────────────────────────────────────────
  const cats = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
  sec.append(api.list({
    key: 'things', items, noun: 'things', empty: 'Nothing listed yet. List something below.',
    text: (it) => `${it.id} ${it.title} ${it.description || ''} ${it.category || ''} ${lender(it)}`,
    sorts: [['Available first', (x, y) => !!current(state, x.id) - !!current(state, y.id)], ['Newest first', api.sorts.newest((i) => i.listed)], ['Title, A–Z', api.sorts.byText((i) => i.title)], ['Smallest deposit', (x, y) => x.deposit - y.deposit]],
    filters: [{ label: 'Category', options: [['Every category', () => true], ...cats.map(c => [c, (i) => i.category === c])] },
      { label: 'Whose', options: [['Members’ and the network’s', () => true], ['The network’s', (i) => !i.owner], ['Members’', (i) => !!i.owner]] }],
    render: (it) => {
      const out = current(state, it.id), queue = requestsFor(state, it.id);
      const asked = me && queue.find(q => q.by === me.id), mineToLend = me && lender(it) === me.id;
      const daysId = `th-days-${it.id}`, coverId = `th-cover-${it.id}`;
      const coverable = coverOn && it.deposit > 0 && (!coverLim || it.deposit <= coverLim);
      return h('li', {}, h('h3', {}, it.title, it.category ? h('span', { class: 'category' }, it.category) : null),
        h('p', { class: 'meta' }, ...by(it), ` · ${it.deposit ? `deposit ${fmt(it.deposit)}` : 'no deposit'}${it.days ? ` · up to ${it.days} days` : ''}${it.where ? ` · ${it.where}` : ''}`),
        it.description ? h('p', {}, it.description) : null,
        h('p', { class: overdue(out, now) ? 'meta flag' : 'meta' }, out ? ['out with ', who(out.by), `, due ${day(out.due)}${overdue(out, now) ? ' (overdue)' : ''}`] : 'available', queue.length ? ` · ${queue.length} waiting` : ''),
        can && !mineToLend ? h('div', { class: 'buttons' },
          asked ? [h('span', { class: 'fine' }, `You asked on ${day(asked.at)}${asked.cover ? ', with the fund covering the deposit' : ''}. `), h('button', { class: 'quiet', onclick: () => api.sign('thing.cancel', { thing: it.id }, `Withdrawing my request for ${it.title}`) }, 'Withdraw my request')]
            : out?.by === me.id ? null
            : [h('input', { id: daysId, type: 'number', min: 1, max: it.days || params.value('things.max_days'), placeholder: `${it.days || params.value('things.default_days')} days`, style: 'width:7rem', 'aria-label': 'days' }),
              coverable ? h('label', { style: 'font-weight:400;display:flex;gap:.4rem;align-items:center;margin:0' }, h('input', { type: 'checkbox', id: coverId, style: 'width:auto' }), 'Ask the solidarity fund to cover the deposit') : null,
              h('button', { onclick: () => { const v = $(`#${daysId}`).value, cover = !!$(`#${coverId}`)?.checked; api.sign('thing.request', { thing: it.id, ...(v ? { days: Number(v) } : {}), ...(cover ? { cover } : {}) }, `Asking to borrow ${it.title}`); } }, out ? 'Get in line' : 'Ask to borrow')]) : null,
        can && it.owner === me.id && !out ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => api.sign('thing.withdraw', { thing: it.id }, `Taking ${it.title} off the list`) }, 'Take it off the list')) : null);
    },
  }));

  // ── list something ────────────────────────────────────────────────────────
  if (can) {
    const form = (net) => h('div', { class: 'inline-form' },
      h('label', { for: `th-t${net}` }, 'What is it?'), h('input', { id: `th-t${net}`, maxlength: 80, placeholder: 'Cordless drill' }),
      h('label', { for: `th-c${net}` }, 'Category'), h('input', { id: `th-c${net}`, maxlength: 40, placeholder: 'tools, camping, kitchen…', list: 'th-cats' }),
      h('label', { for: `th-dep${net}` }, `Deposit (${cur}; 0 for none)`), h('input', { id: `th-dep${net}`, inputmode: 'decimal', placeholder: '20.00' }),
      h('label', { for: `th-days${net}` }, 'Longest loan, in days (optional)'), h('input', { id: `th-days${net}`, type: 'number', min: 1, max: params.value('things.max_days') }),
      h('label', { for: `th-w${net}` }, 'Where to pick it up (optional, public)'), h('input', { id: `th-w${net}`, maxlength: 120, placeholder: 'Near the 4th St co-op' }),
      h('label', { for: `th-d${net}` }, 'Description (optional)'), h('textarea', { id: `th-d${net}`, maxlength: 600, style: 'font-family:inherit' }),
      net ? [h('label', { for: 'th-k' }, 'Kept by (member id)'), h('input', { id: 'th-k', value: me.id })] : null,
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const t = $(`#th-t${net}`).value.trim();
        let id = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 34) || 'thing';
        for (let i = 2; b.items[id]; i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
        const f = { thing: id, title: t, deposit: parse($(`#th-dep${net}`).value || '0') };
        for (const [k, el] of [['category', `th-c${net}`], ['where', `th-w${net}`], ['description', `th-d${net}`]]) { const v = $(`#${el}`).value.trim(); if (v) f[k] = v; }
        if ($(`#th-days${net}`).value) f.days = Number($(`#th-days${net}`).value);
        if (net) api.propose(`Add ${t} to the network’s library`, [{ kind: 'thing.add', keeper: $('#th-k').value.trim(), ...f }]);
        else api.sign('thing.list', f, `Lending ${t}${f.deposit ? ` against a ${fmt(f.deposit)} deposit` : ''}`);
      } }, net ? 'Propose it' : 'List it')));
    sec.append(h('datalist', { id: 'th-cats' }, cats.map(c => h('option', { value: c }))),
      h('details', {}, h('summary', {}, 'Lend something of yours'), form('')),
      h('details', {}, h('summary', {}, 'Propose something for the network to hold in common'), form('n')));
  }

  // ── every loan, every claim ───────────────────────────────────────────────
  if (b.loans.length) {
    const disputeDays = params.value('things.dispute_days');
    sec.append(h('details', {}, h('summary', {}, `Every loan (${b.loans.length})`), api.list({
      key: 'thing-loans', items: b.loans.slice().reverse(), noun: 'loans',
      mine: me ? (l) => l.by === me.id || l.lender === me.id : null,
      text: (l) => `${title(l.thing)} ${nm(l.by)} ${nm(l.lender)} ${l.note}`,
      filters: [{ label: 'Status', options: [['Every loan', () => true], ['Out', (l) => !l.back && !l.lost], ['Deposit kept', (l) => l.kept > 0], ['Disputed', (l) => !!l.dispute]] }],
      render: (l) => {
        const disputable = me && l.by === me.id && l.back && l.kept && !l.dispute && Date.parse(now) <= Date.parse(l.back) + disputeDays * 86400000;
        return h('li', {}, h('h3', {}, title(l.thing)),
          h('p', { class: 'meta' }, who(l.lender), ' lent it to ', who(l.by), ` · ${day(l.at)} → ${l.back ? day(l.back) : l.lost ? `lost ${day(l.lost)}` : `due ${day(l.due)}`} · ${l.covered ? `deposit covered by the fund (${fmt(l.covered)})` : l.deposit ? `deposit ${fmt(l.deposit)}` : 'no deposit'}`),
          l.kept ? h('p', { class: 'flag' }, `${fmt(l.kept)} kept: ${l.note}`) : null,
          l.dispute ? h('p', {}, h('strong', {}, 'Disputed: '), l.dispute.reason, l.settled ? ` · settled ${day(l.settled.at)}: ${fmt(l.settled.refund)} back to the borrower (${l.settled.note})` : ' · awaiting a decision') : null,
          disputable ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => { const why = prompt('Why do you dispute what was kept? (published)'); if (why) api.sign('thing.dispute', { loan: l.n, reason: why }, `Disputing what was kept from my deposit for ${title(l.thing)}`); } }, 'Dispute what was kept')) : null,
          can && l.dispute && !l.settled ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => { const v = prompt(`How much more should go back to the borrower? (0 to ${fmt(l.kept)})`); if (v === null) return; const note = prompt('The reasons (published)'); if (note) api.propose(`Settle the dispute over ${title(l.thing)}`, [{ kind: 'thing.settle', loan: l.n, refund: parse(v), note }]); } }, 'Propose a settlement')) : null,
          can && overdue(l, now) && !l.lost ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => { const note = prompt('What happened? (published)'); if (note) api.propose(`Declare ${title(l.thing)} lost`, [{ kind: 'thing.lost', loan: l.n, note }]); } }, 'Propose declaring it lost')) : null);
      },
    })));
  }
  if (b.claims.length) sec.append(h('details', {}, h('summary', {}, `Claims on the solidarity fund (${b.claims.filter(c => !c.paid).length} owed)`),
    h('ul', { class: 'items' }, b.claims.slice().reverse().map(c => h('li', {}, `${fmt(c.amount)} to `, who(c.lender), ` for ${title(b.loans[c.loan]?.thing)}, ${day(c.at)} · `,
      c.paid ? `paid ${day(c.paid.at)}${c.paid.note ? ` (${c.paid.note})` : ''}` : [h('strong', {}, 'owed'), can ? [' ', h('button', { class: 'quiet', onclick: () => api.propose(`Pay ${fmt(c.amount)} to ${c.lender} from the solidarity fund`, [{ kind: 'thing.pay', claim: c.n }]) }, 'Record it paid')] : null])))));
  return sec;
}
