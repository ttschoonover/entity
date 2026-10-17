# Windows

A window shows a Git Republic on another website: a co-op's own site, a blog, a
dashboard. The website stays an ordinary website; what the window shows is not
the website's to change. Each visitor's browser fetches the republic's record,
checks every signature and link with the republic's own code, and only then
shows anything. Signing happens in a small window served by the republic's own
node, never on the host website, which only learns the result.

## Adding one

Load `window.js` from the republic's node, then place elements:

```html
<script type="module" src="https://riverside.poezine.org/window.js"></script>

<gr-seal src="https://riverside.poezine.org/"></gr-seal>
<p>Money in circulation: <gr-var src="https://riverside.poezine.org/" name="supply"></gr-var></p>
<gr-list src="https://riverside.poezine.org/" name="offices"></gr-list>
<gr-votes src="https://riverside.poezine.org/" limit="5"></gr-votes>
<gr-join src="https://riverside.poezine.org/">Become a member</gr-join>
```

Elements render plain markup with `gr-*` classes (`gr-seal`, `gr-office`,
`gr-grant`, `gr-proposal`, `gr-tally`, `gr-error`, …), so the host site's own
stylesheet styles them.

| Element | Shows |
| --- | --- |
| `<gr-seal>` | the republic's name, its record length, verified in this browser; an alarm if copies disagree |
| `<gr-var name="…" arg="…">` | one variable, as text |
| `<gr-list name="…">` | a list: `offices`, `grants`, `committees`, `members`, `decisions` |
| `<gr-votes limit="…" [readonly]>` | open votes with live tallies, and buttons to vote |
| `<gr-act kind="…" fields='{…}' label="…">` | a button that signs any act |
| `<gr-join>` | a button to apply to join |

Add `also="https://mirror.example/ https://another.example/"` to any element
to compare other copies: if one disagrees, the seal says so plainly.

## Variables

| Name | Value |
| --- | --- |
| `name`, `id`, `founded`, `records`, `head`, `verified`, `modules` | the republic itself |
| `members`, `member-count` | active members, with display names |
| `offices` | each office, its title, seats and current holders |
| `holders` (arg: an office id) | who holds that office now |
| `committees` | each committee and its members |
| `grants` | each grant in force: title, what it may do, and who holds it now |
| `supply`, `currency`, `balance` (arg: a member id) | the value module's money |
| `settings`, `setting` (arg: a key) | every setting, or one |
| `proposals` | open proposals with tallies and deadlines |
| `decisions` (arg: how many) | the latest closed proposals |
| `statute` (arg: a wiki page) | the text of an enacted statute: title, body, version |

## From JavaScript

```js
import { connect } from 'https://riverside.poezine.org/window.js';

const r = await connect('https://riverside.poezine.org/', { also: ['https://mirror.example/'] });
r.ok;                          // the record verified
r.get('holders', 'treasurer'); // ['ana']
r.get('grants');               // [{ title, may, holders, … }]
r.on('record', (recs) => …);   // the record grew: every new record, verified
r.on('ballot.cast', (rec) => …); // any kind of record, as it arrives
r.on('disagreement', (urls) => …);
await r.act('ballot.cast', { proposal: 'd-…', choice: 'for' }, 'Vote for the budget');
```

`act` opens the republic's signing window, which shows exactly what will be
signed and signs it with the visitor's own key, password or passkey. It
resolves once the act is sent and the record has been verified again.

## Streams

Windows stay current by themselves: the node announces new records on
`/window/events`, and each window fetches and verifies them before showing
them. Every element repaints; `on(kind, …)` hears each new record by kind.

## Headless republics

A republic without the `page` module has no page of its own, but its windows
work all the same: a co-op can live entirely inside its own website, with the
record, the signatures and the verification still the republic's.

## Serving the page from the republic itself

A headless republic can host the page too. Put it in a folder inside the
republic, set `"site": "website"` in node.json, and import `./window.js`
relatively: the page and the republic then share one origin, so
`connect('./')` needs no address. `sites/kit` is a whole website built this
way, and two sites use it: `sites/vdr` (the Virtual Democratic Republic,
founded by `make-vdr.sh`) and `sites/solidarity` (the solidarity network,
founded by `make-solidarity.sh`). A founding script copies the kit, then the
site's own pages over it, into website/.
