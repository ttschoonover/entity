// wagers · bets among members, in the entity's own points (the value module).
// No real money: points are issued by decision and are worth what the members
// agree they are worth, which is usually bragging rights.
//
// Four kinds:
//   pool     a question with outcomes; stakes go into one pot and the winners
//            share it in proportion to what they staked (parimutuel)
//   line     over/under: a number to beat; stakes on over or under; a result
//            exactly on the line refunds everyone
//   duel     one member challenges another (or anyone) at stated stakes:
//            "my 50 against your 30"; the loser may simply concede
//   market   a prediction market: shares in each outcome, priced by a market
//            maker (LMSR) whose price is the crowd's probability. A winning
//            share pays wagers.share_value points; the creator funds the
//            maker's worst-case loss up front and keeps what is left over.
//
// Results come from the arbiter: the holder of the office wagers.arbiter_office,
// elected like any office. An arbiter never resolves a bet they hold a stake
// in, and may not bet while in office. A result can be appealed for
// wagers.appeal_days by anyone with a stake; then only a decision of the
// members (wager.decide) settles it. A decision can also settle or void any
// bet at any time, which is how bets are settled when there is no arbiter.
//
// Acts:
//   wager.open     { type: pool|line|market, question, outcomes?, line?, liquidity?, days }
//   wager.duel     { terms, stake, against, to?, days }
//   wager.accept   { wager }                  take up a duel
//   wager.cancel   { wager }                  the opener, before anyone else is in
//   wager.stake    { wager, outcome, amount }  pools and lines
//   wager.trade    { wager, outcome, shares }  markets; negative shares sell
//   wager.concede  { wager }                  a party to a duel gives it to the other
//   wager.resolve  { wager, outcome | value, note }   the arbiter, once it has closed
//   wager.appeal   { wager, reason }
//   wager.settle   { wager }                  anyone, once the appeal window passes: pays out
// Effects (by decision):
//   wager.decide   { wager, outcome | value, note }   resolves and pays at once
//   wager.void     { wager, reason }                  every stake back

import { actId } from '../../kernel/signed.js';
import { Parameters } from '../../kernel/parameters.js';

const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
const P = (state) => new Parameters(state.doc, state.catalog);
const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const whole = (n) => Number.isSafeInteger(n) && n > 0;
export const wagerId = (act) => 'b-' + actId(act).slice(0, 10);
const book = (state) => (state.m.wagers ||= { items: {} });
const wager = (state, id) => state.m.wagers?.items?.[id] || null;
const active = (state, id) => state.participants[id]?.status === 'active';

// ── points, in the value module's ledger (its documented shape) ─────────────
const ledger = (state) => (state.m.value ||= { balances: {}, supply: 0 });
export const balance = (state, id) => state.m.value?.balances?.[id] || 0;
function escrow(state, w, from, amount) {
  const l = ledger(state);
  l.balances[from] = balance(state, from) - amount;
  const id = `${w.id}:${(w.hseq = (w.hseq || 0) + 1)}`;
  (l.held ||= {})[id] = { from, amount, owner: 'wagers' };
  w.holds.push(id);
}
export const pot = (state, w) => w.holds.reduce((a, id) => a + (state.m.value?.held?.[id]?.amount || 0), 0);
function disburse(state, w, to, amount) {
  const l = ledger(state);
  let left = amount;
  for (const id of w.holds) {
    const h = l.held?.[id];
    if (!h || !left) continue;
    const n = Math.min(h.amount, left);
    h.amount -= n; left -= n;
    l.balances[to] = balance(state, to) + n;
    if (!h.amount) delete l.held[id];
  }
  w.holds = w.holds.filter(id => l.held?.[id]);
  return amount - left;
}

// ── the arbiter ─────────────────────────────────────────────────────────────
export function arbiters(state, params, at) {
  const o = state.m.offices?.[params.value('wagers.arbiter_office')];
  if (!o || o.abolished) return [];
  return (o.holders || []).filter(h => !h.until || h.until > at).map(h => h.id);
}
export function stakeholders(w) {
  const s = new Set([w.by]);
  for (const x of w.stakes || []) s.add(x.by);
  if (w.taker) s.add(w.taker);
  for (const id of Object.keys(w.positions || {})) s.add(id);
  return s;
}

