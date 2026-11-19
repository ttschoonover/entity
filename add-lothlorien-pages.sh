#!/usr/bin/env bash
# add-lothlorien-pages.sh · kept for old instructions: update-lothlorien.sh now
# writes the researched pages (with their photographs) and does the rest.
exec bash "$(cd "$(dirname "$0")" && pwd)/update-lothlorien.sh" "$@"
