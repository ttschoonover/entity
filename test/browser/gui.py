"""The page's shell and screens (interface/athens.css, kit.js, screens.js) in Chromium.

    # a founded entity with a member's key under ENTITY_KEYS and one proposal open, e.g.
    entity preset apply assembly && entity found --id p-0001 && entity join --id p-0002 && entity settle
    entity propose --title "Buy a dishwasher" --changes '{"entity.name":"X"}' --as p-0002 && entity settle
    entity serve --settle &
    python3 test/browser/gui.py http://127.0.0.1:7780/ <entity dir> <keys dir> p-0001

Checks: Home shows the proposal needing a vote with its meters, the Votes tab
carries a count, and the copy's health; the composer previews a change and
names its rule; a setting's "Propose a change" opens the composer on it; the
language and colour pills switch the page; on a phone the sections sit at the
bottom; the Athens look is the default; no Content Security Policy violation.
"""
import json, sys, pathlib, subprocess
from playwright.sync_api import sync_playwright

base, entity_dir, keys_dir, who = sys.argv[1].rstrip('/') + '/', pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), sys.argv[4]
ent = next(p.name for p in keys_dir.iterdir() if p.name.startswith('e-'))
key = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', f'''
  import fs from 'node:fs'; const {{ importPrivateKey }} = await import({json.dumps(str(entity_dir / 'kernel' / 'keys.js'))});
  const k = importPrivateKey(fs.readFileSync({json.dumps(str(keys_dir / ent / who))}, 'utf8'));
  console.log(JSON.stringify({{ seed: [...k.seed], publicKey: [...k.publicKey] }}));''']))
viol, fails = [], []
def check(ok, what): print(('ok   ' if ok else 'FAIL ') + what); ok or fails.append(what)
def watch(pg): pg.on('console', lambda m: viol.append(m.text) if 'Content Security Policy' in m.text else None)

with sync_playwright() as p:
    b = p.chromium.launch()
    setup = b.new_context(bypass_csp=True); s = setup.new_page(); s.goto(base, wait_until='networkidle')
    s.evaluate("""async (x) => { const K = await import('/interface/js/keystore.js');
      await K.saveIdentity(x.entity, { id: x.id, seed: new Uint8Array(x.seed), publicKey: new Uint8Array(x.publicKey), created: new Date().toISOString() }); }""",
      {'entity': ent, 'id': who, **key})
    state = setup.storage_state(indexed_db=True); setup.close()

    ctx = b.new_context(storage_state=state, viewport={'width': 1100, 'height': 1400}); pg = ctx.new_page(); watch(pg)
    pg.goto(base, wait_until='networkidle'); pg.wait_for_timeout(1500)
    check(pg.evaluate("document.documentElement.dataset.look") == 'athens', 'the Athens look is the default')
    check(pg.locator('#controls .pill').count() == 3, 'size, language and colour pills in the masthead')
    view = pg.locator('#view')
    check(view.locator('.card.urgent').count() >= 1, 'Home: a proposal needing your vote, as a card')
    check(view.locator('.card.urgent .meter').count() == 2, 'with its turnout and share meters')
    check(pg.locator('nav#tabs .count').count() == 1, 'the Votes tab carries a count')
    check(view.locator('.feed li').count() >= 1, 'Home: what happened lately')
    check('Verified in this browser' in view.inner_text(), 'Home: this copy verified')

    pg.goto(base + '#/settings', wait_until='networkidle'); pg.wait_for_timeout(800)
    pg.locator('.setting', has=pg.locator('a[href="#/settings/deliberation.period"]')).locator('button').click(); pg.wait_for_timeout(600)
    check(pg.url.endswith('#/compose/deliberation.period'), 'a setting\'s button opens the composer on it')
    pg.fill('#c-title', 'Two weeks'); pg.locator('#lay-value').fill('14'); pg.locator('#lay-value').dispatch_event('input'); pg.wait_for_timeout(200)
    prev = pg.locator('.compose .preview').inner_text()
    check('→' in prev and '14' in prev, 'the composer previews the change')
    check('organic' in pg.locator('.compose .rule-box').inner_text(), 'and names the rule it needs')
    check('null' not in pg.locator('.compose').inner_text(), 'and says nothing stray')

    pg.goto(base + '#/record', wait_until='networkidle'); pg.wait_for_timeout(800)
    rec = view.inner_text()
    check('Key periods' in rec and 'Verified in this browser' in rec, 'Record: the copy\'s health and its key periods')
    check(view.locator('.badge.lock').count() >= 1, 'Record: sealed records are marked')
    seq = pg.evaluate("[...document.querySelectorAll('#view tr')].map(r=>r.innerText).find(t=>t.includes('sealed'))?.split(/\\s/)[0]")
    pg.goto(base + f'#/record/{seq}', wait_until='networkidle'); pg.wait_for_timeout(600)
    check('under key period' in view.inner_text() and view.locator('details summary', has_text='As stored on disk').count() == 1, 'a sealed record shows how it is stored, ciphertext on request')
    pg.goto(base + '#/members', wait_until='networkidle'); pg.wait_for_timeout(600)
    check(view.inner_text().count('reads (key period') == 2, 'Members: both members read the sealed record')

    pg.goto(base + '#/you', wait_until='networkidle'); pg.wait_for_timeout(600)
    you = view.inner_text()
    check(all(x in you for x in ['Who you are', 'Your key', 'The sealed record', 'If you lose your key']), 'You: identity, key, sealed record and recovery, as cards')
    check('You read it: you are in key period' in you, 'You: says this member reads the sealed record')

    pg.locator('#controls .pill button', has_text='FR').click(); pg.wait_for_timeout(500)
    check('Accueil' in pg.locator('nav#tabs').inner_text(), 'FR: the sections are named in French')
    check('Qui vous êtes' in view.inner_text(), 'FR: the screen itself follows')
    pg.locator('#controls .pill button', has_text='EN').click()
    pg.locator('#controls .pill button[title="Dark"]').click(); pg.wait_for_timeout(300)
    check(pg.evaluate("document.documentElement.dataset.theme") == 'dark', 'the colour pill switches to dark')
    ctx.close()

    phone = b.new_context(storage_state=state, viewport={'width': 390, 'height': 844}); m = phone.new_page(); watch(m)
    m.goto(base, wait_until='networkidle'); m.wait_for_timeout(1200)
    box = m.locator('nav#tabs').bounding_box()
    check(box and box['y'] > 700 and box['height'] < 90, 'on a phone the sections sit at the bottom')
    b.close()
check(not viol, f'no Content Security Policy violations ({len(viol)})')
sys.exit(1 if fails else 0)
