// 3 · Rules and parameters. One file of truth; this is the only reader of it.
//
// document := { amendment: { rules, meta, meta_immutable }, parameters: { key: def } }
// def      := { value, type, changed_by, group, describe, min, max, one_of, why }
//
// Defaults live with the code that reads them. A module declares its
// parameters, with defaults, in its own parameters.yml, pinned by the module's
// digest; the kernel declares its newer ones in defaults.js. The document holds
// what the entity has chosen: a full definition (as founding documents and
// older entities carry) or just { value }, an override of the default. Reading
// a parameter the document does not set gives the default of the enabled
// module that declares it.
//
// catalog := { module name: { key: def } }; 'kernel' is always enabled.

import { parse, emitScalar } from './yaml.js';
import { KERNEL_DEFAULTS } from './defaults.js';

// 3.4 · The unchangeable few. Their values are facts of the design, not choices,
// and a document that states otherwise is refused whole.
export const FIXED = Object.freeze({
  'record.immutable': true,
  'membership.transferable': false,
  'exit.unconditional': true,
});

export function loadDocument(text) {
  const d = parse(text);
  return { amendment: d.amendment, parameters: d.parameters || {} };
}

export function validateDocument(doc) {
  const problems = [];
  if (!doc || !doc.amendment || !doc.amendment.rules) problems.push('missing amendment.rules');
  if (!doc || !doc.parameters) problems.push('missing parameters');
  if (problems.length) return problems;
  const rules = doc.amendment.rules;
  if (!rules[doc.amendment.meta]) problems.push(`amendment.meta names unknown rule "${doc.amendment.meta}"`);
  if (doc.amendment.order !== undefined) {
    const changeable = Object.keys(rules).filter(n => rules[n].changeable !== false);
    const o = doc.amendment.order;
    if (!Array.isArray(o) || changeable.some(n => !o.includes(n)) || o.some(n => !(n in rules))) problems.push('amendment.order must list every changeable rule, weakest first, and nothing else');
  }
  for (const [k, def] of Object.entries(doc.parameters)) {
    if (!def || typeof def !== 'object' || !('value' in def)) { problems.push(`${k}: no value`); continue; }
    // An entry without changed_by is an override of a default declared in code.
    if (def.changed_by !== undefined && !rules[def.changed_by]) problems.push(`${k}: changed_by names unknown rule "${def.changed_by}"`);
  }
  for (const [k, v] of Object.entries(FIXED)) {
    const def = doc.parameters[k];
    if (!def) problems.push(`${k} must be present (fixed at ${v})`);
    else {
      if (def.value !== v) problems.push(`${k} is fixed at ${v}; the document says ${def.value}`);
      if (rules[def.changed_by]?.changeable !== false) problems.push(`${k} must be governed by an unchangeable rule`);
    }
  }
  return problems;
}

const TYPES = {
  string: v => typeof v === 'string',
  integer: v => Number.isInteger(v),
  number: v => typeof v === 'number' && Number.isFinite(v),
  fraction: v => typeof v === 'number' && v >= 0 && v <= 1,
  boolean: v => typeof v === 'boolean',
  list: v => Array.isArray(v),
  timestamp: v => v === null || (typeof v === 'string' && !isNaN(Date.parse(v))),
};

const RULE_FIELDS = { quorum: 'fraction', threshold: 'fraction', readings: 'integer', apart: 'integer' };

export class Parameters {
  constructor(doc, catalog = null) {
    this.doc = doc;
    this.catalog = catalog;
    // The defaults in force: the kernel's, and those of every enabled module.
    const d = { ...KERNEL_DEFAULTS };
    const mods = doc.parameters?.['entity.modules']?.value;
    if (catalog && Array.isArray(mods)) for (const m of ['deliberation', ...mods]) Object.assign(d, catalog[m] || {});
    this.defaults = d;
  }

  get rules() { return this.doc.amendment.rules; }
  ruleNames() { return this.ruleOrder(); }

