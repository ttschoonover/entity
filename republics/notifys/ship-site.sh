#!/usr/bin/env bash
# republics/notifys/ship-site.sh · put Notify.S's website live, and nothing else.
# The core, the modules and the record are untouched; the server needn't restart.
#
#   bash republics/notifys/ship-site.sh [folder]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${ENTITIES:-$HOME/entities}/${1:-notifys}"
[ -f "$DIR/node.json" ] || { echo "No republic at $DIR"; exit 1; }
rm -rf "$DIR/site.new"; cp -r "$HERE/site" "$DIR/site.new"
rm -rf "$DIR/site.old"; [ -d "$DIR/site" ] && mv "$DIR/site" "$DIR/site.old"
mv "$DIR/site.new" "$DIR/site"
echo "Notify.S's site is live from $DIR/site (the previous one is in site.old)."
