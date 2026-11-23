// notifys · Notify.S, the Berkeley Co-operative Notification System.
//
// Who does what (no votes: each act takes effect when its author may do it):
//
//   admins              add houses, appoint house emergency managers, the central
//                       team and other admins; admit or remove anyone; send any alert
//   emergency managers  admit and remove members of their house, appoint its
//                       alert team, send alerts to their house
//   central team        send alerts to everyone
//   house team          send alerts to their house
//   members             receive alerts for everyone and for their own house
//
// Acts, each signed by the person doing it:
//
//   notifys.admin    { member, on }                 an admin makes or unmakes an admin
//   notifys.house    { house, name }                an admin adds or renames a house
//   notifys.manager  { house, member, on }          an admin appoints or removes a manager
//   notifys.team     { team, member, on }           team: "central" (by an admin) or a house id
//                                                   (by an admin or that house's manager)
//   notifys.admit    { id, house? }                 let an applicant in, as a resident of the
//                                                   house they declared (or the house given)
//   notifys.decline  { id }                         turn an applicant away
//   notifys.remove   { id }                         remove a member
//   notifys.move     { member, house }              an admin moves a member to another house
//   notifys.alert    { to, type, title, text?, where?, todo?, until?, severity?, ref? }
//                    to: "central" or a house id; type: alert | update | allclear;
//                    severity: extreme | severe | moderate | minor (as in the Common
//                    Alerting Protocol); ref: the alert an update or all-clear follows.
//
// An applicant declares their house when applying (participant.apply with
// about: { house }). Their house's managers, or an admin, check it before
// letting them in.

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TYPES = ['alert', 'update', 'allclear'];
const SEVERITY = ['extreme', 'severe', 'moderate', 'minor'];

// ── reading the state ───────────────────────────────────────────────────────
export const book = (state) => (state.m.notifys ||= { admins: [], houses: {}, central: [], residence: {}, alerts: [] });
const read = (state) => state.m.notifys || { admins: [], houses: {}, central: [], residence: {}, alerts: [] };

const active = (state, id) => state.participants[id]?.status === 'active';
// Until someone is made an admin, the founder is.
export const admins = (state) => (read(state).admins.length ? read(state).admins : [state.entity.founder]);
export const isAdmin = (state, id) => active(state, id) && admins(state).includes(id);
export const houseOf = (state, id) => read(state).residence[id] || null;
export const isManager = (state, id, house) => active(state, id) && !!read(state).houses[house]?.managers.includes(id);
export const canRun = (state, id, house) => isAdmin(state, id) || isManager(state, id, house);
export function canSend(state, id, to) {
  if (!active(state, id)) return false;
  if (isAdmin(state, id)) return true;
  if (to === 'central') return read(state).central.includes(id);
  const h = read(state).houses[to];
  return !!h && (h.managers.includes(id) || h.team.includes(id));
}
// The house an applicant asked to join, if it exists.
const declaredHouse = (state, id) => { const h = state.participants[id]?.declared?.house; return h && read(state).houses[h] ? h : null; };

const toggle = (list, id, on) => (on ? [...new Set([...list, id])] : list.filter(x => x !== id));
const text = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);

