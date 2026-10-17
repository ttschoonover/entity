// The federation tab: the states, their citizens, and whom each appoints to
// the senate and the assembly; seats by population; lawful secession.

const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);
export default function render(api) {
  const { h, state, me, day, who, params } = api;
  const all = Object.values(state.m.federation?.states || {});
  const live = all.filter(s => !s.released);
  const per = params.value('federation.senators_per_state'), total = params.value('federation.assembly_seats');
  // Seats by population: the method of equal proportions, at least one each.
  const pops = Object.fromEntries(live.map(s => [s.id, Object.keys(s.certified?.citizens || {}).length]));
  const seats = Object.fromEntries(live.map(s => [s.id, live.length <= total ? 1 : 0]));
  for (let n = live.length; n < total; n++) {
    let best = null;
    for (const id of Object.keys(pops).sort()) { const pr = pops[id] / Math.sqrt(seats[id] * (seats[id] + 1)); if (!best || pr > best.pr) best = { id, pr }; }
    if (!best || pops[best.id] <= 0) break; seats[best.id]++;
  }
  const sec = h('section', {}, h('h2', {}, 'The states'),
    h('p', { class: 'hint' }, `A federation of ${live.length} state${live.length === 1 ? '' : 's'}, each its own entity with its own record and government. Every state appoints ${per} senator${per === 1 ? '' : 's'}; the assembly’s ${total} seats are shared by population, at least one each. Every citizen of the federation is a citizen of exactly one state.`));
  if (!live.length) sec.append(h('p', { class: 'hint' }, 'No states admitted yet. A state is admitted by decision (federation.admit_state).'));
  sec.append(api.list({
    key: 'states', items: live, noun: 'states',
    text: (s) => `${s.id} ${s.name} ${Object.keys(s.certified?.citizens || {}).join(' ')}`,
    sorts: [['Most citizens', (x, y) => pops[y.id] - pops[x.id]], ['Name, A–Z', api.sorts.byText((s) => s.name)]],
    render: (s) => {
      const c = s.certified;
      const enrolled = Object.keys(c?.citizens || {}).filter(id => state.participants[id]?.status === 'active');
      const list = (ids) => (ids.length ? ids.flatMap((x, i) => [i ? ', ' : '', state.participants[x] ? who(x) : x]) : ['—']);
      return h('li', {},
        h('h3', {}, s.name, ' ', h('span', { class: 'hint' }, `· ${s.id}`)),
        h('p', { class: 'meta' }, `Admitted ${day(s.admitted)} · entity ${s.entity}`),
        c ? h('p', {}, `${pops[s.id]} citizen${pops[s.id] === 1 ? '' : 's'}, ${enrolled.length} of them enrolled in the federation · certified ${day(c.at)} from the state’s record at ${c.count}`)
          : h('p', { class: 'hint' }, 'Not certified yet: its registrar runs `entity federation certify` from the state’s folder.'),
        h('p', {}, h('strong', {}, `Senate (${(c?.senate || []).length} of ${per}): `), ...list(c?.senate || [])),
        h('p', {}, h('strong', {}, `Assembly (${(c?.assembly || []).length} of ${seats[s.id] ?? 0}): `), ...list(c?.assembly || [])),
        me?.status === 'active' ? h('p', {}, h('button', { class: 'linklike', onclick: () => { const why = prompt(`Why should ${s.name} be released from the federation? The reason is published.`); if (why) api.propose(`Release ${s.name}`, [{ kind: 'federation.release_state', state: s.id, reason: why }]); } }, 'Propose releasing this state')) : null);
    },
  }));
  const gone = all.filter(s => s.released);
  if (gone.length) sec.append(h('details', {}, h('summary', {}, `Former states (${gone.length})`), h('ul', {}, gone.map(s => h('li', {}, `${s.name}: released ${day(s.released.at)}, ${s.released.reason}`)))));
  if (me && state.participants[me.id]?.state) sec.append(h('p', { class: 'hint' }, `${nm(api, me.id)}: a citizen of the federation through ${state.m.federation.states[state.participants[me.id].state]?.name}.`));
  return sec;
}
