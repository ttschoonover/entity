// 10.1 · Presets: a sparse overlay composed with the kernel's parameters into
// one parameters.yml. Pure; callers supply the texts.
//
// The document holds the kernel's parameters and the core's (deliberation) in
// full. Other modules' parameters stay with their code as defaults; the
// document records only the values the preset sets for them.

import { parse, emitScalar } from './yaml.js';
import { loadDocument, rewriteValues, validateDocument, Parameters } from './parameters.js';

export function parsePreset(text) {
  const p = parse(text);
  return { describe: p._ || '', modules: p.modules || ['deliberation'], set: p.set || {}, note: p.note || '', awaiting: p.awaiting || [] };
}

// base: kernel/parameters.base.yml text; moduleTexts: { name: parameters.yml text | null }
export function compose({ base, moduleTexts, preset, presetName }) {
  const missing = preset.modules.filter(m => !(m in moduleTexts));
  if (missing.length) throw new Error(`preset needs module(s) not installed here: ${missing.join(', ')}`);
  let text = `# parameters.yml — the values this entity has chosen, in one place.\n` +
    `# Composed from the kernel and the "${presetName}" preset. Every other module\n` +
    `# parameter stands at the default its module's code declares.\n` +
    `# After founding, values here change only by decision and settlement;\n` +
    `# editing this file by hand is detected by \`entity verify\`.\n\n` + base.trim() + '\n';
  const catalog = {};
  for (const [m, t] of Object.entries(moduleTexts)) if (t) catalog[m] = parse(t).parameters || {};
  const core = moduleTexts.deliberation;
  if (core) text += `\n  # — the core: deliberation\n${core.split('\n').filter(l => !/^parameters:\s*$/.test(l)).join('\n').replace(/\s+$/, '')}\n`;
  text = rewriteValues(text, { 'entity.modules': preset.modules });
  const doc = loadDocument(text);
  const params = new Parameters(doc, catalog);
  const unknown = Object.keys(preset.set).filter(k => !params.has(k));
  if (unknown.length) throw new Error(`preset sets unknown parameter(s): ${unknown.join(', ')}`);
  // A preset may set any value its rules allow to be changed at all.
  const refused = Object.entries(preset.set).map(([k, v]) => params.check(k, v)).filter(Boolean);
  if (refused.length) throw new Error(`preset refused: ${refused.join('; ')}`);
  const inDoc = Object.fromEntries(Object.entries(preset.set).filter(([k]) => k in doc.parameters || /^amendment\./.test(k)));
  const overrides = Object.entries(preset.set).filter(([k]) => !(k in inDoc));
  text = rewriteValues(text, inDoc);
  if (overrides.length) text += `\n  # — set by the preset; every other value stands at its default\n` +
    overrides.map(([k, v]) => `  ${k}:\n    value: ${emitScalar(v)}`).join('\n') + '\n';
  const final = loadDocument(text);
  const problems = validateDocument(final);
  if (problems.length) throw new Error(`composed document is invalid: ${problems.join('; ')}`);
  return { text, doc: final, catalog };
}
