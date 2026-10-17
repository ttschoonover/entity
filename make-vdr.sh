#!/usr/bin/env bash
# make-vdr.sh · the Virtual Democratic Republic: a liberal democratic micronation
# as a headless Git Republic, with its own website built on windows.
#
#   bash make-vdr.sh your-id ["Republic Name"] [folder] [port] [hostname]
#   e.g. bash make-vdr.sh tim "Virtual Democratic Republic" vdr 7840 vdr.poezine.org
#   (asks for your password and the name citizens see; MOTTO="…" and YOUR_NAME="…" set them ahead)
#
# Open citizenship. Laws are made two ways: by a Parliament of nine elected
# members, or by referendum of all citizens; a bill Parliament passes can be sent
# to referendum by petition. Every law has a type (constitutional, organic,
# statutory, ordinary, parametric), tags, and the bodies that enforce it and on
# whom; changing a setting is a parametric law. A President, Speaker and
# Secretary of State are elected; a Supreme Court of three hears disputes. The
# Constitution is itself a law, enacted at founding.
# No page module: the republic's website is website/ (index.html, vdr.css, vdr.js,
# flag.svg), computed in each visitor's browser from the public record.

set -euo pipefail
ME="${1:?usage: make-vdr.sh your-id [\"Republic Name\"] [folder] [port] [hostname]}"
NAME="${2:-Virtual Democratic Republic}"; FOLDER="${3:-vdr}"; PORT="${4:-7840}"; HOST="${5:-}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
DIR="$HOME_DIR/$FOLDER"
# The name in running text: "the Virtual Democratic Republic"; at the start of a sentence, "The …".
case "$NAME" in [Tt]he\ *) the_name="the ${NAME#* }"; The_name="The ${NAME#* }";; *) the_name="the $NAME"; The_name="The $NAME";; esac
MOTTO="${MOTTO:-Room for one more}"
[[ "$ME" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "Your id is lowercase letters, digits and -"; exit 1; }
[ -e "$DIR" ] && { echo "$DIR already exists. Move it aside first (mv $DIR $DIR-old), or give another folder name."; exit 1; }
[ -f "$SRC/cli/index.js" ] || { echo "No entity code at $SRC"; exit 1; }
[ -f "$SRC/sites/vdr/index.html" ] && [ -f "$SRC/sites/kit/common.js" ] || { echo "No VDR website at $SRC/sites (it ships with entity 0.9.11 or later)"; exit 1; }
if [ -z "${ENTITY_NEW_PASSWORD:-}" ]; then
  read -rsp "A password for $ME (12 or more characters): " PW; echo
  read -rsp "The same again: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "The two passwords differ."; exit 1; }
  export ENTITY_NEW_PASSWORD="$PW"
fi
# The name other citizens see, shown as "Name (id)". YOUR_NAME="…" skips the question.
if [ -z "${YOUR_NAME+x}" ] && [ -t 0 ]; then read -rp "Your name, as other citizens will see it (Enter to skip): " YOUR_NAME; fi
YOUR_NAME="${YOUR_NAME:-}"

mkdir -p "$DIR"
( cd "$SRC" && tar cf - --exclude=.git --exclude=.staged --exclude=record --exclude=node_modules --exclude=./parameters.yml --exclude=./node.json . ) | ( cd "$DIR" && tar xf - )
cd "$DIR"
E() { node "$DIR/cli/index.js" "$@"; }
decide() {
  local id; id=$(E propose --as "$ME" --title "$1" --effects "$2" | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  E settle > /dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle > /dev/null
  printf '  %-44s %s\n' "$1" "$(E count "$id" | tail -1)"
}
page() { E act wiki.edit --as "$ME" --page "$1" --title "$2" --category "$3" --base 0 --settle --body "$4" > /dev/null; printf '  %-44s %s\n' "page: $2" "written"; }

cat > presets/_vdr.yml <<YML
_: A liberal democratic micronation. Open citizenship, an Assembly of all citizens,
   elected officers with fixed terms, a Supreme Court, and a written Constitution.
   Headless: its website is website/, built on windows.
modules: [deliberation, titles, vocabulary, offices, committees, authority, elections,
          wiki, laws, republic, polls, meetings, passwords, badges, chat]
set:
  entity.name: $(node -p 'JSON.stringify(process.argv[1])' "$NAME")
  republic.short_name: $(node -p 'JSON.stringify(process.argv[1])' "$the_name")
  republic.motto: $(node -p 'JSON.stringify(process.argv[1])' "$MOTTO")
  chat.channels:
    - { id: general, title: General, about: "Anything at all.", read: members, post: members }
    - { id: parliament, title: Parliament, about: "Members of Parliament talk bills over; anyone can read.", read: public, post: "office:member-of-parliament" }
    - { id: ideas, title: Ideas, about: "Ideas for laws and for the Republic, before they become bills.", read: public, post: members }
  vocabulary.participant: "citizen"
  vocabulary.participants: "citizens"
  vocabulary.assembly: "Assembly"
  vocabulary.proposal: "bill"
  membership.admission: "open"
  deliberation.period: 7
  amendment.rules.constitutional.readings: 1
  amendment.rules.constitutional.apart: 0
  # One vote for now, so the founder can enact the Entrenched Settings Act, which
  # sets the entrenched rule back to two votes 30 days apart (Article X).
  amendment.rules.entrenched.readings: 1
  amendment.rules.entrenched.apart: 0
YML
echo "== Founding $NAME in $DIR"
E preset apply _vdr >/dev/null
E found --id "$ME" --name "$NAME" | head -1
E module source "$SOURCE" >/dev/null 2>&1 || true
E password set --as "$ME" --settle >/dev/null && echo "  your password is set"
[ -n "$YOUR_NAME" ] && E act title.set --as "$ME" --title "$YOUR_NAME" --settle >/dev/null && echo "  you appear as $YOUR_NAME ($ME)"

echo "== The offices, Parliament and the court"
decide "The offices of state" "$(cat <<JSON
[{"kind":"office.create","office":"president","title":"President","seats":1,"term_days":365},
 {"kind":"office.create","office":"speaker","title":"Speaker of Parliament","seats":1,"term_days":365},
 {"kind":"office.create","office":"secretary-of-state","title":"Secretary of State","seats":1,"term_days":365},
 {"kind":"office.create","office":"member-of-parliament","title":"Member of Parliament","seats":9,"term_days":365},
 {"kind":"committee.create","committee":"supreme-court","title":"Supreme Court","needs":"majority","seats":3,
  "remit":"Three justices appointed by the Assembly. Hears disputes and decides whether laws and acts are consistent with the Constitution."},
 {"kind":"office.fill","office":"president","holder":"$ME"},
 {"kind":"office.fill","office":"speaker","holder":"$ME"},
 {"kind":"office.fill","office":"secretary-of-state","holder":"$ME"},
 {"kind":"office.fill","office":"member-of-parliament","holder":"$ME"}]
JSON
)"

echo "== The Constitution"
export CONSTITUTION_TEXT="We, the citizens of $the_name, a republic that lives online and claims no land, establish this Constitution so that we may govern ourselves as equals, in the open, and by our own consent.

## Article I · The Republic
1. $The_name is a democratic republic. All its authority comes from its citizens, and is exercised only as this Constitution allows.
2. The Republic claims no territory and no authority over anyone who is not a citizen. Citizenship takes nothing away from any person's rights or duties elsewhere.
3. Every act of the Republic is signed by whoever made it and kept on a public record that anyone may read, copy and check.

## Article II · Citizenship
1. Citizenship is open to every person who asks for it. No one is refused for their origin, beliefs, identity or opinions.
2. A citizen may renounce citizenship at any time, without giving a reason.
3. Citizenship may be withdrawn only by the Supreme Court, for serious and repeated abuse of other citizens, after the citizen has been heard.

## Article III · Rights
Every citizen has these rights, which no law of the Republic may take away:
1. To speak, write and publish freely, and to criticise the Republic and anyone who serves it.
2. To assemble, and to form associations and parties within the Republic.
3. To vote in every referendum and election, to stand for every office, and to have each vote counted equally.
4. To read the whole record of the Republic, and to know who decided what.
5. To be heard before any decision that singles them out, and to appeal it to the Supreme Court.
6. To leave, and to take a full copy of the record with them.

## Article IV · The Laws
1. Every law of the Republic has a type, tags that say what it concerns, the bodies that enforce it, and the bodies or persons on whom it is enforced. A law without them is not enacted.
2. The types of law are constitutional, on the functioning of the state; organic, creating an institution and governing it; statutory, ordinary legislation; ordinary, text on managing an institution at the constitutional or statutory level; and parametric, the settings by which the Republic and its website run, at the constitutional, statutory or organic level. The list of types, and the rule each needs, is itself constitutional.
3. Changing a setting of the Republic is an act of law: it is made only by a parametric law.
4. A law needs the strictest rule of its type, its level, and every setting it changes.

## Article V · Parliament
1. Parliament has nine members, elected by the citizens by approval voting for terms of one year.
2. Any member may introduce a bill. Bills are open for votes for seven days, and pass under the rule their law needs, counted among the members.
3. A bill Parliament passes comes into force fourteen days later, unless one citizen in twenty petitions for a referendum on it within that time.
4. Parliament makes law by itself only up to the organic rule. A bill needing a stricter rule, including every constitutional law, comes into force only if the citizens ratify it by referendum.
5. The Speaker presides over Parliament and votes only as a member.

## Article VI · Referendums
1. Every citizen may put a law, an amendment or a repeal directly to a referendum of all citizens, which decides it under the rule the law needs.
2. A referendum also decides every bill sent to it by petition or by its rule.

## Article VII · The Executive
1. The President represents the Republic and carries out its laws.
2. The Secretary of State keeps the Republic's records and texts, welcomes new citizens, and publishes the outcome of every vote.
3. Officers act only within powers granted to them by law, on the record. Any grant may be withdrawn.

## Article VIII · Elections
1. The President, the Speaker, the Secretary of State and the members of Parliament are elected by approval voting: each citizen may approve as many candidates as they wish, and those approved by the most citizens win.
2. Terms of office last one year. No one may hold the presidency for more than two terms in a row.
3. Any citizen may stand for any office, with at least seven days to stand and seven days to vote.

## Article IX · The Supreme Court
1. The Supreme Court has three justices, appointed by referendum.
2. It hears disputes between citizens and complaints against officers, and decides whether a law or an act is consistent with this Constitution. An act it finds inconsistent has no effect.
3. Justices hold no other office while they serve, and give their reasons in writing, on the record.

## Article X · Amendment
1. This Constitution is amended by a constitutional law, ratified by referendum: two thirds of the votes cast, with at least half of all citizens voting.
2. No amendment may take away or change a right in Article III, or end open citizenship, unless it is carried under the entrenched rule: three quarters of the votes cast, with at least three fifths of all citizens voting, in two votes at least thirty days apart.

## Article XI · Founding
1. The founder holds the offices of state and a seat in Parliament until the first elections are counted, and calls those elections at founding.
2. The citizens appoint the first justices of the Supreme Court within ninety days."
CONST_EFFECT=$(node -e 'console.log(JSON.stringify([{kind:"law.enact",law:"constitution",title:process.argv[1],text:process.env.CONSTITUTION_TEXT,type:"constitutional",tags:["state","rights","citizenship","parliament","referendums","elections","courts"],enforcers:["committee:supreme-court","office:president"],subjects:["public"]}]))' "The Constitution of $the_name")
decide "Enact the Constitution" "$CONST_EFFECT"
decide "The Parliament Act" "$(node -e 'console.log(JSON.stringify([{kind:"law.enact",law:"parliament-act",title:"The Parliament Act",type:"organic",tags:["parliament","procedure"],enforcers:["office:speaker"],subjects:["office:member-of-parliament"],text:"## Section 1 · Sittings\n1. Parliament sits whenever a bill is open; members vote on the record, from the Republic’s website.\n2. The Speaker keeps order, sees that every bill is heard, and closes votes once they end.\n\n## Section 2 · Bills\n1. A bill states the law it would make: its type, its tags, and the bodies it concerns.\n2. A member may withdraw nothing once laid: a bill is decided, or it lapses when it closes without passing.\n\n## Section 3 · Conduct\nMembers declare any interest they have in a bill before voting on it."}]))')"
decide "The officers' powers" '[
 {"kind":"authority.grant","grant":"assembly-meetings","title":"Calling the Assembly together","to":{"office":"president"},"may":["meeting.call"]},
 {"kind":"authority.grant","grant":"honours","title":"Conferring honours","to":{"office":"president"},"may":["badge.award"],"limit":{"count":10,"days":30}},
 {"kind":"authority.grant","grant":"sittings","title":"Calling sittings of Parliament","to":{"office":"speaker"},"may":["meeting.call"]}]'
