// site.js · the Lothlórien Unofficial Minihub: the wiki for the house, alerts
// for members, and the admin's tools. It reads through the minihub module's
// routes (/m/minihub/…) and writes signed acts to /acts. The record itself is
// only for admins.
import { $, h, get, post, send, signAct, keyFor, heldKey, forgetKey, sizes } from '/hub.js';
import { renderText } from '/interface/js/markdown.js';
import { recordKeyFromSeed, cryptoB64 } from '/kernel/sealing.js';
import { signRequest } from '/kernel/notice.js';
import { saveIdentity } from '/interface/js/keystore.js';

let me = null, pages = [];
const view = $('#view');
const when = (iso) => { const d = new Date(iso), now = new Date(); return d.toDateString() === now.toDateString() ? 'today' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }); };
const say = (el, text, bad = false) => { el.textContent = text; el.className = bad ? 'msg bad' : 'msg'; };

// ── the password, asked once per visit, only when something is signed ────────
function unlock() {
  const k = heldKey(me.member); if (k) return Promise.resolve(k);
  const d = $('#unlock'), pw = $('#unlock-pw'), msg = $('#unlock-msg');
  pw.value = ''; say(msg, '');
  return new Promise((resolve) => {
    const done = async () => {
      if (d.returnValue !== 'ok' || !pw.value) return resolve(null);
      say(msg, 'Unlocking…');
      try { resolve(await keyFor(me.entity, me.member, pw.value)); } catch (e) { resolve(null); }
    };
    d.addEventListener('close', done, { once: true });
    d.returnValue = ''; d.showModal(); pw.focus();
  });
}
async function act(kind, fields) {
  const k = await unlock(); if (!k) throw new Error('Nothing was sent.');
  try { return await send(await signAct(me.entity, me.member, k, kind, fields)); }
  catch (e) { if (/signature invalid/.test(e.message)) { forgetKey(); throw new Error('That password doesn’t match your account.'); } throw e; }
}
const asAdmin = (effects) => act('authority.exercise', { grant: 'admin', effects });

// ── masthead ────────────────────────────────────────────────────────────────
function masthead(tab) {
  $('#name').textContent = me.name; document.title = me.name;
  const tabs = [['wiki', 'wiki', true], ['alerts', 'alerts', !!me.member], ['admin', 'admin', me.admin]];
  $('#tabs').replaceChildren(...tabs.filter(t => t[2]).map(([id, label]) => h('a', { href: `#/${id}`, 'aria-current': tab === id ? 'page' : null }, label)));
  $('#sizes').replaceChildren(sizes());
  $('#who').replaceChildren(...(me.member
    ? [me.display, ' · ', h('button', { class: 'linkish', type: 'button', onclick: async () => { await post('/auth/signout', {}); location.reload(); } }, 'sign out')]
    : [h('a', { href: '/signin?member=1' }, 'sign in')]));
}

// ── wiki ────────────────────────────────────────────────────────────────────
function sidebar(current) {
  const byCat = new Map();
  for (const p of pages) { const c = p.category || 'Pages'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(p); }
  const find = h('input', { type: 'search', id: 'find', 'aria-label': 'Search the wiki', placeholder: 'search' });
  const lists = h('div');
  const draw = () => {
    const q = find.value.trim().toLowerCase();
    lists.replaceChildren(...[...byCat].flatMap(([cat, ps]) => {
      const shown = ps.filter(p => !q || p.title.toLowerCase().includes(q));
      return shown.length ? [h('div', { class: 'head' }, cat.toLowerCase()), h('ul', {}, shown.map(p => h('li', {}, h('a', { href: `#/wiki/${p.id}`, 'aria-current': p.id === current ? 'page' : null }, p.title))))] : [];
    }));
  };
  find.addEventListener('input', draw); draw();
  return h('aside', { class: 'side' }, h('div', { style: 'margin-bottom:1.6rem' }, find), lists,
    me.member ? h('a', { href: '#/new' }, 'new page') : null);
}

