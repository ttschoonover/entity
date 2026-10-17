# Changes

## 0.9.16 · Rooms and direct messages

- **Direct messages.** Members write to each other directly. Each message is
  sealed in the sender's browser with a fresh key, wrapped for every chat key of
  both people; the node relays and stores ciphertext it cannot open, and checks
  the sender's signature over the ciphertext and the wraps. Only the author
  deletes a direct message, for both of them. `chat.direct_messages` switches
  them off.
- **Rooms.** Beside the channels the law names, members (`chat.room_creators`:
  members, an office, a committee, or nobody) open rooms of their own, public
  or members-only (encrypted like any members' channel), up to `chat.max_rooms`.
  The opener or a moderator closes a room, and its messages are deleted with it.
  Channels the law names close only by law.
- Deleting messages: authors and moderators in channels and rooms, authors only
  in direct messages, as before.

## 0.9.15 · One website for a federation and its states

- The site kit shows several entities on one site. A site's config.js names
  `entities: 'entities.json'`, a list of `{ key, label, url }` whose first is the
  site's own node. Each record is fetched from its own node, with its own module
  code, and verified in the browser; `?e=key` says which one a page is about, and
  a row of pills in the masthead switches between them. One password signs a
  member in to every entity they belong to, and each act goes to its own node.
- `sites/federation`: the federation and both states on one page: the federal
  parliament drawn seat by seat and coloured by state, each state's government,
  citizens and seats, the open votes of all three, the currency and the parties.
  Apply to a state, admit and vote in it, report a state's citizens to the
  federation as its registrar, and take up federal citizenship, all from the page.
- `make-federation.sh` installs this site in the federation's folder (no page
  module); the states' own addresses lead to it.

## 0.9.14 · Parties, federations, referendums

- **parties**, a module: members found parties, join one at a time
  (`parties.exclusive`), leave, and follow a leader who rewrites the platform.
  A leader hands over, or is replaced once more than half of the party calls for
  the same person. A party is registered at `parties.min_members`; the
  electorate `party:ID` counts members after `parties.cooling_days`; the members
  as a whole may dissolve a party under `parties.dissolve_rule`. `allocate()`
  shares seats by D'Hondt or Sainte-Laguë.
- **federation**, a module: a federation of separate entities. States are
  admitted and released by federal decision (secession is lawful only by
  release). Each state's registrar key certifies, from the state's own record,
  its citizens and whom it appoints to the senate (equal seats) and the assembly
  (seats by population, the method of equal proportions, at least one each).
  Nobody is a citizen of two states; federal citizenship is taken up with the
  citizen's own state key (`citizen.enroll`) and lapses with state citizenship.
  Electorates `senate`, `assembly` and `parliament`.
- `entity federation certify | enroll | status`: reads a state's record,
  verified by replay, and signs for its registrar or citizen.
- **Referendums** (deliberation): `decision.referendum` lists rules whose
  proposals every member decides, whoever `decision.electorate` names. A
  parliament for ordinary law and the people for the constitution.
- `make-federation.sh`: a federation of two states, one currency, a senate and
  an assembly; each state a parliament, direct democracy, or both.

## 0.9.13 · Encrypted chat

- Members-only chat channels are **end-to-end encrypted**. Messages are sealed
  in the writer's browser and opened in each reader's; the node keeps only
  ciphertext and still checks every signature. A channel opts out with
  `encrypt: false` in `chat.channels`; public channels are never encrypted.
- Each member's chat key (X25519) is derived from their signing key, so it needs
  no new secret and is the same in every browser they use. It is registered with
  the node signed by a record key, and every page checks that signature, so a
  node cannot slip in a key of its own (`POST /chat/keys`).
- Each channel has a key per epoch, made by a member's browser and wrapped for
  every member's chat key (`/chat/c/ID/epochs`). Members who join get the current
  key from the next member online. When someone stops being a member, the next
  member to open the channel starts a new epoch that leaves them out.
- `interface/js/chatcrypto.js`: X25519 (RFC 7748, checked against its test
  vector), HKDF and AES-GCM through Web Crypto, the same in browser and Node.
- What it does not hide: who wrote, when, in which channel, and how long each
  message is. A password or a key kept in the browser is needed; passkeys cannot
  read encrypted channels yet.

## 0.9.12 · Chat

- **chat**, a module: channels of messages, like a group chat, kept by the node
  and never written to the record. The members decide by law which channels
  exist, who reads each (anyone, or members) and who writes in it (members, an
  office or a committee), who moderates, and how long messages are kept
  (`chat.channels`, `chat.moderators`, `chat.retention_days`, `chat.max_length`).
