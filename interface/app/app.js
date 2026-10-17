// The control panel: every screen here runs the same commands as the terminal.
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v; else if (k === 'checked') el.checked = !!v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
function toast(t, bad = false) { const el = $('#toast'); el.textContent = t; el.className = `show${bad ? ' bad' : ''}`; clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = ''; }, 4000); }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-entity-app': '1' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({ error: `the panel answered ${r.status}` }));
  if (!r.ok && !j.log) throw Object.assign(new Error(j.error || `error ${r.status}`), { out: j.out });
  return j;
}
const slug = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ── home: your republics ────────────────────────────────────────────────────
async function home() {
  const info = await api('/api/info');
  const list = info.republics;
  main.replaceChildren(
    h('section', {}, h('h1', {}, list.length ? 'Your republics' : 'Start a republic'),
      h('p', { class: 'hint' }, list.length ? `Republics in ${info.home}. Open one to run it, change its settings, add modules or publish it.` : `There are no republics in ${info.home} yet. The guide walks you through making one: a name, a starting shape, the modules you want and your own account. It takes a few minutes.`),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { location.hash = '#/new'; } }, 'Create a republic'),
        info.rad ? h('button', { onclick: () => { location.hash = '#/clone'; } }, 'Copy one from Radicle') : null)),
    list.length ? h('section', {}, h('div', { class: 'cards' }, list.map(r => h('div', { class: 'card' },
      h('h3', {}, h('span', { class: `dot${r.served ? ' up' : ''}` }), r.name || r.folder),
      h('p', {}, r.founded ? `${r.records} records · ${r.folder}${r.radicle ? ' · on Radicle' : ''}` : `${r.folder} · not founded yet`),
      h('div', { class: 'row' }, h('button', { onclick: () => { location.hash = `#/r/${r.folder}`; } }, 'Manage'),
        r.served ? h('a', { href: r.served.url, target: '_blank' }, h('button', { class: 'primary' }, 'Open its page ↗')) : r.founded ? h('button', { class: 'quiet', onclick: async () => { const s = await api(`/api/r/${r.folder}/serve`, {}); toast(`Serving at ${s.url}`); home(); } }, 'Start serving') : null))))) : null,
    h('section', {}, h('p', { class: 'fine' }, `Version ${info.version}, from ${info.source}. Everything here can also be done in a terminal with \`entity\`; this panel runs the same commands.`)));
}

