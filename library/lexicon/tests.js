// Lexicon: the sound system checks every word; coinages become official only
// by decision; seconds, withdrawal, revision and retirement; grammar drafts
// ratified into force and repealed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import lexicon, { phonotactics, spell } from './index.js';
import { Parameters } from '../../kernel/parameters.js';

const act = async (w, kind, by, fields = {}) => w.settle(await w.sign(kind, by, fields));
const ok = (r) => assert.equal(r.applied.length, 1, r.refused[0]?.reason);
const no = (r, re) => { assert.equal(r.applied.length, 0); assert.match(r.refused[0].reason, re); };

test('lexicon: phonotactics from the settings', async () => {
  const w = await worldWith(['lexicon'], { people: 1 });
  const p = new Parameters(w.state.doc, w.state.catalog);
  assert.equal(phonotactics('kalan', p), null);    // ka-lan
  assert.equal(phonotactics('a', p), null);
  assert.match(phonotactics('kalt', p), /cannot be split/);  // t may not close a syllable
  assert.match(phonotactics('bala', p), /"b" is not a letter/);
  assert.match(phonotactics('Kala', p), /lower case/);
  assert.equal(phonotactics('vela mon', p), null);
  // Several-character letters, longest first.
  const p2 = { has: () => true, value: (k) => ({ 'lexicon.consonants': ['s', 'sh', 'n'], 'lexicon.vowels': ['a', 'o'], 'lexicon.syllable': 'CV(n)' })[k] };
  assert.deepEqual(spell('shason', p2).letters, ['sh', 'a', 's', 'o', 'n']);
  assert.equal(phonotactics('shason', p2), null);
});

test('lexicon: coin, second, adopt by decision, revise, retire; grammar in force', async () => {
  const w = await worldWith(['lexicon'], { people: 3 });
  const [a, b, c] = w.ids;
  no(await act(w, 'word.coin', a, { word: 'xyz', pos: 'noun', gloss: 'thing' }), /not a letter/);
  no(await act(w, 'word.coin', a, { word: 'sela', pos: 'thing', gloss: 'sun' }), /part of speech/);
  const coin = await w.sign('word.coin', a, { word: 'sela', pos: 'noun', gloss: 'sun', example: 'sela hin' });
  ok(await w.settle(coin));
  const id = lexicon.entryId(coin);
  no(await act(w, 'word.coin', b, { word: 'sela', pos: 'noun', gloss: 'Sun' }), /already proposed/);
  no(await act(w, 'word.second', a, { entry: id }), /others second it/);
  ok(await act(w, 'word.second', b, { entry: id }));
  assert.deepEqual(w.state.m.lexicon.entries[id].seconds, [b]);

  const r = await decide(w, { title: 'Adopt sela', rule: 'ordinary', effects: [{ kind: 'lexicon.adopt', entry: id }] }, b);
  assert.ok(r.enacted, r.notEnacted || r.refused?.[0]?.reason);
  assert.equal(lexicon.official(w.state).length, 1);
  no(await act(w, 'word.withdraw', a, { entry: id }), /no proposed word/);
  const rv = await decide(w, { title: 'Sela is also day', rule: 'ordinary', effects: [{ kind: 'lexicon.revise', entry: id, definition: 'The sun; by extension, a day.' }] }, c);
  assert.ok(rv.enacted, rv.notEnacted);
  assert.equal(w.state.m.lexicon.entries[id].definition, 'The sun; by extension, a day.');
  const rt = await decide(w, { title: 'Retire sela', rule: 'ordinary', effects: [{ kind: 'lexicon.retire', entry: id, reason: 'replaced by solan' }] }, c);
  assert.ok(rt.enacted, rt.notEnacted);
  assert.equal(w.state.m.lexicon.entries[id].status, 'retired');

  no(await act(w, 'grammar.draft', a, { section: 'plurals', chapter: 'cooking', title: 'Plurals', text: 'x' }), /chapter is one of/);
  ok(await act(w, 'grammar.draft', a, { section: 'plurals', chapter: 'morphology', title: 'Plurals', text: 'Nouns take -n in the plural.' }));
  ok(await act(w, 'grammar.draft', b, { section: 'plurals', chapter: 'morphology', title: 'Plural nouns', text: 'Nouns add -n after a vowel.' }));
  const g = await decide(w, { title: 'Ratify plurals', rule: 'organic', effects: [{ kind: 'grammar.ratify', section: 'plurals', draft: 2 }] }, a);
  assert.ok(g.enacted, g.notEnacted || g.refused?.[0]?.reason);
  assert.equal(lexicon.inForce(w.state)[0].title, 'Plural nouns');
  const gr = await decide(w, { title: 'Repeal plurals', rule: 'organic', effects: [{ kind: 'grammar.repeal', section: 'plurals', reason: 'no plurals after all' }] }, a);
  assert.ok(gr.enacted, gr.notEnacted);
  assert.equal(lexicon.inForce(w.state).length, 0);
});
