#!/usr/bin/env bash
# make-loth-hub.sh · the Lothlórien Unofficial Minihub: the house's own hub, with
# a wiki and notifications, served privately at loth.tschoonover.com.
#
#   bash make-loth-hub.sh your-id [folder] [port] [hostname]
#   e.g. bash make-loth-hub.sh tim loth "" loth.tschoonover.com
#
# Who gets in (cli/house.js):
#   - anyone on the house Wi-Fi, without a password: to read, and to make an account;
#   - anyone away from the house who types the house password (30 days per browser);
#   - members, from anywhere, with their own account.
# Editing the wiki and getting notifications take an account, made in a minute
# from inside the hub (admission is open: being let in is the check). The
# admins (you, at first) change the hub's name, the house password, the house
# network and the admins on its House settings page.
#
# REPLACE=1 replaces an existing folder of that name: its server is stopped, it
# is archived to ~/entities/archive/<folder>-<date>.tgz, and then removed.
# HUB_NAME="…" names it something else; HOUSE_PASSWORD="…" skips that question.

ME="${1:?usage: make-loth-hub.sh your-id [folder] [port] [hostname]}"
NAME="${HUB_NAME:-Lothlórien Unofficial Minihub}"; FOLDER="${2:-loth}"; PORT="${3:-}"; HOST="${4:-}"; SITE=lothlorien; RAD_PRIVATE=1
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"

OLD="$HOME_DIR/$FOLDER"
if [ -e "$OLD" ]; then
  [ "${REPLACE:-0}" = 1 ] || { echo "$OLD already exists. Run again with REPLACE=1 to archive and replace it, or give another folder name."; exit 1; }
  OLDPORT="$(node -p "try{require('$OLD/node.json').port||''}catch(e){''}" 2>/dev/null || true)"
  [ -z "$PORT" ] && PORT="$OLDPORT"
  echo "== Replacing the old $FOLDER"
  if [ -n "$OLDPORT" ]; then
    for pid in $(ss -ltnpH "sport = :$OLDPORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$pid" 2>/dev/null && echo "  stopped its server (port $OLDPORT)"; done
  fi
  pkill -f "$OLD/cli/index.js" 2>/dev/null || true
  mkdir -p "$HOME_DIR/archive"
  ARCHIVE="$HOME_DIR/archive/$FOLDER-$(date +%Y%m%d-%H%M).tgz"
  tar czf "$ARCHIVE" -C "$HOME_DIR" "$FOLDER" && echo "  archived to $ARCHIVE"
  rm -rf "$OLD" && echo "  removed $OLD"
fi
if [ -z "$PORT" ]; then
  PORT=7865; while ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . || grep -rqs "\"port\": $PORT\b" "$HOME_DIR"/*/node.json; do PORT=$((PORT+1)); done
fi

if [ -z "${HOUSE_PASSWORD:-}" ]; then
  read -rsp "The house password, for housemates away from the house (8 or more characters): " a; echo
  read -rsp "The same again: " b; echo
  [ "$a" = "$b" ] || { echo "The two passwords differ."; exit 1; }
  [ "${#a}" -ge 8 ] || { echo "It needs at least 8 characters."; exit 1; }
  export HOUSE_PASSWORD="$a"
fi

prepare

cat > presets/_lothhub.yml <<YML
_: A house's own hub, a wiki and notices, open to the house's network and its password.
modules: [page, deliberation, titles, vocabulary, passwords, wiki, notify]
set:
  entity.name: $(json "$NAME")
  vocabulary.participant: "member"
  vocabulary.participants: "members"
  vocabulary.assembly: "House Meeting"
  vocabulary.proposal: "motion"
  membership.admission: "open"
  deliberation.period: 7
  notify.events: [proposals, reminders, decisions, members, notices]
  notify.broadcast: "members"
YML
found_it _lothhub

echo "== The first pages"
page() { E act wiki.edit --as "$ME" --page "$1" --title "$2" --category "$3" --base 0 --settle --body "$4" > /dev/null; printf '  %-44s %s\n' "page: $2" "written"; }
page welcome "Welcome to the minihub" "Start here" "This is the $NAME: the house's own corner of the internet, run by housemates and not by the BSC.

## Getting in
- **On the house Wi-Fi**, it opens by itself.
- **Away from the house**, type the house password. Ask a housemate for it, and don't post it anywhere public.

## Make your own account
Reading needs nothing. To **edit the wiki** or **get notifications**, make an account: tap **Make your own account** at the top, choose a short id and a password, and you're in. Your password never leaves your device.

## Notifications
Once you have an account, open **You** and choose where your notices go: this phone or laptop, or email. On an iPhone, first add the hub to your Home Screen (Share, then Add to Home Screen) and open it from there.

Anyone with an account can post a notice to everyone from the **Notices** tab: a package at the door, the water going off, a house meeting moved.

## The wiki
Any member can edit any page, and every version is kept with who wrote it. Start pages for anything the house wants written down: how things work, who to ask, what we decided and why."
page writing-here "How to write here" "Start here" "Pages are written in Markdown.

- \`## A heading\` makes a heading.
- \`- an item\` makes a list.
- \`**bold**\` and \`*italic*\` work as you'd expect.
- \`[a link](https://example.org)\` makes a link.
- A table is rows between pipes, with a line of dashes under the first:

| Day | Shift |
|---|---|
| Monday | dishes |

Write plainly, date anything that might change (\"as of spring 2027\"), and leave out anything about a housemate they wouldn't want the whole house to read."

# The researched pages about the house, with their photographs (presets/lothlorien-wiki).
if [ "${LOTH_SAMPLE_PAGES:-1}" = 1 ] && [ -f presets/lothlorien-wiki/pages.txt ]; then
  wk="$(mktemp -d)"; cp presets/lothlorien-wiki/*.md "$wk/"
  for url in $(grep -ohE '\]\(https?://[^ )]+\.(jpe?g|png|webp|gif)' "$wk"/*.md | sed 's/^](//' | sort -u); do
    kept="$(E media fetch "$url" 2>/dev/null | grep -oE 'media/[a-f0-9]{32}\.(jpg|png|webp|gif)' | head -1 || true)"
    [ -n "$kept" ] && for f in "$wk"/*.md; do URL="$url" KEPT="$kept" perl -pi -e 's/\Q$ENV{URL}\E/$ENV{KEPT}/g' "$f"; done
  done
  while IFS='|' read -r id title cat; do page "$id" "$title" "$cat" "$(cat "$wk/$id.md")"; done < presets/lothlorien-wiki/pages.txt
  rm -rf "$wk"
fi

echo "== Who gets in"
node -e "const fs=require('fs');const n=fs.existsSync('node.json')?JSON.parse(fs.readFileSync('node.json')):{};Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),private:true,modulesOnline:false,look:'wiki'});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
E house on --name "$NAME" --admin "$ME" > /dev/null
E house password > /dev/null
echo "  private: strangers see only the sign-in page"
echo "  the house Wi-Fi gets in by itself; the house password works from anywhere"
echo "  admin: $ME (House settings, at the top of the hub once you're signed in)"
E verify | tail -1
echo "  served at http://localhost:$PORT"

finish_up "  1. Restart everything so the hub comes up:  bash ~/update.sh  (or start it: cd $DIR && node cli/index.js serve --settle)
  2. On the house Wi-Fi, open https://${HOST:-loth.tschoonover.com}: it opens without a password. Away, the house password lets you in.
  3. Sign in as $ME (Sign in with your account, on the sign-in page) and open House settings to check the house's address was found.
  4. Tell the house: the address, the house password, and 'make your own account to edit and get notifications'."
