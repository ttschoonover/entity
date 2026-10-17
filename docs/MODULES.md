# Modules

A module adds kinds of acts, decisions and settings. The core holds only the
kernel and **deliberation**. Every other module is optional: an entity that never
installs one never has its code.

Modules come from outside (GitHub, Radicle, any git repository, the module pack),
but an entity never depends on where they came from: a decision approves the
exact code, by digest, and every copy then keeps its own copy of that code.

| Module | What it does | Decided by the Assembly | Done by members themselves |
|---|---|---|---|
| deliberation | proposals and votes (always on) | — | lay, vote, close |
| titles | the name others see | — | choose a name |
| vocabulary | what the entity calls its things | — | — |
| **offices** | named offices with seats and terms | create, appoint, remove, abolish | resign |
| **value** | a unit of account: points, credits, hours | issue, revoke | send, retire your own |
| **deeds** | a register of things and who holds them | register, reassign, retire | pass on, give back |
| **threads** | boards (members may start them), posts, replies, votes | hide a post | start a board, post, reply, vote, edit, delete |
| **committees** | bodies of members inside the entity | create, appoint, remove, dissolve | leave |
| **authority** | powers granted to an office or committee | grant, revoke | use a grant, co-sign a use |
| **polls** | ask the members something; decides nothing | — | open, answer, close your own |
| **badges** | marks of recognition shown on members | create, award, revoke, retire | give back your own |
| **elections** | fill an office by vote | call an election | stand, withdraw, vote, count |
| **lending** | lend what the entity holds | recall a loan | borrow, renew, return |
| **parties** | political parties: membership, leaders, platforms, party electorates, seat allocation | | |
| **federation** | a federation of separate state entities: citizenship, senate, assembly, secession by decision | | |
| **chat** | channels of messages kept by the node, never on the record | | |
| **laws** | a relational legal system: typed, tagged laws naming who enforces them and on whom; Parliament and referendum | enact, amend, repeal, ratify (referendum) | lay a bill, vote, close, petition, promulgate (Parliament) |
| **twofactor** | email codes at sign-in, enforced by the node; addresses never on the record | require it of officers or everyone | turn it on or off (node) |
| **things** | a library of things members lend each other against cash deposits; a solidarity fund that covers deposits | add, keep or retire a shared thing; declare a loss; settle a dispute; record a claim paid | list, request, lend, renew, return (keeping part of a deposit), dispute |
| **wiki** | pages any member writes, by category; statutes by decision | enact a version, repeal | edit |
| **finality** | checkpoints that decide, signed by validators; penalties for cheating | re-anchor signing | sign a checkpoint, submit evidence |
| **shares** | share classes, a cap table, dividends, voting by shares | create a class, issue, redeem, pay a dividend | transfer (if the class allows) |
| **budget** | money approved by the members, and what is spent from it | approve, adjust or close a line; record spending | — |
| **meetings** | meetings, agendas, attendance, minutes | call or cancel a meeting; approve minutes | check in, draft minutes |
| **tasks** | chores, shifts and jobs; hours tallied, optionally paid | — | post, claim, give back, mark done, verify, withdraw |
| **passwords** | sign in with a username and password | — | set, change or remove your password |
| **passkeys** | sign in with Face ID, Touch ID, a fingerprint or a security key | — | add, name or remove a passkey |
| **agreements** | documents members sign, required for admission | require documents; how amendments bind | sign |
| **fund** | an investment club's books: capital in units, holdings, trades the members voted for | authorize a purchase or sale; record payments in, trades, prices, income, expenses (usually a treasurer's grant); withdrawals | — |

## Where modules live

Modules are published in a git repository, usually on GitHub (`entity-modules`,
one folder per module), and fetched only when an entity installs one. Say
where, once per entity:

```sh
entity module source github:YOU/entity-modules@main
entity module available
```

`available` lists what the repository offers, without installing anything.
`entity module add NAME` then fetches `NAME/` from it. The branch is pinned to
the commit it points at that moment, and the proposal records that commit: what
members vote on is exactly one version, and every other copy later fetches that
same commit and checks its digest. A module named in `library.yml`'s `modules`
comes from where it says instead. With no source set, modules come from a pack
on this computer (`../entity-modules`, or `library/` in this installation),
which is for development.

## Installing one

```sh
entity module add value --as ana                                   # by name, from library.yml
entity module add github:you/entity-modules/value@3f2a9c1 --as ana # or from any source
```

