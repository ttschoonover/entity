#!/usr/bin/env bash
# make-commune.sh · the People's Commune of the Long Table: a council-communist
# micronation as a headless Git Republic, with its own website built on windows.
#
#   bash make-commune.sh your-id ["Commune Name"] [folder] [port] [hostname]
#   e.g. bash make-commune.sh tim "People's Commune of the Long Table" commune 7850 commune.poezine.org
#   (asks for your password and the name comrades see; YOUR_NAME="…" sets it ahead)
#
# Sovereignty sits with the Congress of all comrades, who vote on everything
# directly if they choose. Day to day, laws are made by a Council of seven
# delegates, elected for one season (ninety days) and recallable at any moment
# by an ordinary vote of the Congress. A law the Council passes waits fourteen
# days, during which one comrade in ten can send it to the whole Congress. The
# Fundamental Law changes only by the Congress. A Presidium of three, acting
# only unanimously, issues decrees within limits and speaks for the Commune.
# Five People's Commissars run labour, supply, the Plan, external affairs and
# enlightenment, each within a published grant. A Control Commission of three
# hears disputes and audits everyone else, and may hold no other office.
#
# Work is paid in labour vouchers: one voucher for one verified hour, whatever
# the work, and vouchers cannot be sold or given away, only spent (retired).
# The Commune's things are held in common and lent free. Every act is signed and
# public. Comrades may leave at any time, and a minority may leave together
# (`entity fork`), taking the record with them.
# No page module: the Commune's website is website/ (the kit, the laws pages,
# and sites/commune), computed in each visitor's browser from the public record.

