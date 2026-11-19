// mj-ui.js · draws a mahjong table from a seat's view, for the solo game, the
// live tables and the offline file alike. It knows nothing about where the
// game runs: it is given a view and calls back with the action chosen.
//
//   drawTable(root, view, { onAct, timer, title, note })
//   drawResult(box, view, { next, verified })
//   tileEl(code, { small, back, label, onClick, selected, dim, last })
import { face, name as tileName } from './mj-engine.js';

const WIND = ['東', '南', '西', '北'];
const WIND_EN = ['East', 'South', 'West', 'North'];
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

const LATIN_SUIT = { m: 'char', p: 'dot', s: 'bam' };
const LATIN_HONOR = { zE: ['E', 'wind'], zS: ['S', 'wind'], zW: ['W', 'wind'], zN: ['N', 'wind'], zC: ['R', 'dragon'], zF: ['G', 'dragon'], zP: ['W', 'dragon'] };
export function latin(t) {
  if (LATIN_SUIT[t[0]]) return [t[1], LATIN_SUIT[t[0]]];
  if (LATIN_HONOR[t]) return LATIN_HONOR[t];
  return [t[1], t[0] === 'f' ? 'flower' : 'season'];
}

export function tileEl(t, o = {}) {
  if (o.back || t === 'back') return el('span', { class: `tile back${o.small ? ' small' : ''}`, 'aria-hidden': 'true' });
  const f = face(t);
  // Two faces on every tile: the traditional characters, and a Latin one (a
  // number or letter over a short suit name). Each look shows whichever suits it.
  const [lat, sub] = latin(t);
  const kids = [el('span', { class: 't-top' }, f.top), f.bottom ? el('span', { class: 't-bot' }, f.bottom) : null,
    el('span', { class: 't-lat', 'aria-hidden': 'true' }, lat), el('span', { class: 't-sub', 'aria-hidden': 'true' }, sub)];
  const cls = `tile s-${f.suit}${o.small ? ' small' : ''}${o.selected ? ' selected' : ''}${o.dim ? ' dim' : ''}${o.last ? ' last' : ''}${o.drawn ? ' drawn' : ''}`;
  if (o.onClick) return el('button', { class: cls, type: 'button', 'aria-label': o.label || tileName(t), 'aria-pressed': o.selected ? 'true' : null, onclick: o.onClick, ondblclick: o.onDouble }, kids);
  return el('span', { class: cls, role: 'img', 'aria-label': o.label || tileName(t) }, kids);
}

const label = (a) => ({ win: 'Mahjong!', pung: 'Pung', kong: a.tile ? `Kong ${tileName(a.tile)}` : 'Kong', pass: 'Pass', chow: `Chow ${a.tiles ? a.tiles.map(x => x[1]).join('·') : ''}` }[a.type] || a.type);

