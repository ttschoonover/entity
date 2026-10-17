// The finality tab: what is final, the open checkpoint and who must sign it,
// every final checkpoint, and the evidence against validators who cheated.
import { lastFinal, isOpen, weightOf, rollFor } from './index.js';

function render(api) {
  const { h, state, params, registry, me, when, day, who, $, E } = api;
  const f = state.m.finality || { finals: [], open: null, banned: {}, evidence: [] };
  const now = new Date().toISOString();
  const last = lastFinal(state), o = isOpen(state, now);
  const n = (last?.number || 0) + 1;
  const pct = Math.round(params.value('finality.threshold') * 100);
  const total = state.head.seq;
  const roll = o ? { roll: o.roll, total: o.total } : rollFor(registry, state, n, now);
  const mine = me && roll.roll[me.id] && !f.banned[me.id];
  const sec = h('section', {}, h('h2', {}, 'Finality'),
    h('p', {}, `Checkpoints are signed by ${E.describeElectorate(registry, params.value('finality.signers'))}. One becomes final once its signers carry ${pct}% of their weight, and always more than half. Final records are never undone; the rest are provisional until the next checkpoint.`),
    h('div', { class: 'bar', role: 'img', 'aria-label': `${last?.count || 0} of ${total} records final` },
      h('i', { class: 'f', style: `width:${total ? ((last?.count || 0) / total) * 100 : 0}%` })),
    h('p', { class: 'meta' }, last ? `Final: records 1–${last.count} (checkpoint ${last.number}, ${when(last.at)}). Provisional: ${total - last.count}.` : `Nothing is final yet: all ${total} records are provisional.`));

  // The open checkpoint, or the next one to open.
  const rows = Object.entries(roll.roll).sort((a, b) => b[1] - a[1]).map(([id, w]) =>
    h('tr', {}, h('td', {}, who(id)), h('td', {}, String(w)), h('td', {}, f.banned[id] ? 'excluded' : o?.signed[id] ? `signed ${when(o.signed[id])}` : '—')));
  const signBtn = mine && (!o || !o.signed[me.id]) ? h('div', { class: 'buttons' }, h('button', { onclick: () =>
    api.sign('checkpoint.sign', o ? { number: o.number, count: o.count, head: o.head } : { number: n, count: state.head.seq, head: state.head.hash },
      o ? `Your signature on checkpoint ${o.number} (records 1–${o.count})` : `Opening checkpoint ${n} at record ${state.head.seq}`) },
  o ? `Sign checkpoint ${o.number}` : `Open checkpoint ${n} at record ${state.head.seq}`)) : null;
  sec.append(...[h('h3', {}, o ? `Checkpoint ${o.number}: open at record ${o.count}` : `Checkpoint ${n}: not opened yet`),
    o ? h('p', { class: 'fine' }, `${weightOf(state, o)} of ${o.total} signed. It lapses on ${day(new Date(Date.parse(o.opened) + params.value('finality.open_days') * 86400000).toISOString())} if not final by then, and may be reopened at the head.`)
      : h('p', { class: 'fine' }, total > (last?.count || 0) ? 'Any signer may open it at the record\'s current head.' : 'There is nothing new to make final.'),
    roll.why ? h('p', { class: 'flag' }, `Nobody can sign: ${roll.why}.`) : null,
    h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Signer'), h('th', {}, 'Weight'), h('th', {}, 'Signed'))), h('tbody', {}, rows))),
    h('p', { class: 'fine' }, n > 1 ? `These signers were fixed when checkpoint ${n - 1} was opened, so nobody can be added to them afterwards.` : 'The first checkpoint\'s signers are those at the moment it opens: open it early.'),
    signBtn].filter(Boolean));

  if (f.finals.length) sec.append(h('h3', {}, 'Final checkpoints'), api.list({
    key: 'finals', items: f.finals, noun: 'checkpoints', head: ['#', 'Records', 'When', 'Signed by', 'Head'],
    row: (x) => h('tr', {}, h('td', {}, x.number), h('td', {}, `1–${x.count}`), h('td', {}, when(x.at)), h('td', {}, `${x.signers.join(', ')} (${x.weight} of ${x.total})`), h('td', { class: 'hash' }, api.link(`record/${x.count}`, `${x.head.slice(0, 12)}…`))),
    sorts: [['Newest first', (a, b) => b.number - a.number], ['Oldest first', (a, b) => a.number - b.number]],
  }));

  sec.append(...[h('h3', {}, 'Cheating'),
    h('p', { class: 'fine' }, `A signer who signs a checkpoint of any other history can be caught by anyone holding their signature. They are excluded from signing for good${params.value('finality.vacate') ? ', lose the seat that made them a signer' : ''}${params.value('finality.slash') ? `, and are fined ${Math.round(params.value('finality.slash') * 100)}% of what they hold${params.value('finality.bounty') ? `, ${Math.round(params.value('finality.bounty') * 100)}% of it paid to whoever reported them` : ''}` : ''}${params.value('finality.remove') ? ', and are removed from the entity' : ''}.`),
    f.evidence.length ? h('ul', {}, f.evidence.map(x => h('li', {}, h('strong', {}, x.against), ` excluded ${when(x.at)}, on evidence from `, who(x.by), `: ${x.why}`))) : h('p', { class: 'hint' }, 'Nobody has been caught.'),
    me?.status === 'active' ? h('details', {}, h('summary', {}, 'Submit evidence'),
      h('p', { class: 'fine' }, 'Paste a signed checkpoint.sign act from another copy that contradicts this record. `entity finality scan OTHER-COPY` finds them for you.'),
      h('textarea', { id: 'fin-ev', spellcheck: 'false', 'aria-label': 'The signed statement' }),
      h('div', { class: 'buttons' }, h('button', { class: 'danger', onclick: () => {
        let st; try { st = JSON.parse($('#fin-ev').value); } catch (x) { return alert(`That is not a signed act: ${x.message}`); }
        api.sign('checkpoint.evidence', { statement: st }, `Evidence against ${st.by}`);
      } }, 'Sign and submit'))) : null].filter(Boolean));
  if (f.reanchored?.length) sec.append(h('h3', {}, 'Re-anchored'), h('ul', {}, f.reanchored.map(x => h('li', {}, `${when(x.at)}, from checkpoint ${x.number}: ${x.reason}`))));
  return sec;
}

export const tabs = [{ id: 'finality', title: 'Finality', render: (api) => render(api) }];
