// details · what the law needs to know about each partner, known only to the
// partner and the officers who need it.
//
//   details.filed { digest }   a partner (or applicant) has given the officers
//                              their particulars; digest commits to them
//
// The particulars themselves (legal name, date of birth, residence, taxpayer
// number and tax status, contact) are encrypted to the partner and to the
// holders of the offices in details.readers (kernel/details.js) and kept by
// the node, off the record (cli/details.js), so they can be corrected or
// deleted. They serve the partnership's legal duties: each partner's Schedule
// K-1 (name, address, taxpayer number), the fictitious business name statement
// (every general partner's name), the broker's and bank's customer due
// diligence, and the agreement's age requirement.
//
// details.required: an applicant must have filed before an invitation admits
// them (the invites module), and the Members tab shows who has not.

function install(r) {
  r.registerKind({
    name: 'details.filed', module: 'details',
    check(state, act) {
      const p = state.participants[act.by];
      if (!p || !['active', 'applicant'].includes(p.status)) return `${act.by} is not a partner or applicant`;
      if (typeof act.digest !== 'string' || !/^[0-9a-f]{64}$/.test(act.digest)) return 'digest is the SHA-256 of the sealed particulars';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      (state.m.details ||= {})[a.by] = { digest: a.digest, at: rec.at };
    },
  });
}

export const filed = (state, id) => state.m.details?.[id] || null;
// Who may read the particulars now: the holders of the offices in details.readers.
export function readers(state, params, at) {
  const out = new Set();
  for (const o of params.value('details.readers')) for (const h of state.m.offices?.[o]?.holders || []) if (!h.until || h.until > at) out.add(h.id);
  return [...out];
}

export default { name: 'details', core: '0.9.10', install, filed, readers, parameterKeys: ['details.required', 'details.tin', 'details.readers'] };