This fetches the code into `.staged/value/` for you to read, computes its
**digest** (a fingerprint of every file), and lays a proposal carrying the source
and the digest. It needs the rule that governs
`entity.modules` (organic by default). **Read the code before voting:** a module
runs in every settlement and in every member's browser.

When the decision carries, every copy — on its next `settle` or `sync` — fetches
the code, checks it against the digest, and installs it into `modules/value/`.
Code that does not match is never installed.

| Source | Means |
|---|---|
| `github:OWNER/REPO/SUBDIR@COMMIT` | a GitHub repository at an exact commit |
| `rad:RID/SUBDIR@COMMIT` | a Radicle repository at an exact commit |
| `git:URL#SUBDIR@COMMIT` | any git repository |
| `dir:PATH` | a local directory |
| `pack:NAME` | the module pack beside this entity (`../entity-modules/NAME`) |

A branch name is not accepted: a source must name a commit. The digest is what is
trusted; the source is only where to look for those bytes. `library.yml` maps
names to sources, for presets and for `entity module add NAME`.

## While a copy lacks a module's code

A copy that lacks the code of any module its entity uses **settles nothing**, since
it could reach a different result from copies that have it. Its acts wait in
`pending/`; none is refused. `entity settle` says which module is missing, and

```sh
entity module fetch      # fetch and check everything the record requires
entity module list       # each module: on or off, and whether its code matches
```

brings it up to date.

## Upgrading one

```sh
entity module upgrade offices --as ana                    # from library.yml, or give a source
entity module upgrade offices github:you/entity-modules/offices@9c0ffee --as ana
```

This fetches the new code into `.staged/`, then **replays the entity's whole
record with it**. The new code must reproduce every record exactly: from then on
every copy replays history with it, so code that would judge the past
differently is refused before anything is signed. If it replays, a proposal is
laid carrying the new source and digest, under the rule for `entity.modules`.
Read the difference (`diff -r modules/offices .staged/offices`) before voting.
When it carries, every copy fetches the new code, checks its digest and replaces
the old; the record keeps each earlier digest (Settings → Modules).

## Switching one on or off

A module installed once stays installed: its code may be needed to replay the
record. Switching it on or off later is an ordinary decision:

```sh
entity module disable threads --as ana
entity module enable threads --as ana
```

On the page: **Lay a proposal → What it changes → entity.modules**, and tick or
untick. Installing a new module is done from the command line, so its code can be
reviewed.

## Settings and their defaults

A module's settings, with their defaults, are part of its code: its
`parameters.yml`, covered by the same digest. An entity records only the values
it chooses. Until it chooses one, the setting stands at the default of the code
it installed; the page marks it *default*. A proposal can switch a module on and
set its settings in one go:

```sh
entity propose --as ana --title "Offices, two terms at most" \
  --changes '{"entity.modules":["deliberation","titles","vocabulary","offices"],"offices.term_limit":2}'
```

A new default arrives only with new code, which is a new decision.

## Who decides: the electorate

`decision.electorate` names who votes on proposals. It changes under the
entrenched rule (by default two readings, thirty days apart).

| Value | Who votes | Module |
|---|---|---|
| `members` | every active member, one vote each (the default) | core |
| `founder` | the founder alone | core |
| `member:ID` | one named member alone | core |
| `none` | nobody: the entity is **frozen**, and nothing can be decided again | core |
| `office:ID` | the office's current holders, one vote each | offices |
| `committee:ID` | the committee's members, one vote each | committees |
| `value` | holders of the unit, one vote per smallest unit held | value |

Anyone active may still lay a proposal; only those on its roll count. The roll
and its weights are taken from the record when the proposal is laid, and fixed
for its life. Quorum and threshold are fractions of the weight on the roll, so
with `value` they are fractions of the units.

A decision may not leave the electorate empty (it may choose `none`), and an
entity cannot be founded with an electorate nobody is on. A module adds an
electorate with `registry.registerElectorate({ name, module, describe, check, roll })`.

## Deciding with a module

Module decisions are *effects* carried by a proposal. The page's module sections
lay them for you. From the command line:

```sh
entity act proposal.lay --as ana --title "A treasurer" --rule organic --effects '[
  {"kind":"office.create","office":"treasurer","title":"Treasurer","seats":1,"term_days":365},
  {"kind":"office.fill","office":"treasurer","holder":"ben"}]'
```

Effects run in order, so one decision can create an office and fill it, or switch
an installed module back on and use it. A decision that *installs* a module cannot
also use it; decide its effects once the code is in place. Each effect needs the rule its module names (for example
`value.issue_rule`); the proposal needs the strictest of them.

