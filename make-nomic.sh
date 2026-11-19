#!/usr/bin/env bash
# make-nomic.sh · a game of Nomic on the public record, with its own website.
#
#   bash make-nomic.sh your-id ["Table Name"] [folder] [port] [hostname]
#   e.g. bash make-nomic.sh tim "Nomic" nomic 7860 nomic.poezine.org
#
# Players take turns proposing changes to the rules; everyone votes; a change
# that passes scores its proposer. The game starts with the initial rules
# below (after Peter Suber's 1982 design, rewritten for this record); the
# players can change all of them, including how to win.

ME="${1:?usage: make-nomic.sh your-id [\"Table Name\"] [folder] [port] [hostname]}"
NAME="${2:-Nomic}"; FOLDER="${3:-nomic}"; PORT="${4:-7860}"; HOST="${5:-}"; SITE=nomic
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

cat > presets/_nomic.yml <<YML
_: A game of Nomic. Players take turns proposing changes to the rules and vote
   on them; passing changes score. Headless: its website is website/.
modules: [deliberation, titles, vocabulary, passwords, nomic, chat, polls]
set:
  entity.name: $(json "$NAME")
  vocabulary.participant: "player"
  vocabulary.participants: "players"
  vocabulary.assembly: "Table"
  vocabulary.proposal: "proposal"
  membership.admission: "decision"
  deliberation.period: 3
  chat.channels:
    - { id: table-talk, title: Table talk, about: "The game, its rules, and anything else.", read: members, post: members }
    - { id: lobby, title: Lobby, about: "For visitors: ask about the game, or ask for a seat.", read: public, post: members }
YML
found_it _nomic

echo "== The initial rules"
RULES=$(node -e '
const I = (number, title, text) => ({ kind: "nomic.enact", number, title, text, mutable: false });
const M = (number, title, text) => ({ kind: "nomic.enact", number, title, text });
console.log(JSON.stringify([
  I(101, "Obey the rules", "Every player must obey the rules in force. The rules in force are those enacted and not repealed, as the record shows them."),
  I(102, "The two kinds of rule", "Rules numbered 100 to 199 begin immutable; rules numbered 200 and up begin mutable. An immutable rule cannot be amended or repealed until it is transmuted into a mutable one."),
  I(103, "What a rule change is", "A rule change is the enactment, amendment, repeal or transmutation of a rule, made by a proposal of the players that passes. A single proposal may carry several rule changes; they pass or fail together."),
  I(104, "How changes are decided", "Mutable rules change under the rule the record calls nomic.amend_rule. Transmutation, and enacting a rule as immutable, need the stricter rule nomic.transmute_rule. Every player may vote on every proposal."),
  I(105, "When a change takes effect", "A rule change takes effect when the proposal carrying it passes and is settled on the record, and never before. No rule change applies to events before it took effect."),
  I(106, "Immutable over mutable", "Where an immutable rule and a mutable rule conflict, the immutable rule prevails. Where two rules of the same kind conflict, the one with the lower number prevails, unless one of them says it takes precedence."),
  I(107, "The record is the game", "The public record is the only account of the game: its rules, turns, votes and scores. What is not on the record did not happen in the game."),
  I(108, "Nothing is forbidden that is not", "Whatever the rules do not forbid or regulate is permitted, including changing these rules by the rules."),
  M(201, "Turns", "Players take turns in the order they joined. A turn lasts until its player ends it, or until nomic.turn_days days have passed, after which any player may end it."),
  M(202, "One proposal a turn", "On their turn a player may make one proposal that changes the game. A proposal that changes the game is one carrying any rule change or changing any setting named nomic."),
  M(203, "Points for passing", "When a proposal passes, its proposer gains nomic.points_adopted points. Each player who voted against a proposal that passes anyway gains nomic.points_dissent points."),
  M(204, "Winning", "The first player whose score reaches nomic.win_points wins the game. Once the game is won, any player may propose a new game, which sets every score to zero and keeps the rules as they stand."),
  M(205, "Rules and numbers", "Where a rule names a setting (nomic.something), the record enforces the setting. A proposal that changes what such a rule says should change its setting too; until it does, the setting governs play."),
  M(206, "Calls for judgment", "Any player may call for judgment on what a rule means. The judge, named by a proposal, answers true, false or undecided, with reasons. A judge never answers their own call."),
  M(207, "Judgments bind", "A judgment stands as the meaning of the rule until a later judgment or a rule change says otherwise."),
  M(208, "New players", "New players are seated by a vote of the players. They begin with zero points and take their turn after the player who joined before them."),
  M(209, "Leaving", "A player may leave at any time. Their points are kept on the record but they take no further turns."),
  M(210, "Good faith", "Players argue in good faith in table talk. Persuasion, alliances and trades of support are part of the game; deception about what the record says is not."),
  { kind: "nomic.judge", member: process.argv[1] },
  { kind: "nomic.new_game" },
]));' "$ME")
decide "The initial rules, and a first judge" "$RULES"
E act nomic.pass --as "$ME" --settle >/dev/null 2>&1 || true

install_site
finish_up "  Next:
  1. Invite players: they ask for a seat on the front page, and the Table votes them in.
  2. You are the first judge, and you play too: a judge never rules on their own call. Name another judge once others are seated.
  3. Read the rules (Rules & scores), then on your turn, propose a change."
