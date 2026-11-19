#!/usr/bin/env bash
# make-federal-bank.sh · a Federal Bank for the federation: a committee of its
# members that issues the federal currency into its own reserve, and destroys
# currency held there, by the vote of its members.
#
#   bash ~/entities/entity/make-federal-bank.sh [federation-folder] [members]
#   e.g. bash ~/entities/entity/make-federal-bank.sh federation            every citizen of the federation
#        bash ~/entities/entity/make-federal-bank.sh federation tim,ana    just these
#
# MEMBER_PASSWORDS="ana=…,…" gives passwords without being asked.
# Each step is a decision of the federation, so the federal parliament votes on
# it. The script votes for every member whose key is on this computer, and asks
# for the password of members who sign in with one (Enter skips them: they can
# vote on the website instead, under Votes). Run it again to carry on.
#
# What it does:
#   1. brings the federation's code up to this version, and the value module with it
#      (committees may now hold currency, in an account named committee:ID)
#   2. installs the committees and authority modules
#   3. creates the committee federal-bank, appoints its members, and grants it two
#      powers: bank-issue (issue currency into its reserve) and bank-destroy
#      (destroy currency held in its reserve). Its rule is a majority of its members,
#      which with two members means both.
#   4. adds the bank's page, bank.html, to the federation's website

set -u
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"
KEYS="${ENTITY_KEYS:-$HOME/.entity/keys}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
FED="${1:-federation}"; DIR="$HOME_DIR/$FED"; WANT="${2:-}"
[ -f "$DIR/record/events.jsonl" ] || { echo "No entity at $DIR. Give the federation's folder: bash $0 FOLDER"; exit 1; }
[ -f "$SRC/sites/federation/bank.js" ] || { echo "No Federal Bank page in $SRC (it ships with entity 0.9.22 or later)."; exit 1; }
cd "$DIR"
E() { node "$DIR/cli/index.js" "$@"; }
ID="$(head -1 record/events.jsonl | grep -o '"entity":"e-[0-9a-f]*"' | head -1 | cut -d'"' -f4)"
pid() { grep -o 'd-[0-9a-f]\{12\}' | head -1; }
active() { E participants 2>/dev/null | awk '$2 == "active" { print $1 }'; }
carried() { E count "$1" 2>/dev/null | grep -q 'CARRIED, enacted'; }
has_mod() { E params 2>/dev/null | grep -E '^\s+entity\.modules' | grep -q "\"$1\""; }

# Who can vote from here: members with a key file, and members who give their password.
declare -A PW=()
ME=""
for m in $(active); do
  if [ -f "$KEYS/$ID/$m" ]; then [ -z "$ME" ] && ME="$m"; PW[$m]="(key)"
  elif [ -n "${MEMBER_PASSWORDS:-}" ] && p="$(printf '%s\n' ${MEMBER_PASSWORDS//,/ } | sed -n "s/^$m=//p" | head -1)" && [ -n "$p" ]; then PW[$m]="$p"
  elif [ -t 0 ]; then
    read -rsp "  $m signs in with a password: give it to vote as $m here too, or press Enter to skip: " p; echo
    [ -n "$p" ] && PW[$m]="$p"
  fi
done
[ -n "$ME" ] || ME="$(for m in "${!PW[@]}"; do echo "$m"; done | head -1)"
[ -n "$ME" ] || { echo "No member of the federation can sign from this computer."; exit 1; }
echo "== $(E params 2>/dev/null | grep -E '^\s+entity\.name' | sed 's/.*"\(.*\)".*/\1/') ($DIR) · proposing as $ME; voting as ${!PW[*]}"
vote_as() { # member proposal
  if [ "${PW[$1]}" = "(key)" ]; then E act ballot.cast --proposal "$2" --choice for --as "$1" --settle >/dev/null 2>&1
  else ENTITY_PASSWORD="${PW[$1]}" E act ballot.cast --proposal "$2" --choice for --as "$1" --password --settle >/dev/null 2>&1; fi
}
carry() { # proposal label
  E settle >/dev/null 2>&1
  for m in "${!PW[@]}"; do carried "$1" && break; vote_as "$m" "$1"; done
  if carried "$1"; then echo "   $2: carried"; return 0; fi
  echo "   $2: proposed ($1) and waiting for more votes. Others vote on the website (Votes), then run this again."; return 1
}
# An open proposal with this title, from an earlier run.
open_titled() { E status 2>/dev/null | grep -E '^\s+d-[0-9a-f]{12}\s' | grep -F "$1" | pid; }

