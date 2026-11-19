#!/usr/bin/env bash
# make-conlang.sh · a society that builds a language together, with its own
# website: a dictionary and a grammar, both made official only by vote.
#
#   bash make-conlang.sh your-id ["Society Name"] ["Language"] [folder] [port] [hostname]
#   e.g. bash make-conlang.sh tim "The Velani Society" Velani conlang 7870 velani.poezine.org
#
# The sound system is settings the record enforces: every word must use the
# language's letters and fit its syllable shape. It starts with a small sample
# (ten words, two sections of grammar) so the site has something to show; change
# the sounds by vote (lexicon.consonants, lexicon.vowels, lexicon.syllable)
# before you begin in earnest, or keep them. SEED=0 skips the sample.

ME="${1:?usage: make-conlang.sh your-id [\"Society Name\"] [\"Language\"] [folder] [port] [hostname]}"
NAME="${2:-The Language Society}"; LANG_NAME="${3:-Velani}"; FOLDER="${4:-conlang}"; PORT="${5:-7870}"; HOST="${6:-}"; SITE=conlang
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

cat > presets/_conlang.yml <<YML
_: A society building a constructed language. A dictionary and a grammar,
   official only by vote. Headless: its website is website/.
modules: [deliberation, titles, vocabulary, passwords, lexicon, wiki, chat, polls]
set:
  entity.name: $(json "$NAME")
  lexicon.name: $(json "$LANG_NAME")
  vocabulary.participant: "member"
  vocabulary.participants: "members"
  vocabulary.assembly: "Society"
  vocabulary.proposal: "motion"
  membership.admission: "decision"
  deliberation.period: 5
  chat.channels:
    - { id: salon, title: The salon, about: "Words, sounds, sentences: talk the language over.", read: members, post: members }
    - { id: practice, title: Practice, about: "Write in the language. Mistakes welcome.", read: public, post: members }
YML
found_it _conlang

if [ "${SEED:-1}" != 0 ]; then
  echo "== A sample to start from"
  coin() { E act word.coin --as "$ME" --word "$1" --pos "$2" --gloss "$3" ${4:+--example "$4"} --settle >/dev/null && printf '  %-12s %-10s %s\n' "$1" "$2" "$3"; }
  coin sela noun "sun" "sela hapi"
  coin mira noun "water"
  coin tavan noun "house" "tavan hapi"
  coin kelu noun "friend" "ena vesan kelu"
  coin nomi noun "word" "ena vesan nomi"
  coin vesan verb "speak" "tu vesan nomi"
  coin pirun verb "make" "ena pirun tavan"
  coin hapi adjective "good"
  coin ena pronoun "I"
  coin tu pronoun "you"
  ADOPT=$(node --input-type=module -e "
import { openEntity } from './cli/context.js';
const e = await openEntity({});
console.log(JSON.stringify(Object.values(e.state.m.lexicon.entries).filter(w => w.status === 'proposed').map(w => ({ kind: 'lexicon.adopt', entry: w.id }))));")
  decide "Adopt the first ten words" "$ADOPT"
  E act grammar.draft --as "$ME" --section word-order --chapter syntax --title "Word order" --settle --text "A sentence is subject, verb, object: *ena vesan nomi*, I speak a word.

An adjective follows the noun it describes: *tavan hapi*, a good house." >/dev/null
  E act grammar.draft --as "$ME" --section plurals --chapter morphology --title "Plural nouns" --settle --text "A noun ending in a vowel adds *-n* in the plural: *kelu*, friend; *kelun*, friends.

A noun ending in *n* adds *-en*: *tavan*, house; *tavanen*, houses." >/dev/null
  decide "Ratify word order and plurals" '[{"kind":"grammar.ratify","section":"word-order","draft":1},{"kind":"grammar.ratify","section":"plurals","draft":1}]'
fi

install_site
finish_up "  Next:
  1. Decide the sounds first: propose new letters or a new syllable shape (lexicon.consonants, lexicon.vowels, lexicon.syllable) if the sample's are not yours.
  2. Invite members: they apply on the front page and the Society votes them in.
  3. Coin words in the Dictionary, second the ones you like, and propose adopting them in batches."
