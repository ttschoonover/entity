"""Drive the real page in Chromium against a running node.

    entity serve --settle &          # in a founded entity with open admission (e.g. the assembly preset)
    python3 test/browser/e2e.py http://127.0.0.1:7780/ <entity dir>

Checks: the page verifies; every tab and address draws without an error; a key
made in-page, locked with a password, applies and is settled; a proposal is
signed (the password asked for and a wrong one refused) and voted on, and its
own page shows the ballot; a member's page and a record's page open by address;
then the server's record is perfectly rewritten (a record removed, the rest
re-chained) and the page must say the record changed behind you.
"""
import sys, subprocess, pathlib, random
from playwright.sync_api import sync_playwright

url, entity = sys.argv[1].rstrip('/') + '/', pathlib.Path(sys.argv[2])
REWRITE = """
import fs from 'fs';
import { parseLines, serialiseAll, recordHash, ZERO } from '%s/kernel/record.js';
const f = '%s/record/events.jsonl';
const { records } = parseLines(fs.readFileSync(f, 'utf8'));
const i = records.map(r => r.kind).lastIndexOf('ballot.cast');  // nothing depends on it: the rewrite verifies and replays
let prev = ZERO;
const out = records.filter((_, k) => k !== i).map((r, k) => { const n = { ...r, seq: k + 1, prev }; delete n.hash; n.hash = recordHash(n); prev = n.hash; return n; });
fs.writeFileSync(f + '.rewritten', serialiseAll(out));
""" % (entity, entity)
VERIFIED = "document.querySelector('.seal .statement')?.textContent.includes('verified in this browser')"
PASSWORD = 'correct horse battery'
ME = 'p-e2e-%04d' % random.randrange(10000)   # a new member each run

def send(pg):
    pg.click('[data-send=own]'); pg.wait_for_function("document.querySelector('#send-result').textContent.length > 0")
    text = pg.inner_text('#send-result'); assert 'Sent' in text, text
    pg.click('#send button[value=close]')

def unlock(pg, password=PASSWORD):
    pg.wait_for_selector('#unlock[open]'); pg.fill('#unlock-password', password); pg.click('#unlock-ok')

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(url); pg.wait_for_function(VERIFIED); pg.wait_for_selector('#tabs a')

    # Every tab draws.
    tabs = pg.eval_on_selector_all('#tabs a', 'as => as.map(a => a.getAttribute("href"))')
    assert {'#/', '#/votes', '#/members', '#/record', '#/law', '#/settings'} <= set(tabs), tabs
    for t in tabs:
        pg.goto(url + t); pg.wait_for_selector('#view section')
        assert 'could not be drawn' not in pg.inner_text('#view'), (t, pg.inner_text('#view')[:300])

    # Join with a key locked by a password.
    pg.goto(url + '#/'); pg.wait_for_selector('#join-id')
    pg.fill('#join-id', ME); pg.fill('#join-password', PASSWORD)
    pg.click('text=Join with a key kept in this browser'); pg.wait_for_selector('#send[open]'); send(pg)
    pg.reload(); pg.wait_for_function(VERIFIED); pg.wait_for_selector('text=locked with a password')

    # A proposal: a wrong password is refused, the right one signs.
    pg.goto(url + '#/votes'); pg.wait_for_selector('text=Lay a proposal')
    pg.click('text=Lay a proposal'); pg.fill('#lay-title', 'From the browser')
    pg.click('text=Sign this proposal'); unlock(pg, 'wrong password')
    pg.wait_for_function("document.querySelector('#unlock-result').textContent.includes('does not unlock')")
    pg.fill('#unlock-password', PASSWORD); pg.click('#unlock-ok'); pg.wait_for_selector('#send[open]'); send(pg)

    pg.reload(); pg.wait_for_function(VERIFIED); pg.wait_for_selector('#view h3 a')
    pg.click('#view li:first-child >> text=Vote for'); unlock(pg); pg.wait_for_selector('#send[open]'); send(pg)

    # The proposal's own page, a member's page and a record's page, by address.
    pg.reload(); pg.wait_for_function(VERIFIED)
    pg.click('#view h3 a >> nth=0'); pg.wait_for_selector('text=Who could vote')
    assert ME in pg.inner_text('#view') and 'Timeline' in pg.inner_text('#view')
    pg.goto(url + '#/members/' + ME); pg.wait_for_selector('text=Acts signed')
    pg.goto(url + '#/record/1'); pg.wait_for_selector('text=As recorded')
    assert 'entity.found' in pg.inner_text('#view')
    pg.goto(url + '#/settings/decision.electorate'); pg.wait_for_selector('text=History')

    # The browser must witness the ballot's record; removing records it never
    # saw is indistinguishable from lag (see docs/GUARANTEES.md).
    pg.goto(url + '#/'); pg.reload(); pg.wait_for_function(VERIFIED)
    subprocess.run(['node', '--input-type=module', '-e', REWRITE], check=True)
    ev = entity / 'record' / 'events.jsonl'; backup = ev.read_bytes()
    ev.write_bytes((entity / 'record' / 'events.jsonl.rewritten').read_bytes())
    try:
        pg.reload(); pg.wait_for_selector('.alarm')
        assert 'changed behind you' in pg.inner_text('#seal')
    finally:
        ev.write_bytes(backup)
    assert not errors, errors
    print('browser end-to-end: ok'); b.close()
