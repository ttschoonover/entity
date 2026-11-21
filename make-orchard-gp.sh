#!/usr/bin/env bash
# make-orchard-gp.sh · refound The Orchard General Partnership on Athènes:
# an investment club organized as a California general partnership in Berkeley.
#
#   ORCHARD_EIN=NN-NNNNNNN bash make-orchard-gp.sh your-id [folder] [port] [hostname]
#   e.g. ORCHARD_EIN=12-3456789 bash make-orchard-gp.sh tim orchard-gp 7790 orchard.tschoonover.com
#
# Optional:
#   ORCHARD_OFFICE   principal office (default "Berkeley, Alameda County, California";
#                    a mailing address is better on the fictitious business name statement)
#   YOUR_NAME        the name partners see for you
#   ORCHARD_EMAIL    your email, for two-factor sign-in
#   SMTP_HOST, SMTP_USER, SMTP_FROM, SMTP_PORT, ENTITY_SMTP_PASSWORD
#                    how the node sends two-factor codes; with these and ORCHARD_EMAIL,
#                    two-factor sign-in is required of every partner from the start
#
# What it sets up (presets/orchard-gp.yml):
#   - privacy: the record is sealed (only partners can read it), the node asks
#     visitors to sign in, its Radicle copies are private, partners' tax numbers
#     never go on the record, and notices are sealed to each partner's own key
#   - the minimal partnership agreement (presets/orchard-gp-agreement.md),
#     enacted, which every partner signs on the record, with a drawn signature,
#     before admission
#   - personal invitation links (granted to the Secretary), partners' particulars
#     for the returns (encrypted to the partner, Treasurer and Secretary, never on
#     the record), certificates and the signed agreement as LaTeX PDFs
#   - every trade a joint resolution (a majority of the partners and of the units),
#     never delegated; the Treasurer records only what was authorized
#   - an elected Treasurer and an elected Secretary (never the same person);
#     you serve as Founding Secretary until the first election
#   - participation required: standing tracked from votes and meetings, notices,
#     and removal by joint resolution after 30 days (the participation module)
#   - alerts: trades to vote on, a reminder a day before a vote closes, decisions
#   - the legal register (presets/orchard-gp-legal.md): federal, California and
#     Berkeley obligations, and who meets each
#   - the EIN, as the setting partnership.ein (sealed with the rest)
#
# The existing club's holdings come in afterwards with import-holdings.sh, once
# its partners have joined; that sets everyone's units to their capital.
#
# Not legal advice: have the agreement reviewed by a California attorney before
# anyone contributes.

ME="${1:?usage: ORCHARD_EIN=NN-NNNNNNN bash make-orchard-gp.sh your-id [folder] [port] [hostname]}"
NAME="The Orchard General Partnership"; FOLDER="${2:-orchard-gp}"; PORT="${3:-7790}"; HOST="${4:-}"
SITE=club; RAD_PRIVATE=1
OFFICE="${ORCHARD_OFFICE:-Berkeley, Alameda County, California}"
EIN="${ORCHARD_EIN:-}"
if [ -z "$EIN" ] && [ -t 0 ]; then read -rp "The partnership's EIN (NN-NNNNNNN): " EIN; fi
[[ "$EIN" =~ ^[0-9]{2}-[0-9]{7}$ ]] || { echo "Give the EIN as NN-NNNNNNN in ORCHARD_EIN (as on the IRS's CP 575 letter)."; exit 1; }
source "$(cd "$(dirname "$0")" && pwd)/found-common.sh"
prepare

# The preset. The founding record is always public (anyone can check the chain
# from it), so nothing private goes in it: the EIN and the office are set just
# after, by a decision that is sealed like everything else.
node -e '
const fs = require("fs"), [name] = process.argv.slice(1);
fs.writeFileSync("presets/_orchard.yml", fs.readFileSync("presets/orchard-gp.yml", "utf8").replace(/^  entity.name: .*$/m, "  entity.name: " + JSON.stringify(name)));' "$NAME"
found_it _orchard
E settle --as "$ME" >/dev/null   # your record key and the first key period: the record is sealed from here on
id=$(E propose --as "$ME" --title "The partnership's EIN and principal office" --changes "$(node -p 'JSON.stringify({"partnership.ein": process.argv[1], "partnership.office": process.argv[2]})' "$EIN" "$OFFICE")" | grep -o 'd-[0-9a-f]\{12\}' | head -1)
E settle --as "$ME" >/dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle >/dev/null
printf '  %-44s %s\n' "The EIN and principal office (sealed)" "$(E count "$id" | tail -1)"

