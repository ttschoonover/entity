// Shared by every command: where the entity is, where keys live, how to sign.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as store from '../kernel/store.js';
import { emit } from './events.js';
import { ensureModules } from './modules.js';
import { keys, draft, signAct, settle as settleActs, verifyRecords, paramsOf } from '../kernel/index.js';

export class Refusal extends Error {}
export const refuse = (m) => { throw new Refusal(m); };

export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) opt[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

// Values on the command line are JSON when they parse as JSON, text otherwise.
export const value = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

export function entityDir(opt) {
  return path.resolve(opt.dir || process.env.ENTITY_DIR || process.cwd());
}

// Private keys never live inside the entity's directory: that directory is
// copied, published and archived.
export function keyDir(entityId) {
  const base = process.env.ENTITY_KEYS || path.join(os.homedir(), '.entity', 'keys');
  return path.join(base, entityId);
}

export function saveKey(entityId, id, key) {
  const d = keyDir(entityId);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const f = path.join(d, id);
  if (fs.existsSync(f)) refuse(`a key for ${id} already exists at ${f}; refusing to overwrite it`);
  fs.writeFileSync(f, keys.exportPrivateKey(key, `${id}@${entityId}`), { mode: 0o600 });
  fs.writeFileSync(`${f}.pub`, keys.publicKeyLine(key.publicKey, `${id}@${entityId}`) + '\n');
  return f;
}

export function loadKey(entityId, id, file) {
  const f = file || path.join(keyDir(entityId), id);
  if (!fs.existsSync(f)) refuse(`no private key for ${id} at ${f}. Pass --key <file> or set ENTITY_KEYS.`);
  return keys.importPrivateKey(fs.readFileSync(f, 'utf8'));
}

export function whoAmI(entityId, opt) {
  if (opt.as) return opt.as;
  if (process.env.ENTITY_AS) return process.env.ENTITY_AS;
  const d = keyDir(entityId);
  const mine = fs.existsSync(d) ? fs.readdirSync(d).filter(f => !f.endsWith('.pub')) : [];
  if (mine.length === 1) return mine[0];
  refuse(mine.length ? `several keys here (${mine.join(', ')}); say which with --as <id>` : `no key for this entity in ${d}; say who you are with --as <id> --key <file>`);
}

export async function openEntity(opt, { mustBeFounded = true } = {}) {
  const dir = entityDir(opt);
  const e = await store.open(dir);
  if (e.foldError) refuse(`the record cannot be read: ${e.foldError}. Run \`entity diagnose\`.`);
  if (e.damage.length) refuse(`the record file is damaged at line(s) ${e.damage.map(d => d.line).join(', ')}. Run \`entity diagnose\` then \`entity repair\`.`);
  if (mustBeFounded && !e.state.entity) refuse(`${dir} holds no founded entity. Run \`entity found\` first.`);
  e.params = paramsOf(e.state);
  return e;
}

export function now() { return new Date().toISOString(); }

// --password: sign with the member's password instead of a key file. The
// password is read from ENTITY_PASSWORD, or asked for without being shown.
export async function askPassword(question = 'Password: ') {
  if (process.env.ENTITY_PASSWORD) return process.env.ENTITY_PASSWORD;
  if (!process.stdin.isTTY) refuse('--password needs a terminal to ask in, or ENTITY_PASSWORD set');
  process.stdout.write(question);
  return new Promise((resolve) => {
    const stdin = process.stdin; let pw = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(pw); }
      else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
      else if (ch === '\u007f' || ch === '\b') pw = pw.slice(0, -1);
      else pw += ch;
    };
    stdin.on('data', onData);
  });
}

