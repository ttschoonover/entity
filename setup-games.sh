#!/usr/bin/env bash
# setup-games.sh · put Nomic and a mahjong world on this Pi, on Radicle, and
# behind the poezine Cloudflare tunnel, in one go. Safe to run again: whatever
# is already set up is checked and left alone (or its website refreshed).
#
#   bash ~/entities/entity/setup-games.sh [your-id]          (default: tim)
#
# Settings, if the defaults don't suit (put them before the command):
#   NOMIC_HOST=nomic.poezine.org     NOMIC_PORT=7860     NOMIC_FOLDER=nomic
#   MAHJONG_HOST=mahjong.poezine.org MAHJONG_PORT=7890   MAHJONG_FOLDER=mahjong
#   MAHJONG_NAME="Mahjong"           TUNNEL=poezine      SKIP_RADICLE=1
#
# It asks for a password for each new game (your sign-in on its website).
# If a game already exists, its code is upgraded by your vote (update-republics.sh),
# which stops every entity server on the Pi while it runs: start them again after.

set -uo pipefail
ME="${1:-tim}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"
NOMIC_HOST="${NOMIC_HOST-nomic.poezine.org}"; NOMIC_PORT="${NOMIC_PORT:-7860}"; NOMIC_FOLDER="${NOMIC_FOLDER:-nomic}"
MAHJONG_HOST="${MAHJONG_HOST-mahjong.poezine.org}"; MAHJONG_PORT="${MAHJONG_PORT:-7890}"; MAHJONG_FOLDER="${MAHJONG_FOLDER:-mahjong}"
MAHJONG_NAME="${MAHJONG_NAME:-Mahjong}"; TUNNEL="${TUNNEL:-poezine}"
CFG="$HOME/.cloudflared/config.yml"; START="$HOME/tsite/deploy/start-all.sh"
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

echo "== Checking this Pi"
command -v node >/dev/null || die "Node.js is not installed. sudo apt install nodejs (version 20 or later)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] && ok "Node $(node -v)" || die "Node $(node -v) is too old; entity needs 20 or later."
[ -f "$SRC/cli/index.js" ] || die "No entity code at $SRC. Unzip entity-0_9_19.zip into $HOME_DIR first."
VER="$(node -p "require('$SRC/package.json').version")"
node -e "const [a,b,c]=process.argv[1].split('.').map(Number);process.exit(a>0||b>9||(b===9&&c>=19)?0:1)" "$VER" \
  && ok "entity $VER at $SRC" || die "entity $VER at $SRC is older than 0.9.19 (the version with the mahjong world and the Swiss Nomic). Unzip the new one over it."
