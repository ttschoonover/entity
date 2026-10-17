#!/usr/bin/env bash
# make-society.sh · a secret society with mutual aid, an interest-free loan
# fund, an endowment and a budget, as a sealed Git Republic.
#
#   bash make-society.sh your-id ["Society Name"] [folder] [port] [hostname]
#   e.g. bash make-society.sh tim "The Digital Republic Society" society 7820 society.poezine.org
#
# Three degrees (Node, Validator, Keeper of Keys); a Grand Archon, Scribe,
# Keeper of the Purse, Almoner, Warden and Herald; three Stewards who sign loans
# two at a time. Admission by the Conclave, after signing the Obligation by hand.
# Mutual aid is given by the Almoner within a budget line; its circumstances are
# sealed. Copies stay private on Radicle. Its site is private: nothing but a
# sign-in page answers until a member signs in with their own account. Constitutional motions carry in a
# single vote (no second reading); entrenched ones still need two.

set -euo pipefail
ME="${1:?usage: make-society.sh your-id [\"Society Name\"] [folder] [port] [hostname]}"
NAME="${2:-The Digital Republic Society}"; FOLDER="${3:-society}"; PORT="${4:-7820}"; HOST="${5:-}"
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

cat > presets/_society.yml <<YML
_: A fraternal society devoted to decentralised technology, with three degrees,
   a mutual-aid fund, an interest-free loan fund, an endowment and a budget.
   Admission by the Conclave; the Obligation is signed by hand; sealed matters.
modules: [page, deliberation, titles, vocabulary, offices, committees, authority, elections,
          wiki, agreements, badges, threads, meetings, polls, passwords, sealed,
          budget, loans, endowment]
set:
  entity.name: $(node -p 'JSON.stringify(process.argv[1])' "$NAME")
  vocabulary.participant: "member"
  vocabulary.participants: "members"
  vocabulary.assembly: "Conclave"
  vocabulary.proposal: "motion"
  membership.admission: "decision"
  agreements.required: ["the-obligation"]
  agreements.drawn_signature: "required"
  sealed.history: "all"
  deliberation.period: 7
  amendment.rules.constitutional.readings: 1
  amendment.rules.constitutional.apart: 0
  loans.max_amount: 50000
  loans.max_open: 1
  endowment.spend_rate: 400
  threads.boards: ["the-hall", "the-workshop", "protocols", "requests-for-aid"]
YML
echo "== Founding $NAME in $DIR"
E preset apply _society >/dev/null
E found --id "$ME" --name "$NAME" | head -1
E module source "$SOURCE" >/dev/null 2>&1 || true
E password set --as "$ME" --settle >/dev/null && echo "  your password is set"

echo "== The degrees and the officers"
decide "The degrees" "$(cat <<JSON
[{"kind":"committee.create","committee":"first-degree","title":"First Degree · Node","needs":"majority","remit":"Every initiated member. Nodes keep a copy, and keep the society's confidences."},
 {"kind":"committee.create","committee":"second-degree","title":"Second Degree · Validator","needs":"majority","remit":"Members who have served a year and shown their work. Validators raise Nodes."},
 {"kind":"committee.create","committee":"third-degree","title":"Third Degree · Keeper of Keys","needs":"majority","remit":"The society's elders. Keepers keep its rites, and raise Validators."},
 {"kind":"committee.appoint","committee":"first-degree","member":"$ME"},
 {"kind":"committee.appoint","committee":"second-degree","member":"$ME"},
 {"kind":"committee.appoint","committee":"third-degree","member":"$ME"}]
