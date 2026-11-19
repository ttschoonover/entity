#!/usr/bin/env bash
# make-lothlorien.sh · Lothlórien's house wiki: a members-only site with a wiki
# and nothing else, for now.
#
#   bash make-lothlorien.sh your-id [folder] [port] [hostname]
#   e.g. bash make-lothlorien.sh tim loth 7860 loth.poezine.org
#
# Members are admitted by a vote of the members already in (a simple majority).
# Any member edits any page and every version is kept; the house can adopt a
# page as a house rule by vote. The website is private: nothing but a sign-in
# page (and a form to ask to join) answers until a member signs in. More
# modules (meetings, workshift tasks, a budget) can be added later by vote.

ME="${1:?usage: make-lothlorien.sh your-id [folder] [port] [hostname]}"
NAME="${HOUSE_NAME:-Lothlórien}"; FOLDER="${2:-loth}"; PORT="${3:-7860}"; HOST="${4:-}"; SITE=lothlorien; RAD_PRIVATE=1
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

cat > presets/_loth.yml <<YML
_: A student housing cooperative's members-only wiki.
modules: [deliberation, titles, vocabulary, passwords, republic, wiki]
set:
  entity.name: $(json "$NAME")
  republic.short_name: $(json "$NAME")
  republic.motto: "Members only · every version kept"
  vocabulary.participant: "member"
  vocabulary.participants: "members"
  vocabulary.assembly: "House Meeting"
  vocabulary.proposal: "motion"
  membership.admission: "decision"
  deliberation.period: 7
YML
found_it _loth

echo "== The first pages"
page() { E act wiki.edit --as "$ME" --page "$1" --title "$2" --category "$3" --base 0 --settle --body "$4" > /dev/null; printf '  %-44s %s\n' "page: $2" "written"; }
page welcome "Welcome to the wiki" "Start here" "This is the members' wiki of $NAME. It is for anything the house wants written down: how things work, who to ask, what we decided and why.

## How it works
- Any member can edit any page. Every version is kept, with who wrote it.
- When you edit, you edit the version you saw: if someone changed the page in the meantime, you'll be asked to look at their change first.
- The house can adopt a page as a house rule by vote at a House Meeting. The adopted version stays the rule until the house adopts another.

## Pages to start
Make any of these, or anything else: the house handbook, workshift, the kitchen, house meetings, the garden, guests, moving in and moving out, who to call when something breaks."
page writing-here "How to write here" "Start here" "Pages are written in Markdown.

- \`## A heading\` makes a heading.
- \`- an item\` makes a list.
- \`**bold**\` and \`*italic*\` work as you'd expect.
- \`[a link](https://example.org)\` makes a link, and \`[another page](#/workshift)\` links within the wiki.
- \`> words\` sets a quotation apart.
- A table is rows between pipes, with a line of dashes under the first:

| Day | Shift |
|---|---|
| Monday | dishes |

- \`Add a photo\` under the text box puts a picture in the page. Give it a caption saying what it shows, and who took it if it isn't yours. Photos of members only with their agreement.
- From the command line: \`node cli/index.js media add photo.jpg --caption \"…\"\` keeps a picture and prints the line to paste.

Write plainly, date anything that might change (\"as of spring 2027\"), and leave out anything about a member they wouldn't want the whole house to read."

# Five researched pages with their sources (presets/lothlorien-wiki/*.md).
# Skip them with LOTH_SAMPLE_PAGES=0; add them to a house that already exists
# with: bash update-lothlorien.sh your-id [folder]
if [ "${LOTH_SAMPLE_PAGES:-1}" = 1 ]; then
  # The photographs the pages show are kept in the house's own media/ folder
  # where they can be downloaded, so readers of the private site stay on it.
  wk="$(mktemp -d)"; cp presets/lothlorien-wiki/*.md "$wk/"
  for url in $(grep -ohE '\]\(https?://[^ )]+\.(jpe?g|png|webp|gif)' "$wk"/*.md | sed 's/^](//' | sort -u); do
    kept="$(E media fetch "$url" 2>/dev/null | grep -oE 'media/[a-f0-9]{32}\.(jpg|png|webp|gif)' | head -1 || true)"
    [ -n "$kept" ] && for f in "$wk"/*.md; do URL="$url" KEPT="$kept" perl -pi -e 's/\Q$ENV{URL}\E/$ENV{KEPT}/g' "$f"; done
  done
  while IFS='|' read -r id title cat; do
    page "$id" "$title" "$cat" "$(cat "$wk/$id.md")"
  done < presets/lothlorien-wiki/pages.txt
  rm -rf "$wk"
fi

install_site
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{private:true,modulesOnline:false});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')"
echo "  the website is private: members sign in to see anything"
finish_up "  1. Start it, sign in, and send housemates the address: they ask to join, and the members admit them by vote.
  2. Write the pages the house needs; adopt the ones that bind everyone by vote."
