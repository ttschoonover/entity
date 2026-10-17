// home.js · the federation and its states on one page: the federal parliament
// drawn seat by seat, every state with its government, citizens and seats, the
// open votes of all of them, the currency and the parties. Each record is
// fetched from its own node and verified in this browser.
//
// A state's registrar reports its citizens and appointments to the federation
// from here (state.certify, signed with their key in the state), and a state's
// citizen takes up federal citizenship (citizen.enroll, proved with their state
// key; their federal key comes from the same password).
import { start, onChange, onSigned, ctx, h, $, joinDialog, signInDialog, withEntity, toast, E } from './common.js';
import { drawOpen } from './floor.js';
import { lockSeed, unlockSeed } from './interface/js/lock.js';
import * as K from './interface/js/keystore.js';

const fed = () => ctx.all[0];
const states = () => ctx.all.slice(1);
const color = (i) => `var(--s${i % 4})`;
const nameOf = (x) => (x.r?.ok ? x.r.params.value('entity.name') : x.label || x.key);
const now = () => new Date().toISOString();
const person = (x, id) => {
  const t = x.r.state.m.titles?.[id], n = (typeof t === 'string' ? t : t?.title) || x.r.state.participants[id]?.name || id;
  return n !== id ? `${n} (${id})` : id;
};
const people = (x, ids) => (ids.length ? ids.map(id => person(x, id)).join(', ') : '—');
const active = (x) => x.r.state.order.filter(id => x.r.state.participants[id].status === 'active');
const holders = (x, office) => {
  const o = x.r.state.m.offices?.[office];
  return !o || o.abolished ? [] : o.holders.filter(k => !k.until || k.until > now()).map(k => k.id);
};
// The state as the federation knows it: by entity id.
const known = (x) => (fed().r?.ok && x.r?.ok ? Object.values(fed().r.state.m.federation?.states || {}).find(s => s.entity === x.r.state.entity.id && !s.released) || null : null);
const myId = () => ctx.all.find(x => x.ident)?.ident.id || null;
const fedMod = () => fed().registry.modules.get('federation');

// How a state governs itself, from its own settings.
function government(x) {
  const p = x.r.params, who = p.value('decision.electorate'), ref = p.has('decision.referendum') ? p.value('decision.referendum') : [];
  if (who === 'members') return 'Direct democracy: every citizen votes on everything.';
  const body = who.startsWith('office:') ? (x.r.state.m.offices?.[who.slice(7)]?.title || 'office holders') : who;
  const house = /parliament/i.test(body) ? 'A parliament' : body;
  return ref.length ? `${house} makes ordinary law; every citizen votes, by referendum, on the ${ref.join(' and ')} rules.` : `${house} decides.`;
}

// What the state would tell the federation now, and whether it differs from what it last did.
function report(x) {
  const citizens = {};
  for (const id of active(x)) citizens[id] = [...x.r.state.participants[id].keys];
  return { citizens, senate: holders(x, 'federal-senator'), assembly: holders(x, 'federal-deputy') };
}
function outOfDate(x) {
  const s = known(x); if (!s) return false;
  const c = s.certified, r = report(x);
  if (!c) return true;
  const norm = (o) => JSON.stringify(Object.keys(o).sort().map(k => [k, [...o[k]].sort()]));
  return norm(c.citizens) !== norm(r.citizens) || [...c.senate].sort().join() !== [...r.senate].sort().join() || [...c.assembly].sort().join() !== [...r.assembly].sort().join();
}

// ── signing for the federation with a state key, or a new federal key ─────
function askPassword(title, text) {
  return new Promise((resolve) => {
    const input = h('input', { id: 'fd-pw', type: 'password', autocomplete: 'current-password', required: true });
    const form = h('form', { method: 'dialog' }, h('h2', {}, title), h('p', { class: 'fine' }, text), h('label', { for: 'fd-pw' }, 'Your password'), input,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Sign and send'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(null); } }, 'Cancel')));
    const d = h('dialog', { class: 'site-dialog' }, form); document.body.append(d); d.showModal();
    d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = input.value; d.close(); resolve(v); });
  });
}
async function send(base, act) {
  const res = await fetch(new URL('acts', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(act) });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.refused?.length || b.why) throw new Error(b.refused?.[0]?.why || b.why || `the node answered ${res.status}`);
}