JSON
)"
decide "The officers" "$(cat <<JSON
[{"kind":"office.create","office":"grand-archon","title":"Grand Archon","seats":1,"term_days":365},
 {"kind":"office.create","office":"scribe","title":"Scribe","seats":1,"term_days":365},
 {"kind":"office.create","office":"keeper-of-the-purse","title":"Keeper of the Purse","seats":1,"term_days":365},
 {"kind":"office.create","office":"almoner","title":"Almoner","seats":1,"term_days":365},
 {"kind":"office.create","office":"warden","title":"Warden","seats":1,"term_days":365},
 {"kind":"office.create","office":"herald","title":"Herald","seats":1,"term_days":365},
 {"kind":"committee.create","committee":"stewards","title":"Stewards of the Endowment","needs":"majority","seats":3,
  "remit":"Three members who decide loans from the loan fund (two signatures each) and watch over the endowment."},
 {"kind":"office.fill","office":"grand-archon","holder":"$ME"},
 {"kind":"office.fill","office":"scribe","holder":"$ME"},
 {"kind":"office.fill","office":"keeper-of-the-purse","holder":"$ME"},
 {"kind":"committee.appoint","committee":"stewards","member":"$ME"},
 {"kind":"election.call","election":"grand-archon-1","office":"grand-archon","method":"ranked","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"almoner-1","office":"almoner","method":"ranked","stand_days":14,"vote_days":7}]
JSON
)"

echo "== The money"
decide "The first budget" '[
 {"kind":"budget.line","line":"mutual-aid","title":"Mutual aid","amount":100000,"period":"Year I","note":"Gifts to members in need, given by the Almoner. Never repaid."},
 {"kind":"budget.line","line":"gatherings","title":"Convocations and gatherings","amount":50000,"period":"Year I"},
 {"kind":"budget.line","line":"operations","title":"Operations","amount":20000,"period":"Year I","note":"The server, the domain, printing."}]'
decide "The officers' powers" '[
 {"kind":"authority.grant","grant":"aid","title":"Giving mutual aid","to":{"office":"almoner"},"may":["budget.spend"],"where":{"line":"mutual-aid"},"limit":{"count":12,"days":30},
  "note":"The Almoner gives from the mutual-aid line without a vote, at most twelve gifts a month. Payees are written by member id only; the circumstances go in a sealed post."},
 {"kind":"authority.grant","grant":"purse","title":"Paying the society’s bills","to":{"office":"keeper-of-the-purse"},"may":["budget.spend"],"where":{"line":["gatherings","operations"]}},
 {"kind":"authority.grant","grant":"endowment-books","title":"Keeping the endowment’s books","to":{"office":"keeper-of-the-purse"},"may":["endowment.gift","endowment.value"],
  "note":"The Keeper records gifts and the endowment’s value each quarter. Draws are decided by the Conclave."},
 {"kind":"authority.grant","grant":"lending","title":"Making and recording loans","to":{"committee":"stewards"},"may":["loan.make","loan.repay"],"needs":2,
  "note":"Two Stewards sign each loan, and each repayment. Forgiving a loan is decided by the Conclave."},
 {"kind":"authority.grant","grant":"raise-to-first","title":"Initiating Nodes","to":{"committee":"second-degree"},"may":["committee.appoint"],"where":{"committee":"first-degree"}},
 {"kind":"authority.grant","grant":"raise-to-second","title":"Raising Validators","to":{"committee":"third-degree"},"may":["committee.appoint"],"where":{"committee":"second-degree"}},
 {"kind":"authority.grant","grant":"convocations","title":"Calling convocations","to":{"office":"scribe"},"may":["meeting.call"]},
 {"kind":"authority.grant","grant":"marks","title":"Conferring marks","to":{"office":"grand-archon"},"may":["badge.award"]}]'
decide "The marks of the society" "$(cat <<JSON
[{"kind":"badge.create","badge":"founder","title":"Founder"},
 {"kind":"badge.create","badge":"cipher","title":"The Cipher","description":"Solved the society's cipher."},
 {"kind":"badge.create","badge":"lamp","title":"The Lamp","description":"Taught something to the society."},
 {"kind":"badge.create","badge":"benefactor","title":"Benefactor","description":"Gave to the endowment."},
 {"kind":"badge.award","badge":"founder","to":"$ME"}]
JSON
)"
decide "The first convocation" "[{\"kind\":\"meeting.call\",\"meeting\":\"convocation-1\",\"title\":\"First Convocation\",\"starts\":\"$(later 14)\",\"agenda\":[\"Adopt the Obligation and the Book of Rites\",\"Admit the first members\",\"Elect the Grand Archon and the Almoner\",\"Seat the Stewards\",\"Dues, the loan fund and the endowment\"]}]"

echo "== The founding texts"
page the-obligation "The Obligation" "Foundations" "I join $NAME freely, and I bind myself to it by my own signature.

I will keep the society's confidences: its rites, its proceedings and what members share in trust, except where the law requires otherwise or someone's safety is at stake.
I will learn, build and teach in the open where I can, and keep my keys as I keep my word.
I will treat every member as an equal, whatever their degree.
I will help members in need as I am able, and repay what I borrow from the society.
I will take part in no initiation that harms, humiliates or pressures anyone, and I will report one if I see it.
I may leave at any time, and leaving releases me from everything here except the confidences I was given and any loan I have not repaid."
page book-of-rites "The Book of Rites" "Foundations" "*Draft, for the Conclave to adopt. Kept by the Scribe.*