// ── the market maker (logarithmic market scoring rule) ─────────────────────
const lse = (q, b) => { const xs = Object.values(q).map(v => v / b), m = Math.max(...xs); return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0)); };
const r6 = (x) => Math.round(x * 1e6) / 1e6;
export function prices(w) {
  const xs = w.outcomes.map(o => w.q[o] / w.b), m = Math.max(...xs), ex = xs.map(x => Math.exp(x - m)), s = ex.reduce((a, b) => a + b, 0);
  return Object.fromEntries(w.outcomes.map((o, i) => [o, ex[i] / s]));
}
// What buying (shares > 0) or selling (< 0) costs, in points: charged rounded up, paid rounded down.
export function tradeCost(w, outcome, shares, shareValue) {
  const after = { ...w.q, [outcome]: w.q[outcome] + shares };
  const d = r6(shareValue * w.b * (lse(after, w.b) - lse(w.q, w.b)));
  return d >= 0 ? Math.ceil(d) : -Math.floor(-d);
}
export const subsidy = (b, n, shareValue) => Math.ceil(r6(shareValue * b * Math.log(n)));

// ── outcomes ────────────────────────────────────────────────────────────────
function outcomeFor(w, f) {
  if (w.type === 'line') {
    if (typeof f.value !== 'number' || !Number.isFinite(f.value)) return { why: 'a line is resolved with the value it came to (value)' };
    return { outcome: f.value > w.line ? 'over' : f.value < w.line ? 'under' : 'push', value: f.value };
  }
  if (!w.outcomes.includes(f.outcome)) return { why: `the outcome is one of: ${w.outcomes.join(', ')}` };
  return { outcome: f.outcome };
}
function refundAll(state, w) {
  if (w.type === 'pool' || w.type === 'line') for (const s of w.stakes) disburse(state, w, s.by, s.amount);
  else if (w.type === 'duel') { disburse(state, w, w.by, w.stake); if (w.taker) disburse(state, w, w.taker, w.against); }
  else if (w.type === 'market') {
    for (const [id, spent] of Object.entries(w.spent)) if (spent > 0) disburse(state, w, id, spent);
    disburse(state, w, w.by, pot(state, w));
  }
}
// Pay a bet out on its outcome. Returns what each person received.
function payOut(state, w, outcome) {
  const paid = {}, give = (id, n) => { if (n > 0) paid[id] = (paid[id] || 0) + disburse(state, w, id, n); };
  if (outcome === 'void' || outcome === 'push') { refundAll(state, w); return paid; }
  if (w.type === 'pool' || w.type === 'line') {
    const total = pot(state, w), win = w.stakes.filter(s => s.outcome === outcome), winTotal = win.reduce((a, s) => a + s.amount, 0);
    if (!winTotal) { refundAll(state, w); return paid; }
    for (const s of win) give(s.by, Math.floor((s.amount * total) / winTotal));
    if (win.length) give(win[0].by, pot(state, w)); // what rounding left over
  } else if (w.type === 'duel') {
    give(outcome === 'maker' ? w.by : w.taker, pot(state, w));
  } else if (w.type === 'market') {
    const value = P(state).value('wagers.share_value');
    for (const [id, pos] of Object.entries(w.positions)) give(id, (pos[outcome] || 0) * value);
    give(w.by, pot(state, w));
  }
  return paid;
}
function finish(state, w, outcome, at, how) {
  w.paid = payOut(state, w, outcome);
  w.status = outcome === 'void' || outcome === 'push' ? 'void' : 'settled';
  w.settled = { at, outcome, how };
}

