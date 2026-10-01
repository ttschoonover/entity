// The threads tab: #/threads (every board), #/threads/BOARD, #/threads/BOARD/POST.
// Any post or reply folds away with its replies.
import { score, boardsOf } from './index.js';

function context(api) {
  const { state, params, me } = api;
  const t = state.m.threads || { items: {}, order: [] };
  const office = params.value('threads.moderator_office');
  const at = state.head.at;
  const mod = !!(me && office && state.m.offices?.[office]?.holders.some(x => x.id === me.id && (!x.until || x.until > at)));
  return { t, mod, can: me?.status === 'active', boards: boardsOf(state, params) };
}
const visible = (p) => !(p.deleted && !p.replies.length);
const repliesIn = (t, it) => it.replies.reduce((n, id) => n + 1 + (t.items[id] ? repliesIn(t, t.items[id]) : 0), 0);

// One post or reply, with its replies, folded under a summary line.
function item(api, c, it, depth, open = true) {
  const { h, me, when, $, who } = api;
  const removed = it.hidden ? `[hidden: ${it.hidden.reason}]` : it.deleted ? '[deleted by its author]' : null;
  const mine = me && it.by === me.id;
  const vote = (v) => api.sign('post.vote', { target: it.id, value: it.votes[me.id] === v ? 0 : v }, v > 0 ? 'Your upvote' : 'Your downvote');
  const n = repliesIn(c.t, it);
  const summary = h('summary', {}, h('span', { class: 'meta' }, h('span', { class: 'score' }, score(it)), ' · ', who(it.by), ` · ${when(it.at)}${it.edits ? ` · edited ${it.edits}×` : ''}${n ? ` · ${n} repl${n === 1 ? 'y' : 'ies'}` : ''}`));
  const inner = h('div', { class: 'post-inner' },
    removed ? h('p', { class: 'removed' }, removed) : h('p', { class: 'post-body' }, it.body),
    c.can && !removed ? h('div', { class: 'buttons' },
      h('button', { class: it.votes[me.id] === 1 ? '' : 'quiet', onclick: () => vote(1), 'aria-label': 'Upvote' }, '▲'),
      h('button', { class: it.votes[me.id] === -1 ? '' : 'quiet', onclick: () => vote(-1), 'aria-label': 'Downvote' }, '▼'),
      h('button', { class: 'quiet', onclick: (e) => { const f = e.target.closest('.post-inner').querySelector(':scope > .inline-form'); f.hidden = !f.hidden; } }, 'Reply'),
      mine ? h('button', { class: 'quiet', onclick: () => confirm('It disappears from view, but its text stays in the record forever.') && api.sign('post.delete', { target: it.id }, 'Deleting your post') }, 'Delete') : null,
      c.mod && !mine ? h('button', { class: 'danger', onclick: () => { const r = prompt('Reason (published):'); if (r) api.sign('post.hide', { target: it.id, reason: r }, 'Hiding a post'); } }, 'Hide') : null) : null,
    c.can && !removed ? h('div', { class: 'inline-form', hidden: true },
      h('textarea', { id: `re-${it.id}`, style: 'font-family:inherit', 'aria-label': 'Your reply' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('post.reply', { to: it.id, body: $(`#re-${it.id}`).value }, 'Your reply') }, 'Sign reply'))) : null,
    it.replies.filter(rid => c.t.items[rid]).map(rid => (depth < 8 ? item(api, c, c.t.items[rid], depth + 1, depth < 2) : null)));
  return h('details', { class: 'post', open: open || null }, summary, inner);
}

function boardBar(api, c, current) {
  const { h, link } = api;
  const count = (id) => c.t.order.filter(p => c.t.items[p].board === id && visible(c.t.items[p])).length;
  return h('nav', { class: 'boards', 'aria-label': 'Boards' },
    h('a', { href: '#/threads', 'aria-current': !current ? 'page' : null }, `Everything (${c.t.order.filter(p => visible(c.t.items[p])).length})`),
    c.boards.map(b => h('a', { href: `#/threads/${b.id}`, 'aria-current': b.id === current ? 'page' : null, title: b.description || null }, `${b.title} (${count(b.id)})`)));
}

