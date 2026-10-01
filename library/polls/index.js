// polls · ask the members something. A poll records opinion and decides
// nothing: no effect follows from it. Any active member may open one.
//
//   poll.open    { question, options: [..], mode: single | approval, days? }
//   poll.answer  { poll, choices: [..] }   a later answer replaces an earlier one
//   poll.close   { poll }                  its opener may close it early
//
// Who may answer is fixed when it opens: the active members then, one answer
// each. Results are counted from the record, like ballots.

import { actId } from '../../kernel/signed.js';
import { Parameters } from '../../kernel/parameters.js';

const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
export const pollId = (act) => 'q-' + actId(act).slice(0, 12);
const poll = (state, id) => state.m.polls?.[id] || null;
export const isOpen = (p, at) => !p.closed && at <= p.closes;

export function results(p) {
  const counts = Object.fromEntries(p.options.map(o => [o, 0]));
  for (const choices of Object.values(p.answers)) for (const c of choices) counts[c]++;
  return { counts, answered: Object.keys(p.answers).length, eligible: p.roll.length };
}

function install(r) {
  r.registerKind({
    name: 'poll.open', module: 'polls',
    check(state, act, { params }) {
      if (state.participants[act.by].status !== 'active') return 'only active members may open a poll';
      if (typeof act.question !== 'string' || !act.question.trim() || act.question.length > 300) return 'a poll needs a question of 1–300 characters';
      const o = act.options;
      if (!Array.isArray(o) || o.length < 2 || o.length > 20 || o.some(x => typeof x !== 'string' || !x.trim() || x.length > 120)) return 'a poll needs 2–20 options of 1–120 characters';
      if (new Set(o).size !== o.length) return 'options must differ';
      if (!['single', 'approval'].includes(act.mode ?? 'single')) return 'mode is single (one choice) or approval (any number)';
      const max = params.value('polls.max_days');
      if (act.days !== undefined && (!Number.isInteger(act.days) || act.days < 1 || act.days > max)) return `days is a whole number from 1 to ${max}`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = pollId(a);
      const days = a.days ?? new Parameters(state.doc, state.catalog).value('polls.default_days');
      state.m.polls = state.m.polls || {};
      state.m.polls[id] = { id, by: a.by, at: rec.at, question: a.question, options: a.options, mode: a.mode ?? 'single',
        closes: addDays(rec.at, days), closed: null, answers: {},
        roll: state.order.filter(pid => state.participants[pid].status === 'active') };
    },
  });
  r.registerKind({
    name: 'poll.answer', module: 'polls',
    check(state, act) {
      const p = poll(state, act.poll);
      if (!p) return `there is no poll ${act.poll}`;
      if (!isOpen(p, act.at)) return 'this poll has closed';
      if (!p.roll.includes(act.by)) return 'you were not a member when this poll opened';
      const c = act.choices;
      if (!Array.isArray(c) || c.some(x => !p.options.includes(x)) || new Set(c).size !== c.length) return `choose from: ${p.options.join(', ')}`;
      if (p.mode === 'single' && c.length > 1) return 'this poll takes one choice';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = poll(state, a.poll);
      if (a.choices.length) p.answers[a.by] = a.choices; else delete p.answers[a.by];
    },
  });
  r.registerKind({
    name: 'poll.close', module: 'polls',
    check(state, act) {
      const p = poll(state, act.poll);
      if (!p) return `there is no poll ${act.poll}`;
      if (!isOpen(p, act.at)) return 'this poll has already closed';
      return p.by === act.by ? null : 'only the member who opened a poll may close it early';
    },
    reduce(state, rec) { poll(state, rec.payload.act.poll).closed = rec.at; },
  });
}

export default { name: 'polls', core: '0.4', install, pollId, results, isOpen, parameterKeys: ['polls.default_days', 'polls.max_days'] };
