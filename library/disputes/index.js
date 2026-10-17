// disputes · claims between members, heard and ruled on, with one appeal.
//
//   dispute.open    { dispute, contract?, against?, amount, claim, evidence? }
//                   about a contract (its escrow freezes) or anything else
//   dispute.file    { dispute, statement, evidence? }   either side, any time
//                   before the final ruling; the other side's first filing is
//                   their answer
//   dispute.rule    { dispute, amount, reasons }   by the body hearing it
//                   (disputes.arbiter, then disputes.appeal): one signature for
//                   an office or a member, a majority for a committee. amount is
//                   what the claimant is awarded, from 0 to what they claimed
//   dispute.appeal  { dispute, statement, evidence? }   within appeal_days
//   dispute.execute { dispute }   carries out a first ruling no one appealed
//   effect dispute.decide { dispute, amount, reasons }   an appeal decided by
//                   the members, when disputes.appeal is "assembly"
// Evidence is a list of { name, sha256, note? }: the file itself is shared
// between the parties and the arbiter; its fingerprint, on the record, proves
// later that it was not swapped. Parties never rule on their own dispute, and
// no one who made the first ruling hears its appeal.

import { originOf } from '../../kernel/effects.js';
// Escrow lives in the value module's ledger, in the shape it documents:
// state.m.value.held[id] = { from, amount, owner }. Modules share data, never
// code, so these few lines are this module's own.
const ledger = (state) => (state.m.value ||= { balances: {}, supply: 0 });
const balance = (state, id) => state.m.value?.balances?.[id] || 0;
const heldAmount = (state, id) => state.m.value?.held?.[id]?.amount || 0;
function hold(state, id, from, amount, owner) {
  const l = ledger(state); l.balances[from] = balance(state, from) - amount; (l.held ||= {})[id] = { from, amount, owner };
}
function payHold(state, id, to, amount) {
  const l = ledger(state), h = l.held?.[id]; if (!h) return 0;
  const n = Math.min(amount ?? h.amount, h.amount);
  l.balances[to] = balance(state, to) + n; h.amount -= n; if (!h.amount) delete l.held[id];
  return n;
}
// The contracts module's records, read and settled in the shape it documents.
const contractOf = (state, id) => state.m.contracts?.[id] || null;
const party = (c, who) => (c.provider === who ? 'provider' : c.payer === who ? 'payer' : null);
function settleByRuling(state, id, toPayer, at, by, reason) {
  const c = contractOf(state, id); if (!c) return;
  const held = heldAmount(state, `contract:${c.id}`), back = Math.min(toPayer, held);
  if (back) payHold(state, `contract:${c.id}`, c.payer, back);
  if (held - back) payHold(state, `contract:${c.id}`, c.provider, held - back);
  c.status = back === held ? 'refunded' : back ? 'split' : 'paid'; c.closed = at; c.dispute = null;
  c.history.push({ at, by, what: `settled by ruling: ${back} to ${c.payer}, ${held - back} to ${c.provider}${reason ? ` (${reason})` : ''}` });
}
import { Parameters } from '../../kernel/parameters.js';

const paramsOf = (state) => new Parameters(state.doc, state.catalog);

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const book = (state) => (state.m.disputes ||= {});
export const get = (state, id) => state.m.disputes?.[id] || null;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const isParty = (d, who) => who === d.claimant || who === d.respondent;

function evidenceWhy(ev) {
  if (ev === undefined) return null;
  if (!Array.isArray(ev) || ev.length > 20) return 'evidence is a list of at most 20 items';
  for (const x of ev) {
    if (!x || typeof x.name !== 'string' || !x.name.trim() || x.name.length > 120) return 'each piece of evidence needs a name';
    if (!/^[0-9a-f]{64}$/.test(x.sha256 || '')) return 'each piece of evidence needs the SHA-256 fingerprint of its file';
    if (x.note !== undefined && (typeof x.note !== 'string' || x.note.length > 1000)) return 'a note on evidence is at most 1000 characters';
  }
  return null;
}

