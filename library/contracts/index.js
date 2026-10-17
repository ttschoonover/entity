// contracts · deals between two members, paid through escrow.
//
// A provider does something; a payer pays for it in the entity's value units.
//   contract.offer    { contract, with, role, amount, title, terms, due? }
//                     role: what the offerer is ("provider" or "payer")
//   contract.accept   { contract }  the other party agrees; the payment is
//                     held in escrow from the payer's balance
//   contract.decline / contract.withdraw   before acceptance
//   contract.done     { contract, note? }   the provider says it is done
//   contract.confirm  { contract }          the payer agrees: paid to the provider
//   contract.collect  { contract }          the provider, once contracts.release_days
//                                            have passed since "done" with no dispute
//   contract.cancel   { contract, reason? } both parties sign it: the escrow
//                                            goes back to the payer
// While a dispute is open on a contract (the disputes module), its escrow is
// frozen: nothing here moves it, and only a ruling does.

import { hash } from '../../kernel/hash.js';
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

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const book = (state) => (state.m.contracts ||= {});
export const get = (state, id) => state.m.contracts?.[id] || null;
export const fingerprint = (terms) => hash(String(terms));
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const active = (state, id) => state.participants[id]?.status === 'active';
// What a member still owes under rulings (the disputes module): until it is
// paid, they may not enter new contracts.
export const owes = (state, id) => Object.values(state.m.disputes || {}).filter(d => d.respondent === id && d.owed > 0).reduce((a, d) => a + d.owed, 0);
const debtor = (state, id) => (owes(state, id) ? `${id} still owes ${owes(state, id)} under a ruling, and may not enter new contracts until it is paid` : null);
export const party = (c, who) => (c.provider === who ? 'provider' : c.payer === who ? 'payer' : null);

