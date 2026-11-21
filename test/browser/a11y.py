"""An accessibility audit of every screen with axe-core, in light and dark, in English and French.

    python3 test/browser/a11y.py http://127.0.0.1:7780/ <entity dir> <keys dir> p-0001 <path to axe.min.js>
    # axe.min.js: npm i axe-core, then node_modules/axe-core/axe.min.js (run.sh fetches it)

Signed in as the member, each screen is checked against WCAG 2.1 A and AA.
Serious and critical findings fail the run; moderate and minor ones are listed.
The audit injects axe, so its pages run without the Content Security Policy
(gui.py checks the policy on the same screens).
"""
import json, sys, pathlib, subprocess
from playwright.sync_api import sync_playwright

base, entity_dir, keys_dir, who, axe = sys.argv[1].rstrip('/') + '/', pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), sys.argv[4], pathlib.Path(sys.argv[5])
ent = next(p.name for p in keys_dir.iterdir() if p.name.startswith('e-'))
key = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', f'''
  import fs from 'node:fs'; const {{ importPrivateKey }} = await import({json.dumps(str(entity_dir / 'kernel' / 'keys.js'))});
  const k = importPrivateKey(fs.readFileSync({json.dumps(str(keys_dir / ent / who))}, 'utf8'));
  console.log(JSON.stringify({{ seed: [...k.seed], publicKey: [...k.publicKey] }}));''']))
SCREENS = ['', '#/votes', '#/members', f'#/members/{who}', '#/record', '#/record/1', '#/law', '#/settings', '#/compose', '#/you']
serious, minor = [], {}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(bypass_csp=True, viewport={'width': 1100, 'height': 1400}); pg = ctx.new_page()
    pg.goto(base, wait_until='networkidle')
    pg.evaluate("""async (x) => { const K = await import('/interface/js/keystore.js');
      await K.saveIdentity(x.entity, { id: x.id, seed: new Uint8Array(x.seed), publicKey: new Uint8Array(x.publicKey), created: new Date().toISOString() }); }""",
      {'entity': ent, 'id': who, **key})
    for theme, lang in [('light', 'en'), ('dark', 'en'), ('light', 'fr')]:
        pg.evaluate("([t, l]) => { localStorage.setItem('entity:colour', t); localStorage.setItem('entity:lang', l); }", [theme, lang])
        for s in SCREENS:
            pg.goto(base + s, wait_until='networkidle'); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(900)
            pg.add_script_tag(path=str(axe))
            res = pg.evaluate("axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })))")
            for v in res:
                where = f"{theme}/{lang} {s or '#/'}"
                if v['impact'] in ('serious', 'critical'): serious.append((where, v))
                else: minor.setdefault(v['id'], (v['help'], []))[1].append(where)
    b.close()

for where, v in serious: print(f"FAIL {where}: {v['id']} ({v['impact']}) {v['help']} at {', '.join(v['nodes'])}")
for k, (help_, wh) in minor.items(): print(f"note {k}: {help_} ({len(wh)} screens)")
print(f"{'ok  ' if not serious else 'FAIL'} accessibility: {len(serious)} serious or critical findings across {len(SCREENS) * 3} screens")
sys.exit(1 if serious else 0)
