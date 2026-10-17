#!/usr/bin/env bash
# make-orchard-group.sh · The Partners of the Orchard (the Orchard Group), as a
# sealed Git Republic, following the Partnership Agreement.
#
#   bash make-orchard-group.sh your-id [folder] [port] [hostname]
#   e.g. bash make-orchard-group.sh tim orchard-group 7790 group.poezine.org
#
# Every partner decides every investment, by vote; that power is never
# delegated. The Treasurer serves as Managing Partner and keeps the books by
# hand within published grants; two officers confirm each trade. Partners sign
# the Partnership Agreement by hand before admission; capital is kept in units.
# Partners' private matters are sealed; copies stay private on Radicle.

set -euo pipefail
ME="${1:?usage: make-orchard-group.sh your-id [folder] [port] [hostname]}"
FOLDER="${2:-orchard-group}"; PORT="${3:-7790}"; HOST="${4:-}"
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

cat > presets/_group.yml <<'YML'
_: The Partners of the Orchard, a general partnership of Members of the Orchard.
   Every partner decides every investment; the Managing Partner keeps the books
   by hand; two officers confirm each trade. Never offered to the public.
modules: [page, deliberation, titles, vocabulary, offices, committees, authority, elections,
          fund, meetings, wiki, agreements, threads, polls, passwords, sealed]
set:
  entity.name: "The Orchard Group"
  vocabulary.participant: "partner"
  vocabulary.participants: "partners"
  vocabulary.assembly: "Partnership"
  vocabulary.proposal: "motion"
  membership.admission: "decision"
  agreements.required: ["partnership-agreement"]
  agreements.drawn_signature: "required"
  sealed.history: "all"
  deliberation.period: 7
  fund.max_members: 25
  threads.boards: ["stock-studies", "education", "partnership-business"]
YML
echo "== Founding the Orchard Group in $DIR"
E preset apply _group >/dev/null
E found --id "$ME" --name "The Orchard Group" | head -1
E module source "$SOURCE" >/dev/null 2>&1 || true
E password set --as "$ME" --settle >/dev/null && echo "  your password is set"

echo "== The Partnership Agreement's institutions"
decide "The officers" "$(cat <<JSON
[{"kind":"office.create","office":"managing-partner","title":"Managing Partner (Treasurer)","seats":1,"term_days":365},
 {"kind":"office.create","office":"presiding-partner","title":"Presiding Partner","seats":1,"term_days":365},
 {"kind":"office.create","office":"recording-partner","title":"Recording Partner","seats":1,"term_days":365},
 {"kind":"office.fill","office":"managing-partner","holder":"$ME"},
 {"kind":"office.fill","office":"presiding-partner","holder":"$ME"},
 {"kind":"office.fill","office":"recording-partner","holder":"$ME"}]
JSON
)"
decide "The officers' powers" "$(cat <<JSON
[{"kind":"authority.grant","grant":"books","title":"Keeping the books","to":{"office":"managing-partner"},
  "may":["fund.contribute","fund.valuation","fund.income","fund.expense"],
  "note":"The Managing Partner records money paid in, month-end prices, dividends and expenses. Every entry is published to the partners."},
 {"kind":"committee.create","committee":"officers","title":"Officers","needs":"majority",
  "remit":"The Managing, Presiding and Recording Partners. Two of them record each trade the partners voted."},
 {"kind":"committee.appoint","committee":"officers","member":"$ME"},
 {"kind":"authority.grant","grant":"trades","title":"Recording trades","to":{"committee":"officers"},"may":["fund.fill"],"needs":2,
  "note":"A trade placed at the broker is recorded by two officers, within what the partners voted. Investment decisions are never delegated."},
 {"kind":"authority.grant","grant":"meetings","title":"Calling meetings","to":{"office":"recording-partner"},"may":["meeting.call"]}]
JSON
)"
decide "The first meeting of the partners" "[{\"kind\":\"meeting.call\",\"meeting\":\"meeting-1\",\"title\":\"First meeting of the partners\",\"starts\":\"$(later 7)\",\"agenda\":[\"Enact the Partnership Agreement\",\"Investment policy\",\"Contributions\",\"Elect officers\",\"First stock studies\"]}]"

echo "== The founding texts"
page partnership-agreement "Partners of the Orchard General Partnership Agreement" "Foundations" "*Paste the Partnership Agreement here, then propose enacting it. Every partner signs the version in force, by hand, before admission or paying in.*

How this republic carries it out:

- **Partners** are Members of the Orchard in good standing, admitted by vote of the partners after signing this Agreement.
- **Every investment** is decided by vote of all partners; that power is never delegated.
- **The Treasurer** of the Orchard serves as **Managing Partner** ex officio: keeps the books, places the trades the partners voted, and reconciles with the broker each month.
- **Each trade** is recorded by two officers.
- **Capital accounts** are kept in units at the current unit value.
- **At least 10% of net distributable income** goes to the Orchard's Solidarity Fund before any distribution to partners.
- **Interests** are not freely transferable; departing partners are redeemed at assessed value within one year.
- **Private matters** (personal capital details, tax documents, monthly reconciliations) are kept in sealed posts, readable only by partners."
page investment-policy "Investment policy" "Foundations" "What the partnership invests in, how a security is studied before a vote, how much of the fund any one holding may be, and how often holdings are reviewed. No margin, short sales, options or futures."
page officer-duties "Officers' duties" "Handbook" "## Managing Partner (the Treasurer)
- Holds the brokerage account in the partnership's name, and places the trades the partners voted, within each vote's quantity, price limit and deadline.
- Records each trade (a second officer confirms it), money paid in, dividends, interest and fees.
- Month-end: records closing prices; reconciles the books with the broker's statement; posts the reconciliation as a sealed post.
- Before any distribution: pays at least 10% of net distributable income to the Orchard's Solidarity Fund.
- Year-end: gives the accountant the ledger (Download the ledger) for the partnership return and each partner's K-1.

## Presiding Partner
- Chairs meetings; sees that every partner takes part in every investment decision; second signature on trades.

## Recording Partner
- Calls meetings, keeps minutes, keeps the Agreement and policies, and gives new partners the sealed key.

## Every partner
- Studies and votes on every investment, checks in to meetings, and signs the Agreement in force."

echo "== Sealed matters"
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

The Orchard Group is founded in $DIR. Next:
  1. Start it: ~/tsite/deploy/start-all.sh${HOST:+, then open https://$HOST}
  2. Close the site to partners: Cloudflare Zero Trust, Access, Applications, Self-hosted${HOST:+, $HOST,} partners' emails only.
  3. Wiki: paste the Partnership Agreement, propose enacting it, and sign it by hand (Agreements tab).
  4. Partners apply on the page, sign the Agreement, and the partners admit them by vote.
  5. Sealed: each partner publishes their key on the Sealed tab; the Recording Partner gives them the key.
EOF
