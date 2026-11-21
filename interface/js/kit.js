// kit · the page's components, shared by every screen and offered to modules
// (api.kit). Each takes the page's own h() and returns elements; none holds
// state or reads the record. Styles: interface/athens.css.
//
//   card({ title, href, meta, tone, body, actions })   a box on a grid of cards
//   cards(...items)                                     the grid
//   meter({ label, value, of, mark, met, text })        a bar, with a mark for what is needed
//   stat(number, label) / stats(...stat)                a large figure and its label
//   badge(text, tone)                                   a small rounded label
//   timeline(items)                                     [{ when, text, state: done|now|future }]
//   feed(items)                                         [{ when, text }]: lately, newest first
//   empty(text)                                         a quiet line where nothing is
//   pills({ label, options, value, onChange })          tschoonover.com's pill controls
//   heading(text, n)                                    a section heading, with an optional § number
export function makeKit(h) {
  const card = ({ title, href, meta, tone, body, actions, cls } = {}) => h('article', { class: `card${tone ? ` ${tone}` : ''}${cls ? ` ${cls}` : ''}` },
    title ? h('h3', {}, href ? h('a', { href }, title) : title) : null,
    meta ? h('p', { class: 'meta' }, meta) : null,
    ...[].concat(body ?? []).filter(Boolean),
    actions ? h('div', { class: 'buttons' }, ...[].concat(actions).filter(Boolean)) : null);
  const cards = (...items) => h('div', { class: 'cards' }, ...items.flat().filter(Boolean));

  const pct = (x) => `${Math.max(0, Math.min(100, x * 100))}%`;
  const meter = ({ label, value = 0, of = 1, mark = null, met = false, text = '' }) => {
    const share = of ? value / of : 0;
    return h('div', { class: `meter${met ? ' met' : ''}`, role: 'img', 'aria-label': `${label}: ${text || `${value} of ${of}`}` },
      h('span', {}, label),
      h('span', { class: 'track' }, h('span', { class: 'fill', style: `width:${pct(share)}` }), mark !== null ? h('span', { class: 'mark', style: `left:${pct(mark)}` }) : null),
      h('b', {}, text || `${value}/${of}`));
  };
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, String(n)), h('span', {}, label));
  const stats = (...items) => h('div', { class: 'stats' }, ...items.filter(Boolean));
  const badge = (text, tone) => h('span', { class: `badge${tone ? ` ${tone}` : ''}` }, text);
  const timeline = (items) => h('ol', { class: 'timeline' }, items.filter(Boolean).map(i => h('li', { class: i.state || 'done' }, i.when ? h('time', {}, i.when) : null, i.text)));
  const feed = (items) => h('ul', { class: 'feed' }, items.map(i => h('li', {}, h('time', {}, i.when), h('span', {}, i.text))));
  const empty = (text) => h('p', { class: 'empty' }, text);
  const pills = ({ label, options, value, onChange }) => h('div', { class: 'pill', role: 'group', 'aria-label': label },
    options.map(([v, text, title]) => h('button', { type: 'button', 'aria-pressed': String(v === value), title: title || null, onclick: () => onChange(v) }, text)));
  const heading = (text, n) => h('h2', n ? { 'data-n': String(n).padStart(2, '0') } : {}, text);
  return { card, cards, meter, stat, stats, badge, timeline, feed, empty, pills, heading };
}
