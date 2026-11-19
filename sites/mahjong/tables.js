// tables.js · the world's tables: open one, join one, watch one. No account
// needed: a seat is yours by a key this browser makes, unless you sign in.
import { start, ctx, h, $ } from './common.js';

const api = (p, opts) => fetch(new URL(`mahjong/${p}`, ctx.r.base), opts).then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
const STATUS = { waiting: 'Waiting for players', playing: 'Playing', between: 'Between hands', over: 'Finished' };

async function drawList() {
  const { ok, body } = await api('tables');
  const box = $('#list');
  if (!ok) { box.replaceChildren(h('p', { class: 'empty' }, body.why || 'Tables are not open here.')); return; }
  const live = body.tables.filter(t => t.status !== 'over'), done = body.tables.filter(t => t.status === 'over');
  const row = (t) => h('li', { class: `mj-tablecard st-${t.status}` },
    h('h3', {}, h('a', { href: `table.html?t=${t.id}` }, t.title)),
    h('p', { class: 'meta' }, `${STATUS[t.status]}${t.status !== 'waiting' ? ` · hand ${t.hand + (t.status === 'playing' ? 1 : 0)}` : ''}`),
    h('ul', { class: 'mj-seats' }, t.seats.map((s, i) => h('li', {}, h('span', { class: 'mj-wind' }, '東南西北'[i]), ' ',
      s.type === 'ai' ? `AI ${s.level}` : s.taken ? s.name : h('em', {}, 'open seat'), t.status !== 'waiting' ? h('span', { class: 'fine' }, ` ${t.scores[i]}`) : null))),
    h('p', {}, h('a', { class: t.status === 'waiting' && t.seats.some(s => s.type === 'human' && !s.taken) ? 'primary' : 'secondary', href: `table.html?t=${t.id}` },
      t.status === 'waiting' && t.seats.some(s => s.type === 'human' && !s.taken) ? 'Take a seat' : t.status === 'over' ? 'See the result' : 'Watch')));
  box.replaceChildren(live.length ? h('ul', { class: 'mj-tablelist' }, live.map(row)) : h('p', { class: 'empty' }, 'No tables open. Open one, then send its link to your friends.'),
    done.length ? h('details', {}, h('summary', {}, `Finished tables (${done.length})`), h('ul', { class: 'mj-tablelist' }, done.slice(0, 30).map(row))) : null);
}

$('#mk').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const seats = [0, 1, 2, 3].map(i => { const v = $(`#mk-s${i}`).value; return v === 'open' ? 'open' : Number(v); });
  const rules = { minFaan: Number($('#mk-min').value), flowers: $('#mk-flowers').checked, rounds: Number($('#mk-rounds').value) };
  const { ok, body } = await api('tables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: $('#mk-title').value.trim() || 'A table', seats, rules, level: Number($('#mk-level').value) }) });
  if (!ok) { $('#mk-note').textContent = body.why || 'The table could not be opened.'; return; }
  location.href = `table.html?t=${body.table.id}`;
});

await start();
await drawList();
setInterval(() => { if (!document.hidden && !document.activeElement?.closest('form')) drawList(); }, 8000);