[ -f "$SRC/sites/nomic/index.html" ] && [ -f "$SRC/sites/mahjong/index.html" ] || die "The nomic or mahjong website is missing from $SRC/sites."
# Ports: a game that exists keeps its own; a new one gets the first free port
# from its default up, skipping any port named in another entity's node.json
# (broken or old copies too), the start script, the tunnel config, or in use now.
taken() { # port folder
  local f; for f in "$HOME_DIR"/*/node.json; do [ -f "$f" ] || continue
    [ "$(basename "$(dirname "$f")")" = "$2" ] && continue
    grep -qE "\"port\": *$1\b" "$f" && return 0; done
  grep -qs ":$1\b" "$START" "$CFG" && return 0
  (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$1\s" && return 0
  return 1
}
pick() { # folder default → port
  local f="$HOME_DIR/$1/node.json" p="$2"
  [ -f "$f" ] && { node -p "require('$f').port || ''" | grep . && return; }
  while taken "$p" "$1"; do p=$((p + 1)); done; echo "$p"
}
NOMIC_PORT="$(pick "$NOMIC_FOLDER" "$NOMIC_PORT")"
MAHJONG_PORT="$(pick "$MAHJONG_FOLDER" "$MAHJONG_PORT")"
[ "$MAHJONG_PORT" = "$NOMIC_PORT" ] && MAHJONG_PORT="$(pick "$MAHJONG_FOLDER" $((NOMIC_PORT + 1)))"
ok "ports: Nomic $NOMIC_PORT, mahjong $MAHJONG_PORT"
HAVE_CF=no; [ -f "$CFG" ] && command -v cloudflared >/dev/null && HAVE_CF=yes
[ $HAVE_CF = yes ] && ok "Cloudflare tunnel config at $CFG" || no "no cloudflared or no $CFG: the games will run locally; the web addresses are skipped"
HAVE_RAD=no
if [ -z "${SKIP_RADICLE:-}" ] && command -v rad >/dev/null; then
  if rad self >/dev/null 2>&1; then
    HAVE_RAD=yes; ok "Radicle identity $(rad self --did 2>/dev/null || true)"
    rad node status >/dev/null 2>&1 || { rad node start >/dev/null 2>&1 && ok "started the Radicle node" || no "could not start the Radicle node (rad node start)"; }
  else no "Radicle is installed but has no identity here: run 'rad auth' (empty passphrase), then this script again"; fi
else no "Radicle is skipped (not installed, or SKIP_RADICLE is set)"; fi
# The offline mahjong file ships built; rebuild it in case the source changed.
node "$SRC/tools/build-mahjong-solo.mjs" >/dev/null && ok "built the offline mahjong file"

# ── helpers ──
# Refresh an existing game's website from the new code, keeping a copy of the old one.
refresh_site() { # folder site
  local d="$HOME_DIR/$1" bak; bak="$d/website.before-$(date +%Y%m%d-%H%M%S)"
  [ -d "$d/website" ] && mv "$d/website" "$bak"
  mkdir -p "$d/website"; cp -r "$SRC/sites/kit/." "$d/website/"; mv "$d/website/site.css" "$d/website/kit.css"; cp -r "$SRC/sites/$2/." "$d/website/"
  [ -f "$d/.gitignore" ] && ! grep -q '^website.before-' "$d/.gitignore" && echo 'website.before-*/' >> "$d/.gitignore"
  ok "website refreshed (the old one is in $(basename "$bak"))"
}
publish() { # folder
  local d="$HOME_DIR/$1"
  [ $HAVE_RAD = yes ] || return 0
  local rid; rid="$(cd "$d" && rad . 2>/dev/null)"
  if [ -z "$rid" ]; then (cd "$d" && node cli/index.js radicle init | sed 's/^/    /'); rid="$(cd "$d" && rad . 2>/dev/null)"; fi
  [ -n "$rid" ] || { no "could not publish $1 on Radicle (cd $d && node cli/index.js radicle init)"; return 0; }
  (cd "$d" && node cli/index.js sync >/dev/null 2>&1; rad sync --announce >/dev/null 2>&1) || true
  ok "on Radicle as $rid"
  RIDS+=("$1  $rid")
}
route() { # host port folder
  [ -n "$1" ] || return 0
  if [ -f "$START" ] && ! grep -q "entities/$3:" "$START"; then
    sed -i "s|^ENTITIES=(\(.*\))|ENTITIES=(\1 \"\$HOME/entities/$3:$2\")|" "$START" && ok "added to $START"
  elif [ -f "$START" ]; then ok "already in the start script"; else no "no $START: start it yourself (cd $HOME_DIR/$3 && node cli/index.js serve --settle)"; fi
  [ $HAVE_CF = yes ] || return 0
  if grep -q "hostname: $1" "$CFG"; then ok "$1 is already in the tunnel config"
  else
    grep -q '  - service: http_status:404' "$CFG" || { no "$CFG has no catch-all line '  - service: http_status:404'; add $1 → http://localhost:$2 by hand"; return 0; }
    cp "$CFG" "$CFG.bak"
    python3 - "$CFG" "$1" "$2" <<'PY'
import sys; p,h,port=sys.argv[1:4]; s=open(p).read()
s=s.replace('  - service: http_status:404', f'  - hostname: {h}\n    service: http://localhost:{port}\n  - service: http_status:404', 1); open(p,'w').write(s)
PY
    ok "$1 → localhost:$2 added to the tunnel config"
    CF_CHANGED=yes
  fi
  cloudflared tunnel route dns --overwrite-dns "$TUNNEL" "$1" >/dev/null 2>&1 && ok "DNS for $1 points at the $TUNNEL tunnel" || no "could not set DNS for $1 (cloudflared tunnel route dns $TUNNEL $1)"
}
smoke() { # folder port path
  local d="$HOME_DIR/$1" pid code
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$2$3" || true)"
  [ "$code" = 200 ] && { ok "already running on port $2"; return 0; }
  ( cd "$d" && exec node cli/index.js serve --port "$2" >/dev/null 2>&1 ) & pid=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 1; code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$2$3" || true)"; [ "$code" = 200 ] && break; done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  [ "$code" = 200 ] && ok "serves http://localhost:$2$3" || no "did not answer on port $2 (got ${code:-nothing}); try: cd $d && node cli/index.js serve --settle"
}
RIDS=(); CF_CHANGED=no

