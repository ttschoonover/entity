# entity

A verifiable collective entity in one directory. Copy the directory and you have
copied its law, membership, history, code, and the means to verify all of it.

No dependencies. Node 20+ for the command line; any modern browser for participants.
Optionally [Radicle](https://radicle.xyz): the whole directory then replicates
peer to peer, with no server — code, law and record together.

```
entity found          bring it into being
entity act <kind>     do something, signed
entity settle         fold pending acts into the record
entity verify         check it, offline, needing nobody
entity sync           push and pull everywhere at once
entity fork           leave together: a new entity naming this one as its parent
```

Run `node cli/index.js help` for the full list, or link it: `npm link`.

## Five minutes

```sh
entity preset list
entity preset apply assembly
entity found --id p-0001 --name "The Commons"      # key saved under ~/.entity/keys, never in here
entity join --id p-0002                             # another person, their own key
entity settle
entity propose --title "Two weeks" --changes '{"deliberation.period":14}'   # picks the rule it needs
entity act ballot.cast --proposal d-… --choice for --as p-0001
entity settle
entity count d-…
entity attest                                       # say what you hold
entity verify
entity serve --settle                               # the page, at http://localhost:7780
```

A participant needs only the page. It fetches the record, replays every signed
act itself, remembers what it saw, makes and keeps their key, and signs locally.
It sends in three ways, in this order: their own node, a peer's, a file.

## Who decides

By default every member has one vote. `decision.electorate` changes that: the
founder alone, one member, an office's holders, a committee, the holders of a
unit weighted by balance, or nobody at all (a frozen entity). Offices and
committees can also be granted specific powers to use without a vote, within
written limits (the authority module). The members can remove a member or give
one a new key by decision. See docs/MODULES.md and docs/CHANGELOG.md.

## What `verify` actually checks

1. **Chain** — every record's hash and link.
2. **Replay** — every act in the record is re-verified and re-settled from
   nothing; the output must reproduce the record byte for byte. A record that
   passes is one anyone can reproduce from its acts alone.
3. **Parameters** — `parameters.yml` is exactly what the record dictates.
4. **Attestations** — participants' signed statements of what they hold, compared
   by prefix root, so a rewritten history is told apart from a lagging one.
5. **Checkpoints** — binding only with enough co-signers, and never contradicted.

## On Radicle

Radicle carries; the entity decides. The directory is a Radicle repository and
each participant pushes to their own namespace. `sync` reads every peer's record
out of their branch and absorbs it only if it verifies and attestations agree.
Code and law move only by `entity adopt`, which takes a peer's files if a carried
decision approved exactly those bytes. A participant who joins with their Radicle
key is found on the network from the register alone: their Node ID is derived
from the key.

Replay alone cannot catch a history rewritten perfectly — one record removed and
the rest re-chained. Attestations, checkpoints and the browser's memory can, and
the tests prove it (acceptance test 7; and in a real browser, see below).

## Layout

```
kernel/        canonical, hash, keys (Ed25519 + SSHSIG), record, settle, verify,
               attest, checkpoint, repair, parameters, effects, gate, transport — pure,
               the same files in node and browser. store.js is the only disk access.
modules/       deliberation (proposals, ballots, counting): the only module in the core,
               plus any module this entity installs by decision
library/       the optional module pack (titles, vocabulary, offices, value, deeds,
               threads, committees, authority, polls, badges, elections, lending, wiki,
               finality, shares, budget, meetings, tasks, passwords, passkeys, fund, agreements), published separately as the
               entity-modules repository and fetched when installed;
               see docs/MODULES.md
library.yml    where modules are published (its "from" line), and exceptions
interface/     index.html + static js; build.js copies, never generates
cli/           the commands; transports/ holds file, dir, http and radicle classes
law/           charter/, statutes/, judgments/ — governed by the gate
presets/       assembly, society, company, proprietor, currency, and more
record/        events.jsonl, attestations/, checkpoints/      ← state
participants/  derived from the record; public keys, allowed_signers   ← state
pending/ settled/ refused/   acts in transit; refused ones keep their reason
parameters.yml every settable value, rebuilt from the record at each settlement
```

## Tests

`npm test` — 131 tests: the 23 acceptance tests of the specification, numbered as
there; kernel and lifecycle tests; each module's own; and a
two-peer run on a real Radicle network (skipped when Radicle is not installed). Signature
interop with `ssh-keygen` runs when it is installed. `test/vectors.json` holds
canonical-serialisation, SHA-256 and Merkle vectors any other implementation
must reproduce.

`test/browser/e2e.py` drives the real page in Chromium against `entity serve`:
every tab drawn, a key made in-page and locked with a password, application,
proposal and ballot signed locally and settled, the proposal's, a member's and a
record's pages opened by address, then a perfect rewrite of the server's record
— which the page catches.

`docs/COOKBOOK.md` builds six real projects step by step; `docs/HARDWARE.md` adds LEDs and a live counter on a Raspberry Pi; `docs/MANUAL.md` covers setup and use. Read `docs/GUARANTEES.md` before relying on any of this.