- Every message is signed in the page with its author's own key in its own
  namespace (`entity.chat`), so the node cannot forge one and it can never be
  replayed as an act. Reading a members' channel takes a short-lived signed
  token instead of a session. Authors and moderators delete messages; the text
  leaves the node's disk.
- The node (`cli/chat.js`): channels, history, posting, deleting, and a live
  stream so new messages appear at once. A copy of the entity is refolded only
  when the record grows.
- `chat.html` in the site kit: channels on the left (a menu on phones), the
  conversation with days, replies, links, `code` and @mentions, and a box to
  write in (Enter sends, Shift+Enter for a new line). Both the VDR and the
  solidarity network are founded with it.

## 0.9.11 · The solidarity network gets its own website

- **A shared site kit** (`sites/kit`): the masthead, signing in and joining,
  signing acts, the Institutions page, the privacy page, preferences and the
  stylesheet, shared by every site built on windows. Each site adds its own
  pages, flag and `config.js` (how it refers to itself, its pages, a line about
  what it is); what members and proposals are called comes from the entity's
  vocabulary. The VDR now runs on it (`sites/vdr` keeps its home page and laws).
- **Joining signs what admission requires.** Where `agreements.required` names
  documents (a pledge, terms), the join form shows them and signs them with the
  new member's key straight after the application. Applicants appear on the
  members tab, with what they still owe and a button to propose admitting them.
- **`one.js`**: a page that is one module, full width (`<main data-module=…>`).
- **`floor.js`**: open votes as cards, shared by both home pages.
- **The solidarity network is headless** (`make-solidarity.sh`): its website is
  `sites/kit` plus `sites/solidarity`: a home page (on the shelf now, how
  borrowing works, the library, open votes, the solidarity fund, what was
  agreed, how the network runs), the library of things and the wiki as pages of
  their own, and an emblem. The founder is asked for the name members see.

## 0.9.10 · Peers pull on their own

- **A node pulls from Radicle while it runs.** `entity serve` on a copy with a
  radicle destination pulls every peer's acts and records every 2 minutes
  (`pullEveryMinutes` in node.json; 0 turns it off), inside the same queue as
  the website's writes, then settles and publishes. An act signed on any copy
  reaches the others with nobody running a command. A diverged history is kept
  aside, never merged silently.

## 0.9.9 · Every setting is a law

- **Settings are laws.** Every setting is governed by a parametric law, at the
  level its rule needs. The VDR is founded with four: the Statutory, Organic,
  Constitutional and Entrenched Settings Acts, covering every changeable setting.
  Changing a setting means amending its act or enacting another parametric law.
- **Only by law.** With `laws.settings_by_law` on (default; constitutional), a
  bill to the citizens cannot change settings directly; installing and removing
  modules still can. New kernel hook: `registerProposalCheck`. Core 0.9.8.
- **No setting left without a law.** A law that governs settings cannot be
  repealed or amended to drop them until another law sets them. This also
  settles what repealing a parametric law means: nothing is silently left behind.
- **Majorities hold.** Each version of a law records the rule it was enacted
  under; repealing or amending it needs at least that rule, and an amendment
  cannot lower it (no demoting the Constitution to a statute). A repeal or
  ratification may be decided under a stricter rule than it needs.
- **Statute book**: an "Every setting" page, grouped by majority, with each
  setting's value and governing law; law pages say when a setting has since been
  set by another law; the drafting form keeps settings a law governs and words
  majorities from the rules as they stand.
- At founding the entrenched rule takes one vote, and the Entrenched Settings
  Act sets it to two votes 30 days apart, as Article X says.

## 0.9.8 · Names everywhere, removal where things are listed

- **Preferred names.** Every module page names people as "Name (id)": office
  holders, committee members, candidates, meeting attendance, badge holders,
  lenders and borrowers, the people a law concerns, and the choices in every
  "appoint" or "award" list. Proposal titles use names too. make-vdr.sh asks the
  founder for the name citizens will see (or takes `YOUR_NAME=…`).
- **Abolish and dissolve in place.** Each office has "Propose abolishing it" and
  each committee "Propose dissolving it", on the Offices and Committees tabs and
  their own pages. The "Add or remove" tab is now **Modules**: what is installed,
  each with "Propose removing it", and what can be added.
- **Tabs.** The current page's underline sits on the rule, in the masthead and
  on the Institutions tabs, and the tabs stay on one line (scrolling sideways
  when they do not fit) instead of wrapping.
- Grants of authority name the office or committee by its title.

## 0.9.7 · Firefox, names, privacy, and a plainer VDR site

- **Firefox signing.** Where Web Crypto will not export an Ed25519 public key
  from a seed (Firefox), it is computed in JavaScript (`kernel/ed25519pub.js`)
  and the key imported as a JWK. Keys and signatures are the same in every
  browser.
