// Shared fixtures. A "world" is an in-memory entity with a deterministic clock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRegistry, emptyState, settle, draft, signAct, keys } from '../kernel/index.js';
import { compose, parsePreset } from '../kernel/compose.js';

import { CODE_ROOT } from '../kernel/store.js';

export const ROOT = CODE_ROOT;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Modules outside the core live in the module pack: library/ in the source
// tree, or entity-modules/ beside an installed copy.
export const LIB = [path.join(ROOT, 'library'), process.env.ENTITY_MODULES, path.join(ROOT, '..', 'entity-modules')]
  .filter(Boolean).find(d => fs.existsSync(d));
if (!LIB) throw new Error('the tests need the module pack: unpack entity-modules beside this directory, or set ENTITY_MODULES');
export const moduleDir = (n) => fs.existsSync(path.join(ROOT, 'modules', n, 'index.js')) ? path.join(ROOT, 'modules', n) : path.join(LIB, n);
export async function loadModules(names) {
  const { withParameters } = await import('../modules/index.js');
  const out = [];
  for (const n of names) { const url = `file://${path.join(moduleDir(n), 'index.js')}`; out.push(await withParameters((await import(url)).default, url)); }
  return out;
}

export function composed(presetName = 'assembly', overrides = {}) {
  const preset = parsePreset(read(`presets/${presetName}.yml`));
  preset.set = { ...preset.set, ...overrides };
  const moduleTexts = {};
  for (const m of ['deliberation', ...fs.readdirSync(LIB)]) { const f = path.join(moduleDir(m), 'parameters.yml'); if (fs.existsSync(f)) moduleTexts[m] = fs.readFileSync(f, 'utf8'); }
  return compose({ base: read('kernel/parameters.base.yml'), moduleTexts, preset, presetName });
}

export async function world({ preset = 'assembly', set = {}, modules = ['deliberation', 'titles', 'vocabulary', 'page'], people = 3, start = '2026-03-01T00:00:00.000Z', entity = 'e-test-000001' } = {}) {
  const registry = createRegistry(await loadModules(modules));
  const { text, doc } = composed(preset, set);
  let t = Date.parse(start);
  const w = {
    registry, entity, state: emptyState(), records: [], keys: {},
    at(minutes = 1) { t += minutes * 60000; return new Date(t).toISOString(); },
    jump(days) { t += days * 86400000; },
    line: (id) => keys.publicKeyLine(w.keys[id].publicKey),
    async sign(kind, by, fields = {}, key) {
      return signAct(registry, draft(kind, { entity, by, at: fields.at || w.at(), ...fields }), key || w.keys[by].privateKey);
    },
    async settle(acts) {
      const r = await settle(registry, w.state, Array.isArray(acts) ? acts : [acts]);
      w.state = r.state; w.records.push(...r.records);
      return r;
    },
    async person(id) { w.keys[id] = await keys.generate(); return w.keys[id]; },
    text, doc,
  };
  const ids = Array.from({ length: people }, (_, i) => `p-${String(i + 1).padStart(4, '0')}`);
  for (const id of ids) await w.person(id);
  w.ids = ids;
  const found = await w.sign('entity.found', ids[0], { key: w.line(ids[0]), document: doc, source: text });
  const r = await w.settle(found);
  if (r.refused.length) throw new Error(r.refused[0].reason);
  for (const id of ids.slice(1)) {
    const a = await w.sign('participant.apply', id, { key: w.line(id) });
    const rr = await w.settle(a);
    if (rr.refused.length) throw new Error(rr.refused[0].reason);
  }
  return w;
}

export async function propose(w, by, fields) {
  const { default: d } = await import('../modules/deliberation/index.js');
  const act = await w.sign('proposal.lay', by, fields);
  const r = await w.settle(act);
  return { act, id: d.proposalId(act), refused: r.refused };
}

