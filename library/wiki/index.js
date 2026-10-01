// wiki · pages any member may write, every version signed and kept. A page
// can be enacted as a statute by decision: the statute is that exact version,
// and stays so while the page is edited further as a draft; enacting a later
// version amends it, and repealing ends it.
//
//   wiki.edit     { page, title, body, base, note?, category? }
//                                                     category: a shelf for the page
//                                                     (recipes, how-to, policies…);
//                                                     base: the version this edit
//                                                     starts from (0 for a new page).
//                                                     An edit on an old base is
//                                                     refused, so nobody overwrites
//                                                     a change they have not seen.
//   wiki.enact    { page, version }   an effect: makes that version a statute
//   wiki.repeal   { page, reason? }   an effect: it is no longer law
//
// Nothing written here can be erased: every version stays in the record.

import { originOf } from '../../kernel/effects.js';

const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const page = (state, id) => state.m.wiki?.pages?.[id] || null;
export const latest = (p) => p.versions[p.versions.length - 1];
export const statuteText = (p) => (p?.statute ? p.versions[p.statute.version - 1] : null);

// Lines added and removed between two texts: the smallest line diff (LCS). For
// redlines on the page; pure.
export function diffLines(a, b) {
  const x = String(a).split('\n'), y = String(b).split('\n');
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push([' ', x[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', x[i++]]);
    else out.push(['+', y[j++]]);
  }
  while (i < n) out.push(['-', x[i++]]);
  while (j < m) out.push(['+', y[j++]]);
  return out;
}

function install(r) {
  r.registerKind({
    name: 'wiki.edit', module: 'wiki',
    check(state, act, { params }) {
      if (state.participants[act.by].status !== 'active') return 'only active members may edit';
      if (!ID.test(act.page || '')) return 'a page id is 1–60 lowercase letters, digits and -';
      if (typeof act.title !== 'string' || !act.title.trim() || act.title.length > 120) return 'a page needs a title of 1–120 characters';
      const max = params.value('wiki.max_length');
      if (typeof act.body !== 'string' || act.body.length > max) return `the text is at most ${max} characters`;
      if (act.note !== undefined && (typeof act.note !== 'string' || act.note.length > 200)) return 'a note is at most 200 characters';
      if (act.category !== undefined && (typeof act.category !== 'string' || !act.category.trim() || act.category.length > 40)) return 'a category is 1–40 characters';
      const p = page(state, act.page);
      const have = p ? latest(p).n : 0;
      if (act.base !== have) return p ? `${act.page} has been edited since version ${act.base}: it is at version ${have}. Start from that one` : `${act.page} is a new page: base is 0`;
      if (p && latest(p).body === act.body && latest(p).title === act.title && (latest(p).category || '') === (act.category || '')) return 'nothing changed';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      state.m.wiki = state.m.wiki || { pages: {} };
      const p = state.m.wiki.pages[a.page] = state.m.wiki.pages[a.page] || { id: a.page, created: rec.at, versions: [], statute: null, enactments: [] };
      p.versions.push({ n: p.versions.length + 1, by: a.by, at: rec.at, title: a.title, body: a.body, note: a.note || '', ...(a.category ? { category: a.category.trim() } : {}) });
    },
  });

  r.registerEffect({
    name: 'wiki.enact', module: 'wiki',
    rule: (p) => p.value('wiki.enact_rule'),
    describe: (e) => `Enact version ${e.version} of the page ${e.page} as a statute`,
    check(state, e) {
      const p = page(state, e.page);
      if (!p) return `there is no page ${e.page}`;
      if (!Number.isInteger(e.version) || e.version < 1 || e.version > p.versions.length) return `${e.page} has versions 1 to ${p.versions.length}`;
      return p.statute?.version === e.version ? `version ${e.version} is already the statute` : null;
    },
  });
  r.registerEffect({
    name: 'wiki.repeal', module: 'wiki',
    rule: (p) => p.value('wiki.enact_rule'),
    describe: (e) => `Repeal the statute ${e.page}${e.reason ? ` (${e.reason})` : ''}`,
    check: (state, e) => (page(state, e.page)?.statute ? null : `${e.page} is not a statute`),
  });
  r.registerRecord('wiki.enact', (state, rec) => {
    const p = page(state, rec.payload.page);
    const action = p.statute ? 'amended' : 'enacted';
    p.statute = { version: rec.payload.version, at: rec.at, by: originOf(rec.payload) };
    p.enactments.push({ ...p.statute, action });
  });
  r.registerRecord('wiki.repeal', (state, rec) => {
    const p = page(state, rec.payload.page);
    p.enactments.push({ version: p.statute.version, at: rec.at, by: originOf(rec.payload), action: 'repealed', reason: rec.payload.reason || '' });
    p.statute = null;
  });
}

export const categoryOf = (p) => latest(p).category || 'Uncategorised';
export default { name: 'wiki', core: '0.4.1', categoryOf, install, latest, statuteText, diffLines, parameterKeys: ['wiki.max_length', 'wiki.enact_rule'] };