- **republic**, a settings module: the motto, the name in running text, the
  privacy contact and the minimum age for citizenship.
- **The VDR site**: one monochrome stylesheet; display and accessibility
  preferences (theme, text size, contrast, motion, links, font); a check of what
  the browser can do; a privacy and cookies page with tools to download your
  data, change your name, leave, and clear the browser; a one-time storage
  notice that respects Global Privacy Control; age and public-record
  confirmation when joining; preferred names shown with ids; proposals to
  abolish an office, dissolve a committee or remove a module; plainer text
  throughout. The default name is "Virtual Democratic Republic".

## 0.9.6 · A relational legal system, Parliament and referendums

- **laws**, a module: every law has a type (constitutional, organic, statutory,
  ordinary, parametric, as the constitutional setting `laws.types` defines
  them), tags, and the bodies that enforce it and on whom. Parametric laws carry
  parameter changes and make them when enacted. Laws are made by Parliament
  (bills, votes, a petition window, promulgation) or by referendum (Assembly
  decisions to enact, repeal or ratify); bills above `laws.parliament_max_rule`
  always go to the citizens.
- The VDR is founded with it: a Parliament of nine elected members, the
  Constitution and a Parliament Act as laws, and a Constitution that describes
  the types of law, Parliament and referendums. Its Laws page browses by type,
  tag and body, shows every version and the settings each law set, and drafts
  laws and amendments for either way of making them; Parliament and the statute
  book appear among its Institutions.

## 0.9.5 · Email two-factor

- **twofactor**, a module: the members decide who must sign in with a code
  emailed to them (`twofactor.require`: optional, officers, everyone); the node
  enforces it at sign-in, on `/acts` and on `/bundle`. Addresses are kept by the
  node alone (`.entity/twofactor.json`), never on the record.
- The node sends mail itself (`cli/mail.js`: SMTP over TLS or STARTTLS, no
  dependencies), set up with `entity twofactor mail`, tested with
  `entity twofactor test`; `entity twofactor reset` for a lost inbox.
- The page, the private sign-in page, the signing window and the VDR site all
  ask for the code when the node wants it, and send the act again.

## 0.9.4 · A library of things with deposits

- **things**, a module: members lend each other what they own against a cash
  deposit, and the network lends what it holds in common through a keeper.
  Requests queue; the lender signs the hand-over and the deposit received, and
  the return with anything kept and why; borrowers can say they returned it and
  dispute what was kept; the network settles disputes and declares losses. A
  **solidarity fund** can stand behind the deposit of any member who asks, up to
  a limit: what a covered loan keeps or loses becomes a claim the fund pays.
- **make-solidarity.sh** founds a cooperative solidarity network on it: the
  Solidarity Pledge, Principles and a handbook; a Coordinator, Treasurer and
  Librarian, elected; a Solidarity Committee that settles disputes and gives
  mutual aid two signatures at a time; a budget with deposit-cover, mutual-aid
  and commons lines; boards for offers and requests; shared tasks.

## 0.9.3 · A republic's own website

- **Site folder for headless republics** (`"site": "website"` in node.json): a
  republic without the page module serves that folder's `index.html` at `/`
  and its files (HTML, CSS, JS, SVG, fonts, images) beside the record, the
  window and `/acts`. Paths cannot leave the folder.
- **The Virtual Democratic Republic** (`sites/vdr`, `make-vdr.sh`): a liberal
  democratic micronation built on windows. Open citizenship, an Assembly of
  all citizens, a President, Speaker and Secretary of State elected by approval
  voting, a Supreme Court, and a written Constitution enacted at founding. Its
  website draws the Assembly as a hemicycle, one seat per citizen, coloured by
  their vote on the bill on the floor. Three pages: the floor; **the Laws**
  (the Constitution and every statute, versions, redlines, history, and
  amending, enacting or repealing by bill, with the Constitution never below
  the constitutional rule); and **Institutions**, where every installed module
  draws itself through its own ui.js, so a module the Assembly installs appears
  with no change to the site. Citizens join, sign in and sign on the site.

## 0.9.2 · Private republics

- **Private mode** (`"private": true` in node.json): the node serves nothing
  but a sign-in page, the public program code, and an application form until a
  member signs in. Members prove who they are by signing a one-time challenge
  in their browser, with their password, key file, passkey, or the key the
  browser keeps; nothing secret is sent. A session lasts twelve hours. The
  record, the page, votes, windows and every other address answer only to a
  signed-in member; applicants cannot sign in until admitted. No cross-origin
  access in private mode.
- Candidates apply from the sign-in page, and read and sign whatever
  membership requires (with a drawn signature where required) before the
  members admit them.
- `make-society.sh` founds the society in private mode.

