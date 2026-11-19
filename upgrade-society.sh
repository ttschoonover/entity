#!/usr/bin/env bash
# upgrade-society.sh · turns an existing Digital Republic Society (made by
# make-society.sh) into the planning society for new cooperatives, in place:
# its record, members and keys stay as they are, and everything is added by
# motions of the Conclave.
#
#   bash upgrade-society.sh your-id [society folder]
#   e.g. bash upgrade-society.sh tim ~/entities/society
#
# It lays, and votes for, four motions. Each must carry before the next is laid;
# if the Conclave has other members who must vote too, the script stops and says
# so, and you run it again once the motion has carried. It is safe to re-run:
# whatever is already done is skipped.
#   1. Install the letters module (official letters on letterheads).
#   2. The planning board: rooms for new co-ops, buildings, money and clubs, law,
#      and the workshop; the Warden moderates; the Conclave's letterhead.
#   3. The manifesto, written to the wiki (Foundations) and adopted.
#   4. The manifesto issued as a letter of the Conclave, signed by everyone who
#      voted for it.
# Then it sets the node to keep every wiki page rendered as a LaTeX letter (PDF
# when pdflatex is installed), served to signed-in members at /letters/wiki/.
#
# Before running it: publish library/letters to your entity-modules repository
# (or set LETTERS_SOURCE=dir:/path/to/entity/library/letters to install from this copy).

set -euo pipefail
ME="${1:?usage: upgrade-society.sh your-id [society folder]}"
DIR="$(cd "${2:-$HOME/entities/society}" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$DIR/cli/index.js" ] && [ -d "$DIR/record" ] || { echo "No society at $DIR"; exit 1; }
cd "$DIR"
# The upgraded code: the letters command, the node's /letters/ route, the manifesto.
for f in cli/commands/letter.js cli/commands/site.js cli/context.js cli/index.js presets/drs-manifesto.md; do
  [ "$HERE/$f" -ef "$DIR/$f" ] || cp "$HERE/$f" "$DIR/$f"
done
E() { node "$DIR/cli/index.js" "$@"; }
q() { node --input-type=module -e "const s=await import('$DIR/kernel/store.js');const {paramsOf}=await import('$DIR/kernel/state.js');const e=await s.open('$DIR');const st=e.state,p=paramsOf(st);console.log($1)"; }
carry() { # carry TITLE PROPOSAL-ID: vote for it, and stop unless it is enacted
  E settle >/dev/null; E act ballot.cast --proposal "$2" --choice for --as "$ME" --settle >/dev/null 2>&1 || true
  local c; c="$(E count "$2" | tail -1)"; printf '  %-46s %s\n' "$1" "$c"
  if [ "$(q "String(!!st.proposals['$2']?.enacted)")" != "true" ]; then
    echo; echo "  \"$1\" ($2) is waiting for the Conclave: the other members vote on it from the society's site."
    echo "  Run this script again once it has carried."; exit 0
  fi
}
open_motion() { q "Object.values(st.proposals).filter(x=>!x.closed&&x.title===$(node -p 'JSON.stringify(process.argv[1])' "$1")).map(x=>x.id)[0]||''"; }
lay() { # lay TITLE EFFECTS-JSON [CHANGES-JSON]: lays it unless the same motion is already open
  local id; id="$(open_motion "$1")"
  if [ -z "$id" ]; then id=$(E propose --as "$ME" --title "$1" --effects "$2" ${3:+--changes "$3"} | grep -o 'd-[0-9a-f]\{12\}' | head -1); fi
  carry "$1" "$id"
}
NAME="$(q "p.value('entity.name')")"
echo "== Upgrading $NAME in $DIR"

