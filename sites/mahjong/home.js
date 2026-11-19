// home.js · the mahjong world's front page: a fan of tiles, the tables open
// now, and the standings, all from this world's node and record.
import { start, ctx, h, $, displayName } from './common.js';
import { tileEl } from './mj-ui.js';

$('#fan').replaceChildren(...['zE', 'zS', 'zW', 'zN', 'zC', 'zF', 'zP'].map((t, i) => { const el = tileEl(t); el.style.setProperty('--i', i - 3); return el; }));

async function draw() {
  try {
    const r = await fetch(new URL('mahjong/tables', ctx.r.base)).then(x => x.json());
    const live = (r.tables || []).filter(t => t.status !== 'over');
    $('#live-meta').textContent = live.length ? `${live.length} table${live.length === 1 ? '' : 's'} open now.` : 'No tables open right now.';
    $('#live').replaceChildren(live.length ? h('ul', { class: 'mj-mini' }, live.slice(0, 6).map(t => h('li', {}, h('a', { href: `table.html?t=${t.id}` }, t.title), h('span', { class: 'fine' }, ` · ${t.seats.map(s => (s.type === 'ai' ? `AI ${s.level}` : s.taken ? s.name : 'open')).join(', ')}`))))
      : h('p', {}, h('a', { class: 'primary', href: 'tables.html' }, 'Open the first one')));
  } catch { $('#live').replaceChildren(h('p', { class: 'empty' }, 'Tables are not available from here.')); }
  const pr = Object.entries(ctx.r?.state?.m?.mahjong?.profiles || {}).sort((a, b) => b[1].wins - a[1].wins || b[1].points - a[1].points).slice(0, 8);
  $('#standings').replaceChildren(...(pr.length ? pr.map(([id, p]) => h('li', {}, h('span', { class: 'st-name' }, displayName(id)), h('span', { class: 'fine' }, ` ${p.wins} first place${p.wins === 1 ? '' : 's'} in ${p.games} · ${p.points} points`)))
    : [h('li', { class: 'empty' }, 'No recorded games yet.')]));
}
await start();
draw();
setInterval(() => { if (!document.hidden) draw(); }, 15000);