async function certify(x) {
  const s = known(x), ident = x.ident;
  let seed = ident.seed;
  if (!seed) {
    const pw = await askPassword(`Report ${nameOf(x)} to the federation`, `Signed with your key as ${nameOf(x)}’s registrar: its ${active(x).length} citizens, its senators and its deputies, as its record shows them now.`);
    if (!pw) return;
    try { seed = await unlockSeed(ident.locked, pw); } catch { toast('Wrong password.', true); return; }
  }
  const key = { seed, publicKey: ident.publicKey };
  try {
    const act = await E.makeActWith(fed().registry, fed().r.state, 'state.certify',
      { by: s.id, key: E.keys.publicKeyLine(ident.publicKey), state: s.id, count: x.r.records.length, head: x.r.head, ...report(x) }, (m, ns) => E.keys.sign(m, key, ns));
    await send(fed().r.base, act);
    toast(`${nameOf(x)} reported to the federation.`);
  } catch (e) { toast(e.message, true); }
}

async function enroll(x) {
  const id = x.ident.id, s = known(x);
  const pw = await askPassword(`Become a citizen of ${nameOf(fed())}`, `As a citizen of ${nameOf(x)}, you take up federal citizenship. Your federal key is made from the same password, and your key in ${nameOf(x)} signs to prove it is you.`);
  if (!pw) return;
  try {
    const sk = await E.passwordKey(x.r.state.entity.id, id, pw);
    if (!x.r.state.participants[id].keys.includes(E.keys.keyId(E.keys.publicKeyLine(sk.publicKey)))) throw new Error(`that is not your password in ${nameOf(x)}`);
    const fk = await E.passwordKey(fed().r.state.entity.id, id, pw), line = E.keys.publicKeyLine(fk.publicKey);
    const F = fedMod();
    const state_sig = await E.keys.sign(F.enrollMaterial({ entity: fed().r.state.entity.id, id, key: E.keys.keyId(line) }), sk, F.NS);
    const act = await E.makeActWith(fed().registry, fed().r.state, 'citizen.enroll',
      { by: id, key: line, state: s.id, state_key: E.keys.publicKeyLine(sk.publicKey), state_sig }, (m, ns) => E.keys.sign(m, fk, ns));
    await send(fed().r.base, act);
    fed().ident = { id, publicKey: fk.publicKey, locked: await lockSeed(fk.seed, pw), via: 'password', created: now() };
    if (ctx.key === fed().key) ctx.ident = fed().ident;
    await K.saveIdentity(fed().r.state.entity.id, fed().ident).catch(() => {});
    toast(`Welcome: you are a citizen of ${nameOf(fed())}.`);
  } catch (e) { toast(e.message, true); }
}