# 1 · the code, and the value module
OLD="$(node -p "require('./package.json').version")"; NEW="$(node -p "require('$SRC/package.json').version")"
if [ "$OLD" != "$NEW" ]; then
  echo "== The code: $OLD → $NEW"
  if node "$SRC/cli/index.js" upgrade check "dir:$SRC" 2>&1 | grep -q 'DOES NOT replay'; then echo "   the record does not replay with $NEW: stopping"; exit 1; fi
  P="$(open_titled 'Upgrade entity from')"
  [ -z "$P" ] && E upgrade apply >/dev/null 2>&1 && echo "   installed (approved earlier)"
  if [ "$(node -p "require('./package.json').version")" != "$NEW" ]; then
    [ -z "$P" ] && P="$(node "$SRC/cli/index.js" upgrade propose "dir:$SRC" --as "$ME" 2>&1 | pid)"
    [ -n "$P" ] || { echo "   could not propose the upgrade"; exit 1; }
    carry "$P" "upgrade" || exit 0
    E upgrade apply >/dev/null && echo "   installed"
  fi
fi
E module source "$SOURCE" >/dev/null 2>&1 || true
P="$(open_titled 'Upgrade the value module')"
[ -z "$P" ] && P="$(E module upgrade value --as "$ME" 2>&1 | pid)"
# Not published to the module source yet: take it from this installation's library.
grep -q committeeAccount modules/value/index.js || { [ -z "$P" ] && P="$(E module upgrade value "pack:value" --as "$ME" 2>&1 | pid)" && [ -n "$P" ] && echo "   (value from this installation's library: publish entity-modules so peers can fetch it too)"; }
if [ -n "$P" ]; then echo "== The value module (committee accounts)"; carry "$P" "value module" || exit 0; fi
grep -q committeeAccount modules/value/index.js || { echo "   the value module here cannot hold a committee's currency yet: run this again once its upgrade has carried"; exit 0; }

# 2 · committees and powers
for m in committees authority; do
  has_mod "$m" && continue
  echo "== The $m module"
  P="$(open_titled "Install and enable the $m module")"
  [ -z "$P" ] && P="$(E module add "$m" --as "$ME" 2>&1 | pid)"
  [ -z "$P" ] && P="$(E module add "pack:$m" --as "$ME" 2>&1 | pid)"
  [ -n "$P" ] || { echo "   could not propose installing $m"; exit 1; }
  carry "$P" "$m" || exit 0
done

# 3 · the bank
if node --input-type=module -e "import('$DIR/kernel/store.js').then(async s=>{const e=await s.open('$DIR');process.exit(e.state.m.committees?.['federal-bank']?1:0)})"; then
  MEMBERS="${WANT:-$(active | paste -sd, -)}"
  echo "== The Federal Bank: $MEMBERS"
  EFFECTS="$(node -e '
    const ms = process.argv[1].split(",").filter(Boolean), acct = "committee:federal-bank";
    console.log(JSON.stringify([
      { kind: "committee.create", committee: "federal-bank", title: "Federal Bank", needs: "majority",
        remit: "Issues the federal currency into its reserve, and destroys currency held in its reserve, by the vote of its members. Every motion and vote is signed on the record." },
      ...ms.map(m => ({ kind: "committee.appoint", committee: "federal-bank", member: m })),
      { kind: "authority.grant", grant: "bank-issue", title: "Issuing the federal currency", to: { committee: "federal-bank" }, may: ["value.issue"], where: { to: acct } },
      { kind: "authority.grant", grant: "bank-destroy", title: "Destroying currency held by the bank", to: { committee: "federal-bank" }, may: ["value.revoke"], where: { from: acct } },
    ]))' "$MEMBERS")"
  P="$(open_titled 'Create the Federal Bank')"
  [ -z "$P" ] && P="$(E propose --as "$ME" --title "Create the Federal Bank" --text "A committee of $MEMBERS that issues the federal currency into its reserve and destroys currency held there, when a majority of its members vote for it." --effects "$EFFECTS" 2>&1 | pid)"
  [ -n "$P" ] || { echo "   could not propose the bank:"; E propose --as "$ME" --title "Create the Federal Bank" --effects "$EFFECTS"; exit 1; }
  carry "$P" "the bank" || exit 0
else
  echo "== The Federal Bank exists already"
fi

# 4 · its page
echo "== The website"
cp "$SRC/sites/federation/bank.html" "$SRC/sites/federation/bank.js" website/
for f in common.js site.css floor.js one.js hall.js hall.html; do [ -f "$SRC/sites/kit/$f" ] && cp "$SRC/sites/kit/$f" website/; done
[ -f website/config.js ] && ! grep -q "bank.html" website/config.js && sed -i "s|\['hall.html', 'Institutions'\],|['hall.html', 'Institutions'], ['bank.html', 'Federal Bank', 'committees'],|" website/config.js
grep -q "bank.html" website/config.js 2>/dev/null && echo "   bank.html added, and linked as Federal Bank" || echo "   bank.html added (add ['bank.html', 'Federal Bank'] to website/config.js pages to link it)"
E verify | tail -1 | sed 's/^/   /'
cat <<EOF

The Federal Bank is set up. Restart the federation's server (~/tsite/deploy/start-all.sh),
then open its website, Federal Bank:
  1. Sign in as one member and move to issue an amount: Issue, the amount, a reason, Sign the motion.
  2. Sign in as the other member and press Vote for. With both votes it carries: the currency
     appears in the reserve, and in the total.
  3. Move to destroy an amount held in the reserve the same way; it carries with both votes.
EOF
