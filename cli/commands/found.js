import fs from 'node:fs';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { compose, parsePreset } from '../../kernel/compose.js';
import { keys, draft, signAct, randomHex, loadDocument, yaml } from '../../kernel/index.js';
import { refuse, openEntity, entityDir, saveKey, loadKey, now, out, settlePending } from '../context.js';
import { fetchSource, describeModule, moduleDigest, STAGED, pin, fromPack } from '../modules.js';

// Where to find a module: library.yml names it; else the pack library.yml's
// "from" line names (GitHub, usually), pinned to a commit; else, for
// development, a module pack on this computer.
export function sourceFor(dir, name) {
  const f = path.join(dir, 'library.yml');
  const lib = fs.existsSync(f) ? (yaml.parse(fs.readFileSync(f, 'utf8')) || {}) : {};
  if (lib.modules?.[name]) return pin(lib.modules[name]);
  if (lib.from) return pin(fromPack(lib.from, name));
  return `pack:${name}`;
}

// Bring in the code of modules a preset names, before founding.
async function fetchForPreset(dir, names) {
  for (const n of names) {
    if (n === 'deliberation' || fs.existsSync(path.join(dir, 'modules', n, 'index.js'))) continue;
    const src = sourceFor(dir, n);
    try {
      const staged = fetchSource(dir, src, n);
      const d = await describeModule(staged);
      if (d.name !== n) refuse(`${src} holds the module "${d.name}", not "${n}"`);
      fs.cpSync(staged, path.join(dir, 'modules', n), { recursive: true });
      fs.rmSync(staged, { recursive: true, force: true });
      out(`fetched module ${n} from ${src}`);
    } catch (e) { refuse(`this preset needs the ${n} module: ${e.message}`); }
  }
}

function presetDir(dir) { return path.join(dir, 'presets'); }

export async function composePreset(dir, name) {
  const f = path.join(presetDir(dir), `${name}.yml`);
  if (!fs.existsSync(f)) refuse(`no preset "${name}" in ${presetDir(dir)}`);
  const preset = parsePreset(fs.readFileSync(f, 'utf8'));
  await fetchForPreset(dir, preset.modules);
  const moduleTexts = {};
  for (const m of store.installedModules(dir)) {
    const pf = path.join(dir, 'modules', m, 'parameters.yml');
    moduleTexts[m] = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8') : null;
  }
  const base = fs.readFileSync(path.join(dir, 'kernel', 'parameters.base.yml'), 'utf8');
  try { return { preset, ...compose({ base, moduleTexts, preset, presetName: name }) }; }
  catch (e) { refuse(e.message); }
}

export async function preset({ pos, opt }) {
  const dir = entityDir(opt);
  const sub = pos[0] || 'list';
  if (sub === 'list') {
    for (const f of fs.readdirSync(presetDir(dir)).filter(f => f.endsWith('.yml')).sort()) {
      const p = parsePreset(fs.readFileSync(path.join(presetDir(dir), f), 'utf8'));
      out(`${f.replace(/\.yml$/, '').padEnd(14)} ${p.describe}`);
      if (p.awaiting.length) out(`${''.padEnd(14)} not yet built: ${p.awaiting.join(', ')}`);
    }
    return;
  }
  if (sub !== 'apply') refuse(`unknown preset command "${sub}"; use list or apply <name>`);
  const name = pos[1] || refuse('which preset? `entity preset list` shows them');
  const composed = await composePreset(dir, name);
  const e = await openEntity(opt, { mustBeFounded: false });
  if (!e.state.entity) {
    fs.writeFileSync(store.P(dir).params, composed.text);
    out(`parameters.yml composed from preset "${name}".`);
  } else {
    const founder = e.state.entity.founder;
    const act = await signAct(e.registry, draft('entity.preset', { entity: e.state.entity.id, by: founder, at: now(), document: composed.doc, source: composed.text }), loadKey(e.state.entity.id, founder, opt.key));
    store.writePending(dir, act);
    const r = await settlePending(e);
    const mine = r.refused.find(x => x.act.kind === 'entity.preset');
    if (mine) refuse(`preset refused: ${mine.reason}`);
    out(`preset "${name}" applied and recorded.`);
  }
  if (composed.preset.awaiting.length) out(`Note: this shape also needs ${composed.preset.awaiting.join(', ')}, which are not built yet.`);
  if (composed.preset.note) out(`\n${composed.preset.note}`);
}

export async function found({ opt }) {
  const dir = entityDir(opt);
  const e = await openEntity(opt, { mustBeFounded: false });
  if (e.state.entity) refuse(`${dir} is already the entity ${e.state.entity.id}, founded ${e.state.entity.founded}`);
  if (!fs.existsSync(store.P(dir).params)) fs.writeFileSync(store.P(dir).params, (await composePreset(dir, opt.preset || 'assembly')).text);
  e.registry = await store.registryFor(dir);   // a preset may just have fetched modules
  const source = fs.readFileSync(store.P(dir).params, 'utf8');
  let document;
  try { document = loadDocument(source); } catch (e2) { refuse(`parameters.yml does not parse: ${e2.message}`); }
  if (opt.name) {
    document.parameters['entity.name'].value = opt.name;
  }
  const id = opt.id || 'p-0001';
  const entityId = opt.entity || `e-${randomHex(8)}`;
  let key;
  const radicleKey = opt.radicle ? (await import('./radicle.js')).radicleKeyFile(opt) : null;
  if (radicleKey) opt.key = radicleKey;
  if (opt.key) key = loadKey(entityId, id, opt.key);
  else { key = (await keys.generate()).privateKey; }
  const { rewriteValues } = await import('../../kernel/parameters.js');
  const src = opt.name ? rewriteValues(source, { 'entity.name': opt.name }) : source;
  // The founding records where each module's code came from, and its digest.
  const enabled = loadDocument(src).parameters['entity.modules']?.value || ['deliberation'];
  const install = [];
  for (const m of enabled.filter(x => x !== 'deliberation')) {
    const mdir = path.join(dir, 'modules', m);
    if (!fs.existsSync(path.join(mdir, 'index.js'))) refuse(`parameters.yml enables ${m}, but its code is not in modules/${m}`);
    install.push({ name: m, source: sourceFor(dir, m), digest: moduleDigest(mdir, m) });
  }
  const act = await signAct(e.registry, draft('entity.found', {
    entity: entityId, by: id, at: now(), key: keys.publicKeyLine(key.publicKey), document: loadDocument(src), source: src,
    ...(install.length ? { install } : {}),
  }), key);
  store.writePending(dir, act);
  const r = await settlePending(e);
  if (r.refused.length) refuse(`founding refused: ${r.refused[0].reason}`);
  let keyFile = opt.key;
  if (radicleKey) keyFile = (await import('./radicle.js')).linkKey(entityId, id, radicleKey);
  else if (!opt.key) keyFile = saveKey(entityId, id, key);
  if (!fs.existsSync(store.P(dir).node)) fs.writeFileSync(store.P(dir).node, JSON.stringify({ port: 7780, destinations: [], classes: {} }, null, 2) + '\n');
  out(`Founded ${e.params.value('entity.name')} (${entityId}).`);
  out(`  founder     ${id}`);
  out(`  your key    ${keyFile}   (outside the entity directory; back it up)`);
  out(`  record      ${store.P(dir).events}`);
  out(`\nThe founding window is open until a second participant joins or a decision is made.`);
  out(`Everything settled in it is settled by you alone; keep it short.`);
}
