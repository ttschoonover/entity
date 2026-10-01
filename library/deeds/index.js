// deeds · a register of things and who holds them: a room, a bike, a domain
// name, a key to the workshop. A deed is granted by decision (or by a holder of
// authority to grant it), to a participant or to the entity itself (holder:
// null). Its holder may pass it on, if the deed and the entity allow, or give
// it back.
//
// Transferability. deeds.transferability is
//   optional  each deed says, when granted, whether it may be passed on; unless
//             it says, it follows deeds.default_transferable
//   always    every deed may be passed on; a grant saying otherwise is refused
//   never     no deed may be passed on; deeds move only by decision
// The mode is read when a deed is passed on, so switching to "never" freezes
// every deed, including those granted as transferable. That is deliberate.

import { originOf } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const reg = (state) => (state.m.deeds = state.m.deeds || {});
const alive = (state, id) => state.participants[id] && ['active', 'applicant'].includes(state.participants[id].status);

export function mode(params) {
  if (params.has('deeds.transferability') && params.isSet('deeds.transferability')) return params.value('deeds.transferability');
  // An entity that set the 0.3 switch off keeps its meaning.
  if (params.has('deeds.transferable') && params.value('deeds.transferable') === false) return 'never';
  return params.has('deeds.transferability') ? params.value('deeds.transferability') : 'optional';
}

// Whether this deed may be passed on now, and if not, why not.
export function passable(deed, params) {
  const m = mode(params);
  if (m === 'never') return { ok: false, why: 'deeds pass between participants only by decision here' };
  if (m === 'always') return { ok: true };
  return deed.transferable === false ? { ok: false, why: 'this deed passes on only by decision' } : { ok: true };
}

function transferableWhy(e, params) {
  if (e.transferable === undefined) return null;
  if (typeof e.transferable !== 'boolean') return 'transferable is true or false';
  const m = mode(params);
  if (m === 'always' && !e.transferable) return 'every deed is transferable in this entity (deeds.transferability is "always")';
  if (m === 'never' && e.transferable) return 'no deed is transferable in this entity (deeds.transferability is "never")';
  return null;
}

