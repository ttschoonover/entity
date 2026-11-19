#!/usr/bin/env bash
# make-ichf.sh · the International Co-operative Housing Federation (ICHF) and
# its two national federations, on one bilingual website.
#
#   bash make-ichf.sh
#
# Three entities under ~/entities, each with its own record and node:
#   ichf    International Co-operative Housing Federation /
#           Fédération internationale de l'habitat coopératif. Officially
#           bilingual (English and French): its name, acronym, motto, founding
#           texts and chat are kept in both, and its website speaks both.
#   nachf   North American Co-operative Housing Federation (NACHF), official
#           languages English, French and Spanish.
#   ffhc    Fédération française de l'habitat coopératif (FFHC), the French
#           Co-operative Housing Federation, official language French.
# Every national federation sets its own name, acronym, motto and official
# languages (republic.names, republic.acronym, republic.languages), its own
# officers and its own rules; the ICHF sets none of them.
#
# Members are people in member co-operatives. Each is a member of exactly one
# national federation, and through it of the ICHF (entity federation certify /
# enroll, as in make-federation.sh). The ICHF has:
#   - a Council of Federations (three delegates from each national federation)
#     and a General Assembly (fifteen seats shared by membership): together they
#     decide the ICHF's business;
#   - officers elected by all members: two Co-Presidents (one from each language
#     of the federation, by convention), a Secretary-General and a Treasurer;
#   - committees: the Executive (letters, jointly), the Clearing Committee (labor
#     credits) and the Translation Committee (both languages, always);
#   - labor credits: one international unit, 1.00 = one hour of ordinary co-op
#     work, paid for verified work on the ICHF's list and sent between members of
#     any national federation;
#   - a wiki, chat, letters and voting.
#
# Settings, all optional:
#   ME=tim  OTHER=ana   founders: ME founds the ICHF and NACHF; OTHER founds FFHC
#   PORT=7870           the ICHF; NACHF and FFHC take the next two
#   ENTITY_NEW_PASSWORD / OTHER_PASSWORD   (asked if unset)
#   ICHF_HOST / NACHF_HOST / FFHC_HOST     hostnames for the tunnel

