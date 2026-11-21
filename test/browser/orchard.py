"""The Orchard General Partnership in two browsers: the founder signs the
agreement with a drawn signature, gives their particulars, and invites Ana
with a personal link; Ana opens it, applies, draws her signature, gives her
particulars and is admitted; the founder reads her particulars; the
certificates show the officers' signatures and download as LaTeX PDFs.

    # make-orchard-gp.sh, then:  entity serve --settle --as tim   (a member's node)
    python3 test/browser/orchard.py http://localhost:7790/ <entity dir> <keys dir> tim
"""
import json, sys, pathlib, subprocess, os
from playwright.sync_api import sync_playwright

base, d, keys, who = sys.argv[1].rstrip('/') + '/', pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), sys.argv[4]
ent = json.loads((d / 'record' / 'events.jsonl').read_text().split('\n')[0])['payload']['act']['entity']
key = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', f'''import fs from 'node:fs'; const {{ importPrivateKey }} = await import('{d}/kernel/keys.js');
const k = importPrivateKey(fs.readFileSync('{keys}/{ent}/{who}','utf8')); console.log(JSON.stringify({{seed:[...k.seed],publicKey:[...k.publicKey]}}));''']))
cli = lambda *a: subprocess.check_output(['node', 'cli/index.js', *a], cwd=d, env={**os.environ, 'ENTITY_KEYS': str(keys)}).decode()
fails, viol = [], []
def check(ok, what): print(('ok   ' if ok else 'FAIL ') + what); ok or fails.append(what)
def watch(pg): pg.on('console', lambda m: viol.append(m.text) if 'Content Security Policy' in m.text else None)
def draw(pg, canvas):
    canvas.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
    box = canvas.bounding_box(); x, y = box['x'] + 20, box['y'] + box['height'] / 2
    pg.mouse.move(x, y); pg.mouse.down()
    for i in range(1, 25): pg.mouse.move(x + i * 9, y + (14 if i % 2 else -14))
    pg.mouse.up()
def send(pg):
    pg.wait_for_selector('#send[open]'); pg.click('[data-send=own]')
    t = poll(lambda: pg.inner_text('#send-result').strip(), 20)
    pg.click('#send button[value=close]'); return t
def send_site(pg):
    # The website's signing box: read it, then Sign and send.
    pg.wait_for_selector('dialog.site-dialog[open]'); d = pg.locator('dialog.site-dialog[open]')
    d.get_by_role('button', name='Sign and send').click()
    poll(lambda: pg.locator('dialog.site-dialog[open]').count() == 0 or 'bad' in (d.locator('.status').get_attribute('class') or ''), 20)
    return 'Sent' if pg.locator('dialog.site-dialog[open]').count() == 0 else d.locator('.status').inner_text()
def poll(fn, seconds, done=bool):
    import time
    end = time.time() + seconds
    while True:
        v = fn()
        if done(v) or time.time() > end: return v
        time.sleep(0.3)
FIELDS = {'legal_name': 'Ana María López', 'date_of_birth': '2001-04-02', 'residence': '2400 Ridge Rd, Berkeley, CA 94709', 'email': 'ana@example.org', 'tin': '123-45-6789'}

with sync_playwright() as p:
    b = p.chromium.launch()
    s = b.new_context(bypass_csp=True); pg = s.new_page(); pg.goto(base + 'interface/js/keystore.js')
    pg.evaluate("async (x) => { const K = await import('/interface/js/keystore.js'); await K.saveIdentity(x.e, { id: x.who, seed: new Uint8Array(x.seed), publicKey: new Uint8Array(x.publicKey), created: new Date().toISOString() }); }", {'e': ent, 'who': who, **key})
    state = s.storage_state(indexed_db=True); s.close()

    # ── the founder ───────────────────────────────────────────────────────────
    c = b.new_context(storage_state=state, viewport={'width': 1100, 'height': 1400}); pg = c.new_page(); watch(pg); pg.on('dialog', lambda dl: dl.accept())
    pg.goto(base + 'signin', wait_until='networkidle'); pg.locator('button', has_text='Continue as').click(); pg.wait_for_timeout(3500)
    pg.goto(base + 'hall.html#/agreements', wait_until='networkidle'); pg.wait_for_timeout(2500)
    draw(pg, pg.locator('#view canvas').first)
    pg.check('#ag-partnership-agreement'); pg.get_by_role('button', name='Sign', exact=True).click(); r = send_site(pg); pg.wait_for_timeout(1500)
    check('Sent' in r, f'the founder signs the agreement with a drawn signature ({r[:60]})')

    pg.goto(base + 'hall.html#/details', wait_until='networkidle'); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(2500)
    for k, v in {'legal_name': 'Timothy Schoonover', 'date_of_birth': '2004-05-06', 'residence': '2405 Prospect St, Berkeley, CA 94704', 'email': 'tim@example.org', 'tin': '987-65-4321'}.items(): pg.fill(f'#dt-{k}', v)
    pg.check('#dt-certified'); pg.locator('#view button', has_text='Seal and give my particulars').click(); r = send_site(pg); pg.wait_for_timeout(1500)
    check('Sent' in r and '987-65-4321' not in (d / 'record' / 'events.jsonl').read_text(), 'the founder gives their particulars, sealed; none on the record')

    pg.goto(base + 'hall.html#/invites', wait_until='networkidle'); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(2500)
    pg.fill('#inv-name', 'Ana López'); pg.locator('#view button', has_text='Create an invitation link').click()
    r = send_site(pg); pg.wait_for_timeout(1500)
    link = pg.locator('#view .card .hash').inner_text().strip()
    check('Sent' in r and '/signin?invite=' in link, f'the Secretary creates a personal invitation link under her grant')
    c.close()

    # ── Ana, with only the link ──────────────────────────────────────────────
    a = b.new_context(viewport={'width': 600, 'height': 1600}); ap = a.new_page(); watch(ap); errs = []
    ap.on('pageerror', lambda e: errs.append(str(e)))
    ap.goto(link, wait_until='networkidle'); ap.wait_for_timeout(1500)
    btxt = ap.locator('body').inner_text(); check('You are invited to join, as Ana López' in btxt, 'the link opens the invitation, named' + ('' if 'invited' in btxt else ' :: ' + btxt[:400].replace(chr(10), ' | ') + ' :: ' + link))
    ap.fill('#aid', 'ana'); ap.fill('#apw', 'a long enough passphrase'); ap.fill('#apw2', 'a long enough passphrase')
    draw(ap, ap.locator('#docs canvas').first)
    for k, v in FIELDS.items(): ap.fill(f'#pt-{k}', v)
    ap.check('#pt-certified'); ap.click('#apply-go')
    out = poll(lambda: ap.inner_text('#apply-out').strip(), 90, done=lambda t: bool(t) and not t.endswith('…'))
    check(out.startswith('Welcome'), f'Ana applies, signs, gives her particulars and is admitted ({out[:90]}) {errs[:1]}')
    a.close()
    parts = cli('participants', '--as', who)
    check('ana' in parts and 'active' in parts.split('ana')[1][:30], 'Ana is an active partner')
    check('123-45-6789' not in (d / 'record' / 'events.jsonl').read_text() and 'López' not in (d / 'record' / 'events.jsonl').read_text(), 'nothing of hers is on the record in the clear')

    # ── the founder reads her particulars; certificates and PDFs ─────────────
    c = b.new_context(storage_state=state, viewport={'width': 1100, 'height': 1400}); pg = c.new_page(); watch(pg); pg.on('dialog', lambda dl: dl.accept())
    pg.goto(base + 'signin', wait_until='networkidle'); pg.locator('button', has_text='Continue as').click(); pg.wait_for_timeout(3500)
    pg.goto(base + 'hall.html#/details', wait_until='networkidle'); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(2500)
    pg.locator('#view button', has_text='Open them').click(); pg.wait_for_timeout(2500)
    t = pg.locator('#view').inner_text()
    check('Ana María López' in t and '•••-••-6789' in t, 'the Secretary opens every partner’s particulars in her browser (TIN masked)')
    pg.goto(base + 'hall.html#/partnership', wait_until='networkidle'); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(2500)
    check(pg.locator('#view .certificate img').count() >= 1, 'certificates show the officers’ drawn signatures')
    href = pg.locator('#view .certificate a', has_text='PDF').first.get_attribute('href')
    rr = pg.request.get(base + href)
    check(rr.status == 200 and rr.headers.get('content-type') == 'application/pdf' and rr.body()[:4] == b'%PDF', f'a certificate downloads as a PDF ({rr.status})')
    ra = pg.request.get(base + 'documents/agreement/partnership-agreement.pdf')
    check(ra.status == 200 and ra.body()[:4] == b'%PDF', 'the signed agreement downloads as a PDF')
    open('/tmp/orchard-agreement.pdf', 'wb').write(ra.body()); open('/tmp/orchard-certificate.pdf', 'wb').write(rr.body())
    pg.screenshot(path='/tmp/orchard-partnership.png', full_page=True)
    # ── the partnership's own website ────────────────────────────────────────
    pg.goto(base, wait_until='networkidle'); pg.wait_for_timeout(2500)
    t = pg.locator('main').inner_text()
    t = t.lower(); check('club value' in t and 'your stake' in t and 'for you' in t, 'the website opens on the overview: club value, your stake, what needs you')
    check(pg.locator('#nav a', has_text='Portfolio').count() == 1 and pg.locator('#nav a', has_text='Chat').count() == 0, 'its menu has the portfolio, and no chat')
    pg.goto(base + 'portfolio.html', wait_until='networkidle'); pg.wait_for_timeout(2500)
    t = pg.locator('main').inner_text()
    check('Holdings' in t and 'Capital accounts' in t and 'Propose a trade' in t and 'Treasurer’s desk' not in t, 'the books are open to a partner; only the Treasurer sees the desk')
    pg.goto(base + 'partners.html', wait_until='networkidle'); pg.wait_for_timeout(2500)
    check('Ana' in pg.locator('main').inner_text(), 'the partners page lists Ana')
    pg.goto(base + 'hall.html#/agreements', wait_until='networkidle'); pg.wait_for_timeout(2500)
    check('open on the Wiki' not in pg.locator('main').inner_text() and pg.locator('#view canvas, #view img').count() >= 1, 'the agreement is on the website, with its signatures, and no wiki')
    pg.screenshot(path='/tmp/orchard-site.png', full_page=True)
    c.close()
    # A stranger, not signed in, gets nothing.
    x = b.new_context(); xr = x.request.get(base + 'documents/agreement/partnership-agreement.pdf')
    check(xr.status in (401, 302) or b'%PDF' not in xr.body()[:8], f'a stranger gets no PDF ({xr.status})')
    xp = x.new_page(); xp.goto(base + 'portfolio.html', wait_until='networkidle')
    check('Members only' in xp.locator('body').inner_text() and 'The Orchard' in xp.locator('body').inner_text(), 'a stranger sees only the sign-in page, with the club’s name')
    b.close()
check(not viol, f'no Content Security Policy violations ({len(viol)})')
sys.exit(1 if fails else 0)