set -euo pipefail
ME="${1:?usage: make-commune.sh your-id [\"Commune Name\"] [folder] [port] [hostname]}"
NAME="${2:-People’s Commune of the Long Table}"; FOLDER="${3:-commune}"; PORT="${4:-7850}"; HOST="${5:-}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
DIR="$HOME_DIR/$FOLDER"
case "$NAME" in [Tt]he\ *) the_name="the ${NAME#* }"; The_name="The ${NAME#* }";; *) the_name="the $NAME"; The_name="The $NAME";; esac
MOTTO="${MOTTO:-From each according to ability, to each according to need}"
[[ "$ME" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "Your id is lowercase letters, digits and -"; exit 1; }
[ -e "$DIR" ] && { echo "$DIR already exists. Move it aside first (mv $DIR $DIR-old), or give another folder name."; exit 1; }
[ -f "$SRC/cli/index.js" ] || { echo "No entity code at $SRC"; exit 1; }
[ -f "$SRC/sites/commune/index.html" ] && [ -f "$SRC/sites/vdr/laws.js" ] && [ -f "$SRC/sites/kit/common.js" ] || { echo "No Commune website at $SRC/sites (it ships with entity 0.9.26 or later)"; exit 1; }
if [ -z "${ENTITY_NEW_PASSWORD:-}" ]; then
  read -rsp "A password for $ME (12 or more characters): " PW; echo
  read -rsp "The same again: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "The two passwords differ."; exit 1; }
  export ENTITY_NEW_PASSWORD="$PW"
fi
if [ -z "${YOUR_NAME+x}" ] && [ -t 0 ]; then read -rp "Your name, as other comrades will see it (Enter to skip): " YOUR_NAME; fi
YOUR_NAME="${YOUR_NAME:-}"

mkdir -p "$DIR"
( cd "$SRC" && tar cf - --exclude=.git --exclude=.staged --exclude=record --exclude=node_modules --exclude=./parameters.yml --exclude=./node.json . ) | ( cd "$DIR" && tar xf - )
cd "$DIR"
E() { node "$DIR/cli/index.js" "$@"; }
decide() {
  local id; id=$(E propose --as "$ME" --title "$1" --effects "$2" | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  E settle > /dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle > /dev/null
  printf '  %-46s %s\n' "$1" "$(E count "$id" | tail -1)"
}
J() { node -p 'JSON.stringify(process.argv[1])' "$1"; }

cat > presets/_commune.yml <<YML
_: A council-communist micronation. A Congress of all comrades; a Council of
   delegates, elected by season and recallable at any time; a Presidium that acts
   only unanimously; People's Commissars within published grants; a Control
   Commission. Labour vouchers for hours worked; things held in common.
   Headless: its website is website/, built on windows.
modules: [deliberation, titles, vocabulary, offices, committees, authority, elections,
          wiki, laws, republic, polls, meetings, passwords, badges, chat,
          value, tasks, budget, deeds, lending, disputes, letters]
set:
  entity.name: $(J "$NAME")
  republic.short_name: "the Commune"
  republic.motto: $(J "$MOTTO")
  vocabulary.participant: "comrade"
  vocabulary.participants: "comrades"
  vocabulary.assembly: "Congress"
  vocabulary.proposal: "motion"
  membership.admission: "open"
  deliberation.period: 7
  chat.channels:
    - { id: commune, title: The Long Table, about: "Anything at all. Free discussion is a duty here.", read: members, post: members }
    - { id: council, title: The Council, about: "Delegates talk bills over in public; anyone can read.", read: public, post: "office:delegate" }
    - { id: gazette, title: The Gazette, about: "The Commune's paper of record, kept by the Commissar of Enlightenment.", read: public, post: "office:commissar-of-enlightenment" }
    - { id: criticism, title: Criticism and Self-Criticism, about: "Say what is going wrong, including with yourself. Nobody is punished for anything said here.", read: members, post: members }
  laws.types:
    - { id: fundamental, title: Fundamental, rule: constitutional, describe: "The Fundamental Law: the organs of the Commune, how power passes between them, and the rights of comrades." }
    - { id: organic, title: Organic, rule: organic, describe: "Creates an organ of the Commune, a commissariat or a commission, and governs it." }
    - { id: law, title: Law, rule: ordinary, describe: "Ordinary legislation of the Council or the Congress." }
    - { id: decree, title: Decree, rule: ordinary, describe: "A decree of the Presidium, issued unanimously within its grant. The Congress or the Council may repeal any decree." }
    - { id: plan, title: Plan, rule: ordinary, describe: "A season's Plan: what the Commune will make, mend and lend, and the hours it expects to need." }
    - { id: parametric, title: Parametric, rule: ordinary, levels: [fundamental, law, organic], changes: true, describe: "Settings for how the Commune and its website run. Enacting it changes them." }
  laws.parliament: "office:delegate"
  laws.parliament_days: 7
  laws.parliament_max_rule: organic
  laws.petition_days: 14
  laws.petition_share: 0.1
  value.name: "labour vouchers"
  value.decimals: 1
  value.transferable: false
  tasks.verify: true
  tasks.pay_per_hour: 10
  budget.currency: "hours"
  budget.decimals: 1
  disputes.arbiter: "committee:control-commission"
  disputes.appeal: "committee:presidium"
  offices.term_limit: 2
  lending.default_days: 14
  lending.max_per_member: 5
  letters.accent: "8E1F1A"
  letters.face: palatino
  amendment.rules.constitutional.readings: 1
  amendment.rules.constitutional.apart: 0
  amendment.rules.entrenched.readings: 1
  amendment.rules.entrenched.apart: 0
YML
echo "== Founding $NAME in $DIR"
E preset apply _commune >/dev/null
E found --id "$ME" --name "$NAME" | head -1
E module source "$SOURCE" >/dev/null 2>&1 || true
E password set --as "$ME" --settle >/dev/null && echo "  your password is set"
[ -n "$YOUR_NAME" ] && E act title.set --as "$ME" --title "$YOUR_NAME" --settle >/dev/null && echo "  you appear as $YOUR_NAME ($ME)"

echo "== The organs of the Commune"
decide "The organs of the Commune" "$(cat <<JSON
[{"kind":"office.create","office":"delegate","title":"Delegate to the Council","seats":7,"term_days":90},
 {"kind":"office.create","office":"commissar-of-labour","title":"People’s Commissar of Labour","seats":1,"term_days":90},
 {"kind":"office.create","office":"commissar-of-supply","title":"People’s Commissar of Supply","seats":1,"term_days":90},
 {"kind":"office.create","office":"commissar-of-the-plan","title":"People’s Commissar of the Plan","seats":1,"term_days":90},
 {"kind":"office.create","office":"commissar-of-external-affairs","title":"People’s Commissar of External Affairs","seats":1,"term_days":90},
 {"kind":"office.create","office":"commissar-of-enlightenment","title":"People’s Commissar of Enlightenment","seats":1,"term_days":90},
 {"kind":"committee.create","committee":"presidium","title":"Presidium of the Council","needs":"all","seats":3,
  "remit":"Three delegates chosen by the Congress. The collective head of the Commune: it acts only when all three sign, issues decrees within its grant, calls the Congress, confers honours and hears appeals."},
 {"kind":"committee.create","committee":"control-commission","title":"Control Commission","needs":"majority","seats":3,
  "remit":"Three comrades chosen by the Congress, holding no other office. Hears disputes between comrades and complaints against any organ, audits the vouchers and the Plan, and reports to every Congress."},
 {"kind":"office.fill","office":"delegate","holder":"$ME"},
 {"kind":"office.fill","office":"commissar-of-labour","holder":"$ME"},
 {"kind":"office.fill","office":"commissar-of-supply","holder":"$ME"},
 {"kind":"office.fill","office":"commissar-of-the-plan","holder":"$ME"},
 {"kind":"office.fill","office":"commissar-of-external-affairs","holder":"$ME"},
 {"kind":"office.fill","office":"commissar-of-enlightenment","holder":"$ME"},
 {"kind":"committee.appoint","committee":"presidium","member":"$ME"}]
JSON
)"

echo "== The Fundamental Law"
export FUNDAMENTAL_TEXT="We, the comrades of $the_name, a commune that lives online and claims no land, hold in common what we make together, govern ourselves as equals, and keep every act of our government in the open. From each according to ability, to each according to need: until we can afford that, to each according to the hours they give.

## Article 1 · The Commune
1. $The_name is a commune of equals. All power belongs to the comrades, and passes to the organs of the Commune only as this Fundamental Law allows, and only for as long as the comrades allow it.
2. The Commune claims no territory and no authority over anyone who is not a comrade. Being a comrade takes nothing away from any person's rights or duties elsewhere.
3. Every act of every organ is signed by whoever made it and kept on a public record that anyone may read, copy and check. An act not on the record was not done.

## Article 2 · Comrades
1. Anyone may become a comrade by asking. No one is refused for their origin, beliefs, identity or opinions.
2. A comrade may leave at any time. Comrades who disagree with the Commune may leave together and found another, taking a copy of the whole record with them, and no organ may prevent it.
3. A comrade may be expelled only by the Congress, after a hearing before the Control Commission, for serious and repeated harm to other comrades.

## Article 3 · Rights of Comrades
No law, decree or Plan may take these away:
1. To speak, write and publish freely, to criticise any organ and any officer, and to criticise oneself without penalty.
2. To vote in every Congress and election, to stand for every office, and to have each vote counted equally.
3. To recall any delegate, commissar or member of the Presidium, at any time, by a motion in the Congress.
4. To read the whole record and to know who decided what.
5. To be heard before any decision that singles them out, and to appeal it.
6. To borrow what the Commune holds in common, free of charge, in turn.

## Article 4 · The Congress of Comrades
1. The Congress is every comrade. It is the highest organ of the Commune, and it sits whenever a motion is open.
2. Any comrade may move any motion: a law, a repeal, a recall, an appointment, or a question.
3. Only the Congress may amend this Fundamental Law, expel a comrade, appoint the Presidium and the Control Commission, or adopt the season's Plan.
4. The Congress may at any time recall any officer by an ordinary motion. The recalled officer may stand again at the next election.

## Article 5 · The Council of Delegates
1. The Council has seven delegates, elected by the Congress by approval voting for one season of ninety days. No one may serve more than two seasons in a row.
2. Any delegate may introduce a bill. Bills are open for seven days and pass under the rule their law needs, counted among the delegates.
3. A bill the Council passes comes into force fourteen days later, unless one comrade in ten petitions within that time to send it to the Congress, which then decides it.
4. The Council makes laws, organic laws and settings by itself. Any bill touching the Fundamental Law goes to the Congress.
5. Delegates receive no more vouchers for an hour of Council work than for an hour of washing up.

## Article 6 · Democratic Centralism
1. Discussion is free until a decision is taken, and decisions are binding on every organ once taken.
2. The minority keeps every right it had: to keep arguing, to petition, to recall, to move the question again at the next Congress, and to leave together.
3. No organ may act against a decision of a higher organ. The order of organs is: the Congress; the Council; the Presidium; the Commissars.

## Article 7 · The Presidium
1. The Presidium is three delegates appointed by the Congress. It acts only when all three sign.
2. It may issue decrees, of the type decree only, which the Council or the Congress may repeal at any time. It may call the Congress, confer the honours of the Commune, issue letters in the Commune's name, and hear appeals from the Control Commission.
3. The Presidium has no other powers. Whatever it is not given in writing, it does not have.

## Article 8 · The People's Commissars
1. There are five People's Commissars: of Labour, of Supply, of the Plan, of External Affairs and of Enlightenment, each elected by the Congress for one season.
2. Each acts only within a grant of authority published on the record, with its limits. Every use of a grant is published, and the Congress may undo any of them.
3. The Commissar of Labour keeps the list of work and the vouchers paid for it. The Commissar of Supply keeps the Commune's things and the lending of them. The Commissar of the Plan keeps the season's accounts. The Commissar of External Affairs writes to the world. The Commissar of Enlightenment keeps the Gazette and the Commune's library.

## Article 9 · The Control Commission
1. The Control Commission is three comrades appointed by the Congress, who hold no other office while they serve.
2. It hears disputes between comrades and complaints against any organ or officer, and decides them by a majority, giving reasons on the record. Its decisions may be appealed to the Presidium.
3. It audits the vouchers, the Plan and the use of every grant, and reports to the Congress at the end of every season.

## Article 10 · Labour and Distribution
1. Work for the Commune is listed openly, claimed freely and verified by another comrade.
2. Every verified hour of work is paid one labour voucher, whatever the work and whoever does it.
3. Labour vouchers cannot be sold, lent or given away. They are spent by being retired, at the Commune's store or for its services.
4. The Commune's things belong to all comrades in common. They are lent free, in turn, and returned.
5. As the Commune grows richer in common things, the Congress shall move more of them from the store to the lending list, until vouchers are needed for nothing.

## Article 11 · The Plan
1. Each season the Commissar of the Plan proposes, and the Congress adopts, a Plan: what the Commune will make, mend and lend, and the hours it expects to need.
2. Nothing is spent from the common store except under a line of the Plan.

## Article 12 · Symbols
1. The flag of the Commune is a round table seen from above, cream on red, with twelve chairs around it, one of them empty and outlined in gold, and a gold star at the centre of the table.
2. The motto of the Commune is: From each according to ability, to each according to need.
3. The anthem of the Commune is The Long Table.
4. The holidays of the Commune are the eighteenth of March, the Day of the Commune; the first of May, the Day of Labour; and the day of its founding.
5. Comrades address one another as comrade, or by name, as they prefer.

## Article 13 · Amendment
1. This Fundamental Law is amended only by the Congress: two thirds of the votes cast, with at least half of all comrades voting.
2. No amendment may take away a right in Article 3, or the right in Article 2 to leave together, unless carried under the entrenched rule: three quarters of the votes cast, with at least three fifths of all comrades voting, in two votes at least thirty days apart.

## Article 14 · Founding
1. The founder holds every office and sits alone in the Presidium until the first elections are counted, and calls those elections at founding.
2. The Congress appoints the Presidium and the Control Commission within ninety days."
FUND_EFFECT=$(node -e 'console.log(JSON.stringify([{kind:"law.enact",law:"fundamental-law",title:process.argv[1],text:process.env.FUNDAMENTAL_TEXT,type:"fundamental",tags:["state","rights","congress","council","presidium","commissars","labour","symbols"],enforcers:["committee:control-commission","committee:presidium"],subjects:["public"]}]))' "The Fundamental Law of $the_name")
decide "Enact the Fundamental Law" "$FUND_EFFECT"

decide "The Council Act" "$(node -e 'console.log(JSON.stringify([{kind:"law.enact",law:"council-act",title:"The Council Act",type:"organic",tags:["council","procedure","recall"],enforcers:["committee:presidium"],subjects:["office:delegate"],text:"## Section 1 · Sittings\n1. The Council sits whenever a bill is open. Delegates vote on the record, from the Commune’s website, and talk bills over in the Council channel, which anyone may read.\n\n## Section 2 · Mandates\n1. A delegate carries the views of the comrades who elected them. Any comrade may send a delegate an instruction on a bill in the Long Table channel; a delegate who votes against the instructions they received says why, on the record.\n2. A delegate may be recalled at any time by an ordinary motion of the Congress (Article 4.4).\n\n## Section 3 · Conduct\nDelegates declare any interest they have in a bill before voting on it."}]))')"

decide "The Labour Code" "$(node -e 'console.log(JSON.stringify([{kind:"law.enact",law:"labour-code",title:"The Labour Code",type:"law",tags:["labour","vouchers","tasks"],enforcers:["office:commissar-of-labour","committee:control-commission"],subjects:["citizens"],text:"## Section 1 · The list of work\n1. Any comrade may post work the Commune needs, with an estimate of the hours. The Commissar of Labour keeps the list in order.\n2. Work is claimed freely. Nobody is assigned work they did not claim.\n\n## Section 2 · Vouchers\n1. A verified hour pays one labour voucher, counted in tenths. The cleaning of the grease trap pays the same as the drafting of a law.\n2. Vouchers cannot be transferred. They are spent by retiring them.\n\n## Section 3 · Shock work\nWork done in an emergency the Presidium declares is paid as usual, and recognised with the honour of Shock Worker."}]))')"

echo "== The organs' powers"
decide "Grants of authority" '[
 {"kind":"authority.grant","grant":"decrees","title":"Decrees of the Presidium","to":{"committee":"presidium"},"may":["law.enact"],"where":{"type":"decree"},"limit":{"count":10,"days":90},"note":"Article 7.2: decrees only, repealable by the Council or the Congress."},
 {"kind":"authority.grant","grant":"congress-calls","title":"Calling the Congress","to":{"committee":"presidium"},"may":["meeting.call"]},
 {"kind":"authority.grant","grant":"honours","title":"Honours of the Commune","to":{"committee":"presidium"},"may":["badge.award"],"limit":{"count":12,"days":90}},
 {"kind":"authority.grant","grant":"presidium-letters","title":"Letters of the Presidium","to":{"committee":"presidium"},"may":["letter.issue","letter.withdraw"],"where":{"letterhead":"presidium"}},
 {"kind":"authority.grant","grant":"supply","title":"The common store","to":{"office":"commissar-of-supply"},"may":["deed.grant","deed.assign","loan.recall"],"limit":{"count":60,"days":30}},
 {"kind":"authority.grant","grant":"plan-accounts","title":"Keeping the Plan","to":{"office":"commissar-of-the-plan"},"may":["budget.spend"]},
 {"kind":"authority.grant","grant":"external-letters","title":"Letters to the world","to":{"office":"commissar-of-external-affairs"},"may":["letter.issue","letter.withdraw"],"where":{"letterhead":"external-affairs"}},
 {"kind":"authority.grant","grant":"labour-meetings","title":"Calling work days","to":{"office":"commissar-of-labour"},"may":["meeting.call"]}]'

