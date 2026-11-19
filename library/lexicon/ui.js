// The lexicon tab: the dictionary (official words, then coinages awaiting a
// vote), a glosser that reads a sentence word by word, the coinage form with a
// live check against the sound system, and the grammar (path "grammar").
import { phonotactics, letters, official, proposed, inForce } from './index.js';

const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);
const STATUS = { official: 'Official', proposed: 'Proposed', retired: 'Retired', withdrawn: 'Withdrawn' };

function entryView(api, e) {
  const { h, me, who, when } = api;
  const mine = me && e.by === me.id, seconded = me && e.seconds?.includes(me.id);
  return h('li', { class: `lex-entry lex-${e.status}`, id: e.id },
    h('div', { class: 'lex-head' },
      h('span', { class: 'lex-word', lang: 'x-conlang' }, e.word),
      e.ipa ? h('span', { class: 'lex-ipa' }, `/${e.ipa}/`) : null,
      h('span', { class: 'lex-pos' }, e.pos),
      h('span', { class: 'lex-status' }, STATUS[e.status] || e.status)),
    h('p', { class: 'lex-gloss' }, e.gloss),
    e.definition ? h('p', { class: 'lex-def' }, e.definition) : null,
    e.example ? h('p', { class: 'lex-ex', lang: 'x-conlang' }, e.example) : null,
    e.etymology ? h('p', { class: 'fine' }, `From ${e.etymology}`) : null,
    h('p', { class: 'meta' }, 'coined by ', who(e.by), ` · ${when(e.at)}`, e.status === 'proposed' ? ` · ${e.seconds.length} second${e.seconds.length === 1 ? '' : 's'}` : '', e.adopted ? ` · adopted ${when(e.adopted)}` : ''),
    me?.status === 'active' && e.status === 'proposed' ? h('div', { class: 'buttons' },
      !mine ? h('button', { class: 'quiet', onclick: () => api.sign('word.second', { entry: e.id }, seconded ? `Taking back your second of "${e.word}"` : `Seconding "${e.word}"`) }, seconded ? 'Unsecond' : 'Second') : null,
      h('button', { class: 'quiet', onclick: () => api.propose(`Adopt "${e.word}" (${e.gloss})`, [{ kind: 'lexicon.adopt', entry: e.id }]) }, 'Propose adopting'),
      mine ? h('button', { class: 'danger', onclick: () => api.sign('word.withdraw', { entry: e.id }, `Withdrawing "${e.word}"`) }, 'Withdraw') : null) : null,
    me?.status === 'active' && e.status === 'official' ? h('details', {}, h('summary', {}, 'Propose a revision'), h('div', { class: 'inline-form' },
      h('label', { for: `rv-${e.id}` }, 'New definition'), h('textarea', { id: `rv-${e.id}`, rows: 3 }, e.definition),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.propose(`Revise "${e.word}"`, [{ kind: 'lexicon.revise', entry: e.id, definition: api.$(`#rv-${e.id}`).value.trim() }]) }, 'Propose'),
        h('button', { class: 'danger', onclick: () => { const reason = prompt(`Why should "${e.word}" be retired?`); if (reason) api.propose(`Retire "${e.word}"`, [{ kind: 'lexicon.retire', entry: e.id, reason }]); } }, 'Propose retiring')))) : null);
}

