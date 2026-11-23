# Changes

## 0.9.42 · The Wiki look in LaTeX's own type; wiki pages as LaTeX PDFs

- **The Wiki look is set in Latin Modern**, the face LaTeX sets (shipped in `interface/fonts/`), for text and headings alike, at a size that reads as well as the old sans-serif. The sign-in page and House settings use it too.
- **Open as PDF**: every wiki page, at the version on screen, is set in LaTeX and compiled to PDF (`/documents/wiki/<page>.pdf`, `?v=` for an earlier version), with the hub's name, the page's version, author and date. **The whole wiki as a PDF** (`/documents/wiki/all.pdf`): a title page, a contents page, the categories as parts and each page as a section, with links between pages. Whoever may read the wiki on a node may open them; a private node's gate (or a house hub's) decides that. Compiled with pdflatex and cached (`cli/wikipdf.js`, through `cli/documents.js`, which now runs a second pass when there is a contents page or cross-references).
- The Markdown becomes LaTeX safely: headings, emphasis, code, links (with their address as a footnote), lists, quotations, tables, code blocks, rules, and pictures from the entity's media folder as figures with captions; every special character is escaped, a page cannot close its own code block, and a picture from elsewhere is named, not fetched. Characters LaTeX cannot set become "?".
- Tests: test/wikipdf.test.js.

## 0.9.41 · The Wiki look; Markdown on the standard page

- **The Wiki look** (`"look": "wiki"` in node.json, or chosen in Settings): the page as an encyclopedia, in the familiar style of Wikipedia's Vector skin but written for Athènes, not copied from it (Vector is GPL): a white sheet on a pale grey page, sans-serif text, serif titles and section headings over a hairline rule, blue links (purple once visited), tables as "wikitables", cards as infoboxes, the sections as a tab strip, light and dark. It is in `interface/style.css`, where presentation is not governed, and every rule is scoped to the look. The sign-in page and House settings follow it (`/signin/brand` and `/house/status` give the node's look). `make-loth-hub.sh` sets it.
- **Markdown on the standard page**: the wiki's pages (and any module that asks for `api.markdown`) are drawn from their Markdown, as on the site kit: headings, emphasis, lists, links, pictures with captions, quotations, tables (`interface/js/markdown.js`, the same safe renderer).
- Fixed: a house hub's sign-in page stopped part-way ("Cannot set properties of null") because it removed the application form that other code still used; it now hides it.

## 0.9.40 · House hubs: the house Wi-Fi and a house password open a private hub

- **House access** (node.json `"house"`, `cli/house.js`): a private node can also let in, to read and to make an account, anyone on the house's network and anyone who types the house password. On the network means a direct connection from the house Wi-Fi's private ranges (`house.networks`), or a visit through the Cloudflare tunnel from the house's own public address: found every half hour from Cloudflare's trace page (`house.detect`, IPv4 and the IPv6 /64), plus any listed in `house.publicIps`. The tunnel's visitor address (`CF-Connecting-IP`) is believed only on connections from the node's own machine. The password is kept as a scrypt hash; it gives a browser a signed cookie for 30 days, which ends when the password changes; ten wrong guesses from one address pause it for 15 minutes. Applications to join are taken only from the house.
- **House settings** (`/house/settings`): the hub's admins (`house.admins`), signed in as themselves, change its name (shown on every page, the sign-in page and the Home Screen app), the house password, the house network and the admins. None of it is in the record.
- **`entity house`**: the same from the Pi: `status | on | name | password | admin add|remove | address add|remove | detect on|off | off`.
- The sign-in page of a house hub asks for the house password, and sends anyone on the house network straight in; `?next=` returns a member to the page they wanted. The page shows how a visitor got in, "Sign in or make your own account", and House settings; joining a house hub sends the application straight to its node.
- **`make-loth-hub.sh`**: the Lothlórien Unofficial Minihub, a private hub with a wiki and notifications (admission open: being let in is the check). `REPLACE=1` archives an existing folder to `~/entities/archive/` and replaces it, keeping its port.
- Tests: test/house.test.js (addresses, the cookie, and a running hub: the house address, the password, a forged cookie, joining, admins only, a new password, the pause).

## 0.9.39 · The Orchard GP: no taxpayer numbers, private certificates, direct elections, amendments by vote, a constitution page

