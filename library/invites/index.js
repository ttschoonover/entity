// invites · personal invitation links. The partners (by decision, or an
// officer under a grant they made) invite one named person; the link carries a
// secret only that person receives. Whoever applies with it, signs what
// membership requires and (with details.required) gives their particulars is
// admitted, without a further vote: the invitation was the vote.
//
//   invite.create { invite, name, hash, days }   (an effect) hash: SHA-256 of the
//                 link's secret, hex; the secret itself is never recorded
//   invite.revoke { invite }                     (an effect)
//   invite.accept { invite, secret }             the applicant, once they have
//                 applied and signed: admits them (participant.admitted)
//
// Link: https://HOST/signin?invite=INVITE.SECRET (the sign-in page applies,
// signs the documents, files the particulars and accepts, in that order).

import { originOf } from '../../kernel/effects.js';
import { admissionProblem } from '../../kernel/effects.js';
import { hash } from '../../kernel/hash.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = 86400000;
const book = (state) => (state.m.invites ||= {});
export const invite = (state, id) => state.m.invites?.[id] || null;
export const open = (i, at) => !!i && !i.used && !i.revoked && at <= i.expires;

function install(r) {
  r.registerEffect({
    module: 'invites', name: 'invite.create',
    rule: (p) => p.value('membership.admission_rule'),
    describe: (e) => `Invite ${e.name} to join (link valid ${e.days} days)`,
    check(state, e, P) {
      if (!ID.test(e.invite || '')) return 'an invitation id is 1–40 lowercase letters, digits and -';
      if (invite(state, e.invite)) return `the invitation ${e.invite} already exists`;
      if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120) return 'say who is invited (a name, 1–120 characters)';
      if (!/^[0-9a-f]{64}$/.test(e.hash || '')) return 'hash is the SHA-256 of the link secret, in hex';
      const max = P.value('invites.max_days');
      if (!Number.isInteger(e.days) || e.days < 1 || e.days > max) return `days is a whole number from 1 to ${max}`;
      return null;
    },
  });
  r.registerRecord('invite.create', (state, rec) => {
    const e = rec.payload;
    book(state)[e.invite] = { id: e.invite, name: e.name, hash: e.hash, at: rec.at, by: originOf(e), expires: new Date(Date.parse(rec.at) + e.days * DAY).toISOString(), used: null, revoked: null };
  });
  r.registerEffect({
    module: 'invites', name: 'invite.revoke',
    rule: (p) => p.value('membership.admission_rule'),
    describe: (e) => `Withdraw the invitation ${e.invite}`,
    check: (state, e) => (invite(state, e.invite) && !invite(state, e.invite).used && !invite(state, e.invite).revoked ? null : `there is no open invitation ${e.invite}`),
  });
  r.registerRecord('invite.revoke', (state, rec) => { invite(state, rec.payload.invite).revoked = rec.at; });

  r.registerKind({
    name: 'invite.accept', module: 'invites',
    check(state, act, { params, registry }) {
      const i = invite(state, act.invite);
      if (!i) return `there is no invitation ${act.invite}`;
      if (i.used) return 'this invitation has been used';
      if (i.revoked) return 'this invitation was withdrawn';
      if (act.at > i.expires) return 'this invitation has expired';
      if (typeof act.secret !== 'string' || hash(act.secret) !== i.hash) return 'that is not this invitation\'s link';
      if (state.participants[act.by]?.status !== 'applicant') return 'apply first, then accept the invitation';
      const why = admissionProblem(registry, state, params, act.by);
      if (why) return why.replace(/^.*cannot be admitted yet: /, 'before you are admitted: ');
      if (params.has('details.required') && params.value('details.required') && !state.m.details?.[act.by]) return 'before you are admitted: give your particulars (partner details)';
      return null;
    },
    apply(state, act) { return [{ kind: 'participant.admitted', payload: { invite: act.invite, id: act.by } }]; },
    reduce(state, rec) { const a = rec.payload.act; invite(state, a.invite).used = { by: a.by, at: rec.at }; },
  });
}

export default { name: 'invites', core: '0.9.10', install, invite, open, parameterKeys: ['invites.max_days'] };
