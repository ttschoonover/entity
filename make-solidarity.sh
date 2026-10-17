#!/usr/bin/env bash
# make-solidarity.sh · a cooperative solidarity network, as a Git Republic:
# a library of things with cash deposits, a solidarity fund that stands behind
# the deposits of members who cannot afford them, mutual aid, and shared work.
#
#   bash make-solidarity.sh your-id ["Network Name"] [folder] [port] [hostname]
#   e.g. bash make-solidarity.sh tim "The Solidarity Network" solidarity 7850 solidarity.poezine.org
#
# Members lend each other what they own, against a cash deposit returned when the
# thing comes back; the network lends what it holds in common through a Librarian.
# A Treasurer keeps the solidarity fund, which pays lenders' claims on covered
# deposits and mutual aid; a Solidarity Committee of three settles disputes over
# deposits and gives aid, two signatures at a time. Members are admitted by the
# Assembly after signing the Solidarity Pledge. Everything is on the public record;
# the record keeps the books of every deposit, and the cash is handed over in person.
# Headless: the network's website is website/ (the shared kit in sites/kit plus
# sites/solidarity: home, library, wiki), computed in each visitor's browser from
# the public record, and signing in the page with each member's own key.

set -euo pipefail
ME="${1:?usage: make-solidarity.sh your-id [\"Network Name\"] [folder] [port] [hostname]}"
NAME="${2:-The Solidarity Network}"; FOLDER="${3:-solidarity}"; PORT="${4:-7850}"; HOST="${5:-}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
DIR="$HOME_DIR/$FOLDER"
[[ "$ME" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "Your id is lowercase letters, digits and -"; exit 1; }
[ -e "$DIR" ] && { echo "$DIR already exists. Move it aside first (mv $DIR $DIR-old), or give another folder name."; exit 1; }
[ -f "$SRC/cli/index.js" ] || { echo "No entity code at $SRC"; exit 1; }
[ -f "$SRC/library/things/index.js" ] || { echo "No library-of-things module at $SRC/library/things (it ships with entity 0.9.4 or later)"; exit 1; }
[ -f "$SRC/sites/solidarity/index.html" ] && [ -f "$SRC/sites/kit/common.js" ] || { echo "No solidarity website at $SRC/sites (it ships with entity 0.9.11 or later)"; exit 1; }
if [ -z "${ENTITY_NEW_PASSWORD:-}" ]; then
  read -rsp "A password for $ME (12 or more characters): " PW; echo
  read -rsp "The same again: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "The two passwords differ."; exit 1; }
  export ENTITY_NEW_PASSWORD="$PW"
fi
# The name other members see, shown as "Name (id)". YOUR_NAME="…" skips the question.
if [ -z "${YOUR_NAME+x}" ] && [ -t 0 ]; then read -rp "Your name, as other members will see it (Enter to skip): " YOUR_NAME; fi
YOUR_NAME="${YOUR_NAME:-}"

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

cat > presets/_solidarity.yml <<YML
_: A cooperative solidarity network. A library of things with cash deposits, a
   solidarity fund that covers deposits for members who ask, mutual aid and shared
   work. Admission by the Assembly, after signing the Solidarity Pledge.
   Headless: its website is website/, built on windows.
modules: [deliberation, titles, vocabulary, offices, committees, authority, elections,
          wiki, agreements, threads, meetings, polls, passwords, tasks, budget, things, chat]
set:
  entity.name: $(node -p 'JSON.stringify(process.argv[1])' "$NAME")
  chat.channels:
    - { id: general, title: General, about: "Anything at all.", read: members, post: members }
    - { id: borrowing, title: Borrowing, about: "Looking for something, arranging a hand-over, bringing it back.", read: members, post: members }
    - { id: the-commons, title: The commons, about: "What the network should hold in common, and how it is looked after.", read: members, post: members }
  vocabulary.participant: "member"
  vocabulary.participants: "members"
  vocabulary.assembly: "Assembly"
  vocabulary.proposal: "proposal"
  membership.admission: "decision"
  agreements.required: ["solidarity-pledge"]
  deliberation.period: 7
  threads.boards: ["offers", "requests", "the-commons"]
  things.currency: "USD"
  things.max_deposit: 20000
  things.cover: true
  things.cover_limit: 10000
  things.cover_max_open: 2
YML
echo "== Founding $NAME in $DIR"
E preset apply _solidarity >/dev/null
E found --id "$ME" --name "$NAME" | head -1
E module source "$SOURCE" >/dev/null 2>&1 || true
E password set --as "$ME" --settle >/dev/null && echo "  your password is set"
[ -n "$YOUR_NAME" ] && E act title.set --as "$ME" --title "$YOUR_NAME" --settle >/dev/null && echo "  you appear as $YOUR_NAME ($ME)"

echo "== The founding texts"
page solidarity-pledge "The Solidarity Pledge" "Foundations" "I join $NAME freely, as an equal, and I sign this pledge with my own hand.

1. I will share what I can, and borrow what I need, without shame either way.
2. I will treat what I borrow with care, return it on time, and say so straight away if it is lost or damaged.
3. I will hand back a borrower's deposit, whole, when what I lent comes back as it left; and if I keep any of it, I will say why, on the record, and accept the network's decision if it is disputed.
4. I will not ask a deposit of anyone who has the solidarity fund behind them.
5. I will help where I can: with my time, my skills and my things.
6. I will keep what members share in confidence, and treat everyone in the network with respect.
7. I may leave at any time. Leaving ends this pledge, except for what I still have borrowed or still hold in deposits."
page principles "Principles" "Foundations" "## What we are
$NAME is a cooperative of neighbours who share. We lend each other the things we own, hold some things in common, help each other out, and decide together, as equals.

## Solidarity, not charity
1. Everyone gives and everyone takes. No one has to explain why they need something.
2. Money is never a reason to go without: any member may ask the solidarity fund to stand behind a deposit, and no one is told why another member asked.
3. Mutual aid is given by the Solidarity Committee in confidence. The record shows the amount, never the circumstances.

## Democracy
1. Every member has one vote in the Assembly, whatever they lend or borrow.
2. Officers are elected each year and act only within powers the Assembly grants, every use of which is published.
3. Any member may propose anything to the Assembly."
page how-the-library-works "How the library of things works" "Handbook" "## Lending
1. List anything you are willing to lend, with the deposit you ask (or none) and where to pick it up.
2. A member asks to borrow it. You meet, hand it over, take the deposit in cash, and sign on the record that you received it.
3. When it comes back, sign that it is back and return the deposit. If it came back damaged, you may keep part of the deposit to repair or replace it; say what and why.

## Borrowing
1. Ask to borrow on the page. Others may already be in line; the lender chooses who goes next.
2. Leave the deposit in cash when you collect the thing, or tick 'ask the solidarity fund to cover the deposit' and leave nothing.
3. Return it on time, in the state you found it. If the lender has not signed that it is back, say so on the page: 'I gave it back'.
4. If part of your deposit was kept and you think that unfair, dispute it within 14 days. The Solidarity Committee decides.

## The solidarity fund
1. Covered deposits are a promise by the network: if a covered loan comes back damaged or never comes back, the lender's claim is paid by the Treasurer from the solidarity fund.
2. The fund is filled by members' dues and gifts, and approved by the Assembly each year as a line of the budget.

## The network's own things
The network holds some things in common (a cargo bike, a tent, tools). The Librarian keeps them, lends them on the same terms, and adds or retires them within the powers the Assembly granted.

## When things go wrong
A thing more than a month overdue may be declared lost: the lender keeps the deposit, or claims it from the fund if it was covered. Disputes go to the Solidarity Committee. Every decision is on the record."
decide "Adopt the Pledge and the Principles" '[{"kind":"wiki.enact","page":"solidarity-pledge","version":1},{"kind":"wiki.enact","page":"principles","version":1}]'
FP=$(node --input-type=module -e "
import { openEntity } from './cli/context.js'; import { fingerprint } from './modules/agreements/index.js';
const e = await openEntity({}); const p = e.state.m.wiki.pages['solidarity-pledge']; console.log(fingerprint('solidarity-pledge', p.versions[p.statute.version - 1]));" 2>/dev/null || true)
E act agreement.sign --as "$ME" --page solidarity-pledge --version 1 --text "$FP" --settle >/dev/null 2>&1 && echo "  you signed the Pledge" || echo "  (sign the Pledge on the page, under Agreements)"

echo "== The officers and the committee"
decide "The offices and the Solidarity Committee" "$(cat <<JSON
[{"kind":"office.create","office":"coordinator","title":"Coordinator","seats":1,"term_days":365},
 {"kind":"office.create","office":"treasurer","title":"Treasurer","seats":1,"term_days":365},
 {"kind":"office.create","office":"librarian","title":"Librarian","seats":1,"term_days":365},
 {"kind":"committee.create","committee":"solidarity","title":"Solidarity Committee","needs":"majority","seats":3,
  "remit":"Settles disputes over deposits, and gives mutual aid in confidence, two signatures at a time."},
 {"kind":"office.fill","office":"coordinator","holder":"$ME"},
 {"kind":"office.fill","office":"treasurer","holder":"$ME"},
 {"kind":"office.fill","office":"librarian","holder":"$ME"},
 {"kind":"committee.appoint","committee":"solidarity","member":"$ME"},
 {"kind":"election.call","election":"coordinator-1","office":"coordinator","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"treasurer-1","office":"treasurer","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"librarian-1","office":"librarian","method":"approval","stand_days":14,"vote_days":7}]
JSON
)"

echo "== The solidarity fund and the powers"
decide "The first budget" '[
 {"kind":"budget.line","line":"deposit-cover","title":"Solidarity fund: covered deposits","amount":30000,"period":"Year I","note":"Pays lenders what a covered loan kept or lost. Approved each year by the Assembly."},
 {"kind":"budget.line","line":"mutual-aid","title":"Solidarity fund: mutual aid","amount":50000,"period":"Year I","note":"Given by the Solidarity Committee in confidence. Never repaid."},
 {"kind":"budget.line","line":"commons","title":"The commons: things held in common","amount":20000,"period":"Year I","note":"Buying and repairing the network’s own things."}]'
