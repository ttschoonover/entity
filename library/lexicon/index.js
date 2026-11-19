// lexicon · a constructed language, made together: a dictionary and a grammar.
//
// Anyone may coin a word or draft a section of the grammar. Nothing is part of
// the language until a decision adopts it: an adopted word is official, a
// ratified section is the grammar in force, the language's statute book.
//
// The sound system is settings, so the record itself enforces it: every word
// must be spelled with the language's letters (lexicon.consonants and
// lexicon.vowels; a letter may be several characters, like "sh") and built of
// syllables of the shape lexicon.syllable, where C is a consonant, V a vowel and
// brackets mark what may be left out: "(C)V(C)" allows a, ka, ak, kak.
//
// Acts (any member):
//   word.coin      { word, pos, gloss, definition?, etymology?, example?, ipa? }
//   word.second    { entry }               support a coinage (once each; again to take it back)
//   word.withdraw  { entry }               the coiner, while it is still proposed
//   grammar.draft  { section, chapter, title, text }   a draft of a section
// Effects (by decision):
//   lexicon.adopt   { entry }                         the word becomes official
//   lexicon.revise  { entry, gloss?, definition?, example?, etymology?, ipa?, pos? }
//   lexicon.retire  { entry, reason }                 an official word goes out of use
//   grammar.ratify  { section, draft }                that draft is now the grammar
//   grammar.repeal  { section, reason }

import { actId } from '../../kernel/signed.js';
import { Parameters } from '../../kernel/parameters.js';

const SECTION = /^[a-z0-9][a-z0-9-]{0,59}$/;
const P = (state) => new Parameters(state.doc, state.catalog);
const text = (s, max, min = 1) => typeof s === 'string' && s.trim().length >= min && s.length <= max;
const opt = (s, max) => s === undefined || (typeof s === 'string' && s.length <= max);
export const entryId = (act) => 'w-' + actId(act).slice(0, 10);
const lex = (state) => (state.m.lexicon ||= { entries: {}, grammar: {} });
const entry = (state, id) => state.m.lexicon?.entries?.[id] || null;

// ── the sound system ────────────────────────────────────────────────────────
export function letters(params) {
  const list = (k) => (params.has(k) ? params.value(k) : []).map(x => String(x).toLowerCase()).filter(Boolean);
  return { C: list('lexicon.consonants'), V: list('lexicon.vowels') };
}
// Spell a word as letters, longest letter first: "shalo" → sh a l o.
export function spell(word, params) {
  const { C, V } = letters(params);
  const all = [...C.map(l => [l, 'C']), ...V.map(l => [l, 'V'])].sort((a, b) => b[0].length - a[0].length);
  const out = [];
  for (let i = 0; i < word.length;) {
    const hit = all.find(([l]) => word.startsWith(l, i));
    if (!hit) return { ok: false, bad: word[i], at: i };
    out.push(hit); i += hit[0].length;
  }
  return { ok: true, letters: out.map(x => x[0]), shape: out.map(x => x[1]).join('') };
}
// Each letter becomes one private character, so a syllable shape can name
// classes (C, V) and particular letters ("n") alike.
function compile(params) {
  const { C, V } = letters(params), code = new Map();
  [...C, ...V].forEach((l, i) => { if (!code.has(l)) code.set(l, String.fromCharCode(0xE000 + i)); });
  const cls = (ls) => '[' + ls.map(l => code.get(l)).join('') + ']';
  const syl = String(params.value('lexicon.syllable'));
  let re = '', i = 0;
  while (i < syl.length) {
    const ch = syl[i];
    if (ch === 'C') { re += cls(C); i++; } else if (ch === 'V') { re += cls(V); i++; }
    else if (ch === '(') { re += '(?:'; i++; } else if (ch === ')') { re += ')?'; i++; }
    else if (ch === ' ') { i++; }
    else {
      const l = [...code.keys()].sort((a, b) => b.length - a.length).find(x => syl.startsWith(x, i));
      if (!l) throw new Error(`lexicon.syllable names "${ch}", which is not a letter`);
      re += code.get(l); i += l.length;
    }
  }
  return { code, re: new RegExp('^(?:' + re + ')+$') };
}
// Why a word is not possible in the language, or null if it is.
export function phonotactics(word, params) {
  if (typeof word !== 'string' || !word.length) return 'a word is at least one letter';
  const w = word.toLowerCase();
  if (w !== word) return 'write words in lower case';
  for (const part of w.split(/[ -]/)) {
    if (!part) return 'a word may not start or end with a space or hyphen';
    const s = spell(part, params);
    if (!s.ok) return `"${s.bad}" is not a letter of the language (letters: ${[...letters(params).C, ...letters(params).V].join(' ')})`;
    let c; try { c = compile(params); } catch (x) { return x.message; }
    if (!c.re.test(s.letters.map(l => c.code.get(l)).join(''))) return `"${part}" (${s.shape}) cannot be split into syllables of the shape ${params.value('lexicon.syllable')}`;
  }
  return null;
}