decide "The first elections" '[
 {"kind":"election.call","election":"president-1","office":"president","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"speaker-1","office":"speaker","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"secretary-of-state-1","office":"secretary-of-state","method":"approval","stand_days":14,"vote_days":7},
 {"kind":"election.call","election":"parliament-1","office":"member-of-parliament","method":"approval","stand_days":14,"vote_days":7}]'
decide "Honours of the Republic" "$(cat <<JSON
[{"kind":"badge.create","badge":"founder","title":"Founder"},
 {"kind":"badge.create","badge":"civic-service","title":"Order of Civic Service","description":"For service to the Republic and its citizens."},
 {"kind":"badge.award","badge":"founder","to":"$ME"}]
JSON
)"

echo "== The settings, as laws"
# Every setting is governed by a parametric law, at the level its rule needs:
# one act per majority. Changing a setting later means amending its act, or
# enacting another parametric law that sets it.
node --input-type=module - "$DIR" <<'JS' > "$DIR/.settings-acts"
const dir = process.argv[2];
const store = await import(`${dir}/kernel/store.js`), { paramsOf } = await import(`${dir}/kernel/state.js`);
const p = paramsOf((await store.open(dir)).state);
const ACTS = {
  ordinary: ['settings-statutory', 'The Statutory Settings Act', 'statutory'],
  organic: ['settings-organic', 'The Organic Settings Act', 'organic'],
  constitutional: ['settings-constitutional', 'The Constitutional Settings Act', 'constitutional'],
  entrenched: ['settings-entrenched', 'The Entrenched Settings Act', 'constitutional'],
};
// What the entrenched rule is meant to be once founding is over (Article X.2).
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
  const text = `The settings of the Republic that change only by the ${rule} majority, and what each one governs. Their values are set below; changing one is an amendment to this Act, or another parametric law that sets it.\n\n` +
    keys.map(k => `- **${k}**: ${String(p.def(k).describe || '').replace(/\s+/g, ' ').trim()}`).join('\n');
  console.log(JSON.stringify({ title, effects: [{ kind: 'law.enact', law, title, type: 'parametric', level, tags: [...new Set(tags)],
    enforcers: ['office:secretary-of-state'], subjects: ['citizens'], changes, text }] }));
}
JS
while IFS= read -r line; do decide "$(node -p 'JSON.parse(process.argv[1]).title' "$line")" "$(node -p 'JSON.stringify(JSON.parse(process.argv[1]).effects)' "$line")"; done < "$DIR/.settings-acts"
rm -f "$DIR/.settings-acts"

echo "== The website"
mkdir -p "$DIR/website" && cp -r "$DIR/sites/kit/." "$DIR/website/" && cp -r "$DIR/sites/vdr/." "$DIR/website/"   # the shared kit, then the VDR's own pages
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
  2. Anyone can become a citizen from the front page; they choose a name and a password.
  3. The first elections are open for candidates for 14 days, then voting for 7. Stand from the Offices section.
  4. Edit the website in $DIR/website (plain HTML, CSS and JS); changes show on the next reload.
EOF
