// minihub/server.js · the hub's routes, at /m/minihub/… (see cli/modroutes.js).
//
//   GET /me              who is asking: member, house visitor, admin, sender; the hub's name
//   GET /wiki            every page: id, title, category, last edit
//   GET /wiki/<id>[?v=n] one page, at its latest version or version n
//   GET /alerts          members: the alerts, newest first
//   GET /admin           admins: who is asking to join, members, senders, the house
//   GET /record[?n=200]  admins: the latest records, in words
//
// Writing goes through /acts, signed in the browser: wiki.edit by a member,
// alert.send by a sender, authority.exercise under the "admin" grant by an admin.
import fs from 'node:fs';
import path from 'node:path';

const nodeOf = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8')); } catch { return {}; } };
const nameOf = (st) => (id) => st.m?.titles?.[id] || st.participants[id]?.name || id;
const latest = (p) => p.versions[p.versions.length - 1];

function what(r) {
  const a = r.payload?.act || {};
  switch (r.kind) {
    case 'wiki.edit': return a.page;
    case 'alert.send': return a.title;
    case 'participant.apply': return a.by;
    case 'authority.exercise': return (a.effects || []).map(x => `${x.kind}${x.id ? ` ${x.id}` : x.holder ? ` ${x.holder}` : x.members ? ` ${x.members.join(',')}` : ''}`).join('; ');
    case 'proposal.lay': return a.title || '';
    default: return r.payload?.id || r.payload?.holder || '';
  }
}

export async function handle(ctx) {
  const e = await ctx.entity(), st = e.state, node = nodeOf(ctx.dir);
  const me = ctx.who.member && st.participants[ctx.who.member]?.status === 'active' ? ctx.who.member : null;
  const admins = node.house?.admins?.length ? node.house.admins : ['founder'];
  const admin = me ? await ctx.inSpec(admins, me) : false;
  const senders = st.m.minihub?.senders || [];
  const name = nameOf(st);
  const deny = (why) => (ctx.send(403, { why }), true);
  if (ctx.method !== 'GET') return false;

  if (ctx.path === '/me') {
    return ctx.send(200, { entity: st.entity.id, name: node.house?.name || e.params.value('entity.name'), member: me, display: me ? name(me) : null,
      house: ctx.who.house, admin, sender: !!me && senders.includes(me), recordKey: me ? (st.sealing?.keys?.[me] || null) : null }), true;
  }

  if (ctx.path === '/wiki') {
    const pages = Object.values(st.m.wiki?.pages || {}).map(p => { const v = latest(p); return { id: p.id, title: v.title, category: v.category || '', at: v.at, by: name(v.by), n: v.n }; });
    pages.sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.title.localeCompare(b.title));
    return ctx.send(200, { pages }), true;
  }
  let m;
  if ((m = ctx.path.match(/^\/wiki\/([a-z0-9][a-z0-9-]{0,59})$/))) {
    const p = st.m.wiki?.pages?.[m[1]];
    if (!p) return ctx.send(404, { why: 'no such page' }), true;
    const n = Number(ctx.query.get('v')) || p.versions.length;
    const v = p.versions[n - 1];
    if (!v) return ctx.send(404, { why: 'no such version' }), true;
    return ctx.send(200, { id: p.id, title: v.title, category: v.category || '', body: v.body, n: v.n, latest: p.versions.length, at: v.at, by: name(v.by) }), true;
  }

  if (ctx.path === '/alerts') {
    if (!me) return deny('alerts are for members: sign in');
    const alerts = (st.m.minihub?.alerts || []).slice(-100).reverse().map(a => ({ ...a, by: name(a.by) }));
    return ctx.send(200, { alerts, sender: senders.includes(me) }), true;
  }

  if (ctx.path === '/admin') {
    if (!admin) return deny('only the hub\'s admins');
    const office = st.m.offices?.admin;
    const adminIds = new Set((office?.holders || []).filter(h => !h.until || h.until > new Date().toISOString()).map(h => h.id));
    const people = st.order.map(id => st.participants[id]);
    return ctx.send(200, {
      applicants: people.filter(p => p.status === 'applicant').map(p => ({ id: p.id, name: name(p.id), at: p.joined || null })),
      members: people.filter(p => p.status === 'active').map(p => ({ id: p.id, name: name(p.id), sender: senders.includes(p.id), admin: adminIds.has(p.id) })),
      seats: office?.seats || 0, grant: st.m.authority?.grants?.admin && !st.m.authority.grants.admin.revoked ? 'admin' : null,
    }), true;
  }

  if (ctx.path === '/record') {
    if (!admin) return deny('only the hub\'s admins read the record');
    const n = Math.min(Math.max(Number(ctx.query.get('n')) || 200, 1), 5000);
    const all = e.views?.length ? e.views : (e.records || []);
    const recs = all.map((r, i) => ({ seq: r.seq ?? i + 1, at: r.at, kind: r.kind, by: r.author || r.payload?.act?.by || '', what: String(what(r) || '').slice(0, 120) })).slice(-n).reverse();
    return ctx.send(200, { total: all.length, records: recs }), true;
  }
  return false;
}
