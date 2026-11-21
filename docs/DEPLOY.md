# Deploying to the Raspberry Pi, behind Cloudflare

How the republics on tschoonover.com and poezine.org are run: one Raspberry Pi,
each republic in its own folder under `~/entities`, each served by
`entity serve` on its own port, and one Cloudflare Tunnel giving each a public
hostname. Nothing listens on the open internet; the tunnel dials out.

## Sending new code

From a laptop holding this repository:

    bash tools/deploy.sh pi@raspberrypi.local                 # every republic
    bash tools/deploy.sh pi@raspberrypi.local orchard         # just one
    bash tools/deploy.sh --dry-run pi@raspberrypi.local       # print the plan

First rehearse: `bash tools/deploy.sh --rehearse pi@raspberrypi.local` upgrades
copies of every republic in `/tmp/entities-rehearse` with the new code, verifies
them, and changes nothing live.

It packs the code (never a record, settings, keys or git history), runs the
tests on the Pi, swaps `~/entities/entity` for the new code keeping the old one
as `entity.prev`, runs `update-republics.sh` (which proposes the upgrade in each
republic and votes for it as you), starts the servers again with
`~/tsite/deploy/start-all.sh`, then runs the privacy check and asks each public
hostname for its security headers. To undo a deploy on the Pi:

    cd ~/entities && mv entity entity.bad && mv entity.prev entity && bash ~/tsite/deploy/start-all.sh

Upgrading a republic is a decision of its members: where you are not the only
member, the upgrade stays open until they vote, and that republic keeps running
its current code meanwhile.

## Running it on the Pi itself

With a checkout on the Pi (no laptop, no ssh):

    git clone https://github.com/ttschoonover/entity ~/entity-src   # or: cd ~/entity-src && git pull
    cd ~/entity-src
    bash tools/deploy.sh --rehearse local
    bash tools/deploy.sh local

Certificates and signed agreements as PDFs need TeX Live on the Pi, once:

    sudo apt install texlive-latex-recommended texlive-pictures texlive-fonts-recommended

Without it everything else works and the PDF links say what to install.

## Turning on sealed records in a live republic

Sealing (`records.sealing`) is a constitutional setting. After the deploy:

    cd ~/entities/orchard
    node cli/index.js propose --title "Seal the record" --changes '{"records.sealing": true}' --as tim
    # … the members vote; once it carries:
    node cli/index.js records status

Two things to know before proposing it. Sealing applies from the vote on:
what was recorded before stays as it was, readable by anyone who already holds
a copy (and on Radicle, if the copy was public). And the republic's own
constitutional rule decides how long it takes: some need two readings a month
apart. A republic made before 0.9.35 may also lack `"private": true` in
node.json; the privacy check reports it (F1), and it is set by hand.

Each member's own copy publishes their record key the next time it settles
(or they press "Publish my record key" on the You screen); the first reader's
node opens a key period for everyone with a key. Records made before the switch
stay as they were (see docs/SPEC-RECORD-V2.md on history). A node holding no
member's key can still serve a sealed republic: it relays sealed acts and
serves ciphertext, and members' browsers open it.

## The Cloudflare Tunnel

`~/.cloudflared/config.yml` maps each hostname to a local port:

    tunnel: poezine
    credentials-file: /home/pi/.cloudflared/<id>.json
    ingress:
      - hostname: orchard.poezine.org
        service: http://localhost:7880
      - service: http_status:404

`found-common.sh` adds the entry for a new republic and `cloudflared tunnel
route dns` creates its DNS record. Things to get right in the Cloudflare
dashboard:

- **Caching.** Every answer from `entity serve` carries `cache-control:
  no-store`, which Cloudflare respects. Do not add a "Cache Everything" rule
  for a republic's hostname: members would see a stale record.
- **HTTPS.** Set SSL/TLS to *Full* and turn on *Always Use HTTPS*. The node
  sends `Strict-Transport-Security` when Cloudflare tells it the visitor came
  over HTTPS (the `cf-visitor` and `x-forwarded-proto` headers).
- **Streaming.** The live feeds use server-sent events. Named tunnels pass them
  through; quick tunnels (`trycloudflare.com`) buffer them, so use a named one.
- **Do not let Cloudflare rewrite pages.** Rocket Loader, Email Obfuscation,
  Auto Minify and injected analytics add inline scripts, which the page's
  Content Security Policy refuses: turn them off for these hostnames.
- **Privacy.** Cloudflare terminates TLS, so it sees what passes. With sealed
  records that is ciphertext and sealed acts; the sign-in and password exchange
  are the remaining plaintext. A republic that must not trust Cloudflare at all
  is served over Radicle or on a private network only.
- **Optional gate.** Cloudflare Access can put a login in front of a private
  republic's hostname. It is not needed for confidentiality once records are
  sealed, but it hides even the ciphertext and the fact of activity.

## Notifications

With the notify module enabled, `entity serve` delivers notices. Push works
with nothing to configure (the node makes its VAPID key on first use, in
`.entity/notify/keys.json`; keep that file with backups or members must set
up their devices again). For email, text messages and absolute links, add to
node.json:

    "notify": {
      "url": "https://orchard.poezine.org",
      "subject": "mailto:you@example.org",
      "mail": "/home/pi/bin/notify-mail",
      "sms": "/home/pi/bin/notify-sms"
    }

Each command gets `NOTIFY_TO` and `NOTIFY_SUBJECT` in its environment and the
text on standard input; a mail one can be as small as

    #!/bin/sh
    { printf 'To: %s\nSubject: %s\n\n' "$NOTIFY_TO" "$NOTIFY_SUBJECT"; cat; } | msmtp -t

Push needs the page served over HTTPS (Cloudflare does that) or on localhost.

## Checking a machine

    node ~/entities/entity/tools/privacy-check.mjs --online

reports, for each republic, what a stranger can see: whether the node is
private, whether its Radicle copy is public, what git would publish, and
whether the page is served with its security headers. docs/PRIVACY-AUDIT.md
explains each finding.