// ── the acts ────────────────────────────────────────────────────────────────
function install(r) {
  const kind = (name, check, reduce, apply) => r.registerKind({ name, module: 'notifys', check, reduce, ...(apply ? { apply } : {}) });

  kind('notifys.admin',
    (s, a) => {
      if (!isAdmin(s, a.by)) return 'only an admin makes admins';
      if (!active(s, a.member)) return `${a.member} is not an active member`;
      if (a.on === false && admins(s).filter(x => x !== a.member).length === 0) return 'the system needs at least one admin';
      return null;
    },
    (s, rec) => { const a = rec.payload.act, b = book(s); b.admins = toggle(admins(s), a.member, a.on !== false); });

  kind('notifys.house',
    (s, a) => {
      if (!isAdmin(s, a.by)) return 'only an admin adds houses';
      if (!ID.test(a.house || '')) return 'a house id is lowercase letters, digits and -';
      if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80) return 'a house needs a name of 1–80 characters';
      return null;
    },
    (s, rec) => { const a = rec.payload.act, b = book(s); b.houses[a.house] = { managers: [], team: [], ...b.houses[a.house], name: a.name.trim() }; });

  kind('notifys.manager',
    (s, a) => {
      if (!isAdmin(s, a.by)) return 'only an admin appoints emergency managers';
      if (!read(s).houses[a.house]) return `there is no house ${a.house}`;
      if (!active(s, a.member)) return `${a.member} is not an active member`;
      return null;
    },
    (s, rec) => { const a = rec.payload.act, h = book(s).houses[a.house]; h.managers = toggle(h.managers, a.member, a.on !== false); });

  kind('notifys.team',
    (s, a) => {
      if (a.team === 'central') { if (!isAdmin(s, a.by)) return 'only an admin appoints the central team'; }
      else if (!read(s).houses[a.team]) return `there is no house ${a.team}`;
      else if (!canRun(s, a.by, a.team)) return `only an admin or ${a.team}'s emergency manager appoints its team`;
      if (!active(s, a.member)) return `${a.member} is not an active member`;
      return null;
    },
    (s, rec) => {
      const a = rec.payload.act, b = book(s);
      if (a.team === 'central') b.central = toggle(b.central, a.member, a.on !== false);
      else b.houses[a.team].team = toggle(b.houses[a.team].team, a.member, a.on !== false);
    });

  kind('notifys.admit',
    (s, a) => {
      if (s.participants[a.id]?.status !== 'applicant') return `${a.id} is not waiting to join`;
      const house = a.house || declaredHouse(s, a.id);
      if (!house || !read(s).houses[house]) return `say which house ${a.id} lives in`;
      if (!canRun(s, a.by, house)) return `only an admin or ${house}'s emergency manager lets people into ${house}`;
      return null;
    },
    (s, rec) => { const a = rec.payload.act; book(s).residence[a.id] = a.house || declaredHouse(s, a.id); },
    (s, a) => [{ kind: 'participant.admit', payload: { id: a.id } }]);

  kind('notifys.decline',
    (s, a) => {
      if (s.participants[a.id]?.status !== 'applicant') return `${a.id} is not waiting to join`;
      const house = declaredHouse(s, a.id);
      if (!(isAdmin(s, a.by) || (house && isManager(s, a.by, house)))) return 'only an admin or the house\'s emergency manager turns an applicant away';
      return null;
    },
    () => {},
    (s, a) => [{ kind: 'participant.remove', payload: { id: a.id, reason: 'Not verified by the house' } }]);

  kind('notifys.remove',
    (s, a) => {
      if (!active(s, a.id)) return `${a.id} is not an active member`;
      if (a.id === a.by) return 'to leave, use participant.leave';
      if (isAdmin(s, a.id) && !isAdmin(s, a.by)) return 'only an admin removes an admin';
      if (!canRun(s, a.by, houseOf(s, a.id))) return 'only an admin or the member\'s emergency manager removes them';
      return null;
    },
    (s, rec) => {
      const id = rec.payload.act.id, b = book(s);
      b.admins = b.admins.filter(x => x !== id); b.central = b.central.filter(x => x !== id);
      for (const h of Object.values(b.houses)) { h.managers = h.managers.filter(x => x !== id); h.team = h.team.filter(x => x !== id); }
    },
    (s, a) => [{ kind: 'participant.remove', payload: { id: a.id, reason: `Removed by ${a.by}` } }]);

  kind('notifys.move',
    (s, a) => {
      if (!isAdmin(s, a.by)) return 'only an admin moves members between houses';
      if (!active(s, a.member)) return `${a.member} is not an active member`;
      if (!read(s).houses[a.house]) return `there is no house ${a.house}`;
      return null;
    },
    (s, rec) => { const a = rec.payload.act; book(s).residence[a.member] = a.house; });

  kind('notifys.alert',
    (s, a) => {
      if (a.to !== 'central' && !read(s).houses[a.to]) return 'send to "central" or to a house';
      if (!canSend(s, a.by, a.to)) return a.to === 'central' ? 'only the central team and admins alert everyone' : `only ${a.to}'s team, its emergency manager and admins alert ${a.to}`;
      if (!TYPES.includes(a.type)) return `type is ${TYPES.join(', ')}`;
      if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 120) return 'say what is happening in 1–120 characters';
      if (!text(a.text, 2000) || !text(a.where, 200) || !text(a.todo, 500) || !text(a.until, 100)) return 'details are at most 2000 characters; where, what to do and until are short';
      if (a.severity !== undefined && !SEVERITY.includes(a.severity)) return `severity is ${SEVERITY.join(', ')}`;
      if (a.ref !== undefined && !read(s).alerts.some(x => x.seq === a.ref)) return 'an update follows an earlier alert';
      if (a.type !== 'alert' && a.ref === undefined) return 'say which alert this updates';
      return null;
    },
    (s, rec) => {
      const a = rec.payload.act;
      book(s).alerts.push({ seq: rec.seq, at: rec.at, by: a.by, to: a.to, type: a.type, title: a.title.trim(),
        ...Object.fromEntries(['text', 'where', 'todo', 'until', 'severity', 'ref'].filter(k => a[k] !== undefined && a[k] !== '').map(k => [k, a[k]])) });
    });

  // ── what members are told (the notify module delivers it) ─────────────────
  r.registerNotices({
    module: 'notifys',
    notices(s, rec, params) {
      const a = rec.payload?.act || {};
      if (rec.kind === 'notifys.alert') {
        const label = a.to === 'central' ? 'Central' : read(s).houses[a.to]?.name || a.to;
        const word = { alert: '', update: 'Update: ', allclear: 'All clear: ' }[a.type];
        const lines = [a.text, a.where && `Where: ${a.where}`, a.todo && `What to do: ${a.todo}`, a.until && `Until: ${a.until}`,
          `From: ${s.m?.titles?.[a.by] || s.participants[a.by]?.name || a.by}, ${a.to === 'central' ? 'central' : label}`].filter(Boolean);
        const n = { event: 'notices', title: `[${label}] ${word}${a.title}`, text: lines.join('\n'), url: '#/', plain: params?.value('notifys.email_text') !== false };
        if (a.to === 'central') return [n];
        // A house alert reaches that house's residents, and admins.
        const to = Object.keys(s.participants).filter(id => active(s, id) && (houseOf(s, id) === a.to || isAdmin(s, id)));
        return to.map(id => ({ ...n, only: id }));
      }
      if (rec.kind === 'participant.apply') {
        // Someone is waiting: tell the house's managers and the admins (no names in email).
        const house = a.about?.house;
        const to = Object.keys(s.participants).filter(id => isAdmin(s, id) || (house && isManager(s, id, house)));
        return to.map(id => ({ event: 'notices', title: 'Someone is waiting to join', text: '', url: '#/house', only: id }));
      }
      return [];
    },
  });
}

export default { name: 'notifys', core: '0.9.13', install, admins, isAdmin, isManager, canRun, canSend, houseOf, parameterKeys: ['notifys.email_text'] };