set -euo pipefail
ME="${ME:-tim}"; OTHER="${OTHER:-ana}"; PORT="${PORT:-7870}"
HOME_DIR="${ENTITIES:-$HOME/entities}"; SRC="${SRC:-$HOME_DIR/entity}"; SOURCE="${MODULE_SOURCE:-github:ttschoonover/entity-modules@main}"
FED_DIR="$HOME_DIR/ichf"; A_DIR="$HOME_DIR/nachf"; B_DIR="$HOME_DIR/ffhc"
for v in "$ME" "$OTHER"; do [[ "$v" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "ids are lowercase letters, digits and -: $v"; exit 1; }; done
[ "$ME" != "$OTHER" ] || { echo "ME and OTHER must be different people: nobody belongs to two national federations"; exit 1; }
for d in "$FED_DIR" "$A_DIR" "$B_DIR"; do [ -e "$d" ] && { echo "$d already exists. Move it aside first."; exit 1; }; done
[ -f "$SRC/sites/ichf/index.html" ] && [ -f "$SRC/library/letters/index.js" ] || { echo "No ICHF website or letters module at $SRC (they ship with entity 0.9.28 or later)"; exit 1; }
ask() { local a b; read -rsp "$1 (12 or more characters): " a; echo >&2; read -rsp "The same again: " b; echo >&2; [ "$a" = "$b" ] || { echo "The two passwords differ." >&2; exit 1; }; printf "%s" "$a"; }
ME_PW="${ENTITY_NEW_PASSWORD:-}"; [ -n "$ME_PW" ] || ME_PW="$(ask "A password for $ME")"
OTHER_PW="${OTHER_PASSWORD:-}"; [ -n "$OTHER_PW" ] || OTHER_PW="$(ask "A password for $OTHER")"
J() { node -p 'JSON.stringify(process.argv[1])' "$1"; }
setup() { mkdir -p "$1"; ( cd "$SRC" && tar cf - --exclude=.git --exclude=.staged --exclude=record --exclude=node_modules --exclude=./parameters.yml --exclude=./node.json --exclude=./letters . ) | ( cd "$1" && tar xf - ); }
E() { local d="$1"; shift; ( cd "$d" && node cli/index.js "$@" ); }
decide() {
  local d="$1" who="$2" title="$3" effects="$4" changes="${5:-}" id
  id=$(E "$d" propose --as "$who" --title "$title" --effects "$effects" ${changes:+--changes "$changes"} | grep -o 'd-[0-9a-f]\{12\}' | head -1)
  [ -n "$id" ] || { echo "  could not propose: $title"; E "$d" propose --as "$who" --title "$title" --effects "$effects" ${changes:+--changes "$changes"} || true; exit 1; }
  E "$d" settle > /dev/null
  E "$d" act ballot.cast --proposal "$id" --choice for --as "$who" --settle > /dev/null
  printf '  %-56s %s\n' "$title" "$(E "$d" count "$id" | tail -1)"
}
page() { E "$1" act wiki.edit --as "$2" --page "$3" --title "$4" --category "$5" --base 0 --settle --body "$6" > /dev/null; printf '  %-56s %s\n' "page: $4" "written"; }
nodejson() { ( cd "$1" && node -e "const fs=require('fs');const n=JSON.parse(fs.readFileSync('node.json'));Object.assign(n,{settleAfter:0,port:Number(process.argv[1]),site:'website',wikiLetters:{}});fs.writeFileSync('node.json',JSON.stringify(n,null,2)+'\n')" "$2" ); }
entityId() { grep -o '"entity":"e-[0-9a-f]*"' "$1/record/events.jsonl" | head -1 | cut -d'"' -f4; }
keysOf() { ( cd "$1" && node --input-type=module -e "const s=await import('./kernel/store.js');const e=await s.open(process.cwd());console.log(JSON.stringify(e.state.participants[process.argv[1]].keys))" "$2" ); }

# ── the national federations ────────────────────────────────────────────────
# national DIR FOUNDER PASSWORD PRESET-SETTINGS(yaml) CHAIR-TITLE DELEGATE-TITLE DEPUTY-TITLE
national() {
  local dir="$1" founder="$2" pw="$3" settings="$4" chair="$5" deleg="$6" deputy="$7" first="$8" name
  setup "$dir"
  cat > "$dir/presets/_national.yml" <<YML
_: A national federation of housing co-operatives, a member of the ICHF.
modules: [deliberation, titles, vocabulary, passwords, republic, offices, committees, authority, elections, wiki, chat, letters]
set:
$settings
  membership.admission: decision
  amendment.rules.constitutional.readings: 1
  amendment.rules.constitutional.apart: 0
  amendment.rules.entrenched.readings: 1
  amendment.rules.entrenched.apart: 0
YML
  E "$dir" preset apply _national > /dev/null
  name=$(cd "$dir" && node -e "const y=require('fs').readFileSync('presets/_national.yml','utf8');console.log(JSON.parse(y.match(/entity.name: (.*)/)[1]))")
  echo "== Founding $name in $dir"
  E "$dir" found --id "$founder" --name "$name" | head -1
  E "$dir" module source "$SOURCE" > /dev/null 2>&1 || true
  ENTITY_NEW_PASSWORD="$pw" E "$dir" password set --as "$founder" --settle > /dev/null
  decide "$dir" "$founder" "$first" "[
    {\"kind\":\"office.create\",\"office\":\"chair\",\"title\":$(J "$chair"),\"seats\":1,\"term_days\":365},
    {\"kind\":\"office.create\",\"office\":\"federal-senator\",\"title\":$(J "$deleg"),\"seats\":3,\"term_days\":365},
    {\"kind\":\"office.create\",\"office\":\"federal-deputy\",\"title\":$(J "$deputy"),\"seats\":15,\"term_days\":365},
    {\"kind\":\"office.create\",\"office\":\"federal-registrar\",\"title\":\"Registrar\",\"seats\":1},
    {\"kind\":\"office.fill\",\"office\":\"chair\",\"holder\":\"$founder\"},
    {\"kind\":\"office.fill\",\"office\":\"federal-senator\",\"holder\":\"$founder\"},
    {\"kind\":\"office.fill\",\"office\":\"federal-registrar\",\"holder\":\"$founder\"},
    {\"kind\":\"election.call\",\"election\":\"chair-1\",\"office\":\"chair\",\"method\":\"ranked\",\"stand_days\":14,\"vote_days\":7}]"
}

national "$A_DIR" "$ME" "$ME_PW" '  entity.name: "North American Co-operative Housing Federation"
  republic.acronym: "NACHF"
  republic.motto: "Homes held in common, from coast to coast"
  republic.languages: [en, fr, es]
  republic.names:
    - { lang: en, name: "North American Co-operative Housing Federation", acronym: NACHF, motto: "Homes held in common, from coast to coast" }
    - { lang: fr, name: "Fédération nord-américaine de l’habitat coopératif", acronym: FNAHC, motto: "Des foyers en commun, d’un océan à l’autre" }
    - { lang: es, name: "Federación Norteamericana de Vivienda Cooperativa", acronym: FNVC, motto: "Hogares en común, de costa a costa" }
  vocabulary.participant: member
  vocabulary.participants: members
  vocabulary.assembly: "Members’ Meeting"
  chat.channels:
    - { id: general, title: "General · Général · General", about: "Any language the federation speaks.", read: members, post: members }
    - { id: houses, title: "Houses", about: "Member co-operatives: what works, what broke, who can help.", read: members, post: members }' \
  "Chair" "Delegate to the ICHF Council" "Delegate to the ICHF General Assembly" "The Chair, and our seats in the ICHF"
page "$A_DIR" "$ME" welcome "Welcome · Bienvenue · Bienvenida" "Start here" "## English
The North American Co-operative Housing Federation brings together housing co-operatives in Canada, the United States and Mexico. Its official languages are English, French and Spanish; any member may write in any of them.

## Français
La Fédération nord-américaine de l’habitat coopératif réunit des coopératives d’habitation du Canada, des États-Unis et du Mexique. Ses langues officielles sont l’anglais, le français et l’espagnol.

## Español
La Federación Norteamericana de Vivienda Cooperativa reúne cooperativas de vivienda de Canadá, Estados Unidos y México. Sus idiomas oficiales son el inglés, el francés y el español."

national "$B_DIR" "$OTHER" "$OTHER_PW" '  entity.name: "Fédération française de l’habitat coopératif"
  republic.short_name: "la Fédération française"
  republic.acronym: "FFHC"
  republic.motto: "Habiter ensemble, décider ensemble"
  republic.languages: [fr]
  republic.names:
    - { lang: fr, name: "Fédération française de l’habitat coopératif", acronym: FFHC, motto: "Habiter ensemble, décider ensemble" }
  vocabulary.participant: "membre"
  vocabulary.participants: "membres"
  vocabulary.assembly: "Assemblée générale"
  vocabulary.proposal: "résolution"
  chat.channels:
    - { id: general, title: "Général", about: "Tout ce qui concerne la fédération.", read: members, post: members }
    - { id: cooperatives, title: "Coopératives", about: "Les coopératives membres : ce qui marche, ce qui casse, qui peut aider.", read: members, post: members }' \
  "Président·e" "Délégué·e au Conseil de la FIHC" "Délégué·e à l’Assemblée générale de la FIHC" "La présidence, et nos sièges à la FIHC"
page "$B_DIR" "$OTHER" bienvenue "Bienvenue" "Pour commencer" "La Fédération française de l’habitat coopératif réunit des coopératives d’habitants en France, organisées selon la loi du 24 mars 2014 (loi ALUR). Sa langue officielle est le français. Elle est membre de la Fédération internationale de l’habitat coopératif."
A_ID=$(entityId "$A_DIR"); B_ID=$(entityId "$B_DIR")

# ── the international federation ────────────────────────────────────────────
echo "== Founding the ICHF in $FED_DIR"
setup "$FED_DIR"
cat > "$FED_DIR/presets/_ichf.yml" <<'YML'
_: The International Co-operative Housing Federation, officially bilingual. A
   Council of Federations and a General Assembly; officers elected by all
   members; labor credits; a wiki, chat and letters in English and French.
modules: [deliberation, titles, vocabulary, passwords, republic, federation, value, tasks, offices, committees,
          authority, elections, wiki, chat, letters]
set:
  entity.name: "International Co-operative Housing Federation"
  republic.short_name: "the ICHF"
  republic.acronym: "ICHF"
  republic.motto: "Housing held in common, everywhere"
  republic.languages: [en, fr]
  republic.names:
    - { lang: en, name: "International Co-operative Housing Federation", acronym: ICHF, motto: "Housing held in common, everywhere" }
    - { lang: fr, name: "Fédération internationale de l’habitat coopératif", acronym: FIHC, motto: "Un toit en commun, partout" }
  vocabulary.participant: member
  vocabulary.participants: members
  vocabulary.assembly: "Council and Assembly"
  vocabulary.proposal: motion
  membership.admission: decision
  federation.senators_per_state: 3
  federation.assembly_seats: 15
  value.name: "labor credits"
  value.decimals: 2
  value.transferable: true
  tasks.verify: true
  tasks.pay_per_hour: 100
  letters.accent: "17406B"
  amendment.rules.constitutional.readings: 1
  amendment.rules.constitutional.apart: 0
  amendment.rules.entrenched.readings: 1
  amendment.rules.entrenched.apart: 0
  chat.channels:
    - { id: general, title: "General · Général", about: "Members of every federation, in either language. · Les membres de toutes les fédérations, dans l’une ou l’autre langue.", read: members, post: members }
    - { id: council, title: "Council · Conseil", about: "The Council of Federations talks motions over; anyone may read. · Le Conseil des fédérations débat des motions ; tout le monde peut lire.", read: public, post: "office:co-president" }
    - { id: credits, title: "Labor credits · Crédits de travail", about: "Work wanted, work offered, and credits sent between houses. · Travail demandé, travail offert, crédits échangés entre maisons.", read: members, post: members }
    - { id: translation, title: "Translation · Traduction", about: "Texts waiting for their second language. · Les textes qui attendent leur seconde langue.", read: members, post: members }
YML
E "$FED_DIR" preset apply _ichf > /dev/null
E "$FED_DIR" found --id "$ME" --name "International Co-operative Housing Federation" | head -1
E "$FED_DIR" module source "$SOURCE" > /dev/null 2>&1 || true
ENTITY_NEW_PASSWORD="$ME_PW" E "$FED_DIR" password set --as "$ME" --settle > /dev/null

decide "$FED_DIR" "$ME" "Officers and committees · Dirigeants et comités" "[
  {\"kind\":\"office.create\",\"office\":\"co-president\",\"title\":\"Co-President · Coprésident·e\",\"seats\":2,\"term_days\":730},
  {\"kind\":\"office.create\",\"office\":\"secretary-general\",\"title\":\"Secretary-General · Secrétaire général·e\",\"seats\":1,\"term_days\":730},
  {\"kind\":\"office.create\",\"office\":\"treasurer\",\"title\":\"Treasurer · Trésorier·ère\",\"seats\":1,\"term_days\":730},
  {\"kind\":\"committee.create\",\"committee\":\"executive\",\"title\":\"Executive Committee · Comité exécutif\",\"needs\":\"majority\",\"seats\":5,
   \"remit\":\"The Co-Presidents, the Secretary-General, the Treasurer and one member named by the Council. Speaks for the ICHF between meetings, in letters signed jointly. · Les coprésident·es, le ou la secrétaire général·e, le trésorier ou la trésorière et un membre désigné par le Conseil.\"},
  {\"kind\":\"committee.create\",\"committee\":\"clearing\",\"title\":\"Clearing Committee · Comité de compensation\",\"needs\":2,\"seats\":3,
   \"remit\":\"Keeps the labor credit: issues credits for work done outside the ICHF's list within its grant, holds the clearing reserve, and sets each year the rates at which national units convert. · Tient le crédit de travail.\"},
  {\"kind\":\"committee.create\",\"committee\":\"translation\",\"title\":\"Translation Committee · Comité de traduction\",\"needs\":1,\"seats\":4,
   \"remit\":\"Sees that every official text exists in English and in French before it is adopted, and that both versions say the same thing. · Veille à ce que chaque texte officiel existe en anglais et en français avant son adoption.\"},
  {\"kind\":\"office.fill\",\"office\":\"co-president\",\"holder\":\"$ME\"},
  {\"kind\":\"office.fill\",\"office\":\"secretary-general\",\"holder\":\"$ME\"},
  {\"kind\":\"committee.appoint\",\"committee\":\"executive\",\"member\":\"$ME\"},
  {\"kind\":\"committee.appoint\",\"committee\":\"clearing\",\"member\":\"$ME\"},
  {\"kind\":\"committee.appoint\",\"committee\":\"translation\",\"member\":\"$ME\"}]"

decide "$FED_DIR" "$ME" "Powers, letterheads and the first elections · Pouvoirs, en-têtes et élections" "[
  {\"kind\":\"authority.grant\",\"grant\":\"executive-letters\",\"to\":{\"committee\":\"executive\"},\"may\":[\"letter.issue\",\"letter.withdraw\"],\"where\":{\"letterhead\":\"ichf\"}},
  {\"kind\":\"authority.grant\",\"grant\":\"secretariat-letters\",\"to\":{\"office\":\"secretary-general\"},\"may\":[\"letter.issue\",\"letter.withdraw\"],\"where\":{\"letterhead\":\"secretariat\"}},
  {\"kind\":\"authority.grant\",\"grant\":\"clearing\",\"to\":{\"committee\":\"clearing\"},\"may\":[\"value.issue\",\"value.pay\"],\"limit\":{\"count\":40,\"days\":30},
   \"note\":\"Two members of the Clearing Committee sign each issue: credits for verified work done outside the ICHF's list, and payments from the clearing reserve. At most forty a month.\"},
  {\"kind\":\"letterhead.define\",\"letterhead\":\"ichf\",\"issuer\":\"committee:executive\",\"joint\":\"majority\",
   \"name\":\"International Co-operative Housing Federation\",\"title\":\"Fédération internationale de l’habitat coopératif\",
   \"subtitle\":\"Executive Committee · Comité exécutif\",\"seal_top\":\"ICHF · FIHC\",\"seal_bottom\":\"Housing held in common · Un toit en commun\",
   \"signatory_role\":\"Executive Committee · Comité exécutif\",\"closing\":\"For the Executive Committee · Pour le Comité exécutif,\",
   \"style\":{\"accent\":\"17406B\",\"emblem_text\":\"ICHF\"}},
  {\"kind\":\"letterhead.define\",\"letterhead\":\"secretariat\",\"issuer\":\"office:secretary-general\",
   \"name\":\"International Co-operative Housing Federation\",\"title\":\"Office of the Secretary-General · Secrétariat général\",
   \"seal_top\":\"ICHF · FIHC\",\"seal_bottom\":\"Secretariat · Secrétariat\",\"style\":{\"accent\":\"17406B\",\"emblem_text\":\"ICHF\",\"layout\":\"flush\"}},
  {\"kind\":\"election.call\",\"election\":\"co-presidents-1\",\"office\":\"co-president\",\"method\":\"approval\",\"stand_days\":21,\"vote_days\":14,\"seats\":2},
  {\"kind\":\"election.call\",\"election\":\"secretary-general-1\",\"office\":\"secretary-general\",\"method\":\"ranked\",\"stand_days\":21,\"vote_days\":14},
  {\"kind\":\"election.call\",\"election\":\"treasurer-1\",\"office\":\"treasurer\",\"method\":\"ranked\",\"stand_days\":21,\"vote_days\":14}]"

echo "== The founding texts, in both languages"
page "$FED_DIR" "$ME" constitution "Constitution of the International Co-operative Housing Federation" "Constitution" "## Article 1 · The Federation
1. The International Co-operative Housing Federation (ICHF) is a federation of national federations of housing co-operatives. Its members are the people who belong to member co-operatives, each through exactly one national federation.
2. The ICHF is officially bilingual. English and French have equal standing; every official text is adopted in both, and the two versions are equally authoritative. A member may address any organ in either language and be answered in it.
3. Each national federation chooses its own name, acronym, motto, official languages, officers and rules. The ICHF sets none of them.

## Article 2 · National federations
1. A national federation joins by a decision of the ICHF, and certifies its members and its delegates from its own record.
2. A national federation leaves only by a decision of the ICHF, and its members leave with it.

## Article 3 · The Council and the General Assembly
1. The Council of Federations has three delegates from each national federation. The General Assembly has fifteen seats, shared among the national federations by membership, at least one each.
2. Together they decide the ICHF's business. Amendments to this Constitution need two thirds of both.

## Article 4 · Officers and committees
1. All members elect two Co-Presidents, a Secretary-General and a Treasurer, for two years. By convention, the two Co-Presidents do not share a first language.
2. The Executive Committee speaks for the ICHF between meetings, by letters a majority of its members sign. The Clearing Committee keeps the labor credit. The Translation Committee sees that every official text exists in both languages.
3. Officers and committees act only within powers granted on the record.

## Article 5 · The labor credit
1. The labor credit is the ICHF's unit of account: 1.00 labor credit is one hour of ordinary co-operative work.
2. It is earned for verified work, held by members of any national federation, and sent between them. Its rules are set by the Labor Credit Statute.

## Article 6 · Records
Every act of every organ is signed and kept on a record that each national federation and each member can hold and check."
page "$FED_DIR" "$ME" constitution-fr "Constitution de la Fédération internationale de l’habitat coopératif" "Constitution" "## Article 1 · La Fédération
1. La Fédération internationale de l’habitat coopératif (FIHC) est une fédération de fédérations nationales de coopératives d’habitation. Ses membres sont les personnes qui appartiennent aux coopératives membres, chacune par l’intermédiaire d’une seule fédération nationale.
2. La FIHC est officiellement bilingue. L’anglais et le français ont un statut égal ; tout texte officiel est adopté dans les deux langues, et les deux versions font également foi. Tout membre peut s’adresser à tout organe dans l’une ou l’autre langue et recevoir une réponse dans cette langue.
3. Chaque fédération nationale choisit son nom, son sigle, sa devise, ses langues officielles, ses dirigeants et ses règles. La FIHC n’en fixe aucun.

## Article 2 · Les fédérations nationales
1. Une fédération nationale adhère par décision de la FIHC, et certifie ses membres et ses délégués à partir de son propre registre.
2. Une fédération nationale ne se retire que par décision de la FIHC, et ses membres se retirent avec elle.

## Article 3 · Le Conseil et l’Assemblée générale
1. Le Conseil des fédérations compte trois délégué·es par fédération nationale. L’Assemblée générale compte quinze sièges, répartis entre les fédérations nationales selon leurs effectifs, au moins un chacune.
2. Ensemble, ils décident des affaires de la FIHC. Les modifications de la présente Constitution requièrent les deux tiers de l’un et de l’autre.

## Article 4 · Dirigeants et comités
1. L’ensemble des membres élit deux coprésident·es, un·e secrétaire général·e et un trésorier ou une trésorière, pour deux ans. Par convention, les deux coprésident·es n’ont pas la même langue première.
2. Le Comité exécutif parle au nom de la FIHC entre les réunions, par des lettres que signe la majorité de ses membres. Le Comité de compensation tient le crédit de travail. Le Comité de traduction veille à ce que chaque texte officiel existe dans les deux langues.
3. Les dirigeants et les comités n’agissent que dans les limites des pouvoirs accordés au registre.

## Article 5 · Le crédit de travail
1. Le crédit de travail est l’unité de compte de la FIHC : 1,00 crédit de travail correspond à une heure de travail coopératif ordinaire.
2. Il se gagne par un travail vérifié, est détenu par les membres de toute fédération nationale et circule entre eux. Ses règles sont fixées par le Statut du crédit de travail.

## Article 6 · Registres
Tout acte de tout organe est signé et conservé dans un registre que chaque fédération nationale et chaque membre peut détenir et vérifier."
page "$FED_DIR" "$ME" labor-credit-statute "Labor Credit Statute · Statut du crédit de travail" "Labor credits · Crédits de travail" "## English
1. **The unit.** 1.00 labor credit (LC) is one hour of ordinary co-operative work: cooking, cleaning, repairs, bookkeeping, care. Credits are counted to the hundredth.
2. **Earning.** Any member may post work the ICHF or a member co-operative needs. Another member verifies it, and each verified hour pays 1.00 LC. Work done for a house outside the list is credited by two members of the Clearing Committee, on the house's written statement.
3. **Holding and sending.** Credits belong to members, not to national federations. A member may send credits to any member of any national federation.
4. **National units.** A national federation or a house may keep hours or credits of its own. The Clearing Committee publishes each year the rate at which each national unit converts to labor credits, after hearing the federation concerned.
5. **Limits.** Credits are not money, are not sold for money by the ICHF, and pay no interest.

## Français
1. **L’unité.** 1,00 crédit de travail (CT) correspond à une heure de travail coopératif ordinaire : cuisine, ménage, réparations, comptabilité, soin. Les crédits se comptent au centième.
2. **Gagner.** Tout membre peut publier un travail dont la FIHC ou une coopérative membre a besoin. Un autre membre le vérifie, et chaque heure vérifiée rapporte 1,00 CT. Le travail fait pour une maison hors de la liste est crédité par deux membres du Comité de compensation, sur déclaration écrite de la maison.
3. **Détenir et transmettre.** Les crédits appartiennent aux membres, et non aux fédérations nationales. Tout membre peut transmettre des crédits à tout membre de toute fédération nationale.
4. **Unités nationales.** Une fédération nationale ou une maison peut tenir ses propres heures ou crédits. Le Comité de compensation publie chaque année le taux auquel chaque unité nationale se convertit en crédits de travail, après avoir entendu la fédération concernée.
5. **Limites.** Les crédits ne sont pas de l’argent, ne sont pas vendus par la FIHC et ne portent pas intérêt."
decide "$FED_DIR" "$ME" "Adopt the Constitution and the Statute · Adopter la Constitution et le Statut" '[
  {"kind":"wiki.enact","page":"constitution","version":1},{"kind":"wiki.enact","page":"constitution-fr","version":1},{"kind":"wiki.enact","page":"labor-credit-statute","version":1}]'

echo "== The national federations join"
decide "$FED_DIR" "$ME" "Admit the NACHF and the FFHC · Admettre la FNAHC et la FFHC" "[
  {\"kind\":\"federation.admit_state\",\"state\":\"nachf\",\"name\":\"North American Co-operative Housing Federation\",\"entity\":\"$A_ID\",\"keys\":$(keysOf "$A_DIR" "$ME")},
  {\"kind\":\"federation.admit_state\",\"state\":\"ffhc\",\"name\":\"Fédération française de l’habitat coopératif\",\"entity\":\"$B_ID\",\"keys\":$(keysOf "$B_DIR" "$OTHER")}]"
E "$FED_DIR" federation certify --from "$A_DIR" --state nachf --as "$ME" --settle | sed 's/^/  /'
decide "$FED_DIR" "$ME" "The Council and the Assembly decide · Le Conseil et l’Assemblée décident" "[]" '{"decision.electorate":"parliament","amendment.rules.constitutional.readings":2,"amendment.rules.constitutional.apart":30,"amendment.rules.entrenched.readings":2,"amendment.rules.entrenched.apart":30}'
E "$FED_DIR" federation certify --from "$B_DIR" --state ffhc --as "$OTHER" --settle | sed 's/^/  /'
ENTITY_PASSWORD="$OTHER_PW" E "$FED_DIR" federation enroll --from "$B_DIR" --state ffhc --as "$OTHER" --password --settle | sed 's/^/  /'

echo "== The website: three federations, one site"
nodejson "$FED_DIR" "$PORT"; nodejson "$A_DIR" $((PORT + 1)); nodejson "$B_DIR" $((PORT + 2))
url() { if [ -n "$1" ]; then echo "https://$1/"; else echo "http://localhost:$2/"; fi; }
FED_URL=$(url "${ICHF_HOST:-}" "$PORT"); A_URL=$(url "${NACHF_HOST:-}" $((PORT + 1))); B_URL=$(url "${FFHC_HOST:-}" $((PORT + 2)))
mkdir -p "$FED_DIR/website"; cp -r "$FED_DIR/sites/kit/." "$FED_DIR/website/"; mv "$FED_DIR/website/site.css" "$FED_DIR/website/kit.css"; cp -r "$FED_DIR/sites/ichf/." "$FED_DIR/website/"
node -e 'const [f,au,bu]=process.argv.slice(1);require("fs").writeFileSync(f,JSON.stringify([{key:"ichf",label:"ICHF · FIHC",url:"./"},{key:"nachf",label:"NACHF",url:au},{key:"ffhc",label:"FFHC",url:bu}],null,2)+"\n")' "$FED_DIR/website/entities.json" "$A_URL" "$B_URL"
for pair in "$A_DIR:nachf" "$B_DIR:ffhc"; do
  IFS=: read -r d k <<< "$pair"; mkdir -p "$d/website"
  printf '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=%sfederation.html?e=%s"><title>ICHF</title><p><a href="%sfederation.html?e=%s">ICHF · FIHC</a></p>\n' "$FED_URL" "$k" "$FED_URL" "$k" > "$d/website/index.html"
done
for d in "$FED_DIR" "$A_DIR" "$B_DIR"; do E "$d" verify | tail -1 | sed "s|^|  $(basename "$d"): |"; done

START="$HOME/tsite/deploy/start-all.sh"; CFG="$HOME/.cloudflared/config.yml"
for pair in "$FED_DIR:$PORT:${ICHF_HOST:-}" "$A_DIR:$((PORT + 1)):${NACHF_HOST:-}" "$B_DIR:$((PORT + 2)):${FFHC_HOST:-}"; do
  IFS=: read -r d p host <<< "$pair"
  [ -f "$START" ] && ! grep -q "$d:" "$START" && sed -i "s|^ENTITIES=(\(.*\))|ENTITIES=(\1 \"$d:$p\")|" "$START" && echo "  $(basename "$d") added to the start script"
  if [ -n "$host" ] && [ -f "$CFG" ] && ! grep -q "hostname: $host" "$CFG"; then
    python3 - "$CFG" "$host" "$p" <<'PY'
import sys; c,h,p=sys.argv[1:4]; s=open(c).read()
s=s.replace('  - service: http_status:404', f'  - hostname: {h}\n    service: http://localhost:{p}\n  - service: http_status:404'); open(c,'w').write(s)
PY
    cloudflared tunnel route dns --overwrite-dns poezine "$host" 2>&1 | tail -1 || true
  fi
done
cat <<EOF

The ICHF is founded, with the NACHF and the FFHC.
  $FED_DIR   port $PORT   (the website for all three)
  $A_DIR   port $((PORT + 1))
  $B_DIR   port $((PORT + 2))
Start them: ~/tsite/deploy/start-all.sh, or in each folder: node cli/index.js serve --settle
Then open $FED_URL: English or French at the top right.
When a national federation admits members or names delegates, its registrar
presses "Report to the ICHF" on its card; new members then press "Join the ICHF".
EOF
