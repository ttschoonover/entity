import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { verifyAct, actHash } from '../../kernel/index.js';
import { build as buildSite, renderIndex, island, lawIndex } from '../../interface/build.js';
import { openEntity, out, settlePending } from '../context.js';
import { bundleOf, absorbInto } from '../net.js';
import { emit } from '../events.js';
import { available, packSource, prepareModule } from '../modules.js';

export async function build({ opt }) {
  const e = await openEntity(opt);
  const dir = buildSite(e.dir, path.resolve(opt.out || path.join(e.dir, 'site')), e.state);
  out(`site built in ${dir}. Serve it over HTTPS from any folder; every link is relative.`);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.yml': 'text/plain; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8', '.pub': 'text/plain', '.md': 'text/plain; charset=utf-8' };

// A node: serves the page, the record and the code, and accepts signed acts.
// Anyone may POST an act: the signature is the authority, and settlement
// checks it again. With --settle, it settles on receipt; that is automation of
// something any participant can reproduce exactly, so it holds no authority.
export async function serve({ opt }) {
  let e;
  try { e = await openEntity(opt); }
  catch (x) { console.error(`warning: ${x.message}\nServing anyway, so participants can see the problem for themselves.`); e = await store.open((await import('../context.js')).entityDir(opt)); e.params = null; }
  const port = Number(opt.port || store.readNode(e.dir).port || 7780);
  const auto = !!opt.settle;
  const map = [['/interface/js/', 'interface/js/'], ['/kernel/', 'kernel/'], ['/modules/', 'modules/'], ['/record/', 'record/'], ['/law/', 'law/']];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true' };
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...cors });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const body = (req) => new Promise((ok, bad) => { let d = ''; req.on('data', c => { d += c; if (d.length > 32e6) req.destroy(); }); req.on('end', () => ok(d)); req.on('error', bad); });
  let live = 0;
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = decodeURIComponent(url.pathname);
      if (req.method === 'OPTIONS') return send(res, 204, '');
      // Modules, from the page: what the entity's module source offers, and a
      // proposal to install or upgrade one (fetched and checked here, signed by
      // the member in their browser). Off with "modulesOnline": false in node.json.
      if (p === '/modules/available' || p === '/modules/prepare') {
        return serial(async () => {
          try {
            e = await openEntity(opt);
            if (store.readNode(e.dir).modulesOnline === false) return send(res, 403, JSON.stringify({ error: 'this node does not prepare modules from the page' }), 'application/json');
            if (p === '/modules/available') {
              const from = packSource(e.dir);
              if (!from) return send(res, 200, JSON.stringify({ source: null, modules: [] }), 'application/json');
              const list = await available(e.dir, from);
              const installed = new Set(store.installedModules(e.dir));
              return send(res, 200, JSON.stringify({ source: from, modules: list.map(m => ({ ...m, installed: installed.has(m.name) })) }), 'application/json');
            }
            if (req.method !== 'POST') return send(res, 405, '');
            const { name, mode } = JSON.parse(await body(req) || '{}');
            const r = await prepareModule(e, name, mode === 'upgrade' ? 'upgrade' : 'add');
            return send(res, 200, JSON.stringify(r), 'application/json');
          } catch (x) { return send(res, 400, JSON.stringify({ error: x.message }), 'application/json'); }
        });
      }
      if (req.method === 'POST' && p === '/acts') {
        const got = JSON.parse(await body(req));
        const acts = Array.isArray(got) ? got : [got];
        return serial(async () => {
          e = await openEntity(opt);
          const accepted = [], refused = [];
          for (const a of acts) {
            const def = e.registry.get(a && a.kind);
            const keys = def?.selfSigned ? [a.key] : e.state.participants[a?.by]?.keys;
            if (!def) { refused.push({ hash: null, why: `unknown kind ${a && a.kind}` }); continue; }
            if (!keys) { refused.push({ hash: actHash(a), why: `${a.by} is not on the register` }); continue; }
            const v = await verifyAct(e.registry, a, keys);
            if (!v.ok) { refused.push({ hash: actHash(a), why: `signature invalid: ${v.error}` }); continue; }
            store.writePending(e.dir, a); accepted.push(actHash(a));
            emit(e.dir, 'act', { kind: a.kind, by: a.by });
          }
          let settled = false;
          if (auto && accepted.length) {
            const r = await settlePending(e, { publish: 'background' });
            for (const x of r.refused) if (accepted.includes(x.hash)) refused.push({ hash: x.hash, why: x.reason });
            settled = true;
          }
          send(res, refused.length && !accepted.length ? 422 : 200, { accepted, refused, settled });
        });
      }
      // A checkpoint made or co-signed in a page. Kept only if it matches this
      // copy's record and chain; only signatures that verify are kept.
      if (req.method === 'POST' && p === '/checkpoints') {
        const cp = JSON.parse(await body(req));
        return serial(async () => {
          e = await openEntity(opt);
          const { mergeCheckpoint, checkpointStatus } = await import('../../kernel/index.js');
          const r = await mergeCheckpoint(store.readCheckpoints(e.dir), cp, e.state, e.records);
          if (r.why) return send(res, 422, { why: r.why });
          store.writeCheckpoints(e.dir, [r.checkpoint]);
          emit(e.dir, 'checkpoint', { number: r.checkpoint.number });
          const st = await checkpointStatus(r.checkpoint, e.state, e.params.value('record.checkpoint_cosigners'), e.records);
          send(res, 200, { number: r.checkpoint.number, added: r.added, binding: st.binding, signed: st.valid });
        });
      }
      // The core, by decision: what is staged, fetching the configured source,
      // and installing it once a decision approves exactly it.
      if (p === '/upgrade' && req.method === 'GET') {
        e = await openEntity(opt);
        const up = await import('../upgrade.js');
        const { sourceOf } = await import('./upgrade.js');
        const m = up.staged(e.dir);
        return send(res, 200, { source: sourceOf(e.dir), current: JSON.parse(fs.readFileSync(path.join(e.dir, 'package.json'), 'utf8')).version,
          staged: m, proposal: m ? up.proposal(m) : null, approvedBy: m ? up.approvedBy(e.state, m)?.id || null : null });
      }
      if (req.method === 'POST' && (p === '/upgrade/check' || p === '/upgrade/apply')) {
        return serial(async () => {
          e = await openEntity(opt);
          const up = await import('../upgrade.js');
          const { sourceOf } = await import('./upgrade.js');
          try {
            if (p === '/upgrade/check') {
              const source = sourceOf(e.dir);
              if (!source) return send(res, 409, { why: 'no upgrade source is set: add "upgrade": { "source": "…" } to node.json' });
              const m = up.check(e.dir, source, e.params);
              return send(res, 200, { staged: m.paths.length ? m : null, proposal: m.paths.length ? up.proposal(m) : null, current: m.from });
            }
            const r = up.apply(e.dir, e.state);
            send(res, 200, { ...r, restart: true });
            out(`installed entity ${r.version}, permitted by decision ${r.decision}. Restart this node to run it.`);
          } catch (x) { send(res, 422, { why: x.message }); }
        });
      }
      if (req.method === 'POST' && p === '/bundle') {
        const b = JSON.parse(await body(req));
        return serial(async () => {
          e = await openEntity(opt);
          const plan = await absorbInto(e, b);
          if (auto && plan.action !== 'refused' && plan.action !== 'diverged') await settlePending(e);
          send(res, plan.action === 'refused' || plan.action === 'diverged' ? 409 : 200, { action: plan.action, added: plan.added || 0, why: plan.why || null });
        });
      }
      if (req.method !== 'GET') return send(res, 405, { why: 'method not allowed' });
      // Presence: each open page holds this stream. Opening it is a visit;
      // closing the page closes it. Nothing about the visitor is recorded.
      if (p === '/presence') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
        live++;
        emit(e.dir, 'visit', { live });
        res.write(`data: ${live}\n\n`);
        const beat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
        req.on('close', () => { clearInterval(beat); live--; emit(e.dir, 'leave', { live }); });
        return;
      }
      if (p === '/bundle') { e = await openEntity(opt); return send(res, 200, bundleOf(e)); }
      if (p === '/' || p === '/index.html') {
        // Serve the page even for a copy that does not verify: each
        // participant's own verifier must be the one to raise the alarm.
        const raw = await store.open(e.dir);
        let data;
        // node.json "look": the look this node shows until a viewer picks their own.
        try { data = island(raw.state, { node: true, installed: store.installedModules(e.dir), look: store.readNode(e.dir).look || null, colour: store.readNode(e.dir).colour || null }); }
        catch {
          const first = raw.records[0]?.payload?.act;
          data = { id: first?.entity || null, name: 'This copy cannot be read', modules: store.installedModules(e.dir), node: true };
        }
        return send(res, 200, renderIndex(fs.readFileSync(path.join(e.dir, 'interface/index.html'), 'utf8'), data), TYPES['.html']);
      }
      if (p === '/law/index.json') return send(res, 200, JSON.stringify(lawIndex(e.dir)));
      if (p === '/interface/style.css') return send(res, 200, fs.readFileSync(path.join(e.dir, 'interface/style.css')), TYPES['.css']);
      for (const [pre, real] of map) {
        if (!p.startsWith(pre)) continue;
        const f = path.resolve(e.dir, real, p.slice(pre.length));
        if (!f.startsWith(path.resolve(e.dir, real))) return send(res, 403, { why: 'outside the served tree' });
        if (/[\\/](store|compose)\.js$/.test(f)) return send(res, 404, { why: 'not for browsers' });
        if (p.startsWith('/record/') && /\/(attestations|checkpoints)\/index\.json$/.test(p) && !fs.existsSync(f)) return send(res, 200, '[]');
        if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, { why: 'not found' });
        return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
      }
      send(res, 404, { why: 'not found' });
    } catch (x) { send(res, 400, { why: x.message }); }
  });
  await new Promise(r => server.listen(port, opt.host || '127.0.0.1', r));
  out(`${e.params ? e.params.value('entity.name') : 'An unreadable copy'} is served at http://localhost:${port}/${auto ? ' (settling acts on receipt)' : ''}`);
  out('POST /acts accepts signed acts; GET /bundle and POST /bundle carry the whole record.');
  // A validator's node may sign checkpoints on its own: node.json
  //   "finality": { "signAs": "ID", "everyMinutes": 60 }
  // signs any open checkpoint it has not signed, and opens one at the head
  // once there are new records and the last final checkpoint is that old.
  const fin = store.readNode(e.dir).finality;
  if (fin?.signAs && auto) {
    const every = Math.max(1, Number(fin.everyMinutes || 60));
    const tick = () => serial(async () => {
      try {
        e = await openEntity(opt);
        if (!e.params.value('entity.modules').includes('finality')) return;
        const F = (await import('../../modules/finality/index.js')).default;
        const now = new Date().toISOString(), o = F.isOpen(e.state, now), last = F.lastFinal(e.state);
        const mine = o && o.roll[fin.signAs] && !o.signed[fin.signAs];
        const due = !o && e.records.length > (last?.count || 0) && (!last || Date.parse(now) - Date.parse(last.at) >= every * 60000);
        if (!mine && !due) return;
        const fields = o ? { number: o.number, count: o.count, head: o.head } : { number: (last?.number || 0) + 1, count: e.state.head.seq, head: e.state.head.hash };
        const { signed } = await import('../context.js');
        store.writePending(e.dir, await signed(e, 'checkpoint.sign', fields, { ...opt, as: fin.signAs }));
        const r = await settlePending(e);
        if (r.applied.length) out(`signed checkpoint ${fields.number} at record ${fields.count} as ${fin.signAs}`);
      } catch (x) { out(`finality: ${x.message}`); }
    });
    setInterval(tick, Math.min(every, 10) * 60000).unref();
    setTimeout(tick, 5000).unref();
    out(`signing checkpoints as ${fin.signAs} when due (every ${every} minutes at most)`);
  }
  return server;
}
