# Cookbook

Six projects, each with the exact commands to build it in a terminal.
Every block here was run, as written, on a fresh install.

The demos put every person's key on one machine so you can try everything alone.
For real use, each person runs their own copy: see *Going live* at the end.

---

## Before you start

Put `entity-0.3.1.tar.gz` (the core) and `entity-modules-0.3.1.tar.gz` (the
optional modules) in `~/Downloads`. Unpack the modules once, beside where your
entities will live:

```sh
mkdir -p ~/entities && tar xzf ~/Downloads/entity-modules-0.3.1.tar.gz -C ~/entities
```

Then paste this into your terminal. It lasts for the terminal session.

```sh
entity() { node cli/index.js "$@"; }
export ENTITY_KEYS="$HOME/.entity/demo-keys"
new() { mkdir -p "$1" && tar xzf ~/Downloads/entity-0.3.1.tar.gz -C "$1" --strip-components=1 && cd "$1"; }
```

- `entity` runs the command line of whichever entity directory you are in.
- `ENTITY_KEYS` keeps these demo keys apart from any real ones.
- `new <dir>` makes a fresh entity directory from the core archive and enters it.
  Presets fetch the modules they need from `~/entities/entity-modules`.

To capture a proposal's id, every recipe pipes through
`sed -n 's/^proposal id //p'`.

---

## 1 · Worker cooperative

A bakery owned and run by the people who work in it. One member one vote;
new members admitted by decision; the pay ratio written into law.

```sh
new ~/entities/riverside-bakery
entity preset apply worker-coop
entity found --id ana --name "Riverside Bakery Cooperative"
entity join --id ben --name "Ben Okafor"
entity join --id cleo --name "Cleo Marsh"
entity settle
entity participants
```

Ben and Cleo are *applicants*. The founder admits them:

```sh
ID=$(entity act proposal.lay --as ana --title "Admit Ben and Cleo" --rule ordinary --admit '["ben","cleo"]' | sed -n 's/^proposal id //p')
entity act ballot.cast --as ana --proposal "$ID" --choice for --settle
entity participants
```

Write a statute and adopt it. Law needs an *organic* decision: a third must
vote and two thirds of the decisive votes must agree.

```sh
mkdir -p law/statutes
cat > law/statutes/pay-ratio.md <<'EOF'
# Pay ratio

The highest hourly rate the cooperative pays is at most three times the lowest.
EOF
DIGEST=$(entity gate digest law/statutes/pay-ratio.md)
ID=$(entity act proposal.lay --as ben --title "Pay ratio of 3:1" --rule organic \
  --paths '["law/statutes/pay-ratio.md"]' --digest "$DIGEST" | sed -n 's/^proposal id //p')
for m in ana ben cleo; do entity act ballot.cast --as $m --proposal "$ID" --choice for; done
entity settle
entity count "$ID"
entity gate law/statutes/pay-ratio.md --decision "$ID"
```

With three members, two votes for are not enough: 2 of 3 is 66.7%, under the
67% threshold. All three had to agree.

A member leaves. Nothing can prevent it.

```sh
entity act participant.leave --as cleo --settle
entity participants
entity verify
```

**Not yet:** surplus by patronage, capital accounts, shares on exit.

---

## 2 · Federation of cooperatives

Three cooperatives form a federation. Each sends a delegate; one delegate one
vote. The delegate's id names the cooperative they speak for.

```sh
new ~/entities/food-federation
entity preset apply federation
entity found --id riverside-bakery --name "Bay Food Cooperative Federation"
entity join --id greenleaf-grocery
entity join --id harbor-coffee
entity settle
ID=$(entity act proposal.lay --as riverside-bakery --title "Admit Greenleaf Grocery and Harbor Coffee" \
  --rule organic --admit '["greenleaf-grocery","harbor-coffee"]' | sed -n 's/^proposal id //p')
entity act ballot.cast --as riverside-bakery --proposal "$ID" --choice for --settle
entity participants
```

A joint purchasing agreement, adopted as federal law:

```sh
mkdir -p law/statutes
cat > law/statutes/joint-purchasing.md <<'EOF'
# Joint purchasing

Members buy flour, coffee and packaging together each quarter. Each member
states its quantities to the Federal Council two weeks before the order.
EOF
DIGEST=$(entity gate digest law/statutes/joint-purchasing.md)
ID=$(entity act proposal.lay --as greenleaf-grocery --title "Joint purchasing agreement" --rule organic \
  --paths '["law/statutes/joint-purchasing.md"]' --digest "$DIGEST" | sed -n 's/^proposal id //p')
for d in riverside-bakery greenleaf-grocery harbor-coffee; do entity act ballot.cast --as $d --proposal "$ID" --choice for; done
entity settle
entity count "$ID"
```

The bakery records, in its own entity, who its delegate is. This motion has no
effect in the software: it is the cooperative's own decision, on its own record.