export function tmp(prefix = 'entity-test-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Silence CLI output inside tests.
export async function quietly(fn) {
  const log = console.log; console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}

// A founded entity on disk, made with the CLI's own commands.
export async function entityOnDisk({ preset = 'assembly', people = 3 } = {}) {
  const dir = tmp();
  process.env.ENTITY_KEYS = tmp('entity-keys-');
  const { copyCode } = await import('../cli/commands/dist.js');
  copyCode(ROOT, dir);
  const { found, preset: presetCmd } = await import('../cli/commands/found.js');
  const { join, settle: settleCmd } = await import('../cli/commands/act.js');
  await quietly(async () => {
    await presetCmd({ pos: ['apply', preset], opt: { dir } });
    await found({ pos: [], opt: { dir, id: 'p-0001' } });
    for (let i = 2; i <= people; i++) await join({ pos: [], opt: { dir, id: `p-${String(i).padStart(4, '0')}` } });
    await settleCmd({ pos: [], opt: { dir } });
  });
  return dir;
}

// ── modules added after founding ──

export const ALL_MODULES = ['deliberation', ...fs.readdirSync(LIB).filter(n => fs.existsSync(path.join(LIB, n, 'index.js')))].sort();

export async function moduleAdds(names) {
  const { parse } = await import('../kernel/yaml.js');
  const adds = {};
  for (const n of names) {
    const f = path.join(moduleDir(n), 'parameters.yml');
    if (fs.existsSync(f)) Object.assign(adds, parse(fs.readFileSync(f, 'utf8')).parameters || {});
  }
  return adds;
}

// Lay a proposal and have every active participant vote for it.
export async function decide(w, fields, by = w.ids[0]) {
  const r = await propose(w, by, fields);
  if (r.refused.length) return { ...r, carried: false };
  for (const id of w.ids) if (w.state.participants[id]?.status === 'active' && !w.state.proposals[r.id].closed) {
    await w.settle(await w.sign('ballot.cast', id, { proposal: r.id, choice: 'for' }));
  }
  const p = w.state.proposals[r.id];
  return { ...r, carried: !!p.closed?.carried, enacted: p.enacted, notEnacted: p.notEnacted };
}

// A world with every module installed, and these ones enabled by decision.
export async function worldWith(names, { adds, ...opts } = {}) {
  opts.adds = adds;
  const w = await world({ modules: ALL_MODULES, ...opts });
  const now = new (await import('../kernel/parameters.js')).Parameters(w.state.doc).value('entity.modules');
  const next = [...now, ...names.filter(n => !now.includes(n))];
  const fresh = names.filter(n => !now.includes(n));
  // Since 0.4 a module's settings are defaults in its code: enabling carries none.
  const r = await decide(w, { title: `Enable ${names.join(', ')}`, rule: 'organic', changes: { 'entity.modules': next },
    install: await installFor(fresh), ...(opts.adds ? { adds: await moduleAdds(fresh) } : {}) });
  if (!r.enacted) throw new Error(`could not enable ${names}: ${r.refused?.[0]?.reason || r.notEnacted}`);
  return w;
}

// What a proposal installing these modules from the pack carries.
export async function installFor(names) {
  const { moduleDigest } = await import('../cli/modules.js');
  return names.map(n => ({ name: n, source: `pack:${n}`, digest: moduleDigest(moduleDir(n), n) }));
}

// Lay a proposal and carry it through every reading its rule needs.
export async function enact(w, fields, by = w.ids[0]) {
  let r = await decide(w, fields, by);
  for (let n = 0; n < 5 && r.carried && !r.enacted && w.state.proposals[r.id]?.awaiting; n++) {
    const p = w.state.proposals[r.id];
    w.jump((p.terms.apart || 0) + 1);
    r = await decide(w, { ...fields, reading_of: r.id }, by);
  }
  return r;
}

// Cast a ballot and settle it.
export async function vote(w, id, by, choice = 'for') {
  return w.settle(await w.sign('ballot.cast', by, { proposal: id, choice }));
}

import { keys as K_ } from '../kernel/index.js';
const subtle_ = globalThis.crypto.subtle, enc_ = new TextEncoder();
const sha_ = async (b) => new Uint8Array(await subtle_.digest('SHA-256', b));
const b64url_ = (b) => Buffer.from(b).toString('base64url');
// A passkey device, simulated: a P-256 key that signs as a phone would.
export async function device(rp = 'poezine.org') {
  const pair = await subtle_.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await subtle_.exportKey('spki', pair.publicKey));
  const credentialId = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const line = K_.passkeyLine({ credentialId, publicKey: spki, rp });
  const assert_ = async (challenge, { origin = `https://${rp}`, rpId = rp, flags = 0x05 } = {}) => {
    const ad = new Uint8Array([...await sha_(enc_.encode(rpId)), flags, 0, 0, 0, 1]);
    const cd = enc_.encode(JSON.stringify({ type: 'webauthn.get', challenge: b64url_(challenge), origin }));
    const raw = new Uint8Array(await subtle_.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new Uint8Array([...ad, ...await sha_(cd)])));
    return { authenticatorData: ad, clientDataJSON: cd, signature: der(raw) };
  };
  return { line, sign: async (message, namespace, opts) => K_.passkeySignature(line, await assert_(await K_.passkeyChallenge(message, namespace), opts)) };
}
function der(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); return b[0] & 0x80 ? [0, ...b] : [...b]; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return new Uint8Array([0x30, 4 + r.length + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}

