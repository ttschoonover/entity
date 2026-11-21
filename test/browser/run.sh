#!/usr/bin/env bash
# run.sh · build throwaway republics and run the browser checks against them.
#
#   bash test/browser/run.sh            # needs python3 with playwright and chromium
#
# 1. gui.py on a sealed assembly served by a member's node (p-0001 holds a key):
#    the shell, the screens, the record's health, who reads the sealed record.
#    a11y.py on the same node: axe-core over every screen (fetched with npm).
# 2. sealed.py on the same record served by a zero-knowledge node (no key at all).
# 3. e2e.py on an open assembly, and signin.py on one with passwords and passkeys
#    (both wait with Playwright's eval, so those nodes report their policy instead of enforcing it).
# 4. notify.py on an open assembly with the notify module, served by p-0001's node.
# 5. orchard.py on The Orchard General Partnership (make-orchard-gp.sh), served by
#    the founder's node: invite links, drawn signatures, particulars, certificates
#    and LaTeX PDFs (needs pdflatex: texlive-latex-recommended texlive-pictures).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"; trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT
DIR="$WORK/assembly"; export ENTITY_KEYS="$WORK/keys"
node --input-type=module -e "const { copyCode } = await import('$ROOT/cli/commands/dist.js'); copyCode('$ROOT', '$DIR');"
cp -r "$ROOT/library" "$DIR/library"
printf '_: A sealed assembly, for the browser checks.\nmodules: [page, deliberation, titles, vocabulary]\nset:\n  entity.name: The Sealed Assembly\n  records.sealing: true\n' > "$DIR/presets/sealed.yml"
E() { (cd "$DIR" && node cli/index.js "$@"); }
E found --id p-0001 --preset sealed >/dev/null
E join --id p-0002 --name "Second Person" >/dev/null && E settle --as p-0001 >/dev/null
E records key --as p-0002 >/dev/null && E settle --as p-0001 >/dev/null
E propose --title "Buy a dishwasher" --changes '{"entity.name":"The Dishwasher Assembly"}' --as p-0002 >/dev/null && E settle --as p-0001 >/dev/null
port() { node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})"; }
wait_up() { for _ in $(seq 50); do curl -sf "$1" >/dev/null && return; sleep 0.2; done; echo "no server at $1"; exit 1; }
status=0
want() { [ -z "${ONLY:-}" ] || [[ " $ONLY " == *" $1 "* ]]; }   # ONLY="notify gui" runs just those

P=$(port); (cd "$DIR" && node cli/index.js serve --port "$P" --as p-0001 >"$WORK/serve1.log" 2>&1) &
S1=$!; wait_up "http://127.0.0.1:$P/"
if want gui; then echo "== gui.py"; python3 "$ROOT/test/browser/gui.py" "http://127.0.0.1:$P/" "$DIR" "$ENTITY_KEYS" p-0001 || status=1; fi
AXE="${AXE:-}"; if [ -z "$AXE" ] && want a11y; then (cd "$WORK" && npm i --silent --no-save axe-core@4 >/dev/null 2>&1) && AXE="$WORK/node_modules/axe-core/axe.min.js"; fi
if want a11y && [ -f "$AXE" ]; then echo "== a11y.py"; python3 "$ROOT/test/browser/a11y.py" "http://127.0.0.1:$P/" "$DIR" "$ENTITY_KEYS" p-0001 "$AXE" || status=1
elif want a11y; then echo "== a11y.py skipped: axe-core could not be fetched (set AXE=path/to/axe.min.js)"; fi
kill $S1; wait $S1 2>/dev/null || true

P=$(port); (cd "$DIR" && ENTITY_KEYS="$WORK/none" node cli/index.js serve --port "$P" --settle >"$WORK/serve2.log" 2>&1) &
S2=$!; wait_up "http://127.0.0.1:$P/"
if want sealed; then echo "== sealed.py"; python3 "$ROOT/test/browser/sealed.py" "http://127.0.0.1:$P/" "$DIR" "$ENTITY_KEYS" || status=1; fi
kill $S2; wait $S2 2>/dev/null || true

