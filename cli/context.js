// Shared by every command: where the entity is, where keys live, how to sign.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as store from '../kernel/store.js';
import { emit } from './events.js';
import { readKeyFile, lockText, passphrase } from './keyfile.js';
import { ensureModules } from './modules.js';
import { keys, draft, signAct, settle as settleActs, verifyRecords, paramsOf, sealing as S } from '../kernel/index.js';

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
  // ENTITY_LOCK_KEYS=1: lock every new key with the passphrase (cli/keyfile.js).
  let text = keys.exportPrivateKey(key, `${id}@${entityId}`);
  if (process.env.ENTITY_LOCK_KEYS === '1') {
    const pass = passphrase(`A passphrase to lock ${id}'s new key: `);
    if (!pass) refuse('ENTITY_LOCK_KEYS is set but there is no passphrase: set ENTITY_PASSPHRASE, or run this from a terminal');
    text = lockText(text, pass);
  }
  fs.writeFileSync(f, text, { mode: 0o600 });
  fs.writeFileSync(`${f}.pub`, keys.publicKeyLine(key.publicKey, `${id}@${entityId}`) + '\n');
  return f;
}

export function loadKey(entityId, id, file) {
  const f = file || path.join(keyDir(entityId), id);
  if (!fs.existsSync(f)) refuse(`no private key for ${id} at ${f}. Pass --key <file> or set ENTITY_KEYS.`);
  let text; try { text = readKeyFile(f); } catch (x) { refuse(x.message); }
  return keys.importPrivateKey(text);
}

export function whoAmI(entityId, opt) {
  if (opt.as) return opt.as;
  if (process.env.ENTITY_AS) return process.env.ENTITY_AS;
  const d = keyDir(entityId);
  const mine = fs.existsSync(d) ? fs.readdirSync(d).filter(f => !f.endsWith('.pub')) : [];
  if (mine.length === 1) return mine[0];
  refuse(mine.length ? `several keys here (${mine.join(', ')}); say which with --as <id>` : `no key for this entity in ${d}; say who you are with --as <id> --key <file>`);
}

// Who this copy reads a sealed record as: the member whose key is here, by
// their record key (kernel/sealing.js). Null when there is no such key.
function openerFor(opt) {
  return async (entityId) => {
    try {
      const id = whoAmI(entityId, opt);
      const k = loadKey(entityId, id, opt.key);
      return { id, sk: (await S.recordKeyFromSeed(k.seed)).sk };
    } catch { return null; }
  };
}

