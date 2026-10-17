// Effects and electorates: what a decision can do, and who makes it.
//
// An effect is something only the entity can do: a carried decision, or the
// holder of an authority grant acting within it. Both run effects through the
// same function here, so both are held to the same checks.
//
// An electorate is who votes on the entity's proposals, named by the parameter
// decision.electorate as "name" or "name:arg". The kernel knows four:
//
//   members       every active member, one vote each (the default)
//   founder       the founder alone
//   member:ID     one named member alone
//   none          nobody: the entity is frozen, and nothing can be decided again
//
// Modules add more (offices: office:ID; committees: committee:ID; value: value).
// A roll is { participant id: whole-number weight }, and only active members
// are ever on one.

const whole = (n) => Number.isSafeInteger(n) && n > 0;
// Fields the entity adds to an effect's record to say where it came from.
const RESERVED = ['proposal', 'via', 'exercise', 'by_election', 'by_evidence'];

export function parseElectorate(spec) {
  const s = String(spec ?? '');
  const i = s.indexOf(':');
  return i < 0 ? { name: s, arg: null } : { name: s.slice(0, i), arg: s.slice(i + 1) };
}

const enabledIn = (params) => (params.has('entity.modules') ? params.value('entity.modules') : []);

// → { spec, frozen, roll, total, voters, why }
export function resolveElectorate(registry, state, params, at, spec = params.value('decision.electorate')) {
  const out = { spec, frozen: false, roll: {}, total: 0, voters: 0, why: null };
  if (spec === 'none') return { ...out, frozen: true };
  const { name, arg } = parseElectorate(spec);
  const def = registry.electorates.get(name);
  if (!def) return { ...out, why: `"${spec}" is not an electorate this entity knows (${[...registry.electorates.keys(), 'none'].join(', ')})` };
  if (def.module !== 'kernel' && !enabledIn(params).includes(def.module)) return { ...out, why: `the electorate "${spec}" needs the ${def.module} module, which is not enabled` };
  const bad = def.check(state, arg, params);
  if (bad) return { ...out, why: bad };
  const roll = {};
  for (const [id, w] of Object.entries(def.roll(state, arg, params, at) || {})) {
    if (state.participants[id]?.status === 'active' && whole(w)) roll[id] = w;
  }
  const ids = Object.keys(roll).sort();
  const sorted = Object.fromEntries(ids.map(id => [id, roll[id]]));
  return { ...out, roll: sorted, voters: ids.length, total: ids.reduce((n, id) => n + sorted[id], 0) };
}

export function describeElectorate(registry, spec) {
  if (spec === 'none') return 'nobody: this entity is frozen';
  const { name, arg } = parseElectorate(spec);
  const def = registry.electorates.get(name);
  return def ? def.describe(arg) : spec;
}

// Play effects, in order, on a copy of the state. Returns the reason the first
// one fails, or null, and the state they leave. `params` are the parameters as
// they will stand when the effects happen.
//
// ctx.via names the authority grant exercising them, if any; effect checks may
// read it (authority does, to keep delegated powers within their grant).
export function simulateEffects(state, effects, params, registry, at, ctx = {}) {
  const sim = structuredClone(state);
  sim.doc = params.doc;
  const enabled = enabledIn(params);
  for (const [i, e] of (effects || []).entries()) {
    if (!e || typeof e.kind !== 'string') return { why: `effect ${i + 1}: an effect is { kind, … }`, state: sim };
    for (const f of RESERVED) if (f in e) return { why: `effect ${i + 1}: "${f}" is set by the entity, not by the effect`, state: sim };
    const def = registry.effects.get(e.kind);
    if (!def) return { why: `effect ${i + 1}: unknown effect "${e.kind}"`, state: sim };
    if (def.module !== 'kernel' && !enabled.includes(def.module)) return { why: `effect ${i + 1}: module "${def.module}" is not enabled`, state: sim };
    const why = def.check(sim, e, params, at, { registry, via: ctx.via || null });
    if (why) return { why: `effect ${i + 1} (${e.kind}): ${why}`, state: sim };
    const reduce = registry.reducer(e.kind);
    if (reduce) reduce(sim, { at, kind: e.kind, payload: { ...e, ...(ctx.via ? { via: ctx.via, exercise: 'simulated' } : { proposal: 'simulated' }) } }, registry);
  }
  return { why: null, state: sim };
}

// Why this applicant cannot be admitted yet, by the enabled modules' conditions.
export function admissionProblem(registry, state, params, id) {
  const on = enabledIn(params);
  for (const c of registry?.admissionChecks || []) {
    if (!on.includes(c.module)) continue;
    const why = c.check(state, id, params);
    if (why) return `${id} cannot be admitted yet: ${why}`;
  }
  return null;
}

// Whoever could decide before must still be someone after: a decision may not
// leave the entity with an electorate nobody is on, unless it says "none" on
// purpose. (Members leaving is not a decision, and cannot be prevented.)
export function electorateProblem(registry, before, beforeParams, after, afterParams, at) {
  const now = resolveElectorate(registry, after, afterParams, at);
  if (now.frozen) return null;
  if (now.why) return `decision.electorate: ${now.why}`;
  if (now.total > 0) return null;
  const was = resolveElectorate(registry, before, beforeParams, at);
  if (was.total === 0 && was.spec === now.spec) return null;
  return `afterwards nobody could vote: the electorate "${now.spec}" would be empty. To freeze the entity on purpose, set decision.electorate to "none"`;
}

// The records effects write, each carrying where its authority came from:
// { proposal } for a carried decision, { via, exercise } for a grant's use,
// { by_election } for the result of an election.
export const effectRecords = (effects, origin) =>
  (effects || []).map(({ kind, ...rest }) => ({ kind, payload: { ...rest, ...origin } }));

// A short account of where an effect came from, for histories and the page.
export const originOf = (payload) =>
  payload?.proposal ? `decision ${payload.proposal}` : payload?.via ? `grant ${payload.via}` : payload?.by_election ? `election ${payload.by_election}` : payload?.by_evidence ? `evidence ${payload.by_evidence}` : 'the entity';