// Who sits on a body, and how many of them a ruling needs: read from the
// record itself (offices' holders, committees' members), so checking and
// settling always agree. One signature for an office or a member, a majority
// of a committee.
export function bench(state, spec, at) {
  const [type, id] = String(spec || '').split(':');
  const live = (list) => (list || []).filter(m => m.since <= at && (!m.until || m.until > at)).map(m => m.id).filter(x => state.participants[x]?.status === 'active');
  if (type === 'member') return { members: state.participants[id]?.status === 'active' ? [id] : [], needs: 1 };
  if (type === 'office') return { members: live(state.m.offices?.[id]?.abolished ? [] : state.m.offices?.[id]?.holders), needs: 1 };
  if (type === 'committee') { const m = live(state.m.committees?.[id]?.dissolved ? [] : state.m.committees?.[id]?.members); return { members: m, needs: Math.floor(m.length / 2) + 1 }; }
  return { members: [], needs: 1 };
}
// Who may actually hear this dispute now: the body's members, less the two
// sides and (on appeal) whoever made the first ruling. A majority is counted
// among them, so a barred member can never leave a bench unable to rule.
export function eligible(state, d, params, at) {
  const venue = venueOf(d, params), b = bench(state, venue, at);
  const barred = new Set([d.claimant, d.respondent, ...(level(d) === 'appeal' ? d.rulings[0]?.by || [] : [])]);
  const members = b.members.filter(m => !barred.has(m));
  return { venue, all: b.members, members, needs: venue.startsWith('committee:') ? Math.floor(members.length / 2) + 1 : 1 };
}
const level = (d) => (d.status === 'appealed' ? 'appeal' : 'first');
const venueOf = (d, params) => (level(d) === 'appeal' ? params.value('disputes.appeal') : params.value('disputes.arbiter'));

// Carry a ruling out: the contract's escrow, or a transfer between the two.
function execute(state, d, at, by) {
  const r = d.rulings[d.rulings.length - 1];
  if (d.contract && contractOf(state, d.contract)) {
    const c = contractOf(state, d.contract);
    const held = heldAmount(state, `contract:${c.id}`);
    const toPayer = party(c, d.claimant) === 'payer' ? r.amount : held - r.amount;
    settleByRuling(state, c.id, Math.max(0, Math.min(held, toPayer)), at, by, `dispute ${d.id}`);
  } else if (r.amount) {
    const l = state.m.value; const have = Math.max(0, l.balances[d.respondent] || 0), n = Math.min(have, r.amount);
    l.balances[d.respondent] = (l.balances[d.respondent] || 0) - n; l.balances[d.claimant] = (l.balances[d.claimant] || 0) + n;
    if (r.amount - n) d.owed = r.amount - n;
  }
  if (d.deposit) payHold(state, `dispute:${d.id}`, r.amount > 0 ? d.claimant : d.respondent);
  d.status = 'final'; d.closed = at;
  d.history.push({ at, by, what: `carried out: ${r.amount} awarded to ${d.claimant}${d.owed ? ` (${d.owed} still owed)` : ''}` });
}

