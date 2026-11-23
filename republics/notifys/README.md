# Notify.S

The Berkeley Co-operative Notification System: emergency alerts for the co-op houses,
from a central team to everyone and from each house's team to that house.

Three pieces, each small enough to read in one sitting:

| Piece | Where | What it holds |
|---|---|---|
| The rules | `library/notifys/index.js` | Who may do what. Every act is checked here; nothing else decides. |
| The routes | `library/notifys/server.js` | What the website reads. Read-only. |
| The website | `republics/notifys/site/` | Pages that show each person the buttons they may use, and sign what they do. |

The design philosophy (why the rules are what they are) is in the PDF
"Firm where it matters, open everywhere else": invariants nobody can switch off,
defaults that nudge toward good practice, and freedoms each house keeps.

## Common changes

- **Change the website** (wording, layout, colours): edit `site/`, then `bash republics/notifys/ship-site.sh`. Nothing else moves; no restart.
- **Change the rules** (a new role, a new field on alerts): edit `library/notifys/index.js` and its `tests.js`, run `node --test library/notifys/tests.js`, then in the republic `entity module upgrade notifys`. The upgrade replays the whole record with the new code before it is accepted.
- **Change the colours**: the palette is the first block of `site/site.css`. Red means urgent and nothing else; green is everything ordinary.

## Founding

    bash republics/notifys/make.sh tim notifys "" notify.tschoonover.com

You become the first admin, with one house (Lothlórien). The stylesheet underneath
is Pico CSS (MIT; `site/PICO-LICENSE.md`).
