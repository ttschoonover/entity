#!/usr/bin/env bash
# republics/loth/make.sh · found the Lothlórien Unofficial Minihub, Loth's own
# republic: the core (entity), the modules it runs (from the module pack), and
# what is Loth's alone, in this folder: its website (site/) and its wiki pages
# (wiki/). Changing the site later is  bash republics/loth/ship-site.sh, which
# touches nothing else.
#
#   REPLACE=1 bash republics/loth/make.sh tim [folder] [port] [hostname]
#
# Who sees what:
#   - the house Wi-Fi, or the house password: the wiki;
#   - members (approved by an admin): the wiki, editing, alerts;
#   - senders (chosen by an admin): sending alerts to everyone;
#   - admins (the "admin" office): approving members, choosing senders and
#     admins, the house name and password, and the record.
# Admins act alone, under a standing grant: nothing is put to a vote.
#
# REPLACE=1 archives the old folder to ~/entities/archive/ and keeps its port
# and its email settings. HOUSE_PASSWORD="…" skips that question.
HERE="$(cd "$(dirname "$0")" && pwd)"
ME="${1:?usage: make.sh your-id [folder] [port] [hostname]}"
NAME="${HUB_NAME:-Lothlórien Unofficial Minihub}"; FOLDER="${2:-loth}"; PORT="${3:-}"; HOST="${4:-loth.tschoonover.com}"; SITE=lothlorien; RAD_PRIVATE=1
source "${SRC:-${ENTITIES:-$HOME/entities}/entity}/found-common.sh"

OLD="$HOME_DIR/$FOLDER" KEEP="$(mktemp)"
echo '{}' > "$KEEP"
if [ -e "$OLD" ]; then
  [ "${REPLACE:-0}" = 1 ] || { echo "$OLD already exists. Run again with REPLACE=1 to archive and replace it."; exit 1; }
  OLDPORT="$(node -p "try{require('$OLD/node.json').port||''}catch(e){''}" 2>/dev/null || true)"
  [ -z "$PORT" ] && PORT="$OLDPORT"
  node -e "try{const n=require('$OLD/node.json');require('fs').writeFileSync('$KEEP',JSON.stringify({notify:n.notify||null,house:n.house?{networks:n.house.networks,publicIps:n.house.publicIps,detect:n.house.detect}:null}))}catch(e){}"
  echo "== Replacing the old $FOLDER"
  if [ -n "$OLDPORT" ]; then
    for pid in $(ss -ltnpH "sport = :$OLDPORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$pid" 2>/dev/null && echo "  stopped its server (port $OLDPORT)"; done
  fi
  pkill -f "$OLD/cli/index.js" 2>/dev/null || true
  mkdir -p "$HOME_DIR/archive"
  ARCHIVE="$HOME_DIR/archive/$FOLDER-$(date +%Y%m%d-%H%M).tgz"
  tar czf "$ARCHIVE" -C "$HOME_DIR" "$FOLDER" && echo "  archived to $ARCHIVE"
  rm -rf "$OLD"
fi
if [ -z "$PORT" ]; then
  PORT=7865; while ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . || grep -rqs "\"port\": $PORT\b" "$HOME_DIR"/*/node.json; do PORT=$((PORT+1)); done
fi
if [ -z "${HOUSE_PASSWORD:-}" ]; then
  read -rsp "The house password (8 or more characters): " a; echo
  read -rsp "The same again: " b; echo
  [ "$a" = "$b" ] || { echo "The two passwords differ."; exit 1; }
  [ "${#a}" -ge 8 ] || { echo "It needs at least 8 characters."; exit 1; }
  export HOUSE_PASSWORD="$a"
fi

prepare

cat > presets/_loth.yml <<YML
_: The Lothlórien Unofficial Minihub. Admins act alone; the house reads the wiki; members get alerts.
modules: [deliberation, titles, passwords, wiki, notify, offices, authority, minihub]
set:
  entity.name: $(json "$NAME")
  decision.electorate: "founder"
  membership.admission: "decision"
  notify.events: [notices]
  notify.broadcast: "nobody"
YML
found_it _loth

echo "== Admins act alone"
decide "The admin office" '[{"kind":"office.create","office":"admin","title":"Admin","seats":10}]'
decide "$ME is an admin" "[{\"kind\":\"office.fill\",\"office\":\"admin\",\"holder\":\"$ME\"}]"
decide "What admins may do" '[{"kind":"authority.grant","grant":"admin","to":{"office":"admin"},"may":["participant.admit","participant.remove","office.fill","office.vacate","minihub.senders"],"needs":1,"note":"Approving and removing members, choosing admins and alert senders: done by any one admin."}]'
decide "$ME sends alerts" "[{\"kind\":\"minihub.senders\",\"members\":[\"$ME\"]}]"

echo "== The wiki"
page() { E act wiki.edit --as "$ME" --page "$1" --title "$2" --category "$3" --base 0 --settle --body "$4" > /dev/null; printf '  %-44s %s\n' "$2" "written"; }
wk="$(mktemp -d)"; cp "$HERE"/wiki/*.md "$wk/"
for url in $(grep -ohE '\]\(https?://[^ )]+\.(jpe?g|png|webp|gif)' "$wk"/*.md | sed 's/^](//' | sort -u); do
  kept="$(E media fetch "$url" 2>/dev/null | grep -oE 'media/[a-f0-9]{32}\.(jpg|png|webp|gif)' | head -1 || true)"
  if [ -n "$kept" ]; then for f in "$wk"/*.md; do URL="$url" KEPT="$kept" perl -pi -e 's/\Q$ENV{URL}\E/$ENV{KEPT}/g' "$f"; done; echo "  picture kept: ${url##*/}"
  else echo "  picture not fetched (left as a link): ${url##*/}"; fi