echo "== 1. Letters"
if [ "$(q "String(p.value('entity.modules').includes('letters'))")" != "true" ]; then
  id="$(q "Object.values(st.proposals).filter(x=>!x.closed&&(x.install||[]).some?.(i=>i.name==='letters')).map(x=>x.id)[0]||''")"
  [ -z "$id" ] && id=$(E module add "${LETTERS_SOURCE:-letters}" --as "$ME" | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  carry "Install the letters module" "$id"
  E module fetch >/dev/null
else echo "  letters is installed"; fi

echo "== 2. The planning board and the letterhead"
if [ "$(q "String(!!st.m.letters?.heads?.conclave)")" != "true" ]; then
  BOARDS=$(q "JSON.stringify({'threads.boards':[...new Set([...p.value('threads.boards'),'new-co-ops','buildings-and-places','money-and-clubs','law-and-paperwork','the-workshop'])],'threads.moderator_office':'warden'})")
  HEAD=$(node -e 'console.log(JSON.stringify([{kind:"letterhead.define",letterhead:"conclave",issuer:"entity",name:process.argv[1],title:"The Conclave",
    subtitle:"A private association for the founding of cooperatives",seal_top:process.argv[1],seal_bottom:"Plan · Save · Found",
    closing:"For the Conclave, and under the Obligation,",signatory_role:"Member of the Society",
    footer:"Private. For members of the Society and those they have shown it to under the Obligation.",
    style:{accent:"1E3A34",emblem:"seal",emblem_text:"DRS",layout:"centered",rule:"double"}}]))' "$NAME")
  lay "The planning board and the Conclave's letterhead" "$HEAD" "$BOARDS"
else echo "  the board and the letterhead are in place"; fi

echo "== 3. The manifesto, on the wiki"
if [ "$(q "String(!!st.m.wiki?.pages?.manifesto?.statute)")" != "true" ]; then
  if [ "$(q "String(!!st.m.wiki?.pages?.manifesto)")" != "true" ]; then
    E act wiki.edit --as "$ME" --page manifesto --title "The Manifesto of ${NAME/#The /the }" --category "Foundations" --base 0 --settle --body "$(cat presets/drs-manifesto.md)" >/dev/null
    echo "  page: The Manifesto                         written"
  fi
  V=$(q "st.m.wiki.pages.manifesto.versions.length")
  lay "Adopt the Manifesto" "[{\"kind\":\"wiki.enact\",\"page\":\"manifesto\",\"version\":$V}]"
else echo "  the manifesto is adopted"; fi

echo "== 4. The manifesto, as a letter of the Conclave"
if [ "$(q "String(!!st.m.letters?.letters?.['DRS-MANIFESTO'])")" != "true" ]; then
  ISSUE=$(node --input-type=module -e "
    const s=await import('$DIR/kernel/store.js');const e=await s.open('$DIR');
    const pg=e.state.m.wiki.pages.manifesto, v=pg.versions[pg.statute.version-1];
    console.log(JSON.stringify([{kind:'letter.issue',letter:'DRS-MANIFESTO',letterhead:'conclave',subject:v.title,body:v.body,
      to:['To every member of the Society,','present and to come'],salutation:'Members,',signatures:true}]))")
  lay "Issue the Manifesto as a letter of the Conclave" "$ISSUE"
else echo "  the manifesto letter is issued"; fi

echo "== The wiki as letters"
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));n.wikiLetters={letterhead:'conclave'};fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')"
if command -v pdflatex >/dev/null; then
  E letter wiki --pdf | tail -1
  E letter render DRS-MANIFESTO --out letters --pdf | tail -1
else
  E letter wiki | tail -1
  echo "  (pdflatex is not installed, so only the .tex files were written. On the Pi: sudo apt install texlive-latex-extra texlive-fonts-recommended)"
fi
E verify | tail -1
cat <<EOF

$NAME is upgraded. Members now find:
  - the planning board, in five new rooms (the Warden moderates);
  - the Manifesto on the wiki, adopted, and as a signed letter (Letters tab);
  - every wiki page as a letter at /letters/wiki/, kept current whenever a page changes.
Restart the node so it serves /letters/: cd $DIR && node cli/index.js serve --settle
EOF
