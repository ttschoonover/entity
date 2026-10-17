// The contracts tab: deals between members, their escrow, and what to do next.
import { owes } from './index.js';

export const money = (params, n) => {
  const dec = params.has('value.decimals') ? params.value('value.decimals') : 0, name = params.has('value.name') ? params.value('value.name') : '';
  return `${dec ? (n / 10 ** dec).toFixed(dec) : n}${name ? ` ${name}` : ''}`;
};

// The SHA-256 fingerprint of a file, computed here in the browser: only the
// fingerprint goes on the record; the file goes to the other side directly.
export async function fingerprintFiles(files) {
  const out = [];
  for (const f of files) {
    const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    out.push({ name: f.name.slice(0, 120), sha256: [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('') });
  }
  return out;
}

export default function render(api) {
  const { h, state, params, me, $, day, who } = api;
  const all = Object.values(state.m.contracts || {});
  const m = (n) => money(params, n);
  const wait = params.value('contracts.release_days');
  const disputes = params.has('disputes.arbiter');
  const label = { offered: 'offered', active: 'agreed · in escrow', done: 'done · awaiting the payer', paid: 'paid', refunded: 'refunded', split: 'split by ruling', declined: 'declined', withdrawn: 'withdrawn' };
  const sec = h('section', {}, h('h2', {}, 'Contracts'),
    h('p', { class: 'hint' }, `Deals between two members. When one is accepted, the payment is held in escrow; it goes to the provider when the payer confirms, or after ${wait} days if the payer neither confirms nor disputes it. Both sides can cancel together.${disputes ? ' Either side can open a dispute, which freezes the escrow until it is ruled on.' : ''}`));
  if (me) {
    const bal = state.m.value?.balances?.[me.id] || 0;
    const held = Object.values(state.m.value?.held || {}).filter(x => x.from === me.id).reduce((a, x) => a + x.amount, 0);
    const owing = owes(state, me.id);
    sec.append(h('p', {}, 'Your balance: ', h('strong', {}, m(bal)), held ? ` · ${m(held)} of yours held in escrow` : '', owing ? h('span', { class: 'flag' }, ` · you owe ${m(owing)} under a ruling (Disputes tab)`) : ''));
  }
  sec.append(api.list({
    key: 'contracts', items: all, noun: 'contracts', empty: 'No contracts yet.',
    mine: me ? (c) => c.provider === me.id || c.payer === me.id : null,
    text: (c) => `${c.id} ${c.title} ${c.terms} ${c.provider} ${c.payer}`,
    sorts: [['Newest first', api.sorts.newest((c) => c.at)], ['Largest first', (a, b) => b.amount - a.amount]],
    filters: [{ label: 'Status', options: [['Open or in progress', (c) => ['offered', 'active', 'done'].includes(c.status)], ['Offers', (c) => c.status === 'offered'], ['In escrow', (c) => ['active', 'done'].includes(c.status)], ['Closed', (c) => !['offered', 'active', 'done'].includes(c.status)], ['Everything', () => true]] }],
    render: (c) => {
      const iam = me && (c.provider === me.id ? 'provider' : c.payer === me.id ? 'payer' : null);
      const act = (kind, text, extra = {}) => h('button', { class: 'quiet', onclick: () => api.sign(kind, { contract: c.id, ...extra }, `${text}: ${c.title}`) }, text);
      const live = ['active', 'done'].includes(c.status), frozen = !!c.dispute;
      const canCollect = c.status === 'done' && (Date.now() - Date.parse(c.doneAt)) / 864e5 >= wait;
      const buttons = me?.status === 'active' && iam ? [
        c.status === 'offered' && c.offeredBy !== me.id ? [act('contract.accept', `Accept (${m(c.amount)} into escrow)`), act('contract.decline', 'Decline')] : null,
        c.status === 'offered' && c.offeredBy === me.id ? act('contract.withdraw', 'Withdraw the offer') : null,
        live && !frozen && iam === 'provider' && c.status === 'active' ? act('contract.done', 'Mark it done') : null,
        live && !frozen && iam === 'payer' ? act('contract.confirm', 'Confirm and pay') : null,
        canCollect && !frozen && iam === 'provider' ? act('contract.collect', 'Collect the payment') : null,
        live && !frozen && !(c.cancel || []).includes(me.id) ? act('contract.cancel', (c.cancel || []).length ? 'Agree to cancel' : 'Propose cancelling') : null,
      ] : null;
      const disputeForm = disputes && me?.status === 'active' && iam && live && !frozen ? h('details', {}, h('summary', {}, 'Open a dispute'), h('div', { class: 'inline-form' },
        h('label', { for: `dc-${c.id}` }, 'What went wrong'), h('textarea', { id: `dc-${c.id}` }),
        h('label', { for: `da-${c.id}` }, `What you ask to be awarded (up to ${m(c.amount)})`), h('input', { id: `da-${c.id}`, type: 'number', min: 0, max: c.amount, value: c.amount }),
        h('label', { for: `de-${c.id}` }, 'Evidence (optional): only its fingerprint goes on the record; send the files themselves to the other side and the arbiter'), h('input', { id: `de-${c.id}`, type: 'file', multiple: true }),
        h('div', { class: 'buttons' }, h('button', { onclick: async () => {
          const evidence = await fingerprintFiles([...$(`#de-${c.id}`).files]);
          let n = 1; while (state.m.disputes?.[`${c.id}-${n}`]) n++;
          const id = `${c.id}-${n}`;
          api.sign('dispute.open', { dispute: id, contract: c.id, amount: Number($(`#da-${c.id}`).value), claim: $(`#dc-${c.id}`).value.trim(), ...(evidence.length ? { evidence } : {}) }, `Your dispute about ${c.title}`);
        } }, 'Sign and open it')))) : null;
      return h('li', {}, h('h3', {}, c.title, h('span', { class: 'category' }, frozen ? `disputed (${c.dispute})` : label[c.status] || c.status)),
        h('p', { class: 'meta' }, m(c.amount), ' · ', who(c.provider), ' provides, ', who(c.payer), ' pays', c.due ? ` · due ${day(c.due)}` : '', ` · offered ${day(c.at)}`),
        h('details', {}, h('summary', {}, 'Terms'), h('p', { class: 'post-body' }, c.terms), h('p', { class: 'fine' }, 'Fingerprint of these terms: ', h('span', { class: 'hash' }, c.text))),
        h('details', {}, h('summary', {}, 'History'), h('ul', {}, c.history.map(x => h('li', { class: 'fine' }, `${day(x.at)} · ${x.by}: ${x.what}`)))),
        buttons ? h('div', { class: 'buttons' }, buttons) : null, disputeForm);
    },
  }));
  if (me?.status === 'active') {
    const others = state.order.filter(id => id !== me.id && state.participants[id]?.status === 'active');
    sec.append(h('details', {}, h('summary', {}, 'Offer a contract'), h('div', { class: 'inline-form' },
      h('label', { for: 'ct-title' }, 'What'), h('input', { id: 'ct-title', placeholder: 'A haircut' }),
      h('label', { for: 'ct-with' }, 'With'), h('select', { id: 'ct-with' }, others.map(id => h('option', { value: id }, id))),
      h('label', { for: 'ct-role' }, 'You are'), h('select', { id: 'ct-role' }, h('option', { value: 'provider' }, 'the provider (you do it, they pay)'), h('option', { value: 'payer' }, 'the payer (they do it, you pay)')),
      h('label', { for: 'ct-amount' }, `Price${params.has('value.decimals') && params.value('value.decimals') ? ', in the smallest unit' : ''}`), h('input', { id: 'ct-amount', type: 'number', min: 1, value: 25 }),
      h('label', { for: 'ct-terms' }, 'Terms: what, when, where, and what counts as done'), h('textarea', { id: 'ct-terms', placeholder: 'One haircut, Saturday at 2pm, in my room.' }),
      h('label', { for: 'ct-due' }, 'Due (optional)'), h('input', { id: 'ct-due', type: 'date' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const title = $('#ct-title').value.trim();
        const f = { contract: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'deal'}-${Date.now().toString(36).slice(-4)}`,
          with: $('#ct-with').value, role: $('#ct-role').value, amount: Number($('#ct-amount').value), title, terms: $('#ct-terms').value.trim() };
        if ($('#ct-due').value) f.due = new Date($('#ct-due').value).toISOString();
        api.sign('contract.offer', f, `Your offer: ${title}`);
      } }, 'Sign the offer')))));
  }
  return sec;
}