  // Rules from weakest to strongest. Never taken from the order of keys in the
  // document: canonical serialisation sorts keys, so that order does not survive
  // being recorded. amendment.order says it explicitly; documents without one
  // (founded before it existed) are ordered by each rule's own strictness:
  // readings, then threshold, then quorum, then the interval between readings.
  ruleOrder() {
    const changeable = Object.keys(this.rules).filter(n => this.rules[n].changeable !== false);
    const order = this.doc.amendment.order;
    if (Array.isArray(order)) return order.filter(n => changeable.includes(n));
    const key = (n) => { const r = this.rules[n]; return [r.readings || 1, r.threshold || 0, r.quorum || 0, r.apart || 0]; };
    return changeable.sort((x, y) => {
      const a = key(x), b = key(y);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return x < y ? -1 : 1;
    });
  }

  // An unchangeable rule is strongest of all.
  rank(name) {
    if (!(name in this.rules)) return -1;
    if (this.rules[name].changeable === false) return Infinity;
    return this.ruleOrder().indexOf(name);
  }

  keys() {
    const out = [...new Set([...Object.keys(this.doc.parameters), ...Object.keys(this.defaults)])];
    for (const [name, r] of Object.entries(this.rules)) {
      if (r.changeable === false) continue;
      for (const f of Object.keys(RULE_FIELDS)) if (f in r) out.push(`amendment.rules.${name}.${f}`);
    }
    return out;
  }

  def(key) {
    const m = key.match(/^amendment\.rules\.([^.]+)\.([^.]+)$/);
    if (m) {
      const r = this.rules[m[1]];
      if (!r || !(m[2] in RULE_FIELDS) || !(m[2] in r)) return null;
      return { value: r[m[2]], type: RULE_FIELDS[m[2]], changed_by: this.doc.amendment.meta, group: 'Amendment',
        describe: `The ${m[2]} of the ${m[1]} rule.`, min: m[2] === 'readings' ? 1 : undefined };
    }
    if (key === 'amendment.meta') {
      return { value: this.doc.amendment.meta, type: 'string', group: 'Amendment',
        changed_by: this.doc.amendment.meta_immutable ? 'immutable' : this.doc.amendment.meta,
        why: 'the rule for changing rules' };
    }
    const set = this.doc.parameters[key], dflt = this.defaults[key];
    if (set && dflt) return { ...dflt, ...set, default: dflt.value };
    if (set) return set;
    return dflt ? { ...dflt, default: dflt.value } : null;
  }

  // Whether the document sets this parameter, or it stands at its default.
  isSet(key) { return key in this.doc.parameters || /^amendment\./.test(key); }

  value(key) { const d = this.def(key); if (!d) throw new Error(`unknown parameter ${key}`); return d.value; }
  has(key) { return !!this.def(key); }

  rule(key) {
    const d = this.def(key);
    if (!d) return null;
    const name = d.changed_by;
    return { name, ...(this.rules[name] || { changeable: false }) };
  }

  check(key, proposed) {
    const d = this.def(key);
    if (!d) return `${key} is not a parameter`;
    const r = this.rule(key);
    if (r.changeable === false) return `${key} cannot be changed under any rule (${r.name}${d.why ? `: ${d.why}` : ''})`;
    const t = TYPES[d.type];
    if (t && !t(proposed)) return `${key} must be of type ${d.type}`;
    if (d.min !== undefined && proposed < d.min) return `${key} must be at least ${d.min}`;
    if (d.max !== undefined && proposed > d.max) return `${key} must be at most ${d.max}`;
    if (d.one_of && !d.one_of.includes(proposed)) return `${key} must be one of ${d.one_of.join(', ')}`;
    return null;
  }

  // 3.3 · Where several change together, the strictest rule governs.
  strictest(keys) {
    let best = null;
    for (const k of keys) {
      const r = this.rule(k);
      if (!r) continue;
      if (!best || this.rank(r.name) > this.rank(best.name)) best = r;
    }
    return best;
  }

