// The value section of the page.
export default function render(api) {
  const { h, state, params, me, $ } = api;
  const d = params.value('value.decimals'), unit = params.value('value.name');
  const fmt = (n) => `${(n / 10 ** d).toFixed(d)} ${unit}`;
  const parse = (s) => Math.round(Number(s) * 10 ** d);
  const l = state.m.value || { balances: {}, supply: 0 };
  const holders = Object.entries(l.balances).filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
  const others = Object.values(state.participants).filter(p => p.status !== 'left' && p.id !== me?.id).map(p => p.id);
  const sec = h('section', {}, h('h2', {}, unit[0].toUpperCase() + unit.slice(1)),
    h('p', { class: 'hint' }, `${fmt(l.supply)} exist. New ${unit} are issued only by decision.`));
  if (me) sec.append(h('p', {}, 'You hold ', h('strong', {}, fmt(l.balances[me.id] || 0)), '.'));
  // With the finality module: a payment is final once a final checkpoint covers it.
  if (state.m.finality && params.value('entity.modules').includes('finality')) {
    const last = state.m.finality.finals.slice(-1)[0];
    const recent = api.nameOf ? state.head.seq - (last?.count || 0) : 0;
    sec.append(h('p', { class: 'fine' }, last
      ? `Payments are final up to record ${last.count} (checkpoint ${last.number}). The ${recent} record(s) since, including any payments in them, are provisional until the next checkpoint.`
      : 'No checkpoint is final yet, so no payment is final: treat balances as provisional.'));
  }
  if (holders.length) sec.append(api.list({
    key: 'value', items: holders, noun: 'holders', head: ['Holder', 'Balance', 'Share'],
    row: ([id, b]) => h('tr', {}, h('td', {}, api.who ? api.who(id) : id), h('td', {}, fmt(b)), h('td', {}, `${((b / (l.supply || 1)) * 100).toFixed(1)}%`)),
    mine: me ? ([id]) => id === me.id : null,
    text: ([id]) => `${id} ${api.nameOf ? api.nameOf(id) : ''}`,
    sorts: [['Largest first', (a, b) => b[1] - a[1]], ['Smallest first', (a, b) => a[1] - b[1]], ['Holder, A–Z', api.sorts.byText(([id]) => id)]],
  }));
  if (!me || me.status !== 'active') return sec;
  if (params.value('value.transferable') && (l.balances[me.id] || 0) > 0) {
    sec.append(h('details', {}, h('summary', {}, `Send ${unit}`), h('div', { class: 'inline-form' },
      h('label', { for: 'v-to' }, 'To'), h('select', { id: 'v-to' }, others.map(id => h('option', { value: id }, id))),
      h('label', { for: 'v-amount' }, 'Amount'), h('input', { id: 'v-amount', type: 'number', min: 1 / 10 ** d, step: 1 / 10 ** d }),
      h('label', { for: 'v-memo' }, 'Memo (public)'), h('input', { id: 'v-memo' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const amount = parse($('#v-amount').value); if (!(amount > 0)) return alert('Enter an amount.');
        api.sign('value.transfer', { to: $('#v-to').value, amount, memo: $('#v-memo').value || undefined }, `Sending ${fmt(amount)} to ${$('#v-to').value}`);
      } }, 'Sign and send')))));
  }
  sec.append(h('details', {}, h('summary', {}, `Propose issuing ${unit}`), h('div', { class: 'inline-form' },
    h('label', { for: 'v-issue-to' }, 'To'), h('select', { id: 'v-issue-to' }, Object.values(state.participants).filter(p => p.status !== 'left').map(p => h('option', { value: p.id }, p.id))),
    h('label', { for: 'v-issue-amount' }, 'Amount'), h('input', { id: 'v-issue-amount', type: 'number', min: 0 }),
    h('label', { for: 'v-issue-memo' }, 'Why (public)'), h('input', { id: 'v-issue-memo' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const amount = parse($('#v-issue-amount').value); if (!(amount > 0)) return alert('Enter an amount.');
      api.propose(`Issue ${fmt(amount)} to ${$('#v-issue-to').value}`, [{ kind: 'value.issue', to: $('#v-issue-to').value, amount, memo: $('#v-issue-memo').value || undefined }]);
    } }, 'Sign this proposal')))));
  return sec;
}
