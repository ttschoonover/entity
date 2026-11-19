// The node side of documents (the docs module): it keeps the files and passes
// them on. It checks each file against the record before keeping it, but it
// cannot read an encrypted document, and pages trust none of what it serves:
// they check every file again.
//
//   GET  /docs/d/DOC        every file of a document: versions, comments, keys
//   GET  /docs/keys         members' encryption keys (xkey files)
//   GET  /docs/summary      for each document: how many files, and the newest time
//   POST /docs/file         a new file, signed in the page; kept if the record allows it
//   GET  /docs/events       a stream: event "file" { doc } whenever one arrives
//
// The files live in documents/ (documents/DOC/ID.json, documents/_keys/ID.json),
// inside the entity's repository, so Radicle carries them to every peer. They
// are content-addressed: a file is named by the hash of what it says.

import fs from 'node:fs';
import path from 'node:path';
import * as store from '../kernel/store.js';
import { keys } from '../kernel/index.js';
import { openEntity } from './context.js';
import { emit } from './events.js';
import { checkBlob, verifyBlob, blobId } from '../library/docs/index.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/, HEX = /^[0-9a-f]{64}$/;
const SKEW = 5 * 60000, LATE = 15 * 60000, RATE = 60, MAX = 1_200_000;
export const docsDir = (dir) => path.join(dir, 'documents');
const folder = (dir, doc) => path.join(docsDir(dir), doc === '_keys' ? '_keys' : doc);

// Every file in a folder, parsed; unreadable ones are skipped.
export function filesIn(dir, doc) {
  const d = folder(dir, doc);
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const n of fs.readdirSync(d)) {
    if (!/^[0-9a-f]{64}\.json$/.test(n)) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(d, n), 'utf8'))); } catch { /* skip */ }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}
// Keep a file, if it is new. Returns true when written.
export function keep(dir, blob) {
  const d = folder(dir, blob.type === 'xkey' ? '_keys' : blob.doc);
  const f = path.join(d, `${blob.id}.json`);
  if (fs.existsSync(f)) return false;
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(blob) + '\n'); fs.renameSync(f + '.tmp', f);
  return true;
}
const has = (dir, doc, id) => fs.existsSync(path.join(folder(dir, doc), `${id}.json`));

export function docsNode(opt) {
  let cache = { size: -1, e: null };
  const sizeOf = (dir) => { try { return fs.statSync(store.P(dir).events).size; } catch { return 0; } };
  const entity = async () => {
    const size = cache.e ? sizeOf(cache.e.dir) : -2;
    if (!cache.e || size !== cache.size) { cache.e = await openEntity(opt); cache.size = sizeOf(cache.e.dir); }
    return cache.e;
  };
  const on = (e) => !!e.params && e.params.value('entity.modules').includes('docs');
  const streams = new Set();
  const tell = (doc, b) => { for (const r of streams) r.write(`event: file\ndata: ${JSON.stringify({ doc, type: b.type, by: b.by })}\n\n`); };
  const recent = new Map();

  async function handle(req, res, p, { body, send, cors }) {
    if (!p.startsWith('/docs/')) return false;
    const e = await entity();
    if (!on(e)) { send(res, 404, { why: 'documents are not switched on here' }); return true; }

    if (req.method === 'GET' && p === '/docs/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...cors });
      res.write(': documents\n\n');
      streams.add(res);
      const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 25000);
      req.on('close', () => { clearInterval(beat); streams.delete(res); });
      return true;
    }
    if (req.method === 'GET' && p === '/docs/keys') { send(res, 200, { keys: filesIn(e.dir, '_keys') }); return true; }
    if (req.method === 'GET' && p === '/docs/summary') {
      const out = {}, root = docsDir(e.dir);
      if (fs.existsSync(root)) for (const d of fs.readdirSync(root)) {
        if (d === '_keys' || !ID.test(d)) continue;
        const fl = fs.readdirSync(path.join(root, d)).filter(n => n.endsWith('.json'));
        let last = 0;
        for (const n of fl) { try { last = Math.max(last, fs.statSync(path.join(root, d, n)).mtimeMs); } catch { /* skip */ } }
        out[d] = { files: fl.length, last: last ? new Date(last).toISOString() : null };
      }
      send(res, 200, { docs: out }); return true;
    }
    const m = p.match(/^\/docs\/d\/([a-z0-9-]{1,40})$/);
    if (req.method === 'GET' && m) { send(res, 200, { doc: m[1], files: filesIn(e.dir, m[1]) }); return true; }

    if (req.method === 'POST' && p === '/docs/file') {
      const raw = await body(req);
      if (raw.length > MAX) { send(res, 413, { why: 'that file is too large' }); return true; }
      let b; try { b = JSON.parse(raw); } catch { send(res, 400, { why: 'not JSON' }); return true; }
      if (!b || typeof b !== 'object' || Array.isArray(b)) { send(res, 400, { why: 'a file is an object' }); return true; }
      const id = blobId(b);
      if (b.id !== undefined && b.id !== id) { send(res, 400, { why: 'the file does not match its id' }); return true; }
      b.id = id;
      if (b.type !== 'xkey' && !ID.test(b.doc || '')) { send(res, 400, { why: 'which document?' }); return true; }
      const t = Date.parse(b.at), now = Date.now();
      if (!(t <= now + SKEW && t >= now - LATE)) { send(res, 400, { why: 'the file\'s time is not now: check this device\'s clock' }); return true; }
      const why = checkBlob(e.state, b, { have: (x) => HEX.test(x) && has(e.dir, b.doc, x) });
      if (why) { send(res, 403, { why }); return true; }
      if (!await verifyBlob(e.state, b, keys)) { send(res, 403, { why: 'the signature does not match the author\'s keys on the record' }); return true; }
      const times = (recent.get(b.by) || []).filter(x => x > now - 60000);
      if (times.length >= RATE) { send(res, 429, { why: 'too many changes at once: wait a moment' }); return true; }
      times.push(now); recent.set(b.by, times);
      const fresh = keep(e.dir, b);
      if (fresh) { tell(b.type === 'xkey' ? '_keys' : b.doc, b); emit(e.dir, 'docs.file', { doc: b.doc || '_keys', type: b.type, by: b.by }); }
      send(res, 200, { ok: true, id, fresh }); return true;
    }
    send(res, 404, { why: 'no such address' }); return true;
  }
  return { handle };
}
