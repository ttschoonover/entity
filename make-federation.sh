#!/usr/bin/env bash
# make-federation.sh · a federation of two states, each its own entity.
#
#   bash make-federation.sh
#
# Three folders under ~/entities: the federation and its two states. Each state
# has its own citizens, admitted by its own decision, and its own government:
# a parliament, direct democracy, or both (a parliament for ordinary law and a
# referendum of all citizens for the constitution). The federation has:
#   - a senate: every state appoints the same number of senators;
#   - an assembly: seats shared by population, at least one per state;
#   - one currency, which citizens of both states hold and send to each other;
#   - federal parties.
# Everyone in the federation is a citizen of exactly one state. A state tells
# the federation who its citizens are and whom it appoints, from its own record,
# with `entity federation certify`; a citizen takes up federal citizenship with
# `entity federation enroll`. A state leaves only by the federation's decision.
#
# Settings, all optional:
#   ME=tim            founds the federation and state A, and is A's registrar
#   OTHER=ana         founds state B and is its registrar (a second person)
#   FED_NAME="The Federation"  A_NAME="Alpha"  B_NAME="Beta"
#   A_FORM=both       B_FORM=parliament        parliament | direct | both
#   CURRENCY="drachma"  SENATORS=2  ASSEMBLY=10  PORT=7860 (then +1, +2)
#   ENTITY_NEW_PASSWORD   ME's password (asked if unset)
#   OTHER_PASSWORD        OTHER's password (asked if unset)
#   FED_HOST / A_HOST / B_HOST   hostnames for the Cloudflare tunnel, e.g. federation.poezine.org

set -euo pipefail
ME="${ME:-tim}"; OTHER="${OTHER:-ana}"
FED_NAME="${FED_NAME:-The Federation}"; A_NAME="${A_NAME:-Alpha}"; B_NAME="${B_NAME:-Beta}"
A_FORM="${A_FORM:-both}"; B_FORM="${B_FORM:-parliament}"
CURRENCY="${CURRENCY:-drachma}"; SENATORS="${SENATORS:-2}"; ASSEMBLY="${ASSEMBLY:-10}"; PORT="${PORT:-7860}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
slug() { node -p 'process.argv[1].toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")' "$1"; }
FED_DIR="$HOME_DIR/$(slug "$FED_NAME")"; A_DIR="$HOME_DIR/$(slug "$A_NAME")"; B_DIR="$HOME_DIR/$(slug "$B_NAME")"

for v in "$ME" "$OTHER"; do [[ "$v" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "ids are lowercase letters, digits and -: $v"; exit 1; }; done
[ "$ME" != "$OTHER" ] || { echo "ME and OTHER must be different people: nobody is a citizen of two states"; exit 1; }
for f in "$A_FORM" "$B_FORM"; do [[ "$f" =~ ^(parliament|direct|both)$ ]] || { echo "a state's form is parliament, direct or both, not $f"; exit 1; }; done
for d in "$FED_DIR" "$A_DIR" "$B_DIR"; do [ -e "$d" ] && { echo "$d already exists. Move it aside first."; exit 1; }; done
[ -f "$SRC/library/federation/index.js" ] && [ -f "$SRC/library/parties/index.js" ] || { echo "No federation or parties module at $SRC/library (they ship with entity 0.9.14 or later)"; exit 1; }
ask() { local a b; read -rsp "$1 (12 or more characters): " a; echo >&2; read -rsp "The same again: " b; echo >&2; [ "$a" = "$b" ] || { echo "The two passwords differ." >&2; exit 1; }; printf "%s" "$a"; }
ME_PW="${ENTITY_NEW_PASSWORD:-}"; [ -n "$ME_PW" ] || ME_PW="$(ask "A password for $ME")"
OTHER_PW="${OTHER_PASSWORD:-}"; [ -n "$OTHER_PW" ] || OTHER_PW="$(ask "A password for $OTHER")"
J() { node -p 'JSON.stringify(process.argv[1])' "$1"; }

# A fresh copy of the code in DIR; E runs the entity command there.
setup() { mkdir -p "$1"; ( cd "$SRC" && tar cf - --exclude=.git --exclude=.staged --exclude=record --exclude=node_modules --exclude=./parameters.yml --exclude=./node.json . ) | ( cd "$1" && tar xf - ); }
E() { local d="$1"; shift; ( cd "$d" && node cli/index.js "$@" ); }
# Propose as WHO in DIR, and vote for it: the founders decide alone while founding.
decide() {
  local d="$1" who="$2" title="$3" effects="$4" changes="${5:-}" id
  id=$(E "$d" propose --as "$who" --title "$title" --effects "$effects" ${changes:+--changes "$changes"} | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  [ -n "$id" ] || { echo "  could not propose: $title"; exit 1; }
  E "$d" settle > /dev/null
  E "$d" act ballot.cast --proposal "$id" --choice for --as "$who" --settle > /dev/null
  printf '  %-52s %s\n' "$title" "$(E "$d" count "$id" | tail -1)"
}
nodejson() { ( cd "$1" && node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1])});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$2" ); }
entityId() { grep -o '"entity":"e-[0-9a-f]*"' "$1/record/events.jsonl" | head -1 | cut -d'"' -f4; }
# Every public key WHO holds in the entity at DIR, as a JSON list.
keysOf() { ( cd "$1" && node --input-type=module -e "const s=await import('./kernel/store.js');const e=await s.open(process.cwd());console.log(JSON.stringify(e.state.participants[process.argv[1]].keys))" "$2" ); }

