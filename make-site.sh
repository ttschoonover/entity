#!/usr/bin/env bash
# make-site.sh · a personal website kept as an Athens record: posts, projects,
# photographs, a résumé and the home page, each change signed by you. The
# public site is published from the record by tools/publish-site.mjs.
#
#   bash make-site.sh your-id [folder] [port]        e.g. bash make-site.sh tim site 7990
#
# Only you decide anything (the founder decides, as in the proprietor preset).
# Others can be admitted later as co-authors, by your decision. The node this
# makes is for you: it is served on this machine only, at the port given, and
# the public site is the published folder tsite serves at your domain.
ME="${1:?usage: make-site.sh your-id [folder] [port]}"
NAME="${SITE_NAME:-Timothy Schoonover}"; FOLDER="${2:-site}"; PORT="${3:-7990}"; HOST=""
NO_RADICLE=1   # the site is published by tsite; it needs no Radicle copy
SITE=club   # found-common.sh checks a kit site exists; this entity installs none.
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

cat > presets/_site.yml <<YML
_: A personal website kept as a record. The founder decides; every change is signed.
modules: [deliberation, titles, vocabulary, passwords, site]
set:
  entity.name: $(json "$NAME")
  decision.electorate: founder
  membership.admission: decision
  vocabulary.assembly: "Author"
  vocabulary.participant: "author"
  vocabulary.participants: "authors"
YML
found_it _site
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1])});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
E verify | tail -1
finish_up "  1. Write in a folder of Markdown (posts/, projects/, photos/, resume.md, profile.md) and run:
       node tools/site.mjs sync ~/site --entity $DIR --as $ME
  2. Publish: node tools/publish-site.mjs $DIR ~/tsite/sites/tschoonover/published
  athenes.sh does both for you, and republishes whenever something new is signed."