echo "== Symbols, honours and letterheads"
decide "Honours of the Commune" "$(cat <<JSON
[{"kind":"badge.create","badge":"founder","title":"Founder of the Commune"},
 {"kind":"badge.create","badge":"hero-of-labour","title":"Hero of Labour","description":"For a season's work, done well and without fuss."},
 {"kind":"badge.create","badge":"shock-worker","title":"Shock Worker","description":"For work done in an emergency declared by the Presidium."},
 {"kind":"badge.create","badge":"order-of-the-long-table","title":"Order of the Long Table","description":"The Commune's highest honour, for service to the comrades."},
 {"kind":"badge.create","badge":"order-of-the-grease-trap","title":"Order of the Grease Trap","description":"For the work nobody wanted, done anyway."},
 {"kind":"badge.award","badge":"founder","to":"$ME"}]
JSON
)"
decide "The letterheads" "$(cat <<JSON
[{"kind":"letterhead.define","letterhead":"presidium","issuer":"committee:presidium","joint":"all","name":$(J "$NAME"),"title":"Presidium of the Council","subtitle":"From each according to ability, to each according to need","seal_top":$(J "$NAME"),"seal_bottom":"Presidium of the Council","closing":"With comradely greetings,","signatory_role":"Member of the Presidium","style":{"emblem_text":"★"}},
 {"kind":"letterhead.define","letterhead":"external-affairs","issuer":"office:commissar-of-external-affairs","name":$(J "$NAME"),"title":"People’s Commissariat of External Affairs","seal_top":$(J "$NAME"),"seal_bottom":"External Affairs","closing":"With comradely greetings,","style":{"emblem_text":"★"}}]