decide "The officers' powers" '[
 {"kind":"authority.grant","grant":"library","title":"Keeping the network’s things","to":{"office":"librarian"},"may":["thing.add","thing.keeper","thing.retire","thing.lost"],
  "note":"The Librarian adds the network’s things, chooses who keeps them, retires them, and declares a loan lost once it is a month overdue. Every use is published."},
 {"kind":"authority.grant","grant":"commons-spending","title":"Buying for the commons","to":{"office":"librarian"},"may":["budget.spend"],"where":{"line":"commons"}},
 {"kind":"authority.grant","grant":"claims","title":"Paying claims on covered deposits","to":{"office":"treasurer"},"may":["budget.spend"],"where":{"line":"deposit-cover"},
  "note":"The Treasurer pays a lender’s claim from the deposit-cover line…"},
 {"kind":"authority.grant","grant":"claims-paid","title":"Recording claims paid","to":{"office":"treasurer"},"may":["thing.pay"],"note":"…and records it paid."},
 {"kind":"authority.grant","grant":"disputes","title":"Settling disputes over deposits","to":{"committee":"solidarity"},"may":["thing.settle"],"needs":2},
 {"kind":"authority.grant","grant":"aid","title":"Giving mutual aid","to":{"committee":"solidarity"},"may":["budget.spend"],"where":{"line":"mutual-aid"},"needs":2,"limit":{"count":12,"days":30},
  "note":"Payees are written by member id only; the circumstances are never recorded."},
 {"kind":"authority.grant","grant":"gatherings","title":"Calling gatherings","to":{"office":"coordinator"},"may":["meeting.call"]}]'

echo "== The website"
mkdir -p "$DIR/website" && cp -r "$DIR/sites/kit/." "$DIR/website/" && cp -r "$DIR/sites/solidarity/." "$DIR/website/"   # the shared kit, then the network's own pages
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),site:'website'});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
echo "  website/ is served at /: home, library.html, wiki.html, hall.html"
E verify | tail -1

if command -v rad >/dev/null && rad self >/dev/null 2>&1; then E radicle init | tail -1; else echo "  (Radicle not unlocked: later, cd $DIR && node cli/index.js radicle init)"; fi
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

$NAME is founded in $DIR. Next:
  1. Start it: ~/tsite/deploy/start-all.sh (restart cloudflared if the tunnel config changed)${HOST:+, then open https://$HOST}
  2. Sign the Solidarity Pledge (The network › The Pledge) if it was not signed above.
  3. List a few things of your own in the Library, and invite people: they apply from the front page, signing the Pledge as they do, and the Assembly votes to admit them.
  4. Edit the website in $DIR/website (plain HTML, CSS and JS); changes show on the next reload.
  5. Members stand for Coordinator, Treasurer and Librarian (14 days), then vote (7 days); the Assembly appoints the Solidarity Committee.
EOF
