# Changes

## 0.7.8

- **Reversing a decision.** Every enacted proposal offers *Propose reversing
  this*: a new decision that sets its settings back to their values just before
  it, and undoes its effects where they have an opposite (a fill by a vacate, a
  grant by a revoke, an admission by a removal, an office by abolishing it…).
  Anything without an opposite is listed. The record itself is never edited.
- **Modules from the page.** Settings → *Install or upgrade modules* lists what
  the entity's module source offers; the node fetches and checks the code (and,
  for an upgrade, replays the whole record with it), and the member signs the
  proposal in the browser. `"modulesOnline": false` in node.json turns it off.
- **Dark and minimal by default**, and flat: nothing on the page animates.
  `look` and `colour` in node.json set a node's default; viewers can still pick.
- The seal now says simply how many records there are, verified in this browser.

## 0.7.7 · Everything editable

- Everything but an id can be changed after it is made, under the rule that
  made it (and by a grant, where one permits it): `office.amend` (title, seats,
  term), `committee.amend` (title, remit, how it decides, seats),
  `authority.amend` (title, note, holder, powers, limits, signatures — checked
  as a new grant would be, never done under a grant), `badge.amend`,
  `budget.amend` (title, period, note; amounts by `budget.adjust`), `deed.amend`,
  `meeting.amend` (its time only before it starts), `share.amend` (title,
  voting, transferable), `board.amend`, and `task.edit` (by the poster, until
  claimed). Every change is recorded with who made it.
- An **Edit** form beside each of these on its tab, proposing only what changed.
- Ids stay fixed: every past act refers to them.
- The amended modules need core 0.7.7.

## 0.7.6

- **agreements:** members may draw their signature when signing (a signature
  pad on the Agreements tab). The drawing is sealed inside the signed act;
  `agreements.drawn_signature` makes it optional (the default), required or off.
  Signers' drawings show beside their names, and a signed copy of the document
  (its text, every drawn signature, and the details that verify each) can be
  printed or saved as a PDF.

## 0.7.5

- The Schoolbook look follows tschoonover.com's own design: Helvetica on warm
  paper with hairline rules, Century Schoolbook headings, a deep-red accent and
  the square mark, with its dark mode.

## 0.7.4

- **Schoolbook**, a new look: Century Schoolbook on a Swiss grid, with the red
  square (the house style of poezine.org). A node shows a look by default with
  `"look": "schoolbook"` in node.json; viewers can still pick their own.

## 0.7.3

- **Admission checks.** A module may add conditions an applicant must meet
  before being admitted (`registry.registerAdmissionCheck`); they apply to
  every way of admitting, by decision or by a grant. The Members tab shows
  whether each applicant is ready, and the Overview tells an applicant what is
  missing.
- **agreements** module: members sign exact versions of wiki pages; required
  documents must be signed before admission (and, with the fund module, before
  paying in); amendments carry signatures over or require signing again;
  only enacted documents can be signed, by default.
- Core version 0.7.3.

## 0.7.2

- **fund** module: an investment club's books by the unit value method (units
  issued in exact proportion to the club's value), holdings with average cost
  and realised gains, trades only under an authorization the members voted,
  valuations, income, expenses, withdrawals with an optional fee, a membership
  cap and a per-member share cap, a `fund` electorate (by units), and a Fund tab
  with each member's stake, participation in investment decisions, and a CSV
  ledger for the accountant.

## 0.7.1

- `entity upgrade check` and `propose` no longer fail on pipes or sockets in the
  entity's folder (the Pi's GPIO library leaves `.lgd-nfy*` pipes wherever the
  LED script is started): the replay copies only ordinary files.

## 0.7.0 · Signing in

