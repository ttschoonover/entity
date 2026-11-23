// site.js · Notify.S in the browser.
//
// Three pages, each a function below: alerts (everyone), house (its emergency
// managers), central (admins). Reading goes through /m/notifys/…; every change
// is an act signed here with the member's password and sent to /acts. The
// system decides who may do what (library/notifys/index.js); this page only
// shows each person the buttons they can use.
import { $, h, get, post, send, signAct, keyFor, heldKey, forgetKey, sizes } from '/hub.js';
import { recordKeyFromSeed, cryptoB64 } from '/kernel/sealing.js';
import { signRequest } from '/kernel/notice.js';
import { saveIdentity } from '/interface/js/keystore.js';

let me = null, flash = '';
const view = $('#view');
// A message that survives the redraw after an action ("Sent.", "Jun is in.").
const note = () => { const m = h('p', { class: 'msg' }, flash); flash = ''; return m; };
const say = (el, text, bad = false) => { el.textContent = text; el.className = bad ? 'msg bad' : 'msg'; };
const when = (iso) => {
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// ── signing: the password is asked once per visit, only when something is signed ──
function unlock() {
  const held = heldKey(me.member); if (held) return Promise.resolve(held);
  const d = $('#unlock'), pw = $('#unlock-pw');
  pw.value = '';
  return new Promise((resolve) => {
    d.addEventListener('close', async () => resolve(d.returnValue === 'ok' && pw.value ? await keyFor(me.entity, me.member, pw.value) : null), { once: true });
    d.returnValue = ''; d.showModal(); pw.focus();
  });
}
async function act(kind, fields) {
  const key = await unlock(); if (!key) throw new Error('Nothing was sent.');
  try { return await send(await signAct(me.entity, me.member, key, kind, fields)); }
  catch (e) { if (/signature invalid/.test(e.message)) { forgetKey(); throw new Error('That password doesn\'t match your account.'); } throw e; }
}
// Run an act from a button, then redraw the page; errors show in `msg`.
const doing = (msg, redraw) => async (kind, fields, done = 'Done.') => {
  say(msg, 'Working…');
  try { await act(kind, fields); me = await get('/m/notifys/me'); flash = done; await redraw(); } catch (e) { say(msg, e.message, true); }
};

// ── masthead ────────────────────────────────────────────────────────────────
function masthead(page) {
  const tabs = [['#/', 'Alerts', 'alerts', true],
    ...me.manages.map(x => [`#/house/${x.id}`, me.manages.length > 1 ? x.name : 'House', `house/${x.id}`, true]),
    ['#/central', 'Central', 'central', me.admin]];
  $('#tabs').replaceChildren(...tabs.filter(t => t[3]).map(([href, label, id]) => h('a', { href, 'aria-current': page === id ? 'page' : null }, label)));
  $('#sizes').replaceChildren(sizes());
  $('#who').replaceChildren(`${me.display}${me.houseName ? ` · ${me.houseName}` : ''} · `,
    h('button', { class: 'linkish', type: 'button', onclick: async () => { await post('/auth/signout', {}); location.replace('/signin'); } }, 'sign out'));
}

// ── alerts ──────────────────────────────────────────────────────────────────
// One alert, with its tags, the facts a good warning carries, and who sent it.
function alertItem(a) {
  const level = h('span', { class: `tag ${a.to === 'central' ? 'central' : 'house'}` }, a.label);
  const kind = a.type === 'allclear' ? h('span', { class: 'tag clear' }, 'All clear') : a.type === 'update' ? h('span', { class: 'tag minor' }, 'Update') : null;
  const severity = a.type === 'alert' && a.severity ? h('span', { class: `tag ${a.severity}` }, a.severity) : null;
  const facts = [['Where', a.where], ['What to do', a.todo], ['Until', a.until]].filter(([, v]) => v);
  return [
    h('div', { class: 'alert-head' }, level, kind, severity, h('strong', {}, a.title), h('time', { datetime: a.at }, when(a.at))),
    a.text ? h('p', { class: 'alert-body' }, a.text) : null,
    facts.length ? h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
    h('div', { class: 'from' }, `${a.from} · ${a.to === 'central' ? 'central' : a.label}`),
  ];
}

// The compose form. Its fields are the parts of a complete warning: what is
// happening, where, what to do, until when; the system adds who and from where.
function compose(alerts, redraw) {
  if (!me.sendsTo.length) return null;
  const msg = note();
  const field = (id, label, el) => h('label', { for: id }, label, el);
  const to = h('select', { id: 'c-to' }, me.sendsTo.map(x => h('option', { value: x.id }, x.id === 'central' ? 'Everyone (central)' : x.name)));
  const type = h('select', { id: 'c-type' }, [['alert', 'New alert'], ['update', 'Update to an alert'], ['allclear', 'All clear']].map(([v, l]) => h('option', { value: v }, l)));
  const ref = h('select', { id: 'c-ref' });
  const refBox = field('c-ref', 'Which alert', ref); refBox.hidden = true;
  const sev = h('select', { id: 'c-sev' }, [['severe', 'Severe: a real danger'], ['extreme', 'Extreme: danger to life'], ['moderate', 'Moderate: a possible danger'], ['minor', 'Minor: worth knowing']].map(([v, l]) => h('option', { value: v }, l)));
  const sevBox = field('c-sev', 'How serious', sev);
  const title = h('input', { id: 'c-title', type: 'text', maxlength: '120', required: true, placeholder: 'Gas smell in the South House kitchen' });
  const text = h('textarea', { id: 'c-text', rows: '3', maxlength: '2000' });
  const where = h('input', { id: 'c-where', type: 'text', maxlength: '200' });
  const todo = h('input', { id: 'c-todo', type: 'text', maxlength: '500' });
  const until = h('input', { id: 'c-until', type: 'text', maxlength: '100', placeholder: 'e.g. 9 pm, or until the all clear' });
  const refresh = () => {
    const open = alerts.filter(a => a.type === 'alert' && a.to === to.value);
    ref.replaceChildren(...open.map(a => h('option', { value: String(a.seq) }, `${a.title} (${when(a.at)})`)));
    refBox.hidden = type.value === 'alert'; sevBox.hidden = type.value !== 'alert';
  };
  to.addEventListener('change', refresh); type.addEventListener('change', refresh); refresh();
  const form = h('form', { onsubmit: async (ev) => {
    ev.preventDefault();
    if (type.value !== 'alert' && !ref.value) return say(msg, 'There is no earlier alert here to follow.', true);
    const f = { to: to.value, type: type.value, title: title.value.trim(), text: text.value.trim(), where: where.value.trim(), todo: todo.value.trim(), until: until.value.trim(),
      ...(type.value === 'alert' ? { severity: sev.value } : { ref: Number(ref.value) }) };
    for (const k of ['text', 'where', 'todo', 'until']) if (!f[k]) delete f[k];
    await doing(msg, redraw)('notifys.alert', f, 'Sent.');
  } },
    h('div', { class: 'grid' }, field('c-to', 'Send to', to), field('c-type', 'Kind', type)), refBox,
    field('c-title', 'What is happening', title),
    h('div', { class: 'grid' }, field('c-where', 'Where', where), sevBox),
    field('c-todo', 'What people should do', todo),
    h('div', { class: 'grid' }, field('c-until', 'Until', until)),
    field('c-text', 'More detail (optional)', text),
    h('button', { type: 'submit', class: 'urgent' }, 'Send'), msg);
  return h('details', { class: 'compose', open: alerts.length === 0 || msg.textContent ? true : null }, h('summary', {}, 'Send an alert'), h('article', {}, form));
}

// Turning notifications on: this device (push) and email, each a subscription
// proved with the member's record key (cli/notify.js).
const subsKey = () => `notifys:subs:${me.entity}:${me.member}`;
const subs = () => { try { return JSON.parse(localStorage.getItem(subsKey()) || '{}'); } catch { return {}; } };
const keepSubs = (x) => { try { localStorage.setItem(subsKey(), JSON.stringify(x)); } catch { /* storage off */ } };
async function recordSecret() {
  const key = await unlock(); if (!key) throw new Error('Nothing changed.');
  const { sk, pk } = await recordKeyFromSeed(key.seed);
  if (me.recordKey !== cryptoB64(pk)) { await send(await signAct(me.entity, me.member, key, 'member.recordkey', { key: cryptoB64(pk) })); me = await get('/m/notifys/me'); }
  try { await saveIdentity(me.entity, { id: me.member, rsk: sk, created: new Date().toISOString() }); } catch { /* the banner says "Something new" */ }
  return sk;
}
async function ask(body) {
  const sk = await recordSecret(), { nodeKey } = await get('/notify/keys');
  return post('/notify/request', await signRequest({ entity: me.entity, member: me.member, at: new Date().toISOString(), ...body }, { recordSk: sk, nodeKey }));
}
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
async function deviceOn() {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) throw new Error('This browser can\'t show notifications.');
  if (/iP(hone|ad|od)/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches) throw new Error('On an iPhone, add this page to your Home Screen first (Share, then Add to Home Screen) and open it from there.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in your browser\'s settings.');
  let reg; try { reg = await navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' }); } catch { reg = await navigator.serviceWorker.register('/sw-basic.js', { scope: '/' }); }
  await navigator.serviceWorker.ready;
  const { vapidKey } = await get('/notify/keys');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(vapidKey) });
  const r = await ask({ op: 'subscribe', channel: 'push', push: sub.toJSON(), events: ['notices'], label: (navigator.userAgentData?.platform || navigator.platform || 'a device').slice(0, 40) });
  keepSubs({ ...subs(), push: r.id });
}
async function stop(which) { const id = subs()[which]; if (id) await ask({ op: 'unsubscribe', id }); const x = subs(); delete x[which]; keepSubs(x); }

