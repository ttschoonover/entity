// 2.6 · The kind registry.
//
// registerKind({ name, module, signs, check, apply, reduce, records, view, selfSigned })
//
//   signs(act)               → { message, namespace }   what the signature covers
//   check(state, act, ctx)   → null | reason            PURE
//   apply(state, act, ctx)   → [{ kind, payload }]      PURE; derived records only.
//                                                       The kernel always records the act itself first.
//   reduce(state, record, registry) → void              folds the act's record into state
//   records: { kind: reduce }                           reducers for derived record kinds
//
// Purity rule, enforced in review and by test 6: check and apply read no clock,
// no network, no randomness, no disk, and do not mutate state.

export class Registry {
  constructor() {
    this.acts = new Map(); this.reducers = new Map(); this.modules = new Map(); this.effects = new Map();
    this.electorates = new Map();
    this.catalog = {};             // module → { parameter: default definition }
    this.incompatible = new Map(); // module → the core version it needs
    this.forkChoice = null;        // set by a finality module: see kernel/transport.js
    this.admissionChecks = [];     // conditions an applicant must meet to be admitted
  }

  // registerAdmissionCheck({ module, check(state, id, params) → null | reason })
  // Something an applicant must have done before they can be admitted (signed
  // an agreement, say). Applies to every way of admitting, while the module is
  // enabled. PURE.
  registerAdmissionCheck(def) {
    if (!def.module || typeof def.check !== 'function') throw new Error('registerAdmissionCheck: module and check required');
    this.admissionChecks.push(def);
    return this;
  }

  // setForkChoice(fn(localState, otherState, fork) → { action: 'switch' | 'keep' | 'conflict', why } | null)
  // When two copies' histories diverge at record `fork`, a finality module may
  // say which stands. Records a final checkpoint covers are never undone.
  setForkChoice(fn) { this.forkChoice = fn; return this; }

  // registerElectorate({ name, module, describe(arg) → text,
  //                      check(state, arg, params) → null | reason,
  //                      roll(state, arg, params, at) → { participant id: whole-number weight } })
  // Who decides. decision.electorate names one, as "name" or "name:arg". The
  // roll is taken when a proposal is laid and fixed for its life, so a vote
  // cannot be bought, joined or diluted while it is open. PURE.
  registerElectorate(def) {
    if (!def.name || !def.module || typeof def.roll !== 'function') throw new Error('registerElectorate: name, module and roll required');
    if (this.electorates.has(def.name)) throw new Error(`electorate ${def.name} is already registered`);
    this.electorates.set(def.name, { check: () => null, describe: (arg) => arg ? `${def.name} ${arg}` : def.name, ...def });
    return this;
  }

  // registerEffect({ name, module, rule(params, effect, registry) → rule name,
  //                  check(state, effect, params, at, { registry, via }) → null | reason, describe(effect) → text })
  // `via` is the authority grant exercising the effect, or null for a decision.
  // An effect is something only a carried decision can do. Its record kind is
  // its name; the module registers a reducer for it like any record.
  registerEffect(def) {
    if (!def.name || !def.module) throw new Error('registerEffect: name and module required');
    if (this.effects.has(def.name)) throw new Error(`effect ${def.name} is already registered`);
    this.effects.set(def.name, { check: () => null, describe: (e) => e.kind, ...def });
    return this;
  }

  registerKind(def) {
    if (!def.name) throw new Error('registerKind: name required');
    if (this.acts.has(def.name)) throw new Error(`kind ${def.name} is already registered`);
    const full = { check: () => null, apply: () => [], reduce: () => {}, ...def };
    this.acts.set(def.name, full);
    this.reducers.set(def.name, full.reduce);
    for (const [k, fn] of Object.entries(def.records || {})) this.registerRecord(k, fn);
    return this;
  }

  registerRecord(kind, reduce) {
    if (this.reducers.has(kind)) throw new Error(`record kind ${kind} is already registered`);
    this.reducers.set(kind, reduce);
  }

  get(name) { return this.acts.get(name) || null; }
  has(name) { return this.acts.has(name); }
  reducer(kind) { return this.reducers.get(kind) || null; }
  kinds() { return [...this.acts.keys()]; }
}