// ── who supports what ───────────────────────────────────────────────────────
export const official = (state) => Object.values(state.m.lexicon?.entries || {}).filter(e => e.status === 'official');
export const proposed = (state) => Object.values(state.m.lexicon?.entries || {}).filter(e => e.status === 'proposed');
export const inForce = (state) => Object.values(state.m.lexicon?.grammar || {}).filter(s => s.ratified && !s.repealed);

function install(r) {
  const isMember = (state, id) => state.participants[id]?.status === 'active';
  const fields = (a, params) => {
    if (a.pos !== undefined && !(params.value('lexicon.parts') || []).includes(a.pos)) return `the part of speech is one of: ${(params.value('lexicon.parts') || []).join(', ')}`;
    if (a.gloss !== undefined && !text(a.gloss, 80)) return 'a gloss is a short translation, 1–80 characters';
    if (!opt(a.definition, 2000) || !opt(a.etymology, 500) || !opt(a.example, 500) || !opt(a.ipa, 120)) return 'definition up to 2000 characters; etymology, example up to 500; pronunciation up to 120';
    return null;
  };

  r.registerKind({
    name: 'word.coin', module: 'lexicon',
    check(state, a, { params }) {
      if (!isMember(state, a.by)) return 'only members coin words';
      const bad = phonotactics(a.word, params) || (a.word.length > params.value('lexicon.max_length') ? `a word is at most ${params.value('lexicon.max_length')} characters` : null);
      if (bad) return bad;
      if (a.pos === undefined || a.gloss === undefined) return 'a coinage needs a part of speech (pos) and a gloss';
      const f = fields(a, params); if (f) return f;
      const clash = Object.values(state.m.lexicon?.entries || {}).find(e => e.word === a.word && e.pos === a.pos && ['official', 'proposed'].includes(e.status) && e.gloss.toLowerCase() === a.gloss.toLowerCase());
      return clash ? `"${a.word}" (${a.pos}) meaning "${a.gloss}" is already ${clash.status}: ${clash.id}` : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, id = entryId(a);
      lex(state).entries[id] = { id, word: a.word, pos: a.pos, gloss: a.gloss, definition: a.definition || '', etymology: a.etymology || '', example: a.example || '', ipa: a.ipa || '',
        by: a.by, at: rec.at, status: 'proposed', seconds: [], history: [{ at: rec.at, what: 'coined', by: a.by }] };
    },
  });
  r.registerKind({
    name: 'word.second', module: 'lexicon',
    check(state, a) {
      const e = entry(state, a.entry);
      if (!e || e.status !== 'proposed') return `there is no proposed word ${a.entry}`;
      if (!isMember(state, a.by)) return 'only members second coinages';
      return e.by === a.by ? 'you coined it: others second it' : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, e = entry(state, a.entry);
      e.seconds = e.seconds.includes(a.by) ? e.seconds.filter(x => x !== a.by) : [...e.seconds, a.by];
    },
  });
  r.registerKind({
    name: 'word.withdraw', module: 'lexicon',
    check(state, a) {
      const e = entry(state, a.entry);
      if (!e || e.status !== 'proposed') return `there is no proposed word ${a.entry}`;
      return e.by === a.by ? null : 'only the coiner withdraws a coinage';
    },
    reduce(state, rec) { const e = entry(state, rec.payload.act.entry); e.status = 'withdrawn'; e.history.push({ at: rec.at, what: 'withdrawn' }); },
  });

  r.registerEffect({
    name: 'lexicon.adopt', module: 'lexicon', rule: (p) => p.value('lexicon.adopt_rule'),
    describe: (e, state) => `Adopt ${e.entry}${state && entry(state, e.entry) ? ` "${entry(state, e.entry).word}" (${entry(state, e.entry).gloss})` : ''} into the dictionary`,
    check(state, e, params) {
      const w = entry(state, e.entry);
      if (!w || w.status !== 'proposed') return `there is no proposed word ${e.entry}`;
      return phonotactics(w.word, params);
    },
  });
  r.registerRecord('lexicon.adopt', (state, rec) => {
    const w = entry(state, rec.payload.entry);
    w.status = 'official'; w.adopted = rec.at; w.history.push({ at: rec.at, what: 'adopted', proposal: rec.payload.proposal || null });
  });
  r.registerEffect({
    name: 'lexicon.revise', module: 'lexicon', rule: (p) => p.value('lexicon.adopt_rule'),
    describe: (e) => `Revise ${e.entry}: ${['pos', 'gloss', 'definition', 'example', 'etymology', 'ipa'].filter(k => e[k] !== undefined).join(', ')}`,
    check(state, e, params) {
      const w = entry(state, e.entry);
      if (!w || w.status !== 'official') return `there is no official word ${e.entry}`;
      if (!['pos', 'gloss', 'definition', 'example', 'etymology', 'ipa'].some(k => e[k] !== undefined)) return 'say what to revise';
      return fields(e, params);
    },
  });
  r.registerRecord('lexicon.revise', (state, rec) => {
    const w = entry(state, rec.payload.entry), before = {};
    for (const k of ['pos', 'gloss', 'definition', 'example', 'etymology', 'ipa']) if (rec.payload[k] !== undefined) { before[k] = w[k]; w[k] = rec.payload[k]; }
    w.history.push({ at: rec.at, what: 'revised', before, proposal: rec.payload.proposal || null });
  });
  r.registerEffect({
    name: 'lexicon.retire', module: 'lexicon', rule: (p) => p.value('lexicon.adopt_rule'),
    describe: (e) => `Retire ${e.entry}: ${e.reason}`,
    check(state, e) {
      const w = entry(state, e.entry);
      if (!w || w.status !== 'official') return `there is no official word ${e.entry}`;
      return text(e.reason, 300) ? null : 'give a reason (up to 300 characters)';
    },
  });
  r.registerRecord('lexicon.retire', (state, rec) => {
    const w = entry(state, rec.payload.entry);
    w.status = 'retired'; w.history.push({ at: rec.at, what: `retired: ${rec.payload.reason}`, proposal: rec.payload.proposal || null });
  });

  // ── the grammar ───────────────────────────────────────────────────────────
  r.registerKind({
    name: 'grammar.draft', module: 'lexicon',
    check(state, a, { params }) {
      if (!isMember(state, a.by)) return 'only members draft the grammar';
      if (!SECTION.test(a.section || '')) return 'a section id is 1–60 lowercase letters, digits and -';
      const chapters = params.value('lexicon.chapters') || [];
      if (!chapters.includes(a.chapter)) return `the chapter is one of: ${chapters.join(', ')}`;
      if (!text(a.title, 120)) return 'a section needs a title of 1–120 characters';
      return text(a.text, 20000) ? null : 'a draft is 1–20000 characters';
    },
    reduce(state, rec) {
      const a = rec.payload.act, g = lex(state).grammar;
      const s = (g[a.section] ||= { id: a.section, chapter: a.chapter, title: a.title, drafts: [], ratified: null, repealed: null, history: [] });
      s.drafts.push({ n: s.drafts.length + 1, by: a.by, at: rec.at, chapter: a.chapter, title: a.title, text: a.text });
    },
  });
  r.registerEffect({
    name: 'grammar.ratify', module: 'lexicon', rule: (p) => p.value('lexicon.grammar_rule'),
    describe: (e) => `Ratify draft ${e.draft} of the grammar section ${e.section}`,
    check(state, e) {
      const s = state.m.lexicon?.grammar?.[e.section];
      if (!s) return `there is no grammar section ${e.section}`;
      if (!s.drafts.some(d => d.n === e.draft)) return `section ${e.section} has no draft ${e.draft}`;
      return s.ratified?.draft === e.draft && !s.repealed ? 'that draft is already in force' : null;
    },
  });
  r.registerRecord('grammar.ratify', (state, rec) => {
    const s = state.m.lexicon.grammar[rec.payload.section], d = s.drafts.find(x => x.n === rec.payload.draft);
    s.ratified = { draft: d.n, at: rec.at, proposal: rec.payload.proposal || null }; s.repealed = null;
    s.title = d.title; s.chapter = d.chapter;
    s.history.push({ at: rec.at, what: `draft ${d.n} ratified`, proposal: rec.payload.proposal || null });
  });
  r.registerEffect({
    name: 'grammar.repeal', module: 'lexicon', rule: (p) => p.value('lexicon.grammar_rule'),
    describe: (e) => `Repeal the grammar section ${e.section}: ${e.reason}`,
    check(state, e) {
      const s = state.m.lexicon?.grammar?.[e.section];
      if (!s?.ratified || s.repealed) return `section ${e.section} is not in force`;
      return text(e.reason, 300) ? null : 'give a reason (up to 300 characters)';
    },
  });
  r.registerRecord('grammar.repeal', (state, rec) => {
    const s = state.m.lexicon.grammar[rec.payload.section];
    s.repealed = rec.at; s.history.push({ at: rec.at, what: `repealed: ${rec.payload.reason}`, proposal: rec.payload.proposal || null });
  });
}

export default { name: 'lexicon', core: '0.7.7', install, entryId, phonotactics, spell, letters, official, proposed, inForce,
  parameterKeys: ['lexicon.name', 'lexicon.consonants', 'lexicon.vowels', 'lexicon.syllable', 'lexicon.parts', 'lexicon.chapters', 'lexicon.max_length', 'lexicon.adopt_rule', 'lexicon.grammar_rule'] };
