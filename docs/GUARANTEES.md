# What is protected, and what is not

A system overstating its guarantees is more dangerous than one having fewer.

## Protected — and tested

- **Altering a record** is detected at that record and every one after. (2)
- **Forging or altering an act** is refused: signatures cover exactly the
  material `signedMaterial` names, in a namespace per purpose. (3, 4)
- **Replaying a signature** for another purpose, or into another entity, fails:
  namespaces separate purposes and every act names its entity.
- **Believing a result**: ballots are counted from the record, never read from a
  result. A close act or a gate check that claims otherwise is refused. (13)
- **Deciding under too weak a rule**: refused at proposal, naming the rule; the
  strictest rule governs combined changes; the unchangeable few are refused at
  proposal and cannot be founded otherwise. (10, 11, 12)
- **Settlement is deterministic**: two copies settling the same acts produce
  byte-identical records. This is what makes automation safe. (1)
- **Perfect rewrites** (a record removed, the rest re-chained so it verifies and
  replays) are caught by attestations, by checkpoints, and by a browser that has
  visited before. (7, 8)
- **Exit** cannot be prevented, by any rule.
- **Who votes is fixed when a proposal is laid.** The roll and its weights are
  taken from the record at that moment; joining, buying units or being appointed
  while a vote is open changes nothing about it. (decisions tests)
- **A decision cannot leave nobody able to decide.** Emptying the electorate by
  decision (removing the last councillor, vacating the office) is refused, unless
  the decision freezes the entity on purpose (`decision.electorate: none`).
  Removal never removes the last active member.
- **Delegation never lowers the bar.** A grant needs the strictest rule of every
  power it hands out; a grant made under a grant is no wider than its parent and
  falls with it; creating offices or committees and granting authority are never
  delegated unless a grant says `delegable: true`. Every use of a grant is checked
  exactly as the same effects would be checked in a decision, and published.

- **Over Radicle, nothing is trusted for arriving by Radicle.** Peers' records
  are verified before they are absorbed; divergent histories are refused and set
  aside; a peer's code or law is adopted only as a carried decision approved
  exactly those bytes. Git never merges the record. (Tested against real nodes.)

## Not protected — named

- **Tail truncation looks like lag.** Removing only the final records is
  indistinguishable from a copy that is behind, until the missing records are
  fetched. Attestations then show it; nothing shows it sooner.
- **No consensus.** Copies that settle different sets of acts diverge. This is
  detected (attestations, `sync` refuses to fold in), never silently resolved.
  Combining them is a deliberate act: `entity repair --merge <bundle>`.
- **Time is asserted by the signer.** `at` is what the signer wrote. Settlement
  refuses acts dated before the head of the record; the CLI holds future-dated
  acts pending. Within those bounds a signer chooses their own time, which
  matters for deadlines. A participant who signs offline and syncs late must
  re-sign.
- **Keys at rest are not encrypted.** CLI keys are unencrypted OpenSSH files
  outside the entity directory; encrypt the disk. Browser keys live in that
  origin's IndexedDB: anything able to run script on the origin serving the page
  can use them. Serve the page from an origin you trust, and save a copy.
- **Open admission admits anyone**, as many times as they have keys. Choose
  `membership.admission: decision` where that matters.
- **A clone brings the record, not the files.** Law texts and code travel in the
  distribution archive or version control. The record binds approved code
  changes by digest (`code.approved`); `entity gate --against` compares trees.
  Nothing forces a host to run the gate: run it in a pre-receive hook.
- **Purity of `check` and `apply` is enforced by review** and by test 6, not by
  the runtime.
- **Checkpoints' `previous` links are recorded but not yet walked** by `verify`.
- **Thresholds are exact.** `0.67` is not two thirds: 2 of 3 does not carry a
  constitutional change. Write `0.666` if two thirds is meant.
- **Early close freezes cast ballots.** Once a proposal's outcome cannot change
  given the uncast votes, it closes; a later change of mind is published as
  "cast after close".