JSON
)"

echo "== The first elections"
decide "The first elections" '[
 {"kind":"election.call","election":"council-1","office":"delegate","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"labour-1","office":"commissar-of-labour","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"supply-1","office":"commissar-of-supply","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"plan-1","office":"commissar-of-the-plan","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"external-1","office":"commissar-of-external-affairs","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"enlightenment-1","office":"commissar-of-enlightenment","method":"approval","stand_days":14,"vote_days":7}]'

echo "== The settings, as laws"
node --input-type=module - "$DIR" <<'JS' > "$DIR/.settings-acts"
const dir = process.argv[2];
const store = await import(`${dir}/kernel/store.js`), { paramsOf } = await import(`${dir}/kernel/state.js`);
const p = paramsOf((await store.open(dir)).state);
const ACTS = {
  ordinary: ['settings-law', 'The Settings Law', 'law'],
  organic: ['settings-organic', 'The Organic Settings Law', 'organic'],
  constitutional: ['settings-fundamental', 'The Fundamental Settings Law', 'fundamental'],
  entrenched: ['settings-entrenched', 'The Entrenched Settings Law', 'fundamental'],
};
const FINAL = { 'amendment.rules.entrenched.readings': 2, 'amendment.rules.entrenched.apart': 30 };
const groups = {};
for (const k of p.keys().sort()) {
  const r = p.rule(k);
  if (!r || r.changeable === false || k === 'entity.modules' || !ACTS[r.name]) continue;
  (groups[r.name] ||= []).push(k);
}
for (const rule of ['ordinary', 'organic', 'constitutional', 'entrenched']) {
  const keys = groups[rule]; if (!keys) continue;
  const [law, title, level] = ACTS[rule];
  const changes = Object.fromEntries(keys.map(k => [k, k in FINAL ? FINAL[k] : p.value(k)]));
  const tags = ['settings', ...new Set(keys.map(k => String(p.def(k).group || k.split('.')[0]).toLowerCase().replace(/[^a-z0-9 -]/g, '').slice(0, 30)))].filter(Boolean).slice(0, 12);
  const text = `The settings of the Commune that change only by the ${rule} majority, and what each one governs. Changing one is an amendment to this law, or another parametric law that sets it.\n\n` +
    keys.map(k => `- **${k}**: ${String(p.def(k).describe || '').replace(/\s+/g, ' ').trim()}`).join('\n');
  console.log(JSON.stringify({ title, effects: [{ kind: 'law.enact', law, title, type: 'parametric', level, tags: [...new Set(tags)],
    enforcers: ['committee:control-commission'], subjects: ['citizens'], changes, text }] }));
}
JS
while IFS= read -r line; do decide "$(node -p 'JSON.parse(process.argv[1]).title' "$line")" "$(node -p 'JSON.stringify(JSON.parse(process.argv[1]).effects)' "$line")"; done < "$DIR/.settings-acts"
rm -f "$DIR/.settings-acts"

echo "== The website"
mkdir -p "$DIR/website" && cp -r "$DIR/sites/kit/." "$DIR/website/"
cp "$DIR/sites/vdr/laws.html" "$DIR/sites/vdr/laws.js" "$DIR/sites/vdr/laws-wiki.js" "$DIR/website/"
cp -r "$DIR/sites/commune/." "$DIR/website/"
cat "$DIR/website/commune.css" >> "$DIR/website/site.css"
sed -i 's/· Virtual Democratic Republic/· The Commune/; s/The laws of the Virtual Democratic Republic, starting with its Constitution/The laws of the Commune, starting with its Fundamental Law/; s/Every law of the Republic, starting with the Constitution/Every law of the Commune, starting with the Fundamental Law/' "$DIR/website/laws.html"
node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),site:'website'});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$PORT"
echo "  website/ is served at /, the record at /record and the window at /window.js"
E verify | tail -1

