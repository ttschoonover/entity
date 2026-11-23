#!/usr/bin/env bash
# republics/notifys/make.sh · found Notify.S, the Berkeley Co-operative Notification System.
#
#   bash republics/notifys/make.sh your-id [folder] [port] [hostname]
#   e.g. bash republics/notifys/make.sh tim notifys "" notify.tschoonover.com
#
# You become its first admin. It starts with one house, Lothlórien; add more
# under Central. People ask to join from the sign-in page, naming their house;
# that house's emergency managers (or an admin) let them in.
#
# The parts: the core (entity), the notifys module (library/notifys), and this
# folder's website (site/). Change the website later with ship-site.sh.
HERE="$(cd "$(dirname "$0")" && pwd)"
ME="${1:?usage: make.sh your-id [folder] [port] [hostname]}"
NAME="Notify.S"; FOLDER="${2:-notifys}"; PORT="${3:-}"; HOST="${4:-notify.tschoonover.com}"; SITE=lothlorien; RAD_PRIVATE=1
source "${SRC:-${ENTITIES:-$HOME/entities}/entity}/found-common.sh"

if [ -z "$PORT" ]; then
  PORT=7890; while ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . || grep -rqs "\"port\": $PORT\b" "$HOME_DIR"/*/node.json; do PORT=$((PORT+1)); done
fi

prepare

cat > presets/_notifys.yml <<YML
_: Notify.S, the Berkeley Co-operative Notification System. Admins and emergency managers act alone; nothing is voted on.
modules: [deliberation, titles, passwords, notify, notifys]
set:
  entity.name: "Notify.S"
  decision.electorate: "founder"
  membership.admission: "decision"
  notify.events: [notices]
  notify.broadcast: "nobody"
YML
found_it _notifys

echo "== The first house"
E act notifys.house --as "$ME" --house loth --name "Lothlórien" --settle > /dev/null && echo "  Lothlórien"
E act notifys.move --as "$ME" --member "$ME" --house loth --settle > /dev/null && echo "  you live at Lothlórien"

echo "== The website"
rm -rf "$DIR/site"; cp -r "$HERE/site" "$DIR/site"
# Mail and links: reuse Loth's mail command if there is one.
MAIL="$(node -p "try{require('$HOME_DIR/loth/node.json').notify.mail||''}catch(e){''}" 2>/dev/null || true)"
node -e '
const fs=require("fs"); const [port, host, mail]=process.argv.slice(1);
const n=fs.existsSync("node.json")?JSON.parse(fs.readFileSync("node.json")):{};
Object.assign(n,{settleAfter:0,port:Number(port),private:true,modulesOnline:false,site:"site",
  site_open:["pico.min.css","site.css","hub.js","signin.js","logo-dark.svg","icon.svg"],
  open_routes:["/m/notifys/houses"],readers:["m:notifys.admins","founder"],
  notify:{...(n.notify||{}),url:"https://"+host+"/",subject:"mailto:alerts@tschoonover.com",...(mail?{mail}:{})}});
fs.writeFileSync("node.json",JSON.stringify(n,null,2)+"\n");' "$PORT" "$HOST" "$MAIL"
[ -n "$MAIL" ] && echo "  emails go out with Loth's mail command" || echo "  no mail command yet: set node.json notify.mail (see Loth's)"
E verify | tail -1

finish_up "  1. Start it:  cd $DIR && nohup node cli/index.js serve --settle > ~/notifys.log 2>&1 &   (or add it to ~/start-all.sh)
  2. Open https://$HOST and sign in as $ME. Central is at the top.
  3. Under Central, appoint Lothlórien's emergency manager and the central alert team.
  4. Housemates choose Ask to join; the emergency manager lets them in under House."
