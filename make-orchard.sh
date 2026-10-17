#!/usr/bin/env bash
# make-orchard.sh · The Fellows, Council, and Stewards of the Orchard, as a
# sealed Git Republic, following its Constitution.
#
#   bash make-orchard.sh your-id [folder] [port] [hostname]
#   e.g. bash make-orchard.sh tim orchard 7800 orchard.poezine.org
#
# Fellows are Associates (admitted under the Secretary-General's grant; every
# fellow speaks and votes at the Assembly) or Members (the Members committee,
# elected by two-thirds of the Council; only Members vote in elections and hold
# office). Guests stay off the record. The Council is elected by Members and
# acts by co-signature; the Secretary-General, Treasurer and Secretaries do the
# society's work by hand within published grants. The Members' journal is sealed.

set -euo pipefail
ME="${1:?usage: make-orchard.sh your-id [folder] [port] [hostname]}"
FOLDER="${2:-orchard}"; PORT="${3:-7800}"; HOST="${4:-}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
DIR="$HOME_DIR/$FOLDER"
[[ "$ME" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "Your id is lowercase letters, digits and -"; exit 1; }
[ -e "$DIR" ] && { echo "$DIR already exists. Move it aside first (mv $DIR $DIR-old), or give another folder name."; exit 1; }
[ -f "$SRC/cli/index.js" ] || { echo "No entity code at $SRC"; exit 1; }
if [ -z "${ENTITY_NEW_PASSWORD:-}" ]; then
  read -rsp "A password for $ME (12 or more characters): " PW; echo
  read -rsp "The same again: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "The two passwords differ."; exit 1; }
  export ENTITY_NEW_PASSWORD="$PW"
fi

mkdir -p "$DIR"
( cd "$SRC" && tar cf - --exclude=.git --exclude=.staged --exclude=record --exclude=node_modules --exclude=./parameters.yml --exclude=./node.json . ) | ( cd "$DIR" && tar xf - )
cd "$DIR"
E() { node "$DIR/cli/index.js" "$@"; }
decide() {
  local id; id=$(E propose --as "$ME" --title "$1" --effects "$2" | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  E settle > /dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle > /dev/null
  printf '  %-44s %s\n' "$1" "$(E count "$id" | tail -1)"
}
page() { E act wiki.edit --as "$ME" --page "$1" --title "$2" --category "$3" --base 0 --settle --body "$4" > /dev/null; printf '  %-44s %s\n' "page: $2" "written"; }
later() { node -e "console.log(new Date(Date.now()+$1*864e5).toISOString().slice(0,16)+':00.000Z')"; }

cat > presets/_orchard.yml <<'EOF'
_: The Fellows, Council, and Stewards of the Orchard. A society of fellows in
   Berkeley: Associates and Members, a Council elected by Members, and officers
   who act within published grants. Its journal is sealed to its fellows.
modules: [page, deliberation, titles, vocabulary, offices, committees, authority, elections,
          meetings, wiki, agreements, budget, badges, threads, polls, passwords, sealed]
set:
  entity.name: "The Orchard"
  vocabulary.participant: "fellow"
  vocabulary.participants: "fellows"
  vocabulary.assembly: "Assembly"
  vocabulary.proposal: "motion"
  membership.admission: "decision"
  agreements.required: ["constitution"]
  sealed.history: "all"
  deliberation.period: 7
  budget.currency: "USD"
  threads.boards: ["the-assembly", "groups", "dinners-and-gatherings", "introductions"]
EOF
echo "== Founding the Orchard in $DIR"
E preset apply _orchard >/dev/null
E found --id "$ME" --name "The Orchard" | head -1
E module source "$SOURCE" >/dev/null 2>&1 || true
E password set --as "$ME" --settle >/dev/null && echo "  your password is set"

echo "== The Constitution's institutions"
decide "The offices of the society" "$(cat <<JSON
[{"kind":"office.create","office":"secretary-general","title":"Secretary-General","seats":1,"term_days":365},
 {"kind":"office.create","office":"treasurer","title":"Treasurer","seats":1,"term_days":365},
 {"kind":"office.create","office":"council","title":"Council","seats":5,"term_days":365},
 {"kind":"office.create","office":"secretary","title":"Secretary","seats":3,"term_days":365},
 {"kind":"office.fill","office":"secretary-general","holder":"$ME"},
 {"kind":"office.fill","office":"council","holder":"$ME"}]
JSON
)"
decide "The Members" "$(cat <<JSON
[{"kind":"committee.create","committee":"members","title":"The Members","needs":"majority",
  "remit":"Fellows elected to Membership by two-thirds of the Council, after at least one full term as an Associate. Only Members vote in elections and hold office."},
 {"kind":"committee.appoint","committee":"members","member":"$ME"}]
JSON
)"
decide "Elections at the first Convention" "$(cat <<JSON
[{"kind":"election.call","election":"council-1","office":"council","method":"approval","voters":"committee:members","stand_days":21,"vote_days":7},
 {"kind":"election.call","election":"treasurer-1","office":"treasurer","method":"ranked","voters":"committee:members","stand_days":21,"vote_days":7}]
