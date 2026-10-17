// tasks · chores, shifts and jobs: posted by any member, claimed by one, done,
// and verified by someone else. Hours are tallied per member, and, if the
// entity chooses, verified hours pay in its unit (the value module).
//
//   task.post    { task, title, hours, due?, note? }  any active member
//   task.claim   { task }        take it on; one member at a time
//   task.release { task }        give it back
//   task.done    { task, note? } the claimer says it is done
//   task.verify  { task }        another member confirms it (if tasks.verify is on);
//                                the hours are credited, and paid if tasks.pay_per_hour
//   task.cancel  { task }        the poster withdraws an open task
//
// Housing co-ops use this for workshift: post the week's shifts, members claim
// them, a manager or any other member verifies, and the hours add up.

import { Parameters } from '../../kernel/parameters.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const get = (state, id) => state.m.tasks?.items?.[id] || null;
const book = (state) => (state.m.tasks ||= { items: {}, hours: {} });
export const hoursOf = (state, id) => state.m.tasks?.hours?.[id] || 0;
const active = (state, id) => state.participants[id]?.status === 'active';

function credit(state, t, at) {
  const b = book(state);
  b.hours[t.claimer] = (b.hours[t.claimer] || 0) + t.hours;
  t.verified = at;
}

function install(r) {
  // Editing a task: whoever posted it, until someone claims it.
  r.registerKind({
    name: 'task.edit', module: 'tasks',
    check(state, act) {
      const t = state.m.tasks?.items?.[act.task];
      if (!t || t.cancelled || t.verified) return `there is no open task ${act.task}`;
      if (t.by !== act.by) return 'only the member who posted a task may edit it';
      if (t.claimer) return `${t.claimer} has claimed it: it can no longer change`;
      if (act.title !== undefined && (typeof act.title !== 'string' || !act.title.trim() || act.title.length > 120)) return 'a title is 1–120 characters';
      if (act.hours !== undefined && !(typeof act.hours === 'number' && act.hours > 0 && act.hours <= 100 && Number.isInteger(act.hours * 4))) return 'hours is a number from 0.25 to 100, in quarter hours';
      if (act.due !== undefined && act.due !== null && (typeof act.due !== 'string' || Number.isNaN(Date.parse(act.due)))) return 'due is a date';
      return act.note !== undefined && (typeof act.note !== 'string' || act.note.length > 1000) ? 'a note is at most 1000 characters' : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, t = state.m.tasks.items[a.task];
      for (const k of ['title', 'hours', 'due', 'note']) if (a[k] !== undefined) t[k] = a[k];
      t.history.push({ at: rec.at, what: `edited by ${a.by}` });
    },
  });

  r.registerKind({
    name: 'task.post', module: 'tasks',
    check(state, act) {
      if (!active(state, act.by)) return 'only active members post tasks';
      if (!ID.test(act.task || '')) return 'a task id is 1–40 lowercase letters, digits and -';
      if (get(state, act.task)) return `the task ${act.task} already exists`;
      if (typeof act.title !== 'string' || !act.title.trim() || act.title.length > 120) return 'a task needs a title of 1–120 characters';
      if (!(typeof act.hours === 'number' && act.hours > 0 && act.hours <= 100 && Number.isInteger(act.hours * 4))) return 'hours is a number from 0.25 to 100, in quarter hours';
      if (act.due !== undefined && (typeof act.due !== 'string' || Number.isNaN(Date.parse(act.due)))) return 'due is a date';
      return act.note !== undefined && (typeof act.note !== 'string' || act.note.length > 1000) ? 'a note is at most 1000 characters' : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      book(state).items[a.task] = { id: a.task, title: a.title, hours: a.hours, due: a.due || null, note: a.note || '', by: a.by, posted: rec.at,
        claimer: null, claimed: null, done: null, doneNote: '', verified: null, verifier: null, cancelled: null, history: [{ at: rec.at, what: `posted by ${a.by}` }] };
    },
  });
  const open = (t) => t && !t.cancelled && !t.verified;
  r.registerKind({
    name: 'task.claim', module: 'tasks',
    check(state, act) {
      const t = get(state, act.task);
      if (!open(t)) return `there is no open task ${act.task}`;
      if (!active(state, act.by)) return 'only active members claim tasks';
      return t.claimer ? `${t.claimer} has claimed it` : null;
    },
    reduce(state, rec) { const a = rec.payload.act, t = get(state, a.task); t.claimer = a.by; t.claimed = rec.at; t.history.push({ at: rec.at, what: `claimed by ${a.by}` }); },
  });
  r.registerKind({
    name: 'task.release', module: 'tasks',
    check(state, act) { const t = get(state, act.task); return open(t) && t.claimer === act.by && !t.done ? null : 'you have not claimed that task, or it is already done'; },
    reduce(state, rec) { const a = rec.payload.act, t = get(state, a.task); t.claimer = null; t.claimed = null; t.history.push({ at: rec.at, what: `given back by ${a.by}` }); },
  });
  r.registerKind({
    name: 'task.done', module: 'tasks',
    check(state, act) {
      const t = get(state, act.task);
      if (!open(t) || t.claimer !== act.by) return 'you have not claimed that task';
      if (t.done) return 'already marked done';
      return act.note !== undefined && (typeof act.note !== 'string' || act.note.length > 1000) ? 'a note is at most 1000 characters' : null;
    },
    apply(state, act, { params }) {
      // With verification off, saying it is done is enough.
      return params.value('tasks.verify') ? [] : [{ kind: 'task.credited', payload: { task: act.task } }, ...pay(state, get(state, act.task), params)];
    },
    reduce(state, rec) { const a = rec.payload.act, t = get(state, a.task); t.done = rec.at; t.doneNote = a.note || ''; t.history.push({ at: rec.at, what: `done, says ${a.by}` }); },
  });
  r.registerKind({
    name: 'task.verify', module: 'tasks',
    check(state, act, { params }) {
      const t = get(state, act.task);
      if (!open(t) || !t.done) return 'that task is not waiting to be verified';
      if (!params.value('tasks.verify')) return 'tasks are not verified here';
      if (!active(state, act.by)) return 'only active members verify';
      return act.by === t.claimer ? 'someone other than the member who did it verifies it' : null;
    },
    apply(state, act, { params }) { return [{ kind: 'task.credited', payload: { task: act.task } }, ...pay(state, get(state, act.task), params)]; },
    reduce(state, rec) { const a = rec.payload.act, t = get(state, a.task); t.verifier = a.by; t.history.push({ at: rec.at, what: `verified by ${a.by}` }); },
    records: { 'task.credited'(state, rec) { credit(state, get(state, rec.payload.task), rec.at); } },
  });
  r.registerKind({
    name: 'task.cancel', module: 'tasks',
    check(state, act) { const t = get(state, act.task); return open(t) && t.by === act.by && !t.done ? null : 'only the member who posted an open task may withdraw it'; },
    reduce(state, rec) { const a = rec.payload.act, t = get(state, a.task); t.cancelled = rec.at; t.history.push({ at: rec.at, what: `withdrawn by ${a.by}` }); },
  });
}

// Paying for verified hours, in the entity's unit, if the entity chose to.
function pay(state, t, params) {
  const per = params.value('tasks.pay_per_hour');
  if (!per || !params.has('value.name')) return [];
  const amount = Math.floor(t.hours * per);
  const max = params.value('value.max_supply');
  if (!amount || (max && (state.m.value?.supply || 0) + amount > max)) return [];
  return [{ kind: 'value.issue', payload: { to: t.claimer, amount, memo: `for the task ${t.id}` } }];
}

export default { name: 'tasks', core: '0.7.7', install, hoursOf, parameterKeys: ['tasks.verify', 'tasks.pay_per_hour'] };
