# Privacy audit · entity 0.9.34

November 2026. Step 2 of the privacy-first plan: where a members-only
republic's information goes, who can read it there, and what to fix first.

**Scope.** The code in this repository and the module pack at 0.9.34, read
route by route, and a private node run locally and probed as a stranger would.
**Not in scope:** the live configuration on the Pi (node.json files, Radicle
visibility, the Cloudflare tunnel, the /status ticker), which is not in this
repository. `tools/privacy-check.mjs` checks most of it; the checklist at the
end covers the rest.

## Status

| Finding | Status |
|---|---|
| F1 setup scripts | **Fixed** in the scripts (Day 1). Republics already made: set `"private": true` by hand |
| F2 two switches | **Fixed**: `radicle init` follows the node, refuses `--public` for a private republic, and `--private` makes the node private too |
| F3 Cloudflare | **Fixed for sealed republics**: records and acts cross the tunnel as ciphertext, from the command line, nodes and the browser alike. Cloudflare still sees traffic timing and sizes. Republics not yet sealed are unchanged |
| F4 no CSP | **Fixed**: every response carries the headers (`cli/security.js`) |
| F5 sealing scope | **Fixed**: with `records.sealing` on, every record but the founding, record keys and key periods is sealed |
| F6 git publishes more | **Corrected**: `pending/` must replicate, so the fix is F2 |
| F7 agreement status | **Fixed** for members. The texts stay readable, since applicants need them |
| F8 applicant oracle | **Fixed** |
| F9 module list | **Fixed** |
| F10 ticker | Open: on the main site, not in this repository |
| F11 hand-written X25519 | **Fixed**: one shared `kernel/crypto.js` on native Web Crypto, checked against the RFC 7748, 5869 and 9180 vectors and against two independent libraries. Everything sealed before still opens |
| F12–F14 | Open: documented, low |

Each republic runs its own copy of the code, so a fix reaches it only when its
core upgrade carries (`update-republics.sh` proposes it and votes for you; other
members must vote where there are any). `tools/privacy-check.mjs` reports each
running node that still lacks the security headers.

## In one paragraph

