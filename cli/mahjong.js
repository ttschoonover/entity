// mahjong.js · live mahjong tables, kept by this node for the mahjong module.
//
// A world's tables are played here, in real time, and recorded on the world's
// record once a match ends. Nobody needs an account: a browser makes its own
// key, and a seat belongs to whoever holds the key that took it. Members can
// sit as themselves instead, and their results go on their profile.
//
// Fairness without trusting the node with outcomes: every hand's wall comes
// from a seed derived from a secret only this node knows. Before a hand is
// dealt, the node publishes the seed's hash (the commitment); when the hand
// ends, it publishes the seed. Any browser can then check the commitment and
// replay the hand: the wall, every AI move and every score. The node could see
// hands while they are played (it deals them), so play with a host you trust
// not to peek, as at any table; it can never change a wall after committing.
//
//   GET  /mahjong/tables                     open and running tables
//   POST /mahjong/tables   { title, rules, seats: ['open' | 1–5 …], level }
//   POST /mahjong/sit      { table, seat, name, key, id?, sig }        → { token }
//   POST /mahjong/start    { table, token }        fills empty seats with AIs, deals
//   GET  /mahjong/view?table=&token=              your view (your tiles); without a token, a spectator's
//   POST /mahjong/move     { table, token, n, action, sig }
//   POST /mahjong/ready    { table, token }        ready for the next hand
//   GET  /mahjong/sheet?table=                    seeds, commitments and decisions so far: replay it yourself
//   GET  /mahjong/events?table=                   server-sent events: "update" when anything changes
//
// Signatures use namespace entity.mahjong over:
//   mahjong.sit   \n entity \n table \n seat \n name \n key
//   mahjong.move  \n entity \n table \n seat \n n \n canonical(action)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openEntity, keyDir, settlePending } from './context.js';
import { keys, canonical, draft, signAct, actHash } from '../kernel/index.js';
import { hash } from '../kernel/hash.js';
import * as store from '../kernel/store.js';

export const NS = 'entity.mahjong';
export const sitMaterial = (x) => ['mahjong.sit', x.entity, x.table, x.seat, x.name, x.key].join('\n');
export const moveMaterial = (x) => ['mahjong.move', x.entity, x.table, x.seat, x.n, canonical(x.action)].join('\n');
const ID = /^[a-z0-9][a-z0-9-]{2,59}$/;
// MAHJONG_PACE_MS and MAHJONG_BETWEEN_SECONDS shorten the pauses, for tests.
const CLAIM_SECONDS = 15, TURN_SECONDS = 90, MAX_TABLES = 60;
const BETWEEN_SECONDS = Number(process.env.MAHJONG_BETWEEN_SECONDS || 25), AI_PACE_MS = Number(process.env.MAHJONG_PACE_MS || 700);

