// 6 · Deliberation. Nothing else can be decided until this exists.
//
// proposal.lay    a proposal, citing the rule it is made under
// ballot.cast     one per voter; a later ballot replaces an earlier one
// proposal.close  closes a proposal whose deadline has passed (anyone may send it;
//                 it is reproducible from the acts, so automation may too)
//
// Who votes is not decided here. decision.electorate names an electorate (see
// kernel/effects.js): every member, one person, an office's holders, a
// committee, the holders of a unit weighted by balance, or nobody at all. The
// roll and its weights are taken when a proposal is laid and fixed for its life.
// Quorum and threshold are fractions of weight; with one vote each, of people.
//
// A proposal may carry effects:
//   changes  { parameter: value }     parameter changes
//   admit    [participant id]         admits applicants
//   paths + digest                    approves a specific change to governed files
//   effects  [{ kind, … }]            anything a module (or the kernel) lets a decision do

import { canonical } from '../../kernel/canonical.js';
import { actId, NS } from '../../kernel/signed.js';
import { Parameters, checkDefinition } from '../../kernel/parameters.js';
import { gateNeed } from '../../kernel/gate.js';
import { installProblem } from '../../kernel/participants.js';
import { simulateEffects as playEffects, resolveElectorate, electorateProblem, effectRecords, admissionProblem } from '../../kernel/effects.js';
import { tallyOf, count } from './count.js';

const DAY = 86400000;
const addDays = (at, d) => new Date(Date.parse(at) + d * DAY).toISOString();
const CHOICES = ['for', 'against', 'abstain'];

export const proposalId = (act) => 'd-' + actId(act).slice(0, 12);
const effects = (x) => canonical({ changes: x.changes || null, admit: x.admit || null, paths: x.paths || null, digest: x.digest || null, effects: x.effects || null, adds: x.adds || null, install: x.install || null });

// The parameters with the proposal's added definitions and its change to
// entity.modules applied: what its other changes are checked against, so a
// proposal may switch a module on and set its parameters at once.
export function withModules(params, act) {
  const doc = structuredClone(params.doc);
  for (const [k, d] of Object.entries(act.adds || {})) doc.parameters[k] = structuredClone(d);
  const next = act.changes && act.changes['entity.modules'];
  if (Array.isArray(next)) doc.parameters['entity.modules'].value = next;
  return new Parameters(doc, params.catalog);
}

// The parameters as they would stand after this proposal: its changes applied
// and the definitions it adds added. Pure; used to check what it would do.
export function futureParams(params, act) {
  const p = withModules(params, act);
  const ok = Object.fromEntries(Object.entries(act.changes || {}).filter(([k, v]) => p.has(k) && !p.check(k, v)));
  return new Parameters(p.apply(ok).doc, params.catalog);
}

// Play the proposal's effects, in order, on a copy of the state, and check that
// someone could still decide afterwards. Returns the reason it would fail, or null.
export function simulateEffects(state, act, params, registry, at) {
  const hasEffects = act.effects && act.effects.length;
  const touches = act.changes && Object.keys(act.changes).length;
  if (!hasEffects && !touches) return null;
  const future = futureParams(params, act);
  const r = playEffects(state, act.effects || [], future, registry, at);
  if (r.why) return r.why;
  return electorateProblem(registry, state, params, r.state, future, at);
}

// The rule the proposal's effects require, and a sentence saying why.
export function required(params, act, registry) {
  const needs = [];
  const fp = withModules(params, act);
  if (act.install && act.install.length) needs.push({ name: params.rule('entity.modules').name, what: 'installing module code' });
  if (act.adds && Object.keys(act.adds).length) needs.push({ name: params.rule('entity.modules').name, what: 'adding a module\'s parameters' });
  if (act.effects && act.effects.length && registry) {
    const future = futureParams(params, act);
    for (const e of act.effects) {
      const def = registry.effects.get(e.kind);
      if (!def) continue;
      try { needs.push({ name: def.rule(future, e, registry), what: def.describe(e) }); } catch { /* reported by the effect check */ }
    }
  }
  const keys = Object.keys(act.changes || {});
  if (keys.length) {
    const r = fp.strictest(keys.filter(k => k !== 'entity.modules'));
    const m = keys.includes('entity.modules') ? params.rule('entity.modules') : null;
    const best = [r, m].filter(Boolean).reduce((a, b) => (!a || params.rank(b.name) > params.rank(a.name) ? b : a), null);
    if (best) needs.push({ name: best.name, what: `changing ${keys.join(', ')}` });
  }
  if (act.admit && act.admit.length) needs.push({ name: params.value('membership.admission_rule'), what: 'admitting participants' });
  if (act.paths && act.paths.length) {
    const g = gateNeed(act.paths, params);
    if (g.need) needs.push({ name: g.need, what: `changing ${g.because.path} (${g.because.why})` });
  }
  if (!needs.length) needs.push({ name: params.ruleOrder()[0], what: 'a motion without effect' });
  return needs.reduce((a, b) => params.rank(b.name) > params.rank(a.name) ? b : a);
}

