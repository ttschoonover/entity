#!/usr/bin/env bash
# update-republics.sh · bring every republic in ~/entities up to the code in
# ~/entities/entity, by vote, keeping each one's page.
#
#   bash ~/entities/entity/update-republics.sh            all republics
#   bash ~/entities/entity/update-republics.sh orchard    just these
#
# For each republic it: installs the page module (if it lacks it), proposes the
# core upgrade, proposes updates for modules with newer code, and votes for each
# as you. In a republic where you are the only member, your vote carries them;
# elsewhere they stay open for the other members, and the core upgrade is only
# installed once the page module has carried, so no republic loses its page.
# It adds no new modules. Run it again later to carry on where votes were pending.

set -u
HOME_DIR="${ENTITIES:-$HOME/entities}"
SRC="${SRC:-$HOME_DIR/entity}"
SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
KEYS="${ENTITY_KEYS:-$HOME/.entity/keys}"
NEW="$(node -p "require('$SRC/package.json').version")"
LOG="$HOME_DIR/update-$(date +%Y%m%d-%H%M%S).log"
declare -a SUMMARY=()

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
cli() { node "$PWD/cli/index.js" "$@" >>"$LOG" 2>&1; }
cliout() { node "$PWD/cli/index.js" "$@" 2>&1 | tee -a "$LOG"; }
newcli() { node "$SRC/cli/index.js" "$@" 2>&1 | tee -a "$LOG"; }
pid_of() { grep -o 'd-[0-9a-f]\{12\}' | head -1; }
carried() { node "$PWD/cli/index.js" count "$1" 2>/dev/null | grep -q 'CARRIED, enacted'; }
vote() { cli act ballot.cast --proposal "$1" --choice for --as "$ME" --settle; carried "$1"; }
# An open proposal whose title starts with this, if any (from the last run, say).
open_titled() { node "$PWD/cli/index.js" status 2>/dev/null | grep -E '^\s+d-[0-9a-f]{12}\s' | grep -F "$1" | grep -o 'd-[0-9a-f]\{12\}' | head -1; }
has_mod() { node "$PWD/cli/index.js" params 2>/dev/null | grep -E '^\s+entity\.modules' | grep -q "\"$1\""; }

if [ ! -f "$SRC/cli/index.js" ]; then echo "No entity code at $SRC: unzip the new source there first." >&2; exit 1; fi
say "Updating republics in $HOME_DIR to $NEW (log: $LOG)"

