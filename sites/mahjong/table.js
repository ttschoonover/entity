// table.js · a live table. The node deals and keeps time; this page shows your
// view, signs your moves with your seat's key, and, at the end of every hand,
// checks the node's honesty for itself: the revealed seed must match the
// commitment published before the deal, and replaying the hand must give the
// same scores.
import { start, ctx, h, $, me } from './common.js';
import { drawTable, drawResult } from './mj-ui.js';
import { H, replay } from './mj-engine.js';
import { identity, keyLine, signWith, savedName, saveName, tokenFor, saveToken, canonical } from './guest.js';

const id = new URLSearchParams(location.search).get('t');
const api = (p, opts) => fetch(new URL(`mahjong/${p}`, ctx.r.base), opts).then(async r => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }));
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let data = null, tok = tokenFor(id), busy = false, verified = {}, tick = null;

function countdown() {
  if (!data?.deadline) return null;
  const s = Math.max(0, Math.round((data.deadline - Date.now()) / 1000));
  return `${s}s`;
}
async function verify() {
  const t = data.table, key = `${t.seeds.length}`;
  if (verified[key] !== undefined || !t.seeds.length) return verified[key];
  const bad = t.seeds.findIndex((s, i) => H(s) !== t.commits[i]);
  if (bad >= 0) return (verified[key] = `Hand ${bad + 1}: the revealed seed does NOT match its commitment. This table was not dealt fairly.`);
  const { body: sheet } = await api(`sheet?table=${id}`);
  if (!sheet.moves) return (verified[key] = `All ${t.seeds.length} revealed seeds match their commitments.`);
  const r = replay({ rules: sheet.rules, seats: sheet.seats, names: sheet.names, seeds: sheet.seeds, moves: sheet.moves });
  if (r.error) return (verified[key] = `Replay failed: ${r.error}`);
  const same = JSON.stringify(r.match.scores) === JSON.stringify(t.scores);
  return (verified[key] = same ? `Checked in this browser: every wall matches the commitment made before it was dealt, and replaying every move gives the same scores.` : 'The replay gives different scores from the table’s. Something is wrong.');
}

async function act(action) {
  if (busy || !tok) return;
  busy = true;
  try {
    const who = await identity({ guest: tok.guest });
    const n = data.n;
    const message = ['mahjong.move', ctx.r.state.entity.id, id, tok.seat, n, canonical(action)].join('\n');
    const sig = await signWith(who.key, message);
    const r = await post('move', { table: id, token: tok.token, n, action, sig });
    if (!r.ok) $('#mj-note').textContent = r.body.why || 'That move was not accepted.';
    else $('#mj-note').textContent = '';
  } finally { busy = false; }
  refresh();
}

async function sit(seat) {
  const name = $('#mj-name').value.trim();
  if (!name) { $('#mj-name').focus(); $('#mj-note').textContent = 'Give a name for the table first.'; return; }
  saveName(name);
  const asGuest = !$('#mj-as-member')?.checked;
  const who = await identity({ guest: asGuest });
  const key = keyLine(who.key);
  const sig = await signWith(who.key, ['mahjong.sit', ctx.r.state.entity.id, id, seat, name, key].join('\n'));
  const r = await post('sit', { table: id, seat, name, key, id: who.id || undefined, sig });
  if (!r.ok) { $('#mj-note').textContent = r.body.why; return; }
  tok = { token: r.body.token, seat, guest: !who.id }; saveToken(id, tok);
  refresh();
}