function tellMe() {
  const s = subs(), msg = h('p', { class: 'msg' });
  const dev = h('input', { type: 'checkbox', role: 'switch', id: 't-dev', checked: s.push ? true : null });
  const mail = h('input', { type: 'checkbox', role: 'switch', id: 't-mail', checked: s.email ? true : null });
  const addr = h('input', { type: 'email', id: 't-addr', value: s.address || '', placeholder: 'you@berkeley.edu', autocomplete: 'email' });
  const flip = async (box, on, off) => { box.disabled = true; say(msg, ''); try { await (box.checked ? on() : off()); } catch (e) { box.checked = !box.checked; say(msg, e.message, true); } box.disabled = false; };
  dev.addEventListener('change', () => flip(dev, deviceOn, () => stop('push')));
  mail.addEventListener('change', () => flip(mail, async () => {
    if (!addr.value.trim()) throw new Error('Give an email address first.');
    const r = await ask({ op: 'subscribe', channel: 'email', address: addr.value.trim(), events: ['notices'] });
    keepSubs({ ...subs(), email: r.id, address: addr.value.trim() });
  }, () => stop('email')));
  return h('article', {}, h('p', { class: 'label' }, 'Tell me'),
    h('label', { class: 'switch-row', for: 't-dev' }, h('span', {}, 'On this device'), dev),
    h('label', { class: 'switch-row', for: 't-mail' }, h('span', {}, 'By email'), mail),
    h('label', { class: 'vh', for: 't-addr' }, 'Email address'), addr, msg);
}