## The degrees
1. **Node (First Degree).** Every initiated member. A Node keeps a copy of the society's record and its confidences.
2. **Validator (Second Degree).** After a year in the society and work shown to it. Validators initiate new Nodes.
3. **Keeper of Keys (Third Degree).** The society's elders. Keepers keep the rites and raise Validators.

## Admission and initiation
1. A candidate is proposed by a member and admitted by the Conclave.
2. Before initiation, the candidate reads and signs the Obligation, by hand, on the record.
3. Initiation is a short ceremony at a convocation: the candidate's key is read aloud, the Obligation is spoken, and the Herald announces the new Node. Initiation is never physical, never secret from the candidate, and never under pressure. A candidate may stop at any moment.

## Mutual aid
A member in need writes to the Almoner, in confidence. The Almoner may give from the mutual-aid line without a vote, up to twelve gifts a month; gifts are never repaid. The record shows only the amount and the member's id; the circumstances are written in a sealed post, readable by members alone. The Almoner reports the line's total to each convocation, never the names.

## The loan fund
Members may borrow from the loan fund, interest-free: at most \$500, one loan at a time, unless the Conclave changes those limits. Two Stewards sign each loan and each repayment. Repayments return to the fund for the next member. Only the Conclave may forgive a loan, with a reason.

## The endowment
Gifts to the endowment are kept forever. Each year the Conclave may draw up to 4% of its value, never below what was given, for the loan fund or the budget. The Keeper of the Purse records gifts and the endowment's value each quarter. Benefactors receive the Benefactor mark.

## The budget
The Conclave approves the budget each year. The Keeper of the Purse pays gatherings and operations within it; the Almoner gives mutual aid within its own line.

## Dues
Dues are set by the Conclave and paid to the Keeper of the Purse, who reports totals, never names.

## Convocations
The society meets in convocation at least four times a year. The Grand Archon presides, the Warden admits those present, and the Scribe keeps the minutes. Members check themselves in.

## The cipher
Once a year, the Third Degree sets a cipher. Whoever solves it first receives the Cipher mark.

## Secrecy
The society's record is private: it is replicated only among members' own machines, and its website is closed to everyone else. Inside, every member can read everything, except sealed matters, which only members holding the key can open. Matters for the Third Degree alone are kept in the Inner Chamber, a separate private record only Keepers hold."
page officers-duties "Officers' duties" "Handbook" "## Keeper of the Purse
- Holds the society's bank account. Pays gatherings and operations within the budget (grant: Paying the society's bills).
- Collects dues; records gifts to the endowment and its value each quarter (grant: Keeping the endowment's books).
- Hands out the money for loans and receives repayments, which two Stewards then record.

## Almoner
- Receives requests for aid in confidence, and gives from the mutual-aid line (grant: Giving mutual aid), writing the payee as a member id only.
- Records the circumstances in a sealed post. Reports totals, never names.

## Stewards of the Endowment
- Two sign each loan and each repayment (grant: Making and recording loans). Watch the endowment, and propose draws to the Conclave.

## Grand Archon · Scribe · Warden · Herald
- The Grand Archon presides and confers marks; the Scribe calls convocations, keeps minutes and gives new members the sealed key; the Warden admits those present; the Herald announces new Nodes."

echo "== Sealed matters"
E seal key --as "$ME" --settle >/dev/null && echo "  your encryption key is published"
E seal epoch --as "$ME" --settle >/dev/null && echo "  key period 1 has begun"
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),look:'minimal',colour:'dark',private:true,modulesOnline:false});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
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

$NAME is founded in $DIR. Next:
  1. Start it: ~/tsite/deploy/start-all.sh${HOST:+, then open https://$HOST}
  2. The site is private: visitors see only a sign-in page (and can apply). For a second lock, add Cloudflare Access too.
  3. Wiki: adopt the Obligation and the Book of Rites (Propose enacting), then sign the Obligation by hand (Agreements tab).
  4. Candidates apply on the page and sign the Obligation; the Conclave admits them.
  5. Sealed: each member publishes their key on the Sealed tab; the Scribe gives them the key.
  6. Money: the Conclave funds the loan fund (loan.fund) and records gifts to the endowment.
EOF
