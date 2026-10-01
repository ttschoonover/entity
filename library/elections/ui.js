// The elections tab.
import { phase } from './index.js';

export default function render(api) {
  const { h, state, me, $, when, who, params } = api;
  const now = new Date().toISOString();
  const all = Object.values(state.m.elections || {}).sort((a, b) => (a.called < b.called ? 1 : -1));
  const offices = Object.values(state.m.offices || {}).filter(o => !o.abolished);
  const sec = h('section', {}, h('h2', {}, 'Elections'), h('p', { class: 'hint' }, 'Offices filled by vote. Candidates stand, then those on the roll vote, then anyone counts: the result is counted from the record and the winners appointed.'));
  if (!all.length) sec.append(h('p', { class: 'hint' }, 'No elections yet.'));
  sec.append(api.list({
    key: 'elections', items: all, noun: 'elections', mine: me ? (e) => !!e.candidates[me.id] || (phase(e, now) === 'voting' && e.roll.includes(me.id) && !e.ballots[me.id]) : null,
    text: (e) => `${e.id} ${e.office} ${Object.keys(e.candidates).join(' ')}`,
    sorts: [['Newest first', api.sorts.newest((e) => e.called)], ['Oldest first', api.sorts.oldest((e) => e.called)]],
    render: (e => {
    const ph = phase(e, now), cands = Object.keys(e.candidates), mine = me && e.ballots[me.id];
    const office = state.m.offices?.[e.office]?.title || e.office;
    const kids = [h('h3', {}, `${office}: ${e.seats} seat${e.seats === 1 ? '' : 's'}`),
      h('p', { class: 'meta' }, `${e.id} · ${e.method === 'ranked' ? 'ranked (instant runoff)' : 'approval'} voting · ${
        { candidacy: `candidacy open until ${when(e.standUntil)}`, voting: `voting open until ${when(e.voteUntil)}`, closed: 'voting closed; waiting to be counted', counted: `counted ${when(e.counted?.at)}` }[ph]} · ${Object.keys(e.ballots).length} of ${e.roll.length} voted`),
      cands.length ? h('ul', {}, cands.map(c => h('li', {}, who(c), e.candidates[c].statement ? `: ${e.candidates[c].statement}` : '',
        e.counted?.winners.includes(c) ? h('strong', {}, ' · elected') : ''))) : h('p', { class: 'hint' }, 'Nobody has stood.')];
    if (e.counted && !e.counted.enacted) kids.push(h('p', { class: 'state-failed' }, `Not put into effect: ${e.counted.notEnacted}`));
    const btns = [];
    if (me?.status === 'active' && ph === 'candidacy') btns.push(e.candidates[me.id]
      ? h('button', { class: 'quiet', onclick: () => api.sign('election.withdraw', { election: e.id }, `Withdrawing from ${e.id}`) }, 'Withdraw')
      : h('button', { class: 'quiet', onclick: () => { const s = prompt('A statement for voters (optional, public):'); if (s !== null) api.sign('election.stand', { election: e.id, ...(s ? { statement: s } : {}) }, `Standing for ${office}`); } }, 'Stand'));
    if (me && ph === 'voting' && e.roll.includes(me.id) && cands.length) {
      kids.push(h('div', { class: 'inline-form' }, cands.map(c => h('label', { style: 'font-weight:400' },
        e.method === 'ranked'
          ? h('input', { type: 'number', min: 1, max: cands.length, id: `ev-${e.id}-${c}`, value: mine ? (mine.indexOf(c) + 1 || '') : '', style: 'width:4rem;margin-right:.5rem', 'aria-label': `rank for ${c}` })
          : h('input', { type: 'checkbox', id: `ev-${e.id}-${c}`, checked: mine?.includes(c), style: 'width:auto;margin-right:.5rem' }), c))));
      btns.push(h('button', { onclick: () => {
        const choices = e.method === 'ranked'
          ? cands.map(c => [c, Number($(`#ev-${e.id}-${c}`).value)]).filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1]).map(([c]) => c)
          : cands.filter(c => $(`#ev-${e.id}-${c}`).checked);
        api.sign('election.vote', { election: e.id, choices }, `Your ballot for ${office}`);
      } }, mine ? 'Change my ballot' : 'Sign my ballot'));
    }
    if (me && ph === 'closed') btns.push(h('button', { onclick: () => api.sign('election.count', { election: e.id }, `Counting ${e.id}`) }, 'Count and appoint'));
    if (btns.length) kids.push(h('div', { class: 'buttons' }, btns));
    return h('li', {}, kids);
  }),
  }));
  if (me?.status === 'active' && offices.length) sec.append(h('details', {}, h('summary', {}, 'Propose an election'), h('div', { class: 'inline-form' },
    h('label', { for: 'el-office' }, 'Office'), h('select', { id: 'el-office' }, offices.map(o => h('option', { value: o.id }, o.title))),
    h('label', { for: 'el-method' }, 'Voting'), h('select', { id: 'el-method' }, h('option', { value: 'approval' }, 'approval: tick any number'), h('option', { value: 'ranked' }, 'ranked: instant runoff')),
    h('label', { for: 'el-stand' }, 'Days to stand'), h('input', { id: 'el-stand', type: 'number', min: 1, value: 7 }),
    h('label', { for: 'el-vote' }, 'Days to vote'), h('input', { id: 'el-vote', type: 'number', min: 1, value: 7 }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const office = $('#el-office').value, id = `${office}-${new Date().toISOString().slice(0, 10)}`;
      api.propose(`Elect the ${$('#el-office').selectedOptions[0].text}`, [{ kind: 'election.call', election: id, office, method: $('#el-method').value, stand_days: Number($('#el-stand').value), vote_days: Number($('#el-vote').value) }]);
    } }, 'Sign this proposal')))));
  else if (!offices.length) sec.append(h('p', { class: 'hint' }, 'Elections fill offices: create an office first.'));
  return sec;
}