function dictionary(api) {
  const { h, state, me, $, params } = api;
  const L = letters(params), name = params.value('lexicon.name');
  const off = official(state), pending = proposed(state).sort((a, b) => b.seconds.length - a.seconds.length);
  const sec = h('section', { class: 'lexicon' }, h('h2', {}, `The dictionary of ${name}`),
    h('p', { class: 'hint' }, `${off.length} official word${off.length === 1 ? '' : 's'}, ${pending.length} awaiting a vote. A word is part of the language once a decision adopts it. `, api.link('lexicon/grammar', 'Read the grammar'), '.'),
    h('div', { class: 'lex-sounds' },
      h('p', {}, h('strong', {}, 'Consonants '), ...L.C.map(l => h('span', { class: 'lex-letter' }, l))),
      h('p', {}, h('strong', {}, 'Vowels '), ...L.V.map(l => h('span', { class: 'lex-letter' }, l))),
      h('p', {}, h('strong', {}, 'Syllable '), h('code', {}, params.value('lexicon.syllable')), h('span', { class: 'fine' }, '  C consonant · V vowel · (…) optional'))));

  // The glosser: a sentence, word by word, from the official dictionary.
  const byWord = new Map();
  for (const e of off) byWord.set(e.word, [...(byWord.get(e.word) || []), e]);
  const out = h('div', { class: 'lex-gloss-out', 'aria-live': 'polite' });
  const gloss = () => {
    const words = $('#lx-sent').value.toLowerCase().split(/[\s.,!?;:]+/).filter(Boolean);
    out.replaceChildren(...words.map(w => {
      const hit = byWord.get(w);
      return h('span', { class: hit ? 'lex-g' : 'lex-g unknown' }, h('span', { class: 'lex-g-w' }, w), h('span', { class: 'lex-g-t' }, hit ? hit.map(x => x.gloss).join(' / ') : phonotactics(w, params) ? 'not possible' : '?'));
    }));
  };
  sec.append(h('div', { class: 'lex-glosser' }, h('label', { for: 'lx-sent' }, 'Read a sentence'), h('input', { id: 'lx-sent', placeholder: 'Type a sentence in the language', oninput: gloss, autocomplete: 'off' }), out));

  sec.append(h('h3', {}, 'Official words'), api.list({
    key: 'lex-official', items: off, noun: 'words', empty: 'No official words yet. Coin one, then propose adopting it.',
    text: (e) => `${e.word} ${e.gloss} ${e.definition} ${e.pos}`,
    sorts: [['A–Z', api.sorts.byText((e) => e.word)], ['By meaning', api.sorts.byText((e) => e.gloss)], ['Newest first', (a, b) => (a.adopted < b.adopted ? 1 : -1)]],
    render: (e) => entryView(api, e),
  }));
  sec.append(h('h3', {}, 'Awaiting a vote'), api.list({
    key: 'lex-proposed', items: pending, noun: 'coinages', empty: 'No coinages waiting.', mine: me ? (e) => e.by === me.id : null,
    text: (e) => `${e.word} ${e.gloss} ${e.definition} ${e.pos} ${nm(api, e.by)}`,
    sorts: [['Most seconded', (a, b) => b.seconds.length - a.seconds.length], ['A–Z', api.sorts.byText((e) => e.word)], ['Newest first', api.sorts.newest()]],
    render: (e) => entryView(api, e),
  }));
  const ready = pending.filter(e => e.seconds.length >= 2);
  if (me?.status === 'active' && ready.length > 1) sec.append(h('p', {}, h('button', { class: 'quiet', onclick: () => api.propose(`Adopt ${ready.length} seconded words`, ready.map(e => ({ kind: 'lexicon.adopt', entry: e.id }))) }, `Propose adopting all ${ready.length} words with two or more seconds`)));

  if (me?.status === 'active') {
    const verdict = h('p', { class: 'lex-verdict', 'aria-live': 'polite' });
    const check = () => { const w = $('#lx-w').value.trim(); const bad = w ? phonotactics(w, params) : null; verdict.textContent = !w ? '' : bad || `“${w}” fits the sound system.`; verdict.className = `lex-verdict ${bad ? 'bad' : 'good'}`; };
    sec.append(h('details', {}, h('summary', {}, 'Coin a word'), h('div', { class: 'inline-form' },
      h('label', { for: 'lx-w' }, 'Word'), h('input', { id: 'lx-w', oninput: check, autocomplete: 'off', lang: 'x-conlang' }), verdict,
      h('label', { for: 'lx-p' }, 'Part of speech'), h('select', { id: 'lx-p' }, (params.value('lexicon.parts') || []).map(p => h('option', { value: p }, p))),
      h('label', { for: 'lx-g' }, 'Gloss (a short English meaning)'), h('input', { id: 'lx-g' }),
      h('label', { for: 'lx-d' }, 'Definition (optional)'), h('textarea', { id: 'lx-d', rows: 3 }),
      h('label', { for: 'lx-x' }, 'Example sentence (optional)'), h('input', { id: 'lx-x' }),
      h('label', { for: 'lx-e' }, 'Etymology (optional)'), h('input', { id: 'lx-e', placeholder: 'from sela "sun" + -n' }),
      h('label', { for: 'lx-i' }, 'Pronunciation in IPA (optional)'), h('input', { id: 'lx-i' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const f = { word: $('#lx-w').value.trim(), pos: $('#lx-p').value, gloss: $('#lx-g').value.trim() };
        for (const [k, id] of [['definition', 'lx-d'], ['example', 'lx-x'], ['etymology', 'lx-e'], ['ipa', 'lx-i']]) if ($(`#${id}`).value.trim()) f[k] = $(`#${id}`).value.trim();
        api.sign('word.coin', f, `Your coinage "${f.word}"`);
      } }, 'Coin it')))));
  }
  return sec;
}