  // Pure: returns a new document. A change to entity.modules is taken into
  // account first, so the other changes may set parameters of a module the same
  // change switches on; changes are otherwise applied, and reported, in order.
  apply(changes) {
    const doc = structuredClone(this.doc);
    const changed = [], refused = [];
    let checker = this;
    const mods = changes['entity.modules'];
    if (mods !== undefined && !this.check('entity.modules', mods)) {
      const d = structuredClone(this.doc); d.parameters['entity.modules'].value = mods;
      checker = new Parameters(d, this.catalog);
    }
    for (const [k, v] of Object.entries(changes)) {
      const why = (k === 'entity.modules' ? this : checker).check(k, v);
      if (why) { refused.push({ key: k, why }); continue; }
      const m = k.match(/^amendment\.rules\.([^.]+)\.([^.]+)$/);
      if (m) doc.amendment.rules[m[1]][m[2]] = v;
      else if (doc.parameters[k]) doc.parameters[k].value = v;
      else doc.parameters[k] = { value: v };
      changed.push({ key: k, from: this.has(k) ? this.value(k) : checker.value(k), to: v });
    }
    return { doc, changed, refused };
  }

  // 3.2 · The tree the rest of the code reads. One file of truth, no second place to drift.
  derived() {
    const tree = {};
    for (const [k, d] of this.keys().filter(k => !/^amendment\./.test(k)).map(k => [k, this.def(k)])) {
      const parts = k.split('.'); let node = tree;
      for (const p of parts.slice(0, -1)) node = (node[p] = node[p] && typeof node[p] === 'object' ? node[p] : {});
      node[parts[parts.length - 1]] = d.value;
    }
    tree.amendment = structuredClone(this.doc.amendment);
    return tree;
  }

  values() {
    const out = {};
    for (const k of this.keys()) out[k] = this.value(k);
    return out;
  }
}

// Surgical rewrite of value lines, keeping comments and descriptions intact.
export function rewriteValues(text, changes) {
  const lines = String(text).split('\n');
  for (const [key, v] of Object.entries(changes)) {
    const m = key.match(/^amendment\.rules\.([^.]+)\.([^.]+)$/);
    if (m) {
      const idx = lines.findIndex(l => new RegExp(`^\\s{4}${m[1].replace(/[.]/g, '\\.')}:\\s*\\{`).test(l));
      if (idx < 0) throw new Error(`cannot find rule ${m[1]} to rewrite`);
      const [, head, body] = lines[idx].match(/^(\s*[^:]+:\s*)(\{.*\})\s*(#.*)?$/);
      const obj = parse(`x: ${body}`).x; obj[m[2]] = v;
      lines[idx] = head + emitScalar(obj);
      continue;
    }
    const start = lines.findIndex(l => l.replace(/\s+$/, '') === `  ${key}:` || l.startsWith(`  ${key}:`) && /^\s{2}\S/.test(l));
    if (start < 0) throw new Error(`cannot find parameter ${key} to rewrite`);
    let j = start + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() && !/^\s{4}/.test(l)) { j = -1; break; }
      if (/^\s{4}value:/.test(l)) break;
    }
    if (j < 0 || j >= lines.length) throw new Error(`parameter ${key} has no value line`);
    lines[j] = `    value: ${emitScalar(v)}`;
    let k = j + 1;
    while (k < lines.length && /^\s{6,}\S/.test(lines[k]) && /^\s*-\s/.test(lines[k])) lines.splice(k, 1);
  }
  return lines.join('\n');
}

// A parameter definition as parameters.yml writes it.
export function emitDefinition(key, def) {
  const order = ['value', 'type', 'one_of', 'min', 'max', 'changed_by', 'group', 'why', 'describe'];
  const lines = [`  ${key}:`];
  for (const k of order) if (def[k] !== undefined) lines.push(`    ${k}: ${emitScalar(def[k])}`);
  return lines.join('\n');
}

// A definition a proposal may add, when it enables the module that owns it.
// Since 0.4 a module's defaults come from its code and nothing need be added;
// adding is still accepted, for entities and tools that do it.
export function checkDefinition(params, key, def) {
  if (!/^[a-z][a-z0-9-]*\.[a-z0-9_.]+$/.test(key)) return `${key} is not a valid parameter name`;
  if (!def || typeof def !== 'object' || !('value' in def)) return `${key} has no value`;
  if (!(def.changed_by in params.rules)) return `${key}: changed_by names unknown rule "${def.changed_by}"`;
  if (params.rules[def.changed_by].changeable === false) return `${key}: a module cannot add an unchangeable parameter`;
  const probe = new Parameters({ amendment: params.doc.amendment, parameters: { [key]: def } });
  probe.defaults = {};
  return probe.check(key, def.value);
}