// ── the federal parliament, seat by seat ───────────────────────────────────
// Seats in rows of a half circle, filled left to right in state order.
function arc(seats, { cx, cy, r0, r1, rows }) {
  const n = seats.length; if (!n) return [];
  const radii = Array.from({ length: rows }, (_, i) => (rows === 1 ? (r0 + r1) / 2 : r0 + ((r1 - r0) * i) / (rows - 1)));
  const sum = radii.reduce((a, b) => a + b, 0);
  const caps = radii.map(r => Math.max(1, Math.round((n * r) / sum)));
  let diff = n - caps.reduce((a, b) => a + b, 0);
  for (let i = caps.length - 1; diff !== 0; i = (i - 1 + caps.length) % caps.length) { if (diff > 0) { caps[i]++; diff--; } else if (caps[i] > 1) { caps[i]--; diff++; } }
  const spots = [];
  radii.forEach((r, i) => { for (let j = 0; j < caps[i]; j++) { const t = caps[i] === 1 ? Math.PI / 2 : Math.PI - (Math.PI * j) / (caps[i] - 1); spots.push({ x: cx + r * Math.cos(t), y: cy - r * Math.sin(t), t }); } });
  spots.sort((a, b) => b.t - a.t);
  return seats.map((s, i) => ({ ...s, ...spots[i] }));
}
function drawChamber() {
  const box = $('#chamber');
  if (!fed().r?.ok) { box.replaceChildren(h('p', { class: 'empty' }, 'The federation’s record could not be reached.')); return; }
  const S = fedMod(), st = fed().r.state, per = fed().r.params.value('federation.senators_per_state');
  const list = Object.values(st.m.federation?.states || {}).filter(s => !s.released);
  const seats = S.seatsOf(st, fed().r.params);
  const idx = (s) => Math.max(0, states().findIndex(x => x.r?.ok && x.r.state.entity.id === s.entity));
  const senate = [], assembly = [];
  for (const s of list) {
    const c = s.certified || { senate: [], assembly: [] };
    for (let i = 0; i < per; i++) senate.push({ c: color(idx(s)), id: c.senate[i] || null, state: s.name });
    for (let i = 0; i < (seats[s.id] || 0); i++) assembly.push({ c: color(idx(s)), id: c.assembly[i] || null, state: s.name });
  }
  // The senate is the inner half-ring, the assembly the outer rows; a small
  // parliament gets fewer, closer rows and larger seats.
  const W = 420, cx = W / 2, cy = 200;
  const aRows = Math.min(6, Math.max(1, Math.ceil(assembly.length / 12))), sRows = Math.min(3, Math.max(1, Math.ceil(senate.length / 10)));
  const dots = [...arc(senate, { cx, cy, r0: 58, r1: 58 + (sRows - 1) * 22, rows: sRows }), ...arc(assembly, { cx, cy, r0: 120, r1: 120 + (aRows - 1) * 22, rows: aRows })];
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 ${cy - 120 - (aRows - 1) * 22 - 16} ${W} ${120 + (aRows - 1) * 22 + 52}`); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `The federal parliament: a senate of ${senate.length} seats and an assembly of ${assembly.length}, coloured by state; hollow seats are not yet filled.`);
  const r = Math.max(4, Math.min(11, 900 / Math.max(1, assembly.length + senate.length * 2)));
  for (const d of dots) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', d.x.toFixed(1)); c.setAttribute('cy', d.y.toFixed(1)); c.setAttribute('r', r);
    c.setAttribute('style', d.id ? `fill:${d.c}` : `fill:none;stroke:${d.c};stroke-width:1.5`);
    const t = document.createElementNS(NS, 'title'); t.textContent = d.id ? `${d.id}, ${d.state}` : `Vacant seat, ${d.state}`; c.append(t);
    svg.append(c);
  }
  for (const [y, text] of [[cy + 30, `Senate ${senate.length} seats, assembly ${assembly.length}`]]) { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', cx); t.setAttribute('y', y); t.setAttribute('text-anchor', 'middle'); t.setAttribute('style', 'fill:var(--muted);font:12px var(--sans)'); t.textContent = text; svg.append(t); }
  box.replaceChildren(svg);
  $('#chamber-key').replaceChildren(...list.map(s => h('li', {}, h('i', { style: `background:${color(idx(s))}` }), `${s.name}: ${per} senators, ${seats[s.id] || 0} deputies`)));
  $('#chamber-caption').textContent = `Inner ring: the senate, ${per} seats for every state. Outer rings: the assembly, ${fed().r.params.value('federation.assembly_seats')} seats shared by population. Hollow seats are not filled yet.`;
}

// ── the states ─────────────────────────────────────────────────────────────
function drawStates() {
  const me = myId();
  const citizenOf = me ? states().find(x => x.r?.ok && x.r.state.participants[me]?.status === 'active') : null;
  const seats = fed().r?.ok ? fedMod().seatsOf(fed().r.state, fed().r.params) : {};
  $('#state-cards').replaceChildren(...states().map((x, i) => {
    if (!x.r?.ok) return h('article', { class: 'state', style: `--c:${color(i)}` }, h('h3', {}, x.label || x.key), h('p', { class: 'note' }, `Its record could not be reached${x.error ? `: ${x.error}` : ''}.`));
    const s = known(x), c = s?.certified, mine = me && x.r.state.participants[me];
    const enrolled = c ? Object.keys(c.citizens).filter(id => fed().r.state.participants[id]?.status === 'active').length : 0;
    const parl = holders(x, 'parliament'), open = x.r.get('proposals').length;
    const isRegistrar = s && x.ident && s.keys.includes(E.keys.keyId(E.keys.publicKeyLine(x.ident.publicKey)));
    const canEnroll = mine?.status === 'active' && c?.citizens?.[me] && fed().r.state.participants[me]?.status !== 'active';
    const actions = [h('a', { class: 'secondary', href: `hall.html?e=${encodeURIComponent(x.key)}` }, 'Its institutions')];
    if (open) actions.push(h('a', { class: 'secondary', href: `hall.html?e=${encodeURIComponent(x.key)}#/proposals` }, `${open} open vote${open === 1 ? '' : 's'}`));
    if (!citizenOf && !mine) actions.push(h('button', { class: 'primary', type: 'button', onclick: async () => { if (await withEntity(x.key, joinDialog)) draw(); } }, 'Apply for citizenship'));
    if (canEnroll) actions.push(h('button', { class: 'primary', type: 'button', onclick: () => enroll(x) }, `Become a citizen of ${nameOf(fed())}`));
    if (isRegistrar && outOfDate(x)) actions.push(h('button', { class: 'primary', type: 'button', onclick: () => certify(x) }, 'Report to the federation'));
    return h('article', { class: 'state', style: `--c:${color(i)}` },
      h('h3', {}, nameOf(x)),
      h('p', { class: 'form' }, government(x)),
      h('dl', {},
        h('dt', {}, 'Citizens'), h('dd', {}, `${active(x).length}${c ? `, ${enrolled} enrolled in the federation` : ''}`),
        parl.length ? [h('dt', {}, 'Parliament'), h('dd', {}, people(x, parl))] : null,
        h('dt', {}, 'Senators'), h('dd', {}, people(x, holders(x, 'federal-senator'))),
        h('dt', {}, 'Deputies'), h('dd', {}, `${people(x, holders(x, 'federal-deputy'))}${s ? ` (${seats[s.id] || 0} seat${seats[s.id] === 1 ? '' : 's'})` : ''}`)),
      !s ? h('p', { class: 'note' }, 'Not (or no longer) a state of the federation.')
        : outOfDate(x) ? h('p', { class: 'note' }, `Its citizens or appointments have changed since it last reported to the federation${isRegistrar ? '.' : '; its registrar reports them.'}`)
          : h('p', { class: 'note' }, `The federation’s register matches its record.`),
      mine ? h('p', { class: 'note' }, mine.status === 'active' ? `You are a citizen of ${nameOf(x)}.` : `Your application to ${nameOf(x)} is waiting for its decision.`) : null,
      h('div', { class: 'actions' }, actions));
  }));
  // The hero: who you are here.
  const fedMe = me && fed().r?.ok ? fed().r.state.participants[me] : null;
  $('#who-note').textContent = !me ? 'Become a citizen of one state, and through it of the federation. Nobody is a citizen of two states.'
    : citizenOf ? `Signed in as ${person(citizenOf, me)}: a citizen of ${nameOf(citizenOf)}${fedMe?.status === 'active' ? ` and of ${nameOf(fed())}` : ', not yet enrolled in the federation'}.` : `Signed in as ${me}.`;
  $('#hero-actions').replaceChildren(...(me ? [h('a', { class: 'primary', href: '#votes' }, 'Open votes'), h('a', { class: 'secondary', href: '#states' }, 'The states')]
    : [h('a', { class: 'primary', href: '#states' }, 'Become a citizen'), h('button', { class: 'secondary', type: 'button', onclick: async () => { if (await signInDialog()) draw(); } }, 'Sign in')]));
}

