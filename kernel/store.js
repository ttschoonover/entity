// Node-only: the entity's directory on disk. Nothing in here decides anything;
// it reads and writes what the pure kernel computes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLines, serialiseAll } from './record.js';
import { createRegistry } from './index.js';
import { foldRecords } from './state.js';
import { actHash } from './signed.js';
import { canonical } from './canonical.js';
import { loadDocument, rewriteValues, Parameters, emitDefinition } from './parameters.js';
import { loadModules } from '../modules/index.js';

export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const P = (dir) => ({
  root: dir,
  record: path.join(dir, 'record'),
  events: path.join(dir, 'record', 'events.jsonl'),
  attestations: path.join(dir, 'record', 'attestations'),
  checkpoints: path.join(dir, 'record', 'checkpoints'),
  participants: path.join(dir, 'participants'),
  pending: path.join(dir, 'pending'),
  settled: path.join(dir, 'settled'),
  refused: path.join(dir, 'refused'),
  params: path.join(dir, 'parameters.yml'),
  node: path.join(dir, 'node.json'),
  modules: path.join(dir, 'modules'),
});

const mkdirp = (d) => fs.mkdirSync(d, { recursive: true });

export function writeAtomic(file, text) {
  mkdirp(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// read(dir) never throws. Damage is data.
export function read(dir) {
  const f = P(dir).events;
  if (!fs.existsSync(f)) return { records: [], damage: [] };
  try { return parseLines(fs.readFileSync(f, 'utf8')); }
  catch (e) { return { records: [], damage: [{ line: 0, kind: 'unreadable', text: e.message }] }; }
}

export function writeRecords(dir, records, { keepPrevious = false } = {}) {
  const f = P(dir).events;
  if (keepPrevious && fs.existsSync(f)) fs.copyFileSync(f, `${f}.before-repair-${Date.now()}`);
  writeAtomic(f, serialiseAll(records));
}

export function appendRecords(dir, records) {
  if (!records.length) return;
  mkdirp(P(dir).record);
  fs.appendFileSync(P(dir).events, serialiseAll(records));
}

export function installedModules(dir) {
  const m = P(dir).modules;
  if (!fs.existsSync(m)) return [];
  return fs.readdirSync(m).filter(n => fs.existsSync(path.join(m, n, 'index.js'))).sort();
}

export async function registryFor(dir) {
  return createRegistry(await loadModules(installedModules(dir), new URL(`file://${P(dir).modules}/index.js`)));
}

function readJsonFiles(d) {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json') && f !== 'index.json').sort()
    .map(f => { try { return { file: path.join(d, f), data: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) }; } catch (e) { return { file: path.join(d, f), error: e.message }; } });
}

export const readAttestations = (dir) => readJsonFiles(P(dir).attestations).filter(x => x.data).map(x => x.data);
export const readCheckpoints = (dir) => readJsonFiles(P(dir).checkpoints).filter(x => x.data).map(x => x.data).sort((a, b) => a.number - b.number);

function writeIndex(d) {
  const files = fs.readdirSync(d).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
  writeAtomic(path.join(d, 'index.json'), JSON.stringify(files) + '\n');
}
export function writeAttestations(dir, atts) {
  const d = P(dir).attestations; mkdirp(d);
  for (const a of atts) writeAtomic(path.join(d, `${a.by}.json`), JSON.stringify(a, null, 2) + '\n');
  writeIndex(d);
}
export function writeCheckpoints(dir, cps) {
  const d = P(dir).checkpoints; mkdirp(d);
  for (const c of cps) writeAtomic(path.join(d, `${String(c.number).padStart(6, '0')}.json`), JSON.stringify(c, null, 2) + '\n');
  writeIndex(d);
}

export function readPending(dir, sub = 'pending') {
  return readJsonFiles(P(dir)[sub]).map(x => x.data ? { file: x.file, act: x.data.act || x.data } : { file: x.file, error: x.error });
}
export function writePending(dir, act) {
  const f = path.join(P(dir).pending, `${actHash(act).slice(0, 24)}.json`);
  writeAtomic(f, JSON.stringify(act, null, 2) + '\n');
  return f;
}
export function movePending(dir, file, to, extra = {}) {
  const d = P(dir)[to]; mkdirp(d);
  const act = JSON.parse(fs.readFileSync(file, 'utf8'));
  writeAtomic(path.join(d, path.basename(file)), JSON.stringify({ ...extra, act: act.act || act }, null, 2) + '\n');
  fs.unlinkSync(file);
}

// Everything derivable from the record, written where people look for it.
export function writeDerived(dir, state) {
  const d = P(dir).participants; mkdirp(d);
  for (const id of state.order) {
    const p = state.participants[id];
    writeAtomic(path.join(d, `${id}.json`), JSON.stringify(p, null, 2) + '\n');
    writeAtomic(path.join(d, `${id}.pub`), p.keys.map(k => `${k} ${id}`).join('\n') + '\n');
  }
  writeAtomic(path.join(d, 'allowed_signers'), state.order.flatMap(id => state.participants[id].keys.map(k => `${id} ${k}`)).join('\n') + '\n');
  if (state.source) writeAtomic(P(dir).params, parametersText(state));
}

// parameters.yml as the record says it must be: the founding source with every
// enacted value written in.
export function parametersText(state) {
  const src = loadDocument(state.source);
  const now = new Parameters(state.doc).values();
  const was = new Parameters(src).values();
  const diff = {};
  // Only values the founding text writes out are rewritten in place; the rest
  // (including kernel parameters that stood at their defaults) are added below.
  const written = (k) => k in src.parameters || /^amendment\./.test(k);
  for (const [k, v] of Object.entries(now)) if (written(k) && k in was && canonical(v) !== canonical(was[k])) diff[k] = v;
  let text = rewriteValues(state.source, diff);
  // Parameters added since founding, by the decisions that enabled their modules.
  const added = Object.keys(state.doc.parameters).filter(k => !(k in src.parameters));
  if (added.length) text = text.replace(/\s*$/, '\n') + '\n  # — added by decision since founding\n' + added.map(k => emitDefinition(k, state.doc.parameters[k])).join('\n') + '\n';
  return text;
}

export async function open(dir) {
  const registry = await registryFor(dir);
  const { records, damage } = read(dir);
  let state = null, foldError = null;
  try { state = foldRecords(registry, records); } catch (e) { foldError = e.message; }
  return { dir, registry, records, damage, state, foldError };
}

export function readNode(dir) {
  try { return JSON.parse(fs.readFileSync(P(dir).node, 'utf8')); } catch { return { destinations: [], classes: {} }; }
}
