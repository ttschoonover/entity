// The Participation tab: every partner's standing, read from the record, and
// (for whoever holds a grant of participation.notice) a button to give notice.
import { standing } from './index.js';

const pct = (a, b) => (b ? `${a} of ${b}` : 'none yet');

function grantsFor(api) {
  const A = api.state.m.authority;
  if (!A || !api.me) return [];
  return Object.values(A.grants || {}).filter(g => !g.revoked && (g.may || []).includes('participation.notice'));
}

export default function render(api) {
  const { h, state, me, when, who } = api;
  const at = new Date().toISOString(), P = api.params;
  const active = Object.values(state.participants).filter(p => p.status === 'active');
  const mine = me ? standing(state, me.id, at, P) : null;
  const sec = h('section', {}, h('h2', {}, 'Participation'),
    h('p', { class: 'hint' }, `Every partner decides every investment. Good standing: voting on at least ${Math.round(P.value('participation.min_votes') * 100)}% of the last ${P.value('participation.window_votes')} proposals, and attending at least ${Math.round(P.value('participation.min_meetings') * 100)}% of the last ${P.value('participation.window_meetings')} meetings. The first ${P.value('participation.grace_days')} days after joining do not count.`));
  if (mine) sec.append(h('p', {}, h('strong', {}, mine.ok ? 'You are in good standing. ' : 'You are below the minimum. '),
    `Votes: ${pct(mine.votes.cast, mine.votes.of)}; meetings: ${pct(mine.meetings.came, mine.meetings.of)}.`,
    mine.notice && !mine.ok ? h('span', { class: 'flag' }, ` You were given notice on ${when(mine.notice.at)}; return to good standing by ${when(mine.cureEnds)}.`) : null));
  const grants = grantsFor(api);
  sec.append(h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Partner', 'Votes', 'Meetings', 'Standing', ''].map(x => h('th', {}, x)))),
    h('tbody', {}, active.map(p => {
      const s = standing(state, p.id, at, P);
      const status = s.ok ? 'good' : s.cureOver ? 'notice period over' : s.notice ? `notice given ${when(s.notice.at)}` : 'below the minimum';
      const g = grants[0];
      return h('tr', {}, h('td', {}, who(p.id)), h('td', {}, pct(s.votes.cast, s.votes.of)), h('td', {}, pct(s.meetings.came, s.meetings.of)), h('td', {}, status),
        h('td', {}, !s.ok && !s.notice && g ? h('button', { class: 'quiet', onclick: () => api.sign('authority.exercise', { grant: g.id, effects: [{ kind: 'participation.notice', member: p.id, reason: `Votes ${pct(s.votes.cast, s.votes.of)}, meetings ${pct(s.meetings.came, s.meetings.of)}` }] }, `A participation notice to ${p.id}`) }, 'Give notice') : null));
    })))));
  return sec;
}

// Home: your own standing, when it needs attention.
export function cards(api) {
  if (!api.kit || !api.me || api.me.status !== 'active') return null;
  const s = standing(api.state, api.me.id, new Date().toISOString(), api.params);
  if (s.ok) return null;
  return api.kit.card({ title: 'Your participation', href: '#/participation', tone: 'urgent',
    body: api.h('p', { class: 'fine' }, `Votes ${pct(s.votes.cast, s.votes.of)}, meetings ${pct(s.meetings.came, s.meetings.of)}: below what the agreement requires.`) });
}
