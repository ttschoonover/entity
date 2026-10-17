// finality · checkpoints that decide, signed by a set of validators, with
// penalties for validators who cheat. Proof of authority: the validators are
// whoever finality.signers names (every member, one person, a role, a
// committee, or holders of the entity's unit weighted by what they hold).
//
// ── Checkpoints ───────────────────────────────────────────────────────────────
// A checkpoint says: "the first N records of this entity end in record hash H".
// Validators sign it with an act, `checkpoint.sign { number, count, head }`, so
// every copy holds the same signatures. The first signature opens checkpoint n
// at the record's head as it then stands; later ones sign that same position.
// It becomes FINAL once its signers carry at least finality.threshold of the
// signing weight, and more than half of it: then any two final checkpoints
// share a signer, and an honest signer never signs two histories.
//
// ── Who signs, anchored ──────────────────────────────────────────────────────
// The signers of checkpoint n, and their weights, are taken from the entity's
// state when checkpoint n-1 was opened: a point every history that shares
// checkpoint n-1 also shares. So a faction cannot pad the signers inside a
// history of its own making. (The first checkpoint's signers are those when it
// opens: make it early.) A checkpoint left open longer than finality.open_days
// lapses, and the next signature may reopen it at the current head.
//
// ── Final means final ─────────────────────────────────────────────────────────
// Records a final checkpoint covers are never undone. Records after the last
// final checkpoint are provisional. When two copies' histories diverge, the one
// with a final checkpoint past the fork stands; the other copy sets its own
// records after the fork aside and settles their acts again on top (see the
// fork choice below and kernel/transport.js). Two histories both final past the
// same fork mean validators signed both: the copies refuse each other, and the
// evidence convicts them.
//
// ── Cheating, and its price ───────────────────────────────────────────────────
// Anyone may submit `checkpoint.evidence { statement }`: a checkpoint.sign act,
// signed by some participant, that contradicts this record (a final checkpoint
// of the same number with another head, or a head that is not this record's at
// that position). The signer is then, automatically and at once:
//   · excluded from signing checkpoints, for good (always);
//   · removed from the office or committee that made them a validator
//     (finality.vacate, on by default);
//   · fined a share of their holdings of the entity's unit (finality.slash,
//     0 by default), of which finality.bounty goes to whoever reported them;
//   · removed from the entity (finality.remove, off by default).
// A statement about this record's own history, such as a checkpoint that
// lapsed and was reopened, is never evidence.
//
// ── When finality stalls ─────────────────────────────────────────────────────
// If too many validators vanish for any checkpoint to become final, a decision
// can re-anchor the signers to those finality.signers names now
// (`finality.reanchor`, under the constitutional rule). It is recorded, and
// shown, like everything else.

import { resolveElectorate, simulateEffects, effectRecords, parseElectorate } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';
import { signedMaterial, actId } from '../../kernel/signed.js';
import { verify } from '../../kernel/keys.js';
import { keysAt } from '../../kernel/participants.js';

const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
const book = (state) => (state.m.finality ||= { finals: [], open: null, rolls: {}, banned: {}, evidence: [] });
const params = (state) => new Parameters(state.doc, state.catalog);
export const evidenceId = (act) => 'v-' + actId(act).slice(0, 12);

export function lastFinal(state) { const f = state.m.finality?.finals; return f?.length ? f[f.length - 1] : null; }
export const finalCount = (state) => lastFinal(state)?.count || 0;
const nextNumber = (state) => (lastFinal(state)?.number || 0) + 1;

// Who may sign checkpoints now, by the entity's current settings, less anyone excluded.
function rollNow(registry, state, at) {
  const p = params(state);
  const e = resolveElectorate(registry, state, p, at, p.value('finality.signers'));
  const banned = state.m.finality?.banned || {};
  const roll = Object.fromEntries(Object.entries(e.roll).filter(([id]) => !banned[id]));
  return { roll, total: Object.values(roll).reduce((a, b) => a + b, 0), why: e.frozen ? 'finality.signers is "none"' : e.why };
}

// The signers of checkpoint n: anchored when n-1 was opened, or (for the
// first, or after a re-anchoring) taken now.
export function rollFor(registry, state, n, at) {
  const r = state.m.finality?.rolls?.[n];
  if (r) return r;
  return rollNow(registry, state, at);
}

export function isOpen(state, at) {
  const o = state.m.finality?.open;
  return o && at <= addDays(o.opened, params(state).value('finality.open_days')) ? o : null;
}

// The signing weight a checkpoint carries, not counting anyone since excluded.
export function weightOf(state, o) {
  const banned = state.m.finality?.banned || {};
  return Object.keys(o.signed).filter(id => !banned[id]).reduce((a, id) => a + (o.roll[id] || 0), 0);
}
export function isFinal(weight, total, threshold) {
  return total > 0 && weight * 2 > total && weight >= threshold * total - 1e-9;
}

