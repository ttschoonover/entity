// The mahjong tab: your profile, the members' standings, and recent tables.
const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);
const pct = (w, g) => (g ? `${Math.round((w / g) * 100)}%` : '–');

export default function render(api) {
  const { h, state, me, who, when } = api;
  const mj = state.m.mahjong || { games: {}, matches: {}, profiles: {} };
  const sec = h('section', {}, h('h2', {}, 'Mahjong'),
    h('p', { class: 'hint' }, 'Every game here was replayed by the record before it counted: solo games against the AI, and tables played in this world. ', h('a', { href: 'play.html' }, 'Play solo'), ' · ', h('a', { href: 'tables.html' }, 'Tables')));
  if (me && mj.profiles[me.id]) {
    const p = mj.profiles[me.id], open = Object.values(mj.games).filter(g => g.by === me.id && g.status === 'playing').length;
    sec.append(h('h3', {}, 'Your profile'), h('dl', { class: 'mj-stats' },
      h('dt', {}, 'Games'), h('dd', {}, String(p.games)), h('dt', {}, 'First place'), h('dd', {}, `${p.wins} (${pct(p.wins, p.games)})`),
      h('dt', {}, 'Points'), h('dd', {}, String(p.points)), h('dt', {}, 'Unfinished'), h('dd', {}, String(open)),
      h('dt', {}, 'Best hand'), h('dd', {}, p.best ? `${p.best.faan} faan: ${p.best.items.join(', ') || 'chicken hand'}` : '–')),
      h('p', { class: 'fine' }, 'By the strongest AI faced: ', Object.entries(p.byLevel).map(([l, b]) => `${l === 'humans' ? 'people only' : `level ${l}`} ${b.wins}/${b.games}`).join(' · ')));
  }
  const rows = Object.entries(mj.profiles).sort((a, b) => b[1].wins - a[1].wins || b[1].points - a[1].points);
  sec.append(h('h3', {}, 'Standings'), rows.length ? h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Player', 'Games', 'First place', 'Points', 'Best'].map(x => h('th', {}, x)))),
    h('tbody', {}, rows.map(([id, p]) => h('tr', {}, h('td', {}, who(id)), h('td', {}, String(p.games)), h('td', {}, pct(p.wins, p.games)), h('td', {}, String(p.points)), h('td', {}, p.best ? `${p.best.faan} faan` : '–')))))) : h('p', { class: 'empty' }, 'No games recorded yet.'));
  const tables = Object.values(mj.matches).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20);
  if (tables.length) sec.append(h('h3', {}, 'Recent tables'), h('ul', { class: 'items' }, tables.map(t => h('li', {},
    h('p', {}, t.names.map((n, i) => `${t.players[i]?.id ? nm(api, t.players[i].id) : n || (t.seats[i] === 'human' ? 'guest' : `AI ${t.seats[i]}`)} ${t.scores[i]}`).join(' · ')),
    h('p', { class: 'meta' }, `${t.table} · ${t.hands} hands · ${when(t.at)}`)))));
  return sec;
}
