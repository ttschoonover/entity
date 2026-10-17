#!/usr/bin/env bash
# Two peers on a real Radicle network (two local nodes, no public seeds).
# Alice founds and publishes; Bob clones by Radicle ID and joins with his
# Radicle key; acts flow both ways; a draft statute is refused, decided on,
# then adopted; simultaneous settlement diverges, is refused, and is merged
# deliberately until both records are byte-identical.
#
#   bash test/radicle/two-peers.sh          (needs rad, radicle-node, git-remote-rad)
set -e
SRC=$(cd "$(dirname "$0")/../.." && pwd)
export PATH=${RADICLE_BIN:+$RADICLE_BIN:}$PATH RAD_PASSPHRASE=
R=$(mktemp -d); cd $R
export ENTITY_MODULES=$SRC/library
P1=${PORT_BASE:-19101}; P2=$((P1+1))
for who in alice bob; do RAD_HOME=$R/rad-$who rad auth --alias $who >/dev/null 2>&1; done
B=$(node --input-type=module -e "import {nodeId} from '$SRC/kernel/keys.js'; import fs from 'fs'; console.log(nodeId(fs.readFileSync('$R/rad-bob/keys/radicle.pub','utf8')))")
A=$(node --input-type=module -e "import {nodeId} from '$SRC/kernel/keys.js'; import fs from 'fs'; console.log(nodeId(fs.readFileSync('$R/rad-alice/keys/radicle.pub','utf8')))")
python3 - <<PY
import json
for who,port,peer,pport in (('alice',$P1,'$B',$P2),('bob',$P2,'$A',$P1)):
    p=f'$R/rad-{who}/config.json'; c=json.load(open(p))
    c['preferredSeeds']=[]; c['node']['listen']=[f'127.0.0.1:{port}']; c['node']['peers']={'type':'static'}
    c['node']['connect']=[f'{peer}@127.0.0.1:{pport}']; c['cli']['hints']=False
    json.dump(c,open(p,'w'),indent=2)
PY
RAD_HOME=$R/rad-alice rad node start >/dev/null 2>&1; RAD_HOME=$R/rad-bob rad node start >/dev/null 2>&1; sleep 2
cleanup(){ RAD_HOME=$R/rad-alice rad node stop >/dev/null 2>&1; RAD_HOME=$R/rad-bob rad node stop >/dev/null 2>&1; }; trap cleanup EXIT

node $SRC/cli/index.js dist --dir $SRC --out $R/e.tar.gz >/dev/null
mkdir alice && tar xzf e.tar.gz -C alice --strip-components=1
ea(){ (cd $R/alice && RAD_HOME=$R/rad-alice ENTITY_KEYS=$R/keys-alice node cli/index.js "$@"); }
eb(){ (cd $R/bob && RAD_HOME=$R/rad-bob ENTITY_KEYS=$R/keys-bob node cli/index.js "$@"); }
echo "== alice founds with her Radicle key and publishes"
ea preset apply assembly >/dev/null
ea found --id p-0001 --name "The Commons" --radicle | sed -n '1,3p'
ea radicle init | head -2
RID=$(cd alice && RAD_HOME=$R/rad-alice rad .)
python3 -c "import json;p='$R/alice/node.json';c=json.load(open(p));c['settleAfter']=0;json.dump(c,open(p,'w'))"
echo "== bob clones by Radicle ID"
(cd $R && RAD_HOME=$R/rad-bob ENTITY_KEYS=$R/keys-bob node alice/cli/index.js clone $RID $R/bob)
python3 -c "import json;p='$R/bob/node.json';c=json.load(open(p));c['settleAfter']=0;json.dump(c,open(p,'w'))"
eb join --id p-0002 --radicle | head -1
eb sync
echo "== alice pulls bob's application, then only settles: publishing is automatic"
ea sync | grep pull
ea settle
ea radicle status
echo "== bob pulls the settled record"
eb sync
eb status | sed -n 2,3p
cmp alice/record/events.jsonl bob/record/events.jsonl && echo "RECORDS BYTE-IDENTICAL"
eb verify | tail -1

echo; echo "== bob drafts a statute in his own namespace"
mkdir -p bob/law/statutes; printf '# Public meetings\n\nEvery meeting of the Assembly is open to all participants.\n' > bob/law/statutes/public-meetings.md
eb sync >/dev/null
ea sync >/dev/null
echo "== alice tries to adopt it with no decision"
ea adopt p-0002 | tail -3 || true
DIG=$(ea adopt p-0002 | grep '^digest' | cut -d' ' -f2 || true)
PID=$(ea act proposal.lay --title "Public meetings" --rule organic --paths '["law/statutes/public-meetings.md"]' --digest $DIG --settle | grep -o 'd-[0-9a-f]*' | head -1)
ea act ballot.cast --proposal $PID --choice for --settle >/dev/null
ea sync >/dev/null; eb sync >/dev/null
eb act ballot.cast --proposal $PID --choice for >/dev/null
eb sync >/dev/null; ea sync --settle >/dev/null
ea count $PID | tail -1
echo "== alice adopts it now"
ea adopt p-0002 | tail -1
test -f alice/law/statutes/public-meetings.md && echo "statute present in alice's copy"
ea sync >/dev/null; eb sync >/dev/null
cmp alice/record/events.jsonl bob/record/events.jsonl && echo "RECORDS BYTE-IDENTICAL"

echo; echo "== both settle conflicting acts at once"
ea act title.set --title Alice --settle >/dev/null; eb act title.set --title Bob --settle >/dev/null
ea sync >/dev/null; eb sync | grep -E "DIVERGED" || true
ea sync | grep -E "DIVERGED|repair --merge" || true
echo "-- each merges deliberately"
ea repair --merge .entity/incoming --resettle --write | tail -2
eb repair --merge .entity/incoming --resettle --write | tail -1
ea sync >/dev/null; eb sync >/dev/null
cmp alice/record/events.jsonl bob/record/events.jsonl && echo "CONVERGED: RECORDS BYTE-IDENTICAL"
ea participants; ea verify | tail -1; eb verify | tail -1
echo "TWO-PEERS OK"