| Effect | Fields |
|---|---|
| `participant.admit` | `id` (an applicant); rule `membership.admission_rule` |
| `participant.remove` | `id`, `reason` (published); rule `membership.removal_rule` |
| `participant.rekey` | `id`, `key` (their new public key), `reason`; rule `membership.recovery_rule` |
| `office.create` | `office`, `title`, `seats`, optional `term_days` |
| `office.fill` / `office.vacate` | `office`, `holder` |
| `office.abolish` | `office` |
| `value.issue` | `to`, `amount` (whole number of the smallest unit), optional `memo` |
| `value.revoke` | `from`, `amount`, optional `memo` |
| `deed.grant` | `deed`, `title`, optional `description`, `to` (an id, or null for the entity), optional `transferable` |
| `deed.assign` | `deed`, `to`, optional `transferable` |
| `deed.retire` | `deed`, optional `reason` |
| `thread.hide` | `target`, optional `reason` |
| `committee.create` | `committee`, `title`, optional `seats`, `needs` (`majority`, `all` or a number), `remit` |
| `committee.appoint` / `committee.remove` | `committee`, `member` |
| `committee.dissolve` | `committee` |
| `authority.grant` | `grant`, `to` (`{office}` or `{committee}`), `may`, optional `where`, `limit`, `needs`, `delegable`, `note` |
| `authority.revoke` | `grant`, optional `reason` |
| `badge.create` | `badge`, `title`, optional `description` |
| `badge.award` | `badge`, `to`, optional `note` |
| `badge.revoke` | `badge`, `from`, optional `reason` |
| `badge.retire` | `badge` |
| `loan.recall` | `deed`, `reason` |
| `wiki.enact` | `page`, `version` (enacting a later version amends the statute) |
| `wiki.repeal` | `page`, optional `reason` |
| `election.call` | `election`, `office`, optional `seats`, `method` (`approval` or `ranked`), `stand_days`, `vote_days`, optional `voters` (an electorate; `members` by default) |

The first three are the core's own, always available. `entity propose` lays a
proposal under the least rule its effects need.

## Acts members make themselves

```sh
entity act office.resign   --as ben --office treasurer
entity act value.transfer  --as ben --to cleo --amount 30 --memo "bread"
entity act value.retire    --as ben --amount 5
entity act deed.transfer   --as ben --deed room-3 --to cleo
entity act deed.release    --as ben --deed room-3
entity act post.create     --as ben --board general --title "Hello" --body "First post"
entity act post.reply      --as cleo --to t-… --body "Welcome"
entity act post.vote       --as cleo --target t-… --value 1       # 1 up, -1 down, 0 withdraw
entity act post.hide       --as mod  --target t-… --reason "spam" # holders of threads.moderator_office
entity act committee.leave --as ben --committee maintenance
entity act poll.open       --as ben --question "Dinner?" --options '["pizza","tacos"]' --mode single --days 3
entity act poll.answer     --as cleo --poll q-… --choices '["tacos"]'
entity act badge.return    --as ben --badge founder
entity act election.stand  --as ben --election board-2027 --statement "…"
entity act election.vote   --as cleo --election board-2027 --choices '["ben","dan"]'   # ranked: best first
entity act election.count  --as anyone --election board-2027                             # once voting has closed
entity act loan.borrow     --as ben --deed cargo-bike --days 3
entity act loan.renew      --as ben --deed cargo-bike
entity act loan.return     --as ben --deed cargo-bike
entity act wiki.edit       --as ben --page house-rules --title "House rules" --body "$(cat rules.md)" --base 2   # base: the version you edited
entity act authority.exercise --as ben --grant deed-manager --effects '[{"kind":"deed.grant","deed":"room-9","title":"Room 9","to":"cleo"}]'
entity act authority.cosign   --as cleo --exercise x-…            # when a grant needs several signatures
```

## Deeds: who may pass them on

`deeds.transferability` is `optional` (each deed says, when granted; unless it
says, it follows `deeds.default_transferable`), `always` or `never`. The mode is
read when someone tries to pass a deed on, so switching to `never` freezes every
deed, including those granted as transferable. Giving a deed back to the entity
is always allowed.

## Committees

A committee lives inside the entity: same record, same members, same law. It
has its own roll, appointed by decision, and its own rule for deciding among
itself: `majority` (the default), `all`, or a number of members. It has no power
of its own. It acts through authority grants, by co-signature, or it can be made
the entity's electorate (`committee:ID`).

## Authority

A grant lets an office's holders or a committee's members carry certain effects
without a vote:

