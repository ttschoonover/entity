// meetings · meetings called by decision (or by a secretary granted the power),
// with an agenda, attendance signed by the members who came, and minutes that
// any member may draft and a decision approves.
//
//   meeting.call    { meeting, title, starts, place?, agenda?: [..] }   an effect
//   meeting.cancel  { meeting, reason }                                 an effect
//   meeting.attend  { meeting }         a member checks in, from an hour before it
//                                       starts until meetings.checkin_hours after
//   meeting.minutes { meeting, text }   a draft of the minutes; each is kept
//   meeting.approve { meeting, version } an effect: those minutes are the record
//
// Attendance is signed by each member themselves: nobody can be marked present
// or absent by someone else.

import { originOf } from '../../kernel/effects.js';
import { Parameters } from '../../kernel/parameters.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOUR = 3600000;
const get = (state, id) => state.m.meetings?.[id] || null;
export const checkinWindow = (m, hours) => ({ from: new Date(Date.parse(m.starts) - HOUR).toISOString(), to: new Date(Date.parse(m.starts) + hours * HOUR).toISOString() });
const iso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d\d-\d\dT/.test(s);

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
  amend({ name: 'meeting.amend', of: 'meetings', key: 'meeting', label: 'the meeting',
    extra: { createKind: 'meeting.call', get: (s, id) => (s.m.meetings?.[id]?.cancelled ? null : s.m.meetings?.[id] || null) },
    fields: {
      title: (v) => (typeof v === 'string' && v.trim() && v.length <= 100 ? null : 'a title is 1–100 characters'),
      starts: (v, m, s) => (typeof v !== 'string' || Number.isNaN(Date.parse(v)) ? 'starts is a date and time' : (s.head.at || '') >= m.starts ? 'it has already started: its time can no longer change' : null),
      place: (v) => (typeof v === 'string' && v.length <= 200 ? null : 'a place is at most 200 characters'),
      agenda: (v) => (Array.isArray(v) && v.length <= 40 && v.every(x => typeof x === 'string' && x.trim() && x.length <= 200) ? null : 'an agenda is a list of up to 40 items'),
    } });

  r.registerEffect({
    name: 'meeting.call', module: 'meetings',
    rule: (p) => p.value('meetings.call_rule'),
    describe: (e) => `Call a meeting: "${e.title}", ${String(e.starts).replace('T', ' ').slice(0, 16)}${e.place ? `, ${e.place}` : ''}`,
    check(state, e) {
      if (!ID.test(e.meeting || '')) return 'a meeting id is 1–40 lowercase letters, digits and -';
      if (get(state, e.meeting)) return `the meeting ${e.meeting} already exists`;
      if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 100) return 'a meeting needs a title of 1–100 characters';
      if (!iso(e.starts)) return 'starts is a date and time, like 2026-10-05T18:00:00Z';
      if (e.place !== undefined && (typeof e.place !== 'string' || e.place.length > 200)) return 'a place is at most 200 characters';
      if (e.agenda !== undefined && (!Array.isArray(e.agenda) || e.agenda.length > 40 || e.agenda.some(x => typeof x !== 'string' || !x.trim() || x.length > 200))) return 'an agenda is a list of up to 40 items of 1–200 characters';
      return null;
    },
  });
  r.registerEffect({
    name: 'meeting.cancel', module: 'meetings',
    rule: (p) => p.value('meetings.call_rule'),
    describe: (e) => `Cancel the meeting ${e.meeting} (${e.reason})`,
    check(state, e) {
      const m = get(state, e.meeting);
      if (!m || m.cancelled) return `there is no meeting ${e.meeting}`;
      return typeof e.reason === 'string' && e.reason.trim() ? null : 'give a reason; it is published';
    },
  });
  r.registerEffect({
    name: 'meeting.approve', module: 'meetings',
    rule: (p) => p.value('meetings.minutes_rule'),
    describe: (e) => `Approve version ${e.version} of the minutes of ${e.meeting}`,
    check(state, e) {
      const m = get(state, e.meeting);
      if (!m) return `there is no meeting ${e.meeting}`;
      if (!Number.isInteger(e.version) || e.version < 1 || e.version > m.minutes.length) return `${e.meeting} has minutes versions 1 to ${m.minutes.length}`;
      return m.approved?.version === e.version ? 'those minutes are already approved' : null;
    },
  });
  r.registerRecord('meeting.call', (state, rec) => {
    const e = rec.payload;
    (state.m.meetings ||= {})[e.meeting] = { id: e.meeting, title: e.title, starts: e.starts, place: e.place || '', agenda: e.agenda || [],
      called: rec.at, by: originOf(e), attendance: {}, minutes: [], approved: null, cancelled: null };
  });
  r.registerRecord('meeting.cancel', (state, rec) => { get(state, rec.payload.meeting).cancelled = { at: rec.at, reason: rec.payload.reason }; });
  r.registerRecord('meeting.approve', (state, rec) => { get(state, rec.payload.meeting).approved = { version: rec.payload.version, at: rec.at, by: originOf(rec.payload) }; });

  r.registerKind({
    name: 'meeting.attend', module: 'meetings',
    check(state, act) {
      const m = get(state, act.meeting);
      if (!m || m.cancelled) return `there is no meeting ${act.meeting}`;
      if (state.participants[act.by].status !== 'active') return 'only active members check in';
      if (m.attendance[act.by]) return 'you have already checked in';
      const w = checkinWindow(m, new Parameters(state.doc, state.catalog).value('meetings.checkin_hours'));
      if (act.at < w.from) return `check-in opens at ${w.from}`;
      return act.at > w.to ? `check-in closed at ${w.to}` : null;
    },
    reduce(state, rec) { get(state, rec.payload.act.meeting).attendance[rec.payload.act.by] = rec.at; },
  });
  r.registerKind({
    name: 'meeting.minutes', module: 'meetings',
    check(state, act, { params }) {
      const m = get(state, act.meeting);
      if (!m || m.cancelled) return `there is no meeting ${act.meeting}`;
      if (state.participants[act.by].status !== 'active') return 'only active members draft minutes';
      if (act.at < m.starts) return 'minutes are drafted once the meeting has started';
      const max = params.value('meetings.max_length');
      return typeof act.text === 'string' && act.text.trim() && act.text.length <= max ? null : `minutes are 1–${max} characters`;
    },
    reduce(state, rec) {
      const a = rec.payload.act, m = get(state, a.meeting);
      m.minutes.push({ version: m.minutes.length + 1, by: a.by, at: rec.at, text: a.text });
    },
  });
}

export default { name: 'meetings', core: '0.7.7', install, checkinWindow, parameterKeys: ['meetings.call_rule', 'meetings.minutes_rule', 'meetings.checkin_hours', 'meetings.max_length'] };
