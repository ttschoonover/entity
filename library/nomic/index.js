// nomic · the game where changing the rules is a move. After Peter Suber's
// Nomic (1982): a small set of rules, some hard to change ("immutable"), most
// easy ("mutable"); players take turns proposing changes, everyone votes, and
// points go to those whose changes pass. Anything can change, including how
// points are won.
//
// The rules are text, kept here and numbered. The numbers the record enforces
// (points per adopted change, points to win, days per turn) are parameters, so
// a proposal that rewrites rule 204 should change nomic.points_adopted with it.
//
// Effects, made only by decision (a proposal, voted on):
//   nomic.enact      { number, title, text, mutable }   a new rule
//   nomic.amend      { number, title?, text }           a mutable rule's new text
//   nomic.repeal     { number }                         a mutable rule removed
//   nomic.transmute  { number }                         mutable ⇄ immutable (nomic.transmute_rule)
//   nomic.award      { member, points, reason }         points by vote (a penalty if negative)
//   nomic.judge      { member }                         names the judge
//   nomic.new_game   {}                                 scores to zero; the rules stay
//
// Acts:
//   nomic.pass      {}                      ends your turn (or anyone's, once it has run out)
//   nomic.cfj       { question }            a call for judgment: what does a rule mean?
//   nomic.judgment  { cfj, verdict, reason } the judge answers: true, false or undecided
//
// Turns: when nomic.turns is on, a proposal that changes the game (any nomic
// effect, or any nomic.* setting) may be laid only by the player whose turn it
// is, one per turn. A proposal that passes gives its proposer
// nomic.points_adopted, and each member who voted against it
// nomic.points_dissent. The first to nomic.win_points wins the game.

import { actId } from '../../kernel/signed.js';
import { Parameters } from '../../kernel/parameters.js';

const DAY = 86400000;
const P = (state) => new Parameters(state.doc, state.catalog);
const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const N = (n) => Number.isInteger(n) && n >= 1 && n <= 9999;
export const cfjId = (act) => 'cfj-' + actId(act).slice(0, 10);

const game = (state) => (state.m.nomic ||= { rules: {}, scores: {}, turn: null, winner: null, game: 1, judge: null, cfjs: {}, scored: {}, log: [] });
const rule = (state, n) => { const r = state.m.nomic?.rules?.[n]; return r && !r.repealed ? r : null; };
export const rules = (state) => Object.values(state.m.nomic?.rules || {}).filter(r => !r.repealed).sort((a, b) => a.number - b.number);
export const score = (state, id) => state.m.nomic?.scores?.[id] || 0;

// Players: active members, in the order they joined.
export const players = (state) => state.order.filter(id => state.participants[id]?.status === 'active');
export function turnOf(state) {
  const ps = players(state), t = state.m.nomic?.turn;
  if (!ps.length) return null;
  if (t && ps.includes(t.player)) return t;
  return { player: ps[0], since: t?.since || null };
}
export function turnEnds(state, params = P(state)) {
  const t = turnOf(state);
  return t?.since ? new Date(Date.parse(t.since) + params.value('nomic.turn_days') * DAY).toISOString() : null;
}
function nextPlayer(state, after) {
  const ps = players(state), i = ps.indexOf(after);
  return ps[(i + 1) % ps.length];
}

// Does this proposal change the game?
const touchesGame = (act) => (act.effects || []).some(e => String(e.kind).startsWith('nomic.'))
  || Object.keys(act.changes || {}).some(k => k.startsWith('nomic.'));

// Points for a passed proposal, once per proposal however many nomic effects it carries.
function scoreProposal(state, proposalId, at) {
  const g = game(state), p = state.proposals?.[proposalId];
  if (!p || g.scored[proposalId]) return;
  g.scored[proposalId] = true;
  const params = P(state);
  const last = {};
  for (const b of p.ballots || []) if (!b.afterClose) last[b.by] = b.choice;
  add(state, p.by, params.value('nomic.points_adopted'), `proposal ${proposalId} passed`, at);
  const dissent = params.value('nomic.points_dissent');
  if (dissent) for (const [id, c] of Object.entries(last)) if (c === 'against') add(state, id, dissent, `voted against ${proposalId}, which passed`, at);
}
function add(state, id, points, why, at) {
  const g = game(state);
  if (!points || g.winner) return;
  g.scores[id] = (g.scores[id] || 0) + points;
  g.log.push({ at, who: id, points, why });
  if (g.log.length > 500) g.log.shift();
  const goal = P(state).value('nomic.win_points');
  if (g.scores[id] >= goal) g.winner = { id, at, game: g.game, score: g.scores[id] };
}
const history = (r, at, payload, what) => r.history.push({ at, what, proposal: payload.proposal || null });