export async function signed(e, kind, fields, opt) {
  const by = fields.by || whoAmI(e.state.entity.id, opt);
  let key;
  if (opt.password) {
    const { passwordKey, keys } = await import('../kernel/index.js');
    key = await passwordKey(e.state.entity.id, by, await askPassword(`Password for ${by}: `));
    if (!e.state.participants[by]?.keys.includes(keys.keyId(keys.publicKeyLine(key.publicKey)))) refuse(`that is not ${by}'s password`);
  } else key = loadKey(e.state.entity.id, by, opt.key);
  return signAct(e.registry, draft(kind, { entity: e.state.entity.id, by, at: fields.at || now(), ...fields }), key);
}

// Settle whatever is pending, write the record and everything derived from it.
// A node settles only acts at least `settleAfter` seconds old (node.json).
// Settlement is deterministic, so peers holding the same acts produce the same
// record; the window gives acts time to reach every peer before anyone settles
// them. It narrows forks; it does not make them impossible.
export function settleHorizon(dir) {
  const lag = Number(store.readNode(dir).settleAfter || 0);
  return new Date(Date.now() - lag * 1000).toISOString();
}

// Fetch and install any module code the record requires and this copy lacks.
export async function bringModules(e) {
  const r = ensureModules(e.dir, e.records);
  if (r.installed.length) {
    e.registry = await store.registryFor(e.dir);
    emit(e.dir, 'modules', { installed: r.installed });
  }
  return r;
}

// After settling: publish to every Radicle destination, if this copy has one.
export async function publishAfterSettle(e, { wait = true } = {}) {
  const node = store.readNode(e.dir);
  const dests = (node.destinations || []).filter(d => d.class === 'radicle');
  if (!dests.length || node.publishOnSettle === false) return null;
  const run = async () => {
    const { push } = await import('./net.js');
    const r = await push(e, dests);
    emit(e.dir, r.refused.length ? 'publish-failed' : 'published', { reached: r.reached, refused: r.refused });
    return r;
  };
  if (wait) return run();
  run().catch(x => emit(e.dir, 'publish-failed', { why: x.message }));
  return { background: true };
}

export async function settlePending(e, { dry = false, until = settleHorizon(e.dir), publish = 'wait' } = {}) {
  const fetched = dry ? { installed: [], failed: [] } : await bringModules(e);
  const pend = store.readPending(e.dir);
  const broken = pend.filter(p => p.error);
  for (const b of broken) store.movePending(e.dir, b.file, 'refused', { reason: `unreadable: ${b.error}` });
  // Acts dated in the future stay pending: they are not refused, only early.
  const ready = pend.filter(p => p.act && p.act.at <= until);
  const out = await settleActs(e.registry, e.state, ready.map(p => p.act), { dry });
  if (dry) return { ...out, fetched, waiting: pend.length - ready.length - broken.length };
  store.appendRecords(e.dir, out.records);
  const fileOf = new Map(ready.map(p => [p.act, p.file]));
  for (const a of out.applied) store.movePending(e.dir, fileOf.get(a.act), 'settled', { settled: true });
  for (const r of out.refused) store.movePending(e.dir, fileOf.get(r.act), 'refused', { reason: r.reason });
  e.state = out.state;
  e.records = [...e.records, ...out.records];
  e.params = paramsOf(e.state);
  store.writeDerived(e.dir, e.state);
  if (out.applied.length) emit(e.dir, 'settled', { acts: out.applied.length, records: e.records.length, kinds: out.applied.map(a => a.act.kind) });
  if (out.refused.length) emit(e.dir, 'refused', { acts: out.refused.length, reasons: out.refused.map(r => r.reason) });
  // A decision may just have installed a module: fetch its code now.
  const after = out.records.some(r => r.kind === 'module.installed') ? await bringModules(e) : { installed: [], failed: [] };
  const published = out.records.length && publish ? await publishAfterSettle(e, { wait: publish === 'wait' }) : null;
  return { ...out, fetched: { installed: [...fetched.installed, ...after.installed], failed: [...fetched.failed, ...after.failed] }, published, waiting: pend.length - ready.length - broken.length };
}

export async function fullVerify(e) {
  return verifyRecords(e.registry, e.records, e.damage);
}

export const out = (...a) => console.log(...a);