echo "== Units, officers and elections"
decide "Units, the officers, and the first elections" "$(node -e '
const [me] = process.argv.slice(1);
console.log(JSON.stringify([
  { kind: "share.class", class: "units", title: "Partnership units", voting: true, transferable: false,
    note: "Each partner'"'"'s interest. Issued for contributions at the unit value; never transferable." },
  { kind: "share.issue", class: "units", to: me, count: 100, note: "placeholder until the holdings are imported (import-holdings.sh)" },
  { kind: "office.create", office: "treasurer", title: "Treasurer", seats: 1, term_days: 365 },
  { kind: "office.create", office: "secretary", title: "Secretary", seats: 1, term_days: 365 },
  { kind: "office.fill", office: "secretary", holder: me },
  { kind: "authority.grant", grant: "books", title: "Keeping the books", to: { office: "treasurer" },
    may: ["fund.contribute", "fund.fill", "fund.valuation", "fund.income", "fund.expense"],
    note: "The Treasurer records contributions, the trades the partners authorized (and only those), prices, income and expenses. Every trade is a joint resolution of the partners." },
  { kind: "authority.grant", grant: "participation", title: "Participation notices", to: { office: "secretary" }, may: ["participation.notice"],
    note: "The Secretary gives notice to a partner below the participation minimum (agreement section 7)." },
  { kind: "authority.grant", grant: "meetings", title: "Calling meetings", to: { office: "secretary" }, may: ["meeting.call"] },
  { kind: "authority.grant", grant: "invitations", title: "Personal invitations", to: { office: "secretary" }, may: ["invite.create", "invite.revoke"],
    note: "The Secretary invites a person the partners agreed to admit: the link admits them once they have signed the agreement and given their particulars (agreement section 4.1)." },
  { kind: "election.call", election: "treasurer-1", office: "treasurer", method: "approval", stand_days: 14, vote_days: 7 },
  { kind: "election.call", election: "secretary-1", office: "secretary", method: "approval", stand_days: 14, vote_days: 7 },
]))' "$ME")"

echo "== The partnership agreement and the legal register"
FOUNDED="$(date +%Y-%m-%d)"
AGREEMENT="$(EIN="$EIN" OFFICE="$OFFICE" FOUNDED="$FOUNDED" NAME="$NAME" node -e '
const s = require("fs").readFileSync("presets/orchard-gp-agreement.md", "utf8");
process.stdout.write(s.replace(/\$NAME/g, process.env.NAME).replace(/\$EIN/g, process.env.EIN).replace(/\$OFFICE/g, process.env.OFFICE).replace(/\$FOUNDED/g, process.env.FOUNDED));')"
E act wiki.edit --as "$ME" --page partnership-agreement --title "Partnership Agreement of $NAME" --category "Foundations" --base 0 --settle --body "$AGREEMENT" >/dev/null && echo "  page: Partnership Agreement   written"
E act wiki.edit --as "$ME" --page legal-register --title "Legal register" --category "Handbook" --base 0 --settle --body "$(cat presets/orchard-gp-legal.md)" >/dev/null && echo "  page: Legal register          written"
decide "Enact the partnership agreement" '[{"kind":"wiki.enact","page":"partnership-agreement","version":1}]'
echo "  every partner signs it with a drawn signature: sign yours on the page (Agreements tab)"

echo "== The first meeting"
later() { node -e "console.log(new Date(Date.now()+$1*864e5).toISOString().slice(0,16)+':00.000Z')"; }
decide "The first meeting of the partners" "[{\"kind\":\"meeting.call\",\"meeting\":\"meeting-1\",\"title\":\"First meeting of the partners\",\"starts\":\"$(later 7)\",\"agenda\":[\"Read the partnership agreement and the legal register\",\"Admit the founding partners\",\"Import the existing holdings\",\"Investment policy\",\"Stand for Treasurer and Secretary\"]}]"

echo "== Privacy and notices"
node -e "
const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));
Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),look:'athens',colour:'system',private:true,modulesOnline:false});
if (process.argv[2]) n.notify={...(n.notify||{}),url:'https://'+process.argv[2]};
fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT" "$HOST"
echo "  sealed record, private node; notices sealed to each partner"
if [ -n "${SMTP_HOST:-}" ] && [ -n "${ORCHARD_EMAIL:-}" ]; then
  E twofactor mail --host "$SMTP_HOST" --port "${SMTP_PORT:-465}" --user "${SMTP_USER:-}" --from "${SMTP_FROM:-$NAME <${SMTP_USER:-}>}" >/dev/null
  E twofactor set "$ME" "$ORCHARD_EMAIL" >/dev/null
  id=$(E propose --as "$ME" --title "Two-factor sign-in for every partner" --changes '{"twofactor.require":"everyone"}' | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  E settle --as "$ME" >/dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle >/dev/null
  printf '  %-44s %s\n' "Two-factor sign-in for every partner" "$(E count "$id" | tail -1)"
else
  echo "  two-factor: optional for now. Set up mail (entity twofactor mail …), then propose twofactor.require: everyone"
fi
E verify --as "$ME" | tail -1

finish_up "  Next:
  1. Read the agreement (Law tab) and the legal register (Wiki); have the agreement reviewed by a California attorney.
  2. Sign in on the page: draw your signature on the agreement (Agreements tab) and give your particulars (Partner details).
  3. Invite each partner with a personal link (Invites tab): they apply, draw their signature, give their particulars and are admitted; each turns on notifications (You → Notifications).
     Certificates and the signed agreement are on the page and as PDFs (needs: sudo apt install texlive-latex-recommended texlive-pictures texlive-fonts-recommended).
  4. Bring in the existing holdings: bash import-holdings.sh … (sets every partner's units to their capital).
  5. Stand in the elections for Treasurer and Secretary (candidacy open 14 days).
  6. Work through the legal register's calendar: fictitious business name within 40 days; ask Berkeley about a business license."