```sh
entity propose --as ana --title "A deed manager" --effects '[
  {"kind":"office.create","office":"deed-manager","title":"Deed Manager","seats":1},
  {"kind":"office.fill","office":"deed-manager","holder":"ben"},
  {"kind":"authority.grant","grant":"deed-manager","to":{"office":"deed-manager"},
   "may":["deed.grant","deed.assign"],"where":{"deed":"room-*"},"limit":{"count":10,"days":30}}]'
```

- **may** lists effect kinds; **where** limits their fields (a pattern with `*`,
  or a list of them); **limit** caps uses in any window of days; **needs** is how
  many grantees must sign each use (1 for an office unless it says otherwise; the
  committee's own rule for a committee).
- A grant needs the strictest of `authority.grant_rule` and the rules of every
  effect it permits. Handing out a power never lowers the bar for using it.
- `office.create`, `committee.create`, `authority.grant` and `authority.revoke`
  can be granted only by a grant that says `delegable: true`. A grant made under
  a grant is no wider than its parent, keeps its limits, and falls with it.
- A use needing several signatures waits `authority.cosign_days` (7) for them and
  then lapses. The effects are checked again when the last signature arrives.
- Every use is published under the grant (the Authority tab) and in the history
  of what it changed. The members can undo any use by decision, and revoke the
  grant.

## Elections

`election.call` opens a candidacy period, then a voting period. Anyone may send
`election.count` once voting has closed: the count comes from the record, the
office's current holders are vacated and the winners appointed, in one step, or
nothing happens and the reason is recorded. *Approval*: tick any number; the most
approved win. *Ranked*: seats are filled one at a time by instant runoff. Ties
are broken by `hash(election id : candidate id)`, fixed and public from the
moment the election is called. A candidate needs at least one vote. The roll,
and weights if `voters` is weighted, are fixed when the election is called.

## Lending

Anything registered as a deed held by the entity itself (`to: null`) can be
borrowed by an active member, unless `lending.except` names it. A loan has a
due date; the borrower may renew it `lending.max_renewals` times; overdue loans
are shown, not punished. A decision, or an office granted `loan.recall` (a
librarian), can end a loan early, with a published reason.

## Laws (laws)

Every law has a type from `laws.types` (a constitutional setting: each type
names its rule, the levels it may pair with, and whether it carries parameter
changes), one to twelve tags, and the bodies that enforce it and on whom
(`public`, `citizens`, `office:ID`, `committee:ID`, `member:ID`). A law needs
the strictest rule of its type, its level and every parameter it changes, and
changing a parameter is a parametric law: enacting it makes the change.

Two ways to make law. **Referendum**: an Assembly decision with `law.enact`,
`law.repeal` or `law.ratify`. **Parliament** (`laws.parliament`, office or
committee): a member lays `law.bill`, members `law.vote`, anyone `law.close`s it
under the law's rule counted among the members. A passed bill waits
`laws.petition_days`, during which `laws.petition_share` of citizens can send
it to referendum (`law.petition`); otherwise anyone `law.promulgate`s it. Bills
stricter than `laws.parliament_max_rule` always go to referendum.

**Every setting is governed by one parametric law**: the last law in force that
set it (`state.m.laws.settings`). While `laws.settings_by_law` is on (the
default, a constitutional setting), an Assembly proposal may not carry bare
`changes` other than `entity.modules`; the kernel's `registerProposalCheck`
enforces it. A law that governs a setting cannot be repealed, nor amended to
drop it, until another law sets it; an amendment cannot lower the majority a law
needs; and each version records the rule it was enacted under, which a repeal
or amendment needs at least. make-vdr.sh enacts four settings acts at founding
(statutory, organic, constitutional, entrenched), so no setting starts without a
law. A module installed later brings settings at their defaults, shown as "no
law yet" until a parametric law sets them.

## Chat (chat)

Settings only; the node does the rest (`cli/chat.js`). `chat.channels` lists
the channels, each `{ id, title, about, read: public | members, post: members |
office:ID | committee:ID }`; `chat.moderators` names who may delete any message;
`chat.retention_days` how long the node keeps them; `chat.max_length` the
longest. Messages are signed with members' keys (namespace `entity.chat`) and
kept in `.entity/chat/`, never on the record. Members-only channels are end-to-end encrypted unless `encrypt: false` (see `interface/js/chatcrypto.js`): the node keeps ciphertext and wrapped channel keys, never the text. Members open rooms of their own (`chat.room_creators`, `chat.max_rooms`), closed by their opener or a moderator, and write to each other directly (`chat.direct_messages`): each direct message is sealed for the two people and deleted only by its author. The site kit's `chat.html` is the
page.

## Two-factor (twofactor)

Settings only: `twofactor.require` (optional, officers, everyone) and
`twofactor.code_minutes`. The node does the rest (`cli/twofactor.js`): a member
who uses two-factor, or whom the rule covers, signs in with their password or
key and a six-digit code emailed to them, and the node accepts acts in their
name over the web only from a browser that gave the code (for twelve hours).
Email addresses stay in the node's `.entity/twofactor.json`, never on the
record and never replicated. Codes are hashed, expire, allow five tries; at
most five are sent an hour. With the module installed, a bundle is accepted
only from a confirmed browser. The operator sets up mail with
`entity twofactor mail --host … --user … --from …` (the password is kept in
`.entity/smtp-password`), tests it with `entity twofactor test ADDRESS`, and
can `entity twofactor reset MEMBER` for someone who lost their email. It guards
this node's doors: a copy that does not run it would still accept a valid
signature.

## Library of things (things)

Members list what they own, with the deposit they ask (`thing.list`); others
ask to borrow it (`thing.request`), and line up if it is out. The lender hands
it over and signs that they received the deposit in cash (`thing.lend`); when it
comes back they sign so, refunding the deposit less anything `kept`, with a
published note (`thing.return`). A borrower may say they returned it
(`thing.returned`), and may dispute what was kept within `things.dispute_days`
(`thing.dispute`); the network settles it (`thing.settle`). A member may ask the
solidarity fund to stand behind the deposit instead (`cover: true`, up to
`things.cover_limit`, `things.cover_max_open` at a time): no cash changes hands,
and whatever such a loan keeps, or loses (`thing.lost`), becomes a claim the
fund pays (`thing.pay`). The network's own things (`thing.add`) are lent by a
keeper on the same terms. The record keeps the books of every deposit; the
money itself is cash, handed over in person. `make-solidarity.sh` founds a
network built on it.

## Wiki

Any active member may write a page; every version is signed and kept. An edit
names the version it started from (`base`), and is refused if the page has
moved on since, so nobody overwrites a change they did not see. A decision
enacts a version as a **statute**: the Law tab lists it beside the files in
`law/`. The page can go on being edited as a draft; the statute stays the
version enacted until a decision enacts a later one (the page shows the
redline) or repeals it. Statutes from the wiki live in the record; files in
`law/` still change only through `entity adopt`.

## Finality

Without this module, checkpoints are evidence: when copies disagree, entity
detects it and refuses to choose. With it, checkpoints **decide**. It is proof
of authority: a known, accountable set of validators signs, and their
signatures make records final.

**Who signs** is `finality.signers`, an electorate like `decision.electorate`:

| Value | Validators |
|---|---|
| `members` | every active member, one each (the default) |
| `founder`, `member:ID` | one person |
| `office:ID` | the holders of a role, e.g. `office:validators` |
| `committee:ID` | a committee |
| `value` | holders of the entity's unit, weighted by holdings |

**Final** means signed by at least `finality.threshold` of the signers' weight
(0.66 by default; never less than 0.51, and always more than half), so any two
final checkpoints share a signer. Final records are never undone. Records after
the last final checkpoint are **provisional**: the page greys them, and a
payment in one is not final yet.

**Anchoring.** Checkpoint *n*'s signers, and their weights, are fixed when
checkpoint *n−1* is opened, from the state at that point, which every history
sharing checkpoint *n−1* also shares. A faction cannot add signers inside a
history of its own. A change to `finality.signers` therefore takes effect one
checkpoint later. Open the first checkpoint early.

**Signing.** `entity finality sign --as ID`, or the Finality tab: the first
signature opens checkpoint *n* at the record's head, and the rest sign that same
position. An open checkpoint lapses after `finality.open_days` (7) and may be
reopened at the head. A validator's node can sign by itself: in node.json,
`"finality": { "signAs": "ID", "everyMinutes": 60 }`, with `serve --settle`.

**Choosing between histories.** When a copy meets a history that diverges from
its own (`absorb`, `sync`, Radicle):

- if the other history has a final checkpoint past the fork and this one does
  not, this copy **switches**: its own records after the fork are saved in
  `record/orphaned-….jsonl` and their acts settled again on top;
- if this history is final past the fork, it **keeps** it; the other copy
  switches when it meets this one;
- if both are final past the fork, validators signed both: the copies refuse
  each other, and the signatures are evidence.

**Cheating.** A signed `checkpoint.sign` for a history other than this one is
proof. Anyone may submit it: `entity finality scan OTHER-COPY --as ID` finds
every such signature in another copy's record, or paste one into the Finality
tab. The signer is then, at once and automatically:

- excluded from signing checkpoints for good (always);
- removed from the office or committee that made them a validator
  (`finality.vacate`, on by default);
- fined `finality.slash` of their holdings of the unit (0 by default), of which
  `finality.bounty` is paid to the reporter;
- removed from the entity (`finality.remove`, off by default).

A checkpoint of this record's own history, one that lapsed and was reopened,
is never evidence.

**When finality stalls** (too many validators gone for any checkpoint to become
final), a decision can re-anchor signing to those `finality.signers` names now:
the `finality.reanchor` effect, under `finality.reanchor_rule` (constitutional).

**For a currency.** Found with the `currency` preset, add `offices` and
`finality`, create a `validators` office of three to seven people you trust
(appointed or elected), set `finality.signers` to `office:validators`, give each
validator's node `"signAs"`, and only then freeze. A payment is final once a
final checkpoint covers it.

## Shares

Share classes (`share.class`, constitutional by default) say whether a class
votes and whether holders may pass shares on. Shares are issued and redeemed by
decision. `share.dividend` pays `per_share` of the entity's unit (the value
module) on every share of a class; each holder's payment is rounded down to a
whole smallest unit, and what rounding leaves over is published and never paid.
`decision.electorate` may be `shares:CLASS` (or `shares`, every voting class):
one vote per share, counted when a proposal is laid. A co-operative might give
each member one voting member share and issue non-voting investor shares that
pay dividends.

