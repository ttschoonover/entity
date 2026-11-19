// home.js · the Paddock's front page: the tote board of market prices, how
// many bets of each kind are running, the arbiter's desk, the leaderboard,
// and the club's open votes.
import { start, onChange, onSigned, ctx, h, $, me, displayName, nameOf, joinDialog, signInDialog, W } from './common.js';
import { drawOpen } from './floor.js';

let B = null;
const live = (w) => ['open', 'offered', 'resolved', 'appealed'].includes(w.status);

// A price as split-flap tiles: "62" → [6][2].
const flaps = (s) => h('span', { class: 'flaps', 'aria-label': s }, ...String(s).split('').map(c => h('span', { class: 'flap', 'aria-hidden': 'true' }, c)));

function drawTote() {
  const all = Object.values(ctx.r.state.m.wagers?.items || {});
  const markets = all.filter(w => w.type === 'market' && w.status === 'open').sort((a, b) => B.pot(ctx.r.state, b) - B.pot(ctx.r.state, a)).slice(0, 4);
  const rows = [];
  for (const m of markets) {
    const p = B.prices(m);
    rows.push(h('tr', { class: 'tote-q' }, h('th', { colspan: 2, scope: 'colgroup' }, h('a', { href: 'bets.html' }, m.question))));
    for (const o of m.outcomes) rows.push(h('tr', {}, h('td', { class: 'tote-o' }, o), h('td', { class: 'tote-p' }, flaps(String(Math.round(p[o] * 100)).padStart(2, '0')), h('span', { class: 'pct' }, '%'))));
  }
  $('#tote').replaceChildren(...(rows.length ? rows : [h('tr', {}, h('td', { class: 'tote-o' }, 'No markets open. Open one and the odds appear here.'))]));
  const total = all.filter(live).reduce((a, w) => a + B.pot(ctx.r.state, w), 0);
  $('#tote-foot').replaceChildren(flaps(String(total)), ' points in play across ', String(all.filter(live).length), ' bets');
  for (const el of document.querySelectorAll('.ticket-n')) {
    const n = all.filter(w => w.type === el.dataset.kind && live(w)).length;
    el.textContent = `${n} running`;
  }
}

function drawArbiter() {
  const now = new Date().toISOString(), arbs = B.arbiters(ctx.r.state, ctx.r.params, now);
  const all = Object.values(ctx.r.state.m.wagers?.items || {});
  const waiting = all.filter(w => w.status === 'open' && (w.type === 'duel' ? !!w.taker : now >= w.closes));
  const appealed = all.filter(w => w.status === 'appealed');
  $('#arbiter').replaceChildren(
    h('p', { class: 'arb-name' }, arbs.length ? arbs.map(nameOf).join(', ') : 'No arbiter in office'),
    h('p', { class: 'fine' }, arbs.length ? 'Holds the office of arbiter.' : 'Until the members elect one, bets are settled by vote.'),
    h('ul', { class: 'arb-stats' },
      h('li', {}, h('strong', {}, String(waiting.length)), ' waiting for a result'),
      h('li', {}, h('strong', {}, String(all.filter(w => w.status === 'resolved').length)), ' in the appeal window'),
      h('li', {}, h('strong', {}, String(appealed.length)), ' appealed to a vote')),
    h('p', { class: 'more' }, h('a', { href: 'hall.html#/elections' }, 'Elections'), ' · ', h('a', { href: 'hall.html#/offices' }, 'The office')));
}

function drawLeaders() {
  const bal = ctx.r.state.m.value?.balances || {};
  const rows = Object.entries(bal).filter(([id]) => ctx.r.state.participants[id]?.status === 'active').sort((a, b) => b[1] - a[1]).slice(0, 10);
  $('#leaders').replaceChildren(...(rows.length ? rows.map(([id, n]) => h('li', {}, h('span', { class: 'ld-name' }, displayName(id)), h('span', { class: 'ld-pts' }, flaps(String(n)))))
    : [h('li', { class: 'empty' }, 'Nobody holds points yet. Points are issued by a vote of the members.')]));
}

function drawJoin() {
  const btn = $('#join'), note = $('#join-note'), p = me();
  if (!p) {
    btn.hidden = false; btn.onclick = () => joinDialog();
    note.replaceChildren('A member already? ', h('button', { class: 'linklike', type: 'button', onclick: () => signInDialog() }, 'Sign in'), '.');
  } else if (p.status === 'applicant') { btn.hidden = true; note.textContent = `Your application is in; the ${W().many} vote on it.`; }
  else { btn.hidden = true; note.textContent = `Signed in as ${displayName(p.id)}, holding ${B.balance(ctx.r.state, p.id)} points.`; }
}

function draw() {
  if (!ctx.r.ok) { $('#tote').replaceChildren(h('tr', {}, h('td', {}, 'The record did not verify.'))); return; }
  if (!B) { $('#tote').replaceChildren(h('tr', {}, h('td', {}, 'Betting is not switched on.'))); return; }
  drawTote(); drawArbiter(); drawLeaders(); drawOpen($('#bills'), { empty: 'No club votes open.' }); drawJoin();
}

await start();
if (ctx.r.ok) { try { B = await import(`${ctx.r.base}modules/wagers/index.js`); } catch { /* not installed */ } }
draw();
onChange(() => { if (!document.querySelector('dialog[open]')) draw(); });
onSigned(draw);
if (location.hash === '#join' && !me()) joinDialog();