// Does this signed statement contradict this record? → null if it does not.
function contradiction(state, st) {
  const done = (state.m.finality?.finals || []).find(f => f.number === st.number);
  if (done && done.head !== st.head) return `it signs checkpoint ${st.number} at ${st.head.slice(0, 12)}…, and this record's checkpoint ${st.number} is final at ${done.head.slice(0, 12)}…`;
  const hashes = state.hashes || [];
  if (Number.isInteger(st.count) && st.count >= 1 && st.count <= hashes.length && hashes[st.count - 1] !== st.head)
    return `it signs record ${st.count} as ${st.head.slice(0, 12)}…, and this record's ${st.count}th is ${hashes[st.count - 1].slice(0, 12)}…`;
  return null;
}

function install(r) {
  r.registerKind({
    name: 'checkpoint.sign', module: 'finality',
    check(state, act, { registry }) {
      const p = state.participants[act.by];
      if (p.status !== 'active') return 'only active members sign checkpoints';
      if (state.m.finality?.banned?.[act.by]) return `${act.by} was excluded from signing checkpoints (see the evidence)`;
      const n = nextNumber(state);
      if (act.number !== n) return `the next checkpoint is number ${n}`;
      if (!Number.isInteger(act.count) || typeof act.head !== 'string') return 'a checkpoint is { number, count, head }';
      const o = isOpen(state, act.at);
      if (o) {
        if (o.count !== act.count || o.head !== act.head) return `checkpoint ${n} is open at record ${o.count} (${o.head.slice(0, 12)}…): sign that one`;
        if (!o.roll[act.by]) return `${act.by} is not among the signers of checkpoint ${n}`;
        if (o.signed[act.by]) return 'you have already signed it';
        return null;
      }
      if (act.count !== state.head.seq || act.head !== state.head.hash) return `a new checkpoint is opened at the record's head: record ${state.head.seq}, ${state.head.hash.slice(0, 12)}…`;
      if (act.count <= finalCount(state)) return `nothing new since checkpoint ${n - 1}`;
      const roll = rollFor(registry, state, n, act.at);
      if (roll.why) return `nobody can sign checkpoints: ${roll.why}`;
      if (!roll.roll[act.by]) return `${act.by} is not among the signers of checkpoint ${n} (${params(state).value('finality.signers')})`;
      return null;
    },
    apply(state, act, { registry, params: p }) {
      const o = isOpen(state, act.at);
      const roll = o ? o : rollFor(registry, state, act.number, act.at);
      const signed = { ...(o?.signed || {}), [act.by]: act.at };
      const weight = weightOf(state, { roll: roll.roll, signed });
      if (!isFinal(weight, roll.total, p.value('finality.threshold'))) return [];
      return [{ kind: 'checkpoint.final', payload: { number: act.number, count: act.count, head: act.head, weight, total: roll.total, signers: Object.keys(signed).sort() } }];
    },
    reduce(state, rec, registry) {
      const a = rec.payload.act, f = book(state);
      if (!isOpen(state, a.at)) {
        const roll = rollFor(registry, state, a.number, a.at);
        f.open = { number: a.number, count: a.count, head: a.head, opened: rec.at, roll: roll.roll, total: roll.total, signed: {} };
        f.rolls[a.number] = { roll: roll.roll, total: roll.total };
        // The signers of the next checkpoint, anchored here: the state as of this
        // checkpoint's own position.
        f.rolls[a.number + 1] = rollNow(registry, state, a.at);
        delete f.rolls[a.number + 1].why;
      }
      f.open.signed[a.by] = rec.at;
    },
    records: {
      'checkpoint.final'(state, rec) {
        const f = book(state), x = rec.payload;
        f.finals.push({ number: x.number, count: x.count, head: x.head, at: rec.at, weight: x.weight, total: x.total, signers: x.signers });
        f.open = null;
      },
    },
  });

  r.registerKind({
    name: 'checkpoint.evidence', module: 'finality',
    async check(state, act, { registry }) {
      if (state.participants[act.by].status !== 'active') return 'only active members submit evidence';
      const st = act.statement;
      if (!st || st.kind !== 'checkpoint.sign' || typeof st.signature !== 'string') return 'the statement must be a signed checkpoint.sign act';
      if (st.entity !== state.entity.id) return `the statement is about ${st.entity}, not this entity`;
      const who = state.participants[st.by];
      if (!who) return `${st.by} is not on this register`;
      if (state.m.finality?.banned?.[st.by]) return `${st.by} has already been excluded`;
      const why = contradiction(state, st);
      if (!why) return 'that statement agrees with this record (or concerns records this copy does not hold yet): it is not evidence of anything';
      // The statement must really be theirs: signed with any key they have
      // ever held here.
      const { message, namespace } = signedMaterial(registry, st);
      const v = await verify(message, st.signature, keysAt(who, '0000'), namespace);
      return v.ok ? null : `the statement's signature does not verify (${v.error})`;
    },
    apply(state, act, { registry, params: p }) {
      const id = evidenceId(act);
      return effectRecords(penalties(registry, state, p, act.statement.by, act.by, act.at), { by_evidence: id });
    },
    reduce(state, rec) {
      const a = rec.payload.act, f = book(state), st = a.statement;
      const why = contradiction(state, st);
      f.banned[st.by] = { at: rec.at, evidence: evidenceId(a), number: st.number };
      f.evidence.push({ id: evidenceId(a), against: st.by, by: a.by, at: rec.at, number: st.number, count: st.count, head: st.head, why });
    },
  });

  r.registerEffect({
    name: 'finality.reanchor', module: 'finality',
    rule: (p) => p.value('finality.reanchor_rule'),
    describe: (e) => `Re-anchor checkpoint signing to those finality.signers names now${e.reason ? ` (${e.reason})` : ''}`,
    check: (state, e) => (typeof e.reason === 'string' && e.reason.trim() ? null : 'give a reason; it is published'),
  });
  r.registerRecord('finality.reanchor', (state, rec, registry) => {
    const f = book(state), n = nextNumber(state);
    f.open = null;
    const roll = rollNow(registry, state, rec.at); delete roll.why;
    f.rolls[n] = roll;
    f.reanchored = [...(f.reanchored || []), { at: rec.at, number: n, reason: rec.payload.reason, total: roll.total }];
  });

  // Choosing between histories: a copy keeps a history made final past the
  // fork, switches to one, and refuses two.
  r.setForkChoice((mine, theirs, fork) => {
    const past = (s) => (s.m.finality?.finals || []).filter(f => f.count >= fork).pop() || null;
    const a = past(mine), b = past(theirs);
    if (a && b) return { action: 'conflict', why: `both histories have a final checkpoint past record ${fork} (${a.number} here, ${b.number} there): validators signed both. Keep this copy, and submit the other's signatures as evidence (\`entity finality scan\`)` };
    if (b) return { action: 'switch', why: `the other history is final past record ${fork} (checkpoint ${b.number}); this copy's records after the fork were provisional` };
    if (a) return { action: 'keep', why: `this history is final past record ${fork} (checkpoint ${a.number}); the other copy's records after the fork are provisional and it should take this one` };
    return null;
  });
}