## Budget

The budget records decisions about real money; it holds none. A line is
approved by decision with an amount (in `budget.currency`, in smallest units:
cents with `budget.decimals` 2), and spending is recorded against it with a
payee and a purpose. Spending beyond what a line has left is refused. The usual
set-up is a Treasurer office granted `budget.spend` (authority): the treasurer
records payments without a vote, never beyond a line, and every payment is
published under its line.

## Meetings

A decision (or a secretary granted `meeting.call`) calls a meeting with a time,
a place and an agenda. Members check themselves in from an hour before it
starts until `meetings.checkin_hours` after: nobody can mark anyone else
present or absent. Any member may draft minutes once it has started; every
draft is kept, and a decision approves one.

## Tasks

Any member posts a task with its hours (in quarter hours) and an optional due
date. One member claims it, says when it is done, and, if `tasks.verify` is on
(the default), someone else verifies it. Verified hours are tallied per member;
with `tasks.pay_per_hour` above 0 and the value module, each verified hour also
pays that many units. For a housing co-op's workshift: post the week's shifts,
members claim them, a workshift manager or any other member verifies.

## Signing in

Every act is signed by a key registered to the member. How a member holds that
key is up to them, among the ways the entity's modules offer. With neither
module, the page offers a key kept in the browser (optionally locked with a
password) or a key file. Each module adds a way, and a member may use any
combination, adding and removing ways from the page (*Ways to sign in*):

