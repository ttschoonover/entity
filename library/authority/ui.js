// The authority tab: every grant, who holds it, and every use of it.
import { inForce, body, bodyName, needed, PROTECTED } from './index.js';

const describe = (api, e) => { const d = api.registry.effects.get(e.kind); return d ? d.describe(e) : e.kind; };

function grantBlock(api, g, full) {
  const { h, state, me, day, when, link, who } = api;
  const at = state.head.at;
  const live = inForce(state, g.id);
  const members = body(state, g.to, at) || [];
  const mine = me && members.includes(me.id) && live;
  const uses = g.exercises.map(x => state.m.authority.exercises[x]).reverse();
  const shown = full ? uses : uses.slice(0, 3);
  return h('div', { class: 'grant' },
    h('h3', {}, link(`authority/${g.id}`, g.title || g.id), g.title ? h('span', { class: 'category' }, g.id) : null, live ? '' : h('span', { class: 'flag' }, g.revoked ? ` · revoked ${day(g.revoked.at)}${g.revoked.reason ? `: ${g.revoked.reason}` : ''}` : ' · fell with the grant it was made under')),
    h('p', { class: 'meta' }, `To ${bodyName(g.to)} · made by ${g.origin} on ${day(g.created)}${g.parent ? `, under ${g.parent}` : ''}`),
    h('p', {}, `May: ${g.may.join(', ')}`,
      g.where ? `; only where ${Object.entries(g.where).map(([k, v]) => `${k} is ${[].concat(v).join(' or ')}`).join(', ')}` : '',
      g.limit ? `; at most ${g.limit.count} use${g.limit.count === 1 ? '' : 's'} in any ${g.limit.days} days` : '',
      `; each use needs ${g.needs ?? (g.to.committee ? 'the committee\'s rule' : 1)} signature(s)${members.length ? ` (${needed(g, state, members.length)} now)` : ''}`,
      g.delegable ? '; may be delegated further' : ''),
    g.note ? h('p', { class: 'fine' }, g.note) : null,
    uses.length ? h('ul', {}, shown.map(x => h('li', {},
      `${when(x.at)} · `, who(x.by), `: ${x.effects.map(e => describe(api, e)).join('; ')}`,
      x.enacted ? h('span', { class: 'state-carried' }, ' · done') : at > x.expires ? h('span', { class: 'state-failed' }, ' · lapsed') : ` · waiting: ${x.signers.length} of ${x.needs} signatures`,
      mine && !x.enacted && at <= x.expires && !x.signers.includes(me.id) ? [' ', h('button', { class: 'quiet', onclick: () => api.sign('authority.cosign', { exercise: x.id }, `Your signature on ${x.id}`) }, 'Sign too')] : null)))
      : h('p', { class: 'hint' }, 'Not used yet.'),
    !full && uses.length > 3 ? h('p', {}, link(`authority/${g.id}`, `All ${uses.length} uses`)) : null,
    mine && full ? useForm(api, g) : null);
}

function useForm(api, g) {
  const { h, $ } = api;
  const template = (k) => JSON.stringify({ kind: k, ...Object.fromEntries(Object.entries(g.where || {}).map(([f, v]) => [f, [].concat(v)[0].replace(/\*/g, '')])) }, null, 2);
  const box = h('textarea', { id: 'au-effect', spellcheck: 'false' }, template(g.may[0]));
  return h('details', { open: true }, h('summary', {}, 'Use this grant'),
    h('p', { class: 'fine' }, 'Write what to do as an effect, the same as a decision would carry. It is checked against this grant before anything is signed, and again when it is settled.'),
    h('label', { for: 'au-kind' }, 'What'), h('select', { id: 'au-kind', onchange: () => { box.value = template($('#au-kind').value); } }, g.may.map(k => h('option', { value: k }, k))),
    h('label', { for: 'au-effect' }, 'Effect'), box,
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      let e; try { e = JSON.parse(box.value); } catch (x) { return alert(`That is not valid JSON: ${x.message}`); }
      api.sign('authority.exercise', { grant: g.id, effects: [e] }, `Using the grant ${g.id}: ${describe(api, e)}`);
    } }, 'Sign and use')));
}

