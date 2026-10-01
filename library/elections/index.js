// elections · filling an office by vote rather than by appointment.
//
// A decision (or a grant) calls an election for an office:
//   election.call { election, office, seats?, method: approval | ranked,
//                   stand_days, vote_days, voters? }
// Then, in order:
//   candidacy   members stand (election.stand), and may withdraw, for stand_days
//   voting      those on the roll vote (election.vote) for vote_days; a later
//               ballot replaces an earlier one
//   count       anyone sends election.count once voting has closed; the result
//               is counted from the record, the office's current holders are
//               vacated and the winners appointed, in one step
//
// voters is an electorate (see decision.electorate), "members" unless it says
// otherwise; its roll and weights are fixed when the election is called.
//
// approval: each voter approves any number of candidates; the most approved win.
// ranked:   each voter ranks candidates; seats are filled one at a time by
//           instant runoff, each winner removed before the next round.
// Ties are broken by hash(election id : candidate id), lowest first: fixed and
// public from the moment the election is called, so nobody can steer it after.
// A candidate needs at least one vote to win.

import { hash } from '../../kernel/hash.js';
import { Parameters } from '../../kernel/parameters.js';
import { resolveElectorate, simulateEffects, effectRecords } from '../../kernel/effects.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
const el = (state, id) => state.m.elections?.[id] || null;

export function phase(e, at) {
  if (e.counted) return 'counted';
  if (at <= e.standUntil) return 'candidacy';
  if (at <= e.voteUntil) return 'voting';
  return 'closed';
}
export const tiebreak = (e, c) => hash(`${e.id}:${c}`);
const byTie = (e) => (a, b) => (tiebreak(e, a) < tiebreak(e, b) ? -1 : 1);
const weight = (e, v) => (e.weights ? e.weights[v] || 0 : 1);

// → { winners, detail }. Pure.
export function count(e) {
  const cands = Object.keys(e.candidates);
  const ballots = Object.entries(e.ballots).map(([v, list]) => ({ w: weight(e, v), list: list.filter(c => cands.includes(c)) })).filter(b => b.list.length);
  if (e.method === 'approval') {
    const score = Object.fromEntries(cands.map(c => [c, 0]));
    for (const b of ballots) for (const c of b.list) score[c] += b.w;
    const order = cands.filter(c => score[c] > 0).sort((a, b) => score[b] - score[a] || byTie(e)(a, b));
    return { winners: order.slice(0, e.seats), detail: { scores: score } };
  }
  const winners = [], rounds = [];
  let left = cands.slice();
  while (winners.length < e.seats && left.length) {
    let pool = left.slice();
    for (;;) {
      const tally = Object.fromEntries(pool.map(c => [c, 0]));
      for (const b of ballots) { const top = b.list.find(c => pool.includes(c)); if (top) tally[top] += b.w; }
      const live = Object.values(tally).reduce((a, b) => a + b, 0);
      rounds.push({ seat: winners.length + 1, tally });
      if (!live) { pool = []; break; }
      const best = pool.slice().sort((a, b) => tally[b] - tally[a] || byTie(e)(a, b))[0];
      if (tally[best] * 2 > live || pool.length === 1) { winners.push(best); break; }
      const worst = pool.slice().sort((a, b) => tally[a] - tally[b] || byTie(e)(b, a))[0];
      pool = pool.filter(c => c !== worst);
    }
    if (!pool.length) break;
    left = left.filter(c => !winners.includes(c));
  }
  return { winners, detail: { rounds } };
}

function holders(state, office, at) {
  const o = state.m.offices?.[office];
  return o ? o.holders.filter(h => !h.until || h.until > at).map(h => h.id) : [];
}