JSON
)"
decide "The marks of fellowship" "$(cat <<JSON
[{"kind":"badge.create","badge":"founding-fellow","title":"Founding Fellow"},
 {"kind":"badge.create","badge":"associate","title":"Associate"},
 {"kind":"badge.create","badge":"member","title":"Member","description":"Elected by the Council; received at the Club Chest."},
 {"kind":"badge.create","badge":"honorary-fellow","title":"Honorary Fellow","description":"Conferred by the unanimous Council for distinguished service. Does not vote."},
 {"kind":"badge.award","badge":"founding-fellow","to":"$ME"},
 {"kind":"badge.award","badge":"member","to":"$ME"}]
JSON
)"
decide "The officers' and the Council's powers" '[
 {"kind":"authority.grant","grant":"invite-associates","title":"Inviting Associates","to":{"office":"secretary-general"},"may":["participant.admit"],
  "note":"The Secretary-General admits Associates by invitation, once they have signed the Constitution."},
 {"kind":"authority.grant","grant":"associate-mark","title":"Marking Associates","to":{"office":"secretary-general"},"may":["badge.award"],"where":{"badge":"associate"}},
 {"kind":"authority.grant","grant":"convening","title":"Calling the Assembly and the Convention","to":{"office":"secretary-general"},"may":["meeting.call"]},
 {"kind":"authority.grant","grant":"elect-members","title":"Electing Members","to":{"office":"council"},"may":["committee.appoint","badge.award"],"where":{"committee":"members","badge":"member"},"needs":4,
  "note":"Two-thirds of the Council (four of five) elects an Associate to Membership, on the proposal of two Members announced fourteen days before."},
 {"kind":"authority.grant","grant":"honorary","title":"Honorary Fellowship","to":{"office":"council"},"may":["badge.award"],"where":{"badge":"honorary-fellow"},"needs":"all",
  "note":"Conferred only by the unanimous Council."},
 {"kind":"authority.grant","grant":"budget","title":"The budget","to":{"office":"council"},"may":["budget.line","budget.adjust","budget.close"],"needs":"majority"},
 {"kind":"authority.grant","grant":"secretaries","title":"Appointing Secretaries","to":{"office":"council"},"may":["office.fill","office.vacate"],"where":{"office":"secretary"},"needs":"majority"},
 {"kind":"authority.grant","grant":"spending","title":"Spending within the budget","to":{"office":"treasurer"},"may":["budget.spend"],
  "note":"The Treasurer pays within approved lines. Payments over $500 take a second signature (Secretary-General) under the Constitution'"'"'s financial policy."}]'
decide "The first budget" '[
 {"kind":"budget.line","line":"gatherings","title":"Dinners and gatherings","amount":60000,"period":"Year I"},
 {"kind":"budget.line","line":"operations","title":"Operations","amount":20000,"period":"Year I"},
 {"kind":"budget.line","line":"solidarity-fund","title":"Solidarity Fund","amount":10000,"period":"Year I"}]'
decide "The first Convention" "[{\"kind\":\"meeting.call\",\"meeting\":\"convention-1\",\"title\":\"The First Convention\",\"starts\":\"$(later 21)\",\"agenda\":[\"Adopt the Constitution\",\"Elect the Council\",\"Elect the Treasurer\",\"The budget and the Solidarity Fund\",\"The Club Chest\"]}]"

echo "== The founding texts"
page constitution "Constitution of the Fellows, Council, and Stewards of the Orchard" "Foundations" "*Paste the full Constitution here, then propose enacting it. Every fellow signs the Constitution in force before admission.*