if command -v rad >/dev/null && rad self >/dev/null 2>&1; then E radicle init | tail -1; else echo "  (Radicle not unlocked: later, cd $DIR && node cli/index.js radicle init)"; fi
if [ -n "$HOST" ]; then
  START="$HOME/tsite/deploy/start-all.sh"
  [ -f "$START" ] && ! grep -q "entities/$FOLDER:" "$START" && sed -i "s|^ENTITIES=(\(.*\))|ENTITIES=(\1 \"\$HOME/entities/$FOLDER:$PORT\")|" "$START" && echo "  added to the start script"
  CFG="$HOME/.cloudflared/config.yml"
  if [ -f "$CFG" ] && ! grep -q "hostname: $HOST" "$CFG"; then
    python3 - "$CFG" "$HOST" "$PORT" <<'PY'
import sys; p,h,port=sys.argv[1:4]; s=open(p).read()
s=s.replace('  - service: http_status:404', f'  - hostname: {h}\n    service: http://localhost:{port}\n  - service: http_status:404'); open(p,'w').write(s)
PY
    cloudflared tunnel route dns --overwrite-dns poezine "$HOST" 2>&1 | tail -1 || true
  fi
fi
cat <<EOF

$NAME is founded in $DIR. Next:
  1. Start it: ~/tsite/deploy/start-all.sh (restart cloudflared if the tunnel config changed)${HOST:+, then open https://$HOST}
  2. Anyone can become a comrade from the front page; they choose a name and a password.
  3. The first elections (the Council and the five Commissars) are open for candidates for 14 days, then voting for 7.
  4. Within ninety days the Congress appoints the Presidium and the Control Commission (Article 14).
  5. Edit the website in $DIR/website (plain HTML, CSS and JS); changes show on the next reload.
EOF
