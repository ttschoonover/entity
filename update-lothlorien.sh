#!/usr/bin/env bash
# update-lothlorien.sh · bring a Lothlórien wiki that already exists up to date:
# pictures and the fuller Markdown (tables, quotes, code, figures), and the
# researched pages with their photographs.
#
#   bash update-lothlorien.sh your-id [folder]        e.g. bash update-lothlorien.sh tim loth
#
# Safe to run again: each step checks what is already done. In order:
#   1. the house's command line and node learn pictures (entity media, /media/)
#   2. its website learns the new Markdown and the photo styles
#   3. a proposal to upgrade the wiki module (its editor gains "Add a photo");
#      the house decides it like any other proposal
#   4. the photographs the pages show are downloaded into the house's media/
#      folder, so the members-only site never sends readers to another site
#   5. each researched page is written, or given a new version if you wrote
#      the current one; a page someone else has edited since is left alone
set -euo pipefail
ME="${1:?usage: update-lothlorien.sh your-id [folder]}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; DIR="$HOME_DIR/${2:-loth}"
HERE="$(cd "$(dirname "$0")" && pwd)"; PAGES="$HERE/presets/lothlorien-wiki"
[ -f "$DIR/cli/index.js" ] && [ -d "$DIR/record" ] || { echo "No house at $DIR"; exit 1; }
[ -f "$HERE/cli/media.js" ] || { echo "Run this from the new entity code (it has cli/media.js)"; exit 1; }
if [ -z "${ENTITY_PASSWORD:-}" ]; then read -rsp "Your password: " ENTITY_PASSWORD; echo; export ENTITY_PASSWORD; fi
E() { node "$DIR/cli/index.js" "$@"; }
q() { node --input-type=module -e "const s=await import('$DIR/kernel/store.js');const e=await s.open('$DIR');const st=e.state;console.log($1)"; }
cd "$DIR"

# Called by athenes.sh with PAGES_ONLY=1: the code, website and modules have
# already been updated there, by the house's own decisions; only 4 and 5 remain.
if [ "${PAGES_ONLY:-0}" != 1 ]; then
echo "== 1. Pictures on the command line and the node"
mkdir -p cli/commands media
cp "$HERE/cli/media.js" "$HERE/cli/context.js" "$HERE/cli/index.js" cli/
cp "$HERE/cli/commands/media.js" "$HERE/cli/commands/site.js" "$HERE/cli/commands/letter.js" cli/commands/
echo "  done (restart the node to use it: bash athenes.sh restart)"

echo "== 2. The website"
if [ -d website ]; then
  cp "$HERE/sites/kit/common.js" website/common.js
  cp "$HERE/sites/kit/site.css" website/kit.css
  cp "$HERE/sites/lothlorien/site.css" website/site.css
  echo "  website/ has the new Markdown and photo styles"
else echo "  no website/ folder here; skipped"; fi

echo "== 3. The wiki editor's photo button"
if cmp -s "$HERE/library/wiki/ui.js" modules/wiki/ui.js; then echo "  the wiki module is already current"
else
  open="$(q "Object.values(st.proposals||{}).filter(x=>!x.closed&&(x.install||[]).some(i=>i.name==='wiki')).map(x=>x.id)[0]||''")"
  if [ -n "$open" ]; then echo "  a proposal to upgrade it is already open: $open"
  else
    id="$(E module upgrade wiki "dir:$HERE/library/wiki" --as "$ME" 2>&1 | grep -o 'd-[0-9a-f]\{12\}' | head -1 || true)"
    if [ -n "$id" ]; then
      E settle >/dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle >/dev/null 2>&1 || true
      if [ "$(q "String(!!st.proposals['$id']?.enacted)")" = "true" ]; then E module fetch >/dev/null 2>&1 || true; echo "  upgraded (proposal $id carried)"
      else echo "  proposed as $id, with your vote; it takes effect when the house carries it"; fi
    else echo "  could not propose the upgrade; run: node cli/index.js module upgrade wiki dir:$HERE/library/wiki --as $ME"; fi
  fi
fi

fi

echo "== 4. Photographs, kept in media/"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp "$PAGES"/*.md "$work/"
for url in $(grep -ohE '\]\(https?://[^ )]+\.(jpe?g|png|webp|gif)' "$work"/*.md | sed 's/^](//' | sort -u); do
  kept="$(E media fetch "$url" 2>/dev/null | grep -oE 'media/[a-f0-9]{32}\.(jpg|png|webp|gif)' | head -1 || true)"
  if [ -n "$kept" ]; then
    for f in "$work"/*.md; do URL="$url" KEPT="$kept" perl -pi -e 's/\Q$ENV{URL}\E/$ENV{KEPT}/g' "$f"; done
    printf '  %-48s %s\n' "$(basename "$url")" "$kept"
  else printf '  %-48s %s\n' "$(basename "$url")" "not reachable; the page links to it instead"; fi
done

echo "== 5. The pages"
while IFS='|' read -r id title cat; do
  [ -n "$id" ] || continue
  cur="$(q "(()=>{const p=st.m.wiki?.pages?.['$id'];if(!p)return '0 -';const v=p.versions.at(-1);return v.n+' '+v.by})()")"
  n="${cur%% *}"; by="${cur#* }"
  if [ "$n" != 0 ] && [ "$by" != "$ME" ]; then printf '  %-30s %s\n' "$title" "left alone: $by wrote the current version"; continue; fi
  if [ "$n" != 0 ] && [ "$(q "st.m.wiki.pages['$id'].versions.at(-1).body")" = "$(cat "$work/$id.md")" ]; then printf '  %-30s %s\n' "$title" "already current"; continue; fi
  if E act wiki.edit --as "$ME" --page "$id" --title "$title" --category "$cat" --base "$n" --note "pictures and tables" --settle --body "$(cat "$work/$id.md")" > /dev/null 2>&1; then
    printf '  %-30s %s\n' "$title" "$([ "$n" = 0 ] && echo written || echo "version $((n + 1))")"
  else printf '  %-30s %s\n' "$title" "refused (check: node cli/index.js act wiki.edit … by hand)"; fi
done < "$PAGES/pages.txt"

echo
echo "Restart the node so it serves pictures: bash athenes.sh restart"