async function alertsPage() {
  const { alerts } = await get('/m/notifys/alerts');
  // Updates and all-clears sit under the alert they follow.
  const follow = {}; for (const a of alerts) if (a.ref) (follow[a.ref] ||= []).unshift(a);
  const tops = alerts.filter(a => !a.ref || !alerts.some(x => x.seq === a.ref));
  const list = tops.length ? h('ul', { class: 'alerts' }, tops.map(a => h('li', {}, alertItem(a),
    follow[a.seq] ? h('ul', { class: 'updates' }, follow[a.seq].map(u => h('li', {}, alertItem(u)))) : null))) : h('p', { class: 'msg' }, 'No alerts yet.');
  view.replaceChildren(h('div', { class: 'cols' },
    h('section', { class: 'wide' }, compose(alerts, alertsPage), h('p', { class: 'label', style: 'margin-top:1.4rem' }, 'Alerts'), list),
    h('aside', { class: 'side' }, tellMe())));
}

// ── a house, for its emergency managers ─────────────────────────────────────
async function housePage(id) {
  const d = await get(`/m/notifys/house/${id}`), msg = note(), run = doing(msg, () => housePage(id));
  const waiting = h('section', { class: 'block' }, h('p', { class: 'label' }, `Waiting to join · ${d.waiting.length}`),
    d.waiting.length ? d.waiting.map(p => h('article', { class: 'row between' },
      h('div', {}, h('strong', {}, p.name), ` · ${p.id}`, h('div', { class: 'from' }, `Says they live at ${d.house.name} · asked ${when(p.at)}`)),
      h('div', { class: 'row' },
        h('button', { class: 'small', type: 'button', onclick: () => run('notifys.admit', { id: p.id }, `${p.name} is in.`) }, 'Let in'),
        h('button', { class: 'small secondary outline', type: 'button', onclick: () => run('notifys.decline', { id: p.id }, `${p.name} was turned away.`) }, 'Turn away'))))
      : h('p', { class: 'msg' }, 'Nobody right now.'));
  const members = h('section', { class: 'block' }, h('p', { class: 'label' }, `Members · ${d.members.length}`), h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Member'), h('th', {}, 'Role'), h('th', { class: 'c' }, 'House alert team'), h('th', {}, h('span', { class: 'vh' }, 'Remove')))),
    h('tbody', {}, d.members.map(p => h('tr', {},
      h('td', {}, p.name, h('span', { class: 'from' }, ` · ${p.id}`)),
      h('td', {}, p.manager ? h('span', { class: 'tag role' }, 'Emergency manager') : p.admin ? h('span', { class: 'tag role' }, 'Admin') : h('span', { class: 'from' }, 'Member')),
      h('td', { class: 'c' }, h('input', { type: 'checkbox', role: 'switch', 'aria-label': `${p.id} is on the house alert team`, checked: p.team || p.manager ? true : null, disabled: p.manager ? true : null,
        onchange: (ev) => run('notifys.team', { team: id, member: p.id, on: ev.target.checked }) })),
      h('td', { class: 'r' }, p.id === me.member ? null : h('button', { class: 'linkish', type: 'button', onclick: () => { if (confirm(`Remove ${p.name}?`)) run('notifys.remove', { id: p.id }, `${p.name} was removed.`); } }, 'Remove'))))))));
  view.replaceChildren(h('div', { class: 'narrow' }, h('h1', { class: 'page' }, d.house.name), msg, waiting, members));
}