function install(reg) {
  const ruleOf = (key) => (params) => params.value(key);

  reg.registerEffect({
    name: 'nomic.enact', module: 'nomic',
    rule: (p, e) => p.value(e.mutable === false ? 'nomic.transmute_rule' : 'nomic.amend_rule'),
    describe: (e) => `Enact rule ${e.number}${e.mutable === false ? ' (immutable)' : ''}: ${e.title}`,
    check(state, e) {
      if (!N(e.number)) return 'a rule number is a whole number from 1 to 9999';
      if (rule(state, e.number)) return `there is already a rule ${e.number}: amend it, or choose another number`;
      if (!text(e.title, 120)) return 'a rule needs a title of 1–120 characters';
      if (!text(e.text, 4000)) return 'a rule needs text of 1–4000 characters';
      if (e.mutable !== undefined && typeof e.mutable !== 'boolean') return 'mutable is true or false';
      return null;
    },
  });
  reg.registerRecord('nomic.enact', (state, rec) => {
    const e = rec.payload, g = game(state);
    const r = { number: e.number, title: e.title, text: e.text, mutable: e.mutable !== false, enacted: rec.at, history: [] };
    history(r, rec.at, e, 'enacted');
    g.rules[e.number] = r;
    scoreProposal(state, e.proposal, rec.at);
  });

  reg.registerEffect({
    name: 'nomic.amend', module: 'nomic', rule: ruleOf('nomic.amend_rule'),
    describe: (e) => `Amend rule ${e.number}${e.title ? `: ${e.title}` : ''}`,
    check(state, e) {
      const r = rule(state, e.number);
      if (!r) return `there is no rule ${e.number}`;
      if (!r.mutable) return `rule ${e.number} is immutable: transmute it first`;
      if (!text(e.text, 4000)) return 'the new text is 1–4000 characters';
      if (e.title !== undefined && !text(e.title, 120)) return 'a title is 1–120 characters';
      return null;
    },
  });
  reg.registerRecord('nomic.amend', (state, rec) => {
    const e = rec.payload, r = rule(state, e.number);
    r.history.push({ at: rec.at, what: 'amended', before: r.text, proposal: e.proposal || null });
    r.text = e.text; if (e.title) r.title = e.title;
    scoreProposal(state, e.proposal, rec.at);
  });

  reg.registerEffect({
    name: 'nomic.repeal', module: 'nomic', rule: ruleOf('nomic.amend_rule'),
    describe: (e) => `Repeal rule ${e.number}`,
    check(state, e) {
      const r = rule(state, e.number);
      if (!r) return `there is no rule ${e.number}`;
      return r.mutable ? null : `rule ${e.number} is immutable: transmute it first`;
    },
  });
  reg.registerRecord('nomic.repeal', (state, rec) => {
    const r = rule(state, rec.payload.number);
    r.repealed = rec.at; history(r, rec.at, rec.payload, 'repealed');
    scoreProposal(state, rec.payload.proposal, rec.at);
  });

  reg.registerEffect({
    name: 'nomic.transmute', module: 'nomic', rule: ruleOf('nomic.transmute_rule'),
    describe: (e) => `Transmute rule ${e.number}`,
    check: (state, e) => (rule(state, e.number) ? null : `there is no rule ${e.number}`),
  });
  reg.registerRecord('nomic.transmute', (state, rec) => {
    const r = rule(state, rec.payload.number);
    r.mutable = !r.mutable; history(r, rec.at, rec.payload, r.mutable ? 'made mutable' : 'made immutable');
    scoreProposal(state, rec.payload.proposal, rec.at);
  });

  reg.registerEffect({
    name: 'nomic.award', module: 'nomic', rule: ruleOf('nomic.amend_rule'),
    describe: (e) => `${e.points >= 0 ? 'Award' : 'Take'} ${Math.abs(e.points)} points ${e.points >= 0 ? 'to' : 'from'} ${e.member}: ${e.reason}`,
    check(state, e) {
      if (!state.participants[e.member]) return `${e.member} is not a player`;
      if (!Number.isInteger(e.points) || e.points === 0 || Math.abs(e.points) > 10000) return 'points is a whole number, not zero, at most 10000 either way';
      return text(e.reason, 300) ? null : 'give a reason (up to 300 characters)';
    },
  });
  reg.registerRecord('nomic.award', (state, rec) => {
    add(state, rec.payload.member, rec.payload.points, rec.payload.reason, rec.at);
    scoreProposal(state, rec.payload.proposal, rec.at);
  });

  reg.registerEffect({
    name: 'nomic.judge', module: 'nomic', rule: ruleOf('nomic.amend_rule'),
    describe: (e) => `Name ${e.member} the judge`,
    check: (state, e) => (state.participants[e.member]?.status === 'active' ? null : `${e.member} is not an active player`),
  });
  reg.registerRecord('nomic.judge', (state, rec) => { game(state).judge = rec.payload.member; scoreProposal(state, rec.payload.proposal, rec.at); });

  reg.registerEffect({
    name: 'nomic.new_game', module: 'nomic', rule: ruleOf('nomic.amend_rule'),
    describe: () => 'Start a new game: every score back to zero, the rules as they stand',
    check: () => null,
  });
  reg.registerRecord('nomic.new_game', (state, rec) => {
    const g = game(state);
    // A game ends when it is won; before that, a new game only resets the scores.
    if (g.winner) { g.past = [...(g.past || []), { game: g.game, winner: g.winner, scores: g.scores, ended: rec.at }].slice(-50); g.game += 1; }
    g.scores = {}; g.winner = null; g.log = [];
    g.scored[rec.payload.proposal] = true; // starting a game scores nothing
  });

  // Only the player whose turn it is changes the game, one proposal a turn.
  reg.registerProposalCheck({ module: 'nomic', check(state, act, params) {
    if (!touchesGame(act) || !params.value('nomic.turns')) return null;
    const t = turnOf(state);
    if (!t) return null;
    if ((act.effects || []).every(e => e.kind === 'nomic.new_game') && game(state).winner) return null; // anyone may call a new game once it is won
    if (t.player !== act.by) return `it is ${t.player}'s turn: only they may propose a change to the game now`;
    const already = Object.values(state.proposals || {}).some(p => p.by === act.by && (!t.since || p.at >= t.since) && touchesGame(p));
    return already ? 'you have already proposed a change this turn: end your turn (nomic.pass) first' : null;
  } });

  reg.registerKind({
    name: 'nomic.pass', module: 'nomic',
    check(state, act, { params }) {
      const t = turnOf(state);
      if (!t) return 'there are no players';
      if (t.player === act.by) return null;
      if (state.participants[act.by]?.status !== 'active') return 'only players may end a turn';
      const ends = turnEnds(state, params);
      return ends && act.at >= ends ? null : `it is ${t.player}'s turn; anyone may end it once ${params.value('nomic.turn_days')} days have passed`;
    },
    reduce(state, rec) {
      const t = turnOf(state), g = game(state);
      g.turn = { player: nextPlayer(state, t.player), since: rec.at };
    },
  });

  reg.registerKind({
    name: 'nomic.cfj', module: 'nomic',
    check(state, act) {
      if (state.participants[act.by]?.status !== 'active') return 'only players may call for judgment';
      return text(act.question, 1000) ? null : 'a call for judgment is a question of 1–1000 characters';
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = cfjId(a);
      game(state).cfjs[id] = { id, by: a.by, at: rec.at, question: a.question, judgment: null };
    },
  });
  reg.registerKind({
    name: 'nomic.judgment', module: 'nomic',
    check(state, act) {
      const g = state.m.nomic, c = g?.cfjs?.[act.cfj];
      if (!c) return `there is no call for judgment ${act.cfj}`;
      if (c.judgment) return 'it has already been judged';
      if (g.judge !== act.by) return g.judge ? `only the judge, ${g.judge}, gives judgments` : 'there is no judge: name one by decision (nomic.judge)';
      if (c.by === act.by) return 'a judge does not judge their own call: a decision may name another judge';
      if (!['true', 'false', 'undecided'].includes(act.verdict)) return 'the verdict is true, false or undecided';
      return text(act.reason, 2000) ? null : 'give the reasoning (up to 2000 characters)';
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      state.m.nomic.cfjs[a.cfj].judgment = { by: a.by, at: rec.at, verdict: a.verdict, reason: a.reason };
    },
  });
}

export default { name: 'nomic', core: '0.7.7', install, rules, score, players, turnOf, turnEnds, cfjId,
  parameterKeys: ['nomic.turns', 'nomic.turn_days', 'nomic.points_adopted', 'nomic.points_dissent', 'nomic.win_points', 'nomic.amend_rule', 'nomic.transmute_rule'] };