function closeRecords(state, p, tally, { at, closedEarly, params, registry }) {
  const carried = tally.quorumMet && tally.thresholdMet;
  const out = [];
  let enacted = false, awaiting = null, notEnacted = null;
  if (carried) {
    if (p.reading < p.terms.readings) {
      awaiting = `reading ${p.reading + 1}, laid no sooner than ${addDays(at, p.terms.apart || 0)}`;
    } else {
      // Re-check at enactment: rules may have grown stricter since the proposal was laid.
      const req = required(params, p, registry);
      const bad = params.apply(p.changes || {}).refused.map(r => r.why);
      // An applicant must meet the enabled modules' conditions when admitted.
      for (const id of p.admit || []) { const why = state.participants[id]?.status === 'applicant' && admissionProblem(registry, state, params, id); if (why) bad.push(why); }
      if (params.rank(p.rule) < params.rank(req.name)) notEnacted = `${req.what} now requires "${req.name}"; the proposal was made under "${p.rule}"`;
      else if (bad.length) notEnacted = bad.join('; ');
      else if (resolveElectorate(registry, state, params, at).frozen) notEnacted = 'this entity has since been frozen (decision.electorate is "none")';
      else if ((notEnacted = simulateEffects(state, p, params, registry, at))) { /* not enacted, with the reason */ }
      else {
        enacted = true;
        if (p.changes && Object.keys(p.changes).length) {
          const { changed } = params.apply(p.changes);
          out.push({ kind: 'parameters.changed', payload: { proposal: p.id, changes: p.changes, changed } });
        }
        for (const id of p.admit || []) {
          if (state.participants[id]?.status === 'applicant') out.push({ kind: 'participant.admitted', payload: { proposal: p.id, id } });
        }
        for (const m of p.install || []) {
          const was = state.modules[m.name];
          out.push({ kind: 'module.installed', payload: { proposal: p.id, name: m.name, source: m.source, digest: m.digest, ...(was ? { from: was.digest } : {}) } });
        }
        if (p.adds && Object.keys(p.adds).length) out.push({ kind: 'parameters.added', payload: { proposal: p.id, adds: p.adds } });
        if (p.paths && p.paths.length) out.push({ kind: 'code.approved', payload: { proposal: p.id, paths: p.paths, digest: p.digest } });
        out.push(...effectRecords(p.effects, { proposal: p.id }));
      }
    }
  }
  const summary = { electorate: tally.electorate, cast: tally.cast, for: tally.for, against: tally.against, abstain: tally.abstain,
    quorumNeeded: tally.quorumNeeded, quorumMet: tally.quorumMet, thresholdMet: tally.thresholdMet, ...(p.weights ? { weighted: true } : {}) };
  return [{ kind: 'proposal.closed', payload: { proposal: p.id, carried, closedEarly, enacted, awaiting, notEnacted, tally: summary } }, ...out];
}

