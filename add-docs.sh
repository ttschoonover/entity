#!/usr/bin/env bash
# add-docs.sh · give republics that already exist the Documents page: installs
# the docs module by your vote, and adds docs.html to each one's website.
#
#   bash ~/entities/entity/add-docs.sh vdr solidarity        these republics
#   bash ~/entities/entity/add-docs.sh                       every republic with a website
#
# Where you are the only member, your vote carries it at once; elsewhere it
# waits for the others, and the page says documents are not switched on until
# it carries. Run it again later: what is done already is left alone.
# Bring the republic's code up to date first (update-republics.sh).

set -u
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"
KEYS="${ENTITY_KEYS:-$HOME/.entity/keys}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
[ -f "$SRC/sites/kit/docs.js" ] || { echo "No Documents page in $SRC (it ships with entity 0.9.21 or later)." >&2; exit 1; }
targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  for d in "$HOME_DIR"/*/; do d="${d%/}"; [ -f "$d/website/index.html" ] && [ -f "$d/record/events.jsonl" ] && targets+=("$(basename "$d")"); done
fi
for name in "${targets[@]}"; do
  cd "$HOME_DIR/$name" 2>/dev/null || { echo "== $name: no such folder"; continue; }
  echo "== $name"
  E() { node "$PWD/cli/index.js" "$@"; }
  ID="$(head -1 record/events.jsonl | grep -o '"entity":"e-[0-9a-f]*"' | head -1 | cut -d'"' -f4)"
  ME=""; for k in tim $(ls "$KEYS/$ID" 2>/dev/null); do [ -f "$KEYS/$ID/$k" ] && E participants 2>/dev/null | grep -qE "^\s*$k\s+active" && { ME="$k"; break; }; done
  [ -n "$ME" ] || { echo "   no key of an active member here: skipped"; continue; }
  # 1 · the module, by decision
  if E params 2>/dev/null | grep -E '^\s+entity\.modules' | grep -q '"docs"'; then echo "   docs: already switched on"
  else
    E module source "$SOURCE" >/dev/null 2>&1 || true
    P="$(E module add docs --as "$ME" 2>&1 | grep -o 'd-[0-9a-f]\{12\}' | head -1)"
    # Not published to your module source yet: take it from this installation's library.
    [ -z "$P" ] && P="$(E module add pack:docs --as "$ME" 2>&1 | grep -o 'd-[0-9a-f]\{12\}' | head -1)" && [ -n "$P" ] && echo "   (from this installation's library: publish entity-modules so peers can fetch it too)"
    if [ -z "$P" ]; then echo "   docs: could not be proposed (is the code up to date? run update-republics.sh first)"; continue; fi
    E settle >/dev/null; E act ballot.cast --proposal "$P" --choice for --as "$ME" --settle >/dev/null
    if E count "$P" 2>/dev/null | grep -q 'CARRIED, enacted'; then echo "   docs: switched on"; else echo "   docs: proposed ($P), waiting for the other members' votes"; fi
  fi
  # 2 · the page, the kit's stylesheet, and a link in the masthead
  cp "$SRC/sites/kit/docs.html" "$SRC/sites/kit/docs.js" website/
  cp "$SRC/sites/kit/site.css" website/kit.css
  [ -f website/config.js ] && ! grep -q "docs.html" website/config.js && python3 - website/config.js <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
m = re.search(r"\['chat\.html'", s)
s = s[:m.start()] + "['docs.html', 'Documents', 'docs'], " + s[m.start():] if m else re.sub(r"(pages: \[.*?)\]\],", lambda x: x.group(1) + "], ['docs.html', 'Documents', 'docs']],", s, count=1)
open(p, 'w').write(s)
PY
  echo "   website: docs.html added"
done
echo; echo "Restart the servers (~/tsite/deploy/start-all.sh) so the Documents pages are served."
