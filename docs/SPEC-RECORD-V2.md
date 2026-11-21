# Record format v2 · sealed records

November 2026. Status: **implemented** in `kernel/sealing.js`, the command
line, nodes, copies that sync, and the browser page. It has not had an outside
review.

What changed while building:
- Grants are part of `epoch.open`, and `records.history` defaults to `full`.
- A key period opened because one was needed takes effect at the head (§2).
- Keyrings learn every key period before opening anything (§5).

## What changes, and what does not

Today anyone holding a copy can replay every act. With sealed records, only
members can. The premise becomes:

> Copy the directory and you have copied the entity. **Anyone** can verify it
> has not been altered. **Members** can verify everything and read
> everything, needing nobody.

The following stay exactly as they are:

- **The chain rule.** `hash = H(prev ‖ canonical(record minus hash))` holds
  for both record shapes, so chain checks, attestations and checkpoints work
  unchanged over sealed records. A perfect rewrite is still caught by anyone.
- **Settlement is deterministic.** Two members settling the same acts write
  byte-identical records, ciphertext included.
- **Acts and their signatures.** A sealed record carries the same signed act a
  public record does, inside the ciphertext.

## 1 · Two record shapes

A **public record** is today's record (v1), unchanged:

```
{ seq, at, author, kind, payload, prev, hash }
```

A **sealed record**:

```
{ seq, prev, sealed: { v: 2, epoch, siv, kc, ct }, hash }
hash = H(prev ‖ canonical(record minus hash))
```

- `epoch` is the key period, a positive integer.
- `siv` is the synthetic IV (32 bytes, base64). See §3.
- `kc` is the key commitment (32 bytes, base64). See §6.
- `ct` is AES-256-GCM of the plaintext body (base64).

The plaintext body is `canonical({ at, author, kind, payload })`, padded (§7).
A record's shape is told by the presence of `sealed`. One record file may hold
both shapes. Records before sealing was switched on stay public.

## 2 · Key periods (epochs)

Each epoch has a random 32-byte **epoch key** `E`, made by the member who
opens the period. From it:

```
macKey      = HKDF(E, salt = utf8(entity), info = "entity/record/v2/mac", 32)
applicantSk = clamp(HKDF(E, salt = utf8(entity), info = "entity/record/v2/applicant", 32))
applicantPk = X25519(applicantSk, 9)
```

An epoch is opened by a **public** record of kind `epoch.open`, from a signed
act whose payload is:

```
{ n, applicantPk, wraps: { <memberId>: { enc, ct } }, grants?: { <memberId>: { <m>: { enc, ct } } } }
```

- **Wraps.** Each wrap is `HPKE.Seal(pk_member, E, info = "entity/epoch/v1\n" ‖
  entity ‖ "\n" ‖ n)`, using RFC 9180 base mode with X25519, HKDF-SHA256 and
  AES-256-GCM (`kernel/crypto.js`).
- **What settlement checks.** It checks the shape only: the signer is an
  active member, `n` is the next epoch, and there is exactly one wrap per active
  member. It cannot check that the wraps open. A member whose wrap does not open
  says so with a signed `epoch.complaint`, and any member may then open a new
  epoch.
- **Member record keys.** Like sealed posts, documents and chat, they come from
  the signing seed, so a password user has the same key on every device:
  `sk = clamp(HKDF(seed, salt = 32 zero bytes, info =
  "entity/record/member-key/v1", 32))`. The public half is registered by a
  signed act (`member.recordkey`). Passkey users have no seed. They need the
  WebAuthn PRF extension, or a seed wrapped to their passkey (open question 2).