The sign-in wall itself holds: in private mode nothing of the record, the law,
the register or the page answers a stranger, and path tricks are refused. The
problems are around it. **Privacy is three separate switches** (the node's
`private`, Radicle's `--private`, and what git publishes) that the setup
scripts set inconsistently, so a republic can be private in one place and open
in another. **Everything is plaintext to whoever carries it**: the Cloudflare
tunnel decrypts every request, Radicle peers hold every record, and sealing
covers only the bodies of sealed posts. And **the browser has no Content
Security Policy**, so any script that gets onto a republic's page can use the
member's key.

## Where the information lives, and who can read it

| Place | What is there | Who can read it today |
|---|---|---|
| The Pi's disk | Everything: record, register, pending acts, media, chat, emails for two-factor, SMTP password | Anyone with the Pi or its SD card. Not encrypted at rest |
| The node over HTTP | Private mode: sign-in page, code, agreement texts. Public mode: everything | Strangers (public mode, or the gaps in F7–F9) |
| Cloudflare tunnel | Every request and response, session cookies, IP addresses | Cloudflare, in plaintext (F3) |
| Radicle | Everything git publishes (F6) | Anyone, if the repository is public (F1, F2) |
| Other git remotes | Whatever is pushed | Whoever the remote allows |
| SMTP provider | Members' email addresses, sign-in codes, the republic's name | The provider (F13) |
| Members' browsers | Their key (IndexedDB), the node's address, a memory of the record's hashes | Anyone with the device; any script on the page (F4) |
| Members' copies | The whole record | Every member, and anyone they share it with. By design |

## Findings

Severity: **HIGH** means private information can reach strangers now, or will
with an ordinary setting. **MEDIUM** means it reaches a third party or leaks
metadata. **LOW** means a small leak or a hardening gap.

### F1 · HIGH · Three setup scripts make republics private on Radicle but public on the web

`make-orchard-group.sh:124`, `make-orchard.sh:150` and
`make-sealed-republic.sh:55` write node.json without `"private": true`, while
initialising Radicle with `--private`. `make-club.sh`, `make-lothlorien.sh` and
`make-society.sh` set both. A republic made by the first three serves its whole
record to anyone at `/record/events.jsonl` and `/bundle` unless the node was
made private afterwards by hand.

For the Orchard Group this matters most. Its `fund` acts (payments in,
withdrawals, units held, trades) are ordinary records, not sealed posts, so
each partner's capital is readable from the record even though the script's own
description says private matters are sealed.

**Fix now:** set `"private": true` in the Orchard Group's node.json and restart
it. Then check the others with `tools/privacy-check.mjs`.
**Fixed in code (Day 1):** the three scripts set `"private": true`.
`make-orchard.sh` takes `ORCHARD_PUBLIC=1` to make both the node and Radicle
public instead.

### F2 · HIGH · Node privacy and Radicle visibility are separate switches, and Radicle defaults to public

`cli/commands/radicle.js:66` publishes `--public` unless `--private` is passed,
whatever node.json says. `found-common.sh` passes `--private` only when the
script sets `RAD_PRIVATE`. So a private node can replicate its whole record to
the public Radicle network. Radicle cannot be called back: once a public peer
has the history, it keeps it.

**Fixed (Day 1):** node.json `"private"` is the one switch. `radicle init`
publishes privately when it is set, refuses `--public` for a private republic,
turns the node private when given `--private`, and warns if the repository is
already public.

### F3 · HIGH · The Cloudflare tunnel sees everything in plaintext

The node reads Cloudflare's `cf-visitor` header (`cli/commands/site.js:76`) and
the scripts add each republic to `~/.cloudflared/config.yml`. Cloudflare
terminates HTTPS at its edge and forwards to the Pi, so it sees every record,
vote, sealed-post title, chat metadata and session cookie. With a session
cookie it could read a private republic as that member. It cannot sign acts,
because keys never leave the browser.

**Fix:** encrypted records (steps 9–22), after which Cloudflare carries only
ciphertext. Until then, treat Cloudflare as able to read every private republic.

### F4 · HIGH · No Content Security Policy or frame protection on the page

The probe found `nosniff` and `no-referrer` on sign-in responses and nothing
else: no `Content-Security-Policy`, no `frame-ancestors` / `X-Frame-Options`,
no `Strict-Transport-Security`. Members' keys live in IndexedDB on the
republic's origin (unlocked unless they set a password), and module `ui.js`
files run in the same page. So any injected script, a compromised module, or a
page that frames the republic to trick a click, can sign as the member.

**Fixed (Day 1):** `cli/security.js` wraps every response. HTML gets a strict
policy: `script-src 'self'` plus the hashes of the inline scripts written into
that same file, and the origins of its own `<script src>` tags (windows of other
republics). No `unsafe-inline` for scripts and no `eval`, plus
`frame-ancestors 'none'`. Every response also gets `nosniff`, `X-Frame-Options`,
`Referrer-Policy` and a `Permissions-Policy`, and HSTS over HTTPS.
`node.json "csp"` can switch it to `report-only` or `off`, or allow extra
origins. Tested in a browser with no violations on the page and every tab, the
sign-in page, the kit pages and the mahjong site.

### F5 · MEDIUM · Sealing covers post bodies only

`library/sealed/index.js:72` keeps each sealed post's title in plaintext ("it is
not sealed"), and its author, time and key period are on the record. Every other
act (votes, funds, offices, agreements) is plaintext to anyone holding the
record: members, Radicle peers, Cloudflare.

**Fix:** say so on the form where a sealed post is written. Encrypted records
(steps 9–22) cover the rest.

### F6 · MEDIUM · Git publishes more than the record

Radicle push runs `git add -A` (`transports/radicle.js:133`) against the
entity's `.gitignore` (`cli/commands/radicle.js:10`), which excludes node.json,
`.entity/`, `settled/`, `refused/` and `site/`, but not `pending/`, `media/`,
`letters/` or the website folder. Unsettled acts, including applications with
applicants' names, and every uploaded picture are pushed with each settlement.
On a public Radicle repository, that is public.

**Correction (Day 1):** the first version of this audit said to ignore
`pending/`. That would break replication: peers read each other's unsettled
acts from `pending/` in their Radicle branches (`transports/radicle.js:83`).
The fix is F2 instead. A private republic's Radicle copy is private, so these
files stay among members. A public republic's pending acts become public
records once settled anyway.

### F7 · MEDIUM · Agreement texts and who signed them answer strangers

In private mode `GET /auth/required?for=ID` (`cli/commands/site.js:141`)
returns the full text of every required agreement and, for any id given,
whether that person has signed. The texts are shown so applicants can read
them. But a stranger can also use it to test whether an id is a member, and
read an agreement such as the Orchard Group's Partnership Agreement.

**Fixed (Day 1):** `signed` is answered only for a pending applicant, never for
a member. The texts stay readable, since applicants must read them before they
can sign.

### F8 · LOW · Sign-in reveals pending applicants

`cli/commands/site.js:170` answers "your application has not been admitted
yet" for an applicant's id before checking any signature. Active members and
unknown ids get the same message (confirmed by the probe), so this reveals only
who has applied.

**Fixed (Day 1):** the signature is checked first, so every failure gets one
answer. Only someone holding the applicant's key hears that the application is
pending.

### F9 · LOW · The module list answers strangers

`/modules/` is an open prefix in private mode (`cli/commands/site.js:64`), so
`GET /modules/available` answered the probe without a session. It shows the
module source and which modules are installed (`fund` says "investment club"),
and it makes the node fetch from GitHub on a stranger's request.

**Fixed (Day 1):** `/modules/available` is behind the session. Module code stays
open, since the sign-in page needs it.

### F10 · MEDIUM · The /status ticker publishes activity

The Athens page's ticker shows each group page's record count. For a
members-only republic that is activity metadata: when it is busy, and how much.
The ticker is not in this repository.

**Fix:** leave private republics out of the ticker, or show only that they are
up.

### F11 · MEDIUM · Three hand-written X25519 implementations, keyed from the signing key

`library/sealed/box.js`, `library/docs/crypto.js` and
`interface/js/chatcrypto.js` each implement X25519 with BigInt, which is not
constant-time, and each derives the encryption key from the member's signing
seed with its own label. AES-GCM and HKDF come from Web Crypto and are fine.

**Correction and fix (Day 1):** the first version of this audit called the
seed derivation "key reuse". It is not. Each system derives its key through a
labelled hash (HKDF or SHA-256 with its own label), which is standard domain
separation. It is also what lets a password user read on any device, so it
stays. What changed: `kernel/crypto.js` is now the single implementation. It
uses native X25519 where the platform has it (Node, current browsers) and the
old ladder only as a fallback, and it refuses low-order keys everywhere (the
sealed module did not). It is checked against the published RFC vectors, 200
random cases against Python's `cryptography`, and 80 HPKE round trips against
`pyhpke` and `@hpke/core`. Data sealed by the old code opens with the new
(`test/crypto.test.js`).

### F12 · LOW · Chat metadata is visible to the node

Members-only channels and direct messages are end-to-end encrypted, and kept
in `.entity/chat/`, never replicated. As `cli/chat.js:26` says, the node still
sees who wrote, when, and in which channel. Public channels are plaintext.
That's by design. Note it in GUARANTEES.

### F13 · LOW · Email two-factor goes through a third party

The SMTP provider sees members' addresses, their codes and the republic's
name. Addresses are kept in `.entity/twofactor.json` with mode 0600, which is
good. `mail.starttls: false` with a non-TLS port sends in plaintext
(`cli/mail.js:52`).

**Fix:** prefer passkeys. The checker flags plaintext mail.

### F14 · LOW · Radicle private repositories are untested here

Nothing in the code adds members to a private repository's allow list, and
GUARANTEES says private repositories are not tested. Members' nodes may not be
able to fetch a private republic at all. That's a functional problem, not a
leak. Test it in Phase 2.

## Notifications

The notify module (Day 6) was designed against this audit. What each party
can learn from a notice:

| Who | Sees | Does not see |
|---|---|---|
| The node's disk | Who is subscribed, how (endpoint host, email address, phone number), which events; sealed inboxes; when notices were sent | What any notice says (sealed to the member's record key) |
| A zero-knowledge node | The same, and only that something arrived | Any event at all |
| The push service (Google, Mozilla, Apple) | The endpoint, the node's VAPID key, each message's size and time | The notice (encrypted to the browser, and inside that sealed to the member) |
| The member's browser profile | The push, sealed | The notice, unless the member's key is in it unlocked |
| The mail or SMS provider | The address, that the group sent something, when | What happened, unless the republic allows plaintext email and the member chose it |
| Cloudflare | Subscription requests and inbox fetches (ciphertext notices, plaintext addresses when subscribing) | What notices say |