function list(api, board) {
  const { h, $, link, when, who } = api;
  const c = context(api);
  const b = board ? c.boards.find(x => x.id === board) : null;
  if (board && !b) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `There is no board ${board}.`), link('threads', 'Every board'));
  const posts = c.t.order.map(id => c.t.items[id]).filter(p => visible(p) && (!board || p.board === board));
  const sec = h('section', {}, h('h2', {}, b ? b.title : 'Threads'),
    b?.description ? h('p', {}, b.description) : null,
    b && b.by && api.me?.status === 'active' ? api.editForm('Edit this board', [['title', 'Name', b.title], ['description', 'What it is for', b.description]], (ch) => api.propose(`Amend the board ${b.title}`, [{ kind: 'board.amend', board: b.id, ...ch }])) : null,
    boardBar(api, c, board),
    h('p', { class: 'fine' }, 'Everything posted stays in the record for good. Deleting or hiding a post removes it from view, not from the record.'));
  sec.append(api.list({
    key: `threads:${board || '*'}`, items: posts, noun: 'posts', empty: 'No posts here yet.',
    render: (p) => h('li', {}, h('h3', {}, link(`threads/${p.board}/${p.id}`, p.hidden || p.deleted ? '[removed]' : p.title)),
      h('p', { class: 'meta' }, h('span', { class: 'score' }, score(p)), ' · ', who(p.by), ` · ${when(p.at)} · ${repliesIn(c.t, p)} repl${repliesIn(c.t, p) === 1 ? 'y' : 'ies'}`,
        !board ? h('span', { class: 'category' }, c.boards.find(x => x.id === p.board)?.title || p.board) : null)),
    text: (p) => `${p.title} ${p.body} ${p.by}`,
    sorts: [['Top', (x, y) => score(y) - score(x) || (x.at < y.at ? 1 : -1)], ['Newest', api.sorts.newest()], ['Most replies', (x, y) => repliesIn(c.t, y) - repliesIn(c.t, x)], ['Oldest', api.sorts.oldest()]],
  }));
  if (c.can) {
    sec.append(h('details', {}, h('summary', {}, `New post${b ? ` in ${b.title}` : ''}`), h('div', { class: 'inline-form' },
      !b ? [h('label', { for: 'np-board' }, 'Board'), h('select', { id: 'np-board' }, c.boards.map(x => h('option', { value: x.id }, x.title)))] : null,
      h('label', { for: 'np-title' }, 'Title'), h('input', { id: 'np-title' }),
      h('label', { for: 'np-body' }, 'Text'), h('textarea', { id: 'np-body', style: 'font-family:inherit' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('post.create', { board: b ? b.id : $('#np-board').value, title: $('#np-title').value.trim(), body: $('#np-body').value }, 'Your post') }, 'Sign post')))));
    if (api.params.value('threads.open_boards')) sec.append(h('details', {}, h('summary', {}, 'Start a new board'), h('div', { class: 'inline-form' },
      h('label', { for: 'nb-title' }, 'Name'), h('input', { id: 'nb-title', placeholder: 'Recipes' }),
      h('label', { for: 'nb-id' }, 'Id (its address)'), h('input', { id: 'nb-id', placeholder: 'recipes' }),
      h('label', { for: 'nb-desc' }, 'What it is for'), h('input', { id: 'nb-desc' }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('board.create', { board: $('#nb-id').value.trim(), title: $('#nb-title').value.trim(), ...($('#nb-desc').value.trim() ? { description: $('#nb-desc').value.trim() } : {}) }, 'Your new board') }, 'Sign')))));
  }
  return sec;
}

function one(api, board, id) {
  const { h, link } = api;
  const c = context(api);
  const p = c.t.items[id];
  if (!p || p.kind !== 'post') return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `There is no post ${id}.`), link(`threads/${board}`, 'Back to the board'));
  const b = c.boards.find(x => x.id === p.board);
  return h('section', {}, h('p', { class: 'fine' }, link('threads', 'Threads'), ' › ', link(`threads/${p.board}`, b?.title || p.board)),
    h('h2', {}, p.hidden || p.deleted ? '[removed]' : p.title),
    h('div', { class: 'buttons' },
      h('button', { class: 'quiet', onclick: (e) => e.target.closest('section').querySelectorAll('details.post').forEach(d => { d.open = false; }) }, 'Fold everything'),
      h('button', { class: 'quiet', onclick: (e) => e.target.closest('section').querySelectorAll('details.post').forEach(d => { d.open = true; }) }, 'Unfold everything')),
    item(api, c, p, 0, true));
}

export const tabs = [{ id: 'threads', title: 'Threads', render: (api, path) => (path[1] ? one(api, path[0], path[1]) : list(api, path[0] || null)) }];