function install(r) {
  const kind = (name, check, reduce) => r.registerKind({ name, module: 'contracts', check, reduce });

  kind('contract.offer', (state, a, { params }) => {
    if (!state.m.value) return 'contracts are paid in the entity’s value units: install the value module first';
    if (!ID.test(a.contract || '')) return 'a contract id is lowercase letters, digits and -';
    if (get(state, a.contract)) return 'there is already a contract with that id';
    if (!active(state, a.with) || a.with === a.by) return 'offer it to another active member';
    const owing = debtor(state, a.by) || debtor(state, a.with); if (owing) return owing;
    if (!['provider', 'payer'].includes(a.role)) return 'say whether you are the provider or the payer';
    if (!Number.isSafeInteger(a.amount) || a.amount <= 0) return 'the amount is a whole number of the smallest unit, above zero';
    const max = params.value('contracts.max_amount');
    if (max && a.amount > max) return `contracts here are limited to ${max}`;
    if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 120) return 'a title is 1–120 characters';
    if (typeof a.terms !== 'string' || !a.terms.trim() || a.terms.length > 8000) return 'write the terms (up to 8000 characters)';
    if (a.due !== undefined && Number.isNaN(Date.parse(a.due))) return 'due is a date';
    return null;
  }, (state, rec) => {
    const a = rec.payload.act;
    book(state)[a.contract] = {
      id: a.contract, title: a.title, terms: a.terms, text: fingerprint(a.terms), amount: a.amount, due: a.due || null,
      provider: a.role === 'provider' ? a.by : a.with, payer: a.role === 'payer' ? a.by : a.with, offeredBy: a.by,
      status: 'offered', at: rec.at, history: [{ at: rec.at, by: a.by, what: 'offered' }],
    };
  });

  const other = (c, who) => (c.offeredBy === who ? null : who);
  kind('contract.accept', (state, a) => {
    const c = get(state, a.contract);
    if (!c || c.status !== 'offered') return 'there is no open offer with that id';
    if (other(c, a.by) !== a.by || party(c, a.by) === null) return 'only the member it was offered to may accept it';
    const owing = debtor(state, a.by); if (owing) return owing;
    if (balance(state, c.payer) < c.amount) return `${c.payer === a.by ? 'you do' : `${c.payer} does`} not have ${c.amount} to put in escrow`;
    return null;
  }, (state, rec) => {
    const a = rec.payload.act, c = get(state, a.contract);
    hold(state, `contract:${c.id}`, c.payer, c.amount, 'contracts');
    c.status = 'active'; c.accepted = rec.at; c.history.push({ at: rec.at, by: a.by, what: `accepted; ${c.amount} held in escrow` });
  });

  kind('contract.decline', (state, a) => {
    const c = get(state, a.contract);
    return c && c.status === 'offered' && c.offeredBy !== a.by && party(c, a.by) ? null : 'only the member it was offered to may decline an open offer';
  }, (state, rec) => { const c = get(state, rec.payload.act.contract); c.status = 'declined'; c.history.push({ at: rec.at, by: rec.payload.act.by, what: 'declined' }); });

  kind('contract.withdraw', (state, a) => {
    const c = get(state, a.contract);
    return c && c.status === 'offered' && c.offeredBy === a.by ? null : 'only the member who offered it may withdraw an offer not yet accepted';
  }, (state, rec) => { const c = get(state, rec.payload.act.contract); c.status = 'withdrawn'; c.history.push({ at: rec.at, by: rec.payload.act.by, what: 'withdrawn' }); });

  kind('contract.done', (state, a) => {
    const c = get(state, a.contract);
    if (!c || c.status !== 'active') return 'there is no active contract with that id';
    if (c.provider !== a.by) return 'only the provider marks a contract done';
    return a.note !== undefined && (typeof a.note !== 'string' || a.note.length > 2000) ? 'a note is at most 2000 characters' : null;
  }, (state, rec) => { const a = rec.payload.act, c = get(state, a.contract); c.status = 'done'; c.doneAt = rec.at; c.history.push({ at: rec.at, by: a.by, what: `marked done${a.note ? `: ${a.note}` : ''}` }); });

  const frozen = (c) => (c.dispute ? `a dispute (${c.dispute}) is open on this contract: only its ruling can move the escrow` : null);
  const pay = (state, c, to, at, by, what) => {
    const n = payHold(state, `contract:${c.id}`, to);
    c.status = to === c.provider ? 'paid' : 'refunded'; c.closed = at;
    c.history.push({ at, by, what: `${what}: ${n} to ${to}` });
  };

  kind('contract.confirm', (state, a) => {
    const c = get(state, a.contract);
    if (!c || !['active', 'done'].includes(c.status)) return 'there is no active contract with that id';
    if (c.payer !== a.by) return 'only the payer confirms a contract was done';
    return frozen(c);
  }, (state, rec) => { const c = get(state, rec.payload.act.contract); pay(state, c, c.provider, rec.at, rec.payload.act.by, 'confirmed'); });

  kind('contract.collect', (state, a, { params }) => {
    const c = get(state, a.contract);
    if (!c || c.status !== 'done') return 'only a contract marked done can be collected';
    if (c.provider !== a.by) return 'only the provider collects';
    const wait = params.value('contracts.release_days');
    if (days(c.doneAt, a.at) < wait) return `the payer has ${wait} days after it was marked done to confirm or dispute it`;
    return frozen(c);
  }, (state, rec) => { const c = get(state, rec.payload.act.contract); pay(state, c, c.provider, rec.at, rec.payload.act.by, 'collected after the waiting period'); });

  kind('contract.cancel', (state, a) => {
    const c = get(state, a.contract);
    if (!c || !['active', 'done'].includes(c.status)) return 'there is no active contract with that id';
    if (!party(c, a.by)) return 'only the two parties may cancel a contract';
    if ((c.cancel || []).includes(a.by)) return 'you have already agreed to cancel it; the other party must agree too';
    return frozen(c);
  }, (state, rec) => {
    const a = rec.payload.act, c = get(state, a.contract);
    (c.cancel ||= []).push(a.by);
    c.history.push({ at: rec.at, by: a.by, what: `agreed to cancel${a.reason ? `: ${a.reason}` : ''}` });
    if (c.cancel.includes(c.provider) && c.cancel.includes(c.payer)) pay(state, c, c.payer, rec.at, a.by, 'cancelled by both');
  });
}

// For the disputes module: move a contract's escrow by a ruling.
export function settleByRuling(state, id, toPayer, at, by, reason) {
  const c = get(state, id);
  if (!c) return;
  const held = heldAmount(state, `contract:${c.id}`);
  const back = Math.min(toPayer, held);
  if (back) payHold(state, `contract:${c.id}`, c.payer, back);
  if (held - back) payHold(state, `contract:${c.id}`, c.provider, held - back);
  c.status = back === held ? 'refunded' : back ? 'split' : 'paid'; c.closed = at; c.dispute = null;
  c.history.push({ at, by, what: `settled by ruling: ${back} to ${c.payer}, ${held - back} to ${c.provider}${reason ? ` (${reason})` : ''}` });
}

export default { name: 'contracts', core: '0.7.7', install, parameterKeys: ['contracts.release_days', 'contracts.max_amount'] };