// ── central, for admins ─────────────────────────────────────────────────────
async function centralPage(full = false) {
  const [d, rec] = await Promise.all([get('/m/notifys/central'), get(`/m/notifys/record?n=${full ? 2000 : 12}`)]);
  const msg = note(), run = doing(msg, () => centralPage(full));
  const pick = (id, label) => h('select', { id, 'aria-label': label }, h('option', { value: '' }, 'Choose a member'), d.people.map(p => h('option', { value: p.id }, `${p.name} · ${p.house}`)));
  const houseOptions = d.houses.map(x => h('option', { value: x.id }, x.name));

  const houses = h('section', { class: 'block' }, h('p', { class: 'label' }, `Houses · ${d.houses.length}`), h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'House'), h('th', {}, 'Emergency managers'), h('th', {}, 'Members'), h('th', {}, 'Waiting'))),
    h('tbody', {}, d.houses.map(x => h('tr', {},
      h('td', {}, h('a', { href: `#/house/${x.id}` }, x.name)),
      h('td', {}, x.managers.map(m => h('span', { class: 'tag role', style: 'margin-right:.3rem' }, m.name, ' ',
        h('button', { class: 'linkish', type: 'button', 'aria-label': `Remove ${m.name} as manager`, onclick: () => run('notifys.manager', { house: x.id, member: m.id, on: false }) }, '×'))),
        (() => { const s = pick(`mgr-${x.id}`, `Add a manager to ${x.name}`); s.style.cssText = 'margin:.4rem 0 0;padding:.3rem .5rem;font-size:.85rem';
          s.addEventListener('change', () => s.value && run('notifys.manager', { house: x.id, member: s.value, on: true })); return s; })()),
      h('td', {}, String(x.members)), h('td', {}, x.waiting ? h('span', { class: 'tag central' }, String(x.waiting)) : '0')))))),
    (() => { const id = h('input', { type: 'text', placeholder: 'id, e.g. cloyne', 'aria-label': 'House id' }), name = h('input', { type: 'text', placeholder: 'Name, e.g. Cloyne Court', 'aria-label': 'House name' });
      return h('details', {}, h('summary', {}, 'Add a house'), h('div', { role: 'group' }, id, name,
        h('button', { type: 'button', onclick: () => run('notifys.house', { house: id.value.trim(), name: name.value.trim() }, 'House added.') }, 'Add'))); })());

  const waiting = h('section', { class: 'block' }, h('p', { class: 'label' }, `Waiting to join, every house · ${d.waiting.length}`),
    d.waiting.length ? d.waiting.map(p => { const house = h('select', { 'aria-label': `House for ${p.name}`, style: 'margin:0;width:auto' }, houseOptions.map(o => { const c = o.cloneNode(true); if (c.value === p.house) c.selected = true; return c; }));
      return h('article', { class: 'row between' }, h('div', {}, h('strong', {}, p.name), ` · ${p.id}`, h('div', { class: 'from' }, `Says: ${p.houseName}`)),
        h('div', { class: 'row' }, house,
          h('button', { class: 'small', type: 'button', onclick: () => run('notifys.admit', { id: p.id, house: house.value }, `${p.name} is in.`) }, 'Let in'),
          h('button', { class: 'small secondary outline', type: 'button', onclick: () => run('notifys.decline', { id: p.id }, `${p.name} was turned away.`) }, 'Turn away'))); })
      : h('p', { class: 'msg' }, 'Nobody right now.'));

  const people = (title, list, onAdd, onRemove, lastStays) => { const s = pick(`add-${title}`, `Add to ${title}`);
    return h('section', {}, h('p', { class: 'label' }, title), h('article', {},
      list.map(p => h('div', { class: 'row between', style: 'padding:.4rem 0;border-bottom:1px solid var(--line)' }, h('span', {}, p.name),
        lastStays && list.length === 1 ? h('span', { class: 'from' }, 'the last one stays') : h('button', { class: 'linkish', type: 'button', onclick: () => onRemove(p.id) }, 'Remove'))),
      h('div', { role: 'group', style: 'margin:.8rem 0 0' }, s, h('button', { type: 'button', onclick: () => s.value && onAdd(s.value) }, 'Add')))); };
  const teams = h('div', { class: 'grid', style: 'margin-bottom:2.6rem' },
    people('Central alert team', d.central, (m) => run('notifys.team', { team: 'central', member: m, on: true }), (m) => run('notifys.team', { team: 'central', member: m, on: false })),
    people('Admins', d.admins, (m) => run('notifys.admin', { member: m, on: true }), (m) => run('notifys.admin', { member: m, on: false }), true));

  const log = h('section', { class: 'block' }, h('p', { class: 'label' }, `Record · ${rec.total}`),
    h('div', { class: 'log' }, rec.records.map(r => h('div', {}, h('span', { class: 't' }, new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), '  ', r.kind.padEnd(20), (r.by || '').padEnd(10), r.what))),
    full ? null : h('button', { class: 'linkish', type: 'button', style: 'margin-top:.6rem', onclick: () => centralPage(true) }, 'Whole record'));

  view.replaceChildren(h('div', { class: 'narrow' }, msg, houses, waiting, teams, log));
}

// ── routing ─────────────────────────────────────────────────────────────────
async function route() {
  const path = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = path[0] === 'house' ? `house/${path[1]}` : path[0] === 'central' ? 'central' : 'alerts';
  masthead(page);
  try {
    if (path[0] === 'house' && path[1]) await housePage(path[1]);
    else if (path[0] === 'central' && me.admin) await centralPage();
    else await alertsPage();
  } catch (e) {
    if (e.status === 401) return location.replace('/signin');
    view.replaceChildren(h('p', { class: 'msg bad' }, e.message));
  }
}

(async () => {
  try { me = await get('/m/notifys/me'); } catch (e) { return location.replace('/signin'); }
  if (!me.member) return location.replace('/signin');
  addEventListener('hashchange', route);
  route();
})();
