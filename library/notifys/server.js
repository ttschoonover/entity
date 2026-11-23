// notifys/server.js · what the site reads, at /m/notifys/… (see cli/modroutes.js).
// Writing is always a signed act sent to /acts; these routes only read.
//
//   GET /houses        the houses, for the application form (open before sign-in: node.json open_routes)
//   GET /me            who is asking, and what they may do
//   GET /alerts        the alerts this member receives, newest first
//   GET /house/<id>    an emergency manager's view of their house
//   GET /central       an admin's view of every house
//   GET /record?n=     an admin's view of the record, in words
import N from './index.js';

const people = (s) => s.order.map(id => s.participants[id]);
const nameOf = (s, id) => s.m?.titles?.[id] || s.participants[id]?.name || id;
const houses = (s) => Object.entries(s.m.notifys?.houses || {}).map(([id, h]) => ({ id, ...h }));

export async function handle(ctx) {
  if (ctx.method !== 'GET') return false;
  const e = await ctx.entity(), s = e.state, n = s.m.notifys || { houses: {}, central: [], residence: {}, alerts: [] };
  const me = ctx.who.member && s.participants[ctx.who.member]?.status === 'active' ? ctx.who.member : null;
  const send = (body, code = 200) => (ctx.send(code, body), true);
  const no = (why) => send({ why }, 403);
  const label = (to) => (to === 'central' ? 'Central' : n.houses[to]?.name || to);

  if (ctx.path === '/houses') return send({ houses: houses(s).map(h => ({ id: h.id, name: h.name })) });

  if (ctx.path === '/me') {
    if (!me) return send({ entity: s.entity.id, member: null });
    const house = N.houseOf(s, me);
    return send({
      entity: s.entity.id, member: me, display: nameOf(s, me), admin: N.isAdmin(s, me),
      house, houseName: house ? label(house) : null,
      manages: houses(s).filter(h => h.managers.includes(me)).map(h => ({ id: h.id, name: h.name })),
      sendsTo: ['central', ...houses(s).map(h => h.id)].filter(to => N.canSend(s, me, to)).map(to => ({ id: to, name: label(to) })),
      recordKey: s.sealing?.keys?.[me] || null,
    });
  }
  if (!me) return no('sign in first');

  if (ctx.path === '/alerts') {
    const mine = N.houseOf(s, me), all = N.isAdmin(s, me);
    const alerts = n.alerts.filter(a => a.to === 'central' || a.to === mine || all).slice(-200).reverse()
      .map(a => ({ ...a, from: nameOf(s, a.by), label: label(a.to) }));
    return send({ alerts });
  }

  let m;
  if ((m = ctx.path.match(/^\/house\/([a-z0-9][a-z0-9-]{0,39})$/))) {
    const id = m[1], h = n.houses[id];
    if (!h) return send({ why: 'no such house' }, 404);
    if (!N.canRun(s, me, id)) return no(`only an admin or ${h.name}'s emergency manager`);
    return send({
      house: { id, name: h.name },
      waiting: people(s).filter(p => p.status === 'applicant' && p.declared?.house === id).map(p => ({ id: p.id, name: nameOf(s, p.id), at: p.joined })),
      members: people(s).filter(p => p.status === 'active' && n.residence[p.id] === id).map(p => ({
        id: p.id, name: nameOf(s, p.id), manager: h.managers.includes(p.id), team: h.team.includes(p.id), admin: N.isAdmin(s, p.id) })),
    });
  }

  if (ctx.path === '/central') {
    if (!N.isAdmin(s, me)) return no('only admins');
    const active = people(s).filter(p => p.status === 'active');
    return send({
      houses: houses(s).map(h => ({ id: h.id, name: h.name, managers: h.managers.map(x => ({ id: x, name: nameOf(s, x) })),
        members: active.filter(p => n.residence[p.id] === h.id).length,
        waiting: people(s).filter(p => p.status === 'applicant' && p.declared?.house === h.id).length })),
      waiting: people(s).filter(p => p.status === 'applicant').map(p => ({ id: p.id, name: nameOf(s, p.id), house: p.declared?.house || null, houseName: p.declared?.house ? label(p.declared.house) : 'no house given' })),
      central: (n.central || []).map(x => ({ id: x, name: nameOf(s, x) })),
      admins: N.admins(s).map(x => ({ id: x, name: nameOf(s, x) })),
      people: active.map(p => ({ id: p.id, name: nameOf(s, p.id), house: label(n.residence[p.id]) })),
    });
  }

  if (ctx.path === '/record') {
    if (!N.isAdmin(s, me)) return no('only admins read the record');
    const all = e.views?.length ? e.views : e.records || [];
    const k = Math.min(Math.max(Number(ctx.query.get('n')) || 20, 1), 5000);
    const say = (r) => { const a = r.payload?.act || {}; return a.title || a.id || a.member || a.house || r.payload?.id || ''; };
    return send({ total: all.length, records: all.slice(-k).reverse().map(r => ({ at: r.at, kind: r.kind, by: r.author || '', what: String(say(r)).slice(0, 100) })) });
  }
  return false;
}
