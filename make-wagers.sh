#!/usr/bin/env bash
# make-wagers.sh · a betting club that plays for points, never money, with its
# own website: pools, over/unders, challenges and a prediction market, settled
# by an arbiter the members elect.
#
#   bash make-wagers.sh your-id ["Club Name"] [folder] [port] [hostname] [starting points]
#   e.g. bash make-wagers.sh tim "The Paddock" paddock 7880 paddock.poezine.org 1000
#
# Points are issued only by vote. The founder gets the starting points; give
# new members theirs by adding a value.issue effect when you admit them. The
# arbiter office is created and an election called; until someone holds it,
# bets are settled by vote (wager.decide). An arbiter may not bet in office.

ME="${1:?usage: make-wagers.sh your-id [\"Club Name\"] [folder] [port] [hostname] [starting points]}"
NAME="${2:-The Paddock}"; FOLDER="${3:-paddock}"; PORT="${4:-7880}"; HOST="${5:-}"; START_POINTS="${6:-1000}"; SITE=wagers
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

cat > presets/_wagers.yml <<YML
_: A betting club for points, never money. Pools, lines, challenges and a
   prediction market, settled by an elected arbiter. Headless: its website is website/.
modules: [deliberation, titles, vocabulary, passwords, value, offices, elections, wagers, chat, polls]
set:
  entity.name: $(json "$NAME")
  value.name: "points"
  value.decimals: 0
  value.transferable: true
  vocabulary.participant: "member"
  vocabulary.participants: "members"
  vocabulary.assembly: "Club"
  vocabulary.proposal: "motion"
  membership.admission: "decision"
  deliberation.period: 3
  chat.channels:
    - { id: the-rail, title: The rail, about: "Tips, trash talk, and what really happened.", read: members, post: members }
    - { id: results, title: Results, about: "Sources for results, for the arbiter and for appeals.", read: public, post: members }
YML
found_it _wagers

echo "== Points and the arbiter"
decide "Starting points, and the office of arbiter" "$(cat <<JSON
[{"kind":"value.issue","to":"$ME","amount":$START_POINTS,"memo":"founding points"},
 {"kind":"office.create","office":"arbiter","title":"Arbiter","seats":1,"term_days":180},
 {"kind":"election.call","election":"arbiter-1","office":"arbiter","method":"approval","stand_days":7,"vote_days":3}]
JSON
)"

install_site
finish_up "  Next:
  1. Invite members: they apply on the front page; admit them with a motion that also issues their points (value.issue).
  2. Someone who will not bet stands for arbiter (Elections, 7 days), then the club votes (3 days).
  3. Open the first market: Place a bet › Open a bet › Prediction market."