- **Keywraps.** A member who signs in more than one way (a key file and a
  password) has one record key, from the key that published it. Each other
  signing key opens it through a public, signed `member.keywrap { key, enc, ct }`:
  the record secret key, sealed by HPKE (info `entity/keywrap/v1 ‖ entity ‖
  member`) to `key`, the record key that other signing key's seed derives. A
  reader holding that key opens the wrap, then every key period the member can.
  It is always public, like `member.recordkey` and `epoch.open`. Settlement
  checks the member is active with a record key, that `key` is not the record
  key itself, and that the wrap is a sealed 32-byte key. A wrap is permanent: if
  that other key (the password) is exposed, the member publishes a new record
  key, which opens a new key period that the old one cannot.

**Grants.** A member's copy works out the present state by replaying every
record, so it needs every earlier key period's key. So, with `records.history:
full` (the default), an `epoch.open` must carry, for each reader not in the
current key period, a wrap of every earlier key period's key `E_m` (HPKE with
info `entity/epoch/v1 ‖ entity ‖ m`, as if they had been in it). Settlement
checks that the grants are there, for exactly those readers and periods.
`from-join` leaves them out. It works only for readers whose copies need not
replay what came before, which none do until state snapshots exist.

**What time it bears.** An `epoch.open` settled while one is needed (after a
departure, or when sealing starts) is recorded at the head's time, not its own.
The acts waiting for it, dated between the change and the new period, would
otherwise be older than the head and refused. Settlement holds every act after
the first that needs a key period, and tries them again within the same batch
once one opens.

**When a new epoch opens:**
1. **At founding**, as the first record after `entity.found` when sealing is on.
2. **After a departure.** When a member leaves or is removed, no further
   record may be sealed under the old epoch. Settlement holds sealed records
   until an `epoch.open` without the departed member settles. A reader's copy
   that settles a departure signs one at once. Likewise when a member who has
   published a record key waits to be included.
3. **By choice**, at any time, from any member.
Readers who are not in the current key period, and have published a record key,
wait to be included. They do not force a new period, but a reader's copy opens
one for them when it settles.

## 3 · Sealing a record deterministically

AES-GCM is safe only if a key and nonce pair is never used twice with
different plaintexts. Copies can fork: two settlers can each write a different
record at the same `seq`. So the key cannot depend on position alone. It is
derived from a keyed digest of the content, in the synthetic-IV pattern:

```
header = canonical({ entity, seq, prev, epoch })
siv    = HMAC-SHA256(macKey, header ‖ 0x00 ‖ body)
encKey = HKDF(E, salt = siv, info = "entity/record/v2/enc", 32)
nonce  = 12 zero bytes        (encKey is unique to this header and body)
ct     = AES-256-GCM(encKey, nonce, body, aad = header)
kc     = HMAC-SHA256(encKey, "entity/record/v2/commit")
```

**Opening:** find `E` for `epoch`, derive `encKey` from `siv`, decrypt, then
recompute `siv` from the plaintext and refuse the record if it differs.

**Why this holds:**
- The same act at the same place always gives the same bytes, so settlement
  stays deterministic.
- A different body, or the same body at a different `seq` or `prev`, gives a
  different `siv`, so a different key.
- `siv` is keyed, so it reveals nothing about the body to anyone without `E`.
  It does not even reveal whether two records say the same thing, because the
  header is part of its input.

## 4 · Acts in transit

A member's act travels to a node over HTTPS and through the Cloudflare tunnel.
In a sealed republic every act is sent as

```
{ sealedAct: { epoch, enc, ct } } = HPKE.Seal(applicantPk, canonical(act), info = "entity/act/v1\n" ‖ entity ‖ "\n" ‖ epoch)
```

so relays and the node see only ciphertext. Applicants use the same key: they
can write to the republic without being able to read it. Where it is done:
- **Bundles:** `bundleOf` seals every unsettled act.
- **Git:** the Radicle push seals `pending/` files before committing, from the
  latest public `epoch.open` (no key needed).
- **Nodes:** a node takes `{ sealedAct }` at `POST /acts`. It opens and checks it
  if it holds a reader's key, and keeps it sealed on disk either way.
- **The browser page:** seals every act it sends. The sign-in page seals
  applications to the key period it reads from `GET /auth/period`.

A sealed republic also keeps its register (`participants/`) and
`parameters.yml` out of git (`.git/info/exclude`), since they are derived from
sealed records. A node that holds no epoch key cannot settle. It only stores and
relays (zero-knowledge mode). Settlement runs on members' devices or on a node
run by a member.

## 5 · Verifying

| Who | Checks |
|---|---|
| Anyone with a copy | The chain over both shapes. Signatures on public records (`epoch.open` included). Attestations and checkpoints against heads. Sealed records are opaque but tamper-evident |
| A member | All of the above. Then opens every record it holds a key for, checks every `siv`, and replays the whole record. It must reproduce byte for byte, as today |

`entity verify` replays when it can and falls back to the chain when it cannot.
`entity verify --structure` is the chain alone. A keyring learns every public
`epoch.open` before opening anything, since a later one may grant an earlier
period's key.

## 6 · Showing one record to an outsider

To prove to an auditor or a court that record `seq` said something, a member
hands over `{ seq, encKey, body }`. The verifier:

1. checks the record is in a chain whose head they trust (attested or
   checkpointed);
2. checks `HMAC(encKey, "entity/record/v2/commit") = kc`;
3. decrypts `ct` with `encKey` and `header` and gets `body`.

**Why step 2 is needed:** AES-GCM is not key-committing. Without `kc`, someone
could construct a second key that opens the same ciphertext to a different
text. Disclosure reveals nothing about any other record, because `encKey` is
unique to this one.

## 7 · What sealing does not hide

- **Shape.** The number of records, their order, and when the record file
  grows.
- **Size.** It is hidden only to the nearest step. The body is padded with
  spaces before encryption to the next multiple of 256 bytes, or 4096 bytes
  above 16 KiB.
- **Public kinds.** `records.public` names the kinds settled as public records
  (`entity.found`, `epoch.open`, and whatever the members choose, such as
  enacted law or appointments).
- **Anything members can read.** A member can copy plaintext out. A former
  member keeps every epoch key they held.

## 8 · Turning it on

- **New republics:** a preset that sets `records.sealing: true`, or
  `entity fork --sealed` from an existing republic. The fork's founding record
  names the parent's members and keys, so a private fork shows which ids came
  from the parent.
- **Changing keys:** a member who rotates or recovers their signing key gets a
  new record key. The next key period grants them every earlier one again.
- **Existing republics:** a decision that sets `records.sealing: true` from a
  given seq. The decision needs the constitutional rule, as a change to who
  can read the record. Everything before stays public, because copies of it
  exist. To start with nothing public, fork into a new sealed republic that
  names this one as its parent.
- **Code:** sealed records need a core that knows them. An older core refuses a
  record with `sealed`, as it refuses any unknown shape. The core version is
  raised when this lands.

## Open questions

1. **Rotation lag** (settled on Day 2). Settlement waits. A reader's copy opens
   a key period as soon as it settles a departure, so in practice the wait is
   one settlement.
2. **Passkeys.** Use the WebAuthn PRF extension where it is supported. Where it
   is not, wrap the member's record key to a recovery key held by k of n
   members.
3. **`epoch.complaint`.** Not built. Until it is, a member whose wrap does not
   open asks any reader to rotate (`entity records rotate`).
4. **Padding sizes.** These are a guess. Measure real acts first.
5. **Zero-knowledge nodes** (settled on Day 3). A node with no member's key
   serves the record, takes sealed acts and absorbs sealed bundles that extend
   its own chain, without replaying. It never settles; members' copies and
   browsers do. It cannot judge between diverging sealed histories, and its
   sign-in wall can check only members named in public records.
6. **Review.** The construction in §3 should be read by someone who has not
   seen it before it carries real records. It is built only from standard
   parts (HMAC, HKDF, AES-GCM, HPKE), but their arrangement is ours.