Remaining exposures, all low: email addresses and phone numbers sit on the
node's disk in the clear, as two-factor addresses already do (F13); timing
reveals activity; a member's own unlocked browser key opens their notices, by
design.

## What is already right

- **The sign-in wall holds.** The probe got 401 for the record, bundle, law,
  register, presence and window routes, and 403 for an encoded path traversal.
  The node binds to 127.0.0.1.
- **Secrets stay off the record and off git:** two-factor addresses, the SMTP
  password, chat, keys (in `~/.entity/keys`, outside the entity).
- **No third-party scripts, fonts or CDNs** in the page, the kit or the site
  theme. Visitors' browsers talk only to the republic.
- **Acts are signed**, so neither Cloudflare nor a forged request can act as a
  member, only read.
- **Members-only chat is end-to-end encrypted**, and the GUARANTEES document is
  candid about most of the above.

## What to do, in order

| When | What | Findings |
|---|---|---|
| Today, on the Pi | Run `node tools/privacy-check.mjs --online`. Set `"private": true` where it reports F1. Check Radicle visibility with `rad ls` | F1, F2, F6 |
| Day 1 morning ✅ | Security headers. One privacy switch for node and Radicle. Fix the three scripts. Close F7–F9 | F1, F2, F4, F6–F9 |
| Steps 4–8 | One audited X25519, separate encryption keys, HPKE, keys encrypted on disk | F11 |
| Steps 9–22 | Encrypted records: Cloudflare, Radicle and the Pi hold only ciphertext | F3, F5 |
| Main site | Leave private republics out of the ticker | F10 |

## Checklist for the live setup

Run on the Pi, in the folder that holds the republics:

```sh
cd ~/entities/entity && git pull                     # this audit and the checker
node tools/privacy-check.mjs ~/entities --online     # exit status 1 means a HIGH finding

# Each republic's privacy switches, by hand:
for d in ~/entities/*/; do
  [ -f "$d/node.json" ] || continue
  printf '%-28s private=%s\n' "$(basename "$d")" "$(node -p "require('$d/node.json').private===true" 2>/dev/null)"
done
rad ls                                               # the Visibility column, per repository

# What strangers get, from any machine off the Pi:
curl -s -o /dev/null -w '%{http_code}\n' https://group.tschoonover.com/record/events.jsonl   # want 401
curl -s -o /dev/null -w '%{http_code}\n' https://group.tschoonover.com/bundle               # want 401

grep -n hostname ~/.cloudflared/config.yml           # every republic Cloudflare carries
grep -rn "status\|ticker" ~/tsite/deploy | head      # where the ticker gets its counts (F10)
```