function proposeForm(api) {
  const { h, state, $, params } = api;
  const offices = Object.values(state.m.offices || {}).filter(o => !o.abolished).map(o => ['office', o.id, o.title]);
  const comms = Object.values(state.m.committees || {}).filter(c => !c.dissolved).map(c => ['committee', c.id, c.title]);
  const bodies = [...offices, ...comms];
  const enabled = params.value('entity.modules');
  const kinds = [...api.registry.effects.values()].filter(d => d.module === 'kernel' || enabled.includes(d.module)).map(d => d.name).sort();
  if (!bodies.length) return h('p', { class: 'hint' }, 'Authority is granted to an office or a committee. Create one first.');
  return h('details', {}, h('summary', {}, 'Propose a grant'), h('div', { class: 'inline-form' },
    h('label', { for: 'ag-id' }, 'Name of the grant'), h('input', { id: 'ag-id', placeholder: 'deed-manager' }),
    h('label', { for: 'ag-to' }, 'To'), h('select', { id: 'ag-to' }, bodies.map(([t, id, title]) => h('option', { value: `${t}:${id}` }, `${title} (${t})`))),
    h('span', { class: 'label' }, 'May do'),
    h('div', { id: 'ag-may' }, kinds.map(k => h('label', { style: 'font-weight:400' }, h('input', { type: 'checkbox', value: k, style: 'width:auto;margin-right:.5rem' }), k, PROTECTED.includes(k) ? ' (needs delegable)' : ''))),
    h('label', { for: 'ag-where' }, 'Only where (optional, JSON)'), h('input', { id: 'ag-where', placeholder: '{"deed": "room-*"}', spellcheck: 'false' }),
    h('label', { for: 'ag-count' }, 'At most … uses (optional)'), h('input', { id: 'ag-count', type: 'number', min: 1 }),
    h('label', { for: 'ag-days' }, '… in any … days'), h('input', { id: 'ag-days', type: 'number', min: 1 }),
    h('label', { for: 'ag-needs' }, 'Signatures per use'), h('select', { id: 'ag-needs' }, h('option', { value: '' }, 'default (1 for an office, the committee\'s rule)'), h('option', { value: 'majority' }, 'a majority'), h('option', { value: 'all' }, 'all'), h('option', { value: '2' }, '2')),
    h('label', { style: 'font-weight:400' }, h('input', { type: 'checkbox', id: 'ag-deleg', style: 'width:auto;margin-right:.5rem' }), 'Delegable: may grant within itself'),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const [t, id] = $('#ag-to').value.split(':');
      const e = { kind: 'authority.grant', grant: $('#ag-id').value.trim(), to: { [t]: id }, may: [...$('#ag-may').querySelectorAll('input:checked')].map(i => i.value) };
      if ($('#ag-where').value.trim()) { try { e.where = JSON.parse($('#ag-where').value); } catch (x) { return alert(`where: ${x.message}`); } }
      if ($('#ag-count').value || $('#ag-days').value) e.limit = { count: Number($('#ag-count').value), days: Number($('#ag-days').value) };
      const nv = $('#ag-needs').value; if (nv) e.needs = /^\d+$/.test(nv) ? Number(nv) : nv;
      if ($('#ag-deleg').checked) e.delegable = true;
      api.propose(`Grant "${e.grant}"`, [e]);
    } }, 'Sign this proposal'))));
}

function list(api) {
  const { h, state, me } = api;
  const grants = Object.values(state.m.authority?.grants || {}).sort((a, b) => (a.created < b.created ? 1 : -1));
  const live = grants.filter(g => inForce(state, g.id)), gone = grants.filter(g => !inForce(state, g.id));
  const sec = h('section', {}, h('h2', {}, 'Authority'),
    h('p', { class: 'hint' }, 'Powers the members have handed to an office or a committee, to use without a vote, within the limits written here. Every use is listed; any of them can be undone by decision, and any grant revoked.'));
  if (!grants.length) sec.append(h('p', { class: 'hint' }, 'Nothing has been granted.'));
  const at = state.head.at;
  sec.append(api.list({
    key: 'authority',
    edit: (g) => (api.me?.status === 'active' && !g.revoked ? api.editForm('Edit this grant', [['title', 'Title', g.title || ''], ['note', 'Note', g.note, 'textarea'], ['may', 'What it may do (one per line)', g.may, 'lines'], ['needs', 'Signatures needed', g.needs ?? 1, 'number']], (ch) => {
      if (('needs' in ch) && !('may' in ch)) ch.may = g.may;
      api.propose(`Amend the grant ${g.title || g.id}`, [{ kind: 'authority.amend', grant: g.id, ...ch }]);
    }) : null), items: grants, noun: 'grants', render: (g) => h('li', {}, grantBlock(api, g, false)),
    mine: me ? (g) => (body(state, g.to, at) || []).includes(me.id) : null,
    text: (g) => `${g.id} ${g.may.join(' ')} ${g.to.office || g.to.committee} ${g.note}`,
    sorts: [['Newest first', api.sorts.newest((g) => g.created)], ['Name, A–Z', api.sorts.byText((g) => g.id)], ['Most used', (a, b) => b.exercises.length - a.exercises.length]],
    filters: [{ label: 'In force', options: [['In force', (g) => inForce(state, g.id)], ['No longer in force', (g) => !inForce(state, g.id)], ['All', () => true]] }],
  }));
  if (me?.status === 'active') sec.append(proposeForm(api));
  return sec;
}

function one(api, id) {
  const { h, state, me, link } = api;
  const g = state.m.authority?.grants?.[id];
  if (!g) return h('section', {}, h('h2', {}, 'Not found'), h('p', {}, `There is no grant ${id}.`), link('authority', 'Every grant'));
  const children = Object.values(state.m.authority.grants).filter(c => c.parent === id);
  return h('section', {}, h('h2', {}, `The grant ${id}`), grantBlock(api, g, true),
    children.length ? [h('h3', {}, 'Grants made under it'), h('ul', {}, children.map(c => h('li', {}, link(`authority/${c.id}`, c.id))))] : null,
    me?.status === 'active' && inForce(state, id) ? h('div', { class: 'buttons' }, h('button', { class: 'danger', onclick: () => { const r = prompt('Why revoke it? (published)'); if (r !== null) api.propose(`Revoke the grant ${id}`, [{ kind: 'authority.revoke', grant: id, ...(r ? { reason: r } : {}) }]); } }, 'Propose revoking')) : null,
    h('p', {}, link('authority', 'Every grant')));
}

export const tabs = [{ id: 'authority', title: 'Authority', render: (api, path) => (path[0] ? one(api, path[0]) : list(api)) }];