let selected = null;
export function drawTable(root, v, { onAct, timer, note } = {}) {
  const me = v.me >= 0 && v.me < 4 ? v.me : 0, h = v.hand;
  if (!h) { root.replaceChildren(el('p', { class: 'mj-empty' }, note || 'Waiting for the deal…')); return; }
  const seatAt = (k) => (me + k) % 4; // 0 me (bottom), 1 right, 2 top, 3 left
  const wind = (s) => (s - v.dealer + 4) % 4;
  const opts = v.options || [];
  const myTurn = h.stage === 'discard' && v.pending.includes(v.me);
  const canDiscard = new Set(opts.filter(o => o.type === 'discard').map(o => o.tile));
  if (!myTurn || !canDiscard.has(selected)) selected = null;
  const doDiscard = (t) => onAct && onAct({ type: 'discard', tile: t });

  const seatBox = (k) => {
    const s = seatAt(k), p = h.players[s], turn = h.turn === s && h.stage === 'discard' && !h.result;
    const waiting = v.pending.includes(s);
    const head = el('div', { class: 'mj-name' },
      el('span', { class: 'mj-wind', title: `${WIND_EN[wind(s)]} seat`, 'data-w': WIND_EN[wind(s)][0] }, WIND[wind(s)]),
      el('span', { class: 'mj-who' }, v.names[s] || `Seat ${s + 1}`, typeof v.seats[s] === 'number' ? el('span', { class: 'mj-lvl' }, ` AI ${v.seats[s]}`) : null),
      s === v.dealer ? el('span', { class: 'mj-dealer', title: 'Dealer' }, '莊') : null,
      el('span', { class: 'mj-score' }, String(v.scores[s])),
      waiting && !turn ? el('span', { class: 'mj-thinking' }, 'deciding') : null);
    const melds = el('div', { class: 'mj-melds' }, p.melds.map(m => el('span', { class: 'mj-meld' }, m.tiles.map(t => tileEl(t, { small: k !== 0 })))),
      p.bonus.length ? el('span', { class: 'mj-meld bonus' }, p.bonus.map(t => tileEl(t, { small: true }))) : null);
    let hand;
    if (k === 0 && p.concealed) {
      const drawn = h.drawn && myTurn ? h.drawn : null;
      let skipped = false;
      const tiles = p.concealed.filter(t => { if (drawn && !skipped && t === drawn) { skipped = true; return false; } return true; });
      const mk = (t, isDrawn) => tileEl(t, { drawn: isDrawn, selected: selected === t,
        label: myTurn ? `Discard ${tileName(t)}` : tileName(t),
        onClick: myTurn && canDiscard.has(t) ? () => { if (selected === t) doDiscard(t); else { selected = t; drawTable(root, v, { onAct, timer, note }); } } : null,
        onDouble: myTurn && canDiscard.has(t) ? () => doDiscard(t) : null });
      hand = el('div', { class: 'mj-hand' }, tiles.map(t => mk(t, false)), drawn ? el('span', { class: 'mj-gap' }) : null, drawn ? mk(drawn, true) : null);
    } else if (p.concealed) hand = el('div', { class: 'mj-hand open' }, p.concealed.map(t => tileEl(t, { small: true })));
    else hand = el('div', { class: 'mj-hand hidden' }, Array.from({ length: p.size }, () => tileEl('back', { small: true })));
    return el('section', { class: `mj-seat pos-${k}${turn ? ' turn' : ''}`, 'aria-label': `${v.names[s]}, ${WIND_EN[wind(s)]}` }, head, melds, hand);
  };
  const pond = (k) => {
    const s = seatAt(k), p = h.players[s];
    return el('div', { class: `mj-pond pos-${k}`, 'aria-label': `${v.names[s]}'s discards` }, p.discards.map((d, i) => tileEl(d.tile, { small: true, dim: d.claimed, last: h.last && h.last.from === s && i === p.discards.length - 1 })));
  };
  const center = el('div', { class: 'mj-center' },
    el('div', { class: 'mj-round' }, el('span', { class: 'mj-big' }, WIND[v.round % 4]), el('span', {}, `${WIND_EN[v.round % 4]} round · hand ${v.handNo + 1}`)),
    el('div', { class: 'mj-left' }, el('span', { class: 'mj-big' }, String(h.wallLeft)), el('span', {}, 'tiles left')),
    h.last ? el('div', { class: 'mj-lastd' }, tileEl(h.last.tile), el('span', {}, `${v.names[h.last.from]} discarded`)) : null);

  const bar = el('div', { class: 'mj-bar', role: 'group', 'aria-label': 'Your options' });
  if (!h.result && v.pending.includes(v.me)) {
    const special = opts.filter(o => o.type !== 'discard');
    for (const o of special) bar.append(el('button', { type: 'button', class: `mj-act a-${o.type}`, onclick: () => onAct && onAct(o) }, label(o)));
    if (myTurn) bar.append(el('button', { type: 'button', class: 'mj-act a-discard', disabled: !selected, onclick: () => selected && doDiscard(selected) }, selected ? `Discard ${tileName(selected)}` : 'Pick a tile to discard'));
    if (h.stage === 'claim' && h.last) bar.prepend(el('span', { class: 'mj-prompt' }, `${v.names[h.last.from]} discarded ${tileName(h.last.tile)}.`));
  } else if (!h.result) bar.append(el('span', { class: 'mj-prompt' }, v.me >= 0 && v.me < 4 ? (h.turn === v.me ? '…' : `${v.names[h.turn]} to play`) : 'Watching'));
  if (timer) bar.append(el('span', { class: 'mj-timer', 'aria-live': 'off' }, timer));

  root.replaceChildren(el('div', { class: 'mj-table' }, seatBox(2), seatBox(3), el('div', { class: 'mj-mid' }, pond(2), el('div', { class: 'mj-ponds-row' }, pond(3), center, pond(1)), pond(0)), seatBox(1), el('div', { class: 'mj-me' }, seatBox(0), bar)));
}

// The end of a hand: who won, with what, and what everyone paid.
export function drawResult(box, v, { next, nextLabel = 'Next hand', verified, final } = {}) {
  const r = v.hand?.result;
  if (!r) { box.replaceChildren(); box.hidden = true; return; }
  box.hidden = false;
  const won = r.type === 'win';
  box.replaceChildren(el('div', { class: 'mj-result', role: 'dialog', 'aria-label': 'End of the hand' },
    el('h2', {}, won ? `${v.names[r.winner]} wins${r.from === null ? ' (self-drawn)' : `, off ${v.names[r.from]}`}` : 'A draw: the wall ran out'),
    won ? el('div', { class: 'mj-win-hand' }, (r.hand || []).map(t => tileEl(t)), v.hand.players[r.winner].melds.map(m => el('span', { class: 'mj-meld' }, m.tiles.map(t => tileEl(t))))) : null,
    won ? el('ul', { class: 'mj-faan' }, (r.items.length ? r.items : [{ faan: 0, why: 'Chicken hand: no scoring patterns' }]).map(x => el('li', {}, el('span', {}, x.why), el('span', {}, `${x.faan} faan`))), el('li', { class: 'total' }, el('span', {}, 'Total'), el('span', {}, `${r.faan} faan${r.limit ? ' (limit)' : ''}`))) : null,
    el('table', { class: 'mj-pay' }, el('tbody', {}, v.names.map((n, s) => el('tr', {}, el('td', {}, n), el('td', { class: r.points[s] > 0 ? 'plus' : r.points[s] < 0 ? 'minus' : '' }, r.points[s] > 0 ? `+${r.points[s]}` : String(r.points[s])), el('td', {}, String(v.scores[s])))))),
    verified ? el('p', { class: 'mj-verified' }, verified) : null,
    final ? el('p', { class: 'mj-final' }, final) : null,
    next ? el('button', { type: 'button', class: 'mj-act a-win', onclick: next }, nextLabel) : null));
}
