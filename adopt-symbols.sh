#!/usr/bin/env bash
# adopt-symbols.sh · install a state's digital symbols on its website and lay
# the Symbols Act that adopts them, with each file's fingerprint in its text.
#
#   bash adopt-symbols.sh <entity folder> <your id> vdr
#   bash adopt-symbols.sh <entity folder> <your id> federation
#
# It copies the favicons and app icons into <folder>/website/icons, draws the
# founding seal from the entity's first record, and proposes the Act. Nothing is
# adopted until the vote carries: in the VDR the Act is a statutory law; in the
# Federation, which has no laws module, it is a motion whose text is the Act.
# Members vote on the website as usual.

set -euo pipefail
DIR="$(cd "${1:?usage: adopt-symbols.sh <entity folder> <your id> vdr|federation}" && pwd)"
ME="${2:?your participant id}"
KIND="${3:?vdr or federation}"
SRC="$(cd "$(dirname "$0")" && pwd)"
case "$KIND" in
  vdr)        COLORS='#23408E,#C7A33B,#F3F4F0' ;;
  federation) COLORS='#1F3A5F,#D9B44A,#F2F2F0' ;;
  *) echo "The third argument is vdr or federation." >&2; exit 1 ;;
esac
E() { local c="$1"; shift; node "$DIR/cli/index.js" "$c" --dir "$DIR" "$@"; }

mkdir -p "$DIR/website/icons"
cp "$SRC/sites/$KIND/icons/"* "$DIR/website/icons/"
node "$SRC/cli/index.js" symbols seal --dir "$DIR" --colors "$COLORS" --out "$DIR/website/icons/seal.svg"
cp "$SRC/interface/js/seal.js" "$DIR/website/icons/seal.js"
echo "  installed the icons and the seal in $DIR/website/icons"

NAME="$(E params entity.name 2>/dev/null | sed -n 's/^ *entity\.name *"\([^"]*\)".*/\1/p')"
GENESIS="$(node -e '
  const fs=require("fs"),p=process.argv[1]+"/record/events.jsonl";
  if(!fs.existsSync(p)){process.exit(1)}
  console.log(JSON.parse(fs.readFileSync(p,"utf8").split("\n")[0]).hash)' "$DIR" 2>/dev/null || echo "[the hash of record 1]")"
fp() { (cd "$DIR/website" && sha256sum "$1" | cut -d' ' -f1); }

TEXT="## Section 1 · The symbols
1. The symbols of ${NAME} are the flag, the favicon, the app icon and the founding seal.
2. Each is the file named below, exactly as its fingerprint (SHA-256) identifies it. A file with any other fingerprint is not the symbol.

| Symbol | File | SHA-256 |
|---|---|---|
| Flag | flag.svg | $(fp flag.svg) |
| Favicon | icons/favicon.svg | $(fp icons/favicon.svg) |
| Favicon, 16 px | icons/favicon-16.svg | $(fp icons/favicon-16.svg) |
| Favicon, 32 px | icons/favicon-32.svg | $(fp icons/favicon-32.svg) |
| Favicon, one colour | icons/favicon-32-mono.svg | $(fp icons/favicon-32-mono.svg) |
| App icon | icons/app-icon.svg | $(fp icons/app-icon.svg) |
| Seal generator | icons/seal.js | $(fp icons/seal.js) |

## Section 2 · The founding seal
1. The founding seal is the emblem the seal generator draws from the hash of the first record, ${GENESIS}.
2. Anyone holding a copy of the record may redraw it. A seal that does not match the one the generator draws from that hash is not the seal.
3. The seal is never redrawn from any other record, so it never changes.

## Section 3 · Use
1. The official website shows the favicon in every page and the app icon when saved to a home screen.
2. Anyone may show the symbols to refer to ${NAME}. No one may use them to pass off a page, a document or an account as the state's when it is not.
3. The one-colour favicon is for places that allow a single colour; the 16 and 32 pixel favicons are drawn to the pixel and are not to be redrawn at those sizes.

## Section 4 · Changing the symbols
A symbol changes only by an act that names its new file and fingerprint. Section 2 cannot be changed."

if [ "$KIND" = vdr ]; then
  EFFECTS="$(TITLE="The Symbols Act" BODY="$TEXT" node -e 'console.log(JSON.stringify([{kind:"law.enact",law:"symbols-act",title:process.env.TITLE,type:"statutory",tags:["state","symbols"],subjects:["public"],text:process.env.BODY}]))')"
  OUT="$(E propose --as "$ME" --title "The Symbols Act" --effects "$EFFECTS")"
else
  OUT="$(E propose --as "$ME" --title "The Symbols Act" --text "$TEXT" --effects '[]')"
fi
E settle >/dev/null
ID="$(printf '%s' "$OUT" | grep -o 'd-[0-9a-f]\{12\}' | head -1)"
echo "  laid The Symbols Act as ${ID:-a proposal}; members vote on it on the website"
