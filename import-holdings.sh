#!/usr/bin/env bash
# import-holdings.sh · brings an existing club's money and securities into its
# books (made by make-club.sh), as one resolution of the partners.
#
#   bash import-holdings.sh your-id club-folder holdings.csv [as-of YYYY-MM-DD]
#   e.g. bash import-holdings.sh tim ~/entities/club ~/holdings.csv 2026-11-01
#
# Fill in a copy of presets/holdings-template.csv from the latest brokerage and
# bank statements. Every partner named in it must already be a partner (applied,
# signed the agreement, admitted). The script checks that the capital accounts
# add up to the cash plus the holdings at the prices given, then lays one joint
# resolution (under the strictest rule its parts need) that:
#   - opens the books (fund.opening): the cash, each holding with its cost
#     basis and today's price, and each partner's capital account;
#   - sets each partner's partnership units to their capital at the club's
#     initial unit value ($10.00 a unit unless changed), issuing or redeeming
#     the difference, so votes by units follow capital.
# The partners vote on it like any joint resolution. Nothing is bought or sold:
# this records what the club already owns. Run it once, before anything else is
# recorded in the books.
#
# Where one office keeps the books (fund.bookkeeper, as in The Orchard GP), run
# it as that officer: they record the opening balances under their grant, and
# the units that follow capital are put to the partners as a resolution.