- **passwords:** username and password, from any device. The password is turned
  into a key on the member's device with scrypt (32 MB and a fraction of a
  second per attempt), salted with the entity and the member's id; only the
  public key is registered, and nothing about the password is stored anywhere.
  `passwords.min_length` (12) sets the shortest accepted. On the command line:
  `entity act … --as ID --password`, or `ENTITY_PASSWORD` in the environment.
- **passkeys:** Face ID, Touch ID, a fingerprint, a phone or a security key.
  The passkey stays on the device; the entity holds its public key and the
  website it belongs to. A passkey works only on that website (a passkey made
  on poezine.org signs only there, never on a bare IP address), and cannot sign
  from the command line.

A member can join with any one of these and add the others later. A forgotten
password or a lost device is recovered like a lost key: sign in another way,
or the members give a new key by decision.

## Agreements

Documents are wiki pages. A member signs one exact version: the signed act
records the page, the version and a fingerprint of its text, so the record
proves which words each member agreed to. `agreements.required` lists pages an
applicant must have signed before being admitted, by decision or by a grant
(the core's admission checks, which any module may add to). With
`agreements.enacted_only` (on by default) a document can be signed only once the
members have enacted it. When a required document is amended,
`agreements.amendments` says whether earlier signatures carry over or everyone
signs again. The fund module also refuses payments from anyone who has not
signed what admission requires.

## Fund (investment clubs)

The unit value method: the club's value (cash plus each holding at its last
recorded price) is divided into units. Paying in buys units at the current unit
value, exactly in proportion to the club's value; withdrawing sells them back.
Every member's share of the club is their units over all units.