# ── the states ───────────────────────────────────────────────────────────
found_state() {
  local dir="$1" name="$2" founder="$3" pw="$4" form="$5"
  echo "== Founding the state of $name ($form) in $dir"
  setup "$dir"
  cat > "$dir/presets/_state.yml" <<YML
_: A state of $FED_NAME, with its own citizens and government.
modules: [deliberation, titles, vocabulary, passwords, offices, elections, wiki, chat, parties]
set:
  entity.name: $(J "$name")
  vocabulary.participant: citizen
  vocabulary.participants: citizens
  vocabulary.assembly: $(J "$( [ "$form" = direct ] && echo "Assembly of Citizens" || echo "Parliament" )")
  membership.admission: decision
  amendment.rules.constitutional.readings: 1
  amendment.rules.constitutional.apart: 0
  amendment.rules.entrenched.readings: 1
  amendment.rules.entrenched.apart: 0
  chat.channels:
    - { id: general, title: General, about: "Anything at all.", read: members, post: members }
    - { id: federal, title: Federal affairs, about: "What our senators and deputies do in the federation.", read: public, post: members }
YML
  E "$dir" preset apply _state > /dev/null
  E "$dir" found --id "$founder" --name "$name" | head -1
  E "$dir" module source "$SOURCE" > /dev/null 2>&1 || true
  ENTITY_NEW_PASSWORD="$pw" E "$dir" password set --as "$founder" --settle > /dev/null
  decide "$dir" "$founder" "Our seats in the federation" "[
    {\"kind\":\"office.create\",\"office\":\"federal-senator\",\"title\":\"Federal Senator\",\"seats\":$SENATORS},
    {\"kind\":\"office.create\",\"office\":\"federal-deputy\",\"title\":\"Federal Deputy\",\"seats\":$(( ASSEMBLY > 50 ? 50 : ASSEMBLY ))},
    {\"kind\":\"office.create\",\"office\":\"federal-registrar\",\"title\":\"Federal Registrar\",\"seats\":1},
    {\"kind\":\"office.fill\",\"office\":\"federal-senator\",\"holder\":\"$founder\"},
    {\"kind\":\"office.fill\",\"office\":\"federal-registrar\",\"holder\":\"$founder\"}]"
  if [ "$form" != direct ]; then
    decide "$dir" "$founder" "A parliament" "[
      {\"kind\":\"office.create\",\"office\":\"parliament\",\"title\":\"Member of Parliament\",\"seats\":9},
      {\"kind\":\"office.fill\",\"office\":\"parliament\",\"holder\":\"$founder\"}]"
    if [ "$form" = both ]; then
      decide "$dir" "$founder" "Parliament makes law; the citizens amend the constitution" "[]" '{"decision.electorate":"office:parliament","decision.referendum":["constitutional","entrenched"]}'
    else
      decide "$dir" "$founder" "Parliament decides" "[]" '{"decision.electorate":"office:parliament"}'
    fi
  fi
  decide "$dir" "$founder" "The constitution takes two readings a month apart" "[]" '{"amendment.rules.constitutional.readings":2,"amendment.rules.constitutional.apart":30,"amendment.rules.entrenched.readings":2,"amendment.rules.entrenched.apart":30}'
}
found_state "$A_DIR" "$A_NAME" "$ME" "$ME_PW" "$A_FORM"
found_state "$B_DIR" "$B_NAME" "$OTHER" "$OTHER_PW" "$B_FORM"
A_ID=$(entityId "$A_DIR"); B_ID=$(entityId "$B_DIR")

# ── the federation ───────────────────────────────────────────────────────
echo "== Founding $FED_NAME in $FED_DIR"
setup "$FED_DIR"
cat > "$FED_DIR/presets/_federation.yml" <<YML
_: $FED_NAME, a federation of states. A senate with equal seats for every state,
   an assembly by population, one currency, and federal parties.
modules: [deliberation, titles, vocabulary, passwords, federation, value, parties, offices, wiki, chat]
set:
  entity.name: $(J "$FED_NAME")
  vocabulary.participant: citizen
  vocabulary.participants: citizens
  vocabulary.assembly: "Federal Parliament"
  membership.admission: decision
  federation.senators_per_state: $SENATORS
  federation.assembly_seats: $ASSEMBLY
  value.name: $(J "$CURRENCY")
  value.transferable: true
  amendment.rules.constitutional.readings: 1
  amendment.rules.constitutional.apart: 0
  amendment.rules.entrenched.readings: 1
  amendment.rules.entrenched.apart: 0
  chat.channels:
    - { id: general, title: General, about: "Citizens of every state.", read: members, post: members }
    - { id: senate, title: Senate, about: "The senate talks bills over; anyone can read.", read: public, post: members }
YML
E "$FED_DIR" preset apply _federation > /dev/null
E "$FED_DIR" found --id "$ME" --name "$FED_NAME" | head -1
E "$FED_DIR" module source "$SOURCE" > /dev/null 2>&1 || true
ENTITY_NEW_PASSWORD="$ME_PW" E "$FED_DIR" password set --as "$ME" --settle > /dev/null
decide "$FED_DIR" "$ME" "Admit $A_NAME and $B_NAME" "[
  {\"kind\":\"federation.admit_state\",\"state\":\"a\",\"name\":$(J "$A_NAME"),\"entity\":\"$A_ID\",\"keys\":$(keysOf "$A_DIR" "$ME")},
  {\"kind\":\"federation.admit_state\",\"state\":\"b\",\"name\":$(J "$B_NAME"),\"entity\":\"$B_ID\",\"keys\":$(keysOf "$B_DIR" "$OTHER")}]"
echo "== $A_NAME certifies its citizens and senators"
E "$FED_DIR" federation certify --from "$A_DIR" --state a --as "$ME" --settle | sed 's/^/  /'
decide "$FED_DIR" "$ME" "The federal parliament decides" "[]" '{"decision.electorate":"parliament"}'
decide "$FED_DIR" "$ME" "The constitution takes two readings a month apart" "[]" '{"amendment.rules.constitutional.readings":2,"amendment.rules.constitutional.apart":30,"amendment.rules.entrenched.readings":2,"amendment.rules.entrenched.apart":30}'
echo "== $B_NAME certifies its citizens and senators"
E "$FED_DIR" federation certify --from "$B_DIR" --state b --as "$OTHER" --settle | sed 's/^/  /'
echo "== $OTHER takes up federal citizenship"
ENTITY_PASSWORD="$OTHER_PW" E "$FED_DIR" federation enroll --from "$B_DIR" --state b --as "$OTHER" --password --settle | sed 's/^/  /'
E "$FED_DIR" federation status | sed 's/^/  /'

nodejson "$FED_DIR" "$PORT"; nodejson "$A_DIR" $((PORT + 1)); nodejson "$B_DIR" $((PORT + 2))

echo "== The website: the federation and both states on one site"
url() { if [ -n "$1" ]; then echo "https://$1/"; else echo "http://localhost:$2/"; fi; }
FED_URL=$(url "${FED_HOST:-}" "$PORT"); A_URL=$(url "${A_HOST:-}" $((PORT + 1))); B_URL=$(url "${B_HOST:-}" $((PORT + 2)))
mkdir -p "$FED_DIR/website" && cp -r "$FED_DIR/sites/kit/." "$FED_DIR/website/" && cp -r "$FED_DIR/sites/federation/." "$FED_DIR/website/"
node -e 'const [f,fn,an,bn,au,bu]=process.argv.slice(1);require("fs").writeFileSync(f,JSON.stringify([{key:"federation",label:fn,url:"./"},{key:"a",label:an,url:au},{key:"b",label:bn,url:bu}],null,2)+"\n")' \
  "$FED_DIR/website/entities.json" "$FED_NAME" "$A_NAME" "$B_NAME" "$A_URL" "$B_URL"
# The states' own addresses lead to the same site, about that state.
for pair in "$A_DIR:a" "$B_DIR:b"; do
  IFS=: read -r d k <<< "$pair"
  mkdir -p "$d/website"
  printf '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=%shall.html?e=%s"><title>Moved</title><p>This state is on <a href="%shall.html?e=%s">the federation’s website</a>.</p>\n' "$FED_URL" "$k" "$FED_URL" "$k" > "$d/website/index.html"
done
for d in "$FED_DIR" "$A_DIR" "$B_DIR"; do ( cd "$d" && node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));n.site='website';fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\\n')" ); done
echo "  $FED_URL shows all three; each record still comes from its own node ($A_URL, $B_URL)"
for d in "$FED_DIR" "$A_DIR" "$B_DIR"; do E "$d" verify | tail -1 | sed "s|^|  $(basename "$d"): |"; done

# On the Pi: add the three to the start script and the tunnel, when hostnames are given.
START="$HOME/tsite/deploy/start-all.sh"; CFG="$HOME/.cloudflared/config.yml"
for pair in "$FED_DIR:$PORT:${FED_HOST:-}" "$A_DIR:$((PORT + 1)):${A_HOST:-}" "$B_DIR:$((PORT + 2)):${B_HOST:-}"; do
  IFS=: read -r d p host <<< "$pair"
  [ -f "$START" ] && ! grep -q "$d:" "$START" && sed -i "s|^ENTITIES=(\(.*\))|ENTITIES=(\1 \"$d:$p\")|" "$START" && echo "  $(basename "$d") added to the start script"
  if [ -n "$host" ] && [ -f "$CFG" ] && ! grep -q "hostname: $host" "$CFG"; then
    python3 - "$CFG" "$host" "$p" <<'PY'
import sys; c,h,p=sys.argv[1:4]; s=open(c).read()
s=s.replace('  - service: http_status:404', f'  - hostname: {h}\n    service: http://localhost:{p}\n  - service: http_status:404'); open(c,'w').write(s)
PY
    cloudflared tunnel route dns --overwrite-dns poezine "$host" 2>&1 | tail -1 || true
  fi
done

cat <<EOF

$FED_NAME is founded, with $A_NAME ($A_FORM) and $B_NAME ($B_FORM).
  $FED_DIR   port $PORT
  $A_DIR   port $((PORT + 1))
  $B_DIR   port $((PORT + 2))
Start them: ~/tsite/deploy/start-all.sh, or in each folder: node cli/index.js serve --settle
Then open $FED_URL: the federation and both states, on one site.

When a state admits citizens or appoints senators and deputies (offices
federal-senator and federal-deputy), its registrar presses "Report to the
federation" on the home page, or from the command line:
  cd $FED_DIR && node cli/index.js federation certify --from $A_DIR --state a --as $ME --settle
New citizens then press "Become a citizen of the federation", or:
  cd $FED_DIR && node cli/index.js federation enroll --from $A_DIR --state a --as ID --password --settle
The currency ($CURRENCY) is issued by federal decision (value.issue) and sent between citizens of both states.
EOF
