#!/usr/bin/env bash
# make-docs.sh · a writing room: documents written together, with its own website.
#
#   bash make-docs.sh your-id ["Room Name"] [folder] [port] [hostname]
#   e.g. bash make-docs.sh tim "The Writing Room" docs 7900 docs.poezine.org
#
# Members keep documents of their own: encrypted in their browsers, shared by
# role (viewer, commenter, editor, owner) with a person, every member, an
# office or a committee. The room keeps documents of its own too, which change
# only when a decision (or a committee it empowers) adopts a draft. The text
# lives in documents/ and travels with the room's Radicle repository; the
# record says who may do what, never what a document says.
#
# Any other entity gets the same by installing the docs module by decision and
# adding docs.html to its website (it is in the site kit).

ME="${1:?usage: make-docs.sh your-id [\"Room Name\"] [folder] [port] [hostname]}"
NAME="${2:-The Writing Room}"; FOLDER="${3:-docs}"; PORT="${4:-7900}"; HOST="${5:-}"; SITE=docs
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

cat > presets/_docs.yml <<YML
_: A writing room. Documents of members' own, shared by role and encrypted in
   the browser; documents of the room's, changed by decision. Headless: its
   website is website/.
modules: [deliberation, titles, vocabulary, passwords, docs, committees, authority, chat, polls]
set:
  entity.name: $(json "$NAME")
  vocabulary.participant: "member"
  vocabulary.participants: "members"
  vocabulary.assembly: "Room"
  vocabulary.proposal: "proposal"
  membership.admission: "decision"
  deliberation.period: 3
  chat.channels:
    - { id: desk, title: The desk, about: "Talk about what you are writing.", read: members, post: members }
    - { id: front, title: Front door, about: "For visitors: ask about the room, or ask to join.", read: public, post: members }
YML
found_it _docs

echo "== The room's first document"
decide "Keep the room's guide" '[{"kind":"docs.create","doc":"guide","title":"How the room works","read":"members","comment":"members","draft":"members"}]'

install_site
finish_up "  Next:
  1. Open http://localhost:$PORT${HOST:+ (or https://$HOST)} and sign in: New document starts one only you can read.
  2. Share it from the document (Share): people, every member, an office or a committee; as viewer, commenter, editor or owner.
  3. The room's guide is drafted by any member and adopted by vote: write the first draft, then propose adopting it.
  4. Invite members: they ask to join on the site, and the Room votes them in."