- **The node has no rate limit.** It checks signatures before accepting an act,
  so only registered keys (or self-signed applications) can fill `pending/`.
- **Modules the presets name but that do not exist yet** — roles, units,
  allocation and the rest — are listed as `awaiting` and never pretended.

- **A password on a key is only as strong as the password.** A locked key sits
  encrypted in the browser's storage; someone holding the device can try
  passwords offline, slowed by 310,000 rounds of PBKDF2 per guess. It protects a
  lost or shared laptop against casual use, not against a determined attacker
  with a weak password. The password cannot be recovered: keep a saved copy of
  the key.

## Over Radicle, also

- **Concurrent settlement forks the record.** Peers settle only acts older than
  `settleAfter` seconds (default 600 on Radicle), so acts usually reach everyone
  first, and settlement is deterministic, so equal acts give equal records. Forks
  still happen. They are refused and saved in `.entity/incoming/`; merging with
  `repair --merge .entity/incoming --resettle --write` rebuilds the history after
  the fork. Anyone who attested, or whose browser saw, the old history will then
  see a divergence warning. That is correct: tell them why.
- **Radicle's canonical branch is Radicle's, not the entity's.** `rad clone`
  checks out what Radicle's delegates (at first, the founder) publish. The clone
  is verified by replay, but its code arrives unexamined: compare it with
  `entity gate --against` or a copy you trust before running it.
- **Anyone may publish a namespace.** Every peer is followed, since an applicant
  must be heard before they are registered. Everything arriving is verified; the
  cost is only bandwidth.
- **A public repository is public.** The record holds every act, id, name and
  key. Radicle's private repositories (`entity radicle init --private`) are not
  tested here.
- **A passphrase-protected Radicle key cannot double as an entity key.** Join
  without `--radicle` to use a separate one.
- **`sync` publishes your working tree** to your namespace, drafts of governed
  files included. That is how drafts are shared, and why nothing is taken from a
  namespace except by `adopt`.

## Signing in — named

- **A password can be guessed offline.** Every public key is on the public
  register, so anyone can try passwords against a member's password key without
  asking anyone. scrypt makes each try cost about 32 MB of memory and a fraction
  of a second, and the page refuses short or common passwords, but a weak
  password can still be found. Long passphrases (several ordinary words) are
  safe; members who can, should prefer a passkey.
- **A password cannot be recovered or reset by anyone.** Nobody has it. Sign in
  another way and set a new one, or ask the members for a new key.
- **A passkey is tied to its website.** A passkey made on one address cannot
  sign on another. If the entity moves to a new address, members add a new
  passkey there (their old ones keep counting for what they already signed).
- **Every copy checks passkey signatures itself:** what was signed, the website,
  that a person was present, and the signature, exactly as for keys.

## Signatures — named

- **An act is recorded once.** It is identified by everything it says except
  its signature, so resending it, re-encoded or not, is refused (fixed in 0.5.4;
  before, anyone could replay a public act by re-encoding its signature).
- **Keys on disk are not encrypted.** The command line keeps private keys in
  `~/.entity/keys` (or `ENTITY_KEYS`), readable only by your user account.
  Protect that folder like a password manager's.
- **A key in a browser without a password is readable by any code the page
  runs,** and module pages are code the members approved. A password on the key
  limits that to the moment of signing.
- **Timestamps are the signer's.** A live node holds any act dated ahead of its
  own clock until that time comes, so an act cannot close a vote early or push
  the record's time forward. A node whose own clock is wrong can be fooled.
- **Checkpoint files are evidence, not consensus.** The checkpoints in
  `record/checkpoints/` bind once `record.checkpoint_cosigners` members sign
  (2 by default): two who collude can sign a false history. For checkpoints
  that decide, use the finality module.

## Finality — named

