#!/usr/bin/env bash
# make-sealed-republic.sh · create a republic whose content only members can read.
#
#   bash make-sealed-republic.sh "The Name" folder-name your-id [port] [hostname]
#   e.g. bash make-sealed-republic.sh "The Inner Chamber" chamber tim 7980 chamber.poezine.org
#
# It founds the republic with the sealed module (and page, passwords, offices,
# meetings), sets your password, publishes your encryption key, starts the
# first key period, and keeps its copies private on Radicle. With a hostname,
# it also adds it to the start script and the Cloudflare tunnel. Admission is by
# decision, so nobody joins without the members' vote.

set -euo pipefail
NAME="${1:?usage: make-sealed-republic.sh \"Name\" folder your-id [port] [hostname]}"
FOLDER="${2:?give a folder name}"; ME="${3:?give your member id}"; PORT="${4:-7980}"; HOST="${5:-}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
DIR="$HOME_DIR/$FOLDER"
[[ "$FOLDER" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "The folder name is lowercase letters, digits and -"; exit 1; }
[[ "$ME" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "Your id is lowercase letters, digits and -"; exit 1; }
[ -e "$DIR" ] && { echo "$DIR already exists: choose another folder name"; exit 1; }
[ -f "$SRC/cli/index.js" ] || { echo "No entity code at $SRC"; exit 1; }

# The password: asked twice here, or taken from ENTITY_NEW_PASSWORD.
if [ -z "${ENTITY_NEW_PASSWORD:-}" ]; then
  read -rsp "A password for $ME (12 or more characters): " PW; echo
  read -rsp "The same again: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "The two passwords differ."; exit 1; }
  export ENTITY_NEW_PASSWORD="$PW"
fi

echo "== Founding $NAME in $DIR"
mkdir -p "$DIR"
( cd "$SRC" && tar cf - --exclude=.git --exclude=.staged --exclude=record --exclude=node_modules --exclude=./parameters.yml --exclude=./node.json . ) | ( cd "$DIR" && tar xf - )
cd "$DIR"
E() { node "$DIR/cli/index.js" "$@"; }
cat > presets/_sealed.yml <<EOF
_: A republic whose content only its members can read.
modules: [page, deliberation, titles, vocabulary, offices, meetings, passwords, sealed]
set:
  entity.name: $(node -p 'JSON.stringify(process.argv[1])' "$NAME")
  membership.admission: "decision"
  sealed.history: "all"
EOF
E preset apply _sealed >/dev/null
E found --id "$ME" --name "$NAME" | head -1
E module source "$SOURCE" >/dev/null 2>&1 || true

echo "== Your password and your encryption key"
E password set --as "$ME" --settle | tail -1
E seal key --as "$ME" --settle | tail -1
echo "== The first key period"
E seal epoch --as "$ME" --settle | tail -1
E seal status

node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),look:'minimal',colour:'dark'});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
E verify | tail -1

echo "== Private copies"
if command -v rad >/dev/null && rad self >/dev/null 2>&1; then E radicle init --private | tail -2
else echo "   Radicle is not set up here: later, run  cd $DIR && node cli/index.js radicle init --private"; fi

if [ -n "$HOST" ]; then
  echo "== Putting it at https://$HOST"
  START="$HOME/tsite/deploy/start-all.sh"
  if [ -f "$START" ] && ! grep -q "entities/$FOLDER:" "$START"; then sed -i "s|^ENTITIES=(\(.*\))|ENTITIES=(\1 \"\$HOME/entities/$FOLDER:$PORT\")|" "$START"; echo "   added to the start script"; fi
  CFG="$HOME/.cloudflared/config.yml"
  if [ -f "$CFG" ] && ! grep -q "hostname: $HOST" "$CFG"; then
    python3 - "$CFG" "$HOST" "$PORT" <<'PY'
import sys; p,h,port=sys.argv[1:4]; s=open(p).read()
s=s.replace('  - service: http_status:404', f'  - hostname: {h}\n    service: http://localhost:{port}\n  - service: http_status:404'); open(p,'w').write(s)
PY
    echo "   added to the tunnel"
    cloudflared tunnel route dns --overwrite-dns poezine "$HOST" 2>&1 | tail -1 || true
  fi
fi

cat <<EOF

Done. $NAME is founded, and its content is sealed to its members.
  Serve it:      ~/tsite/deploy/start-all.sh${HOST:+   (then open https://$HOST)}
                 or, alone:  cd $DIR && node cli/index.js serve --settle --port $PORT
  Close its page to everyone but members: Cloudflare Zero Trust → Access → Applications
                 → Self-hosted${HOST:+, $HOST,} allowing only members' email addresses.
  Members join on its page (they need your vote), then on the Sealed tab press
  "Publish my encryption key"; you give them the key there (or: node cli/index.js seal grant NAME --as $ME --settle).
EOF