```sh
cd ~/entities/riverside-bakery
ID=$(entity act proposal.lay --as ana --title "Ana is our delegate to the Bay Food Cooperative Federation" --rule ordinary | sed -n 's/^proposal id //p')
for m in ana ben; do entity act ballot.cast --as $m --proposal "$ID" --choice for; done
entity settle
entity count "$ID"
```

**Not yet:** votes weighted by each cooperative's size; the federation reading
its members' records directly. Today the link between them is the delegate.

---

## 3 · Housing cooperative

Residents own and govern their building together. New residents are admitted by
the General Meeting; house rules are statutes; a resident who moves out leaves.

```sh
new ~/entities/maple-street
entity preset apply housing-coop
entity found --id rosa --name "Maple Street Housing Co-op"
for r in sam tariq uma; do entity join --id $r; done
entity settle
ID=$(entity act proposal.lay --as rosa --title "Admit the founding residents" --rule ordinary \
  --admit '["sam","tariq","uma"]' | sed -n 's/^proposal id //p')
entity act ballot.cast --as rosa --proposal "$ID" --choice for --settle
entity participants
```

House rules:

```sh
mkdir -p law/statutes
cat > law/statutes/quiet-hours.md <<'EOF'
# Quiet hours

Quiet hours are 22:00 to 07:00 every day. Shared spaces close at 23:00.
EOF
DIGEST=$(entity gate digest law/statutes/quiet-hours.md)
ID=$(entity act proposal.lay --as sam --title "Quiet hours" --rule organic \
  --paths '["law/statutes/quiet-hours.md"]' --digest "$DIGEST" | sed -n 's/^proposal id //p')
for r in rosa sam tariq; do entity act ballot.cast --as $r --proposal "$ID" --choice for; done
entity act ballot.cast --as uma --proposal "$ID" --choice against
entity settle
entity count "$ID"
```

Three votes for already decided it, so the motion closed. Uma's vote arrived
after that. It is recorded, and `count` lists it as *cast after close*.

Uma moves out, and the Meeting gives motions ten days instead of fourteen:

```sh
entity act participant.leave --as uma --settle
ID=$(entity act proposal.lay --as tariq --title "Ten-day motions" --rule organic \
  --changes '{"deliberation.period":10}' | sed -n 's/^proposal id //p')
for r in rosa sam tariq; do entity act ballot.cast --as $r --proposal "$ID" --choice for; done
entity settle
entity params deliberation.period
```

Give residents the page, so they can vote from a browser:

```sh
# Runs until you stop it (Ctrl-C). Then open http://localhost:7780
entity serve --settle
```

**Not yet:** rent, member shares, deposits returned on leaving.

---

## 4 · Micronation

Anyone may become a citizen. Citizens choose their names. The constitution
changes only by two readings a month apart.

```sh
new ~/entities/tidewater
entity preset apply micronation
entity found --id mara --name "Republic of Tidewater"
for c in nico oli pia; do entity join --id $c; done
entity settle
entity act title.set --as mara --title "Mara of the Dunes" --settle
entity act title.set --as nico --title "Nico the Cartographer" --settle
entity participants
```

Renaming the republic is constitutional. First reading:

```sh
ID=$(entity act proposal.lay --as nico --title "Become the Free Republic of Tidewater" --rule constitutional \
  --changes '{"entity.name":"Free Republic of Tidewater"}' | sed -n 's/^proposal id //p')
for c in mara nico oli pia; do entity act ballot.cast --as $c --proposal "$ID" --choice for; done
entity settle
entity count "$ID"
echo "First reading: $ID"
```

It carried, and waits for its second reading. Write down the id it printed.

```sh
# Later: at least 30 days after the first reading closed.
FIRST=d-xxxxxxxxxxxx   # the id printed above
ID=$(entity act proposal.lay --as nico --title "Become the Free Republic of Tidewater" --rule constitutional \
  --changes '{"entity.name":"Free Republic of Tidewater"}' --reading_of "$FIRST" | sed -n 's/^proposal id //p')
for c in mara nico oli pia; do entity act ballot.cast --as $c --proposal "$ID" --choice for; done
entity settle
```

The second reading must carry exactly the same change, or it is refused.

Renouncing citizenship:

```sh
entity act participant.leave --as pia --settle
```

Publish the republic so it lives on without any server:

```sh
# Needs Radicle: rad auth, then rad node start.
entity radicle init
```

---

## 5 · Private company

Three partners run a studio. One partner one vote; admitting a partner needs two
thirds; every checkpoint needs two partners' signatures.

```sh
new ~/entities/northwind-studio
entity preset apply company
entity found --id ines --name "Northwind Studio"
entity join --id jon
entity join --id kai
entity settle
ID=$(entity act proposal.lay --as ines --title "Admit Jon and Kai as partners" --rule organic \
  --admit '["jon","kai"]' | sed -n 's/^proposal id //p')
entity act ballot.cast --as ines --proposal "$ID" --choice for --settle
```

An ordinary resolution. A simple majority decides it:

```sh
ID=$(entity act proposal.lay --as jon --title "Hire a part-time bookkeeper" --rule ordinary \
  --text "Up to ten hours a week, starting next month." | sed -n 's/^proposal id //p')
for p in ines jon; do entity act ballot.cast --as $p --proposal "$ID" --choice for; done
entity settle
entity count "$ID"
```

The partnership agreement becomes a statute, which needs an organic decision.
(The charter itself changes only by a constitutional one.)

```sh
mkdir -p law/statutes
cat > law/statutes/partnership.md <<'EOF'
# Partnership agreement

Profits are shared equally among partners. A partner who leaves is paid their
share of the last closed year within ninety days.
EOF
DIGEST=$(entity gate digest law/statutes/partnership.md)
ID=$(entity act proposal.lay --as kai --title "Partnership agreement" --rule organic \
  --paths '["law/statutes/partnership.md"]' --digest "$DIGEST" | sed -n 's/^proposal id //p')
for p in ines jon kai; do entity act ballot.cast --as $p --proposal "$ID" --choice for; done
entity settle
```

An audit trail anyone can check:

```sh
entity attest --as ines
entity checkpoint make --as ines
entity checkpoint sign --as jon
entity bundle --out northwind-audit.bundle.json
entity verify --json > northwind-audit.json
entity verify
```

Hand an auditor the bundle. They check it with no access to your systems:
`entity clone northwind-audit.bundle.json audit-copy && cd audit-copy && entity verify`.

This keeps the partners' decisions verifiable. It does **not** register a legal
company.

**Not yet:** shares, equity, dividends, roles.

---

## 6 · Online fandom

An open fan community. Anyone may join and pick a handle. Votes run three days,
and a tenth of members is enough.

```sh
new ~/entities/starlight-archive
entity preset apply fandom
entity found --id quill --name "The Starlight Archive"
for f in river sol tam ula; do entity join --id $f; done
entity settle
entity act title.set --as quill --title "Quill" --settle
entity act title.set --as river --title "Quill" --settle
entity act title.set --as river --title "RiverRuns" --settle
entity participants
```

River's first handle is refused: "Quill" is taken.

Community rules, adopted as law:

```sh
mkdir -p law/statutes
cat > law/statutes/community-rules.md <<'EOF'
# Community rules

1. Spoilers go behind a spoiler tag for two weeks after an episode airs.
2. No harassment. Moderators may hide posts; members may appeal to a Community Vote.
EOF
DIGEST=$(entity gate digest law/statutes/community-rules.md)
ID=$(entity act proposal.lay --as sol --title "Community rules" --rule organic \
  --paths '["law/statutes/community-rules.md"]' --digest "$DIGEST" | sed -n 's/^proposal id //p')
for f in quill river sol tam; do entity act ballot.cast --as $f --proposal "$ID" --choice for; done
entity settle
entity count "$ID"
```

A yes-or-no community vote:

```sh
ID=$(entity act proposal.lay --as tam --title "Rewatch season two together in March" --rule ordinary | sed -n 's/^proposal id //p')
for f in tam ula river; do entity act ballot.cast --as $f --proposal "$ID" --choice for; done
entity settle
entity count "$ID"
```

Put the community's page online. Build a static copy for any HTTPS host:

```sh
entity build --out site
```

```sh
# Runs until you stop it (Ctrl-C). For members to vote from their browsers,
# put this behind HTTPS (a reverse proxy) or use Radicle.
entity serve --settle --host 0.0.0.0
```

**Not yet:** polls with more than two options; moderator roles.

---

## Any project

```sh
entity status                         # what this copy holds
entity verify                         # chain, replay, parameters, attestations, checkpoints
entity params                         # every value and the rule to change it
entity attest --as quill              # sign what you hold, as yourself
entity checkpoint status
entity bundle --out backup.bundle.json
```

Carry a copy on a USB stick:

```sh
# Needs a stick mounted at /media/stick; edit node.json to add it:
#   { "destinations": [ { "name": "stick", "class": "dir", "path": "/media/stick" } ] }
entity sync --settle
```

Back up your key. It is outside the entity directory, in `$ENTITY_KEYS/<entity id>/`.

---

## Going live

In real use every person has their own copy and their own key. Leave
`ENTITY_KEYS` unset: keys then live in `~/.entity/keys`.

**With Radicle** (no server at all):

```sh
# Needs Radicle. Each person, once:
rad auth
rad node start
# The founder:
entity found --id ana --radicle
entity radicle init                   # prints rad:z…
# Everyone else:
entity clone rad:z… my-copy && cd my-copy
entity join --id ben --radicle
entity sync
# From then on, everyone:
entity sync --settle
```

**With a server:** one person runs `entity serve --settle` behind HTTPS.
Everyone else opens the page in a browser, makes a key there, and takes part.

**With nothing but files:** `entity bundle`, carry the file, `entity absorb <file> --settle`.

---

`docs/MANUAL.md` covers every command. Read `docs/GUARANTEES.md` before relying
on any of this.
