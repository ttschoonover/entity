#!/usr/bin/env bash
# make-club.sh · an investment club organised as a California general
# partnership, with its own private website.
#
#   bash make-club.sh your-id ["Club Name"] [folder] [port] [hostname] [units]
#   e.g. bash make-club.sh tim "The Bay Investment Club" club 7910 club.poezine.org 100
#
# What it sets up:
#   - partners admitted by a joint resolution (a majority of the partners and of
#     the units), once they have signed the partnership agreement on the record
#   - units measuring each partner's interest; partnership certificates issued
#     automatically from the record, and reissued whenever units change
#   - concurrent rules: joining an association needs 60% of the partners and 60%
#     of the units; granting it a claim on profits, a majority of both; on assets,
#     two thirds of both; amending the partnership agreement, two thirds of both
#   - every vote is a single reading (no second vote a month later)
#   - a Treasurer, a Secretary (membership coordinator) and a three-member Audit
#     Committee, each chosen in its own election; nobody holds two of them
#   - the Audit Committee alone signs the checkpoints that make the record final
#   - the club's books (the fund module): cash, holdings, trades the partners
#     authorized, prices, income and expenses; the Treasurer keeps them under a
#     published grant. A club that already holds money or securities brings them
#     in with import-holdings.sh once its partners have joined; that sets
#     everyone's units to their capital, the founder's placeholder units included
#   - a private website: nothing shows until a partner signs in (applicants may apply)
#
# It writes the partnership agreement and a compliance checklist as drafts, on
# the record. Neither is legal advice: have the agreement reviewed by a
# California attorney before anyone signs it.

ME="${1:?usage: make-club.sh your-id [\"Club Name\"] [folder] [port] [hostname] [units]}"
NAME="${2:-The Investment Club}"; FOLDER="${3:-club}"; PORT="${4:-7910}"; HOST="${5:-}"; UNITS="${6:-100}"; SITE=club; RAD_PRIVATE=1
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
[[ "$UNITS" =~ ^[1-9][0-9]*$ ]] || { echo "units is a whole number above zero"; exit 1; }
prepare

# The partnership preset, named, with the partners' chat channels. Every rule is
# a single reading; the agreement is enacted and amended by joint-super resolution.
EXTRA="$(cat <<YML
  chat.channels:
    - { id: partners, title: Partners, about: "The club's business, between meetings.", read: members, post: members }
    - { id: research, title: Research, about: "Ideas and analysis before they become resolutions.", read: members, post: members }
YML
)"
node -e '
const fs = require("fs"), [name, extra] = process.argv.slice(1);
let s = fs.readFileSync("presets/partnership.yml", "utf8").replace(/^  entity.name: .*$/m, "  entity.name: " + JSON.stringify(name));
s = s.replace(/^note:/m, extra + "\n\nnote:");
fs.writeFileSync("presets/_club.yml", s);' "$NAME" "$EXTRA"
found_it _club

echo "== Units, offices and elections"
decide "Units, the offices, and the first elections" "$(node -e '
const [me, units] = process.argv.slice(1);
console.log(JSON.stringify([
  { kind: "share.class", class: "units", title: "Partnership units", voting: true, transferable: false,
    note: "Each partner'"'"'s interest in the partnership. Issued for contributions at the unit value; not transferable without a joint resolution." },
  ...(Number(units) > 0 ? [{ kind: "share.issue", class: "units", to: me, count: Number(units), note: "the founding partner'"'"'s first contribution" }] : []),
  { kind: "office.create", office: "treasurer", title: "Treasurer", seats: 1, term_days: 365 },
  { kind: "office.create", office: "secretary", title: "Secretary (membership coordinator)", seats: 1, term_days: 365 },
  { kind: "office.create", office: "audit-committee", title: "Audit Committee member", seats: 3, term_days: 365 },
  { kind: "authority.grant", grant: "books", title: "Keeping the books", to: { office: "treasurer" },
    may: ["fund.contribute", "fund.fill", "fund.valuation", "fund.income", "fund.expense"],
    note: "The Treasurer records payments in, trades the partners authorized, prices, income and expenses. Investing itself is always a resolution of the partners." },
  { kind: "election.call", election: "treasurer-1", office: "treasurer", method: "approval", stand_days: 14, vote_days: 7 },
  { kind: "election.call", election: "secretary-1", office: "secretary", method: "approval", stand_days: 14, vote_days: 7 },
  { kind: "election.call", election: "audit-committee-1", office: "audit-committee", method: "approval", stand_days: 14, vote_days: 7 },
]))' "$ME" "$UNITS")"

echo "== The partnership agreement and the checklist"
AGREEMENT="$(sed "s/\$NAME/$(printf '%s' "$NAME" | sed 's/[&/\]/\\&/g')/g" presets/partnership-agreement.md)"
E act wiki.edit --as "$ME" --page partnership-agreement --title "Partnership Agreement of $NAME" --category "Foundations" --base 0 --settle --body "$AGREEMENT" >/dev/null && echo "  page: Partnership Agreement   written (a draft: fill in the blanks)"
E act wiki.edit --as "$ME" --page compliance --title "Compliance checklist" --category "Handbook" --base 0 --settle --body "$(cat presets/partnership-checklist.md)" >/dev/null && echo "  page: Compliance checklist    written"
decide "Enact the partnership agreement" '[{"kind":"wiki.enact","page":"partnership-agreement","version":1}]'
FP="$(node --input-type=module -e "
import { open } from '$DIR/kernel/store.js'; import { fingerprint } from '$DIR/modules/agreements/index.js';
const e = await open('$DIR'); const p = e.state.m.wiki.pages['partnership-agreement']; console.log(fingerprint('partnership-agreement', p.versions[p.statute.version - 1]));")"
E act agreement.sign --as "$ME" --page partnership-agreement --version 1 --text "$FP" --settle >/dev/null && echo "  you have signed the agreement on the record"

install_site
# Private: only a sign-in page (and the application form) answers until a partner signs in.
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{private:true,modulesOnline:false});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')"
echo "  the website is private: partners sign in to see anything"
finish_up "  Next:
  1. Read the agreement (Documents › Partnership Agreement), fill in its blanks, and have it reviewed by a California attorney.
  2. Work through the compliance checklist: EIN, fictitious business name, accounts in the partnership's name.
  3. Partners apply on the site, sign the agreement, contribute, and are admitted by joint resolution with their units.
  4. Stand in the three elections (Treasurer, Secretary, Audit Committee): candidacy is open for 14 days.
  5. Once the Audit Committee is elected, its members sign checkpoints (entity checkpoint sign)."