// Markdown with footnotes: [^1] where cited, [^1]: the source on its own line.
function body(md) {
  const defs = new Map();
  const text = String(md).split('\n').filter(l => { const m = l.match(/^\[\^([A-Za-z0-9-]{1,20})\]:\s*(.+)$/); if (m) { defs.set(m[1], m[2]); return false; } return true; }).join('\n');
  const order = [];
  const html = renderText(text, { base: `${location.origin}/` }).html.replace(/\[\^([A-Za-z0-9-]{1,20})\]/g, (all, id) => {
    if (!defs.has(id)) return all;
    let n = order.indexOf(id) + 1; if (!n) { order.push(id); n = order.length; }
    return `<sup><a href="#fn-${n}" id="ref-${n}" aria-label="Note ${n}">${n}</a></sup>`;
  }).replace(/<\/sup><sup>/g, ',');
  const el = h('div', { class: 'body', html });
  // Footnote links jump within the page, not to a route.
  el.addEventListener('click', (ev) => { const a = ev.target.closest('a[href^="#fn-"], a[href^="#ref-"]'); if (!a) return; ev.preventDefault(); document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ block: 'center' }); });
  const notes = order.length ? h('ol', { class: 'notes' }, order.map((id, i) => h('li', { id: `fn-${i + 1}`, html: renderText(defs.get(id), { base: `${location.origin}/` }).html.replace(/^<p>|<\/p>$/g, '') }))) : null;
  return [el, notes];
}

async function wikiView(id, version) {
  const target = id || (pages.find(p => p.id === 'welcome') || pages[0])?.id;
  let page = null;
  if (target) { try { page = await get(`/m/minihub/wiki/${target}${version ? `?v=${version}` : ''}`); } catch { page = null; } }
  const art = page
    ? h('article', {},
        h('h1', {}, page.title),
        h('p', { class: 'meta' }, [page.category, `edited by ${page.by}, ${when(page.at)}`, page.n < page.latest ? `version ${page.n} of ${page.latest}` : null].filter(Boolean).join(' · '), ' · ',
          me.member ? [h('a', { href: `#/wiki/${page.id}/edit` }, 'edit'), ' · '] : null,
          h('a', { href: `/documents/wiki/${page.id}.pdf${page.n < page.latest ? `?v=${page.n}` : ''}` }, 'PDF')),
        body(page.body))
    : h('article', {}, h('h1', {}, id ? 'No such page' : 'No pages yet'));
  view.replaceChildren(h('div', { class: 'wrap' }, sidebar(page?.id), h('main', { class: 'page' }, art)));
}

async function editView(id) {
  const page = id ? await get(`/m/minihub/wiki/${id}`).catch(() => null) : null;
  const pid = h('input', { type: 'text', id: 'e-id', value: page?.id || '', pattern: '[a-z0-9][a-z0-9-]{0,59}', disabled: page ? true : null });
  const title = h('input', { type: 'text', id: 'e-title', value: page?.title || '' });
  const cat = h('input', { type: 'text', id: 'e-cat', value: page?.category || '' });
  const text = h('textarea', { class: 'code', id: 'e-body' }); text.value = page?.body || '';
  const msg = h('p', { class: 'msg' });
  const save = async () => {
    const pageId = page?.id || pid.value.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(pageId)) return say(msg, 'The address is lowercase letters, digits and -.', true);
    say(msg, 'Saving…');
    try {
      await act('wiki.edit', { page: pageId, title: title.value.trim(), body: text.value, base: page?.latest || 0, ...(cat.value.trim() ? { category: cat.value.trim() } : {}) });
      pages = (await get('/m/minihub/wiki')).pages; location.hash = `#/wiki/${pageId}`;
    } catch (e) { say(msg, e.message, true); }
  };
  view.replaceChildren(h('div', { class: 'narrow' }, h('div', { class: 'stack' },
    page ? null : [h('label', { class: 'k', for: 'e-id' }, 'address'), pid],
    h('div', { class: 'grid2' }, h('div', {}, h('label', { class: 'k', for: 'e-title' }, 'title'), title), h('div', {}, h('label', { class: 'k', for: 'e-cat' }, 'category'), cat)),
    h('label', { class: 'k', for: 'e-body' }, 'text'), text,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: save }, 'Save'), h('a', { href: page ? `#/wiki/${page.id}` : '#/' }, 'Cancel')), msg)));
}