// ── the setup guide ─────────────────────────────────────────────────────────
const STEPS = ['Basics', 'Shape', 'Modules', 'Settings', 'Look and serving', 'Review'];
let draft = null;
async function guide(step = 0) {
  if (!draft) draft = { name: '', folder: '', founder: '', password: '', preset: 'assembly', modules: ['page'], settings: {}, look: 'minimal', colour: 'dark', port: 7780, serve: true };
  const [presets, modules] = await Promise.all([guide.presets ||= api('/api/presets'), guide.modules ||= api('/api/modules')]);
  const pre = presets.find(p => p.name === draft.preset) || presets[0];
  const chosen = () => [...new Set([...pre.modules, ...draft.modules, ...(draft.password ? ['passwords'] : [])])];
  const steps = h('div', { class: 'steps' }, STEPS.map((s, i) => h('span', { class: i === step ? 'on' : i < step ? 'done' : '' }, `${i + 1} · ${s}`)));
  const nav = (ok) => h('div', { class: 'row' }, step ? h('button', { class: 'quiet', onclick: () => guide(step - 1) }, '← Back') : h('button', { class: 'quiet', onclick: () => { location.hash = '#/'; } }, 'Cancel'),
    h('button', { class: 'primary', onclick: () => { const why = ok(); if (why) return toast(why, true); guide(step + 1); } }, 'Next →'));
  let body;
  if (step === 0) {
    const name = h('input', { id: 'g-name', value: draft.name, placeholder: 'The Riverside Cooperative', oninput: (e) => { draft.name = e.target.value; if (!draft.folderTouched) { draft.folder = slug(e.target.value); folder.value = draft.folder; } } });
    const folder = h('input', { id: 'g-folder', value: draft.folder, oninput: (e) => { draft.folder = e.target.value; draft.folderTouched = true; } });
    body = [h('h2', {}, 'The basics'),
      h('label', { for: 'g-name' }, 'Name of the republic'), name,
      h('label', { for: 'g-folder' }, 'Folder (lowercase letters, digits and -)'), folder,
      h('label', { for: 'g-founder' }, 'Your member id: how others will see you'), h('input', { id: 'g-founder', value: draft.founder, placeholder: 'tim', oninput: (e) => { draft.founder = e.target.value.trim(); } }),
      h('label', { for: 'g-pw' }, 'A password to sign in with (at least 12 characters; leave empty to use a key file only)'), h('input', { id: 'g-pw', type: 'password', value: draft.password, autocomplete: 'new-password', oninput: (e) => { draft.password = e.target.value; } }),
      h('label', { for: 'g-pw2' }, 'The password again'), h('input', { id: 'g-pw2', type: 'password', value: draft.password2 || '', autocomplete: 'new-password', oninput: (e) => { draft.password2 = e.target.value; } }),
      h('p', { class: 'fine' }, 'Your key is also saved on this computer (in ~/.entity/keys). The password never leaves it either: only the public key it makes is recorded.'),
      nav(() => (!draft.name.trim() ? 'Give the republic a name' : !/^[a-z0-9][a-z0-9-]{0,40}$/.test(draft.folder) ? 'The folder needs lowercase letters, digits and -' : !/^[a-z0-9][a-z0-9-]{0,40}$/.test(draft.founder) ? 'Your id needs lowercase letters, digits and -' : draft.password && draft.password.length < 12 ? 'A password is at least 12 characters' : draft.password !== (draft.password2 || '') ? 'The two passwords differ' : null))];
  } else if (step === 1) {
    body = [h('h2', {}, 'A starting shape'), h('p', { class: 'hint' }, 'A preset sets the first rules and modules. Every part of it can be changed later, by decision.'),
      h('div', { class: 'cards' }, presets.filter(p => !p.name.startsWith('_')).map(p => h('button', { class: `card${p.name === draft.preset ? ' on' : ''}`, onclick: () => { draft.preset = p.name; draft.settings = {}; guide(1); } },
        h('h3', {}, p.name), h('p', {}, p.about || ''), h('p', { class: 'tag' }, p.modules.join(' · '))))), nav(() => null)];
  } else if (step === 2) {
    body = [h('h2', {}, 'Modules'), h('p', { class: 'hint' }, `What the republic can do. The ${pre.name} preset brings the ticked ones; add any others now, or later from the republic's Settings.`),
      h('div', { class: 'mods' }, modules.map(m => {
        const fromPreset = pre.modules.includes(m.name) || m.core;
        return h('label', {}, h('input', { type: 'checkbox', checked: fromPreset || draft.modules.includes(m.name), disabled: fromPreset, onchange: (e) => { draft.modules = e.target.checked ? [...draft.modules, m.name] : draft.modules.filter(x => x !== m.name); } }),
          h('span', {}, h('strong', {}, m.name), m.needs?.length ? h('span', { class: 'tag' }, ` (needs ${m.needs.join(', ')})`) : null, h('span', { class: 'fine' }, m.about)));
      })), nav(() => null)];
  } else if (step === 3) {
    const cat = await api(`/api/catalog?modules=${encodeURIComponent(chosen().join(','))}`);
    const groups = {};
    for (const c of cat) (groups[c.group] ||= []).push(c);
    const start = (c) => (c.key in draft.settings ? draft.settings[c.key] : c.key in pre.set ? pre.set[c.key] : c.value);
    const field = (c) => {
      const v = start(c), set = (x) => { draft.settings[c.key] = x; row.classList.add('changed'); };
      const input = c.one_of ? h('select', { onchange: (e) => set(e.target.value) }, c.one_of.map(o => h('option', { value: o, selected: String(o) === String(v) ? true : null }, o)))
        : c.type === 'boolean' ? h('select', { onchange: (e) => set(e.target.value === 'true') }, ['true', 'false'].map(o => h('option', { value: o, selected: String(v) === o ? true : null }, o === 'true' ? 'yes' : 'no')))
        : c.type === 'integer' || c.type === 'number' ? h('input', { type: 'number', value: v ?? '', min: c.min ?? null, max: c.max ?? null, onchange: (e) => set(Number(e.target.value)) })
        : Array.isArray(v) || c.type === 'list' ? h('input', { value: (v || []).join(', '), onchange: (e) => set(e.target.value.split(',').map(s => s.trim()).filter(Boolean)) })
        : h('input', { value: v ?? '', onchange: (e) => set(e.target.value) });
      const row = h('div', { class: `setting${c.key in draft.settings ? ' changed' : ''}` }, h('div', {}, h('strong', {}, c.key.split('.').slice(1).join('.') || c.key), h('div', {}, h('code', {}, c.key)), h('p', { class: 'fine' }, c.describe)), input);
      return row;
    };
    const skip = new Set(['entity.name', 'entity.modules', 'entity.id', 'entity.founded', 'entity.parent']);
    const COMMON = ['membership', 'vocabulary', 'deliberation', 'identity'];
    const common = Object.keys(groups).filter(g => COMMON.includes(g.toLowerCase())).sort((x, y) => COMMON.indexOf(x.toLowerCase()) - COMMON.indexOf(y.toLowerCase()));
    const rest = Object.keys(groups).filter(g => !common.includes(g)).sort();
    const block = (g) => { const items = groups[g].filter(c => !skip.has(c.key)); return items.length ? [h('h3', {}, g), items.map(field)] : null; };
    body = [h('h2', {}, 'Settings'), h('p', { class: 'hint' }, 'Every setting starts at a sensible default. Change only what you know you want; all of them can be changed later, by decision. The most common are first.'),
      ...common.map(block),
      rest.length ? h('details', {}, h('summary', {}, `Every other setting (${rest.reduce((a, g) => a + groups[g].filter(c => !skip.has(c.key)).length, 0)})`), rest.map(block)) : null,
      nav(() => null)];
  } else if (step === 4) {
    const radio = (key, opts) => h('div', { class: 'row' }, opts.map(([v, l]) => h('label', { style: 'margin:0;color:inherit' }, h('input', { type: 'radio', name: key, checked: draft[key] === v, onchange: () => { draft[key] = v; } }), l)));
    body = [h('h2', {}, 'Look and serving'),
      h('label', {}, 'How its page looks (each visitor can still choose their own)'), radio('look', [['minimal', 'Minimal'], ['classic', 'Classic'], ['schoolbook', 'Schoolbook'], ['terminal', 'Terminal']]),
      h('label', {}, 'Colours'), radio('colour', [['dark', 'Dark'], ['light', 'Light'], ['system', 'Follow the device']]),
      h('label', { for: 'g-port' }, 'Port to serve its page on, here'), h('input', { id: 'g-port', type: 'number', value: draft.port, oninput: (e) => { draft.port = Number(e.target.value); } }),
      h('label', { style: 'color:inherit' }, h('input', { type: 'checkbox', checked: draft.serve, onchange: (e) => { draft.serve = e.target.checked; } }), 'Start serving it as soon as it is founded'),
      nav(() => (draft.port < 1024 || draft.port > 65535 ? 'Choose a port between 1024 and 65535' : null))];
  } else {
    const changed = Object.entries(draft.settings);
    body = [h('h2', {}, 'Review'),
      h('div', { class: 'grid2' },
        h('div', {}, h('h3', {}, 'The republic'), h('p', {}, draft.name), h('p', { class: 'fine' }, `in ${draft.folder} · founded by ${draft.founder}${draft.password ? ' · with a password' : ' · key file only'}`)),
        h('div', {}, h('h3', {}, 'Shape'), h('p', {}, draft.preset), h('p', { class: 'fine' }, chosen().join(' · ')))),
      h('h3', {}, 'Settings you changed'), changed.length ? h('ul', { class: 'log' }, changed.map(([k, v]) => h('li', {}, `${k}: ${JSON.stringify(v)}`))) : h('p', { class: 'fine' }, 'None: every setting at its default.'),
      h('p', { class: 'fine' }, `Look: ${draft.look}, ${draft.colour}. ${draft.serve ? `Served at http://localhost:${draft.port}/ once founded.` : 'Not served yet.'}`),
      h('div', { class: 'row' }, h('button', { class: 'quiet', onclick: () => guide(step - 1) }, '← Back'), h('button', { class: 'primary', id: 'g-found', onclick: found }, 'Found it')),
      h('div', { id: 'g-progress' })];
  }
  main.replaceChildren(h('section', {}, h('h1', {}, 'Create a republic'), steps, ...body));
}
async function found() {
  const btn = $('#g-found'); btn.disabled = true; btn.textContent = 'Founding…';
  const r = await api('/api/create', { ...draft, password2: undefined, folderTouched: undefined });
  const prog = $('#g-progress');
  prog.replaceChildren(h('ul', { class: 'log' }, (r.log || []).map(x => h('li', { class: x.code ? 'bad' : '' }, x.what))),
    r.error ? [h('p', { class: 'hint' }, r.error), r.log?.length ? h('pre', { class: 'out' }, r.log.map(x => x.out).filter(Boolean).join('\n')) : null] : null);
  if (r.ok) {
    prog.append(h('h2', { style: 'margin-top:18px' }, `${draft.name} is founded.`),
      h('div', { class: 'row' }, r.url ? h('a', { href: r.url, target: '_blank' }, h('button', { class: 'primary' }, 'Open its page ↗')) : null,
        h('button', { onclick: () => { location.hash = `#/r/${draft.folder}`; draft = null; } }, 'Manage it')));
    btn.remove();
  } else { btn.disabled = false; btn.textContent = 'Try again'; }
}

// ── copying one from Radicle ────────────────────────────────────────────────
function clone() {
  main.replaceChildren(h('section', {}, h('h1', {}, 'Copy a republic from Radicle'),
    h('p', { class: 'hint' }, 'Every public republic can be copied whole: its record, its code and its rules. Your copy checks everything for itself.'),
    h('label', { for: 'c-rid' }, 'Its Radicle id'), h('input', { id: 'c-rid', placeholder: 'rad:z…' }),
    h('label', { for: 'c-folder' }, 'Folder for your copy'), h('input', { id: 'c-folder' }),
    h('label', { for: 'c-seed' }, 'Seed to fetch from (optional)'), h('input', { id: 'c-seed', placeholder: 'z6Mk…' }),
    h('div', { class: 'row' }, h('button', { class: 'quiet', onclick: () => { location.hash = '#/'; } }, 'Cancel'), h('button', { class: 'primary', onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Copying…';
      try { await api('/api/clone', { rid: $('#c-rid').value.trim(), folder: $('#c-folder').value.trim(), seed: $('#c-seed').value.trim() || undefined }); toast('Copied.'); location.hash = `#/r/${$('#c-folder').value.trim()}`; }
      catch (x) { toast(x.message, true); $('#c-out')?.remove(); e.target.parentElement.after(h('pre', { class: 'out', id: 'c-out' }, x.out || '')); e.target.disabled = false; e.target.textContent = 'Copy it'; }
    } }, 'Copy it'))));
}

