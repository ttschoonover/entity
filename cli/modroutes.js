// modroutes.js · a module's own server routes, at /m/<module>/…
//
// A module may ship server.js next to its index.js:
//
//   export async function handle(ctx) { … return true if it answered }
//
// It is part of the module's code, so its digest is the one the record approved,
// and it runs only while the module is enabled. The node's gate has already run
// (a private node lets in only members and, on a house hub, the house), so a
// route decides only who among those may see what, from ctx.who.
//
// ctx:
//   path      the address after /m/<module>, starting with /
//   method, query (URLSearchParams), req, res
//   json()    the request body, parsed
//   send(code, body, type?)   answer; an object is sent as JSON
//   entity()  the republic, freshly read: { state, params, registry, records, dir }
//   who       { member: id or null, house: true when let in by the house network or password }
//   inSpec(list, id)  is id in a list of ids and specs ("office:admin", "founder", "members")
//   submit(acts)      send signed acts as /acts would: { accepted, refused, settled }
//   dir       the republic's folder
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cache = new Map();   // file → { mtime, mod }

async function load(file) {
  const mtime = fs.statSync(file).mtimeMs, hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.mod;
  const mod = await import(`${pathToFileURL(file).href}?v=${mtime}`);
  cache.set(file, { mtime, mod });
  return mod;
}

// Answer /m/<module>/… if that module is enabled and has server.js. Returns
// true when answered.
export async function route(p, base) {
  const m = p.match(/^\/m\/([a-z0-9][a-z0-9-]{0,39})(\/.*)?$/);
  if (!m) return false;
  const [, name, rest = '/'] = m;
  const e = await base.entity();
  const enabled = e.params ? e.params.value('entity.modules') : [];
  const file = path.join(base.dir, 'modules', name, 'server.js');
  if (!enabled.includes(name) || !fs.existsSync(file)) { base.send(404, { why: 'no such address' }); return true; }
  const mod = await load(file);
  if (typeof mod.handle !== 'function') { base.send(404, { why: 'no such address' }); return true; }
  const answered = await mod.handle({ ...base, path: rest, entity: base.entity });
  if (!answered) base.send(404, { why: 'no such address' });
  return true;
}
