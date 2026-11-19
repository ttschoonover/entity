// The Nomic tab: whose turn it is, the scoreboard, the rules, calls for
// judgment, and the forms to propose a change, end a turn or ask the judge.
import { rules, score, players, turnOf, turnEnds } from './index.js';

const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);

export default function render(api) {
  const { h, state, me, $, when, who, params } = api;
  const g = state.m.nomic || { rules: {}, scores: {}, cfjs: {}, game: 1 };
  const t = turnOf(state), ends = turnEnds(state, params), now = new Date().toISOString();
  const myTurn = me && t && t.player === me.id;
  const goal = params.value('nomic.win_points');
  const sec = h('section', {}, h('h2', {}, `Nomic · game ${g.game}`),
    h('p', { class: 'hint' }, `Players take turns proposing changes to the rules; everyone votes. A change that passes earns its proposer ${params.value('nomic.points_adopted')} points. First to ${goal} wins.`));

  if (g.winner) sec.append(h('p', { class: 'nomic-winner' }, who(g.winner.id), ` won game ${g.winner.game} with ${g.winner.score} points, ${when(g.winner.at)}. Anyone may propose a new game.`));
  if (t) sec.append(h('p', {}, h('strong', {}, 'Turn: '), who(t.player), ends ? ` · until ${when(ends)}` : '',
    me && (myTurn || (ends && now >= ends)) ? [' ', h('button', { class: 'quiet', onclick: () => api.sign('nomic.pass', {}, myTurn ? 'Ending your turn' : `Ending ${nm(api, t.player)}'s turn`) }, myTurn ? 'End my turn' : 'End this turn')] : null));

  const ps = players(state).sort((a, b) => score(state, b) - score(state, a));
  sec.append(h('h3', {}, 'Scores'), h('ol', { class: 'nomic-scores' }, ps.map(id => h('li', {}, who(id), ' ', h('span', { class: 'score' }, String(score(state, id))),
    h('span', { class: 'bar' }, h('span', { style: `width:${Math.min(100, (score(state, id) / goal) * 100)}%;background:var(--ink)` }))))));

  const all = rules(state);
  sec.append(h('h3', {}, `The rules (${all.length})`), api.list({
    key: 'nomic-rules', items: all, noun: 'rules', empty: 'No rules yet.',
    text: (r) => `${r.number} ${r.title} ${r.text}`,
    sorts: [['By number', (a, b) => a.number - b.number], ['Newest first', (a, b) => (a.enacted < b.enacted ? 1 : -1)]],
    render: (r) => h('li', { class: r.mutable ? 'rule mutable' : 'rule immutable' },
      h('h3', {}, `${r.number}. ${r.title} `, h('span', { class: 'hint' }, r.mutable ? '· mutable' : '· immutable')),
      h('div', { class: 'post-body' }, r.text),
      r.history.length > 1 ? h('details', {}, h('summary', {}, 'History'), h('ul', {}, r.history.map(x => h('li', { class: 'fine' }, `${x.what} ${when(x.at)}${x.proposal ? ` by decision ${x.proposal}` : ''}`)))) : null),
  }));

  const cfjs = Object.values(g.cfjs || {}).sort((a, b) => (a.at < b.at ? 1 : -1));
  sec.append(h('h3', {}, 'Calls for judgment'), h('p', { class: 'hint' }, g.judge ? ['The judge is ', who(g.judge), '.'] : 'No judge yet: one is named by decision.'),
    cfjs.length ? h('ul', { class: 'items' }, cfjs.map(c => h('li', {}, h('p', {}, c.question), h('p', { class: 'meta' }, 'asked by ', who(c.by), ` · ${when(c.at)}`),
      c.judgment ? h('p', {}, h('strong', {}, c.judgment.verdict.toUpperCase()), ` · ${c.judgment.reason}`)
        : me && g.judge === me.id && c.by !== me.id ? h('div', { class: 'buttons' }, ['true', 'false', 'undecided'].map(v => h('button', { class: 'quiet', onclick: () => {
          const reason = prompt(`Your reasoning for ${v.toUpperCase()}:`); if (reason) api.sign('nomic.judgment', { cfj: c.id, verdict: v, reason }, 'Your judgment');
        } }, v))) : h('p', { class: 'fine' }, 'Awaiting judgment.')))) : h('p', { class: 'empty' }, 'None yet.'));

  if (me?.status === 'active') {
    sec.append(h('details', {}, h('summary', {}, 'Propose a rule change'), h('div', { class: 'inline-form' },
      h('p', { class: 'hint' }, myTurn || !params.value('nomic.turns') ? 'It is your turn: one proposal.' : `It is ${nm(api, t?.player)}'s turn. You can draft now and propose on yours.`),
      h('label', { for: 'nm-k' }, 'Change'), h('select', { id: 'nm-k' }, h('option', { value: 'enact' }, 'Enact a new rule'), h('option', { value: 'amend' }, 'Amend a rule'), h('option', { value: 'repeal' }, 'Repeal a rule'), h('option', { value: 'transmute' }, 'Transmute a rule')),
      h('label', { for: 'nm-n' }, 'Rule number'), h('input', { id: 'nm-n', type: 'number', min: 1 }),
      h('label', { for: 'nm-t' }, 'Title (new rules)'), h('input', { id: 'nm-t' }),
      h('label', { for: 'nm-x' }, 'Text'), h('textarea', { id: 'nm-x', rows: 5 }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => {
        const k = $('#nm-k').value, number = Number($('#nm-n').value), title = $('#nm-t').value.trim(), txt = $('#nm-x').value.trim();
        const e = k === 'enact' ? { kind: 'nomic.enact', number, title, text: txt } : k === 'amend' ? { kind: 'nomic.amend', number, text: txt } : { kind: `nomic.${k}`, number };
        api.propose(`${k[0].toUpperCase()}${k.slice(1)} rule ${number}${title ? `: ${title}` : ''}`, [e]);
      } }, 'Propose')))),
    h('details', {}, h('summary', {}, 'Call for judgment'), h('div', { class: 'inline-form' },
      h('label', { for: 'nm-q' }, 'Your question about the rules'), h('textarea', { id: 'nm-q', rows: 3 }),
      h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('nomic.cfj', { question: $('#nm-q').value.trim() }, 'Your call for judgment') }, 'Ask the judge')))));
  }
  return sec;
}
