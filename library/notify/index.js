// notify · tell members what happens, without telling anyone else.
//
//   notice.post  { title, text? }    a notice to every member; sealed in a
//                                    sealed republic, like any act
//
// The node sends each member the events they chose (notify.events), and every
// notice, sealed to that member's record key (kernel/notice.js): by Web Push
// to their devices, kept for them in an inbox the page opens, and as an email
// or text message that says only that there is something new, unless the
// republic allows (notify.plaintext_email) and the member chooses more.
// Where to send is kept by the node (.entity/notify), never in the record.
// See cli/notify.js and docs/MODULES.md.

export const EVENTS = Object.freeze(['trades', 'proposals', 'reminders', 'decisions', 'members', 'notices']);

function install(r) {
  r.registerKind({
    name: 'notice.post', module: 'notify',
    check(state, act, { params }) {
      if (state.participants[act.by]?.status !== 'active') return 'only an active member posts a notice';
      if (params.value('notify.broadcast') === 'nobody') return 'notices are off (notify.broadcast: nobody)';
      if (typeof act.title !== 'string' || !act.title.trim() || act.title.length > 120) return 'a notice needs a title of 1–120 characters';
      if (act.text !== undefined && (typeof act.text !== 'string' || act.text.length > 1000)) return 'its text is at most 1000 characters';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      (state.m.notices ||= []).push({ seq: rec.seq, at: rec.at, by: a.by, title: a.title, ...(a.text ? { text: a.text } : {}) });
    },
  });
}

export default { name: 'notify', core: '0.9.10', install, EVENTS, parameterKeys: ['notify.events', 'notify.remind_hours', 'notify.broadcast', 'notify.plaintext_email'] };
