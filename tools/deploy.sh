#!/usr/bin/env bash
# deploy.sh · send this code to the Raspberry Pi and bring its republics up to it.
#
#   bash tools/deploy.sh pi@raspberrypi.local                 send, test, update every republic
#   bash tools/deploy.sh local                                on the Pi itself, from a checkout there (no ssh)
#   bash tools/deploy.sh pi@raspberrypi.local orchard lothlorien    just these republics
#   bash tools/deploy.sh --dry-run pi@raspberrypi.local       say what it would do, change nothing
#   bash tools/deploy.sh --no-test --no-update pi@…           only replace the code
#   bash tools/deploy.sh --rehearse pi@raspberrypi.local      upgrade COPIES of the republics with the
#                                                             new code and report; the live ones are untouched
#
# On the Pi, in ~/entities (ENTITIES to change it):
#   1. the code arrives as entity.incoming/ (state is never sent: no record,
#      settings, node settings, keys or git history), and its tests run there;
#   2. entity/ becomes entity.prev/ and entity.incoming/ becomes entity/, so a
#      failed deploy is undone with: mv entity entity.bad && mv entity.prev entity;
#   3. update-republics.sh proposes the upgrade in each republic and votes for
#      it as you (it carries at once where you are the only member);
#   4. the start script (~/tsite/deploy/start-all.sh, START to change it) runs
#      the servers again;
#   5. the privacy check reads every republic (a HIGH finding, such as a record
#      a stranger can read from a private node, stops the script), and each
#      public hostname in the Cloudflare tunnel's config is asked for its
#      headers: an entity page without HSTS or nosniff stops it too.
# Nothing here signs as anyone but the keys already on the Pi. See docs/DEPLOY.md.
set -euo pipefail
DRY=0 TEST=1 UPDATE=1 REHEARSE=0
while [[ "${1:-}" == --* ]]; do case "$1" in
  --dry-run) DRY=1 ;; --no-test) TEST=0 ;; --no-update) UPDATE=0 ;; --rehearse) REHEARSE=1 ;;
  *) echo "unknown option $1"; exit 2 ;; esac; shift; done
HOST="${1:?usage: deploy.sh [--dry-run] [--no-test] [--no-update] user@host [republic …]}"; shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_HOME="${ENTITIES:-entities}"
START="${START:-tsite/deploy/start-all.sh}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
run() { if [ $DRY = 1 ]; then echo "would run: $*"; else "$@"; fi; }

