// The polls tab.
import { results, isOpen } from './index.js';

export default function render(api) {
  const { h, state, me, $, when, who } = api;
  const now = new Date().toISOString();
  const all = Object.values(state.m.polls || {}).sort((a, b) => (a.at < b.at ? 1 : -1));
  const sec = h('section', {}, h('h2', {}, 'Polls'), h('p', { class: 'hint' }, 'Opinions, counted from the record. A poll decides nothing.'));
  if (!all.length) sec.append(h('p', { class: 'hint' }, 'No polls yet.'));
  sec.append(api.list({
    key: 'polls', items: all, noun: 'polls', mine: me ? (p) => p.by === me.id || (isOpen(p, now) && p.roll.includes(me.id) && !p.answers[me.id]) : null,
    text: (p) => `${p.question} ${p.options.join(' ')} ${p.by}`,
    sorts: [['Newest first', api.sorts.newest()], ['Oldest first', api.sorts.oldest()], ['Most answered', (a, b) => Object.keys(b.answers).length - Object.keys(a.answers).length]],
    render: (p => {
    const r = results(p), open = isOpen(p, now), mine = me && p.answers[me.id];
    const can = me && open && p.roll.includes(me.id);
    const top = Math.max(1, ...Object.values(r.counts));
    return h('li', {}, h('h3', {}, p.question),
      h('p', { class: 'meta' }, 'asked by ', who(p.by), ` · ${p.mode === 'approval' ? 'choose any' : 'choose one'} · ${open ? `open until ${when(p.closes)}` : `closed ${when(p.closed || p.closes)}`} · ${r.answered} of ${r.eligible} answered`),
      h('div', {}, p.options.map(o => h('div', { class: 'poll-row' },
        can ? h('input', { type: p.mode === 'approval' ? 'checkbox' : 'radio', name: `pl-${p.id}`, value: o, checked: mine?.includes(o), 'aria-label': o }) : null,
        h('span', {}, o), h('span', { class: 'poll-bar', style: `width:${(r.counts[o] / top) * 8}rem` }), h('span', { class: 'fine' }, String(r.counts[o]))))),
      can ? h('div', { class: 'buttons' },
        h('button', { class: 'quiet', onclick: () => {
          const choices = [...document.querySelectorAll(`input[name="pl-${p.id}"]:checked`)].map(i => i.value);
          if (!choices.length) return alert('Choose something first.');
          api.sign('poll.answer', { poll: p.id, choices }, `Your answer to "${p.question}"`);
        } }, mine ? 'Change my answer' : 'Answer'),
        me.id === p.by ? h('button', { class: 'quiet', onclick: () => api.sign('poll.close', { poll: p.id }, `Closing "${p.question}"`) }, 'Close now') : null) : null);
  }),
  }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Ask something'), h('div', { class: 'inline-form' },
    h('label', { for: 'pl-q' }, 'Question'), h('input', { id: 'pl-q' }),
    h('label', { for: 'pl-o' }, 'Options, one per line'), h('textarea', { id: 'pl-o', style: 'font-family:inherit' }),
    h('label', { for: 'pl-m' }, 'Answers'), h('select', { id: 'pl-m' }, h('option', { value: 'single' }, 'one choice each'), h('option', { value: 'approval' }, 'any number of choices')),
    h('label', { for: 'pl-d' }, 'Days open (empty: the default)'), h('input', { id: 'pl-d', type: 'number', min: 1 }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const f = { question: $('#pl-q').value.trim(), options: $('#pl-o').value.split('\n').map(x => x.trim()).filter(Boolean), mode: $('#pl-m').value };
      if ($('#pl-d').value) f.days = Number($('#pl-d').value);
      api.sign('poll.open', f, `Your poll "${f.question}"`);
    } }, 'Sign this poll')))));
  return sec;
}