function install(r) {
  // Amending: everything about it but its id, under the rule that created it.
  const amend = ({ name, of, key, label, fields, extra, apply }) => {
    r.registerEffect({
      name, module: of,
      rule: (p, e, registry) => registry.effects.get(of === 'authority' ? 'authority.grant' : extra.createKind).rule(p, e, registry),
      describe: (e) => `Amend ${label} ${e[key]}: ${Object.keys(e).filter(k => fields[k]).map(k => `${k} → ${JSON.stringify(e[k])}`).join(', ')}`,
      check(state, e, params, at, ctx = {}) {
        const it = extra.get(state, e[key]);
        if (!it) return `there is no ${label} ${e[key]}`;
        const changes = Object.keys(e).filter(k => fields[k]);
        if (!changes.length) return `say what to change: ${Object.keys(fields).join(', ')}`;
        for (const k of changes) { const why = fields[k](e[k], it, state, e); if (why) return why; }
        return extra.also ? extra.also(state, e, it, params, at, ctx) : null;
      },
    });
    r.registerRecord(name, (state, rec) => {
      const e = rec.payload, it = extra.get(state, e[key]);
      for (const k of Object.keys(e)) if (fields[k]) apply ? apply(it, k, e[k], rec) : (it[k] = e[k]);
      (it.amended ||= []).push({ at: rec.at, by: originOf(e), fields: Object.keys(e).filter(k => fields[k]) });
    });
  };
  amend({ name: 'deed.amend', of: 'deeds', key: 'deed', label: 'the deed',
    extra: { createKind: 'deed.grant', get: (s, id) => { const d = s.m.deeds?.[id]; return d && !d.retired ? d : null; } },
    fields: {
      title: (v) => (typeof v === 'string' && v.trim() && v.length <= 120 ? null : 'a title is 1–120 characters'),
      description: (v) => (typeof v === 'string' && v.length <= 2000 ? null : 'a description is at most 2000 characters'),
    } });

  r.registerEffect({
    name: 'deed.grant', module: 'deeds',
    rule: (p) => p.value('deeds.grant_rule'),
    describe: (e) => `Register "${e.title}" (${e.deed}) as held by ${e.to || 'the entity'}${e.transferable === false ? ', not transferable' : e.transferable ? ', transferable' : ''}`,
    check(state, e, params) {
      if (!ID.test(e.deed || '')) return 'a deed id is 1–40 lowercase letters, digits and -';
      if (state.m.deeds?.[e.deed]) return `the deed ${e.deed} already exists`;
      if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 120) return 'a deed needs a title of 1–120 characters';
      if (e.description !== undefined && (typeof e.description !== 'string' || e.description.length > 2000)) return 'a description is at most 2000 characters';
      if (e.to !== undefined && e.to !== null && !alive(state, e.to)) return `${e.to} is not a participant`;
      return transferableWhy(e, params);
    },
  });
  r.registerEffect({
    name: 'deed.assign', module: 'deeds',
    rule: (p) => p.value('deeds.grant_rule'),
    describe: (e) => `Assign ${e.deed} to ${e.to || 'the entity'}${e.transferable === false ? ', not transferable' : e.transferable ? ', transferable' : ''}`,
    check(state, e, params) {
      const d = state.m.deeds?.[e.deed];
      if (!d || d.retired) return `there is no deed ${e.deed}`;
      if (e.to !== null && e.to !== undefined && !alive(state, e.to)) return `${e.to} is not a participant`;
      return transferableWhy(e, params);
    },
  });
  r.registerEffect({
    name: 'deed.retire', module: 'deeds',
    rule: (p) => p.value('deeds.grant_rule'),
    describe: (e) => `Retire the deed ${e.deed}${e.reason ? ` (${e.reason})` : ''}`,
    check(state, e) { const d = state.m.deeds?.[e.deed]; return !d || d.retired ? `there is no deed ${e.deed}` : null; },
  });
  const move = (state, id, to, at, how) => { const d = reg(state)[id]; d.holder = to ?? null; d.history.push({ to: to ?? null, at, how }); };
  // Read from the entity's parameters as they stand when the deed is granted.
  const dflt = (state) => { const p = new Parameters(state.doc, state.catalog); return p.has('deeds.default_transferable') ? p.value('deeds.default_transferable') : true; };
  r.registerRecord('deed.grant', (state, rec) => {
    const e = rec.payload;
    reg(state)[e.deed] = { id: e.deed, title: e.title, description: e.description || '', holder: e.to ?? null, granted: rec.at, retired: null,
      transferable: typeof e.transferable === 'boolean' ? e.transferable : dflt(state),
      history: [{ to: e.to ?? null, at: rec.at, how: `granted by ${originOf(e)}` }] };
  });
  r.registerRecord('deed.assign', (state, rec) => {
    move(state, rec.payload.deed, rec.payload.to, rec.at, `assigned by ${originOf(rec.payload)}`);
    if (typeof rec.payload.transferable === 'boolean') reg(state)[rec.payload.deed].transferable = rec.payload.transferable;
  });
  r.registerRecord('deed.retire', (state, rec) => { const d = reg(state)[rec.payload.deed]; d.retired = rec.at; d.holder = null; });

  r.registerKind({
    name: 'deed.transfer', module: 'deeds',
    check(state, act, { params }) {
      const d = state.m.deeds?.[act.deed];
      if (!d || d.retired) return `there is no deed ${act.deed}`;
      if (d.holder !== act.by) return `you do not hold ${act.deed}`;
      const can = passable(d, params);
      if (!can.ok) return can.why;
      if (act.to === act.by) return 'you already hold it';
      if (!alive(state, act.to)) return `${act.to} is not a participant`;
      return null;
    },
    reduce(state, rec) { const a = rec.payload.act; move(state, a.deed, a.to, rec.at, `passed on by ${a.by}`); },
  });
  r.registerKind({
    name: 'deed.release', module: 'deeds',
    check(state, act) {
      const d = state.m.deeds?.[act.deed];
      return !d || d.retired ? `there is no deed ${act.deed}` : d.holder !== act.by ? `you do not hold ${act.deed}` : null;
    },
    reduce(state, rec) { const a = rec.payload.act; move(state, a.deed, null, rec.at, `given back by ${a.by}`); },
  });
}

export default { name: 'deeds', core: '0.7.7', install, mode, passable, parameterKeys: ['deeds.grant_rule', 'deeds.transferability', 'deeds.default_transferable'] };