function install(r) {
  const open = (w, at) => w.status === 'open' && at < w.closes;
  const notArbiter = (state, params, id, at) => (arbiters(state, params, at).includes(id) ? 'the arbiter does not bet while in office' : null);

  r.registerKind({
    name: 'wager.open', module: 'wagers',
    check(state, a, { params }) {
      if (!active(state, a.by)) return 'only members open bets';
      const bad = notArbiter(state, params, a.by, a.at); if (bad) return bad;
      if (!['pool', 'line', 'market'].includes(a.type)) return 'type is pool, line or market (challenges are wager.duel)';
      if (!text(a.question, 300)) return 'a bet needs a question of 1–300 characters';
      if (!Number.isInteger(a.days) || a.days < 1 || a.days > params.value('wagers.max_days')) return `days (how long it takes bets) is 1 to ${params.value('wagers.max_days')}`;
      if (a.type === 'line') { if (typeof a.line !== 'number' || !Number.isFinite(a.line)) return 'a line needs the number to beat (line)'; return null; }
      const o = a.outcomes;
      if (!Array.isArray(o) || o.length < 2 || o.length > 12 || o.some(x => !text(x, 60)) || new Set(o).size !== o.length) return 'give 2–12 different outcomes of up to 60 characters';
      if (a.type === 'market') {
        if (!whole(a.liquidity) || a.liquidity > params.value('wagers.max_liquidity')) return `liquidity is a whole number from 1 to ${params.value('wagers.max_liquidity')}: higher means prices move less per share`;
        const need = subsidy(a.liquidity, o.length, params.value('wagers.share_value'));
        if (balance(state, a.by) < need) return `opening this market sets aside ${need} points to back it; you hold ${balance(state, a.by)}`;
      }
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = wagerId(a), params = P(state);
      const w = { id, type: a.type, by: a.by, at: rec.at, question: a.question, closes: addDays(rec.at, a.days), status: 'open', holds: [] };
      if (a.type === 'line') Object.assign(w, { line: a.line, outcomes: ['over', 'under'], stakes: [] });
      if (a.type === 'pool') Object.assign(w, { outcomes: a.outcomes, stakes: [] });
      if (a.type === 'market') {
        Object.assign(w, { outcomes: a.outcomes, b: a.liquidity, q: Object.fromEntries(a.outcomes.map(o => [o, 0])), positions: {}, spent: {}, trades: [] });
        escrow(state, w, a.by, subsidy(a.liquidity, a.outcomes.length, params.value('wagers.share_value')));
      }
      book(state).items[id] = w;
    },
  });

  r.registerKind({
    name: 'wager.duel', module: 'wagers',
    check(state, a, { params }) {
      if (!active(state, a.by)) return 'only members challenge';
      const bad = notArbiter(state, params, a.by, a.at); if (bad) return bad;
      if (!text(a.terms, 500)) return 'say what the bet is (terms, up to 500 characters): "I win if…"';
      if (!whole(a.stake) || !whole(a.against)) return 'stake (yours) and against (theirs) are whole numbers of points';
      if (a.stake > params.value('wagers.max_stake') || a.against > params.value('wagers.max_stake')) return `the most at stake on one side is ${params.value('wagers.max_stake')}`;
      if (a.to !== undefined && (a.to === a.by || !active(state, a.to))) return 'to is another active member, or leave it out to challenge anyone';
      if (!Number.isInteger(a.days) || a.days < 1 || a.days > params.value('wagers.max_days')) return `days (how long the challenge stands) is 1 to ${params.value('wagers.max_days')}`;
      return balance(state, a.by) < a.stake ? `you hold ${balance(state, a.by)}` : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = wagerId(a);
      const w = { id, type: 'duel', by: a.by, at: rec.at, question: a.terms, terms: a.terms, stake: a.stake, against: a.against, to: a.to || null, taker: null,
        closes: addDays(rec.at, a.days), status: 'offered', outcomes: ['maker', 'taker'], holds: [] };
      escrow(state, w, a.by, a.stake);
      book(state).items[id] = w;
    },
  });
  r.registerKind({
    name: 'wager.accept', module: 'wagers',
    check(state, a, { params }) {
      const w = wager(state, a.wager);
      if (!w || w.type !== 'duel' || w.status !== 'offered') return `there is no open challenge ${a.wager}`;
      if (a.at >= w.closes) return 'this challenge has lapsed';
      if (w.by === a.by) return 'you cannot take your own challenge';
      if (w.to && w.to !== a.by) return `this challenge is for ${w.to}`;
      const bad = notArbiter(state, params, a.by, a.at); if (bad) return bad;
      return balance(state, a.by) < w.against ? `taking it sets aside ${w.against}; you hold ${balance(state, a.by)}` : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, w = wager(state, a.wager);
      escrow(state, w, a.by, w.against); w.taker = a.by; w.status = 'open'; w.accepted = rec.at;
    },
  });
  r.registerKind({
    name: 'wager.cancel', module: 'wagers',
    check(state, a) {
      const w = wager(state, a.wager);
      if (!w) return `there is no bet ${a.wager}`;
      if (w.by !== a.by) return 'only the opener cancels a bet';
      if (w.type === 'duel') return w.status === 'offered' ? null : 'a challenge cannot be cancelled once taken';
      if (w.status !== 'open') return 'this bet is no longer open';
      const others = w.type === 'market' ? Object.keys(w.positions).length : w.stakes.length;
      return others ? 'others are already in: only a decision (wager.void) can call it off now' : null;
    },
    reduce(state, rec) { const w = wager(state, rec.payload.act.wager); refundAll(state, w); w.status = 'cancelled'; w.settled = { at: rec.at, outcome: 'void', how: 'cancelled' }; },
  });

  r.registerKind({
    name: 'wager.stake', module: 'wagers',
    check(state, a, { params }) {
      const w = wager(state, a.wager);
      if (!w || !['pool', 'line'].includes(w.type)) return `there is no pool or line ${a.wager}`;
      if (!open(w, a.at)) return 'this bet has closed';
      if (!active(state, a.by)) return 'only members bet';
      const bad = notArbiter(state, params, a.by, a.at); if (bad) return bad;
      if (!w.outcomes.includes(a.outcome)) return `bet on one of: ${w.outcomes.join(', ')}`;
      if (!whole(a.amount) || a.amount > params.value('wagers.max_stake')) return `stake a whole number of points, at most ${params.value('wagers.max_stake')}`;
      return balance(state, a.by) < a.amount ? `you hold ${balance(state, a.by)}` : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, w = wager(state, a.wager);
      escrow(state, w, a.by, a.amount); w.stakes.push({ by: a.by, outcome: a.outcome, amount: a.amount, at: rec.at });
    },
  });
  r.registerKind({
    name: 'wager.trade', module: 'wagers',
    check(state, a, { params }) {
      const w = wager(state, a.wager);
      if (!w || w.type !== 'market') return `there is no market ${a.wager}`;
      if (!open(w, a.at)) return 'this market has closed';
      if (!active(state, a.by)) return 'only members trade';
      const bad = notArbiter(state, params, a.by, a.at); if (bad) return bad;
      if (!w.outcomes.includes(a.outcome)) return `trade one of: ${w.outcomes.join(', ')}`;
      if (!Number.isSafeInteger(a.shares) || a.shares === 0 || Math.abs(a.shares) > 10000) return 'shares is a whole number, not zero (negative to sell), at most 10000';
      const held = w.positions[a.by]?.[a.outcome] || 0;
      if (a.shares < 0 && held < -a.shares) return `you hold ${held} shares of ${a.outcome}`;
      const cost = tradeCost(w, a.outcome, a.shares, params.value('wagers.share_value'));
      if (cost > 0 && balance(state, a.by) < cost) return `that costs ${cost}; you hold ${balance(state, a.by)}`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, w = wager(state, a.wager), cost = tradeCost(w, a.outcome, a.shares, P(state).value('wagers.share_value'));
      if (cost > 0) escrow(state, w, a.by, cost); else if (cost < 0) disburse(state, w, a.by, -cost);
      w.q[a.outcome] += a.shares;
      const pos = (w.positions[a.by] ||= {}); pos[a.outcome] = (pos[a.outcome] || 0) + a.shares;
      if (!pos[a.outcome]) delete pos[a.outcome];
      if (!Object.keys(pos).length) delete w.positions[a.by];
      w.spent[a.by] = (w.spent[a.by] || 0) + cost;
      w.trades.push({ by: a.by, at: rec.at, outcome: a.outcome, shares: a.shares, cost });
      if (w.trades.length > 1000) w.trades.shift();
    },
  });

  r.registerKind({
    name: 'wager.concede', module: 'wagers',
    check(state, a) {
      const w = wager(state, a.wager);
      if (!w || w.type !== 'duel' || !['open', 'resolved'].includes(w.status)) return `there is no running challenge ${a.wager}`;
      return [w.by, w.taker].includes(a.by) ? null : 'only the two sides of a challenge concede';
    },
    reduce(state, rec) {
      const a = rec.payload.act, w = wager(state, a.wager);
      finish(state, w, a.by === w.by ? 'taker' : 'maker', rec.at, `conceded by ${a.by}`);
    },
  });

  r.registerKind({
    name: 'wager.resolve', module: 'wagers',
    check(state, a, { params }) {
      const w = wager(state, a.wager);
      if (!w) return `there is no bet ${a.wager}`;
      if (w.status !== 'open') return 'only an open bet is resolved';
      if (!arbiters(state, params, a.at).includes(a.by)) return `only the arbiter (office ${params.value('wagers.arbiter_office')}) resolves bets`;
      if (stakeholders(w).has(a.by)) return 'you have a stake in this bet: another arbiter, or a decision, resolves it';
      if (w.type !== 'duel' && a.at < w.closes) return `this bet takes stakes until ${w.closes}; resolve it after`;
      if (a.note !== undefined && !text(a.note, 500)) return 'a note is up to 500 characters';
      return outcomeFor(w, a).why || null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, w = wager(state, a.wager), o = outcomeFor(w, a);
      w.status = 'resolved';
      w.result = { by: a.by, at: rec.at, outcome: o.outcome, value: o.value, note: a.note || '', appealUntil: addDays(rec.at, P(state).value('wagers.appeal_days')) };
    },
  });
  r.registerKind({
    name: 'wager.appeal', module: 'wagers',
    check(state, a) {
      const w = wager(state, a.wager);
      if (!w || w.status !== 'resolved') return 'only a resolved bet awaiting payout can be appealed';
      if (a.at >= w.result.appealUntil) return 'the time to appeal has passed';
      if (!stakeholders(w).has(a.by)) return 'only someone with a stake appeals';
      return text(a.reason, 1000) ? null : 'give your reason (up to 1000 characters)';
    },
    reduce(state, rec) { const a = rec.payload.act, w = wager(state, a.wager); w.status = 'appealed'; w.appeal = { by: a.by, at: rec.at, reason: a.reason }; },
  });
  r.registerKind({
    name: 'wager.settle', module: 'wagers',
    check(state, a) {
      const w = wager(state, a.wager);
      if (!w || w.status !== 'resolved') return w?.status === 'appealed' ? 'this result is under appeal: a decision settles it' : 'only a resolved bet is settled';
      return a.at < w.result.appealUntil ? `it can be appealed until ${w.result.appealUntil}; settle it after` : null;
    },
    reduce(state, rec) { const w = wager(state, rec.payload.act.wager); finish(state, w, w.result.outcome, rec.at, `the arbiter, ${w.result.by}`); },
  });

  r.registerEffect({
    name: 'wager.decide', module: 'wagers', rule: (p) => p.value('wagers.decide_rule'),
    describe: (e) => `Settle bet ${e.wager}: ${e.outcome ?? `value ${e.value}`}${e.note ? ` (${e.note})` : ''}`,
    check(state, e) {
      const w = wager(state, e.wager);
      if (!w || !['open', 'resolved', 'appealed'].includes(w.status)) return `there is no unsettled bet ${e.wager}`;
      if (w.type === 'duel' && !w.taker) return 'nobody has taken this challenge yet';
      return outcomeFor(w, e).why || null;
    },
  });
  r.registerRecord('wager.decide', (state, rec) => {
    const w = wager(state, rec.payload.wager), o = outcomeFor(w, rec.payload);
    w.result = { ...(w.result || {}), decided: rec.payload.proposal || true, outcome: o.outcome, value: o.value, note: rec.payload.note || '' };
    finish(state, w, o.outcome, rec.at, `decision ${rec.payload.proposal || ''}`.trim());
  });
  r.registerEffect({
    name: 'wager.void', module: 'wagers', rule: (p) => p.value('wagers.decide_rule'),
    describe: (e) => `Void bet ${e.wager}: ${e.reason}`,
    check(state, e) {
      const w = wager(state, e.wager);
      if (!w || !['open', 'offered', 'resolved', 'appealed'].includes(w.status)) return `there is no unsettled bet ${e.wager}`;
      return text(e.reason, 300) ? null : 'give a reason (up to 300 characters)';
    },
  });
  r.registerRecord('wager.void', (state, rec) => { const w = wager(state, rec.payload.wager); finish(state, w, 'void', rec.at, `voided by decision: ${rec.payload.reason}`); });
}

export default { name: 'wagers', core: '0.7.7', install, wagerId, prices, tradeCost, subsidy, pot, arbiters, stakeholders, balance,
  parameterKeys: ['wagers.arbiter_office', 'wagers.share_value', 'wagers.max_liquidity', 'wagers.max_stake', 'wagers.max_days', 'wagers.appeal_days', 'wagers.decide_rule'] };
