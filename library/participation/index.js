// participation · every partner takes part. An investment club whose members
// all decide its investments is not selling securities; one passive member may
// change that (see the SEC's guidance on investment clubs). This module makes
// each partner's part visible, and lets the partnership act on it.
//
// A partner's standing is read from the record, never declared:
//   votes     of the last participation.window_votes proposals they were on
//             the roll for (and that closed), how many they voted on
//   meetings  of the last participation.window_meetings meetings held (the
//             meetings module), how many they checked in to
// Proposals and meetings within participation.grace_days of joining do not count.
// A partner is in good standing at or above participation.min_votes and
// participation.min_meetings.
//
//   participation.notice  { member, reason? }   (an effect) a formal notice to a
//                         partner who is below the minimum, when it is recorded.
//                         Granted to the Secretary with the authority module, or
//                         decided by the partners. The notify module sends it
//                         to that partner only.
//
// What follows a notice is the partnership agreement's business: in the
// Orchard's, a partner still below the minimum participation.cure_days after a
// notice may be removed by joint resolution (participant.remove). The module
// shows when that period has passed; it removes no one by itself.

import { originOf } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const DAY = 86400000;
const params = (state) => new Parameters(state.doc, state.catalog);
const book = (state) => (state.m.participation ||= { notices: [] });
const joinedAt = (p) => p.admitted || p.joined;

export function standing(state, id, at, P = params(state)) {
  const p = state.participants[id];
  if (!p) return null;
  const from = new Date(Date.parse(joinedAt(p)) + P.value('participation.grace_days') * DAY).toISOString();
  const closed = Object.values(state.proposals || {})
    .filter(x => x.closed && x.closed.at <= at && (x.roll || []).includes(id) && x.at >= from)
    .sort((a, b) => (a.closed.at < b.closed.at ? 1 : -1)).slice(0, P.value('participation.window_votes'));
  const cast = closed.filter(x => (x.ballots || []).some(b => b.by === id && !b.afterClose && b.at <= x.deadline)).length;
  const held = Object.values(state.m.meetings || {})
    .filter(m => !m.cancelled && m.starts <= at && m.starts >= from)
    .sort((a, b) => (a.starts < b.starts ? 1 : -1)).slice(0, P.value('participation.window_meetings'));
  const came = held.filter(m => m.attendance?.[id]).length;
  const minV = P.value('participation.min_votes'), minM = P.value('participation.min_meetings');
  const votesOk = closed.length === 0 || cast / closed.length >= minV - 1e-9;
  const meetingsOk = held.length === 0 || came / held.length >= minM - 1e-9;
  const last = (state.m.participation?.notices || []).filter(n => n.member === id).at(-1) || null;
  const cureEnds = last ? new Date(Date.parse(last.at) + P.value('participation.cure_days') * DAY).toISOString() : null;
  return { id, votes: { cast, of: closed.length }, meetings: { came, of: held.length }, ok: votesOk && meetingsOk, votesOk, meetingsOk,
    notice: last, cureEnds, cureOver: !!(last && cureEnds <= at && !(votesOk && meetingsOk) && last.at > (p.restored || '')) };
}

function install(r) {
  r.registerEffect({
    module: 'participation', name: 'participation.notice',
    rule: () => 'ordinary',
    describe: (e) => `A participation notice to ${e.member}${e.reason ? ` (${e.reason})` : ''}`,
    check(state, e, P, at) {
      const p = state.participants[e.member];
      if (!p || p.status !== 'active') return `${e.member} is not an active partner`;
      if (e.reason !== undefined && (typeof e.reason !== 'string' || e.reason.length > 500)) return 'a reason is at most 500 characters';
      const s = standing(state, e.member, at, P);
      if (s.ok) return `${e.member} meets the participation minimum (${s.votes.cast} of ${s.votes.of} votes, ${s.meetings.came} of ${s.meetings.of} meetings)`;
      if (s.notice && s.cureEnds > at) return `${e.member} already has a notice, until ${s.cureEnds.slice(0, 10)}`;
      return null;
    },
  });
  r.registerRecord('participation.notice', (state, rec) => {
    const e = rec.payload, s = standing(state, e.member, rec.at);
    book(state).notices.push({ member: e.member, at: rec.at, by: originOf(e), reason: e.reason || '', votes: s.votes, meetings: s.meetings });
  });
}

export default { name: 'participation', core: '0.9.10', install, standing,
  parameterKeys: ['participation.window_votes', 'participation.min_votes', 'participation.window_meetings', 'participation.min_meetings', 'participation.grace_days', 'participation.cure_days'] };
