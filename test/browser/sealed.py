"""A sealed record in the real page, served by a node that cannot read it.

    # a sealed republic (see test/sealing-cli.test.js), with p-0001 and p-0002 included
    ENTITY_KEYS=/empty entity serve --settle &       # a zero-knowledge node: no member's key
    python3 test/browser/sealed.py http://127.0.0.1:7780/ <entity dir> <keys dir>

Checks: with no key in the browser, the page checks the chain and says the
record is sealed; with p-0002's key, it opens and verifies every record on the
device and shows the members; an act signed in the page travels sealed (its
words appear nowhere in what is sent) and the node stores it without settling;
no Content Security Policy violation anywhere. Afterwards a member's copy
settles the act: `entity settle --as p-0001`.
"""
import json, sys, pathlib, subprocess
from playwright.sync_api import sync_playwright

base, entity_dir, keys_dir = sys.argv[1].rstrip('/') + '/', pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
ent = next(p.name for p in keys_dir.iterdir() if p.name.startswith('e-'))
seed = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', f'''
  import fs from 'node:fs'; const {{ importPrivateKey }} = await import({json.dumps(str(entity_dir / 'kernel' / 'keys.js'))});
  const k = importPrivateKey(fs.readFileSync({json.dumps(str(keys_dir / ent / 'p-0002'))}, 'utf8'));
  console.log(JSON.stringify({{ seed: [...k.seed], publicKey: [...k.publicKey] }}));''']))
ident = {'entity': ent, 'id': 'p-0002', **seed}
viol, fails = [], []
def check(ok, what): print(('ok   ' if ok else 'FAIL ') + what); ok or fails.append(what)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(); pg.on('console', lambda m: viol.append(m.text) if 'Content Security Policy' in m.text else None)
    pg.goto(base, wait_until='networkidle'); pg.wait_for_timeout(2500)
    seal = pg.locator('#seal').inner_text()
    check('This record is sealed' in seal and 'whole' in seal, 'no key: the chain is checked, and the page says it is sealed')
    # The member's key into this browser's keystore, as signing in would put it.
    setup = b.new_context(bypass_csp=True); s = setup.new_page(); s.goto(base, wait_until='networkidle')
    s.evaluate("""async (x) => { const K = await import('/interface/js/keystore.js');
      await K.saveIdentity(x.entity, { id: x.id, seed: new Uint8Array(x.seed), publicKey: new Uint8Array(x.publicKey), created: new Date().toISOString() }); }""", ident)
    m = setup.new_page(); m.on('console', lambda x: viol.append(x.text) if 'Content Security Policy' in x.text else None)
    m.goto(base, wait_until='networkidle'); m.wait_for_timeout(3000)
    check('verified in this browser' in m.locator('#seal').inner_text(), 'with the key: every record opened and verified on the device')
    m.goto(base + '#members', wait_until='networkidle'); m.wait_for_timeout(1500)
    check('p-0002' in m.content(), 'the members show')
    r = m.evaluate("""async (x) => { const E = await import('/interface/js/engine.js');
      const reg = await E.loadRegistry(['page', 'deliberation', 'titles', 'vocabulary']);
      const v = await E.verifyText(reg, await (await fetch('record/events.jsonl')).text(), { id: x.id, seed: new Uint8Array(x.seed) });
      const act = await E.makeAct(reg, v.state, 'proposal.lay', { by: x.id, title: 'Sent sealed from the browser', rule: 'constitutional', changes: { 'entity.name': 'Browser' } },
        { seed: new Uint8Array(x.seed), publicKey: new Uint8Array(x.publicKey) });
      const box = await E.sealing.sealAct(v.state, act);
      const res = await (await fetch('acts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(box) })).json();
      return { wire: JSON.stringify(box), res }; }""", ident)
    check('Sent sealed' not in r['wire'], 'the act is sealed on the wire')
    check(not r['res']['refused'] and r['res']['accepted'][0].startswith('sealed:'), 'the node stores it, sealed')
    b.close()
check(not viol, f'no Content Security Policy violations ({len(viol)})')
sys.exit(1 if fails else 0)
