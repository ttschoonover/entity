# found-common.sh · the steps every make-*.sh shares, sourced by them: ask for
# a password, copy the code into its own folder, define E and decide, install
# the website (the kit plus a site's own pages), and serve it.
#
# A script sets ME, NAME, FOLDER, PORT, HOST and SITE (a folder in sites/), then:
#   source found-common.sh; prepare; …write presets/_x.yml…; found_it _x; …; install_site; finish_up "next steps"

set -euo pipefail
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"

prepare() {
  DIR="$HOME_DIR/$FOLDER"
  [[ "$ME" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "Your id is lowercase letters, digits and -"; exit 1; }
  [ -e "$DIR" ] && { echo "$DIR already exists. Move it aside first (mv $DIR $DIR-old), or give another folder name."; exit 1; }
  [ -f "$SRC/cli/index.js" ] || { echo "No entity code at $SRC"; exit 1; }
  [ -f "$SRC/sites/$SITE/index.html" ] && [ -f "$SRC/sites/kit/common.js" ] || { echo "No $SITE website at $SRC/sites (it ships with entity 0.9.18 or later)"; exit 1; }
  if [ -z "${ENTITY_NEW_PASSWORD:-}" ]; then
    local a b
    read -rsp "A password for $ME (12 or more characters): " a; echo
    read -rsp "The same again: " b; echo
    [ "$a" = "$b" ] || { echo "The two passwords differ."; exit 1; }
    export ENTITY_NEW_PASSWORD="$a"
  fi
  if [ -z "${YOUR_NAME+x}" ] && [ -t 0 ]; then read -rp "Your name, as others will see it (Enter to skip): " YOUR_NAME; fi
  YOUR_NAME="${YOUR_NAME:-}"
  mkdir -p "$DIR"
  ( cd "$SRC" && tar cf - --exclude=.git --exclude=.staged --exclude=record --exclude=node_modules --exclude=./parameters.yml --exclude=./node.json . ) | ( cd "$DIR" && tar xf - )
  cd "$DIR"
}

E() { node "$DIR/cli/index.js" "$@"; }
decide() {
  local id; id=$(E propose --as "$ME" --title "$1" --effects "$2" | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  [ -n "$id" ] || { echo "  could not lay \"$1\""; E propose --as "$ME" --title "$1" --effects "$2" || true; exit 1; }
  E settle > /dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle > /dev/null
  printf '  %-44s %s\n' "$1" "$(E count "$id" | tail -1)"
}
json() { node -p 'JSON.stringify(process.argv[1])' "$1"; }

found_it() {
  echo "== Founding $NAME in $DIR"
  E preset apply "$1" >/dev/null
  E found --id "$ME" --name "$NAME" | head -1
  E module source "$SOURCE" >/dev/null 2>&1 || true
  E password set --as "$ME" --settle >/dev/null && echo "  your password is set"
  [ -n "$YOUR_NAME" ] && E act title.set --as "$ME" --title "$YOUR_NAME" --settle >/dev/null && echo "  you appear as $YOUR_NAME ($ME)"
  return 0
}

# The shared kit, its stylesheet renamed kit.css, then the site's own pages:
# the site's site.css imports kit.css and restyles every page, the kit's too.
install_site() {
  echo "== The website"
  mkdir -p "$DIR/website"
  cp -r "$DIR/sites/kit/." "$DIR/website/"
  mv "$DIR/website/site.css" "$DIR/website/kit.css"
  cp -r "$DIR/sites/$SITE/." "$DIR/website/"
  node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),site:'website'});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
  echo "  website/ is served at http://localhost:$PORT"
  E verify | tail -1
}

finish_up() {
  if [ "${NO_RADICLE:-0}" = 1 ]; then :
  elif command -v rad >/dev/null && rad self >/dev/null 2>&1; then timeout 60 node "$DIR/cli/index.js" radicle init ${RAD_PRIVATE:+--private} 2>&1 | tail -1 || echo "  (not published on Radicle yet: the reason is above; the rest is done. Later: cd $DIR && node cli/index.js radicle init)"; else echo "  (Radicle not unlocked: later, cd $DIR && node cli/index.js radicle init)"; fi
  if [ -n "$HOST" ]; then
    local START="$HOME/tsite/deploy/start-all.sh" CFG="$HOME/.cloudflared/config.yml"
    [ -f "$START" ] && ! grep -q "entities/$FOLDER:" "$START" && sed -i "s|^ENTITIES=(\(.*\))|ENTITIES=(\1 \"\$HOME/entities/$FOLDER:$PORT\")|" "$START" && echo "  added to the start script"
    if [ -f "$CFG" ] && ! grep -q "hostname: $HOST" "$CFG"; then
      python3 - "$CFG" "$HOST" "$PORT" <<'PY'
import sys; p,h,port=sys.argv[1:4]; s=open(p).read()
s=s.replace('  - service: http_status:404', f'  - hostname: {h}\n    service: http://localhost:{port}\n  - service: http_status:404'); open(p,'w').write(s)
PY
      # DNS: athenes.sh dns writes each record with the certificate for its zone.
      case "$HOST" in *.poezine.org) cloudflared tunnel route dns --overwrite-dns poezine "$HOST" 2>&1 | tail -1 || true ;; esac
    fi
  fi
  printf '\n%s is founded in %s.\n  Start it now: cd %s && node cli/index.js serve --settle\n%s\n' "$NAME" "$DIR" "$DIR" "$1"
}