function drawWaiting() {
  const t = data.table, mine = tok && tok.seat >= 0;
  const p = me();
  $('#mj-room').replaceChildren(h('div', { class: 'mj-waiting' },
    h('h2', {}, t.title),
    h('p', { class: 'lede' }, mine ? 'You have a seat. Share the link; start when everyone is here. Empty seats become AIs.' : 'Pick a seat. No account needed.'),
    !mine ? h('div', { class: 'mj-form' }, h('label', { for: 'mj-name' }, 'Your name at the table'), h('input', { id: 'mj-name', maxlength: 24, value: savedName() }),
      p && ctx.ident?.seed ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'mj-as-member', checked: true }), ` Sit as ${p.id}, so the result goes on your profile`) : null) : null,
    h('ul', { class: 'mj-seats big' }, t.seats.map((s, i) => h('li', {}, h('span', { class: 'mj-wind' }, '東南西北'[i]),
      s.type === 'ai' ? ` AI ${s.level}` : s.taken ? ` ${s.name}${tok?.seat === i ? ' (you)' : ''}${s.member ? ` · ${s.member}` : ''}` : [' ', h('em', {}, 'open'), !mine ? [' ', h('button', { class: 'primary', type: 'button', onclick: () => sit(i) }, 'Sit here')] : null]))),
    h('p', { class: 'mj-share' }, 'Invite: ', h('input', { readonly: true, value: location.href, 'aria-label': 'Link to this table', onclick: (e) => e.target.select() })),
    mine ? h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async () => { const r = await post('start', { table: id, token: tok.token }); if (!r.ok) $('#mj-note').textContent = r.body.why; refresh(); } }, 'Start the game')) : null));
  $('#result').hidden = true;
}

async function draw() {
  if (!data) return;
  const t = data.table;
  $('#mj-title').textContent = t.title;
  if (t.status === 'waiting') return drawWaiting();
  const v = data.view;
  drawTable($('#mj-room'), v, { onAct: act, timer: v.pending.includes(v.me) ? countdown() : null });
  if (t.status === 'between' || t.status === 'over') {
    const check = await verify();
    const ready = data.readyFor || [];
    const people = t.seats.filter(s => s.type === 'human').length;
    drawResult($('#result'), v, {
      verified: check,
      final: t.status === 'over' ? `Final: ${t.seats.map((s, i) => `${s.name} ${t.scores[i]}`).join(' · ')}. ${t.recorded?.at ? 'Recorded on this world’s record.' : t.recorded?.skipped ? 'Kept by this node (not recorded: no keeper key here).' : t.recorded?.refused ? `The record refused it: ${t.recorded.refused}` : 'Recording…'}` : null,
      next: t.status === 'between' && tok && !ready.includes(tok.seat) ? () => post('ready', { table: id, token: tok.token }).then(refresh) : null,
      nextLabel: `Ready (${ready.length} of ${people})${data.deadline ? ` · next hand in ${countdown()}` : ''}`,
    });
  } else $('#result').hidden = true;
}

// Responses can arrive out of order (an update event and a refresh after sitting
// race each other): keep only the newest, and drop a seat only on an answer to
// a request that carried this very token.
let asked = 0, shown = 0;
async function refresh() {
  const n = ++asked, sent = tok?.token || null;
  const r = await api(`view?table=${encodeURIComponent(id)}${sent ? `&token=${sent}` : ''}`);
  if (n < shown) return;
  shown = n;
  if (!r.ok) { $('#mj-room').replaceChildren(h('p', { class: 'empty' }, r.body.why || 'This table could not be found.')); return; }
  if (tok && sent !== tok.token) return refresh(); // asked before this browser had its seat
  data = r.body;
  if (tok && sent === tok.token && data.seat < 0) { tok = null; saveToken(id, null); }
  draw();
}

await start();
if (!id) $('#mj-room').replaceChildren(h('p', { class: 'empty' }, 'No table named. ', h('a', { href: 'tables.html' }, 'Choose one'), '.'));
else {
  await refresh();
  const es = new EventSource(new URL(`mahjong/events?table=${encodeURIComponent(id)}`, ctx.r.base));
  es.addEventListener('update', () => refresh());
  tick = setInterval(() => { const el = document.querySelector('.mj-timer'); if (el && data?.deadline) el.textContent = countdown(); }, 1000);
}
void tick;
