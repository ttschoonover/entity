// home.js · the Nomic board: whose move, the score track, the changes being
// voted on, the rules in force as a deck, and the latest judgments.
import { start, onChange, onSigned, ctx, h, $, me, displayName, nameOf, joinDialog, signInDialog, sign, when, setting, W } from './common.js';
import { drawOpen } from './floor.js';

let N = null; // the nomic module's own functions, from the node
const TOKENS = ['tok-red', 'tok-yel', 'tok-blu', 'tok-grn', 'tok-ink', 'tok-pnk'];

function drawTurn() {
  const t = N.turnOf(ctx.r.state), ends = N.turnEnds(ctx.r.state, ctx.r.params), p = me();
  const now = new Date().toISOString();
  $('#turn-who').textContent = t ? (p && t.player === p.id ? 'Your move' : nameOf(t.player)) : 'Nobody seated yet';
  $('#turn-when').textContent = t ? (ends ? `Turn ends ${when(ends)}` : 'Their turn has just begun.') : '';
  const box = $('#turn-act');
  box.replaceChildren();
  if (t && p && (t.player === p.id || (ends && now >= ends)))
    box.append(h('button', { class: 'primary', type: 'button', onclick: () => sign('nomic.pass', {}, t.player === p.id ? 'Ending your turn' : 'Passing play on') }, t.player === p.id ? 'End my turn' : 'Their time is up: pass play on'),
      t.player === p.id ? h('p', { class: 'fine' }, h('a', { href: 'game.html#open=Propose' }, 'Propose a change'), ' first, if you have one.') : null);
  const g = ctx.r.state.m.nomic;
  if (g?.winner) box.prepend(h('p', { class: 'winner' }, `${nameOf(g.winner.id)} won game ${g.winner.game}!`));
}

function drawTrack() {
  const goal = setting('nomic.win_points', 100), steps = 20, per = goal / steps;
  const ps = N.players(ctx.r.state);
  const at = (id) => Math.min(steps, Math.floor(N.score(ctx.r.state, id) / per));
  $('#track-meta').textContent = `First to ${goal} points wins game ${ctx.r.state.m.nomic?.game || 1}. Each square is ${Math.round(per)} points.`;
  $('#track').replaceChildren(...Array.from({ length: steps + 1 }, (_, i) => h('li', { class: i === steps ? 'sq goal' : i === 0 ? 'sq start' : 'sq' },
    h('span', { class: 'sq-n' }, i === steps ? 'WIN' : String(Math.round(i * per))),
    h('span', { class: 'sq-tokens' }, ...ps.filter(id => at(id) === i).map(id => h('span', { class: `token ${TOKENS[ps.indexOf(id) % TOKENS.length]}`, title: `${nameOf(id)}: ${N.score(ctx.r.state, id)}` }))))));
  $('#track-key').replaceChildren(...ps.map((id, i) => h('li', {}, h('span', { class: `token ${TOKENS[i % TOKENS.length]}` }), ` ${displayName(id)} · ${N.score(ctx.r.state, id)}`)));
}

function drawDeck() {
  const rules = N.rules(ctx.r.state);
  $('#deck').replaceChildren(...(rules.length ? rules.slice(0, 9).map(r => h('li', { class: `rule-card ${r.mutable ? 'mutable' : 'immutable'}` },
    h('p', { class: 'rule-n' }, String(r.number)), h('h3', {}, r.title), h('p', { class: 'rule-text' }, r.text.length > 220 ? `${r.text.slice(0, 220)}…` : r.text)))
    : [h('li', { class: 'empty' }, 'No rules yet.')]));
}

function drawCfjs() {
  const all = Object.values(ctx.r.state.m.nomic?.cfjs || {}).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
  $('#cfjs').replaceChildren(...(all.length ? all.map(c => h('li', {}, h('p', {}, c.question),
    h('p', { class: 'meta' }, `asked by ${displayName(c.by)} · `, c.judgment ? h('strong', { class: `verdict v-${c.judgment.verdict}` }, c.judgment.verdict.toUpperCase()) : 'awaiting the judge')))
    : [h('li', { class: 'empty' }, 'No calls for judgment yet.')]));
}

function drawJoin() {
  const btn = $('#join'), note = $('#join-note'), p = me();
  if (!p) {
    btn.hidden = false; btn.onclick = () => joinDialog();
    note.replaceChildren('Already playing? ', h('button', { class: 'linklike', type: 'button', onclick: () => signInDialog() }, 'Sign in'), '.');
  } else if (p.status === 'applicant') { btn.hidden = true; note.textContent = `You've asked for a seat. The ${W().many} vote to let you in.`; }
  else { btn.hidden = true; note.textContent = `Playing as ${displayName(p.id)}, with ${N.score(ctx.r.state, p.id)} points.`; }
}

function draw() {
  if (!ctx.r.ok) { $('#turn-who').textContent = 'The record did not verify.'; return; }
  if (!N) { $('#turn-who').textContent = 'The game is not switched on.'; return; }
  drawTurn(); drawTrack(); drawOpen($('#bills'), { empty: 'Nothing on the table. On your turn, propose a change.' }); drawDeck(); drawCfjs(); drawJoin();
}

await start();
if (ctx.r.ok) { try { N = await import(`${ctx.r.base}modules/nomic/index.js`); } catch { /* not installed */ } }
draw();
onChange(() => { if (!document.querySelector('dialog[open]')) draw(); });
onSigned(draw);
if (location.hash === '#join' && !me()) joinDialog();
