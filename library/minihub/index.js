// minihub · a house hub's alerts, sent by the members the admins choose.
//
//   alert.send        { title, text? }      an alert to every member, from an approved sender
//   minihub.senders   { members: [id…] }    an effect: who may send alerts
//
// Alerts reach members through the notify module: pushed, kept in their inbox,
// and emailed with their text when minihub.email_text is on. The hub's own
// routes (server.js) show the wiki, the alerts and the admin view.

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const book = (state) => (state.m.minihub ||= { senders: [], alerts: [] });
export const senders = (state) => state.m.minihub?.senders || [];

function install(r) {
  r.registerEffect({
    name: 'minihub.senders', module: 'minihub',
    rule: (p) => p.value('minihub.senders_rule'),
    describe: (e) => `Alert senders: ${(e.members || []).join(', ') || 'nobody'}`,
    check(state, e) {
      if (!Array.isArray(e.members) || e.members.length > 50) return 'members is a list of at most 50 ids';
      for (const id of e.members) {
        if (typeof id !== 'string' || !ID.test(id)) return `"${id}" is not a member id`;
        if (state.participants[id]?.status !== 'active') return `${id} is not an active member`;
      }
      if (new Set(e.members).size !== e.members.length) return 'a member is listed twice';
      return null;
    },
  });
  r.registerRecord('minihub.senders', (state, rec) => { book(state).senders = [...rec.payload.members]; });

  r.registerKind({
    name: 'alert.send', module: 'minihub',
    check(state, act) {
      if (state.participants[act.by]?.status !== 'active') return 'only an active member sends alerts';
      if (!senders(state).includes(act.by)) return `${act.by} is not one of the hub's alert senders`;
      if (typeof act.title !== 'string' || !act.title.trim() || act.title.length > 120) return 'an alert needs a subject of 1–120 characters';
      if (act.text !== undefined && (typeof act.text !== 'string' || act.text.length > 2000)) return 'its text is at most 2000 characters';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      book(state).alerts.push({ seq: rec.seq, at: rec.at, by: a.by, title: a.title, ...(a.text ? { text: a.text } : {}) });
    },
  });

  r.registerNotices({
    module: 'minihub',
    notices(state, rec, params) {
      if (rec.kind !== 'alert.send') return [];
      const a = rec.payload.act;
      return [{ event: 'notices', title: a.title, text: a.text || '', url: '#/alerts', plain: params?.value('minihub.email_text') !== false }];
    },
  });
}

export default { name: 'minihub', core: '0.9.12', install, senders, parameterKeys: ['minihub.senders_rule', 'minihub.email_text'] };