- **`details.tin`**: off, the particulars form (on the website and in the invitation sign-up) asks for no taxpayer number and none is accepted. The Orchard GP turns it off; agreement 4.2 says the Treasurer collects Forms W-9 separately.
- **`partnership.certificates: own`**: each partner sees only their own certificate, on the page and as a PDF, officers included.
- **Direct elections** (`election.call { direct: true, vote_days }`): every active member is a candidate unless they decline, and voting opens at once. The Orchard GP drops the Treasurer–Secretary incompatibility; the founder holds both offices until the partners hold an election ("Hold an election" on the Partners page). Agreement 8.1 says so.
- **Amending the agreement by vote**: "Propose a change" on the Agreement page writes the next version and lays a resolution to enact it (wiki.enact_rule) in one step; open amendments show how many lines change.
- **The Constitution page** (Orchard website): every setting in force as articles of numbered sections: a plain title, the value in words, its meaning, and the resolution that changes it; a table of the kinds of resolution. Read from the record in the browser.
- **The Secretary's Modules page**: the modules installed and those that can be added, each proposed with one click (node.json `modulesOnline` on for the Orchard GP). The site kit's menu can show a page only to an office's holders.
- Fixed: with a password sign-in, opening or saving one's own particulars used the password key's own record key instead of the member's (now `sealing.memberSecret`, through the keywrap).
- Tests: direct elections (library/elections/tests.js); the Orchard browser journey checks each change as the founder and as a partner.

## 0.9.38 · A password opens sealed records