Trades take two steps. The members vote `fund.authorize` (buy or sell up to a
quantity of a security, optionally within a price limit, within a number of
days). The treasurer, trading at the broker, records `fund.fill`, and cannot
exceed what was authorized. `fund.authorize` can never be used under a grant:
investment decisions stay with the members. The treasurer's bookkeeping
(`fund.contribute`, `fund.fill`, `fund.valuation`, `fund.income`,
`fund.expense`) is usually granted to a treasurer office. Payments in and out
need prices no older than `fund.valuation_max_days`. `fund.max_members` (at
most 100) and `fund.max_share` limit membership and any one member's share.
The Fund tab shows how many recent investment decisions each member voted on,
and exports the ledger as CSV for the club's accountant.

The record is public. A club's members, contributions and balances are visible
to anyone who can see the entity: host a club's entity where only its members
can reach it.

## loans

An interest-free revolving loan fund. The members add capital by decision
(`loan.fund`); loans (`loan.make`) are refused beyond what is available, beyond
`loans.max_amount` (500.00 by default) or while the borrower has
`loans.max_open` loans outstanding; repayments (`loan.repay`) return to the fund
for the next borrower; only the rule `loans.forgive_rule` forgives what is left
(`loan.forgive`). The money itself is held by the treasurer; the record keeps
the books. The usual arrangement is a stewards' committee granted `loan.make`
and `loan.repay`, needing two signatures.

## endowment

A permanent fund. Gifts (`endowment.gift`) become principal, never spent; the
treasurer records the market value (`endowment.value`); each year, from
`endowment.year_start`, the members may draw (`endowment.draw`) up to
`endowment.spend_rate` hundredths of a percent of the latest value (400, 4%),
never below the principal, for the loan fund (added to it directly) or the
budget. The spend rate changes only under the constitutional rule.

## page

The republic's own web page. A republic without it runs headless: its node
still serves the record, accepts signed acts, and serves windows for other
websites, and its front door says the republic has no page of its own.

## sealed

Content only members can read, though anyone may hold the record. Each member
publishes an encryption key (`seal.key`) derived from their signing key, so
there is nothing new to keep; passkey-only members add a password to take part.
A key period (`seal.epoch`) seals a new group key to every member with a key;
posts (`seal.post`) are encrypted under the current period's key, with an
optional title left readable. A member who holds a period's key can give it to
one who lacks it (`seal.grant`); `sealed.history` (`all` or `current`) says
whether newcomers may be given earlier periods.

When a member who holds the current key leaves or is removed, nothing more can
be sealed or given until a holder starts a new period, which leaves them out:
they keep what they could already read, and nothing after. Settlement never
decrypts; it checks only shapes, so every copy settles alike. From the
terminal: `entity seal status | key | epoch | grant M | post | read`.

## contracts and disputes

**contracts** records deals between two members and holds their payment in
escrow. A member offers a contract (as the provider or the payer), with a price
in the entity's value units and terms whose fingerprint is recorded. When the
other accepts, the price is held from the payer's balance. The provider marks
it done; the payer confirms, and the provider is paid. If the payer neither
confirms nor disputes it within `contracts.release_days` (3), the provider may
collect. Both together may cancel, and the payer is refunded. Needs **value**.

| Act | By |
| --- | --- |
| `contract.offer`, `contract.withdraw` | either member, before acceptance |
| `contract.accept`, `contract.decline` | the member it was offered to |
| `contract.done`, `contract.collect` | the provider |
| `contract.confirm` | the payer |
| `contract.cancel` | both, each signing |

**disputes** hears claims between members. A dispute about a contract freezes
its escrow until it is ruled on. The other side answers within
`disputes.answer_days` (3), or the arbiter may rule without them. The arbiter is
`disputes.arbiter`: `office:ID` (its holder), `committee:ID` (a majority of its
members) or `member:ID`. A ruling awards the claimant between nothing and what
they claimed, with reasons. Either side may appeal within
`disputes.appeal_days` (7) to `disputes.appeal`: another body, `assembly` (the
members decide by proposal, `dispute.decide`), or `none`. A ruling no one
appealed is carried out once the window closes (`dispute.execute`). Contract
escrow moves by the ruling; otherwise the award is paid from the loser's
balance, and what they lack is owed (`dispute.pay`) and bars them from new
contracts until paid. `disputes.deposit` asks claimants to put down an amount,
returned if they win. Parties never rule; whoever ruled first never hears the
appeal; members barred from a case do not count toward its majority.