open_assembly() {  # open_assembly DIR "modules"
  node --input-type=module -e "const { copyCode } = await import('$ROOT/cli/commands/dist.js'); copyCode('$ROOT', '$1');"
  cp -r "$ROOT/library" "$1/library"
  printf '_: An open assembly, for the browser checks.\nmodules: [%s]\nset:\n  entity.name: The Open Assembly\n' "$2" > "$1/presets/open.yml"
  (cd "$1" && node cli/index.js found --id p-0001 --preset open >/dev/null)
  node -e "const fs=require('fs'),f='$1/node.json';const n=JSON.parse(fs.readFileSync(f));n.csp={mode:'report-only'};fs.writeFileSync(f,JSON.stringify(n,null,2))"
}
open_assembly "$WORK/open" "page, deliberation, titles, vocabulary"
P=$(port); (cd "$WORK/open" && node cli/index.js serve --port "$P" --settle >"$WORK/serve3.log" 2>&1) &
S3=$!; wait_up "http://127.0.0.1:$P/"
if want e2e; then echo "== e2e.py"; python3 "$ROOT/test/browser/e2e.py" "http://127.0.0.1:$P/" "$WORK/open" || status=1; fi
kill $S3; wait $S3 2>/dev/null || true

open_assembly "$WORK/signin" "page, deliberation, titles, vocabulary, passwords, passkeys"
P=$(port); (cd "$WORK/signin" && node cli/index.js serve --port "$P" --settle >"$WORK/serve4.log" 2>&1) &
S4=$!; wait_up "http://127.0.0.1:$P/"
if want signin; then echo "== signin.py"; python3 "$ROOT/test/browser/signin.py" "http://localhost:$P/" || status=1; fi
kill $S4; wait $S4 2>/dev/null || true

open_assembly "$WORK/notify" "page, deliberation, titles, vocabulary, notify"
(cd "$WORK/notify" && node cli/index.js join --id p-0002 >/dev/null && node cli/index.js settle --as p-0001 >/dev/null && node cli/index.js notify subscribe --sms +15105550100 --as p-0001 >/dev/null)
node -e "const fs=require('fs'),f='$WORK/notify/node.json';const n=JSON.parse(fs.readFileSync(f));delete n.csp;fs.writeFileSync(f,JSON.stringify(n,null,2))"
P=$(port); (cd "$WORK/notify" && node cli/index.js serve --port "$P" --settle --as p-0001 >"$WORK/serve5.log" 2>&1) &
S5=$!; wait_up "http://127.0.0.1:$P/"
if want notify; then echo "== notify.py"; python3 "$ROOT/test/browser/notify.py" "http://localhost:$P/" "$WORK/notify" "$ENTITY_KEYS" p-0001 || status=1; fi
if want orchard && command -v pdflatex >/dev/null; then
  OH="$WORK/orchard"; mkdir -p "$OH"
  P=$(port)
  ENTITIES="$OH" SRC="$ROOT" ENTITY_KEYS="$OH/keys" ENTITY_NEW_PASSWORD='correct horse battery staple' YOUR_NAME='Founding Partner' ORCHARD_EIN=12-3456789 NO_RADICLE=1 HOME="$OH" \
    bash "$ROOT/make-orchard-gp.sh" tim orchard-gp "$P" </dev/null >"$WORK/orchard.log" 2>&1
  (cd "$OH/orchard-gp" && HOME="$OH" ENTITY_KEYS="$OH/keys" node cli/index.js serve --port "$P" --as tim --settle >"$WORK/serve6.log" 2>&1) &
  S6=$!; wait_up "http://127.0.0.1:$P/"
  echo "== orchard.py"; HOME="$OH" python3 "$ROOT/test/browser/orchard.py" "http://localhost:$P/" "$OH/orchard-gp" "$OH/keys" tim || status=1
  kill $S6; wait $S6 2>/dev/null || true
elif want orchard; then echo "== orchard.py skipped: pdflatex is not installed"; fi
[ $status = 0 ] && echo "All browser checks passed." || echo "Some browser checks FAILED (above)."
exit $status