// ── alerts ──────────────────────────────────────────────────────────────────
const subsKey = () => `loth:subs:${me.entity}:${me.member}`;
const subs = () => { try { return JSON.parse(localStorage.getItem(subsKey()) || '{}'); } catch { return {}; } };
const keepSubs = (s) => { try { localStorage.setItem(subsKey(), JSON.stringify(s)); } catch { /* storage off */ } };

async function recordSk() {
  const k = await unlock(); if (!k) throw new Error('Nothing changed.');
  const { sk, pk } = await recordKeyFromSeed(k.seed);
  const mine = cryptoB64(pk);
  if (me.recordKey !== mine) {   // first time, or a key published from somewhere else
    await send(await signAct(me.entity, me.member, k, 'member.recordkey', { key: mine }));
    me = await get('/m/minihub/me');
  }
  // So this device's notification banner can open alerts: the record key reads, it cannot sign.
  try { await saveIdentity(me.entity, { id: me.member, rsk: sk, created: new Date().toISOString() }); } catch { /* the banner says "Something new" */ }
  return sk;
}
async function ask(body) {
  const sk = await recordSk();
  const { nodeKey, vapidKey } = await get('/notify/keys');
  const req = await signRequest({ entity: me.entity, member: me.member, at: new Date().toISOString(), ...body }, { recordSk: sk, nodeKey });
  return { ...(await post('/notify/request', req)), vapidKey };
}
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

async function deviceOn() {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) throw new Error('This browser can’t show notifications.');
  if (/iP(hone|ad|od)/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches) throw new Error('On an iPhone, add this page to your Home Screen first (Share, then Add to Home Screen), and open it from there.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in the browser’s settings.');
  let reg; try { reg = await navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' }); } catch { reg = await navigator.serviceWorker.register('/sw-basic.js', { scope: '/' }); }
  await navigator.serviceWorker.ready;
  const { vapidKey } = await get('/notify/keys');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(vapidKey) });
  const r = await ask({ op: 'subscribe', channel: 'push', push: sub.toJSON(), events: ['notices'], label: (navigator.userAgentData?.platform || navigator.platform || 'a device').slice(0, 40) });
  keepSubs({ ...subs(), push: r.id });
}
async function stop(which) {
  const id = subs()[which];
  if (id) await ask({ op: 'unsubscribe', id });
  const s = subs(); delete s[which]; keepSubs(s);
}

