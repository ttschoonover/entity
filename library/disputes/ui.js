// The disputes tab: each case's timeline, and what each person may do next.
import { eligible } from './index.js';

const money = (params, n) => {
  const dec = params.has('value.decimals') ? params.value('value.decimals') : 0, name = params.has('value.name') ? params.value('value.name') : '';
  return `${dec ? (n / 10 ** dec).toFixed(dec) : n}${name ? ` ${name}` : ''}`;
};
async function fingerprintFiles(files) {
  const out = [];
  for (const f of files) {
    const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    out.push({ name: f.name.slice(0, 120), sha256: [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('') });
  }
  return out;
}

export default function render(api) {
  const { h, state, params, me, $, day, who } = api;
  const m = (n) => money(params, n);
  const all = Object.values(state.m.disputes || {});
  const named = (spec) => { const [t, id] = String(spec).split(':');
    if (t === 'office') return `the ${state.m.offices?.[id]?.title || id}`;
    if (t === 'committee') return `the ${state.m.committees?.[id]?.title || id}`;
    if (t === 'member') return id;
    return spec === 'assembly' ? 'the members, by proposal' : spec; };
  const arbiter = named(params.value('disputes.arbiter')), appealSpec = params.value('disputes.appeal'), appeal = named(appealSpec);
  const answerDays = params.value('disputes.answer_days'), appealDays = params.value('disputes.appeal_days'), deposit = params.value('disputes.deposit');
  const now = new Date().toISOString();
  const label = { open: 'awaiting a ruling', ruled: 'ruled · open to appeal', appealed: 'on appeal', final: 'decided' };
  const sec = h('section', {}, h('h2', {}, 'Disputes'),
    h('p', { class: 'hint' }, `Claims between members. ${arbiter[0].toUpperCase() + arbiter.slice(1)} rules first; ${appealSpec === 'none' ? 'there is no appeal' : `either side may appeal within ${appealDays} days, to ${appeal}`}. The other side has ${answerDays} days to answer before a ruling can be made without them. A ruling about a contract moves its escrow; any other ruling is paid from the loser’s balance.${deposit ? ` Opening a dispute takes a deposit of ${m(deposit)}, returned to the winner.` : ''} Evidence is recorded by its fingerprint: send the files themselves to the other side and the arbiter.`));

  const fileForm = (d, kind, title) => { const k = kind.replace('.', '-'); return h('details', {}, h('summary', {}, title), h('div', { class: 'inline-form' },
    h('label', { for: `ds-${k}-${d.id}` }, kind === 'dispute.appeal' ? 'Why the ruling was wrong' : 'Your statement'), h('textarea', { id: `ds-${k}-${d.id}` }),
    h('label', { for: `de-${k}-${d.id}` }, 'Evidence (optional)'), h('input', { id: `de-${k}-${d.id}`, type: 'file', multiple: true }),
    h('div', { class: 'buttons' }, h('button', { onclick: async () => {
      const evidence = await fingerprintFiles([...$(`#de-${k}-${d.id}`).files]);
      api.sign(kind, { dispute: d.id, statement: $(`#ds-${k}-${d.id}`).value.trim(), ...(evidence.length ? { evidence } : {}) }, `${title}: ${d.id}`);
    } }, 'Sign')))); };

  sec.append(api.list({
    key: 'disputes', items: all, noun: 'disputes', empty: 'No disputes. Long may it last.',
    mine: me ? (d) => d.claimant === me.id || d.respondent === me.id : null,
    text: (d) => `${d.id} ${d.claim} ${d.claimant} ${d.respondent} ${d.contract || ''}`,
    sorts: [['Newest first', api.sorts.newest((d) => d.opened)]],
    filters: [{ label: 'Status', options: [['Not yet decided', (d) => d.status !== 'final'], ['Awaiting a ruling', (d) => d.status === 'open' || d.status === 'appealed'], ['Decided', (d) => d.status === 'final'], ['Everything', () => true]] }],
    render: (d) => {
      const side = me && (d.claimant === me.id || d.respondent === me.id);
      const bench = ['open', 'appealed'].includes(d.status) ? eligible(state, d, params, now) : null;
      const canRule = me?.status === 'active' && bench && bench.members.includes(me.id) && bench.venue !== 'assembly';
      const pending = Object.values(d.pending || {});
      const appealOpen = d.status === 'ruled' && (Date.now() - Date.parse(d.ruled)) / 864e5 <= appealDays && appealSpec !== 'none';
      return h('li', {}, h('h3', {}, `${d.id}: `, who(d.claimant), ' v. ', who(d.respondent), h('span', { class: 'category' }, label[d.status] || d.status)),
        h('p', { class: 'meta' }, `claims ${m(d.amount)}`, d.contract ? ` · about the contract ${d.contract} (escrow ${d.status === 'final' ? 'settled' : 'frozen'})` : '', ` · opened ${day(d.opened)}`, d.owed ? h('span', { class: 'flag' }, ` · ${m(d.owed)} still owed`) : ''),
        h('ol', { class: 'timeline' }, [...d.filings.map(f => ({ at: f.at, el: h('li', {}, h('p', { class: 'meta' }, day(f.at), ' · ', who(f.by), ` · ${f.role}`), h('p', {}, f.statement),
          f.evidence?.length ? h('ul', { class: 'fine' }, f.evidence.map(e => h('li', {}, e.name, ' · ', h('span', { class: 'hash' }, e.sha256.slice(0, 16) + '…'), e.note ? ` · ${e.note}` : ''))) : null) })),
          ...d.rulings.map((r, i) => ({ at: r.at, el: h('li', { class: 'ruling' }, h('p', { class: 'meta' }, day(r.at), ` · ${i ? 'ruling on appeal' : 'ruling'} by `, r.by.join(', ')), h('p', {}, h('strong', {}, `Awarded ${m(r.amount)} to ${d.claimant}. `), r.reasons),
            (r.concurring || []).map(c => h('p', { class: 'fine' }, `${c.by} concurring: ${c.reasons}`))) }))].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).map(x => x.el)),
        pending.length ? h('p', { class: 'fine' }, pending.map(p => `Signed so far for awarding ${m(p.amount)}: ${p.by.join(', ')} (${bench ? `${bench.needs} needed` : ''})`).join(' · ')) : null,
        me?.status === 'active' ? h('div', {},
          side && d.status !== 'final' ? fileForm(d, 'dispute.file', d.respondent === me.id && !d.answered ? 'Answer the claim' : 'File a statement') : null,
          side && appealOpen ? fileForm(d, 'dispute.appeal', 'Appeal the ruling') : null,
          canRule ? h('details', { open: true }, h('summary', {}, d.status === 'appealed' ? 'Rule on the appeal' : 'Rule on this dispute'), h('div', { class: 'inline-form' },
            h('label', { for: `ra-${d.id}` }, `Award to ${d.claimant} (0 to ${m(d.amount)})`), h('input', { id: `ra-${d.id}`, type: 'number', min: 0, max: d.amount, value: 0 }),
            h('label', { for: `rr-${d.id}` }, 'Reasons (published with the ruling)'), h('textarea', { id: `rr-${d.id}` }),
            h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('dispute.rule', { dispute: d.id, amount: Number($(`#ra-${d.id}`).value), reasons: $(`#rr-${d.id}`).value.trim() }, `Your ruling in ${d.id}`) }, 'Sign the ruling')))) : null,
          d.status === 'ruled' && !appealOpen ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => api.sign('dispute.execute', { dispute: d.id }, `Carrying out the ruling in ${d.id}`) }, 'Carry out the ruling')) : null,
          d.owed > 0 && d.respondent === me.id ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => api.sign('dispute.pay', { dispute: d.id, amount: Math.min(d.owed, state.m.value?.balances?.[me.id] || 0) }, `Paying what the ruling left owed in ${d.id}`) }, 'Pay what you can of it')) : null) : null,
        h('details', {}, h('summary', {}, 'History'), h('ul', {}, d.history.map(x => h('li', { class: 'fine' }, `${day(x.at)} · ${x.by}: ${x.what}`)))));
    },
  }));
  if (me?.status === 'active') {
    const others = state.order.filter(id => id !== me.id && state.participants[id]?.status === 'active');
    sec.append(h('details', {}, h('summary', {}, 'Open a dispute not about a contract'), h('div', { class: 'inline-form' },
      h('p', { class: 'hint' }, 'For a dispute about a contract, open it from the contract itself (Contracts tab), so its escrow is frozen.'),
      h('label', { for: 'dn-against' }, 'Against'), h('select', { id: 'dn-against' }, others.map(id => h('option', { value: id }, id))),
      h('label', { for: 'dn-claim' }, 'What happened, and what you ask'), h('textarea', { id: 'dn-claim' }),
      h('label', { for: 'dn-amount' }, 'Amount you ask to be awarded (0 if none)'), h('input', { id: 'dn-amount', type: 'number', min: 0, value: 0 }),
      h('label', { for: 'dn-ev' }, 'Evidence (optional)'), h('input', { id: 'dn-ev', type: 'file', multiple: true }),
      h('div', { class: 'buttons' }, h('button', { onclick: async () => {
        const evidence = await fingerprintFiles([...$('#dn-ev').files]);
        api.sign('dispute.open', { dispute: `d-${Date.now().toString(36)}`, against: $('#dn-against').value, amount: Number($('#dn-amount').value), claim: $('#dn-claim').value.trim(), ...(evidence.length ? { evidence } : {}) }, 'Your dispute');
      } }, 'Sign and open it')))));
  }
  return sec;
}