// ── open votes everywhere ──────────────────────────────────────────────────
function drawVotes() {
  const groups = ctx.all.filter(x => x.r?.ok).map((x, i) => {
    const box = h('div', { class: 'bills' });
    drawOpen(box, { key: x.key, empty: 'Nothing open.' });
    return h('div', {}, h('h3', {}, h('i', { style: i ? `background:${color(i - 1)}` : 'background:var(--ink)' }), i ? nameOf(x) : `${nameOf(x)}: the federal parliament`), box);
  });
  $('#votes-by').replaceChildren(...groups);
}

function drawMoney() {
  if (!fed().r?.ok) return;
  const st = fed().r.state, p = fed().r.params, v = st.m.value || { balances: {}, supply: 0 };
  const d = p.has('value.decimals') ? p.value('value.decimals') : 0, unit = p.value('value.name');
  const fmt = (n) => `${(n / 10 ** d).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })} ${unit}`;
  const holdersN = Object.values(v.balances).filter(x => x > 0).length, me = myId(), mine = me && st.participants[me] ? v.balances[me] || 0 : null;
  $('#money').replaceChildren(h('div', { class: 'money' },
    h('div', {}, h('b', {}, fmt(v.supply || 0)), h('span', {}, 'in circulation')),
    h('div', {}, h('b', {}, String(holdersN)), h('span', {}, `holder${holdersN === 1 ? '' : 's'}`)),
    mine !== null ? h('div', {}, h('b', {}, fmt(mine)), h('span', {}, 'yours')) : null),
    h('p', { class: 'more' }, h('a', { href: 'hall.html#/value' }, mine !== null ? 'Send some, or see every holder' : 'Every holder')));
}

function drawParties() {
  if (!fed().r?.ok) return;
  const st = fed().r.state, list = Object.values(st.m.parties?.parties || {}).filter(p => !p.dissolved);
  const count = (p) => p.members.filter(m => !m.until && st.participants[m.id]?.status === 'active').length;
  $('#party-list').replaceChildren(...(list.length ? list.sort((a, b) => count(b) - count(a)).map(p => h('li', {}, h('a', { href: 'hall.html#/parties' }, p.title), h('p', { class: 'fine' }, `${count(p)} member${count(p) === 1 ? '' : 's'} · led by ${person(fed(), p.leader)}`)))
    : [h('li', {}, h('p', { class: 'fine' }, 'No parties yet. Any federal citizen can found one, under Institutions › Parties.'))]));
}

function draw() { drawChamber(); drawStates(); drawVotes(); drawMoney(); drawParties(); }
onChange(draw);
onSigned(draw);
await start();
draw();