- **Final is final, given an honest majority of validators.** With more than
  half (by default two thirds) of the signing weight needed, two final
  checkpoints of different histories need at least one validator to sign both,
  and that validator's own signatures convict them. If a majority of the
  validators collude, they can finalise what they like: every system of this
  kind rests on that assumption. Copies holding the true history see the
  contradiction, the evidence names who did it, and the rest can fork.
- **Provisional records can be replaced.** Records after the last final
  checkpoint may be set aside if another copy's history becomes final first;
  their acts are settled again on top, and may then be refused (a double spend
  is refused here). Treat nothing provisional as settled, payments above all.
- **The first checkpoint is the weak link.** Its signers are whoever they are
  when it opens; later ones are anchored to the one before. Open it early.
- **Newcomers must check with more than one source.** A brand-new copy fetched
  from a single dishonest peer could be shown a false history with forged
  "final" checkpoints signed by that peer's friends, if they are the anchored
  signers there. Compare the head with other members' attestations, or with a
  head published somewhere you trust, before relying on it.
- **Liveness needs validators.** If more than a third of the signing weight is
  absent, nothing new becomes final (nothing is lost either); a decision can
  re-anchor signing.
- **Penalties are only as strong as what is at stake.** Exclusion always
  applies; fines need the value module and something to fine.

## Who decides — named

- **An electorate is as fair as its definition.** "founder" is one person;
  "value" is one unit, one vote, so whoever holds most decides most; an office or
  committee electorate is whoever the record says holds it. The software makes
  each of these exact and verifiable. It does not make any of them legitimate.
- **Leaving can freeze an entity.** If the only person on the electorate leaves
  or resigns, nothing can be decided again. Exit is unconditional, so this cannot
  be prevented; name more than one person where it matters.
- **Recovery can take over a vote.** Giving a member a new key by decision
  replaces the key they hold. A majority could use it to act as someone. The
  page flags every recovery on the member and the proposal; members should
  confirm with the person before voting for one.
- **A frozen entity is frozen.** With `decision.electorate: none`, no rule,
  module, parameter or member can be changed by decision again, including
  unfreezing it. Forking is the only way on: a new entity, naming this one.
- **A frozen currency still has no finality.** Two conflicting transfers signed
  by one holder and sent to different copies make those copies diverge. It is
  detected, never resolved: there are no validators yet.

## Forks — named

- **A fork's origin is checkable, not automatic.** `entity verify` checks a fork
  against the parent's records it keeps; a fork published without them cannot
  be checked until someone supplies the parent's record. Compare its head with
  the one the parent's own members attest.
- **Anyone holding a copy can fork.** A fork carries the parent's name in its
  founding act, but it is a different entity with its own members; being a fork
  of something confers no authority from it.
- **Carried balances are carried, not shared.** After a fork, the same units
  exist in both entities, independently: this is what a cryptocurrency hard
  fork is. Say so to anyone who holds them.
- **Forks need a 0.5 core to replay.** An older core would not reserve the
  parent's members' ids, and would reach a different result.

## Modules from outside

- **Code is pinned, not trusted by address.** A decision records the digest of
  the exact code it approved; every copy checks it before installing, and a
  mismatch is refused. A repository changing afterwards changes nothing.
- **But approved code is trusted.** A module runs in every settlement and in
  members' browsers, next to their keys. The digest proves the code is what was
  voted on, not that it is safe. Review it before voting.
- **A copy without a module's code settles nothing** until it has fetched it, so
  copies may lag but never settle differently. If a source disappears and no copy
  or pack holds the code, the entity cannot settle until someone supplies bytes
  with the right digest (any source will do).
- **Modules present before 0.3.1** were not installed by decision and carry no
  recorded digest. `entity module list` shows them as "present, never approved".
- **Radicle sources are not tested here;** git, directory and pack sources are.
  GitHub sources use git over HTTPS.
- **Publishing on settlement** pushes the whole working folder, as `sync` does:
  drafts included.
