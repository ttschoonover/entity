// The tasks tab: what is open, what you have claimed, hours.
import { hoursOf } from './index.js';

export default function render(api) {
  const { h, state, params, me, $, day, who } = api;
  const all = Object.values(state.m.tasks?.items || {});
  const status = (t) => (t.cancelled ? 'withdrawn' : t.verified ? 'verified' : t.done ? 'done, to verify' : t.claimer ? 'claimed' : 'open');
  const verify = params.value('tasks.verify'), pay = params.value('tasks.pay_per_hour');
  const sec = h('section', {}, h('h2', {}, 'Tasks'),
    h('p', { class: 'hint' }, `Chores, shifts and jobs. Claim one, do it, say it is done${verify ? ', and someone else verifies it' : ''}; the hours count${pay ? `, and each hour pays ${pay}` : ''}.`),
    me ? h('p', {}, 'Your verified hours: ', h('strong', {}, String(hoursOf(state, me.id)))) : null);
  sec.append(api.list({
    key: 'tasks',
    edit: (t) => (api.me && t.by === api.me.id && !t.claimer && !t.cancelled && !t.verified ? api.editForm('Edit your task', [['title', 'What', t.title], ['hours', 'Hours', t.hours, 'number'], ['note', 'Note', t.note, 'textarea']], (ch) => api.sign('task.edit', { task: t.id, ...ch }, `Editing your task ${t.title}`)) : null), items: all, noun: 'tasks', empty: 'No tasks yet.',
    mine: me ? (t) => t.claimer === me.id || t.by === me.id : null,
    text: (t) => `${t.id} ${t.title} ${t.note} ${t.claimer || ''} ${t.by}`,
    sorts: [['Due soonest', (a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1], ['Newest first', api.sorts.newest((t) => t.posted)], ['Most hours', (a, b) => b.hours - a.hours]],
    filters: [{ label: 'Status', options: [['Open or claimed', (t) => !t.verified && !t.cancelled], ['Open', (t) => status(t) === 'open'], ['Waiting to be verified', (t) => status(t) === 'done, to verify'], ['Verified', (t) => !!t.verified], ['Everything', () => true]] }],
    render: (t) => {
      const act = (kind, label) => h('button', { class: 'quiet', onclick: () => api.sign(kind, { task: t.id }, `${label}: ${t.title}`) }, label);
      const mine = me && t.claimer === me.id;
      return h('li', {}, h('h3', {}, t.title, h('span', { class: 'category' }, status(t))),
        h('p', { class: 'meta' }, `${t.hours} h${t.due ? ` · due ${day(t.due)}` : ''} · posted by `, who(t.by), t.claimer ? [' · ', who(t.claimer)] : null, t.verifier ? [' · verified by ', who(t.verifier)] : null),
        t.note ? h('p', {}, t.note) : null, t.doneNote ? h('p', { class: 'fine' }, `Done: ${t.doneNote}`) : null,
        me?.status === 'active' && !t.cancelled && !t.verified ? h('div', { class: 'buttons' },
          !t.claimer ? act('task.claim', 'Claim') : null,
          mine && !t.done ? act('task.done', 'Done') : null,
          mine && !t.done ? act('task.release', 'Give back') : null,
          t.done && verify && !mine ? act('task.verify', 'Verify') : null,
          t.by === me.id && !t.done ? act('task.cancel', 'Withdraw') : null) : null);
    },
  }));
  const hours = Object.entries(state.m.tasks?.hours || {});
  if (hours.length) sec.append(h('h3', {}, 'Hours'), api.list({ key: 'task-hours', items: hours, noun: 'members', head: ['Member', 'Verified hours'],
    row: ([id, n]) => h('tr', {}, h('td', {}, who(id)), h('td', {}, String(n))), pin: me ? ([id]) => id === me.id : null,
    sorts: [['Most first', (a, b) => b[1] - a[1]], ['Fewest first', (a, b) => a[1] - b[1]]] }));
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Post a task'), h('div', { class: 'inline-form' },
    h('label', { for: 'tk-title' }, 'What'), h('input', { id: 'tk-title', placeholder: 'Clean the kitchen' }),
    h('label', { for: 'tk-id' }, 'Id'), h('input', { id: 'tk-id', placeholder: 'kitchen-mon' }),
    h('label', { for: 'tk-hours' }, 'Hours'), h('input', { id: 'tk-hours', type: 'number', min: 0.25, step: 0.25, value: 1 }),
    h('label', { for: 'tk-due' }, 'Due (optional)'), h('input', { id: 'tk-due', type: 'date' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const f = { task: $('#tk-id').value.trim(), title: $('#tk-title').value.trim(), hours: Number($('#tk-hours').value) };
      if ($('#tk-due').value) f.due = new Date($('#tk-due').value).toISOString();
      api.sign('task.post', f, `Your task: ${f.title}`);
    } }, 'Sign')))));
  return sec;
}