- **`member.keywrap`** (core 0.9.11): a member's record secret key, sealed to the record key their other signing key derives (a password, say), in a public signed act. A reader with that key opens the wrap, then every key period the member can. Key periods are unchanged, so older records replay as before. Spec: SPEC-RECORD-V2.md, "Keywraps".
- **`entity records password`** writes it, from the machine holding the member's key file; `make-orchard-gp.sh` runs it at founding, so the founder's password opens the records from the start. For a republic founded before: `node cli/index.js records password --as ID --settle`.
- After a password sign-in the page keeps, for that tab only, the record key the password derives (it reads; it cannot sign). A new tab asks for the password once (the site kit's unlock dialog).
- The Orchard website explains when this device's key cannot open the records, instead of loading forever.
- Tests: the keywrap in kernel tests (test/sealing.test.js); a password-only sign-in and a new tab in test/browser/orchard.py.

## 0.9.37 · The Orchard GP on its own website; the Treasurer alone keeps the books

- **The Orchard GP's website** (`sites/orchard-gp`): a members' site for an investment club, served by its private node, so visitors see only the sign-in page (now showing the club's name, node.json `brand`). Partners see an Overview (club value, unit value, their stake, what needs them, open votes, top holdings, recent activity), a Portfolio (holdings with cost, price, gain and weight; approved trades awaiting execution; every transaction; capital accounts; proposing a trade), Partners (register, officers, applicants), and Votes, Meetings, the Agreement, Certificates, My details and Invitations drawn by their modules. The Treasurer's desk on the Portfolio (payments in, executed trades, prices, income and expenses, payouts) is shown only to the Treasurer. No accessibility violations (axe, WCAG 2.1 AA) in light or dark.
- **`fund.bookkeeper`**: an office (treasurer) whose holders alone record anything on the books, under a grant to it: payments in, trades done, prices, income, expenses, payouts and opening balances. A resolution of the partners can no longer record them. Every partner still reads every line. `import-holdings.sh` follows it: the Treasurer records the opening balances, and the units that follow capital go to the partners.
- **`partnership.associations`**: off, the partnership joins no association and grants no claims; the associations are not shown.
- The Orchard GP drops notifications, shared files (Docs), chat, polls and associations; the wiki stays only to hold the agreement's text and is not shown. The agreement says the Treasurer alone keeps the books and every partner may read them (8.2, 11.1), and that the partnership joins no associations (10.2). Default port 7795.
- Site kit: `config.js` may name a `brand` and `hide` tabs; module views get the records and know which tabs are hidden; long values (a drawn signature) are shortened in the signing box; the signing box says "the partnership’s record" on a private site.
- Invitations: the link just made stays on screen when the page redraws after signing.
- Founding scripts put a new hostname above any wildcard rule in the Cloudflare tunnel's config; below it, the hostname was never reached (every such site answered 404).

## 0.9.36 · Invitation links, partner particulars, certificates and signed agreements as PDFs

- **New module: invites.** Personal invitation links (`/signin?invite=ID.SECRET`): only the secret's hash is on the record; the person applies, signs, gives their particulars and is admitted once, under the core's admission checks. Created and withdrawn by the members or an officer's grant; `invites.max_days`.
- **New module: details.** The particulars a partnership needs for its returns and filings (legal name, date of birth, addresses, contact, tax status and number, certification), encrypted in the member's browser to the member and to the officers in `details.readers`, kept off the record by the node (`.entity/details/`); the record holds a digest. Readers open them, export CSV for the returns, and re-share with new officers. `kernel/details.js`, `cli/details.js`, `POST /auth/details`.
- **Drawn signatures.** `agreements.drawn_signature: required` has every partner draw their signature, signed with the act; a partner who signed without one may add it once. The sign-in page signs the agreement, files particulars and accepts an invitation in one flow.
- **Certificates and signed agreements, on the page and as LaTeX PDFs**, with the drawn signatures of every officer in office (certificates) and of every signer (agreements): `cli/documents.js`, `entity documents`, `/documents/certificate/N.pdf` and `/documents/agreement/PAGE.pdf` (partners only; a certificate to its holder or an officer). Needs pdflatex on the node.
- **The Orchard GP** (`make-orchard-gp.sh`, `presets/orchard-gp.yml`) uses all of it: invitations granted to the Secretary, particulars required, drawn signatures required (the founder signs on the page); agreement sections 4.1, 4.2 and 9.1 on admission, particulars and retention.
- The page's module API gives modules the records (`api.records`); exported signatures are drawn in black, whatever the theme.
- Tests: library/invites/tests.js, library/details/tests.js, test/browser/orchard.py (in run.sh when pdflatex is present); test/orchard-gp.test.js signs with a drawing.

## 0.9.35 · Privacy, first part; the page, redesigned; sealed notifications; the Orchard refounded

- **Upgrading republics from 0.9.34, rehearsed.** Republics founded with 0.9.34 upgrade by vote to this core (update-republics.sh now sees a new version), their records replay byte for byte, and sealed posts written before still open with the new cryptography.
- `tools/deploy.sh --rehearse` (and `tools/deploy.sh local`, run on the Pi itself from a checkout there, with no ssh): upgrades copies of the Pi's republics with the new code and reports, changing nothing live. The deploy's header check now uses GET and follows a private node to its sign-in page (a HEAD request is answered 405). update-republics.sh leaves running servers alone when `ENTITY_NO_STOP=1`.
- A web app manifest (`/manifest.webmanifest`, named after the republic): added to a phone's Home Screen, the page opens as an app, which iPhones and iPads (iOS 16.4+) require before they deliver its notifications. The page says so on an iPhone. `interface/sw-basic.js` is a fallback service worker for browsers that cannot run a module one; it shows only "Something new".
- Websites built on `window.js` (the club site, the VDR, the solidarity network) open a sealed record with the key of the member signed in on that device, and say plainly that a record is sealed when there is none, instead of failing.
- **make-orchard-gp.sh** refounds The Orchard General Partnership (Berkeley, California) on this code: sealed record and private node from the first record; the minimal partnership agreement (`presets/orchard-gp-agreement.md`), enacted and signed on the record, required of every partner before admission; every trade a joint resolution of the partners and of the units, never delegated; an elected Treasurer and an elected Secretary (the founder serves as Founding Secretary until the first election); participation required and enforced; alerts for trades to vote on and reminders before votes close; two-factor sign-in (required of everyone when mail is configured); the EIN, set by a sealed decision just after founding so it never appears in the public founding record; and a legal register (`presets/orchard-gp-legal.md`) of federal, California and Berkeley obligations with a calendar. `test/orchard-gp.test.js` runs it end to end.
- **New module: participation.** Each partner's standing from votes and meeting check-ins, formal notices (an effect, granted to an officer), and the cure period the agreement allows before removal.
- notify: `trades` (a proposal to buy or sell opens) and `reminders` (a member who has not voted, `notify.remind_hours` before close) events; participation notices go to their partner only.
- partnership: `partnership.ein` and `partnership.office` settings.
- `membership.removal_rule` and `fund.trade_rule` may name any of the entity's rules (a partnership's joint rule, for instance), as `membership.admission_rule` already could.

- **New module: notify.** Members are told of new proposals, decisions, members joining or leaving, and notices any member posts (`notice.post`), each notice sealed with HPKE to the member's own record key before it is written anywhere (`kernel/notice.js`). Delivered by Web Push to their devices (RFC 8291 payload encryption and RFC 8292 VAPID, `cli/webpush.js`, no dependencies; reproduces the RFC's example byte for byte and interoperates with Mozilla's http_ece and web-push), kept in an inbox the page opens on the device, or announced by email or text message that says only that there is something new (titles in clear only if the republic allows it and the member chooses).
  - Subscriptions are kept by the node (`.entity/notify/`), never in the record, and every request is proved with the member's record key, so a zero-knowledge node can take them too; it sends only a sealed "something new", at most hourly.
  - The page: You → Notifications (this device, email, text; which events; where notices go), Home → Notices for you, a Notices tab. `interface/sw.js` opens pushes with the member's key; a locked key shows "Something new".
  - `entity notify status | send | subscribe | list | unsubscribe | inbox`; `entity serve` delivers, with retries.
  - Settings: `notify.events`, `notify.broadcast`, `notify.plaintext_email` (constitutional).
  - A record key may be published without sealing, for notices.
  - Tests: test/notify-crypto.test.js, test/notify.test.js, library/notify/tests.js, test/browser/notify.py. CI installs the two independent libraries for the interop test.

- **The page, in the house style of tschoonover.com** (the Athens look, now the default): paper and ink, Helvetica for the frame, Latin Modern for reading (the fonts ship with the page), § numbered sections. The masthead carries the site's pills: text size, English or French, light, dark or as the system. The other looks remain a viewer's choice; node.json `"look"` still sets a republic's default.
  - Home: what needs your vote, as cards with turnout and share meters and the ballot; what else is open; what happened lately, in words; this copy's health (verified, sealed, key period); and cards from modules.
  - A composer (`#/compose`): find a setting, give its new value, see the change and the rule it needs (with its readings as a timeline), sign. Every setting's "Propose a change" opens it.
  - Settings drawn from their own descriptions, grouped, searchable, each with its value, its rule and a change button. A proposal's page shows its meters and its life as a timeline. The Votes tab counts what needs your vote.
  - On a phone the sections sit at the bottom, within reach.
  - `interface/js/kit.js` (components), `screens.js`, `i18n.js` (English and French for the shell and new screens; the rest follows), `athens.css`.
  - Module UI contract, second edition: a module's ui.js may export `cards(api)` for Home, and gets `api.kit` and `api.t`. Meetings, budget and offices do.
  - The record: this copy's health and its key periods at the top, each record described in words and marked sealed or public; a sealed record's page says how it is stored and shows the ciphertext on request.
  - Members: who reads the sealed record (in the current key period, waiting for one, or without a record key); a member's page shows their record key and key periods. The law is set in the reading face.
  - You: who you are, how your key is kept (lock it, save a copy), the sealed record (and a button to publish your record key), what to do if you lose your key, and leaving, as cards.
  - French for the shell, Home, the composer, settings, You, and the record's and members' headings and tables; the rest of the page falls back to English.
  - Accessibility: every screen passes axe-core's WCAG 2.1 A and AA checks in light, dark and French. The light theme's secondary text is darker than tschoonover.com's (#6B6A64, 5:1) to meet them; the composer's setting picker is a group of toggle buttons with a name.
  - test/browser/gui.py, test/browser/a11y.py, and test/browser/run.sh to build the test republics and run every browser check.

- **The control panel** (`entity app`) in the same look, following the device's light or dark. Its founding guide asks first who can read the record: members only (sealed, the default) or anyone; a sealed republic is founded with the founder's record key, the first key period and a private node. New republics default to the Athens look.
- `tools/deploy.sh user@pi`: packs the code (never state), tests it on the Pi, swaps it in keeping the previous copy, updates the republics by vote, restarts them, then runs the privacy check and checks each public hostname's security headers. docs/DEPLOY.md: the Pi, the Cloudflare Tunnel settings that matter (no page rewriting, no cache-everything, full TLS), and turning on sealing in a live republic.

- Every response carries security headers (`cli/security.js`): a Content Security Policy that runs only the node's own scripts and the inline scripts of the page being sent (by hash), no framing, nosniff, HSTS over HTTPS. node.json `"csp"` allows more origins, or `report-only` / `off`.
- One privacy switch: `entity radicle init` follows node.json `"private"`, refuses `--public` for a private republic, and `--private` makes the node private too.
- make-orchard-group.sh, make-orchard.sh and make-sealed-republic.sh make the node private, as their Radicle copies already were (make-orchard.sh: `ORCHARD_PUBLIC=1` for both public).
- A private node no longer tells strangers who has signed an agreement, which ids are applicants, or which modules its source offers.
- A node without `library/` (a copy made by dist or clone) starts again: the docs checks load when first needed.
- docs/PRIVACY-AUDIT.md, and `tools/privacy-check.mjs`, which reports what each republic on a machine shows to strangers.
- One implementation of public-key encryption, `kernel/crypto.js`: native X25519 (RFC 7748) from Web Crypto with a portable fallback, HKDF, AES-GCM and HPKE (RFC 9180), checked against the published vectors and two independent libraries. Sealed posts, documents and chat use it; every key derivation is unchanged, so everything sealed before still opens. Low-order public keys are refused everywhere.
- `entity key lock | unlock | status`: private key files locked with a passphrase (scrypt, AES-256-GCM). `ENTITY_LOCK_KEYS=1` locks new keys; `ENTITY_PASSPHRASE` or `ENTITY_PASSPHRASE_FILE` for unattended signing.
- Core 0.9.10: sealed records need it; the sealed and docs modules need 0.9.9, since their crypto now lives in the kernel.
- **Sealed records** (`records.sealing`, a constitutional decision; docs/SPEC-RECORD-V2.md). The record on disk holds ciphertext only members open; anyone can still check the chain, and attestations still catch a perfect rewrite. Settlement stays deterministic: two members settling the same acts write the same bytes, and copies that fork never reuse a key.
  - Key periods: a reader (an active member with a record key) opens one with `epoch.open`, wrapping its key for every reader and granting earlier periods' keys to newcomers. A departure needs a new one before anything more is sealed; a reader's copy opens it as soon as it settles.
  - Acts travel sealed: in bundles, in git's `pending/`, and to a node's `POST /acts`. Applicants can write without being able to read.
  - The register and `parameters.yml` stay off git in a sealed republic.
  - `entity records status | key | rotate | disclose <seq> | check <file>`; `entity verify --structure` for anyone; one record can be disclosed to an outsider and checked against its key commitment.
  - The browser page opens sealed records on the device with the member's own key (asking for its password if locked), verifies them there, and seals every act it sends; with no key it checks the chain and says the record is sealed. The sign-in page seals applications.
  - Zero-knowledge nodes: a node with no member's key serves and relays a sealed record, takes sealed acts and sealed bundles, and never settles.
  - `entity fork --sealed`: a private republic from any republic.
  - A member who changes their key is granted every key period again.
  - test/browser/sealed.py: a sealed record in the real page, through a zero-knowledge node.
- docs/SPEC-RECORD-V2.md: the design of sealed records.
- CI on every push; `test/contract.test.js` checks every module ships its files and every setting is described; the top-level `.gitignore` is back, anchored.

## 0.9.34 · Repairs

- athenes.sh repairs an entity an older installer left half-updated (a newer command line on older code): it adds the missing files when that is enough, and otherwise installs the new core, checks that it replays the record exactly, and puts the old code back if not.
- Radicle publishing at founding gives up after a minute instead of holding the installer; the website's record is not put on Radicle at all.
- Founding no longer writes DNS records outside poezine.org with the wrong certificate (`athenes.sh dns` writes them).

## 0.9.33 · A plainer website

- The published site no longer shows the count of signed acts in its footer, nor a page listing the record; the footer is only your own line.
- No square beside the name in the masthead.
- Empty folders left after a page is taken down are removed.

## 0.9.32 · A personal website kept as a record

- New module **site**: posts, projects, photographs, a résumé and a home page, every version signed and kept. `site.post`, `site.project`, `site.photo`, `site.resume`, `site.profile`; each edit names the version it starts from, so nothing overwrites a change its author has not seen.
- `make-site.sh` founds a site entity (the founder decides; co-authors by decision).
- `tools/site.mjs` signs what changed in a folder of Markdown (`sync`), watches it (`watch`), starts posts and projects (`new`). Pictures go into `media/`; a hosted project's folder is packed so the same files always give the same hash.
- `tools/publish-site.mjs` turns the record into the public site: pages, an Atom feed, a sitemap, thumbnails, a versions page for anything edited, a page listing the record, and a LaTeX PDF (Pandoc and XeLaTeX, Latin Modern) of every post and of the résumé. Hosted projects are unpacked where tsite serves them as SLUG.domain.
- `tools/import-tsite.mjs` starts the Markdown folder from a tsite site's content.json.

## 0.9.31 · One command to update everything

- `bash athenes.sh`, run from a freshly unzipped athenes.zip, now does everything: installs the new code (keeping the two previous copies), updates every hosted entity, refreshes their websites, writes Lothlórien's pages with their photographs, points DNS at the tunnel and starts it all. Run again with nothing new, it only checks DNS and starts everything, so it is also the command to use after the Pi restarts. `bash athenes.sh update` forces the update step; `bash athenes.sh up` only starts.
- Entities are updated by their own decisions: `update-republics.sh` proposes each core upgrade and each newer module, preferring the module code in this copy of the library, and votes for them as you. Where you are the only voter they install at once; elsewhere they wait for the other members, and the next run finishes. The installer no longer copies command-line files into entities.
- `tools/refresh-website.mjs` refreshes a kit website from the new code, file by file: files still as they were built are replaced, files you edited are kept, with the new version beside them as `.new`.
- `update-lothlorien.sh` takes `PAGES_ONLY=1` to write only the photographs and pages.

## 0.9.30 · Pictures and fuller Markdown

- Texts on kit websites (wiki pages, pledges, anything rendered with Markdown) now support pictures and figures with captions, tables with column alignment, quotations, code spans and blocks, struck text, rules, four levels of heading, and links to other pages of the site (`#/page`). Everything is escaped first; a link or picture keeps only an http(s) address, a page of the site, or a picture in `media/`.
- Pictures live in each entity's `media/` folder, named by the first 32 hex digits of their SHA-256, so a signed page names exactly one picture and any copy can check it. The folder is committed with the entity and travels over Radicle. Only JPEG, PNG, WebP and GIF are kept, read from the file's first bytes, at most 8 MB.
- `entity media add <file>`, `media fetch <url>`, `media list` and `media check`. The node accepts `POST /media` from an active member who signs for the picture's hash, and serves `/media/` (members only in a private republic).
- The wiki editor has an "Add a photo" button that uploads, signs and inserts the Markdown, and a reminder of the Markdown a page may use. Existing entities adopt it by upgrading the wiki module.
- Wiki pages set as PDF letters print their pictures (from `media/`, or downloaded once from an http(s) address), their tables and their code. Pictures pdflatex cannot set print as their description.
- Lothlórien: the researched pages gain the 1895 photograph of the North House and an early one of the South House (both public domain, from Wikimedia Commons), a timeline, the room-count comparison, the managers and the workshift limits as tables, and the constitution's description as a quotation. `make-lothlorien.sh` downloads the photographs into the house's `media/`. `update-lothlorien.sh your-id [folder]` brings an existing house up to date: the command line and website, a proposal to upgrade the wiki module, the photographs, and new versions of the pages you wrote.

## 0.9.29 · Researched pages for Lothlórien's wiki

- Five starter pages for the Lothlórien wiki in `presets/lothlorien-wiki/`, each with numbered citations and a sources list: the history of the house (from the 1880s North House to the 2026 constitution), the houses and grounds, council and consensus, workshift, and food and the kitchen. Where sources disagree (the North House's year, the room count, how the One World Family handed the houses over) the page gives both.
- `make-lothlorien.sh` writes them when it founds the house (`LOTH_SAMPLE_PAGES=0` skips them). `add-lothlorien-pages.sh your-id [folder]` writes them into a house that already exists and leaves any page that is already there alone.
- The kit's Markdown now makes links: `[text](https://…)` opens in a new tab. The "How to write here" page already promised this.
- `athenes.sh start` now also starts tsite (tschoonover.com, its project subdomains and poezine.org) on port 8080, the old PHP apps if PHP is installed, and a Radicle sync loop for each entity, so it replaces `~/tsite/deploy/start-all.sh`. It adds tsite's names to the tunnel when they are missing. `status` shows tsite and whether the tunnel runs.
- `athenes.sh dns` writes the DNS record for every poezine.org name in the tunnel and prints the CNAME records to add by hand for tschoonover.com, since `cloudflared tunnel route dns` only writes in the zone chosen at login.
- Wiki pages set as letters print a link as its text with the address after it in small type, broken after slashes; a link whose text is the site's name prints the address alone. Entities already holding the letters module keep their installed copy until they adopt the new one.

## 0.9.28 · The International Co-operative Housing Federation

- **make-ichf.sh, sites/ichf:** the ICHF (International Co-operative Housing
  Federation · Fédération internationale de l'habitat coopératif) and two
  national federations, the NACHF (English, French, Spanish) and the FFHC
  (French), each its own entity, on one website with its own stylesheet. The
  ICHF is officially bilingual: its names, mottos, founding texts, chat
  channels, letterheads and website exist in English and French, with a switch
  in the masthead. A Council of Federations (three delegates each) and a General
  Assembly (fifteen seats by membership) decide together; Co-Presidents, a
  Secretary-General and a Treasurer are elected by all members; Executive,
  Clearing and Translation Committees; labor credits (1.00 = one hour of
  co-operative work), paid for verified work and sent between members of any
  federation; wiki, chat, letters and voting.
- **republic:** `republic.acronym`, `republic.languages` and `republic.names`
  (a name, acronym and motto in each official language).

## 0.9.27 · Lothlórien, the Society's board, and opening balances

- **make-lothlorien.sh, sites/lothlorien:** a members-only house wiki, private
  from the first request, in its own quiet paper-and-moss stylesheet.
- **upgrade-society.sh:** turns an existing Digital Republic Society into the
  planning society for new cooperatives in place, by four motions of the
  Conclave: the letters module; five planning rooms on the board, moderated by
  the Warden; the Conclave's letterhead; the Manifesto (presets/drs-manifesto.md)
  adopted on the wiki and issued as a signed letter. Safe to re-run.
- **The wiki as letters:** `entity letter wiki [PAGE…] [--pdf]` sets each page
  on a letterhead (the version in force, or the latest) in letters/wiki/. With
  node.json `"wikiLetters": { "letterhead": … }` the node re-renders whenever a
  page changes. The node serves letters/ at /letters/, to signed-in members
  only on a private site. The Letters tab lists them.
- **fund.opening:** a club that already holds money and securities brings them
  into its books once, by decision: cash, each holding with its cost basis and
  price, and every partner's capital account, which must add up.
  **import-holdings.sh** reads presets/holdings-template.csv, sets partnership
  units to capital, and lays the resolution. The club (make-club.sh) now keeps
  books with the fund module, kept by the Treasurer under a published grant.
- **kit:** wiki pages render their Markdown; a private site's footer no longer
  calls its record public.

## 0.9.26 · The Commune

- **make-commune.sh, sites/commune:** the People's Commune of the Long Table, a
  council-communist micronation on windows. A Congress of all comrades; a
  Council of seven delegates elected by season (90 days) and recallable by any
  ordinary motion, making laws that wait fourteen days for a petition of one
  comrade in ten; a Presidium of three that acts only unanimously and issues
  decrees within a grant (`where: { type: decree }`); five People's Commissars
  each within a published grant; a Control Commission that hears disputes.
  Laws are typed fundamental, organic, law, decree, plan and parametric. Work is
  paid one labour voucher per verified hour (tasks, value), and vouchers cannot
  be transferred. A flag, motto, anthem, calendar of seasons, holidays, honours
  and two letterheads. The website shows the comrades as chairs around a round
  table, the organs of power from the Congress down, labour and the Plan, the
  Fundamental Law and the symbols.
- **letters:** title cards (`#`), passages in smaller type (`>`), a star in
  seals, three-column signatures kept together on one page.

## 0.9.25 · Letters

- **letters (new module):** official letters on standard letterheads. A
  letterhead belongs to the members, an office or a committee; a letter on it
  is issued only by that issuer: the members by decision, an office or
  committee through a grant it holds. A committee issues jointly, by a majority
  or (`joint: all`) unanimously, and the letter names who signed and whether it
  was unanimous. Letters show their signatories, each with a drawn signature if
  they have deposited one (`letter.specimen`). A house style (`letters.face`,
  `letters.accent`, `letters.layout`, …) that each letterhead may adjust; a
  round seal set in small capitals. Letters are withdrawn under the same
  authority, with a published reason; an amended letterhead never changes a
  letter already issued.
- **cli:** `entity letter` lists, shows, issues, co-signs and withdraws letters,
  and renders any letter, or a specimen of a letterhead, as LaTeX and PDF.
- Sample letterheads: Lothlórien's Finance Manager; the VDR's Ministry of
  External Affairs and Executive Committee (by majority, and unanimous).

## 0.9.24 · Amending the partnership agreement

- **The partnership agreement is amended by a supermajority:** a joint-super
  resolution, two thirds of the partners and two thirds of the units
  (section 5.4). Amendments that add contributions or liability, or take away
  withdrawal or inspection, still need each affected partner's consent (5.5).
- **Single readings:** the partnership preset sets every rule to one vote;
  make-club.sh no longer moves the constitution to two readings a month apart.
- **A rule-typed parameter is changed under the rule it names, if stronger**
  (core): lowering the bar for amending the agreement takes clearing it.
  `wiki.enact_rule` is now of type `rule`, so it may name a preset's own rules.

## 0.9.23 · The investment club

- **Concurrent rules (core):** a rule may name a second electorate
  (`concurrent: "shares:units"`): the same ballots are counted again, by units,
  and the proposal carries only if both counts carry. Presets may add rules of
  their own (`rules:` and `order:`). A parameter may be of type `rule`.
- **partnership:** associations joined by decision, claims on profits and on
  assets granted and ended under their own rules, and partnership certificates
  read from the record: issued on admission and reissued whenever units change.
- **elections.incompatible:** offices one person may not hold together.
- **make-club.sh, presets/partnership.yml, sites/club:** an investment club as a
  California general partnership: joint, associate (60%) and joint-super rules;
  Treasurer, Secretary and Audit Committee, each elected on its own; the Audit
  Committee alone signs checkpoints; a private website with the register,
  resolutions counted by partners and by units, associations, and printable
  certificates; a draft partnership agreement and a compliance checklist.
- **cli:** `entity propose` accepts `--admit` alone.

## 0.9.22 · The Federal Bank

- **value:** a committee may hold units, in an account named `committee:ID`.
  Units are issued into it (`value.issue`), destroyed from it (`value.revoke`) and
  paid out of it (`value.pay`, new) only by decision or through a grant of power;
  members may send units to it. Committee accounts have no vote under the
  `value` electorate.
- **sites/federation/bank.html:** the Federal Bank's page: the reserve, the money
  in circulation and the total; motions to issue or destroy, each member's vote,
  and what was decided.
- **make-federal-bank.sh:** sets it up in a federation that exists: upgrades the
  code and the value module, installs committees and authority, creates the
  committee federal-bank with powers bank-issue and bank-destroy, and adds the
  page. It votes for every member whose key (or password) it is given.

## 0.9.21 · Documents

- **docs:** documents written together. Your own: encrypted in your browser,
  shared by role (viewer, commenter, editor, owner) with a person, every member,
  an office or a committee; archived or left. The entity's: created by decision,
  drafted by whoever it names, and changed only when a decision (or a committee
  or office granted `docs.adopt`) adopts a draft, from the version in force. A
  document may ask for a stricter rule than `docs.adopt_rule`.
- **The text never goes on the record.** Versions, comments and key wraps are
  content-addressed files in `documents/`, each signed by its author and checked
  against the record by the node and again by every page. Encrypted documents
  are sealed per epoch (X25519 → HKDF → AES-GCM); removing someone starts a new
  epoch at the next opening. Radicle carries `documents/` with the repository,
  and `entity sync` takes peers' files that match their names.
- **docs.html** in the site kit, linked from every site's masthead when the
  module is on: library, Markdown editor with preview, three-way merge when two
  people save at once, comments on passages, history with redlines, drafts,
  votes, sharing. `make-docs.sh` founds a writing room with it as the home page;
  `add-docs.sh` adds it to republics that exist.
- **gate:** `documents/` needs no decision to change (the record decides who may write it).
- **cli:** `entity propose --admit id[,id]` admits applicants by decision.

## 0.9.20 · Own websites come first

- **serve:** a republic with its own website (`"site"` in node.json, as every
  `make-*.sh` with a `sites/` folder sets) now serves that website at `/` even
  when the page module is installed. Before, installing the page module (which
  `update-republics.sh` does) silently replaced a window site with the standard page.
- **update-republics.sh:** no longer installs the page module in a republic that
  has its own website.
- **Mahjong looks:** Traditional, Minimal, Swiss, Art Deco, Arcade and High
  contrast, each its own design, kept in a cookie. `setup-games.sh` sets up Nomic
  and a mahjong world on the Pi, Radicle and the tunnel, picking free ports.

## 0.9.19 · Mahjong

- **mahjong:** Hong Kong mahjong on a deterministic engine with an AI of
  strength 1–5. Solo games for a member's profile (the deal's own record hash
  is the shuffle; the finished game is replayed by the record before it counts)
  and the results of multiplayer tables, replayed with seeds that must match
  their commitments.
- **Live tables (`cli/mahjong.js`):** friends sit with a name and a browser-made
  key, no account; AIs fill empty seats; commit-and-reveal walls checked in every
  browser; timers for claims and turns; finished matches recorded by the keeper.
- **`sites/mahjong`:** a rosewood table with ivory tiles; solo play, tables,
  standings; and `mahjong-solo.html`, the whole game in one offline file.
- **`make-mahjong-world.sh`:** one world per run, each its own entity and Radicle repository.

## 0.9.18 · Nomic, a conlang society, and a betting club

- **nomic:** the game where changing the rules is a move. Mutable and immutable
  rules, turns, points for passing proposals, winning and new games, and calls
  for judgment answered by an appointed judge.
- **lexicon:** a constructed language made by vote. A dictionary whose every
  word must fit the language's own sound system (letters and syllable shape are
  settings the record enforces), seconding, adoption in batches, and a grammar
  ratified section by section.
- **wagers:** bets in points, never money: pools, over/under lines, head-to-head
  challenges and an LMSR prediction market, held in escrow and resolved by an
  elected arbiter who may not bet, with appeals to a vote.
- **Three websites on the kit, each with its own look:** `sites/nomic` (a game
  board on graph paper), `sites/conlang` (a field linguist's lexicon),
  `sites/wagers` (a racecourse tote board). A site's `site.css` now imports the
  kit's stylesheet as `kit.css`, so its look reaches every page, the kit's own
  pages too.
- **`make-nomic.sh`, `make-conlang.sh`, `make-wagers.sh`**, sharing
  `found-common.sh`.

## 0.9.17 · Digital state symbols

- **Favicons for the VDR and the Federation**, drawn to the pixel at 16 and 32
  px, with dark and one-colour versions, an SVG favicon that switches to the dark
  field in dark mode, PNGs, and an app icon cropped from each flag
  (`sites/<state>/icons`). Every site page now links them.
- **The founding seal** (`interface/js/seal.js`): an emblem drawn only from the
  hash of an entity's first record. `entity symbols seal` draws it;
  `entity symbols fingerprint` gives the SHA-256 of files.
- **`adopt-symbols.sh`** installs the icons and seal on a state's website and
  lays the Symbols Act, with every fingerprint and the genesis hash written in:
  a statutory law in the VDR, a motion in the Federation.

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
