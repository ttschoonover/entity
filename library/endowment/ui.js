// The endowment tab: principal, value, what may be drawn this year, and history.
import { drawable, drawnIn, yearOf } from './index.js';

export default function render(api) {
  const { h, state, params, me, $, day } = api;
  const cur = params.value('endowment.currency'), fmt = (n) => `${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  const b = state.m.endowment || { principal: 0, value: 0, gifts: [], values: [], draws: [] };
  const now = new Date().toISOString(), start = params.value('endowment.year_start');
  const rate = params.value('endowment.spend_rate') / 100;
  const events = [...b.gifts.map(g => ({ at: g.at, t: `Gift of ${fmt(g.amount)}${g.from ? ` from ${g.from}` : ''}` })), ...b.values.map(v => ({ at: v.at, t: `Valued at ${fmt(v.value)}` })), ...b.draws.map(x => ({ at: x.at, t: `Drew ${fmt(x.amount)} for ${x.to === 'loans' ? 'the loan fund' : 'the budget'}${x.note ? `: ${x.note}` : ''}` }))].sort((x, y) => (x.at < y.at ? 1 : -1));
  const sec = h('section', {}, h('h2', {}, 'Endowment'),
    h('p', { class: 'hint' }, `A permanent fund. Gifts become principal, which is never spent; each year the members may draw up to ${rate}% of its latest value, never below the principal.`),
    h('p', {}, `Value ${fmt(b.value)}${b.valued ? ` (as of ${day(b.valued)})` : ''} · principal ${fmt(b.principal)} · drawn this year ${fmt(drawnIn(state, yearOf(now, start), start))} · may still be drawn ${fmt(drawable(state, params, now))}`),
    events.length ? h('ul', {}, events.map(e => h('li', { class: 'fine' }, `${day(e.at)} · ${e.t}`))) : h('p', { class: 'fine' }, 'Nothing recorded yet.'));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Propose a draw'), h('div', { class: 'inline-form' },
    h('label', { for: 'en-a' }, `Amount (${cur})`), h('input', { id: 'en-a', type: 'number', min: 0, step: 0.01 }),
    h('label', { for: 'en-t' }, 'For'), h('select', { id: 'en-t' }, h('option', { value: 'loans' }, 'the loan fund'), h('option', { value: 'budget' }, 'the budget')),
    h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose('Draw from the endowment', [{ kind: 'endowment.draw', amount: Math.round(Number($('#en-a').value) * 100), to: $('#en-t').value }]) }, 'Sign')))));
  return sec;
}