echo "== Sending entity $VERSION to $HOST:$REMOTE_HOME/entity.incoming"
# Only top-level names are left out, by listing what to send: macOS's tar matches
# --exclude at any depth, and would drop every module's parameters.yml.
PACK="$(mktemp -d)/entity-$VERSION.tgz"
SEND=()
for f in "$ROOT"/* "$ROOT"/.[!.]*; do
  [ -e "$f" ] || continue; n="$(basename "$f")"
  [[ "$n" =~ ^(\.git|\.staged|\.entity|record|pending|settled|refused|participants|parameters\.yml|node\.json|node_modules|site|parent)$ ]] && continue
  SEND+=("$n")
done
# COPYFILE_DISABLE: no "._name" files of Mac metadata (quarantine marks and the like) in the pack.
COPYFILE_DISABLE=1 tar czf "$PACK" -C "$ROOT" --exclude="._*" --exclude=".DS_Store" "${SEND[@]}"
echo "   $(du -h "$PACK" | cut -f1) packed"
if [ "$HOST" = local ]; then run cp "$PACK" /tmp/entity-incoming.tgz; else run scp -q "$PACK" "$HOST:/tmp/entity-incoming.tgz"; fi

# Everything else happens on the Pi, in one session.
REMOTE=$(cat <<EOF
set -euo pipefail
cd "\$HOME/$REMOTE_HOME"
rm -rf entity.incoming && mkdir entity.incoming && tar xzf /tmp/entity-incoming.tgz -C entity.incoming && rm /tmp/entity-incoming.tgz
echo "   unpacked: \$(node -p "require('./entity.incoming/package.json').version")"
if [ $TEST = 1 ]; then
  echo "== Testing it on the Pi (a few minutes)"
  ( cd entity.incoming && npm test 2>&1 | grep -E '^# (pass|fail)' ) | tee /tmp/entity-tests.txt
  grep -q '^# fail 0' /tmp/entity-tests.txt || { echo "Tests failed on the Pi: nothing was replaced. entity.incoming/ is left to look at."; exit 1; }
fi
if [ $REHEARSE = 1 ]; then
  echo "== Rehearsal: upgrading copies of the republics in /tmp/entities-rehearse (the live ones are not touched)"
  rm -rf /tmp/entities-rehearse && mkdir -p /tmp/entities-rehearse
  # (No "case" here: macOS's bash 3.2 cannot parse one inside this here-document.)
  for d in */; do d="\${d%/}"; [[ "\$d" =~ ^(entity|entity\.prev|entity\.incoming|entity\.bad|entity-modules)$ ]] && continue
    [ -f "\$d/record/events.jsonl" ] && cp -a "\$d" /tmp/entities-rehearse/ ; done
  cp -a entity.incoming /tmp/entities-rehearse/entity
  ENTITY_NO_STOP=1 ENTITIES=/tmp/entities-rehearse SRC=/tmp/entities-rehearse/entity bash /tmp/entities-rehearse/entity/update-republics.sh $* | tail -40
  for d in /tmp/entities-rehearse/*/; do n=\$(basename "\$d"); [ "\$n" = entity ] && continue
    printf '   %-24s %s\n' "\$n" "\$(cd "\$d" && node cli/index.js verify 2>&1 | tail -1)"; done
  echo "Rehearsal done: nothing live changed. entity.incoming/ is ready; run again without --rehearse to deploy."
  exit 0
fi
echo "== Swapping the code"
rm -rf entity.prev; [ -d entity ] && mv entity entity.prev; mv entity.incoming entity
echo "   previous code kept in entity.prev/"
if [ $UPDATE = 1 ]; then echo "== Updating the republics"; bash entity/update-republics.sh $* | tail -20; fi
echo "== Starting the servers"
if [ -x "\$HOME/$START" ] || [ -f "\$HOME/$START" ]; then bash "\$HOME/$START" >/dev/null 2>&1 & sleep 6; echo "   started by $START"; else echo "   no start script at ~/$START: start each with  node cli/index.js serve --settle"; fi
echo "== Privacy check"
node entity/tools/privacy-check.mjs "\$HOME/$REMOTE_HOME" --online || { echo "The privacy check has HIGH findings (above). The code is deployed; fix these before announcing it."; exit 1; }
echo "== Headers from each public hostname"
CFG="\$HOME/.cloudflared/config.yml"; bad=0
if [ -f "\$CFG" ]; then
  for h in \$(grep -o 'hostname: [^ ]*' "\$CFG" | cut -d' ' -f2); do
    hdr=\$(curl -s -L -D - -o /dev/null --max-time 10 "https://\$h/" || true)   # GET, following a private node to its sign-in page (HEAD answers 405)
    if ! grep -qi '^content-security-policy:' <<<"\$hdr"; then echo "   \$h: no Content Security Policy (another service, or a republic on old code: the privacy check above says which)"; continue; fi
    if grep -qi '^content-security-policy:' <<<"\$hdr" && grep -qi '^strict-transport-security:' <<<"\$hdr" && grep -qi '^x-content-type-options: nosniff' <<<"\$hdr"
    then echo "   \$h: policy, HSTS and nosniff present"; else echo "   \$h: MISSING security headers"; bad=1; fi
  done
fi
[ \$bad = 0 ] || exit 1
echo "Deployed entity $VERSION."
EOF
)
if [ $DRY = 1 ]; then echo "would run on $HOST:"; echo "$REMOTE" | sed 's/^/   /'; exit 0; fi
if [ "$HOST" = local ]; then bash -s <<<"$REMOTE"; else ssh "$HOST" bash -s <<<"$REMOTE"; fi
