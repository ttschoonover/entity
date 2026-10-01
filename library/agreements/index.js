// agreements · members sign documents, and admission can require it: a
// partnership agreement, membership terms, a code of conduct, an oath.
//
// A document is a wiki page (the wiki module). A member signs one exact version
// of it: the signed act names the page, the version and the fingerprint of its
// text, so the record proves exactly which words each member agreed to, and
// when. The version to sign is the one enacted as law, or, for a page not
// enacted, its latest version.
//
//   agreement.sign { page, version, text, drawing? }
//                  text: the fingerprint of that version; drawing: an image of the
//                  member's handwritten signature (a PNG data URL), sealed inside
//                  the signed act so it cannot be moved to another document.
//                  agreements.drawn_signature says whether it is required.
//
// agreements.required lists pages an applicant must have signed before they can
// be admitted (checked however they are admitted: by decision or by a grant).
// When a required page is amended, agreements.amendments says whether an
// earlier signature still counts ("carry": the amendment binds by the vote that
// passed it) or each member must sign the new text ("resign").
//
// A signature is never withdrawn: a member who no longer agrees leaves.

import { hash } from '../../kernel/hash.js';
import { canonical } from '../../kernel/canonical.js';

const page = (state, id) => state.m.wiki?.pages?.[id] || null;

// The version of a page members sign now: the one enacted; or, if
// agreements.enacted_only is off, the latest version of a page never enacted.
export function current(state, id, params) {
  const p = page(state, id);
  if (!p || !p.versions.length) return null;
  if (p.statute) return p.versions[p.statute.version - 1];
  return params && params.value('agreements.enacted_only') ? null : p.versions[p.versions.length - 1];
}
export const fingerprint = (id, v) => hash(canonical({ page: id, version: v.n, title: v.title, body: v.body }));

// What this member has signed of this page: [{ version, text, at }].
export const signaturesOf = (state, member, id) => state.m.agreements?.[member]?.[id] || [];

// Has the member signed what counts, under agreements.amendments? → null, or why not.
export function unsigned(state, member, id, params) {
  const v = current(state, id, params);
  if (!v) return page(state, id) ? `the document "${id}" has not been enacted yet` : `the document "${id}" does not exist yet`;
  const sigs = signaturesOf(state, member, id);
  if (!sigs.length) return `has not signed "${v.title}"`;
  if (params.value('agreements.amendments') === 'resign' && !sigs.some(s => s.version === v.n)) return `has not signed the current version of "${v.title}" (version ${v.n})`;
  return null;
}
export function outstanding(state, member, params) {
  return params.value('agreements.required').map(id => unsigned(state, member, id, params)).filter(Boolean);
}

function install(r) {
  r.registerKind({
    name: 'agreement.sign', module: 'agreements',
    check(state, act, { params }) {
      const p = state.participants[act.by];
      if (!['active', 'applicant'].includes(p.status)) return `${act.by} is not a member or applicant`;
      const v = current(state, act.page, params);
      if (!v) return page(state, act.page) ? `"${act.page}" has not been enacted yet: it can be signed once the members enact it` : `there is no document "${act.page}"`;
      if (act.version !== v.n) return `the version to sign is ${v.n} (${page(state, act.page).statute ? 'the one enacted' : 'the latest'})`;
      if (act.text !== fingerprint(act.page, v)) return 'that is not the text of this version: reload the page and read it again';
      const drawn = params.value('agreements.drawn_signature');
      if (act.drawing !== undefined) {
        if (drawn === 'off') return 'drawn signatures are not used here';
        if (typeof act.drawing !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(act.drawing)) return 'the drawn signature must be a PNG image';
        if (act.drawing.length > 80000) return 'the drawn signature image is too large (at most about 60 KB)';
      } else if (drawn === 'required') return 'draw your signature before signing';
      return signaturesOf(state, act.by, act.page).some(s => s.version === v.n) ? 'you have already signed this version' : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      ((state.m.agreements ||= {})[a.by] ||= {})[a.page] ||= [];
      state.m.agreements[a.by][a.page].push({ version: a.version, text: a.text, at: rec.at, ...(a.drawing ? { drawing: a.drawing } : {}) });
    },
  });

  // Nobody is admitted without having signed every required document.
  r.registerAdmissionCheck({
    module: 'agreements',
    check: (state, id, params) => outstanding(state, id, params)[0] || null,
  });
}

export default { name: 'agreements', core: '0.7.3', install, current, fingerprint, signaturesOf, unsigned, outstanding,
  parameterKeys: ['agreements.required', 'agreements.amendments', 'agreements.enacted_only', 'agreements.drawn_signature'] };