# Stop serving while code changes underneath; start-all.sh starts them again.
if pgrep -f "cli/index.js serve" >/dev/null; then say "Stopping the republics' servers while they update."; pkill -f "cli/index.js serve"; sleep 1; fi

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  for d in "$HOME_DIR"/*/; do d="${d%/}"; n="$(basename "$d")"
    [ "$n" = "entity" ] || [ "$n" = "entity-modules" ] && continue
    [ -f "$d/record/events.jsonl" ] && [ -f "$d/cli/index.js" ] && targets+=("$n")
  done
fi

for name in "${targets[@]}"; do
  cd "$HOME_DIR/$name" 2>/dev/null || { say "== $name: no such folder"; continue; }
  say ""; say "== $name"
  ID="$(head -1 record/events.jsonl | grep -o '"entity":"e-[0-9a-f]*"' | head -1 | cut -d'"' -f4)"
  # You: the member here whose key file you hold (tim first, if several).
  ME=""
  for k in tim $(ls "$KEYS/$ID" 2>/dev/null); do
    [ -f "$KEYS/$ID/$k" ] && node "$PWD/cli/index.js" participants 2>/dev/null | grep -qE "^\s*$k\s+active" && { ME="$k"; break; }
  done
  if [ -z "$ME" ]; then say "   no key of an active member here in $KEYS/$ID: skipped"; SUMMARY+=("$name: skipped (no key of yours)"); continue; fi
  OLD="$(node -p "require('./package.json').version" 2>/dev/null || echo '?')"
  say "   you are $ME · code $OLD"
  pending=()

  # 1 · where modules come from
  cli module source "$SOURCE" || say "   (this version cannot set a module source; using its own)"

  # 2 · the page, by vote, before the core can make it a module
  page_ok=yes
  if has_mod page; then say "   page: already installed"
  elif P="$(open_titled 'Install and enable the page module')" && [ -n "$P" ]; then
    if vote "$P"; then say "   page: installed (its proposal has now carried)"; else say "   page: still waiting for other members' votes ($P)"; pending+=("page $P"); page_ok=no; fi
  else
    out="$(cliout module add page --as "$ME")"; P="$(printf '%s' "$out" | pid_of)"
    if [ -n "$P" ]; then cli settle
      if vote "$P"; then say "   page: installed"; else say "   page: proposed ($P), waiting for other members' votes"; pending+=("page $P"); page_ok=no; fi
    else say "   page: this version cannot install it yet; it will be installed right after the core upgrade"; page_ok=after; fi
  fi

  # 3 · the core: install an upgrade approved since the last run, or vote on
  # the one still open, or propose it
  if [ "$OLD" = "$NEW" ]; then say "   core: already $NEW"
  elif [ "$page_ok" = no ]; then say "   core: waits until the page module carries"; pending+=("core: run this script again once page has carried")
  else
    chk="$(newcli upgrade check "dir:$SRC")"
    if printf '%s' "$chk" | grep -q 'DOES NOT replay'; then say "   core: the record does not replay with $NEW; not proposed (see the log)"; SUMMARY+=("$name: core upgrade refused by the replay check"); continue; fi
    P="$(open_titled 'Upgrade entity from')"
    if [ -z "$P" ] && cli upgrade apply; then say "   core: $OLD → $NEW installed (approved since the last run)"
    else
      [ -z "$P" ] && P="$(newcli upgrade propose "dir:$SRC" --as "$ME" | pid_of)"
      if [ -z "$P" ]; then say "   core: could not be proposed (see the log)"; pending+=("core: see the log")
      else cli settle
        if vote "$P"; then cli upgrade apply && say "   core: $OLD → $NEW installed" || say "   core: carried, but applying failed (see the log)"
        else say "   core: proposed ($P), waiting for other members' votes"; pending+=("core $P"); fi
      fi
    fi
  fi

  # The page, for versions that could only install it once upgraded.
  if [ "$page_ok" = after ] && ! has_mod page; then
    out="$(cliout module add page --as "$ME")"; P="$(printf '%s' "$out" | pid_of)"
    if [ -n "$P" ]; then cli settle; vote "$P" && say "   page: installed" || { say "   page: proposed ($P), waiting for votes"; pending+=("page $P"); }; fi
  fi

  # 4 · modules with newer code, one at a time
  for m in $(node "$PWD/cli/index.js" module list 2>/dev/null | awk '{print $1}'); do
    case "$m" in deliberation|titles|vocabulary|page) continue;; esac
    P="$(open_titled "Upgrade the $m module")"
    if [ -z "$P" ]; then out="$(cliout module upgrade "$m" --as "$ME")"; P="$(printf '%s' "$out" | pid_of)"; fi
    [ -z "$P" ] && continue
    cli settle
    if vote "$P"; then say "   $m: updated"; else say "   $m: update proposed ($P), waiting for votes"; pending+=("$m $P"); break; fi
  done

  # 5 · check
  if node "$PWD/cli/index.js" verify 2>&1 | tail -1 | grep -q Verified; then say "   verified"; else say "   DOES NOT VERIFY: see the log"; fi
  if [ ${#pending[@]} -eq 0 ]; then SUMMARY+=("$name: up to date ($(node -p "require('./package.json').version"))")
  else SUMMARY+=("$name: waiting on votes: ${pending[*]}"); fi
done

say ""; say "Summary"; for s in "${SUMMARY[@]}"; do say "  $s"; done
say ""; say "Start them again: ~/tsite/deploy/start-all.sh   (log: $LOG)"