done
for name in $(grep -ohE '\]\(local:[A-Za-z0-9._-]+' "$wk"/*.md | sed 's/^](local://' | sort -u); do
  kept="$(E media add "$HERE/wiki/$name" 2>/dev/null | grep -oE 'media/[a-f0-9]{32}\.(jpg|png|webp|gif)' | head -1 || true)"
  [ -n "$kept" ] && for f in "$wk"/*.md; do NAME="local:$name" KEPT="$kept" perl -pi -e 's/\Q$ENV{NAME}\E/$ENV{KEPT}/g' "$f"; done && echo "  picture kept: $name"
done
while IFS='|' read -r id title cat file; do [ -n "$id" ] && page "$id" "$title" "$cat" "$(cat "$wk/$file")"; done < "$HERE/wiki/pages.txt"
rm -rf "$wk"

echo "== The website and who gets in"
rm -rf "$DIR/site"; cp -r "$HERE/site" "$DIR/site"
node -e '
const fs=require("fs"); const keep=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const n=fs.existsSync("node.json")?JSON.parse(fs.readFileSync("node.json")):{};
Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),private:true,modulesOnline:false,site:"site",
  site_open:["site.css","hub.js","signin.js"],readers:["office:admin"]});
if(keep.notify) n.notify=keep.notify;
fs.writeFileSync("node.json",JSON.stringify(n,null,2)+"\n");' "$PORT" "$KEEP"
E house on --name "$NAME" --admin office:admin > /dev/null
node -e '
const fs=require("fs"); const keep=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!keep.house) process.exit(0);
const n=JSON.parse(fs.readFileSync("node.json")); for (const k of ["networks","publicIps","detect"]) if (keep.house[k]!==undefined) n.house[k]=keep.house[k];
fs.writeFileSync("node.json",JSON.stringify(n,null,2)+"\n");' "$KEEP"
E house password > /dev/null
rm -f "$KEEP"
echo "  the house reads the wiki; members sign in; admins: the admin office ($ME)"
E verify | tail -1

finish_up "  1. Start it:  ~/start-all.sh   (or: cd $DIR && node cli/index.js serve --settle)
  2. Open https://$HOST and sign in as $ME. Admin is at the top.
  3. Housemates ask to join from the sign-in page (on the house Wi-Fi, or after the house password); you approve them under Admin.
  4. Turn alerts on under Alerts: on this device and by email."