function install(r) {
  const kind = (name, check, reduce) => r.registerKind({ name, module: 'disputes', check, reduce });

  kind('dispute.open', (state, a, { params }) => {
    if (!state.m.value) return 'disputes are settled in the entity’s value units: install the value module first';
    if (!ID.test(a.dispute || '')) return 'a dispute id is lowercase letters, digits and -';
    if (get(state, a.dispute)) return 'there is already a dispute with that id';
    if (typeof a.claim !== 'string' || !a.claim.trim() || a.claim.length > 4000) return 'state your claim (up to 4000 characters)';
    if (!Number.isSafeInteger(a.amount) || a.amount < 0) return 'amount is a whole number, zero or more: what you ask to be awarded';
    const ev = evidenceWhy(a.evidence); if (ev) return ev;
    if (a.contract !== undefined) {
      const c = contractOf(state, a.contract);
      if (!c || !['active', 'done'].includes(c.status)) return 'there is no active contract with that id';
      if (!party(c, a.by)) return 'only a party to the contract may open a dispute about it';
      if (c.dispute) return `a dispute (${c.dispute}) is already open on it`;
      if (a.amount > c.amount) return `the contract is for ${c.amount}: you cannot claim more`;
    } else if (state.participants[a.against]?.status !== 'active' || a.against === a.by) return 'name the active member the dispute is against';
    const dep = params.value('disputes.deposit');
    if (dep && (state.m.value.balances[a.by] || 0) < dep) return `opening a dispute needs a deposit of ${dep}`;
    if (!params.value('disputes.arbiter')) return 'no arbiter is set (disputes.arbiter)';
    return null;
  }, (state, rec) => {
    const a = rec.payload.act, params = paramsOf(state);
    const c = a.contract !== undefined ? contractOf(state, a.contract) : null;
    const respondent = c ? (c.provider === a.by ? c.payer : c.provider) : a.against;
    const dep = params.value('disputes.deposit') || 0;
    book(state)[a.dispute] = {
      id: a.dispute, contract: c ? c.id : null, claimant: a.by, respondent, amount: a.amount, claim: a.claim,
      status: 'open', opened: rec.at, answered: null, deposit: 0,
      filings: [{ at: rec.at, by: a.by, role: 'claim', statement: a.claim, evidence: a.evidence || [] }],
      rulings: [], pending: {}, history: [{ at: rec.at, by: a.by, what: `opened against ${respondent}, asking ${a.amount}` }],
    };
    if (dep) { hold(state, `dispute:${a.dispute}`, a.by, dep, 'disputes'); book(state)[a.dispute].deposit = dep; }
    if (c) { c.dispute = a.dispute; c.history.push({ at: rec.at, by: a.by, what: `dispute ${a.dispute} opened: escrow frozen` }); }
  });

  kind('dispute.file', (state, a) => {
    const d = get(state, a.dispute);
    if (!d || d.status === 'final') return 'there is no open dispute with that id';
    if (!isParty(d, a.by)) return 'only the two sides file statements';
    if (typeof a.statement !== 'string' || !a.statement.trim() || a.statement.length > 4000) return 'write a statement (up to 4000 characters)';
    return evidenceWhy(a.evidence);
  }, (state, rec) => {
    const a = rec.payload.act, d = get(state, a.dispute);
    const role = a.by === d.respondent && !d.answered ? 'answer' : 'statement';
    if (role === 'answer') d.answered = rec.at;
    d.filings.push({ at: rec.at, by: a.by, role, statement: a.statement, evidence: a.evidence || [], level: level(d) });
    d.history.push({ at: rec.at, by: a.by, what: role === 'answer' ? 'answered' : 'filed a statement' });
  });

  kind('dispute.rule', (state, a, { params }) => {
    const d = get(state, a.dispute);
    if (!d || !['open', 'appealed'].includes(d.status)) return 'there is no dispute awaiting a ruling with that id';
    if (isParty(d, a.by)) return 'a party may not rule on their own dispute';
    const venue = venueOf(d, params);
    if (venue === 'assembly') return 'this appeal is decided by the members, by proposal (dispute.decide)';
    const b = eligible(state, d, params, a.at);
    if (!b.all.includes(a.by)) return `only ${venue} rules on this ${level(d) === 'appeal' ? 'appeal' : 'dispute'}`;
    if (level(d) === 'appeal' && d.rulings[0]?.by.includes(a.by)) return 'whoever made the first ruling may not hear its appeal';
    if (!b.members.length) return 'no one on this bench is free to hear it: the members must appoint someone';
    if (!Number.isSafeInteger(a.amount) || a.amount < 0 || a.amount > d.amount) return `award between 0 and ${d.amount}, what was claimed`;
    if (typeof a.reasons !== 'string' || a.reasons.trim().length < 10 || a.reasons.length > 8000) return 'give reasons for the ruling';
    if (level(d) === 'first' && !d.answered && days(d.opened, a.at) < params.value('disputes.answer_days'))
      return `the other side has ${params.value('disputes.answer_days')} days to answer before a ruling can be made without them`;
    if (d.pending[`${level(d)}:${a.amount}`]?.by.includes(a.by)) return 'you have already signed this ruling';
    return null;
  }, (state, rec) => {
    const a = rec.payload.act, d = get(state, a.dispute), params = paramsOf(state);
    const key = `${level(d)}:${a.amount}`;
    const p = (d.pending[key] ||= { level: level(d), amount: a.amount, reasons: a.reasons, by: [], concurring: [] });
    p.by.push(a.by); if (p.by.length > 1) p.concurring.push({ by: a.by, reasons: a.reasons });
    d.history.push({ at: rec.at, by: a.by, what: `signed a ruling awarding ${a.amount}` });
    const b = eligible(state, d, params, rec.at), need = b.needs;
    p.by = p.by.filter(x => b.members.includes(x));
    const noAppeal = params.value('disputes.appeal') === 'none' || params.value('disputes.appeal_days') === 0;
    if (p.by.length >= need) {
      d.rulings.push({ ...p, at: rec.at }); d.pending = {};
      if (p.level === 'appeal' || noAppeal) execute(state, d, rec.at, a.by);
      else { d.status = 'ruled'; d.ruled = rec.at; d.history.push({ at: rec.at, by: a.by, what: `ruled: ${a.amount} to ${d.claimant}; open to appeal` }); }
    }
  });

  kind('dispute.appeal', (state, a, { params }) => {
    const d = get(state, a.dispute);
    if (!d || d.status !== 'ruled') return 'only a ruled dispute can be appealed';
    if (!isParty(d, a.by)) return 'only the two sides may appeal';
    if (params.value('disputes.appeal') === 'none') return 'there is no appeal here (disputes.appeal is none)';
    if (days(d.ruled, a.at) > params.value('disputes.appeal_days')) return `appeals close ${params.value('disputes.appeal_days')} days after the ruling`;
    if (typeof a.statement !== 'string' || !a.statement.trim() || a.statement.length > 4000) return 'say why the ruling was wrong';
    return evidenceWhy(a.evidence);
  }, (state, rec) => {
    const a = rec.payload.act, d = get(state, a.dispute);
    d.status = 'appealed'; d.appealed = rec.at;
    d.filings.push({ at: rec.at, by: a.by, role: 'appeal', statement: a.statement, evidence: a.evidence || [], level: 'appeal' });
    d.history.push({ at: rec.at, by: a.by, what: 'appealed' });
  });

  kind('dispute.pay', (state, a) => {
    const d = get(state, a.dispute);
    if (!d || !(d.owed > 0)) return 'nothing is owed under that ruling';
    if (a.by !== d.respondent) return `only ${d.respondent} pays what the ruling left owed`;
    if (!Number.isSafeInteger(a.amount) || a.amount <= 0 || a.amount > d.owed) return `pay between 1 and ${d.owed}`;
    return (state.m.value.balances[a.by] || 0) < a.amount ? 'you do not have that much' : null;
  }, (state, rec) => {
    const a = rec.payload.act, d = get(state, a.dispute), l = state.m.value;
    l.balances[a.by] -= a.amount; l.balances[d.claimant] = (l.balances[d.claimant] || 0) + a.amount; d.owed -= a.amount;
    d.history.push({ at: rec.at, by: a.by, what: `paid ${a.amount}${d.owed ? `; ${d.owed} still owed` : '; nothing more owed'}` });
  });

  kind('dispute.execute', (state, a, { params }) => {
    const d = get(state, a.dispute);
    if (!d || d.status !== 'ruled') return 'only a ruled dispute can be carried out';
    if (days(d.ruled, a.at) <= params.value('disputes.appeal_days')) return `the ruling can be carried out once the ${params.value('disputes.appeal_days')} days for appeal have passed`;
    return null;
  }, (state, rec) => execute(state, get(state, rec.payload.act.dispute), rec.at, rec.payload.act.by));

  r.registerEffect({
    name: 'dispute.decide', module: 'disputes',
    rule: () => 'ordinary',
    describe: (e) => `Decide the appeal in ${e.dispute}: award ${e.amount} to the claimant`,
    check(state, e, params) {
      const d = get(state, e.dispute);
      if (!d || d.status !== 'appealed') return 'there is no appeal awaiting the members with that id';
      if (params.value('disputes.appeal') !== 'assembly') return 'appeals here are not decided by the members';
      if (!Number.isSafeInteger(e.amount) || e.amount < 0 || e.amount > d.amount) return `award between 0 and ${d.amount}`;
      return typeof e.reasons === 'string' && e.reasons.trim().length >= 10 ? null : 'give reasons';
    },
  });
  r.registerRecord('dispute.decide', (state, rec) => {
    const e = rec.payload, d = get(state, e.dispute);
    d.rulings.push({ level: 'appeal', amount: e.amount, reasons: e.reasons, by: ['the members'], at: rec.at });
    execute(state, d, rec.at, originOf(e));
  });
}

export default { name: 'disputes', core: '0.7.7', install, parameterKeys: ['disputes.arbiter', 'disputes.appeal', 'disputes.answer_days', 'disputes.appeal_days', 'disputes.deposit'] };