- **Passwords.** A username and password become an Ed25519 key on the member's
  device: scrypt (RFC 7914, in plain JavaScript, checked against Node's) over
  the password, salted with the entity and member ids. Nothing about the
  password is stored. `passwordKey` and `passwordProblem` in kernel/password.js;
  `entity act … --password` on the command line.
- **Passkeys.** The core verifies WebAuthn (ES256) signatures: a passkey line
  (`webauthn-es256 …`) registers like any key, and every copy checks the
  challenge (bound to what was signed and its namespace), the website, that a
  person was present, and the P-256 signature.
- **passwords** and **passkeys** modules: set, change or remove a password; add,
  name or remove passkeys. With them installed, the page offers joining and
  signing in with a username and password, or a passkey (Face ID, Touch ID, a
  fingerprint, a security key), in any combination, and lists each member's
  ways to sign in.
- Core version 0.7.0.

## 0.6.1

- **meetings:** meetings called by decision or a granted secretary, agendas,
  attendance each member signs themselves within a check-in window, minutes
  drafted by anyone and approved by decision.
- **tasks:** chores and shifts posted, claimed, done and verified by another
  member; hours tallied per member, and optionally paid in the entity's unit.

## 0.6.0

- **Modules live on GitHub until installed.** `library.yml` has a `from` line
  (`entity module source github:YOU/entity-modules@main`); `entity module add
  NAME` fetches NAME from it. A branch or tag in any source is pinned to its
  commit when fetched, and the proposal records the pinned source.
  `entity module available` lists what a published pack offers. The local pack
  is now only a fallback, and the shipped `library.yml` names no module.
- **shares:** share classes (voting or not, transferable or not), issuing,
  redeeming, transfers, dividends in the entity's unit with published rounding,
  and `shares:CLASS` as an electorate.
- **budget:** budget lines approved by decision, spending recorded against
  them and refused beyond them; with authority, a treasurer spends without a
  vote within the lines.
- The module pack is published separately (entity-modules).

## 0.5.5 · Finality

- **The finality module:** proof of authority. Validators, named by
  `finality.signers` (every member, one person, a role, a committee, or holders
  of the unit weighted by holdings), sign checkpoints as recorded acts. A
  checkpoint is final at `finality.threshold` of their weight (two thirds by
  default, never less than more than half), so two final checkpoints share a
  signer. Each checkpoint's signers are anchored at the one before, so nobody
  can pad them inside a history of their own. Open checkpoints lapse and reopen.
- **Choosing between histories.** When copies diverge, the one final past the
  fork stands; the other sets its own records after the fork aside
  (`record/orphaned-….jsonl`) and settles their acts again on top. Two histories
  final past the same fork are refused, and their signatures are evidence.
- **Penalties.** `checkpoint.evidence` submits a validator's signature on
  another history. They are excluded from signing for good and, as configured,
  lose their seat, are fined a share of their holdings (with a bounty to the
  reporter), or are removed. `entity finality scan OTHER-COPY` finds every such
  signature in another copy.
- **Re-anchoring** by decision when finality stalls.
- **Commands:** `entity finality status | sign | evidence | scan`. A validator's
  node signs by itself with `"finality": { "signAs": "ID" }` in node.json.
- **The page:** a Finality tab (the open checkpoint and who must sign it, every
  final checkpoint, evidence, submitting evidence); provisional records marked
  in the record and the seal; the Value tab says which payments are final. A
  browser that saw provisional records later replaced shows a notice, not an
  alarm; final records changing is still an alarm.
- **Core:** checks may be asynchronous; the state keeps every record's hash; a
  module may register how to choose between diverging histories. Fixed: pending
  acts arriving with a bundle were compared by the old act hash.
- Core version 0.5.5.

## 0.5.4

### Security

- **Fixed: a signed act could be recorded twice.** Acts were told apart by a
  hash that included the signature's text, and a signature can be re-encoded (a
  line break, armour) by anyone, without the key. Since the record is public,
  anyone could resend someone else's transfer in a slightly different form and
  have it settle again. Acts are now identified by what was signed
  (`actId`: everything but the signature), so every re-encoding is refused as
  "already recorded". Records already written are unchanged.
- **Checkpoint signatures are checked against the keys the signer held when the
  record reached that point.** Before, rotating or recovering a key made every
  earlier checkpoint signature by that member stop counting. A key replaced
  later still counts for checkpoints before its replacement; it cannot sign
  later ones.

### The page

- Every list works the same way: **yours first**, with everyone else's one click
  away (unless you have none); search, sorting and filters once a list is long
  enough to need them; pages past 10 large items or 20 rows.
