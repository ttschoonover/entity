"""Notifications in the real page: the You card, an email subscription proved
with the record key, the service worker opening a sealed notice, and Home's
notices for you.

    # a republic with the notify module, p-0001's key under ENTITY_KEYS, p-0001's
    # record key published (entity notify subscribe --sms … --as p-0001), served by
    # a member's node:  entity serve --settle --as p-0001
    python3 test/browser/notify.py http://localhost:7780/ <entity dir> <keys dir> p-0001

Checks: the Notifications card on You; an email subscription made in the page
reaches the node (and the record does not hold the address); the service
worker, given a push payload sealed to p-0001, shows its title, and only
"Something new" once the key is locked; after p-0002 proposes something, Home
lists it under notices for you, opened on the device; no Content Security
Policy violation. (A real push needs a push service, which the test cannot
reach, and headless Chromium will not display notifications: the payload is
handed to the service worker as a push would be, and it answers with the title
and text it would show.)
"""
import json, sys, pathlib, subprocess
from playwright.sync_api import sync_playwright

base, entity_dir, keys_dir, who = sys.argv[1].rstrip('/') + '/', pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), sys.argv[4]
ent = json.loads((entity_dir / 'record' / 'events.jsonl').read_text().split('\n')[0])['payload']['act']['entity']
node = lambda js: subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=entity_dir).decode()
key = json.loads(node(f'''
  import fs from 'node:fs'; const {{ importPrivateKey }} = await import('./kernel/keys.js');
  const k = importPrivateKey(fs.readFileSync({json.dumps(str(keys_dir / ent / who))}, 'utf8'));
  console.log(JSON.stringify({{ seed: [...k.seed], publicKey: [...k.publicKey] }}));'''))
payload = json.loads(node(f'''
  import fs from 'node:fs'; const {{ importPrivateKey }} = await import('./kernel/keys.js');
  const {{ recordKeyFromSeed, cryptoB64 }} = await import('./kernel/sealing.js'); const N = await import('./kernel/notice.js');
  const k = importPrivateKey(fs.readFileSync({json.dumps(str(keys_dir / ent / who))}, 'utf8'));
  const {{ pk }} = await recordKeyFromSeed(k.seed);
  const n = await N.sealNotice({{ entity: {json.dumps(ent)}, to: {json.dumps(who)}, recordKey: cryptoB64(pk) }}, {{ from: 'The Test', seq: 99, title: 'Dinner is at eight', text: 'Bring a chair.', url: '#/notify', at: new Date().toISOString() }});
  console.log(JSON.stringify({{ v: 1, n }}));'''))
cli = lambda *a: subprocess.check_output(['node', 'cli/index.js', *a], cwd=entity_dir, env={**__import__('os').environ, 'ENTITY_KEYS': str(keys_dir)}).decode()
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
    pg.goto(base + '#/you', wait_until='networkidle'); pg.wait_for_timeout(1200)
    view = pg.locator('#view')
    check('Notifications' in view.inner_text() and 'sealed to your own key' in view.inner_text(), 'You: the Notifications card')
    pg.locator('summary', has_text='By email or text message').click()
    pg.fill('#nt-email', 'me@example.org'); pg.locator('button', has_text='Use it').first.click(); pg.wait_for_timeout(1200)
    check('me@example.org will be told' in view.inner_text(), 'an email subscription, proved with the record key, accepted')
    st = cli('notify', 'status')
    check('email' in st and 'p-0001' in st, 'the node holds it')
    check('me@example.org' not in (entity_dir / 'record' / 'events.jsonl').read_text(), 'and the record does not')
    pg.locator('button', has_text='Where my notices go').click(); pg.wait_for_timeout(900)
    check(view.inner_text().count('me@example.org') >= 2, 'the page lists where notices go')

    # The service worker, handed a push payload sealed to this member.
    pg.evaluate("async () => { await navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' }); await navigator.serviceWorker.ready; }")
    # Headless Chromium refuses to display notifications, so the worker answers with what it would show.
    shown = lambda: pg.evaluate("async (p) => { const r = await navigator.serviceWorker.ready; const ch = new MessageChannel(); const got = new Promise(ok => { ch.port1.onmessage = (m) => ok(m.data); }); r.active.postMessage({ type: 'entity-notify-test', payload: p }, [ch.port2]); const x = await got; return [[x.title, x.options.body]]; }", payload)
    got = shown()
    check(got and got[0] == ['The Test: Dinner is at eight', 'Bring a chair.'], f'the service worker opens the sealed notice with the member\'s key ({got})')
    pg.evaluate("""async (x) => { const K = await import('/interface/js/keystore.js'); const i = await K.loadIdentity(x); delete i.seed; i.locked = { placeholder: true }; await K.saveIdentity(x, i); }""", ent)
    got = shown()
    check(got and got[0][0] == 'Something new' and 'Dinner' not in json.dumps(got), f'with the key locked, only "Something new" ({got})')
    ctx.close()

    # Home: notices for you, after another member proposes something.
    cli('propose', '--title', 'Buy a kettle', '--changes', '{"entity.name":"The Kettle"}', '--as', 'p-0002'); cli('settle', '--as', 'p-0001')
    pg = (ctx := b.new_context(storage_state=state, viewport={'width': 1100, 'height': 1400})).new_page(); watch(pg)
    pg.goto(base, wait_until='networkidle'); pg.wait_for_timeout(2500)
    home = pg.locator('#view').inner_text()
    check('Notices for you' in home and 'New proposal: Buy a kettle' in home, 'Home: notices for you, opened on the device')
    cli('act', 'notice.post', '--title', 'Bins go out Tuesday', '--text', 'Green ones too.', '--as', 'p-0002'); cli('settle', '--as', 'p-0001')
    pg.goto(base + '#/notify', wait_until='networkidle'); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1500)
    tab = pg.locator('#view').inner_text()
    check('Bins go out Tuesday' in tab and 'Post a notice' in tab, 'the Notices tab lists notices and offers the form')
    b.close()
check(not viol, f'no Content Security Policy violations ({len(viol)})')
sys.exit(1 if fails else 0)
