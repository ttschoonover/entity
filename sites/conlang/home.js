// home.js · the language society's front page: today's word, the sound
// system as type sorts, what was adopted lately, the most-seconded coinages,
// open votes and the grammar's table of contents.
import { start, onChange, onSigned, ctx, h, $, me, displayName, joinDialog, signInDialog, setting, day, W } from './common.js';
import { drawOpen } from './floor.js';

let L = null;

// The same word for everyone all day: the day number picks it.
function todaysWord(words) {
  if (!words.length) return null;
  const sorted = [...words].sort((a, b) => a.word.localeCompare(b.word));
  return sorted[Math.floor(Date.now() / 86400000) % sorted.length];
}

function drawWotd() {
  const w = todaysWord(L.official(ctx.r.state)), box = $('#wotd-body');
  if (!w) { box.replaceChildren(h('p', { class: 'empty' }, 'No official words yet. The first one adopted will appear here.')); return; }
  box.replaceChildren(...[
    h('p', { class: 'wotd-word', lang: 'x-conlang' }, w.word),
    h('p', { class: 'wotd-line' }, w.ipa ? h('span', { class: 'lex-ipa' }, `/${w.ipa}/`) : null, h('span', { class: 'lex-pos' }, w.pos)),
    h('p', { class: 'wotd-gloss' }, w.gloss),
    w.definition ? h('p', { class: 'fine' }, w.definition) : null,
    w.example ? h('p', { class: 'wotd-ex', lang: 'x-conlang' }, w.example) : null,
    h('p', { class: 'more' }, h('a', { href: `dictionary.html#${w.id}` }, 'In the dictionary'))].filter(Boolean));
}

function drawSounds() {
  const { C, V } = L.letters(ctx.r.params);
  $('#cons').replaceChildren(...C.map(l => h('span', { class: 'sort' }, l)));
  $('#vows').replaceChildren(...V.map(l => h('span', { class: 'sort vowel' }, l)));
  $('#syll').textContent = setting('lexicon.syllable', '');
  const name = setting('lexicon.name', '');
  $('#lang-name').textContent = name && name !== 'the language' ? name : '';
}

function drawState() {
  const s = ctx.r.state, off = L.official(s), pend = L.proposed(s), gram = L.inForce(s);
  $('#state-meta').textContent = `${off.length} official word${off.length === 1 ? '' : 's'}, ${pend.length} coinage${pend.length === 1 ? '' : 's'} awaiting a vote, ${gram.length} section${gram.length === 1 ? '' : 's'} of grammar in force.`;
  const row = (e, extra) => h('li', {}, h('a', { class: 'wl-word', href: `dictionary.html#${e.id}`, lang: 'x-conlang' }, e.word), h('span', { class: 'wl-pos' }, e.pos), h('span', { class: 'wl-gloss' }, e.gloss), extra ? h('span', { class: 'fine' }, extra) : null);
  const recent = [...off].sort((a, b) => (a.adopted < b.adopted ? 1 : -1)).slice(0, 6);
  $('#recent').replaceChildren(...(recent.length ? recent.map(e => row(e, ` ${day(e.adopted)}`)) : [h('li', { class: 'empty' }, 'Nothing adopted yet.')]));
  const wanted = [...pend].sort((a, b) => b.seconds.length - a.seconds.length).slice(0, 6);
  $('#wanted').replaceChildren(...(wanted.length ? wanted.map(e => row(e, ` ${e.seconds.length} second${e.seconds.length === 1 ? '' : 's'}`)) : [h('li', { class: 'empty' }, 'No coinages waiting.')]));
  const chapters = setting('lexicon.chapters', []);
  $('#gram').replaceChildren(...chapters.map(ch => {
    const here = gram.filter(x => x.chapter === ch);
    return h('li', {}, h('a', { href: 'grammar.html' }, ch[0].toUpperCase() + ch.slice(1)), h('span', { class: 'fine' }, here.length ? ` · ${here.map(x => x.title).join(', ')}` : ' · nothing ratified yet'));
  }));
}

function drawJoin() {
  const btn = $('#join'), note = $('#join-note'), p = me();
  if (!p) {
    btn.hidden = false; btn.onclick = () => joinDialog();
    note.replaceChildren('Already a member? ', h('button', { class: 'linklike', type: 'button', onclick: () => signInDialog() }, 'Sign in'), '.');
  } else if (p.status === 'applicant') { btn.hidden = true; note.textContent = `Your application is in; the ${W().many} vote on it.`; }
  else { btn.hidden = true; note.textContent = `Signed in as ${displayName(p.id)}.`; }
}

function draw() {
  if (!ctx.r.ok) { $('#wotd-body').replaceChildren(h('p', { class: 'empty' }, 'The record did not verify, so nothing is shown.')); return; }
  if (!L) { $('#wotd-body').replaceChildren(h('p', { class: 'empty' }, 'The dictionary is not switched on.')); return; }
  drawWotd(); drawSounds(); drawState(); drawOpen($('#bills'), { empty: 'Nothing before the society right now.' }); drawJoin();
}

await start();
if (ctx.r.ok) { try { L = await import(`${ctx.r.base}modules/lexicon/index.js`); } catch { /* not installed */ } }
draw();
onChange(() => { if (!document.querySelector('dialog[open]')) draw(); });
onSigned(draw);
if (location.hash === '#join' && !me()) joinDialog();