This republic carries out the Constitution as follows:

- **Associates** are admitted by invitation of the Secretary-General, once they have signed this Constitution. Every fellow speaks and votes at the Assembly.
- **Members** are elected by two-thirds of the Council (four of five), on the proposal of two Members announced to all Members fourteen days before, after at least one full term as an Associate. Only Members vote in elections and stand for office.
- **Guests** enrol themselves and attend open gatherings; they are not fellows and do not appear on this record.
- **The Council** is elected by the Members at the Convention. It adopts the budget, appoints Secretaries, elects Members, and by unanimous vote confers Honorary Fellowship.
- **The Secretary-General** invites Associates and calls the Assembly and the Convention, and serves as Trustee of the Orchard Trust ex officio. **The Treasurer** keeps the accounts, pays within the budget, and serves as Managing Partner of the Partners of the Orchard ex officio.
- **Groups** form freely: any fellow opens a board under Groups.
- **Dues** are progressive. A fellow's dues status is known only to the Treasurer and the Secretary-General, and is never recorded here.
- **The Members' journal** is sealed: only fellows hold its keys."
page compact "The Orchard Compact" "Foundations" "*Paste the Compact here.* The Compact governs relations among the Club, the Orchard Trust and the Partners of the Orchard. The Partners keep their own republic (the Orchard Group); the Trust is held by the Secretary-General as Trustee."
page officer-duties "Officers' duties" "Handbook" "## Secretary-General
- Invites Associates: once an applicant has signed the Constitution, admits them (grant: Inviting Associates) and gives them the Associate mark.
- Calls the Assembly and the Convention; keeps the register.
- Gives new fellows the key to the Members' journal (Sealed tab).
- With the Treasurer, alone knows each fellow's dues status, kept outside this record.

## Treasurer
- Pays within approved budget lines (grant: Spending within the budget). Over \$500, the Secretary-General countersigns the payment at the bank.
- Keeps the Solidarity Fund at or above its minimum; reports to each Convention.

## Council
- Elects Members: four of five sign (grant: Electing Members), after the two-Member proposal and fourteen days' notice.
- Adopts and adjusts the budget; appoints Secretaries; confers Honorary Fellowship unanimously.

## Every fellow
- Signs the Constitution in force; speaks and votes at the Assembly; may open a Group."

echo "== The sealed journal"
E seal key --as "$ME" --settle >/dev/null && echo "  your encryption key is published"
E seal epoch --as "$ME" --settle >/dev/null && echo "  key period 1 has begun"
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),look:'minimal',colour:'dark'});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
E verify | tail -1

if command -v rad >/dev/null && rad self >/dev/null 2>&1; then E radicle init --private | tail -1; else echo "  (Radicle not unlocked: later, cd $DIR && node cli/index.js radicle init --private)"; fi
if [ -n "$HOST" ]; then
  START="$HOME/tsite/deploy/start-all.sh"
  [ -f "$START" ] && ! grep -q "entities/$FOLDER:" "$START" && sed -i "s|^ENTITIES=(\(.*\))|ENTITIES=(\1 \"\$HOME/entities/$FOLDER:$PORT\")|" "$START" && echo "  added to the start script"
  CFG="$HOME/.cloudflared/config.yml"
  if [ -f "$CFG" ] && ! grep -q "hostname: $HOST" "$CFG"; then
    python3 - "$CFG" "$HOST" "$PORT" <<'PY'
import sys; p,h,port=sys.argv[1:4]; s=open(p).read()
s=s.replace('  - service: http_status:404', f'  - hostname: {h}\n    service: http://localhost:{port}\n  - service: http_status:404'); open(p,'w').write(s)
PY
    cloudflared tunnel route dns --overwrite-dns poezine "$HOST" 2>&1 | tail -1 || true
  fi
fi
cat <<EOF

The Orchard is founded in $DIR. Next:
  1. Start it: ~/tsite/deploy/start-all.sh${HOST:+, then open https://$HOST}
  2. Wiki: paste the Constitution and the Compact, propose enacting them, and sign the Constitution (Agreements tab).
  3. Invite Associates: they apply on the page and sign the Constitution; you admit them under your grant.
  4. Members' journal: each fellow publishes their key on the Sealed tab; you give them the key.
EOF