// opt.relay (set by `entity serve`): a node may hold a sealed record it cannot
// open (a zero-knowledge node): it then works on the public part, stores and
// relays, and never settles.
export async function openEntity(opt, { mustBeFounded = true, readable = !opt.relay } = {}) {
  const dir = entityDir(opt);
  const opener = openerFor(opt);
  const e = await store.open(dir, { opener });
  // Sealing switched on but nothing sealed yet: a keyring all the same, to seal with.
  if (!e.ring && e.state && S.sealingOn(e.state)) {
    const who = await opener(e.state.entity.id);
    e.ring = S.keyring(who); for (const v of e.views) e.ring.learn(v);
  }
  e.me = e.ring ? (await opener(e.state?.entity?.id || ''))?.id || null : null;
  if (e.unreadable && readable) refuse(`this copy holds ${e.unreadable} sealed record(s) it cannot open. Only a member can read them: run as a member (--as id, with their key here). Anyone can check the chain with \`entity verify --structure\`.`);
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
  // A copy that cannot open the record cannot settle: it would reach a
  // different result from a member's copy. Its acts wait for one.
  if (e.unreadable) return { applied: [], refused: [], records: [], views: [], held: store.readPending(e.dir).filter(p => p.act || p.sealedAct), waitingFor: ['a member\'s copy: this one cannot open the sealed record'], state: e.state, fetched: { installed: [], failed: [] }, published: null, waiting: 0 };
  const fetched = dry ? { installed: [], failed: [] } : await bringModules(e);
  const pend = store.readPending(e.dir);
  // Sealed acts in transit: a reader's copy opens them; any other leaves them be.
  for (const p of pend) if (p.sealedAct && e.ring) { try { const a = await S.openAct(p.sealedAct, e.ring); if (a) p.act = a; } catch { p.error = 'a sealed act that does not open'; } }
  const broken = pend.filter(p => p.error);
  for (const b of broken) store.movePending(e.dir, b.file, 'refused', { reason: `unreadable: ${b.error}` });
  // Acts dated in the future stay pending: they are not refused, only early.
  const ready = pend.filter(p => p.act && p.act.at <= until);
  const early = pend.filter(p => p.act && p.act.at > until).length;   // dated in the future
  // Sealing is on and this member has no record key yet: publish one first.
  if (!dry) { const rk = await publishRecordKey(e, ready.map(p => p.act)); if (rk) ready.push(rk); }
  let out = await settleActs(e.registry, e.state, ready.map(p => p.act), { dry, sealer: e.ring });
  // A sealed record waiting for a key period: if this copy is a reader's, open
  // one now (kernel/sealing.js) and settle again, so nothing waits on a person.
  // Likewise when members wait to be included (they published a record key).
  // And at once after a departure, rather than when something next needs sealing.
  const due = (st) => S.readers(st).includes(e.me) && (/a new key period/.test(out.waitingFor[0] || '') && out.held.length
    || (S.sealingOn(st) && (S.waitingReaders(st).length || S.rotationNeeded(st))));
  if (!dry && e.me && due(out.state)) {
    const opened = await openKeyPeriod(e, out.state).catch(() => null);
    if (opened) { ready.push(opened); out = await settleActs(e.registry, e.state, ready.map(p => p.act), { dry, sealer: e.ring }); }
  }
  if (dry) return { ...out, fetched, waiting: early };
  store.appendRecords(e.dir, out.records);
  const fileOf = new Map(ready.map(p => [p.act, p.file]));
  for (const a of out.applied) store.movePending(e.dir, fileOf.get(a.act), 'settled', { settled: true });
  for (const r of out.refused) store.movePending(e.dir, fileOf.get(r.act), 'refused', { reason: r.reason });
  e.state = out.state;
  e.records = [...e.records, ...out.records];
  e.views = [...(e.views || []), ...(out.views || out.records)];
  e.params = paramsOf(e.state);
  store.writeDerived(e.dir, e.state);
  // The notify module: sealed notices for members who asked (cli/notify.js).
  if (out.records.length) { try { await (await import('./notify.js')).afterSettle(e); } catch (err) { emit(e.dir, 'notify-error', { error: err.message }); } }
  if (out.applied.length) emit(e.dir, 'settled', { acts: out.applied.length, records: e.records.length, kinds: out.applied.map(a => a.act.kind) });
  if (out.refused.length) emit(e.dir, 'refused', { acts: out.refused.length, reasons: out.refused.map(r => r.reason) });
  // node.json "wikiLetters": re-render the wiki as letters when a page changed.
  if (store.readNode(e.dir).wikiLetters && out.records.some(r => /^(wiki\.|letterhead\.)/.test(r.kind) || (r.kind === 'wiki.edit'))) {
    try {
      const { spawn } = await import('node:child_process');
      spawn(process.execPath, [new URL('./index.js', import.meta.url).pathname, 'letter', 'wiki', '--pdf', '--dir', e.dir], { detached: true, stdio: 'ignore' }).unref();
    } catch { /* rendering is a convenience; the record is what counts */ }
  }
  // A decision may just have installed a module: fetch its code now.
  const after = out.records.some(r => r.kind === 'module.installed') ? await bringModules(e) : { installed: [], failed: [] };
  const published = out.records.length && publish ? await publishAfterSettle(e, { wait: publish === 'wait' }) : null;
  return { ...out, fetched: { installed: [...fetched.installed, ...after.installed], failed: [...fetched.failed, ...after.failed] }, published, waiting: early };
}

export async function fullVerify(e) {
  return verifyRecords(e.registry, e.records, e.damage, { views: e.views || e.records, sealer: e.ring || null });
}

// Sign an epoch.open as this copy's member, keeping the new key in the keyring;
// written to pending and returned as { act, file }.
export async function openKeyPeriod(e, state = e.state) {
  if (!e.me || !e.ring) return null;
  const { E, fields } = await S.newEpoch(state, { ring: e.ring });
  const act = await signAct(e.registry, draft('epoch.open', { entity: state.entity.id, by: e.me, at: now(), ...fields }), loadKey(state.entity.id, e.me));
  e.ring.remember(fields.n, E);
  return { act, file: store.writePending(e.dir, act) };
}

// Publish this member's record key, if sealing is on and they have none yet.
// Dated just before the earliest act waiting (never before the head), so it
// settles first and a key period can be opened for those acts.
// A newcomer's copy cannot open what was sealed before them, so it may hold only
// part of the state: it can still publish its key (settlement checks the rest).
export async function publishRecordKey(e, waiting = []) {
  if (!e.me || !S.sealingOn(e.state)) return null;
  if (!e.unreadable && (e.state.participants[e.me]?.status !== 'active' || S.sealingState(e.state).keys[e.me])) return null;
  const k = loadKey(e.state.entity.id, e.me);
  const pk = (await S.recordKeyFromSeed(k.seed)).pk;
  const first = waiting.map(a => Date.parse(a.at)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const head = e.state.head.at ? Date.parse(e.state.head.at) : 0;
  const at = first ? new Date(Math.max(head, first - 1)).toISOString() : now();
  const act = await signAct(e.registry, draft('member.recordkey', { entity: e.state.entity.id, by: e.me, at, key: S.cryptoB64(pk) }), k);
  return { act, file: store.writePending(e.dir, act) };
}

export const out = (...a) => console.log(...a);