// ── one republic ────────────────────────────────────────────────────────────
async function republic(folder) {
  const info = await api('/api/info'); const r = info.republics.find(x => x.folder === folder);
  if (!r) { main.replaceChildren(h('section', {}, h('p', {}, `There is no republic called ${folder}.`))); return; }
  const outBox = h('pre', { class: 'out', hidden: true });
  const run = async (args, extra = {}) => { outBox.hidden = false; outBox.textContent = `$ entity ${args.join(' ')}\n…`; const x = await api(`/api/r/${folder}/run`, { args, ...extra }); outBox.textContent = `$ entity ${args.join(' ')}\n${x.out}`; return x; };
  const btn = (label, args, cls = 'quiet') => h('button', { class: cls, onclick: () => run(args) }, label);
  const me = r.node.signAs || '';
  const nodeForm = () => {
    const n = r.node;
    const f = { settleAfter: h('input', { type: 'number', min: 0, value: n.settleAfter ?? 0 }), look: h('select', {}, ['minimal', 'classic', 'schoolbook', 'terminal'].map(o => h('option', { selected: (n.look || 'minimal') === o ? true : null }, o))),
      colour: h('select', {}, ['dark', 'light', 'system'].map(o => h('option', { selected: (n.colour || 'dark') === o ? true : null }, o))),
      publishOnSettle: h('select', {}, [['true', 'yes'], ['false', 'no']].map(([v, l]) => h('option', { value: v, selected: String(n.publishOnSettle !== false) === v ? true : null }, l))),
      modulesOnline: h('select', {}, [['true', 'yes'], ['false', 'no']].map(([v, l]) => h('option', { value: v, selected: String(n.modulesOnline !== false) === v ? true : null }, l))),
      port: h('input', { type: 'number', value: n.port || 7780 }) };
    return [h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, 'Settle acts after (seconds; 0 at once)'), f.settleAfter, h('label', {}, 'Default look'), f.look, h('label', {}, 'Default colours'), f.colour),
      h('div', {}, h('label', {}, 'Publish each settlement to Radicle'), f.publishOnSettle, h('label', {}, 'Let its page prepare module installs'), f.modulesOnline, h('label', {}, 'Port'), f.port)),
      h('p', { class: 'fine' }, 'These are this computer’s own settings for serving the republic (node.json), not decisions of the republic. On a public server, you may want to turn module preparation off so strangers can’t make it fetch code.'),
      h('div', { class: 'row' }, h('button', { onclick: async () => {
        await api(`/api/r/${folder}/node`, { settings: { settleAfter: Number(f.settleAfter.value), look: f.look.value, colour: f.colour.value, publishOnSettle: f.publishOnSettle.value === 'true', modulesOnline: f.modulesOnline.value === 'true', port: Number(f.port.value) } });
        toast('Saved. Restart serving to apply it.');
      } }, 'Save'))];
  };
  const settingsBox = h('div', {}, h('button', { class: 'quiet', onclick: async (e) => {
    e.target.remove();
    const cat = await api(`/api/r/${folder}/settings`), changes = {};
    const as = h('input', { value: me, placeholder: 'your member id' });
    settingsBox.append(h('p', { class: 'hint' }, 'Changing a setting is a proposal, decided under its rule. If you are the only member, voting for it carries it at once.'),
      h('label', {}, 'Propose as'), as,
      ...cat.filter(c => !['entity.modules'].includes(c.key)).map(c => {
        const v = c.current;
        const input = c.one_of ? h('select', { onchange: (e2) => { changes[c.key] = e2.target.value; } }, c.one_of.map(o => h('option', { selected: String(o) === String(v) ? true : null }, o)))
          : c.type === 'boolean' ? h('select', { onchange: (e2) => { changes[c.key] = e2.target.value === 'true'; } }, ['true', 'false'].map(o => h('option', { selected: String(v) === o ? true : null }, o)))
          : typeof v === 'number' ? h('input', { type: 'number', value: v, onchange: (e2) => { changes[c.key] = Number(e2.target.value); } })
          : Array.isArray(v) ? h('input', { value: v.join(', '), onchange: (e2) => { changes[c.key] = e2.target.value.split(',').map(s => s.trim()).filter(Boolean); } })
          : h('input', { value: v ?? '', onchange: (e2) => { changes[c.key] = e2.target.value; } });
        return h('div', { class: 'setting' }, h('div', {}, h('strong', {}, c.key), h('p', { class: 'fine' }, `${c.describe}${c.changed_by ? ` · changed by the ${c.changed_by} rule` : ''}`)), input);
      }),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => {
        if (!Object.keys(changes).length) return toast('Nothing has changed.', true);
        try { const x = await api(`/api/r/${folder}/propose`, { as: as.value.trim(), title: 'Change settings', changes, vote: true }); outBox.hidden = false; outBox.textContent = x.out; toast('Proposed, and your vote cast.'); }
        catch (x) { outBox.hidden = false; outBox.textContent = x.out || x.message; toast(x.message, true); }
      } }, 'Propose these changes')));
  } }, 'Show every setting'));
  const any = h('input', { placeholder: 'status   ·   module available   ·   count d-…' });
  main.replaceChildren(
    h('section', {}, h('h1', {}, r.name || folder), h('p', { class: 'hint' }, `${r.founded ? `${r.records} records · ${r.id || ''}` : 'not founded'} · ${folder} · version ${r.version || '?'}`),
      h('div', { class: 'row' }, r.served ? [h('a', { href: r.served.url, target: '_blank' }, h('button', { class: 'primary' }, 'Open its page ↗')), h('button', { onclick: async () => { await api(`/api/r/${folder}/stop`, {}); toast('Stopped.'); republic(folder); } }, 'Stop serving')]
        : h('button', { class: 'primary', onclick: async () => { const s = await api(`/api/r/${folder}/serve`, {}); toast(`Serving at ${s.url}`); republic(folder); } }, 'Start serving'),
        h('button', { class: 'quiet', onclick: () => { location.hash = '#/'; } }, '← All republics'))),
    h('section', {}, h('h2', {}, 'Check and keep'), h('div', { class: 'row' }, btn('Verify the record', ['verify']), btn('What it holds', ['status']), btn('Settle waiting acts', ['settle']), btn('The members', ['participants']), btn('Attest to it', ['attest']), btn('Look for damage', ['diagnose']))),
    h('section', {}, h('h2', {}, 'Settings'), settingsBox),
    h('section', {}, h('h2', {}, 'Modules'), h('p', { class: 'hint' }, 'Installing a module is a proposal; the republic’s page (Settings → Install or upgrade modules) does it with a click. From here:'),
      h('div', { class: 'row' }, btn('Installed', ['module', 'list']), btn('Available', ['module', 'available'])),
      h('div', { class: 'row' }, (() => { const n = h('input', { placeholder: 'module name, e.g. contracts', style: 'max-width:16em' }); const as = h('input', { placeholder: 'as (your id)', value: me, style: 'max-width:10em' });
        return [n, as, h('button', { onclick: () => run(['module', 'add', n.value.trim(), '--as', as.value.trim()]) }, 'Propose installing'), h('button', { class: 'quiet', onclick: () => run(['module', 'upgrade', n.value.trim(), '--as', as.value.trim()]) }, 'Propose upgrading')]; })())),
    h('section', {}, h('h2', {}, 'Your sign-in'), h('div', { class: 'row' }, (() => { const as = h('input', { placeholder: 'your id', value: me, style: 'max-width:10em' }); const pw = h('input', { type: 'password', placeholder: 'new password (12+)', style: 'max-width:16em' });
      return [as, pw, h('button', { onclick: () => run(['password', 'set', '--as', as.value.trim(), '--settle'], { newPassword: pw.value }) }, 'Set a password')]; })())),
    h('section', {}, h('h2', {}, 'Copies'), h('p', { class: 'hint' }, 'Publish it on Radicle so others can hold a copy (private: only the copies you allow), or sync with the copies that exist.'),
      h('div', { class: 'row' }, btn('Publish on Radicle', ['radicle', 'init']), btn('Publish privately', ['radicle', 'init', '--private']), btn('Radicle status', ['radicle', 'status']), btn('Sync and settle', ['sync', '--settle']))),
    h('section', {}, h('h2', {}, 'Upgrade its code'), h('p', { class: 'hint' }, `Compares it with the code this panel runs (${info.version}); the upgrade is a proposal the members decide.`),
      h('div', { class: 'row' }, btn('Check', ['upgrade', 'check', `dir:${info.source}`]), (() => { const as = h('input', { placeholder: 'as (your id)', value: me, style: 'max-width:10em' }); return [as, h('button', { class: 'quiet', onclick: () => run(['upgrade', 'propose', `dir:${info.source}`, '--as', as.value.trim()]) }, 'Propose the upgrade')]; })(), btn('Install an approved upgrade', ['upgrade', 'apply']))),
    h('section', {}, h('h2', {}, 'Serving this computer'), ...nodeForm()),
    h('section', {}, h('h2', {}, 'Any command'), h('p', { class: 'hint' }, 'Anything the terminal’s entity command does (except serve and app, which this panel runs itself).'),
      h('div', { class: 'row' }, any, h('button', { onclick: () => run(any.value.trim().match(/"[^"]*"|\S+/g).map(s => s.replace(/^"|"$/g, ''))) }, 'Run')), outBox));
}

function route() {
  const p = location.hash.replace(/^#\/?/, '');
  if (p === 'new') return guide(0).catch(e => toast(e.message, true));
  if (p === 'clone') return clone();
  if (p.startsWith('r/')) return republic(p.slice(2)).catch(e => toast(e.message, true));
  return home().catch(e => toast(e.message, true));
}
addEventListener('hashchange', route);
route();
