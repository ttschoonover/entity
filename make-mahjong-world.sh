#!/usr/bin/env bash
# make-mahjong-world.sh · a mahjong world: its own entity, its own record and,
# when Radicle is set up on this computer, its own Radicle repository, so the
# world's record is replicated by every peer that follows it.
#
#   bash make-mahjong-world.sh your-id ["World Name"] [folder] [port] [hostname]
#   e.g. bash make-mahjong-world.sh tim "Friday Mahjong" mahjong-friday 7890 mahjong.poezine.org
#
# Run it once per world: each run makes a separate world with separate tables
# and standings. Inside a world:
#   - anyone opens a table and sends the link; friends sit with just a name (their
#     browser makes a key for them); empty seats are AIs
#   - every hand's wall is committed before it is dealt and revealed after, and
#     every browser checks it; finished matches are recorded on the world's record,
#     signed by you as the keeper, and replayed by the record before they count
#   - members (open to anyone, optional) also get solo games on their profile
# Solo play needs nothing at all: website/mahjong-solo.html runs offline.

ME="${1:?usage: make-mahjong-world.sh your-id [\"World Name\"] [folder] [port] [hostname]}"
NAME="${2:-Mahjong}"
SLUG="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//')"
case "$SLUG" in *mahjong*) DEF="$SLUG" ;; *) DEF="mahjong-${SLUG:-world}" ;; esac
FOLDER="${3:-$DEF}"; PORT="${4:-7890}"; HOST="${5:-}"; SITE=mahjong
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

cat > presets/_mahjong.yml <<YML
_: A mahjong world. Live tables for friends and AIs, solo games for profiles,
   every result replayed by the record. Headless: its website is website/.
modules: [deliberation, titles, vocabulary, passwords, mahjong, chat, polls]
set:
  entity.name: $(json "$NAME")
  vocabulary.participant: "player"
  vocabulary.participants: "players"
  vocabulary.assembly: "Table"
  vocabulary.proposal: "proposal"
  membership.admission: "open"
  mahjong.keeper: $(json "$ME")
  chat.channels:
    - { id: lobby, title: Lobby, about: "Find players, arrange a game.", read: public, post: members }
    - { id: tea-room, title: Tea room, about: "Between hands.", read: members, post: members }
YML
found_it _mahjong

[ -f "$DIR/sites/mahjong/mahjong-solo.html" ] || node "$DIR/tools/build-mahjong-solo.mjs" >/dev/null
install_site
node --input-type=module -e "
import { openEntity, keyDir } from '$DIR/cli/context.js'; import fs from 'node:fs';
const e = await openEntity({ dir: '$DIR' }); const f = keyDir(e.state.entity.id) + '/$ME';
console.log(fs.existsSync(f) ? '  your key is on this computer: finished tables will be recorded, signed by you' : '  no key file for $ME here: tables are played and kept by the node, but not recorded on the record');" 2>/dev/null || true

finish_up "  Next:
  1. Open http://localhost:$PORT${HOST:+ (or https://$HOST)}, then Tables › Open a table, and send its link to friends.
  2. They sit with a name; no account needed. Start when ready; empty seats play as AIs.
  3. Results appear under Standings once a match ends. Solo: Play solo, or website/mahjong-solo.html offline.
  4. To make another world, run this script again with another name."