## 0.9.1 · Loans and an endowment

- **loans**, a new module: an interest-free revolving loan fund. Capital is
  added by decision (`loan.fund`); loans are made within what is available,
  `loans.max_amount` and `loans.max_open` (`loan.make`); repayments return to
  the fund (`loan.repay`); only a decision forgives what is left
  (`loan.forgive`). Usually granted to a committee of stewards, two signatures
  each. Overdue loans are shown, not punished.
- **endowment**, a new module: a permanent fund. Gifts are principal, never
  spent; the treasurer records its value; each year up to
  `endowment.spend_rate` (4% by default) of its latest value may be drawn, never
  below the principal, for the loan fund or the budget.
- `make-society.sh`: a sealed secret society with degrees, mutual aid, the loan
  fund, the endowment and a budget.

## 0.9.0 · Windows, sealed content, the page as a module

- **The page is a module** (`page`). With it, a node serves the republic's page
  as before; without it, the republic runs headless: its record, signed acts and
  windows work, and its front door says so. Every preset includes it, and the
  control panel's guide ticks it. **Upgrading an older republic: install `page`
  first**, or it becomes headless; `upgrade check` and `upgrade propose` say so.
- **Windows** (`window.js`, docs/WINDOWS.md): show a republic on any website,
  verified in each visitor's browser. Elements for the seal, any variable
  (officers, office-holders, grants and their holders, money in circulation,
  balances, settings, open votes, decisions, statutes), lists and live votes;
  `connect()` for JavaScript, with live streams (`/window/events`) and
  comparison against other copies. Writing (votes, joining, any act) happens in
  a signing window served by the republic's own node, which shows exactly what
  is signed; the host website never sees a key or password.
- **sealed**, a new module: content only members can read. Members publish an
  encryption key derived from their own signing key; key periods seal a group
  key to every member; posts are encrypted in the browser or terminal, and the
  record holds no readable content, so anyone can hold and verify a copy.
  Nothing new can be sealed while anyone holding the current key has left: the
  next sealed act must start a new period without them. `sealed.history` says
  whether newcomers may read earlier periods. X25519 (RFC 7748) written out in
  plain JavaScript, checked against the RFC's test vectors; AES-256-GCM and
  HKDF from the platform's Web Crypto. `entity seal` does it all from the
  terminal.
- The page gives modules `api.key()`, the signed-in member's key for
  decrypting (not passkeys, which cannot).

## 0.8.1 · No terminal needed

- **`entity app`**, the local control panel: a page on this computer
  (http://127.0.0.1:7700) that creates republics with a six-step guide (basics,
  a starting preset, modules, every setting with its explanation, look and
  serving, a review), then runs and looks after them: serving, node settings,
  a settings setter (proposals, voted at once when you are the only member),
  modules, passwords, Radicle, copies, upgrades, checks, and any other command.
  It listens on 127.0.0.1 only, answers only to its own name, and needs the
  secret token it prints at start; every operation runs the republic's own
  command line, so the panel and the terminal always agree.
- **`entity password set | remove`**: the terminal can now do what the page's
  *Ways to sign in* does.
- On a republic's page: **Lay reading 2** on a proposal awaiting a further
  reading, and **Propose anything (written out)** for effects and settings no
  tab has a form for. Every operation can now be done on the page or panel, or
  in the terminal.

## 0.8.0 · Contracts and disputes

- **contracts**, a new module: deals between two members, paid in the entity's
  value units through escrow. Offered, accepted (the payment is held from the
  payer), marked done, confirmed (paid to the provider), or collected by the
  provider once `contracts.release_days` pass with no dispute. Cancelled only
  by both. A Contracts tab shows each deal, its terms and fingerprint, and what
  each side can do next.
- **disputes**, a new module: claims between members, about a contract (its
  escrow freezes) or anything else. The other side answers; the arbiter
  (`disputes.arbiter`: an office, a committee by majority, or a member) rules
  with reasons; either side may appeal within `disputes.appeal_days` to
  `disputes.appeal` (another body, the members by proposal, or none); the
  ruling then moves the escrow, or pays from the loser's balance, with what
  they lack recorded as owed. Parties never rule; whoever ruled first never
  hears the appeal, and barred members do not count toward a majority. An
  unpaid ruling bars new contracts until it is paid. Optional deposits
  discourage frivolous claims. Evidence is recorded by its SHA-256
  fingerprint, computed in the browser; the files go to the parties directly.
- **value:** holds, an amount set aside from a balance by another module
  (`state.m.value.held`), which only that module pays out or returns.

## 0.7.9

- Licence: © 2026 Timothy Schoonover, all rights reserved (previously MIT).
  Earlier copies received under MIT keep that licence; this and later versions
  do not.

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