// The penalties evidence brings, as effects checked like any other: each that
// cannot happen (no office to vacate, nothing to fine) is left out.
export function penalties(registry, state, p, against, reporter, at) {
  const out = [];
  const spec = p.value('finality.signers');
  const { name, arg } = parseElectorate(spec);
  if (p.value('finality.vacate')) {
    if (name === 'office' && state.m.offices?.[arg]?.holders.some(h => h.id === against && (!h.until || h.until > at))) out.push({ kind: 'office.vacate', office: arg, holder: against });
    if (name === 'committee' && state.m.committees?.[arg]?.members.some(m => m.id === against && (!m.until || m.until > at))) out.push({ kind: 'committee.remove', committee: arg, member: against });
  }
  const slash = p.value('finality.slash'), held = state.m.value?.balances?.[against] || 0;
  const fine = Math.floor(held * slash);
  if (fine > 0) {
    out.push({ kind: 'value.revoke', from: against, amount: fine, memo: 'fined for signing a false checkpoint' });
    const bounty = Math.floor(fine * p.value('finality.bounty'));
    if (bounty > 0 && reporter !== against) out.push({ kind: 'value.issue', to: reporter, amount: bounty, memo: 'bounty for evidence of a false checkpoint' });
  }
  if (p.value('finality.remove')) out.push({ kind: 'participant.remove', id: against, reason: 'signed a checkpoint of a false history' });
  const kept = [];
  let s = state;
  for (const e of out) {
    const r = simulateEffects(s, [e], p, registry, at);
    if (!r.why) { kept.push(e); s = r.state; }
  }
  return kept;
}

export default { name: 'finality', core: '0.5.5', install, lastFinal, finalCount, rollFor, isOpen, weightOf, isFinal, penalties, evidenceId,
  parameterKeys: ['finality.signers', 'finality.threshold', 'finality.open_days', 'finality.vacate', 'finality.slash', 'finality.bounty', 'finality.remove', 'finality.reanchor_rule'] };