set -euo pipefail
ME="${1:?usage: import-holdings.sh your-id club-folder holdings.csv [YYYY-MM-DD]}"
DIR="$(cd "${2:?the club folder}" && pwd)"; CSV="$(cd "$(dirname "${3:?the holdings file}")" && pwd)/$(basename "$3")"
ASOF="${4:-$(date +%F)}"
[ -f "$DIR/cli/index.js" ] || { echo "No club at $DIR"; exit 1; }
cd "$DIR"
E() { node "$DIR/cli/index.js" "$@"; }
JSFILE="$(mktemp)"; trap 'rm -f "$JSFILE"' EXIT
cat > "$JSFILE" <<'JS'
const [dir, csv, asOf] = process.argv.slice(2);
const fs = await import('node:fs');
const { open } = await import(`${dir}/kernel/store.js`), { paramsOf } = await import(`${dir}/kernel/state.js`);
const e = await open(dir), st = e.state, p = paramsOf(st);
const fail = (m) => { console.error(`refused: ${m}`); process.exit(2); };
if (!p.value('entity.modules').includes('fund')) fail('this club has no books (the fund module): it was made before entity 0.9.27');
if (st.m.fund?.ledger?.length) fail('the books are already open');
const dollars = (s, what) => { const v = String(s || '').replace(/[$,\s]/g, ''); if (!/^\d+(\.\d{1,2})?$/.test(v)) fail(`${what}: "${s}" is not an amount in dollars`); return Math.round(Number(v) * 100); };
let cash = 0; const holdings = [], capital = {};
for (const [n, raw] of fs.readFileSync(csv, 'utf8').split(/\r?\n/).entries()) {
  const line = raw.trim(); if (!line || line.startsWith('#') || /^kind,/.test(line)) continue;
  const [kind, id, qty, cost, price] = line.split(',').map(s => s.trim());
  if (kind === 'cash') cash += dollars(price, `line ${n + 1} (cash)`);
  else if (kind === 'holding') holdings.push({ symbol: id.toUpperCase(), quantity: Number(qty), cost: dollars(cost, `line ${n + 1} (cost of ${id})`), price: dollars(price, `line ${n + 1} (price of ${id})`) });
  else if (kind === 'capital') { if (!st.participants[id] || st.participants[id].status !== 'active') fail(`line ${n + 1}: ${id} is not a partner yet: they apply, sign the agreement, and are admitted first`); capital[id] = (capital[id] || 0) + dollars(price, `line ${n + 1} (capital of ${id})`); }
  else fail(`line ${n + 1}: the kind is cash, holding or capital`);
}
const worth = cash + holdings.reduce((a, h) => a + Math.round(h.quantity * h.price), 0);
const total = Object.values(capital).reduce((a, b) => a + b, 0);
if (Math.abs(worth - total) > holdings.length) fail(`the capital accounts add up to $${(total / 100).toFixed(2)}, but the cash and holdings come to $${(worth / 100).toFixed(2)}`);
const uv = p.value('fund.initial_unit_value'), cls = p.has('partnership.unit_class') ? p.value('partnership.unit_class') : 'units';
const have = st.m.shares?.classes?.[cls]?.holders || {};
const effects = [{ kind: 'fund.opening', as_of: asOf, cash, holdings, capital, note: `Imported from ${csv.split('/').pop()}` }];
const lines = [];
for (const [id, c] of Object.entries(capital)) {
  const want = Math.round(c / uv), now = Number(have[id] || 0);
  if (want > now) effects.push({ kind: 'share.issue', class: cls, to: id, count: want - now, note: `units for opening capital of $${(c / 100).toFixed(2)}` });
  if (want < now) effects.push({ kind: 'share.redeem', class: cls, from: id, count: now - want, note: `units set to opening capital of $${(c / 100).toFixed(2)}` });
  lines.push(`${id}: capital $${(c / 100).toFixed(2)}, ${want} units (${(100 * c / total).toFixed(2)}%)`);
}
for (const id of Object.keys(have)) if (!(id in capital) && Number(have[id]) > 0) effects.push({ kind: 'share.redeem', class: cls, from: id, count: Number(have[id]), note: 'no opening capital' });
const keeper = p.has('fund.bookkeeper') ? p.value('fund.bookkeeper') : '';
let grant = null;
if (keeper) {
  const me = process.env.ME_ID, at = new Date().toISOString();
  if (!(st.m.offices?.[keeper]?.holders || []).some(x => x.id === me && (!x.until || x.until > at))) fail(`only the ${keeper} keeps these books (fund.bookkeeper): run this as the ${keeper}`);
  grant = Object.values(st.m.authority?.grants || {}).find(g => !g.revoked && g.to?.office === keeper && g.may.includes('fund.opening'))?.id;
  if (!grant) fail(`no grant to the ${keeper} permits fund.opening`);
}
console.log(JSON.stringify({ effects, grant, summary: [`cash $${(cash / 100).toFixed(2)}; ${holdings.length} holding(s); worth $${(worth / 100).toFixed(2)} as of ${asOf}`, ...lines] }));
JS
PLAN="$(ME_ID="$ME" node --input-type=module < "$JSFILE" - "$DIR" "$CSV" "$ASOF")"
echo "== Opening balances"
node -p 'JSON.parse(process.argv[1]).summary.map(s => "  " + s).join("\n")' "$PLAN"
EFF="$(node -p 'JSON.stringify(JSON.parse(process.argv[1]).effects)' "$PLAN")"
GRANT="$(node -p 'JSON.parse(process.argv[1]).grant || ""' "$PLAN")"
if [ -n "$GRANT" ]; then
  # The Treasurer alone records the opening balances; the units that follow capital are a resolution of the partners.
  OPEN="$(node -p 'JSON.stringify(JSON.parse(process.argv[1]).filter(e => e.kind === "fund.opening"))' "$EFF")"
  E act authority.exercise --grant "$GRANT" --effects "$OPEN" --as "$ME" --settle | tail -1
  EFF="$(node -p 'JSON.stringify(JSON.parse(process.argv[1]).filter(e => e.kind !== "fund.opening"))' "$EFF")"
  [ "$EFF" = "[]" ] && { echo "  Opening balances recorded. No units to change."; exit 0; }
fi
id=$(E propose --as "$ME" --title "$( [ -n "$GRANT" ] && echo "Units for the opening capital as of $ASOF" || echo "Opening balances as of $ASOF")" --effects "$EFF" | grep -o 'd-[0-9a-f]\{12\}' | head -1)
E settle >/dev/null; E act ballot.cast --proposal "$id" --choice for --as "$ME" --settle >/dev/null
echo "  resolution $id: $(E count "$id" | tail -1)"
echo "  The other partners vote on it from the club's site (Resolutions). Once it carries, the books show the holdings, and every partner's certificate their units."