function install(registry) {
  registry.registerKind({
    name: 'proposal.lay',
    module: 'deliberation',
    check(state, act, { params, registry }) {
      const me = state.participants[act.by];
      if (me.status !== 'active') return `${act.by} is not an active participant`;
      const who = resolveElectorate(registry, state, params, act.at);
      if (who.frozen) return 'this entity is frozen: decision.electorate is "none", so nothing can be decided';
      if (who.why) return `nobody can decide: ${who.why}`;
      if (who.total === 0) return `nobody can vote: the electorate "${who.spec}" is empty`;
      const fp = withModules(params, act);
      if (typeof act.title !== 'string' || !act.title.trim() || act.title.length > 200) return 'a proposal needs a title of 1–200 characters';
      if (typeof act.rule !== 'string' || !(act.rule in params.rules)) return `unknown rule "${act.rule}"; rules are ${params.ruleNames().join(', ')}`;
      if (params.rules[act.rule].changeable === false) return `no proposal can be made under "${act.rule}"`;
      if (act.changes !== undefined && (typeof act.changes !== 'object' || Array.isArray(act.changes) || act.changes === null)) return 'changes must be an object of parameter: value';
      for (const [k, v] of Object.entries(act.changes || {})) {
        const why = (k === 'entity.modules' ? params : fp).check(k, v);
        if (why) return `refused at proposal: ${why}`;
        if (act.adds && k in act.adds) return `${k} is added by this proposal: give its value in the definition it adds`;
      }
      if (act.admit !== undefined) {
        if (!Array.isArray(act.admit)) return 'admit must be a list of participant ids';
        for (const id of act.admit) if (state.participants[id]?.status !== 'applicant') return `${id} is not an applicant`;
      }
      if (!!act.paths !== !!act.digest) return 'paths and digest must be given together';
      if (act.paths && (!Array.isArray(act.paths) || act.paths.some(x => typeof x !== 'string'))) return 'paths must be a list of file paths';

      if (act.effects !== undefined) {
        if (!Array.isArray(act.effects) || act.effects.some(e => !e || typeof e.kind !== 'string')) return 'effects must be a list of { kind, … }';
      }
      if (act.adds !== undefined && (typeof act.adds !== 'object' || Array.isArray(act.adds) || act.adds === null)) return 'adds must be an object of parameter: definition';
      const before = params.has('entity.modules') ? params.value('entity.modules') : [];
      // Every check here reads the record, never this copy's files, so every
      // copy reaches the same answer whatever code it holds.
      const installWhy = installProblem(act.install);
      if (installWhy) return installWhy;
      // Installing a module already installed, at a different digest, upgrades
      // it: the new code replaces the old for every copy once this carries.
      for (const m of act.install || []) if (state.modules[m.name]?.digest === m.digest) return `module ${m.name} is already installed with exactly this code; change entity.modules to switch it on or off`;
      const installing = (act.install || []).filter(m => !state.modules[m.name]).map(m => m.name);
      if (installing.length && (!act.changes || !Array.isArray(act.changes['entity.modules']) || installing.some(m => !act.changes['entity.modules'].includes(m)))) {
        return 'a module is installed by the proposal that switches it on: include it in entity.modules';
      }
      if ((act.install || []).length && act.effects && act.effects.length) return 'a proposal installing a module cannot also use effects; decide them once the code is in place';
      if (act.changes && 'entity.modules' in act.changes) {
        const next = act.changes['entity.modules'];
        if (!next.includes('deliberation')) return 'deliberation cannot be switched off: nothing could ever be decided again';
        const known = new Set([...Object.keys(state.modules), ...before, ...installing, 'deliberation']);
        const unknown = next.filter(m => !known.has(m));
        if (unknown.length) return `module(s) ${unknown.join(', ')} were never installed; install them by decision, with their source and digest`;
      }
      for (const [k, d] of Object.entries(act.adds || {})) {
        if (params.has(k)) return `${k} already exists`;
        const owner = k.split('.')[0];
        const enabling = act.changes && Array.isArray(act.changes['entity.modules']) && act.changes['entity.modules'].includes(owner) && !before.includes(owner);
        if (!enabling) return `${k} can only be added by the proposal that enables the ${owner} module`;
        const why = checkDefinition(params, k, d);
        if (why) return why;
      }
      const effectWhy = simulateEffects(state, act, params, registry, act.at);
      if (effectWhy) return `refused at proposal: ${effectWhy}`;
      const req = required(params, act, registry);
      if (params.rank(act.rule) < params.rank(req.name)) {
        const r = params.rules[req.name];
        return `refused under amendment.rules.${req.name}: ${req.what} requires "${req.name}" (quorum ${r.quorum}, threshold ${r.threshold}, readings ${r.readings}); this proposal cites "${act.rule}"`;
      }
      const readings = params.rules[act.rule].readings || 1;
      if (act.reading_of) {
        const prev = state.proposals[act.reading_of];
        if (!prev) return `reading_of names ${act.reading_of}, which is not in the record`;
        if (!prev.closed || !prev.closed.carried || prev.enacted) return `${act.reading_of} is not awaiting a further reading`;
        if (prev.rule !== act.rule) return 'a further reading must be made under the same rule';
        if (effects(prev) !== effects(act)) return 'a further reading must carry exactly the same effects as the one before';
        if (prev.reading + 1 > readings) return `the rule "${act.rule}" needs only ${readings} reading(s)`;
        if (prev.next) return `${act.reading_of} already has a further reading (${prev.next})`;
        const earliest = addDays(prev.closed.at, params.rules[act.rule].apart || 0);
        if (act.at < earliest) return `reading ${prev.reading + 1} may not be laid before ${earliest}`;
      }
      return null;
    },
    reduce(state, rec, registry) {
      const act = rec.payload.act;
      const params = new Parameters(state.doc, state.catalog);
      const id = proposalId(act);
      const prev = act.reading_of ? state.proposals[act.reading_of] : null;
      const r = params.rules[act.rule];
      const who = resolveElectorate(registry, state, params, act.at);
      const roll = state.order.filter(pid => pid in who.roll);
      const weighted = roll.some(pid => who.roll[pid] !== 1);
      state.proposals[id] = {
        id, by: act.by, at: act.at, title: act.title, text: act.text || '',
        rule: act.rule,
        terms: { quorum: r.quorum, threshold: r.threshold, readings: r.readings || 1, apart: r.apart || 0 },
        changes: act.changes, admit: act.admit, paths: act.paths, digest: act.digest, effects: act.effects, adds: act.adds, install: act.install,
        deadline: addDays(act.at, params.value('deliberation.period')),
        roll, electorate: who.spec, ...(weighted ? { weights: who.roll } : {}),
        ballots: [], closed: null, enacted: false, awaiting: null,
        reading: prev ? prev.reading + 1 : 1, reading_of: act.reading_of || null, next: null,
      };
      if (prev) prev.next = id;
      state.decisions++;
    },
    records: {
      'proposal.closed'(state, rec) {
        const p = state.proposals[rec.payload.proposal];
        p.closed = { at: rec.at, carried: rec.payload.carried, closedEarly: rec.payload.closedEarly, tally: rec.payload.tally };
        p.enacted = rec.payload.enacted;
        p.awaiting = rec.payload.awaiting;
        p.notEnacted = rec.payload.notEnacted;
        if (p.enacted && p.reading_of) {
          for (let q = state.proposals[p.reading_of]; q; q = q.reading_of ? state.proposals[q.reading_of] : null) { q.enacted = true; q.awaiting = null; }
        }
      },
      'module.installed'(state, rec) {
        const m = rec.payload, was = state.modules[m.name];
        state.modules[m.name] = { source: m.source, digest: m.digest, at: rec.at, by: m.proposal,
          ...(was ? { history: [...(was.history || []), { digest: was.digest, source: was.source, at: was.at, by: was.by }] } : {}) };
      },
      'parameters.added'(state, rec) {
        for (const [k, d] of Object.entries(rec.payload.adds)) state.doc.parameters[k] = structuredClone(d);
      },
      'parameters.changed'(state, rec) {
        state.doc = new Parameters(state.doc, state.catalog).apply(rec.payload.changes).doc;
      },
      'code.approved'(state, rec) {
        state.proposals[rec.payload.proposal].approved = true;
      },
    },
  });

  registry.registerKind({
    name: 'ballot.cast',
    module: 'deliberation',
    // A ballot signs a plain line in its own namespace, so it can be checked
    // with ssh-keygen by eye and cannot be replayed as any other act.
    signs: (act) => ({
      message: `ballot ${act.entity} ${act.proposal} ${act.choice} ${act.by} ${act.at} ${act.salt}`,
      namespace: NS.ballot,
    }),
    check(state, act) {
      if (!state.proposals[act.proposal]) return `no proposal ${act.proposal}`;
      if (!CHOICES.includes(act.choice)) return `choice must be one of ${CHOICES.join(', ')}`;
      return null;
    },
    apply(state, act, { params, registry }) {
      const p = state.proposals[act.proposal];
      if (p.closed || act.at > p.deadline) return [];
      const view = { ...p, ballots: [...p.ballots, { by: act.by, choice: act.choice, at: act.at, hash: 'pending', afterClose: false }] };
      const t = tallyOf(view);
      if (!t.certain) return [];
      return closeRecords(state, p, t, { at: act.at, closedEarly: true, params, registry });
    },
    reduce(state, rec) {
      const act = rec.payload.act;
      const p = state.proposals[act.proposal];
      p.ballots.push({ by: act.by, choice: act.choice, at: act.at, hash: rec.hash, afterClose: !!p.closed });
    },
  });

  registry.registerKind({
    name: 'proposal.close',
    module: 'deliberation',
    check(state, act) {
      const p = state.proposals[act.proposal];
      if (!p) return `no proposal ${act.proposal}`;
      if (p.closed) return `${p.id} closed at ${p.closed.at}`;
      if (act.at < p.deadline) return `${p.id} is open until ${p.deadline} and its outcome can still change`;
      // Ballots are counted, not believed. A close carrying a claimed result
      // that the ballots do not support is refused outright.
      const claim = act.result ?? act.carried ?? act.tally;
      if (claim !== undefined) {
        const t = tallyOf(p);
        const real = t.quorumMet && t.thresholdMet;
        const claimed = typeof claim === 'object' ? !!claim.carried : claim === true || claim === 'carried';
        if (claimed !== real) return `the claimed result does not match the count: counted ${t.for} for, ${t.against} against, ${t.abstain} abstaining of ${t.electorate}; ${real ? 'carried' : 'not carried'}`;
      }
      return null;
    },
    apply(state, act, { params, registry }) {
      const p = state.proposals[act.proposal];
      return closeRecords(state, p, tallyOf(p), { at: act.at, closedEarly: false, params, registry });
    },
  });
}

export default { name: 'deliberation', install, count, tallyOf, required, proposalId, withModules, futureParams, parameterKeys: ['deliberation.period'] };
export { count, tallyOf };