- **Votes** filter by status, by what a proposal changes (settings, modules,
  code, members, each module's effects, motions) and by rule; sort by newest,
  oldest, closing soonest, most votes or title; search titles, text, settings
  and effects.
- **Members** filter by active, not active, applying, left or removed.
- **Record** filters by kind and searches authors; **Settings** has a search.
- **Using authority where you are.** Any "Propose…" button on any tab first
  checks whether you hold a grant that permits it; if so, you choose between
  using the grant and proposing it to the members.
- **Looks:** Classic, Terminal and Minimal, with system, light or dark colours:
  a choice kept in your browser, changing nothing for anyone else.

### Modules

- **threads:** boards work like subreddits: members may start one
  (`board.create`, when `threads.open_boards` is on, the default); each board and
  each post has its own address; every post and reply folds away with its
  replies.
- **wiki:** pages have a category, and the list filters by category and by
  whether a page is law.

## 0.5.3

- A checkpoint signature that does not verify no longer makes the whole copy
  fail `verify`: it never counted, and anyone can add one to a checkpoint file,
  so it is listed as not counted instead. A checkpoint that contradicts the
  record still fails. `entity checkpoint tidy` removes signatures that do not
  verify.
- `entity upgrade propose` with no source reuses the one last checked.

## 0.5.2

- **Upgrading the core by decision**, from the command line or the page.
  `entity upgrade check [SOURCE]` fetches a version of entity (`dir:PATH`,
  `github:OWNER/REPO@REF`, `git:URL@REF`; a branch is pinned to its commit),
  runs that version's own `verify` on a scratch copy of the entity, and lists
  the core files it changes. `entity upgrade propose` lays the proposal that
  approves exactly those files by digest; `entity upgrade apply` installs them
  once it carries, and refuses if anything changed since the check. The
  entity's law, installed modules, library.yml and record are never touched.
  Set `"upgrade": { "source": "…" }` in node.json and the page's Settings tab
  offers **Check for a new version**, **Propose upgrading** and, once carried,
  **Install it** (the node then needs a restart).
- **Checkpoints from the page.** The Record tab lists checkpoints and their
  signers; members make one at the current head, or co-sign one, with the key in
  their browser. The node accepts it (`POST /checkpoints`) only if it matches its
  own record and chain, and keeps only signatures that verify
  (`mergeCheckpoint` in kernel/checkpoint.js).
- Core version 0.5.2.

## 0.5.1

- Checkpoints and attestations: signing as someone with a key that is not
  registered to them is refused before anything is written. A signature under a
  member's name that does not verify (from an older copy, or edited in by hand)
  never counted; now it no longer blocks that member's real signature either,
  and `entity checkpoint status` lists it as not counted.

## 0.5.0

- **entity fork.** A new entity whose founding act names its parent: entity,
  record count, head and prefix root at the fork point. It starts from the
  parent's parameters and modules (at the digests recorded then); members are
  not carried, but the parent's members keep their ids, claimable only with a
  key they held there; `--carry` takes over module state (balances, deeds) as of
  the fork point. The parent's records up to that point are kept in
  `parent/events.jsonl`, and `entity verify` checks the fork against them
  (`checkFork` in kernel/fork.js). The page shows where the entity came from.
- **lending:** the entity's own deeds lent to members, with due dates, renewals,
  per-member limits, exceptions, and recall by decision or grant.
- **wiki:** pages any member edits, every version kept, stale edits refused;
  a version enacted as a statute by decision (listed under Law), amended by
  enacting a later one, or repealed; redlines between versions and against the
  statute in force.
- Fixed: parameters.yml could not be rebuilt after a decision changed a kernel
  parameter that the founding text never wrote out (such as
  `decision.electorate` in entities founded before it existed).
- Core version 0.5.0.

## 0.4.1

- **Module upgrades.** `entity module upgrade NAME [SOURCE]` fetches new code,
  replays the whole record with it, and refuses it unless every record is
  reproduced exactly; then lays a proposal (the `entity.modules` rule) carrying
  the new digest. A module already installed may now be installed again at a
  different digest: that is an upgrade, needing no change to `entity.modules`.
  `module.installed` records the digest it replaces (`from`); the page lists
  each module's code and its history. Entities still on 0.3 modules can now move
  to 0.4 ones by decision (tested on a 0.3.1 entity: offices, deeds and value).
- **polls:** questions with 2–20 options, one choice or any number; the members
  when it opens may answer; the latest answer counts; decides nothing.
- **badges:** created, awarded, revoked and retired by decision (or by a grant);
  shown on the member's page; the holder may give one back.
- **elections:** a decision calls an election for an office; candidates stand;
  the roll votes by approval or ranked ballots (instant runoff, seat by seat);
  anyone counts after it closes, which vacates the office and appoints the
  winners. Ties break by a hash published when the election is called.
- Effects record `by_election` when an election put them into effect.
- Core version 0.4.1.

## 0.4.0

### Decisions taken for this release

- **Who decides is a slot; how a decision works stays in the core.** Proposals,
  effects, readings and enactment remain one implementation (deliberation), so
  every entity decides the same way and no procedure module has to reimplement
  them. What varies is the electorate: `decision.electorate` (entrenched) names
  who votes and with what weight, and modules may add kinds. The kernel knows
  `members`, `founder`, `member:ID` and `none`; offices add `office:ID`,
  committees `committee:ID`, value `value` (weighted by balance). `none` freezes
  the entity: the base for a fixed-supply currency. Consensus, sortition and
  quadratic voting can come later as further electorates or tally rules.
- **Committees now; sub-entities later.** Committees live inside the entity and
  act through authority grants or as the electorate.
- **One authority module**, granting to offices and committees (entities come
  with recognition, later). `office.create` and `authority.grant` are never
  delegated unless a grant says `delegable: true`; `committee.create` and
  `authority.revoke` are held the same way.
- **Removal and recovery are ordinary decisions by default**, each under its own
  parameter so an entity can raise the bar.
- **Switching deeds to `never` freezes existing deeds too.**

### New

- `decision.electorate`, with rolls and weights fixed when a proposal is laid.
  Quorum and threshold are fractions of weight. A decision cannot empty the
  electorate (short of choosing `none`); founding refuses an electorate nobody is
  on; a frozen entity refuses every proposal.
- Core effects `participant.admit`, `participant.remove` (reason required; never
  the last active member) and `participant.rekey` (replaces every key; flagged
  on the page). Removed members can no longer act and are on no future roll.
- Defaults live in code. A module's `parameters.yml` is its defaults, pinned by
  its digest; the document records only chosen values (`{ value }` overrides).
  Enabling a module carries no settings; one proposal can enable a module and set
  its settings. Kernel parameters added since 0.3 are defaults in
  `kernel/defaults.js`, so older entities read them too.
- Deeds: `deeds.transferability` (`optional` | `always` | `never`) and
  `deeds.default_transferable`, replacing `deeds.transferable`; deeds carry their
  own `transferable`, settable on grant and assignment.
- **committees** module: create, appoint, remove, dissolve, leave; a rule for
  deciding among themselves (`majority`, `all`, a number); electorate
  `committee:ID`.
- **authority** module: grants with `may`, `where`, `limit`, `needs`,
  `delegable`; `authority.exercise` and `authority.cosign`; uses that lapse; grants
  made under grants, no wider than their parent and falling with it; a grant
  needs the strictest rule of the powers it hands out.
- Minimum core version: a module's `core` field. An older core holds that
  entity's acts and says why; `entity module add` refuses the module.
- The page: tabs and addresses (`#/votes/d-…`, `#/members/ID`, `#/record/N`,
  `#/law`, `#/settings/KEY`, module tabs); what needs your vote; applications
  with admission and declining from the page; removal and recovery from a
  member's page; every ballot, rejection and reading on a proposal's page; the
  law with the decisions that approved it; each setting's default and history.
  Modules contribute tabs (`export const tabs` in `ui.js`); a default export
  still works as one tab.
- Password-locked keys in the browser (PBKDF2-SHA-256, AES-GCM).
- `entity propose`: a proposal under the least rule its contents need.
  `entity status` says who decides; `entity count` names the electorate.
- Presets `proprietor` (the founder decides) and `currency` (experimental).

### Changed

- Effect records say where they came from: `proposal` for a decision, `via` and
  `exercise` for a grant. Effects may not set these fields themselves.
- Effect checks receive `{ registry, via }`; effect rules receive the registry;
  reducers receive the registry.
- A ballot from someone off the roll is reported as "not on the roll when the
  proposal was laid".
- Founding documents hold the kernel's and deliberation's parameters in full,
  and only the values a preset sets for other modules.

### Compatibility

Entities founded with 0.3 verify byte for byte under 0.4, keeping the module
code they installed. Their documents carry full module definitions, which still
take precedence over defaults. Modules marked `core: '0.4'` cannot be installed
into a 0.3 copy.

### Not yet

Sub-entities, recognition and relations; shares; password-derived keys and passkeys; proof-of-authority
checkpoints (without them a currency has no finality: see GUARANTEES.md).