function grammar(api) {
  const { h, state, me, $, params, who, when } = api;
  const chapters = params.value('lexicon.chapters') || [];
  const all = Object.values(state.m.lexicon?.grammar || {});
  const force = inForce(state);
  const sec = h('section', { class: 'lexicon grammar' }, h('h2', {}, `The grammar of ${params.value('lexicon.name')}`),
    h('p', { class: 'hint' }, `${force.length} section${force.length === 1 ? '' : 's'} in force. Anyone may draft; a section is the grammar once a decision ratifies it. `, api.link('lexicon', 'Back to the dictionary'), '.'));
  chapters.forEach((ch, ci) => {
    const here = all.filter(s => s.chapter === ch).sort((a, b) => a.id.localeCompare(b.id));
    sec.append(h('h3', { class: 'gr-chapter' }, `${ci + 1}. ${ch[0].toUpperCase()}${ch.slice(1)}`));
    if (ch === 'phonology') {
      const L = letters(params);
      sec.append(h('p', { class: 'gr-auto' }, `Set by the settings: consonants ${L.C.join(' ')}; vowels ${L.V.join(' ')}; syllables of the shape ${params.value('lexicon.syllable')}.`));
    }
    if (!here.length) { sec.append(h('p', { class: 'empty' }, 'Nothing drafted yet.')); return; }
    here.forEach((s, si) => {
      const live = s.ratified && !s.repealed ? s.drafts.find(d => d.n === s.ratified.draft) : null;
      const newer = s.drafts.filter(d => !live || d.n > live.n);
      sec.append(h('article', { class: live ? 'gr-section in-force' : 'gr-section draft', id: `g-${s.id}` },
        h('h4', {}, `${ci + 1}.${si + 1} ${s.title} `, h('span', { class: 'hint' }, live ? `· in force since ${when(s.ratified.at)}` : s.repealed ? '· repealed' : '· draft only')),
        live ? h('div', { class: 'post-body statute' }, live.text) : null,
        newer.length ? h('details', { open: !live }, h('summary', {}, `${newer.length} draft${newer.length === 1 ? '' : 's'} awaiting ratification`),
          newer.map(d => h('div', { class: 'gr-draft' }, h('p', { class: 'meta' }, `Draft ${d.n} by `, who(d.by), ` · ${when(d.at)}`), h('div', { class: 'post-body' }, d.text),
            me?.status === 'active' ? h('button', { class: 'quiet', onclick: () => api.propose(`Ratify “${d.title}” (draft ${d.n})`, [{ kind: 'grammar.ratify', section: s.id, draft: d.n }]) }, 'Propose ratifying') : null))) : null));
    });
  });
  if (me?.status === 'active') sec.append(h('details', {}, h('summary', {}, 'Draft a section'), h('div', { class: 'inline-form' },
    h('label', { for: 'gr-c' }, 'Chapter'), h('select', { id: 'gr-c' }, chapters.map(c => h('option', { value: c }, c))),
    h('label', { for: 'gr-s' }, 'Section id (reuse one to redraft it)'), h('input', { id: 'gr-s', placeholder: 'noun-plurals' }),
    h('label', { for: 'gr-t' }, 'Title'), h('input', { id: 'gr-t' }),
    h('label', { for: 'gr-x' }, 'Text'), h('textarea', { id: 'gr-x', rows: 8 }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('grammar.draft', { chapter: $('#gr-c').value, section: $('#gr-s').value.trim(), title: $('#gr-t').value.trim(), text: $('#gr-x').value }, 'Your draft') }, 'Sign this draft')))));
  return sec;
}

export const tabs = [{ id: 'lexicon', title: 'Dictionary', render: (api, path = []) => (path[0] === 'grammar' ? grammar(api) : dictionary(api)) }];