Evidence is a list of files by name and SHA-256 fingerprint. The page computes
the fingerprint in the browser; the files themselves go to the other side and
the arbiter directly, so private material stays off the record while the
fingerprint proves it was never swapped.

## Installing from the page

Settings → *Install or upgrade modules* lists every module the entity's module
source offers. *Propose installing* (or *Check for an update*) has the node
fetch the code and check it — for an upgrade, by replaying the whole record
with it — and shows its source, digest and files before you sign the proposal.
The members then decide as with any install. A node can turn this off with
`"modulesOnline": false` in node.json; the module source itself is set from
the terminal (`entity module source …`).

## Changing things after they are made

Everything a member sees about an office, committee, grant, badge, budget line,
deed, meeting, share class, board or task can be changed later: use **Edit**
beside it, which proposes an amendment under the rule that created it (or uses
a grant that permits it). Only ids are fixed, because the record refers to
them. Amending a grant's powers is checked exactly as a new grant would be,
needs the strictest rule among its powers, and is never done under a grant.
Settings and the words an entity uses are changed on the Settings tab, as ever.

## Minimum core version

A module may say the oldest core it runs on: `core: '0.4'` in its default
export. A copy whose core is older does not run it, holds that entity's acts, and
says why; `entity module add` refuses it. The modules that use 0.4's electorates,
effects checks or defaults (offices, value, deeds, threads, committees,
authority) say `core: '0.4'`.

## Things to know

- **Nothing posted can be erased.** Deleting or hiding a post removes it from
  view; its text stays in the record, which is never altered. Tell members.
- **Threads make the record grow.** Every post and vote is a record, and each page
  visit downloads the whole record. A busy board raises bandwidth accordingly.
- **Moderation needs offices,** or a decision. `threads.moderator_office` names an
  office whose holders may hide posts, with a published reason.
- **Terms end by date** and count from the appointment. Expiry needs no act.
- **Value is whole numbers.** `value.decimals` only changes how amounts are shown.

## Writing and publishing a module

A module is a directory with:

```
index.js         export default { name, install(registry), parameterKeys: [...], core: '0.4' }
parameters.yml   its settings, with defaults and the rule that changes each
tests.js         its own tests
ui.js            optional: export const tabs = [{ id, title, render(api, path) }]
                 (or, as before 0.4, export default (api) => a <section>: one tab)
```

A tab owns the page's addresses under `#/ID/…`; `path` is the rest of the
address, so `#/offices/treasurer` gives the offices tab `['treasurer']`. `api`
holds the state and parameters, `h` to build elements, `sign`, `propose`,
`link(path, …)`, `go(path)` and `who(id)`.

In `install`, use `registry.registerKind` for acts members sign,
`registry.registerEffect` for things only the entity can do (a decision, or a
grant), `registry.registerRecord` for how each effect changes the state, and
`registry.registerElectorate` to offer a new kind of electorate. An effect's
record says where it came from: `proposal` for a decision, `via` and `exercise`
for a grant; the kernel's `originOf(payload)` says it in words. `check` and
`apply` must be pure. A module may read another module's state, but never import
it: removing any module must leave every other one working (acceptance test 20).

Publish it in a git repository (GitHub or Radicle), then anyone installs it with
`entity module add github:YOU/REPO/SUBDIR@COMMIT`. The twenty-two modules above are in
the module pack (`entity-modules`); `library/README.md` says how to publish it.

## Parties (parties)

Members found parties (`party.found`), join (`party.join`, or ask when joining is
by approval and the leader accepts with `party.accept`), and leave
(`party.leave`). The leader rewrites the platform (`party.platform`) and hands
over (`party.leader`); members replace a leader by calling for the same person,
which takes effect past half of the party. Settings: `parties.min_members`,
`parties.exclusive`, `parties.cooling_days`, `parties.dissolve_rule`.
Electorate: `party:ID`.

## Federation (federation)

Runs in the federal entity. States are separate entities, admitted with
`federation.admit_state { state, name, entity, keys }` and released with
`federation.release_state`. A state's registrar signs `state.certify` (its
citizens and their keys, its senators and deputies, the point in its record);
`entity federation certify` builds it from the state's folder. Citizens take up
federal citizenship with `citizen.enroll`, proved with their state key
(`entity federation enroll`). Settings: `federation.senators_per_state`,
`federation.assembly_seats`, `federation.admit_rule`, `federation.release_rule`,
`federation.registrar_rule`. Electorates: `senate`, `assembly`, `parliament`.