async function alertsView() {
  if (!me.member) { location.href = '/signin?member=1'; return; }
  const { alerts, sender } = await get('/m/minihub/alerts');
  const msg = h('p', { class: 'msg' });
  let compose = null;
  if (sender) {
    const t = h('input', { type: 'text', id: 'a-title', maxlength: '120', placeholder: 'Subject' });
    const b = h('textarea', { id: 'a-text', rows: '3', maxlength: '2000', placeholder: 'Message' });
    compose = h('form', { class: 'stack', style: 'margin-bottom:3rem', onsubmit: async (ev) => {
      ev.preventDefault(); if (!t.value.trim()) return say(msg, 'Give it a subject.', true);
      say(msg, 'Sending…');
      try { await act('alert.send', { title: t.value.trim(), ...(b.value.trim() ? { text: b.value.trim() } : {}) }); alertsView(); }
      catch (e) { say(msg, e.message, true); }
    } }, h('label', { class: 'k', for: 'a-title' }, 'send an alert'), t, h('label', { class: 'vh', for: 'a-text' }, 'Message'), b,
      h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn' }, 'Send to everyone')), msg);
  }
  const list = alerts.length ? h('ul', { class: 'list' }, alerts.map(a => h('li', {},
    h('div', { class: 'alert-head' }, h('strong', {}, a.title), h('time', { datetime: a.at }, when(a.at))),
    a.text ? h('p', { class: 'alert-text' }, a.text) : null,
    h('div', { class: 'soft small' }, a.by)))) : h('p', { class: 'soft' }, 'No alerts yet.');

  const s = subs(), smsg = h('p', { class: 'msg' });
  const dev = h('input', { type: 'checkbox', id: 't-dev', checked: s.push ? true : null });
  const mail = h('input', { type: 'checkbox', id: 't-mail', checked: s.email ? true : null });
  const addr = h('input', { type: 'email', id: 't-addr', value: s.address || '', placeholder: 'email address', autocomplete: 'email' });
  const flip = async (box, on, off) => { box.disabled = true; say(smsg, ''); try { await (box.checked ? on() : off()); } catch (e) { box.checked = !box.checked; say(smsg, e.message, true); } box.disabled = false; };
  dev.addEventListener('change', () => flip(dev, deviceOn, () => stop('push')));
  mail.addEventListener('change', () => flip(mail, async () => {
    const a = addr.value.trim(); if (!a) throw new Error('Give an email address first.');
    const r = await ask({ op: 'subscribe', channel: 'email', address: a, events: ['notices'] });
    keepSubs({ ...subs(), email: r.id, address: a });
  }, () => stop('email')));
  const tell = h('aside', { class: 'side', style: 'max-width:18rem' },
    h('div', { class: 'head' }, 'tell me'),
    h('label', { class: 'switch', for: 't-dev' }, h('span', {}, 'On this device'), dev),
    h('label', { class: 'switch', for: 't-mail' }, h('span', {}, 'By email'), mail),
    h('label', { class: 'vh', for: 't-addr' }, 'Email address'), h('div', { style: 'margin-top:.8rem' }, addr), smsg);
  view.replaceChildren(h('div', { class: 'wrap' }, h('main', { class: 'page', style: 'max-width:38rem' }, compose, list), tell));
}

// ── admin ───────────────────────────────────────────────────────────────────
async function adminView(full = false) {
  if (!me.admin) { location.hash = '#/'; return; }
  const [a, rec, house] = await Promise.all([get('/m/minihub/admin'), get(`/m/minihub/record?n=${full ? 2000 : 12}`), get('/house/config').catch(() => null)]);
  const msg = h('p', { class: 'msg' });
  const run = async (effects, done = 'Done.') => { say(msg, 'Working…'); try { await asAdmin(effects); say(msg, done); me = await get('/m/minihub/me'); adminView(full); } catch (e) { say(msg, e.message, true); } };
  const senders = a.members.filter(m => m.sender).map(m => m.id);

  const asking = h('section', { class: 'block' }, h('h2', { class: 'sect' }, `asking to join · ${a.applicants.length}`),
    a.applicants.length ? h('ul', { class: 'list' }, a.applicants.map(p => h('li', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('strong', {}, p.id), p.name !== p.id ? h('span', { class: 'soft' }, ` · ${p.name}`) : null, p.at ? h('span', { class: 'soft' }, ` · ${when(p.at)}`) : null),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => run([{ kind: 'participant.admit', id: p.id }], `${p.id} is in.`) }, 'Approve'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => run([{ kind: 'participant.remove', id: p.id, reason: 'Not approved by an admin' }], `${p.id} was declined.`) }, 'Decline'))))) : h('p', { class: 'soft' }, 'Nobody right now.'));

  const people = h('section', { class: 'block' }, h('h2', { class: 'sect' }, `members · ${a.members.length}`), h('div', { class: 'scroll' }, h('table', { class: 'people' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Member'), h('th', { class: 'c' }, 'Sends alerts'), h('th', { class: 'c' }, 'Admin'), h('th', {}, h('span', { class: 'vh' }, 'Remove')))),
    h('tbody', {}, a.members.map(m => h('tr', {},
      h('td', {}, m.id, m.name !== m.id ? h('span', { class: 'soft' }, ` · ${m.name}`) : null),
      h('td', { class: 'c' }, h('input', { type: 'checkbox', 'aria-label': `${m.id} sends alerts`, checked: m.sender ? true : null,
        onchange: (ev) => run([{ kind: 'minihub.senders', members: ev.target.checked ? [...senders, m.id] : senders.filter(x => x !== m.id) }]) })),
      h('td', { class: 'c' }, h('input', { type: 'checkbox', 'aria-label': `${m.id} is an admin`, checked: m.admin ? true : null, disabled: m.id === me.member ? true : null,
        onchange: (ev) => run([{ kind: ev.target.checked ? 'office.fill' : 'office.vacate', office: 'admin', holder: m.id }]) })),
      h('td', { class: 'r' }, m.id === me.member ? null : h('button', { class: 'linkish soft', type: 'button', onclick: () => { if (confirm(`Remove ${m.id} from the hub?`)) run([{ kind: 'participant.remove', id: m.id, reason: 'Removed by an admin' }], `${m.id} was removed.`); } }, 'Remove'))))))));

  let houseBox = null;
  if (house) {
    const nm = h('input', { type: 'text', id: 'h-name', value: house.name || me.name });
    const pw = h('input', { type: 'password', id: 'h-pw', placeholder: 'unchanged', autocomplete: 'new-password' });
    const hmsg = h('p', { class: 'msg' });
    houseBox = h('section', { class: 'block' }, h('h2', { class: 'sect' }, 'house'),
      h('div', { class: 'grid2' }, h('div', {}, h('label', { class: 'k', for: 'h-name' }, 'name'), nm), h('div', {}, h('label', { class: 'k', for: 'h-pw' }, 'house password'), pw)),
      h('p', { class: 'soft small' }, `House Wi-Fi: ${[...(house.detected?.addresses || []), ...(house.publicIps || [])].join(', ') || 'not found yet'}`),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
        const b = {}; if (nm.value.trim() && nm.value.trim() !== house.name) b.name = nm.value.trim(); if (pw.value) b.password = pw.value;
        if (!Object.keys(b).length) return say(hmsg, 'Nothing to change.');
        try { await post('/house/config', b); say(hmsg, 'Saved.'); pw.value = ''; me = await get('/m/minihub/me'); masthead('admin'); } catch (e) { say(hmsg, e.message, true); }
      } }, 'Save')), hmsg);
  }

  const pad = (s, n) => String(s).padEnd(n);
  const log = h('section', { class: 'block' }, h('h2', { class: 'sect' }, `record · ${rec.total}`),
    h('div', { class: 'log' }, rec.records.map(r => h('div', {}, h('span', { class: 't' }, new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), '  ', pad(r.kind, 20), pad(r.by, 10), r.what))),
    full ? null : h('p', {}, h('button', { class: 'linkish soft', type: 'button', onclick: () => adminView(true) }, 'Whole record')));

  view.replaceChildren(h('div', { class: 'narrow' }, msg, asking, people, houseBox, log));
}

// ── routing ─────────────────────────────────────────────────────────────────
async function route() {
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  const tab = path[0] === 'alerts' || path[0] === 'admin' ? path[0] : 'wiki';
  masthead(tab);
  try {
    if (path[0] === 'alerts') return await alertsView();
    if (path[0] === 'admin') return await adminView();
    if (path[0] === 'new' && me.member) return await editView(null);
    if (path[0] === 'wiki' && path[2] === 'edit' && me.member) return await editView(path[1]);
    return await wikiView(path[0] === 'wiki' ? path[1] : null, new URLSearchParams(location.search).get('v'));
  } catch (e) {
    if (e.status === 401) { location.href = '/signin'; return; }
    view.replaceChildren(h('div', { class: 'narrow' }, h('p', { class: 'msg bad' }, e.message)));
  } finally { window.scrollTo(0, 0); }
}

(async () => {
  try { me = await get('/m/minihub/me'); pages = (await get('/m/minihub/wiki')).pages; }
  catch (e) { if (e.status === 401) { location.href = '/signin'; return; } view.textContent = e.message; return; }
  addEventListener('hashchange', route);
  route();
})();