function install(r) {
  r.registerEffect({
    name: 'election.call', module: 'elections',
    rule: (p) => p.value('elections.call_rule'),
    describe: (e) => `Call an election for ${e.office} (${e.seats ?? 'every'} seat${e.seats === 1 ? '' : 's'}, ${e.method ?? 'approval'} voting; candidacy ${e.stand_days} days, voting ${e.vote_days} days)`,
    check(state, e, params, at, ctx = {}) {
      if (!ID.test(e.election || '')) return 'an election id is 1–40 lowercase letters, digits and -';
      if (el(state, e.election)) return `the election ${e.election} already exists`;
      const o = state.m.offices?.[e.office];
      if (!o || o.abolished) return `there is no office ${e.office}`;
      if (e.seats !== undefined && (!Number.isInteger(e.seats) || e.seats < 1 || e.seats > o.seats)) return `seats is a whole number from 1 to ${o.seats}`;
      if (!['approval', 'ranked'].includes(e.method ?? 'approval')) return 'method is approval or ranked';
      for (const f of ['stand_days', 'vote_days']) if (!Number.isInteger(e[f]) || e[f] < 1 || e[f] > 90) return `${f} is a whole number of days from 1 to 90`;
      const who = resolveElectorate(ctx.registry, state, params, at, e.voters ?? 'members');
      if (who.frozen || who.why || !who.total) return `voters: ${who.why || 'nobody would be on the roll'}`;
      return null;
    },
  });
  r.registerRecord('election.call', (state, rec, registry) => {
    const e = rec.payload;
    const who = resolveElectorate(registry, state, paramsFor(state), rec.at, e.voters ?? 'members');
    const roll = state.order.filter(id => id in who.roll);
    const weighted = roll.some(id => who.roll[id] !== 1);
    state.m.elections = state.m.elections || {};
    const standUntil = addDays(rec.at, e.stand_days);
    state.m.elections[e.election] = {
      id: e.election, office: e.office, seats: e.seats ?? state.m.offices[e.office].seats, method: e.method ?? 'approval',
      voters: e.voters ?? 'members', called: rec.at, standUntil, voteUntil: addDays(standUntil, e.vote_days),
      roll, ...(weighted ? { weights: who.roll } : {}), candidates: {}, ballots: {}, counted: null,
    };
  });

  r.registerKind({
    name: 'election.stand', module: 'elections',
    check(state, act) {
      const e = el(state, act.election);
      if (!e) return `there is no election ${act.election}`;
      if (phase(e, act.at) !== 'candidacy') return `candidacy for ${e.id} closed at ${e.standUntil}`;
      if (state.participants[act.by].status !== 'active') return 'only active members may stand';
      if (e.candidates[act.by]) return 'you are already standing';
      return act.statement !== undefined && (typeof act.statement !== 'string' || act.statement.length > 2000) ? 'a statement is at most 2000 characters' : null;
    },
    reduce(state, rec) { const a = rec.payload.act; el(state, a.election).candidates[a.by] = { at: rec.at, statement: a.statement || '' }; },
  });
  r.registerKind({
    name: 'election.withdraw', module: 'elections',
    check(state, act) {
      const e = el(state, act.election);
      if (!e?.candidates[act.by]) return 'you are not standing in that election';
      return phase(e, act.at) === 'candidacy' ? null : 'candidates may withdraw only before voting opens';
    },
    reduce(state, rec) { const a = rec.payload.act; delete el(state, a.election).candidates[a.by]; },
  });
  r.registerKind({
    name: 'election.vote', module: 'elections',
    check(state, act) {
      const e = el(state, act.election);
      if (!e) return `there is no election ${act.election}`;
      if (phase(e, act.at) !== 'voting') return phase(e, act.at) === 'candidacy' ? `voting opens after ${e.standUntil}` : 'voting has closed';
      if (!e.roll.includes(act.by)) return 'you are not on the roll for this election';
      const c = act.choices;
      if (!Array.isArray(c) || c.some(x => !e.candidates[x]) || new Set(c).size !== c.length) return `choose among the candidates: ${Object.keys(e.candidates).join(', ') || 'none stood'}`;
      return null;
    },
    reduce(state, rec) { const a = rec.payload.act; el(state, a.election).ballots[a.by] = a.choices; },
  });
  r.registerKind({
    name: 'election.count', module: 'elections',
    check(state, act) {
      const e = el(state, act.election);
      if (!e) return `there is no election ${act.election}`;
      if (e.counted) return 'already counted';
      return phase(e, act.at) === 'closed' ? null : `voting is open until ${e.voteUntil}`;
    },
    apply(state, act, { params, registry }) {
      const e = el(state, act.election);
      const { winners, detail } = count(e);
      const effects = [
        ...holders(state, e.office, act.at).map(h => ({ kind: 'office.vacate', office: e.office, holder: h })),
        ...winners.map(w => ({ kind: 'office.fill', office: e.office, holder: w })),
      ];
      const sim = winners.length ? simulateEffects(state, effects, params, registry, act.at) : { why: 'nobody was elected' };
      const enacted = !sim.why;
      return [{ kind: 'election.counted', payload: { election: e.id, winners, detail, enacted, ...(enacted ? {} : { notEnacted: sim.why }) } },
        ...(enacted ? effectRecords(effects, { by_election: e.id }) : [])];
    },
    records: {
      'election.counted'(state, rec) {
        const p = rec.payload;
        state.m.elections[p.election].counted = { at: rec.at, winners: p.winners, detail: p.detail, enacted: p.enacted, notEnacted: p.notEnacted || null };
      },
    },
  });
}

// The entity's parameters, from the state alone (used when the call is recorded).
function paramsFor(state) { return new Parameters(state.doc, state.catalog); }

export default { name: 'elections', core: '0.4', install, count, phase, tiebreak, parameterKeys: ['elections.call_rule'] };
