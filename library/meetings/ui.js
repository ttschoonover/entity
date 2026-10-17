// The meetings tab: upcoming first, check-in on the day, minutes.
import { checkinWindow } from './index.js';

export default function render(api) {
  const { h, state, params, me, $, when } = api;
  const now = new Date().toISOString();
  const all = Object.values(state.m.meetings || {});
  const hours = params.value('meetings.checkin_hours');
  const sec = h('section', {}, h('h2', {}, 'Meetings'), h('p', { class: 'hint' }, 'Meetings, their agendas, who came (each member checks in themselves), and minutes.'));
  sec.append(api.list({
    key: 'meetings',
    edit: (m) => (api.me?.status === 'active' && !m.cancelled ? api.editForm('Edit this meeting', [['title', 'Title', m.title], ['starts', 'When (only before it starts)', m.starts, 'datetime'], ['place', 'Where', m.place], ['agenda', 'Agenda (one item per line)', m.agenda, 'lines']], (ch) => api.propose(`Amend the meeting ${m.title}`, [{ kind: 'meeting.amend', meeting: m.id, ...ch }])) : null), items: all, noun: 'meetings', empty: 'No meetings yet.',
    mine: me ? (m) => !!m.attendance[me.id] : null,
    text: (m) => `${m.id} ${m.title} ${m.place} ${m.agenda.join(' ')}`,
    sorts: [['Soonest first', (a, b) => (a.starts < now) - (b.starts < now) || (a.starts < now ? (a.starts < b.starts ? 1 : -1) : (a.starts < b.starts ? -1 : 1))], ['Newest first', api.sorts.newest((m) => m.starts)], ['Oldest first', api.sorts.oldest((m) => m.starts)]],
    filters: [{ label: 'When', options: [['Any time', () => true], ['Upcoming', (m) => m.starts >= now && !m.cancelled], ['Past', (m) => m.starts < now], ['Cancelled', (m) => !!m.cancelled]] }],
    render: (m) => {
      const w = checkinWindow(m, hours), open = now >= w.from && now <= w.to && !m.cancelled;
      const present = Object.keys(m.attendance);
      const minutes = m.approved ? m.minutes[m.approved.version - 1] : m.minutes[m.minutes.length - 1];
      return h('li', {}, h('h3', {}, m.title, m.cancelled ? h('span', { class: 'category' }, 'cancelled') : null),
        h('p', { class: 'meta' }, `${when(m.starts)}${m.place ? ` · ${m.place}` : ''} · called by ${m.by} · ${present.length} present`),
        m.cancelled ? h('p', { class: 'flag' }, `Cancelled: ${m.cancelled.reason}`) : null,
        m.agenda.length ? h('ol', {}, m.agenda.map(x => h('li', {}, x))) : null,
        present.length ? h('p', { class: 'fine' }, `Present: ${present.join(', ')}`) : null,
        me?.status === 'active' && open && !m.attendance[me.id] ? h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('meeting.attend', { meeting: m.id }, `Checking in to ${m.title}`) }, 'Check in')) : null,
        minutes ? h('details', {}, h('summary', {}, m.approved ? `Minutes (approved, version ${m.approved.version})` : `Minutes (draft ${minutes.version}, not yet approved)`), h('p', { class: 'post-body' }, minutes.text)) : null,
        me?.status === 'active' && now >= m.starts && !m.cancelled ? h('details', {}, h('summary', {}, m.minutes.length ? 'Revise the minutes' : 'Draft the minutes'),
          h('textarea', { id: `mn-${m.id}`, style: 'font-family:inherit;min-height:10rem', 'aria-label': 'Minutes' }, m.minutes.at(-1)?.text || ''),
          h('div', { class: 'buttons' },
            h('button', { onclick: () => api.sign('meeting.minutes', { meeting: m.id, text: $(`#mn-${m.id}`).value }, `Minutes of ${m.title}`) }, 'Sign this draft'),
            m.minutes.length && m.approved?.version !== m.minutes.length ? h('button', { class: 'quiet', onclick: () => api.propose(`Approve the minutes of ${m.title}`, [{ kind: 'meeting.approve', meeting: m.id, version: m.minutes.length }]) }, `Propose approving draft ${m.minutes.length}`) : null)) : null);
    },
  }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Call a meeting'), h('div', { class: 'inline-form' },
    h('label', { for: 'mt-title' }, 'Title'), h('input', { id: 'mt-title', placeholder: 'General meeting' }),
    h('label', { for: 'mt-id' }, 'Id'), h('input', { id: 'mt-id', placeholder: 'general-2026-10' }),
    h('label', { for: 'mt-when' }, 'When'), h('input', { id: 'mt-when', type: 'datetime-local' }),
    h('label', { for: 'mt-place' }, 'Where'), h('input', { id: 'mt-place' }),
    h('label', { for: 'mt-agenda' }, 'Agenda, one item per line'), h('textarea', { id: 'mt-agenda', style: 'font-family:inherit' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const e = { kind: 'meeting.call', meeting: $('#mt-id').value.trim(), title: $('#mt-title').value.trim(), starts: new Date($('#mt-when').value).toISOString() };
      if ($('#mt-place').value.trim()) e.place = $('#mt-place').value.trim();
      const ag = $('#mt-agenda').value.split('\n').map(x => x.trim()).filter(Boolean); if (ag.length) e.agenda = ag;
      api.propose(`Call: ${e.title}`, [e]);
    } }, 'Sign')))));
  return sec;
}