export function mahjongNode(opt) {
  let E = null; // the engine, loaded from this entity's installed module
  const tables = new Map(); // id → { t (stored), m (live match), timers, clients:Set, version }
  let e = null, dir = null;

  // The entity, refolded only when its record has grown (as chat does).
  let size = -1;
  const sizeOf = (d) => { try { return fs.statSync(store.P(d).events).size; } catch { return 0; } };
  async function current() {
    if (!e || sizeOf(dir) !== size) { e = await openEntity(opt); dir = e.dir; size = sizeOf(dir); }
    return e;
  }
  async function ready() {
    await current();
    if (!E) {
      const installed = path.join(dir, 'modules', 'mahjong', 'engine', 'index.js');
      const src = fs.existsSync(installed) ? installed : path.join(store.CODE_ROOT, 'library', 'mahjong', 'engine', 'index.js');
      E = await import(pathToFileURL(src).href);
    }
    return e;
  }
  const on = async () => { const x = await current(); return !!x.params && x.params.value('entity.modules').includes('mahjong'); };
  const folder = () => path.join(dir, '.entity', 'mahjong');
  const file = (id) => path.join(folder(), `${id}.json`);
  const save = (T) => { fs.mkdirSync(folder(), { recursive: true }); fs.writeFileSync(file(T.t.id), JSON.stringify(T.t, null, 1)); };
  const rulesOf = (r = {}) => ({ ...E.DEFAULT_RULES, ...r, maxHands: 8 * (r.rounds || 1) });
  const seedOf = (t, i) => hash(`${t.secret}:${i}`);

  // Rebuild a table's live match from its seeds and decisions (deterministic).
  function live(t) {
    const seats = t.seats.map(s => (s.type === 'ai' ? s.level : 'human'));
    if (t.status === 'waiting') return null;
    const seeds = Array.from({ length: t.dealt }, (_, i) => seedOf(t, i));
    const r = E.replay({ rules: rulesOf(t.rules), seats, names: t.seats.map(s => s.name), seeds, moves: t.moves.map(q => q.map(x => x.action)) });
    if (r.error) throw new Error(`table ${t.id} no longer replays: ${r.error}`);
    return r.match;
  }
  function load(id) {
    if (tables.has(id)) return tables.get(id);
    if (!ID.test(id) || !fs.existsSync(file(id))) return null;
    const t = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    const T = { t, m: null, timers: {}, clients: new Set(), version: 0, chain: Promise.resolve() };
    T.m = live(t);
    tables.set(id, T);
    if (t.status === 'playing' || t.status === 'between') setTimeout(() => step(T), 50);
    return T;
  }
  const all = () => { try { return fs.readdirSync(folder()).filter(f => f.endsWith('.json')).map(f => load(f.slice(0, -5))).filter(Boolean); } catch { return []; } };
  const serial = (T, fn) => (T.chain = T.chain.then(fn, fn));

  // ── what each person may see ─────────────────────────────────────────────
  const seatOfToken = (T, token) => (token ? T.t.seats.findIndex(s => s.token && s.token === hash(`token:${token}`)) : -1);
  function publicTable(T) {
    const t = T.t;
    return { id: t.id, title: t.title, created: t.created, status: t.status, rules: t.rules,
      seats: t.seats.map(s => ({ type: s.type, level: s.level, name: s.name, taken: !!s.key, member: s.id || null })),
      scores: T.m?.scores || [0, 0, 0, 0], hand: T.m ? T.m.handNo : 0, commits: t.commits, seeds: t.seeds, recorded: t.recorded || null };
  }
  function viewFor(T, seat) {
    const v = T.m ? E.view(T.m, seat >= 0 ? seat : 99) : null;
    return { table: publicTable(T), seat, view: v, n: seat >= 0 ? T.t.moves[seat].length : null,
      deadline: T.deadline || null, readyFor: T.t.status === 'between' ? T.t.ready : null };
  }
  function bump(T) {
    T.version++;
    for (const res of T.clients) { try { res.write(`event: update\ndata: ${T.version}\n\n`); } catch { T.clients.delete(res); } }
  }

  // ── the game loop ────────────────────────────────────────────────────────
  const clear = (T) => { for (const k of Object.keys(T.timers)) { clearTimeout(T.timers[k]); delete T.timers[k]; } T.deadline = null; };
  function deal(T) {
    const t = T.t, i = t.dealt;
    t.commits[i] = hash(seedOf(t, i));
    E.startHand(T.m, seedOf(t, i));
    t.dealt++; t.status = 'playing'; t.ready = [];
  }
  // After any change: reveal a finished hand's seed, let an AI move, or wait for a person.
  function step(T) {
    clear(T);
    const t = T.t, m = T.m;
    if (!m) return;
    if (m.phase === 'between' || m.phase === 'over') {
      if (t.seeds.length < t.dealt) t.seeds = Array.from({ length: t.dealt }, (_, i) => seedOf(t, i));
      if (m.phase === 'over') { t.status = 'over'; save(T); bump(T); record(T).catch(x => console.error(`mahjong: could not record ${t.id}: ${x.message}`)); return; }
      t.status = 'between'; save(T); bump(T);
      T.deadline = Date.now() + BETWEEN_SECONDS * 1000;
      T.timers.next = setTimeout(() => serial(T, () => { deal(T); save(T); step(T); }), BETWEEN_SECONDS * 1000);
      return;
    }
    const waiting = E.pending(m);
    const ai = waiting.filter(s => t.seats[s].type === 'ai');
    if (ai.length) {
      T.timers.ai = setTimeout(() => serial(T, () => {
        const s = E.pending(T.m).find(x => t.seats[x].type === 'ai');
        if (s !== undefined) E.act(T.m, s, E.choose(T.m, s, t.seats[s].level));
        save(T); bump(T); step(T);
      }), waiting.some(s => t.seats[s].type !== 'ai') ? 0 : AI_PACE_MS);
      return;
    }
    // People must decide. If they take too long, the table decides for them.
    const claim = m.hand.stage === 'claim';
    const secs = claim ? CLAIM_SECONDS : TURN_SECONDS;
    T.deadline = Date.now() + secs * 1000;
    T.timers.idle = setTimeout(() => serial(T, () => {
      for (const s of E.pending(T.m)) {
        if (t.seats[s].type === 'ai') continue;
        const opts = E.options(T.m, s);
        const a = claim ? { type: 'pass' } : (T.m.hand.drawn && opts.find(o => o.type === 'discard' && o.tile === T.m.hand.drawn)) || opts.filter(o => o.type === 'discard').at(-1);
        E.act(T.m, s, a); t.moves[s].push({ action: a, auto: true });
        if (T.m.phase !== 'play') break;
      }
      save(T); bump(T); step(T);
    }), secs * 1000);
    save(T); bump(T);
  }

  // A finished match goes on the world's record, signed by its keeper.
  async function record(T) {
    const t = T.t;
    if (t.recorded) return;
    const x = await current();
    const keeper = (x.params.has('mahjong.keeper') && x.params.value('mahjong.keeper')) || x.state.entity.founder;
    const kf = path.join(keyDir(x.state.entity.id), keeper);
    if (!fs.existsSync(kf)) { t.recorded = { skipped: `no key for the keeper ${keeper} on this node: the sheet is kept at .entity/mahjong/${t.id}.json` }; save(T); bump(T); return; }
    const key = keys.importPrivateKey(fs.readFileSync(kf, 'utf8'));
    const fields = { table: t.id, seats: t.seats.map(s => (s.type === 'ai' ? s.level : 'human')), names: t.seats.map(s => s.name),
      players: t.seats.map(s => (s.type === 'ai' ? null : s.id ? { id: s.id, name: s.name } : { name: s.name, key: s.key })),
      rules: t.rules, seeds: t.seeds, commits: t.commits, moves: t.moves.map(q => q.map(m => m.action)) };
    const a = await signAct(x.registry, draft('mahjong.result', { entity: x.state.entity.id, by: keeper, at: new Date().toISOString(), ...fields }), key);
    store.writePending(x.dir, a);
    const r = await settlePending(x, { publish: 'background' });
    const refused = r.refused.find(f => f.hash === actHash(a));
    t.recorded = refused ? { refused: refused.reason } : { at: new Date().toISOString() };
    save(T); bump(T);
  }

  // ── requests ─────────────────────────────────────────────────────────────
  async function handle(req, res, p, { body, send, cors }) {
    if (!p.startsWith('/mahjong/')) return false;
    if (!(await on())) return send(res, 404, { why: 'the mahjong module is not enabled here' }), true;
    await ready();
    const url = new URL(req.url, 'http://x');
    const q = (k) => url.searchParams.get(k);
    let input = {};
    if (req.method === 'POST') { try { input = JSON.parse((await body(req)) || '{}'); } catch { return send(res, 400, { why: 'the request is not JSON' }), true; } }
    const T = (input.table || q('table')) ? load(input.table || q('table')) : null;
    const need = () => { if (!T) { send(res, 404, { why: 'there is no such table' }); return false; } return true; };

    if (p === '/mahjong/tables' && req.method === 'GET') {
      return send(res, 200, { tables: all().map(publicTable).sort((a, b) => (a.created < b.created ? 1 : -1)).slice(0, 100) }), true;
    }
    if (p === '/mahjong/tables' && req.method === 'POST') {
      const open = all().filter(x => x.t.status !== 'over').length;
      if (open >= MAX_TABLES) return send(res, 429, { why: 'too many tables are open here; finish one first' }), true;
      const err = (await import(pathToFileURL(path.join(store.CODE_ROOT, 'library', 'mahjong', 'index.js')).href)).checkRules(input.rules || {});
      if (err) return send(res, 400, { why: err }), true;
      const seats = Array.isArray(input.seats) && input.seats.length === 4 ? input.seats : ['open', 'open', 3, 3];
      if (!seats.every(s => s === 'open' || (Number.isInteger(s) && s >= 1 && s <= 5))) return send(res, 400, { why: 'a seat is "open" (for a person) or an AI level 1–5' }), true;
      const title = String(input.title || 'A table').slice(0, 60);
      const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'table'}-${crypto.randomBytes(3).toString('hex')}`;
      const t = { id, title, created: new Date().toISOString(), rules: input.rules || {}, level: Number.isInteger(input.level) ? Math.min(5, Math.max(1, input.level)) : 3,
        seats: seats.map((s, i) => (s === 'open' ? { type: 'human', name: '' } : { type: 'ai', level: s, name: `AI ${['East', 'South', 'West', 'North'][i]}` })),
        status: 'waiting', secret: crypto.randomBytes(32).toString('hex'), dealt: 0, commits: [], seeds: [], moves: [[], [], [], []], ready: [] };
      const N = { t, m: null, timers: {}, clients: new Set(), version: 0, chain: Promise.resolve() };
      tables.set(id, N); save(N);
      return send(res, 200, { table: publicTable(N) }), true;
    }
    if (p === '/mahjong/sit' && req.method === 'POST') {
      if (!need()) return true;
      return serial(T, async () => {
        const t = T.t, seat = Number(input.seat), s = t.seats[seat];
        if (!s || s.type !== 'human') return send(res, 400, { why: 'that seat is not for a person' });
        if (s.key && s.key !== input.key) return send(res, 409, { why: 'that seat is taken' });
        const name = String(input.name || '').trim().slice(0, 24);
        if (!name) return send(res, 400, { why: 'give a name for the table' });
        const v = await keys.verify(sitMaterial({ entity: e.state.entity.id, table: t.id, seat, name, key: input.key }), input.sig, [input.key], NS);
        if (!v.ok) return send(res, 401, { why: `the signature does not check: ${v.error}` });
        if (input.id) {
          const pp = e.state.participants[input.id];
          if (!pp || !pp.keys.includes(keys.keyId(input.key))) return send(res, 401, { why: `${input.id} is not a member with that key` });
        }
        if (t.seats.some((x, i) => i !== seat && x.key === input.key)) return send(res, 409, { why: 'you already have a seat at this table' });
        const token = crypto.randomBytes(24).toString('hex');
        Object.assign(s, { key: input.key, name, id: input.id || null, token: hash(`token:${token}`) });
        save(T); bump(T);
        send(res, 200, { token, seat });
      }), true;
    }
    if (p === '/mahjong/start' && req.method === 'POST') {
      if (!need()) return true;
      return serial(T, async () => {
        const t = T.t, seat = seatOfToken(T, input.token);
        if (seat < 0) return send(res, 401, { why: 'take a seat first' });
        if (t.status !== 'waiting') return send(res, 409, { why: 'the game has already started' });
        t.seats.forEach((s, i) => { if (s.type === 'human' && !s.key) Object.assign(s, { type: 'ai', level: t.level, name: `AI ${['East', 'South', 'West', 'North'][i]}` }); });
        T.m = E.newMatch({ rules: rulesOf(t.rules), seats: t.seats.map(s => (s.type === 'ai' ? s.level : 'human')), names: t.seats.map(s => s.name) });
        deal(T); save(T); step(T);
        send(res, 200, { ok: true });
      }), true;
    }
    if (p === '/mahjong/view' && req.method === 'GET') {
      if (!need()) return true;
      return send(res, 200, viewFor(T, seatOfToken(T, q('token')))), true;
    }
    if (p === '/mahjong/move' && req.method === 'POST') {
      if (!need()) return true;
      return serial(T, async () => {
        const t = T.t, seat = seatOfToken(T, input.token);
        if (seat < 0) return send(res, 401, { why: 'this browser holds no seat here' });
        if (t.status !== 'playing') return send(res, 409, { why: 'no hand is being played' });
        if (Number(input.n) !== t.moves[seat].length) return send(res, 409, { why: 'that move is out of date: the table has moved on' });
        const v = await keys.verify(moveMaterial({ entity: e.state.entity.id, table: t.id, seat, n: t.moves[seat].length, action: input.action }), input.sig, [t.seats[seat].key], NS);
        if (!v.ok) return send(res, 401, { why: `the signature does not check: ${v.error}` });
        try { E.act(T.m, seat, input.action); } catch (x) { return send(res, 422, { why: x.message }); }
        t.moves[seat].push({ action: input.action, sig: input.sig });
        step(T);
        send(res, 200, { ok: true });
      }), true;
    }
    if (p === '/mahjong/ready' && req.method === 'POST') {
      if (!need()) return true;
      return serial(T, async () => {
        const t = T.t, seat = seatOfToken(T, input.token);
        if (seat < 0 || t.status !== 'between') return send(res, 409, { why: 'nothing to be ready for' });
        if (!t.ready.includes(seat)) t.ready.push(seat);
        const people = t.seats.map((s, i) => (s.type === 'human' ? i : -1)).filter(i => i >= 0);
        if (people.every(i => t.ready.includes(i))) { clear(T); deal(T); save(T); step(T); } else { save(T); bump(T); }
        send(res, 200, { ok: true });
      }), true;
    }
    if (p === '/mahjong/sheet' && req.method === 'GET') {
      if (!need()) return true;
      const t = T.t, revealed = t.seeds.length;
      // Decisions so far, but only for hands whose seeds are public: nothing here gives away a live hand.
      return send(res, 200, { table: t.id, rules: rulesOf(t.rules), seats: t.seats.map(s => (s.type === 'ai' ? s.level : 'human')), names: t.seats.map(s => s.name),
        commits: t.commits, seeds: t.seeds, moves: revealed === t.dealt ? t.moves.map(q => q.map(x => x.action)) : null, complete: t.status === 'over' }), true;
    }
    if (p === '/mahjong/events' && req.method === 'GET') {
      if (!need()) return true;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
      res.write(`event: update\ndata: ${T.version}\n\n`);
      T.clients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 25000);
      req.on('close', () => { clearInterval(ping); T.clients.delete(res); });
      return true;
    }
    return send(res, 404, { why: 'no such mahjong address' }), true;
  }
  return { handle };
}
