# Manual

## The control panel: no terminal needed

Everything in this manual can also be done from a page on your own computer:

    node cli/index.js app

It prints a link (http://127.0.0.1:7700/?t=…) and opens it. **Create a
republic** walks you through it: its name and folder, your member id and
password, a starting preset, the modules you want, any settings you want to
change, its look and the port to serve it on. It then founds the republic and
serves its page. **Manage** runs it afterwards: start and stop serving, change
settings (as proposals), install modules, set a password, publish it on
Radicle, sync, upgrade, verify, and run any other command.

The panel answers only on this computer, and only through the link it prints;
nothing reaches it through a tunnel or from other websites. Each operation runs
the same `entity` command you would type, so the terminal and the panel always
agree.

## Private republics

A republic without the page module can serve its own website: put the files
in a folder inside the republic and name it in node.json, `"site": "website"`.
Its `index.html` is served at `/`; the page reads the republic through
`window.js` (see docs/WINDOWS.md, and `sites/vdr` for a full example).

With `"private": true` in node.json (or "Private" in the control panel's
settings for this computer), the republic's address shows only a sign-in page.
Members sign in with their own account; candidates can apply there, and read
and sign what membership requires, but see nothing else until admitted. The
gate covers the network; for contents that must stay secret even inside a copy,
use sealed posts.

## Showing a republic on another website

A co-op with its own website can show its republic there: its seal, officers,
open votes, money in circulation, and buttons to vote or join, each verified in
the visitor's browser. See docs/WINDOWS.md. A republic without the `page`
module lives entirely in such windows.

## 1 · Requirements

- Node.js 20 or later.
- For participants: any current browser.
- Optional: `ssh-keygen`, to check signatures with tools this project did not write.
- Optional: Radicle (`rad`, `radicle-node`, `git-remote-rad`) and git 2.34+, to replicate peer to peer. See §7.

Nothing else. There are no packages to install.

## 2 · Install

```sh
tar xzf entity-0.1.0.tar.gz
cd entity-0.1.0
npm test                 # 43 tests; all should pass
npm link                 # optional: puts `entity` on your PATH
```

Without `npm link`, use `node cli/index.js` wherever this manual says `entity`.

This directory becomes the entity. Keep one directory per entity.

## 3 · Found

```sh
entity preset list                   # assembly · society · worker-coop
entity preset apply assembly         # writes parameters.yml
entity found --id p-0001 --name "The Commons"
```

Your private key is saved in `~/.entity/keys/<entity-id>/`, never inside the
entity directory. Back it up. Set `ENTITY_KEYS` to keep keys elsewhere.

Until a second person joins or a decision is made, you alone may re-apply a
preset. After that, every value belongs to the membership.

## 4 · Everyday use

Every change is a signed act. Acts wait in `pending/` until settled.

```sh
entity join --id p-0002              # a new person, with a new key
entity settle                        # fold pending acts into the record
entity verify                        # check everything, offline
entity status                        # what this copy holds
```

When several keys live on one machine, say who is acting: `--as p-0002`.

### Deciding

```sh
entity act proposal.lay --title "Two-week deliberation" --rule organic \
  --changes '{"deliberation.period":14}'          # prints the proposal id
entity act ballot.cast --proposal d-… --choice for        # for · against · abstain
entity settle
entity count d-…
```

A proposal closes early once its outcome cannot change; otherwise at its
deadline, when anyone sends `entity act proposal.close --proposal d-…`.
If it carries, its changes take effect on settlement.

`entity params` lists every value and the rule needed to change it. A proposal
citing too weak a rule is refused, and the refusal names the rule required.
`entity propose --title … --effects '[…]' --changes '{…}'` picks the least rule
its contents need for you.

Who votes is `decision.electorate`: every member by default, or the founder
alone, one member, an office, a committee, the holders of a unit weighted by
their balance, or nobody (a frozen entity). `entity status` says who decides
now. See docs/MODULES.md, *Who decides*.

### Members: admitting, removing, recovering

```sh
entity propose --as ana --title "Admit cleo" --effects '[{"kind":"participant.admit","id":"cleo"}]'
entity propose --as ana --title "Remove dan" --effects '[{"kind":"participant.remove","id":"dan","reason":"…"}]'
entity propose --as ana --title "New key for eve" \
  --effects '[{"kind":"participant.rekey","id":"eve","key":"ssh-ed25519 AAAA…","reason":"phone lost"}]'
```

Each is an ordinary decision by default (`membership.admission_rule`,
`membership.removal_rule`, `membership.recovery_rule`). A removed member's past
acts stay in the record; they can no longer act, are on no future roll, and may
apply again under a new id with a new key. The last active member cannot be
removed. A recovery replaces every key the member holds: confirm with them
before voting for one, since it could be used to act as them.

### All acts

| Kind | How | Fields |
|---|---|---|
| `participant.apply` | `entity join` | `--id`, `--name` |
| `participant.leave` | `entity act participant.leave` | — |
| `participant.key` | `entity key rotate` | — |
| `title.set` | `entity act title.set` | `--title` |
| `proposal.lay` | `entity act proposal.lay` | `--title --rule`, then any of `--text`, `--changes '{…}'`, `--admit '["id"]'`, `--paths '[…]' --digest …`, `--reading_of d-…` |
| `ballot.cast` | `entity act ballot.cast` | `--proposal --choice` |
| `proposal.close` | `entity act proposal.close` | `--proposal` |
| `proposal.lay` with effects | `entity propose` | `--title`, `--effects '[…]'`, `--changes '{…}'`, optional `--rule` |

Add `--settle` to any `act` to settle at once, or `--out file.json` to sign
without recording, for carrying elsewhere.

### Corroborating

Verification proves the record is internally sound. Corroboration proves it is
the same record others hold. Do both.

```sh
entity attest                        # sign what you hold
entity checkpoint make               # a signed position…
entity checkpoint sign --as p-0002   # …binding once enough co-sign (default 2)
```

## 4½ · Changing your mind

- **Edit** anything after it is made with the Edit form beside it (titles,
  seats, terms, a grant's powers, a meeting's time before it starts): it
  proposes the change under the rule that created it.
- **Reverse** a decision from its page, with *Propose reversing this*: a new
  decision that sets its settings back and undoes what can be undone.
- **Remove** a member from their page, by decision, with a reason.

## 5 · Participants in a browser

```sh
entity serve --settle                # http://localhost:7780
```

The page checks the record itself, remembers what it has seen, makes and keeps
the participant's key in the browser, and signs there. `--settle` records acts
as they arrive.

Every view has its own address, so it can be linked and bookmarked:

| Address | What it shows |
|---|---|
| `#/` | the seal, your membership and key, what needs your vote, applications waiting |
| `#/votes`, `#/votes/d-…` | every proposal, filtered; one proposal with its roll, every ballot, rejections and readings |
| `#/members`, `#/members/ID` | the register and applications; one member: status, keys, offices, acts, removal or recovery |
| `#/record`, `#/record/N` | the record, paged; one record with its act, signature and links |
| `#/law` | the charter and statutes, each with the decisions that approved it |
| `#/settings`, `#/settings/KEY` | every setting, its rule, whether it is a default, and its history |
| `#/offices`, `#/committees`, `#/authority`, … | tabs of enabled modules |

**A password on the key.** When joining, or later from *Your key*, a
participant can lock the key with a password. It is then stored encrypted in
the browser and the page asks for the password each time it signs. The password
cannot be recovered: *Save a copy of my key* is still the backup. A stolen
laptop no longer gives the key away, unless the password is guessed.

To let others reach it, put it behind HTTPS: browsers disable the cryptography
on plain HTTP. Or publish a static copy:

```sh
entity build --out site              # upload site/ to any HTTPS host, any folder
```

A static copy is read-only; participants send acts to a node, or save them as files.

## 6 · Keeping copies in step

List destinations in `node.json`:

```json
{ "destinations": [
    { "name": "stick", "class": "dir",  "path": "/media/usb/entity" },
    { "name": "hub",   "class": "http", "url": "https://example.org/entity/" } ] }
```

```sh
entity sync --settle                 # pull from each, settle, push to each
```

Unreachable destinations are reported and skipped. A copy that disagrees is
refused, never merged silently.

Without any network:

```sh
entity bundle --out today.bundle.json    # carry this file
entity absorb today.bundle.json --settle # on the other copy
entity clone today.bundle.json ../copy   # a new copy from any holder
```

## 7 · On Radicle

The whole directory replicates peer to peer. Each person pushes to their own
namespace; `sync` reads everyone's.

**Once per person**

```sh
rad auth                    # an empty passphrase lets this key double as your entity key
rad node start
```

**Publish** (the founder)

```sh
entity found --id p-0001 --radicle   # found with your Radicle key
entity radicle init                  # prints the repository ID, rad:z…
```

**Join** (everyone else)

```sh
entity clone rad:z… my-copy && cd my-copy
entity join --id p-0002 --radicle
entity sync
```

**Everyday**

```sh
entity sync --settle        # fetch every peer, settle, publish
entity radicle status       # the repository, and each participant's Node ID
```

Acts settle once `settleAfter` seconds old (600 by default, in `node.json`),
so they reach every peer first. Every settlement is published to Radicle at once
(`publishOnSettle` in `node.json`); `sync` is still how you receive others' work.

**If `sync` says DIVERGED**, two copies settled at once. Nothing was taken in.
Merge on purpose:

```sh
entity repair --merge .entity/incoming --resettle --write
entity sync
```

## 8 · Changing the code or the law

Files under `kernel/`, `modules/`, `interface/`, `cli/` and `law/` change only
by decision.

```sh
entity gate digest law/statutes/d-new.md             # 1 · fingerprint the change
entity act proposal.lay --title "New statute" --rule organic \
  --paths '["law/statutes/d-new.md"]' --digest <digest>   # 2 · decide on it
entity gate --against ../approved-copy --decision d-…    # 3 · check before merging
```

The gate counts the ballots itself. Run step 3 in your repository's pre-receive hook.

On Radicle, draft the change in your copy and `entity sync`: it appears in your
namespace. Others take it only once decided:

```sh
entity adopt p-0002         # refused, printing the exact proposal to make
                            # …lay it, vote, settle…
entity adopt p-0002         # adopted; `entity sync` publishes it
```

## 8¼ · Upgrading the core

```sh
entity upgrade check dir:~/entities/entity          # or github:you/entity@main
entity upgrade propose dir:~/entities/entity --as ana
# … the members vote …
entity upgrade apply
```

`check` fetches the version into `.staged/core`, replays this entity's record
with it (it must reproduce every record exactly), and lists what changes.
`propose` lays a proposal approving exactly those files, by their digest.
`apply` installs them only when a carried decision approves that digest, and
refuses if the staged files or this copy's code changed since the check. The
entity's law, its installed modules and its record are never touched; upgrade
modules afterwards with `entity module upgrade`. Restart any running
`entity serve`.

To do this from the page, set the source in node.json:

```json
{ "port": 7780, "upgrade": { "source": "dir:~/entities/entity" } }
```

Settings → *The code* then offers to check for a new version, to propose it,
and, once the proposal carries, to install it on the node.

**Checkpoints** can be made and co-signed from the Record tab: the page signs
with the key in the browser and sends the signature to the node, which keeps it
only if it matches the node's own record.

## 8½ · Forking

When a group cannot change the entity, it can always take a copy and go. A fork
is a **new entity that names its parent**:

```sh
entity fork --name "The Commons (East)" --out ../commons-east --as ana
entity fork --name "Coin Classic" --out ../classic --as ana --carry value --at 1200
```

- It starts from the parent's parameters and modules as they stood at the fork
  point (`--at N`, the latest record by default). `--electorate` changes who
  decides in the fork, for when the parent's electorate would be nobody there.
- **Members are not carried over.** Each joins by signing in the fork. The
  parent's members at the fork point keep their ids, claimable only with a key
  they held in the parent (`entity join --id ana` finds it). Their signatures in
  the parent cannot be replayed in the fork: every act names its entity.
- `--carry value,deeds` takes over module state as it stood: balances, deeds, a
  cap table. Leave it out and the fork starts empty.
- The fork keeps the parent's records up to the fork point in
  `parent/events.jsonl`, and `entity verify` checks the fork against them: the
  history, the members reserved, and anything carried. The page says where the
  entity came from.
- Nothing is recorded in the parent. Forking is exit, and exit cannot be
  prevented.

## 9 · When something is wrong

| You see | Do |
|---|---|
| `verify` fails on **parameters** | `entity settle` rewrites the file from the record. |
| `verify` fails on **chain** or **replay** | `entity diagnose`. Do not act on this copy. |
| Conflict markers after concurrent edits | `entity repair`, then `entity repair --write`. |
| **attestations: diverged** | Someone holds a different history. Compare copies before acting. |
| The page says **the record has changed behind you** | The server's copy lost or altered records you saw. Do not act on it. |
| An act was **refused** | The reason is inside its file in `refused/`. Fix it, then sign again. |
| "dated before the head of the record" | The act was signed too long ago. Sign it again. |
| `sync` says **DIVERGED** | See §7. |
| An act waits for the settlement window | Normal: it settles once `settleAfter` seconds old. |

## 10 · Reference

```
--dir <path>     the entity directory (default: current)
--as <id>        who is acting
--key <file>     a private key file (OpenSSH format)
--radicle        use your Radicle key (found, join)

ENTITY_DIR       default for --dir
ENTITY_AS        default for --as
ENTITY_KEYS      where private keys are kept (default ~/.entity/keys)
RAD_HOME         the Radicle profile to use (default ~/.radicle)
ENTITY_MODULES   where the module pack is, if not ../entity-modules
```

`entity help` lists every command. `docs/COOKBOOK.md` walks through six complete projects. `docs/GUARANTEES.md` says what is and is not
protected; read it before relying on any of this.