# ── Nomic ──
echo; echo "== Nomic  ($NOMIC_HOST)"
if [ -f "$HOME_DIR/$NOMIC_FOLDER/record/events.jsonl" ]; then
  ok "already founded in $HOME_DIR/$NOMIC_FOLDER"
  bash "$SRC/update-republics.sh" "$NOMIC_FOLDER" 2>&1 | sed -n '/^Summary/,/^$/p' | sed -n '2p'
  refresh_site "$NOMIC_FOLDER" nomic
else
  bash "$SRC/make-nomic.sh" "$ME" "Nomic" "$NOMIC_FOLDER" "$NOMIC_PORT" "" || die "Founding Nomic failed (above)."
fi
publish "$NOMIC_FOLDER"; route "$NOMIC_HOST" "$NOMIC_PORT" "$NOMIC_FOLDER"; smoke "$NOMIC_FOLDER" "$NOMIC_PORT" /

# ── Mahjong ──
echo; echo "== Mahjong  ($MAHJONG_HOST)"
if [ -f "$HOME_DIR/$MAHJONG_FOLDER/record/events.jsonl" ]; then
  ok "already founded in $HOME_DIR/$MAHJONG_FOLDER"
  bash "$SRC/update-republics.sh" "$MAHJONG_FOLDER" 2>&1 | sed -n '/^Summary/,/^$/p' | sed -n '2p'
  refresh_site "$MAHJONG_FOLDER" mahjong
else
  bash "$SRC/make-mahjong-world.sh" "$ME" "$MAHJONG_NAME" "$MAHJONG_FOLDER" "$MAHJONG_PORT" "" || die "Founding the mahjong world failed (above)."
fi
publish "$MAHJONG_FOLDER"; route "$MAHJONG_HOST" "$MAHJONG_PORT" "$MAHJONG_FOLDER"; smoke "$MAHJONG_FOLDER" "$MAHJONG_PORT" /mahjong/tables

# ── done ──
echo; echo "== Done"
[ ${#RIDS[@]} -gt 0 ] && { echo "On Radicle (send these to friends who want their own copy):"; for r in "${RIDS[@]}"; do echo "  $r"; done; }
if [ $HAVE_CF = yes ]; then
  [ $CF_CHANGED = yes ] && echo "The tunnel config changed: restart cloudflared (stop start-all.sh with Ctrl-C and run it again)."
fi
cat <<EOF
Start everything:   $START
Then open:          ${NOMIC_HOST:+https://$NOMIC_HOST  }${MAHJONG_HOST:+https://$MAHJONG_HOST}
On this Pi:         http://localhost:$NOMIC_PORT  http://localhost:$MAHJONG_PORT
EOF
