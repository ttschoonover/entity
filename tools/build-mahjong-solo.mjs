// build-mahjong-solo.mjs · one HTML file that plays mahjong against the AI with
// no server, no network and no record: the same engine, table and AI as the
// world's site, bundled. Double-click the file to play.
//
//   node tools/build-mahjong-solo.mjs [out.html]     (default sites/mahjong/mahjong-solo.html)
//
// The bundler is deliberately small: it wraps each module in a function and
// turns its imports and exports into plain objects. It understands only the
// import and export forms these files use.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(ROOT, 'sites', 'mahjong', 'mahjong-solo.html');
const ALIAS = { [path.join(ROOT, 'sites', 'mahjong', 'mj-engine.js')]: path.join(ROOT, 'library', 'mahjong', 'engine', 'index.js') };
const ENTRY = path.join(ROOT, 'sites', 'mahjong', 'offline.js');

const mods = new Map(); // file → { id, code, deps }
const resolve = (from, spec) => { const f = path.resolve(path.dirname(from), spec); return ALIAS[f] || f; };
function load(file) {
  if (mods.has(file)) return mods.get(file);
  const src = fs.readFileSync(file, 'utf8');
  const m = { id: `__m${mods.size}`, deps: [], file };
  mods.set(file, m);
  const pre = [], post = [], exported = [];
  let code = src.replace(/^\s*\/\/.*$/gm, (l) => l); // keep comments
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*'([^']+)';?/g, (_, names, spec) => {
    const d = load(resolve(file, spec)); m.deps.push(d);
    pre.push(`const { ${names.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': ')).join(', ')} } = ${d.id};`); return '';
  });
  code = code.replace(/^import\s*'([^']+)';?/gm, (_, spec) => { const d = load(resolve(file, spec)); m.deps.push(d); return ''; });
  code = code.replace(/import\s*\*\s*as\s+(\w+)\s+from\s*'([^']+)';?/g, (_, n, spec) => { const d = load(resolve(file, spec)); m.deps.push(d); pre.push(`const ${n} = ${d.id};`); return ''; });
  code = code.replace(/export\s*\*\s*from\s*'([^']+)';?/g, (_, spec) => { const d = load(resolve(file, spec)); m.deps.push(d); post.push(`Object.assign(__x, ${d.id});`); return ''; });
  code = code.replace(/export\s*\{([^}]*)\}\s*from\s*'([^']+)';?/g, (_, names, spec) => {
    const d = load(resolve(file, spec)); m.deps.push(d);
    for (const s of names.split(',').map(x => x.trim()).filter(Boolean)) { const [a, b] = s.split(/\s+as\s+/); post.push(`__x.${b || a} = ${d.id}.${a};`); }
    return '';
  });
  code = code.replace(/export\s*\{([^}]*)\};?/g, (_, names) => { for (const s of names.split(',').map(x => x.trim()).filter(Boolean)) { const [a, b] = s.split(/\s+as\s+/); exported.push([b || a, a]); } return ''; });
  code = code.replace(/export\s+(async\s+function|function|const|let|class)\s+(\w+)/g, (_, kw, n) => { exported.push([n, n]); return `${kw} ${n}`; });
  if (/\bexport\b\s+default/.test(code)) throw new Error(`${file}: export default is not supported`);
  m.code = `const ${m.id} = (() => {\n${pre.join('\n')}\nconst __x = {};\n${code}\n${exported.map(([n, l]) => `__x.${n} = ${l};`).join('\n')}\n${post.join('\n')}\nreturn __x;\n})();`;
  return m;
}
load(ENTRY);
const order = [], seen = new Set();
const visit = (m) => { if (seen.has(m)) return; seen.add(m); m.deps.forEach(visit); order.push(m); };
visit(mods.get(ENTRY));
const js = order.map(m => `// ── ${path.relative(ROOT, m.file)}\n${m.code}`).join('\n\n');

// The site's stylesheet, without the kit, plus the few kit tokens it leans on.
const css = fs.readFileSync(path.join(ROOT, 'sites', 'mahjong', 'site.css'), 'utf8').replace(/@import[^;]+;/, '');
const base = `:root{--sans:system-ui,-apple-system,"Segoe UI",sans-serif;--serif:Georgia,serif;--wrap:72rem;--gutter:1.25rem}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;font:1rem/1.55 var(--sans);color:var(--ink)}
h1{font:600 clamp(2.6rem,7vw,4.5rem)/1 var(--serif);margin:0 0 .6rem}.lede{font-size:1.15rem;max-width:34em}.fine{color:var(--muted);font-size:.9rem}
label{display:block;font-weight:600;margin:.8rem 0 .25rem}label.check{display:flex;gap:.5rem;font-weight:400}
.primary,.secondary{font:600 .95rem/1 var(--sans);padding:.75rem 1.15rem;border-radius:6px;border:1.5px solid var(--brass);cursor:pointer}
.primary{background:var(--brass);color:#22100B}.secondary{background:transparent;color:var(--ink)}.actions{display:flex;gap:.8rem;margin-top:1.2rem;flex-wrap:wrap}`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mahjong · offline</title>
<script>try{var m=document.cookie.match(/(?:^|;\\s*)mj_theme=([a-z]+)/),t=m?m[1]:localStorage.getItem('mj:theme');t={rosewood:'traditional',jade:'traditional',paper:'minimal',neon:'arcade'}[t]||t;if(t&&t!=='traditional')document.documentElement.dataset.mjTheme=t}catch(e){}</script>
<meta name="description" content="Hong Kong mahjong against three AIs. One file, no internet needed.">
<style>${base}\n${css}</style>
</head>
<body class="mj-page">
<main>
  <section id="setup" class="mj-setup">
    <h1>Mahjong</h1>
    <p class="lede">You against three AIs, Hong Kong rules. This file needs no internet and sends nothing anywhere; your game is saved in this browser.</p>
    <div data-mj-themes></div>
    <div class="mj-form">
      <label for="level">AI strength</label>
      <select id="level"><option value="1">1 · learning the tiles</option><option value="2">2 · casual</option><option value="3" selected>3 · solid</option><option value="4">4 · plays for value, defends</option><option value="5">5 · sharp</option></select>
      <label for="rounds">Length</label>
      <select id="rounds"><option value="1" selected>East round</option><option value="2">East and South</option><option value="4">Full game</option></select>
      <label for="min">Smallest winning hand</label>
      <select id="min"><option value="0" selected>Any hand</option><option value="1">1 faan</option><option value="3">3 faan</option></select>
      <label class="check"><input type="checkbox" id="flowers" checked> Flowers and seasons</label>
      <div class="actions"><button class="primary" id="start" type="button">Deal</button><button class="secondary" id="resume" type="button" hidden>Resume your game</button></div>
    </div>
  </section>
  <section id="game" class="mj-game" hidden>
    <div class="mj-topline"><p class="fine">Click a tile to pick it, click again to discard.</p><div data-mj-themes></div><button class="secondary" id="quit" type="button">Leave the table</button></div>
    <div id="table"></div>
    <div id="result" hidden></div>
  </section>
</main>
<script>
${js}
</script>
</body>
</html>
`;
fs.writeFileSync(OUT, html);
console.log(`${path.relative(process.cwd(), OUT)}: ${(html.length / 1024).toFixed(0)} KB, ${order.length} modules`);
