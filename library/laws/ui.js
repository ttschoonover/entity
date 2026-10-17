// Parliament and the statute book: bills, votes, petitions and referendums;
// every law by type, tag and the bodies it concerns; and the form that drafts a
// law for either way of making it.
import { types, typeOf, ruleOf, lawRule, governs, members, tally, petitionsNeeded, inForce } from './index.js';

export const tabs = [
  { id: 'parliament', title: 'Parliament', render: (api, path) => parliament(api, path) },
  { id: 'statutes', title: 'Statute book', render: (api, path) => statutes(api, path) },
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'law';
// A rule in plain words, from the rule as it now stands (the citizens can change it).
export function majorityWords(params, name) {
  const r = params.rules[name]; if (!r) return `the ${name} majority`;
  const f = (x) => ({ 0.5: 'a majority', 0.6: 'three-fifths', 0.66: 'two-thirds', 0.67: 'two-thirds', 0.75: 'three-quarters', 1: 'everyone' }[x] || `${Math.round(x * 100)}%`);
  return `${f(r.threshold)} of votes cast${r.quorum ? `, with ${Math.round(r.quorum * 100)}% voting` : ''}${(r.readings || 1) > 1 ? `, in ${r.readings} votes at least ${r.apart} days apart` : ''}`;
}

// The bodies a law can concern, by their names.
export function bodies(state) {
  return [['public', 'The general public'], ['citizens', 'All citizens'],
    ...Object.values(state.m.offices || {}).filter(o => !o.abolished).map(o => [`office:${o.id}`, o.title]),
    ...Object.values(state.m.committees || {}).filter(c => !c.dissolved).map(c => [`committee:${c.id}`, c.title])];
}
export const bodyName = (state, x) => (bodies(state).find(([id]) => id === x)?.[1]) || (String(x).startsWith('member:') ? personName(state, x.slice(7)) : x);
// "Name (id)", or the id alone when the person has set no name.
const personName = (state, id) => { const t = state.m.titles?.[id]; const n = (typeof t === 'string' ? t : t?.title) || state.participants[id]?.name; return n && n !== id ? `${n} (${id})` : id; };
export const typeLabel = (params, l) => `${typeOf(params, l.type)?.title || l.type}${l.level ? ` · ${typeOf(params, l.level)?.title || l.level} level` : ''}`;

// A law's text: headings (##), numbered and bulleted lists, paragraphs.
export function text(h, md) {
  const out = []; let para = [], list = null;
  const flushP = () => { if (para.length) out.push(h('p', {}, para.join(' '))); para = []; };
  const flushL = () => { if (list) out.push(h(list.tag, {}, list.items.map(i => h('li', {}, i)))); list = null; };
  for (const raw of String(md || '').split('\n')) {
    const l = raw.trim();
    if (!l) { flushP(); flushL(); continue; }
    const hd = l.match(/^#{1,3}\s+(.*)/), n = l.match(/^\d+\.\s+(.*)/), u = l.match(/^[-*]\s+(.*)/);
    if (hd) { flushP(); flushL(); out.push(h('h4', {}, hd[1])); continue; }
    if (n || u) { flushP(); const tag = n ? 'ol' : 'ul'; if (list?.tag !== tag) { flushL(); list = { tag, items: [] }; } list.items.push((n || u)[1]); continue; }
    if (list) flushL();
    para.push(l);
  }
  flushP(); flushL();
  return h('div', { class: 'law-text' }, out);
}

// ── the form: draft a law (or an amendment), for Parliament or a referendum ──
export function lawForm(api, { amend = null, onDone = null } = {}) {
  const { h, state, params, me } = api;
  const T = types(params), uid = Math.random().toString(36).slice(2, 7), $ = (id) => form.querySelector(`#${id}-${uid}`);
  const cur = amend ? amend.versions.at(-1) : null;
  const allTags = [...new Set(Object.values(state.m.laws?.laws || {}).flatMap(l => l.tags || []))].sort();
  const B = bodies(state);
  const changes = { ...(cur?.changes || {}) };
  const held = new Set(amend ? governs(state, amend.id) : []); // settings this law governs: an amendment keeps them
  const setBy = (k) => state.m.laws?.settings?.[k]?.law || null;
  const isMP = me && members(state, params).includes(me.id);
  const box = (name, chosen) => h('div', { class: 'checks' }, B.map(([id, label]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `${name}-${uid}`, value: id, checked: chosen?.includes(id) || null }), label)));
  const typeSel = h('select', { id: `ty-${uid}` }, T.map(t => h('option', { value: t.id, selected: (cur?.type || 'statutory') === t.id || null }, t.title)));
  const levelSel = h('select', { id: `lv-${uid}` });
  const rows = h('div', { class: 'param-rows' });
  const keySel = h('select', { id: `pk-${uid}` }, h('option', { value: '' }, 'Choose a setting…'), params.keys().filter(k => k !== 'entity.modules' && params.rule(k)?.changeable !== false).sort().map(k => h('option', { value: k }, `${k} (${params.rule(k).name})`)));
  const valIn = h('input', { id: `pv-${uid}`, placeholder: 'new value' });
  const ruleLine = h('p', { class: 'fine', role: 'status' });
  const draw = () => {
    const t = typeOf(params, typeSel.value), lv = Array.isArray(t?.levels) ? t.levels : [];
    const keep = levelSel.value || cur?.level || '';
    levelSel.replaceChildren(...(t?.level_required ? [] : [h('option', { value: '' }, lv.length ? 'No level' : '—')]), ...lv.map(x => h('option', { value: x, selected: keep === x || null }, typeOf(params, x)?.title || x)));
    levelSel.disabled = !lv.length;
    $('tdesc').textContent = t?.describe || '';
    $('params').hidden = !t?.changes;
    rows.replaceChildren(...Object.entries(changes).map(([k, v]) => h('div', { class: 'row' }, h('code', {}, k), ` = ${JSON.stringify(v)} (now ${JSON.stringify(params.value(k))}${setBy(k) && setBy(k) !== amend?.id ? `, set by ${state.m.laws.laws[setBy(k)]?.title || setBy(k)}` : ''})`,
      held.has(k) ? h('span', { class: 'fine' }, ' · governed by this law, so it stays') : h('button', { class: 'quiet', type: 'button', onclick: () => { delete changes[k]; draw(); } }, 'Remove'))));
    const d = read(true);
    const rule = amend && params.rank(lawRule(params, amend)) > params.rank(ruleOf(params, d)) ? lawRule(params, amend) : ruleOf(params, d);
    const alone = params.rank(rule) <= params.rank(params.value('laws.parliament_max_rule'));
    ruleLine.textContent = `Needs the ${rule} majority: ${majorityWords(params, rule)}. ${alone ? 'Parliament can pass it, after which citizens can petition for a referendum.' : 'Parliament can pass it, but it takes effect only if the citizens approve it in a referendum.'}`;
  };
  const read = (quiet) => {
    const title = $('ti').value.trim();
    const d = { law: amend ? amend.id : slug($('id').value || title), title, text: $('tx').value, type: typeSel.value,
      ...(levelSel.value ? { level: levelSel.value } : {}),
      tags: $('tg').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      enforcers: [...form.querySelectorAll(`input[name="en-${uid}"]:checked`)].map(i => i.value),
      subjects: [...form.querySelectorAll(`input[name="su-${uid}"]:checked`)].map(i => i.value),
      ...(typeOf(params, typeSel.value)?.changes && Object.keys(changes).length ? { changes: { ...changes } } : {}),
      ...($('no').value.trim() ? { note: $('no').value.trim() } : {}) };
    if (!quiet && !d.title) throw new Error('give the law a title');
    return d;
  };
  const parse = (k, v) => {
    const t = params.def(k).type;
    if (t === 'integer' || t === 'number' || t === 'fraction') return Number(v);
    if (t === 'boolean') return /^(true|yes|on|1)$/i.test(v);
    if (t === 'list') { try { return JSON.parse(v); } catch { return v.split(',').map(s => s.trim()).filter(Boolean); } }
    return v;
  };
  const form = h('div', { class: 'inline-form law-form' },
    h('label', { for: `ti-${uid}` }, 'Title'), h('input', { id: `ti-${uid}`, value: cur?.title || '', placeholder: 'The Public Records Act', maxlength: 160 }),
    amend ? null : [h('label', { for: `id-${uid}` }, 'Id (part of its web address; made from the title if left empty)'), h('input', { id: `id-${uid}`, placeholder: 'public-records-act' })],
    h('label', { for: `ty-${uid}` }, 'Type of law'), typeSel, h('p', { class: 'fine', id: `tdesc-${uid}` }),
    h('label', { for: `lv-${uid}` }, 'Level'), levelSel,
    h('label', { for: `tg-${uid}` }, 'Tags, separated by commas'), h('input', { id: `tg-${uid}`, value: (cur?.tags || []).join(', '), list: `tl-${uid}`, placeholder: 'elections, transparency' }), h('datalist', { id: `tl-${uid}` }, allTags.map(t => h('option', { value: t }))),
    h('fieldset', {}, h('legend', {}, 'Who enforces it'), box('en', cur?.enforcers)),
    h('fieldset', {}, h('legend', {}, 'Who it applies to'), box('su', cur?.subjects)),
    h('div', { id: `params-${uid}` }, h('label', { for: `pk-${uid}` }, 'Settings it changes'), rows,
      h('div', { class: 'row' }, keySel, valIn, h('button', { class: 'quiet', type: 'button', onclick: () => { const k = keySel.value; if (!k || valIn.value === '') return; const v = parse(k, valIn.value); const why = params.check(k, v); if (why) return alert(why); changes[k] = v; valIn.value = ''; draw(); } }, 'Add')),
      h('p', { class: 'fine', id: `pd-${uid}` })),
    h('label', { for: `tx-${uid}` }, 'Text (start a line with ## for a heading, or 1. for a numbered clause)'), h('textarea', { id: `tx-${uid}`, rows: 10 }, cur?.text || ''),
    h('label', { for: `no-${uid}` }, amend ? 'What the amendment changes (published)' : 'Note (optional, published)'), h('input', { id: `no-${uid}`, maxlength: 300 }),
    ruleLine,
    me?.status === 'active' ? h('div', { class: 'buttons' },
      isMP ? h('button', { type: 'button', onclick: async () => { try { const d = read(); const bill = `${d.law}-${Date.now().toString(36)}`; if (await api.sign('law.bill', { bill, action: 'enact', ...d }, `Your bill: ${d.title}`)) onDone?.(d, { parliament: bill }); } catch (e) { alert(e.message); } } }, 'Introduce it in Parliament') : null,
      h('button', { class: isMP ? 'quiet' : '', type: 'button', onclick: async () => { try { const d = read(); if (await api.propose(`${amend ? 'Amend' : 'Enact'} ${d.title} (by referendum)`, [{ kind: 'law.enact', ...d }], d.note)) onDone?.(d, { referendum: true }); } catch (e) { alert(e.message); } } }, 'Put it to a referendum')) : h('p', { class: 'hint' }, 'Sign in to propose it.'));
  typeSel.addEventListener('change', draw); levelSel.addEventListener('change', draw);
  keySel.addEventListener('change', () => { const k = keySel.value; $('pd').textContent = k ? `${params.def(k).describe || ''} Now ${JSON.stringify(params.value(k))}; changed by the ${params.def(k).changed_by} rule.` : ''; });
  draw();
  return form;
}

// ── Parliament ───────────────────────────────────────────────────────────
function parliament(api, path) {
  const { h, state, params, me, day, when, who } = api;
  if (path[0]) return oneBill(api, path[0]);
  const now = new Date().toISOString();
  const mps = members(state, params), isMP = me && mps.includes(me.id);
  const bills = Object.values(state.m.laws?.bills || {}).sort((a, b) => (a.at < b.at ? 1 : -1));
  const groups = [['open', 'Being voted on in Parliament'], ['window', 'Passed, open to petition'], ['referendum', 'Waiting for a referendum']];
  const sec = h('section', {}, h('h2', {}, 'Parliament'),
    h('p', { class: 'hint' }, `Members of Parliament introduce bills and vote on them. A bill they pass takes effect after ${params.value('laws.petition_days')} days, unless ${Math.round(params.value('laws.petition_share') * 100)}% of citizens petition for a referendum. Any citizen can also put a law straight to a referendum. Laws that need more than the ${params.value('laws.parliament_max_rule')} majority always go to the citizens.`),
    h('p', { class: 'meta' }, `Members (${mps.length}): `, mps.length ? mps.map((id, i) => [i ? ', ' : '', who(id)]) : 'none yet'));
  for (const [status, title] of groups) {
    const list = bills.filter(b => b.status === status);
    if (!list.length) continue;
    sec.append(h('h3', {}, title), h('ul', { class: 'items' }, list.map(b => billItem(api, b, now, isMP))));
  }
  const done = bills.filter(b => !groups.some(([s]) => s === b.status));
  if (done.length) sec.append(h('details', {}, h('summary', {}, `Decided bills (${done.length})`), h('ul', { class: 'items' }, done.map(b => billItem(api, b, now, false)))));
  if (!bills.length) sec.append(h('p', { class: 'hint' }, 'No bills yet.'));
  sec.append(h('details', { class: 'propose' }, h('summary', {}, 'Draft a new law'), lawForm(api)));
  void day; void when;
  return sec;
}

function billItem(api, b, now, isMP) {
  const { h, state, params, me, day, who, link } = api;
  const t = tally(params, b), mine = me && b.votes?.[me.id];
  const what = b.action === 'repeal' ? `Repeal ${state.m.laws?.laws?.[b.law]?.title || b.law}` : b.title;
  return h('li', {}, h('h3', {}, link(`parliament/${b.id}`, what), h('span', { class: 'category' }, b.action === 'repeal' ? 'repeal' : typeLabel(params, b))),
    h('p', { class: 'meta' }, 'introduced by ', who(b.by), ` · ${day(b.at)} · ${b.rule} rule${b.refer ? ' · goes to referendum' : ''} · ${t.for} for, ${t.against} against, ${t.abstain} abstaining of ${t.roll}`),
    b.status === 'open' ? h('div', { class: 'buttons' },
      isMP && b.roll.includes(me.id) ? ['for', 'against', 'abstain'].map(c => h('button', { class: mine === c ? '' : 'quiet', onclick: () => api.sign('law.vote', { bill: b.id, choice: c }, `Your vote ${c} "${what}"`) }, c === 'abstain' ? 'Abstain' : `Vote ${c}`)) : null,
      me?.status === 'active' && (now > b.closes || t.certain) ? h('button', { class: 'quiet', onclick: () => api.sign('law.close', { bill: b.id }, `Closing the vote on "${what}"`) }, 'Close the vote') : h('span', { class: 'fine' }, ` open until ${day(b.closes)}`)) : null,
    b.status === 'window' ? h('div', { class: 'buttons' },
      h('span', { class: 'fine' }, `${Object.keys(b.petitions).length} of ${petitionsNeeded(state, params)} petitions · comes into force after ${day(b.window)} `),
      me?.status === 'active' && now <= b.window && !b.petitions[me.id] ? h('button', { class: 'quiet', onclick: () => api.sign('law.petition', { bill: b.id }, `Petitioning for a referendum on "${what}"`) }, 'Petition for a referendum') : null,
      me?.status === 'active' && now > b.window ? h('button', { onclick: () => api.sign('law.promulgate', { bill: b.id }, `Bringing "${what}" into force`) }, 'Bring it into force') : null) : null,
    b.status === 'referendum' ? h('div', { class: 'buttons' }, h('span', { class: 'fine' }, `${b.referred || 'referred'}. `),
      me?.status === 'active' ? h('button', { onclick: () => api.propose(`Referendum: ratify "${what}"`, [{ kind: 'law.ratify', bill: b.id, rule: b.rule }]) }, 'Call the referendum') : null) : null,
    b.status === 'failed' ? h('p', { class: 'state-failed' }, 'Not passed.') : null,
    b.status === 'in force' ? h('p', { class: 'state-carried' }, `In force since ${day(b.inForce)}.`) : null);
}

function oneBill(api, id) {
  const { h, state, params, who, when, link } = api;
  const b = state.m.laws?.bills?.[id];
  if (!b) return h('section', {}, h('h2', {}, 'No such bill'), link('parliament', 'Parliament'));
  const t = tally(params, b);
  return h('section', {}, h('p', { class: 'fine' }, link('parliament', 'Parliament'), ' › ', id),
    h('h2', {}, b.action === 'repeal' ? `Repeal ${b.law}` : b.title),
    h('p', { class: 'meta' }, 'introduced by ', who(b.by), ` · ${when(b.at)} · ${b.rule} rule · status: ${b.status}`),
    b.action === 'enact' ? lawFacts(api, b) : h('p', {}, `Reason: ${b.reason}`),
    b.action === 'enact' && b.text ? text(h, b.text) : null,
    h('h3', {}, 'Votes'), h('p', {}, `${t.for} for · ${t.against} against · ${t.abstain} abstaining · of ${t.roll} members (quorum ${t.quorumNeeded}, threshold ${Math.round((t.threshold || 0.5) * 100)}%)`),
    h('ul', {}, Object.entries(b.votes).map(([m, c]) => h('li', {}, who(m), `: ${c}`))),
    Object.keys(b.petitions || {}).length ? [h('h3', {}, 'Petitions'), h('p', {}, Object.keys(b.petitions).map((m, i) => [i ? ', ' : '', who(m)]))] : null);
}

function lawFacts(api, l) {
  const { h, state, params } = api;
  const changes = l.changes || {};
  return h('dl', { class: 'facts' },
    h('dt', {}, 'Type'), h('dd', {}, typeLabel(params, l)),
    h('dt', {}, 'Tags'), h('dd', {}, (l.tags || []).map(t => h('span', { class: 'badge' }, t))),
    h('dt', {}, 'Enforced by'), h('dd', {}, (l.enforcers || []).map(x => bodyName(state, x)).join(', ')),
    h('dt', {}, 'Applies to'), h('dd', {}, (l.subjects || []).map(x => bodyName(state, x)).join(', ')),
    Object.keys(changes).length ? [h('dt', {}, 'Sets'), h('dd', {}, Object.entries(changes).map(([k, v]) => h('div', {}, h('code', {}, k), ` = ${JSON.stringify(v)}`)))] : null);
}

// ── the statute book: every law, by type, tag and body ─────────────────────
function statutes(api, path) {
  const { h, state, params, me, day } = api;
  if (path[0]) return oneLaw(api, path[0]);
  const all = Object.values(state.m.laws?.laws || {});
  const tags = [...new Set(all.flatMap(l => l.tags || []))].sort();
  const B = bodies(state).filter(([id]) => all.some(l => [...(l.enforcers || []), ...(l.subjects || [])].includes(id)));
  return h('section', {}, h('h2', {}, 'Statute book'),
    h('p', { class: 'hint' }, `${all.filter(inForce).length} laws in force. Every law has a type, tags, and the bodies it concerns; find them by any of these.`),
    api.list({ key: 'statutes', items: all, noun: 'laws', empty: 'No laws yet.',
      text: (l) => `${l.id} ${l.title} ${(l.tags || []).join(' ')} ${l.versions.at(-1).text}`,
      sorts: [['Constitutional first', (a, b) => params.rank(ruleOf(params, b)) - params.rank(ruleOf(params, a)) || a.title.localeCompare(b.title)], ['Title, A–Z', api.sorts.byText((l) => l.title)], ['Newest first', api.sorts.newest((l) => l.since)]],
      filters: [{ label: 'Status', options: [['In force', inForce], ['Repealed', (l) => l.status === 'repealed'], ['Every law', () => true]] },
        { label: 'Type', options: [['Every type', () => true], ...types(params).map(t => [t.title, (l) => l.type === t.id || l.level === t.id])] },
        { label: 'Tag', options: [['Every tag', () => true], ...tags.map(t => [t, (l) => (l.tags || []).includes(t)])] },
        { label: 'Body', options: [['Every body', () => true], ...B.flatMap(([id, label]) => [[`Enforced by ${label}`, (l) => (l.enforcers || []).includes(id)], [`Applies to ${label}`, (l) => (l.subjects || []).includes(id)]])] }],
      render: (l) => h('li', {}, h('h3', {}, api.link(`statutes/${l.id}`, l.title), h('span', { class: 'category' }, typeLabel(params, l))),
        h('p', { class: 'meta' }, `${l.status === 'in force' ? `in force since ${day(l.since)}` : `repealed ${day(l.repealed?.at)}`} · version ${l.versions.length} · `, (l.tags || []).join(', '))) }),
    me?.status === 'active' ? h('details', { class: 'propose' }, h('summary', {}, 'Draft a new law'), lawForm(api)) : null);
}

function oneLaw(api, id) {
  const { h, state, params, me, day, link } = api;
  const l = state.m.laws?.laws?.[id];
  if (!l) return h('section', {}, h('h2', {}, 'No such law'), link('statutes', 'The statute book'));
  const v = l.versions.at(-1), rule = ruleOf(params, l);
  const isMP = me && members(state, params).includes(me.id);
  return h('section', {}, h('p', { class: 'fine' }, link('statutes', 'Statute book'), ' › ', typeLabel(params, l)),
    h('h2', {}, l.title),
    h('p', { class: l.status === 'in force' ? 'state-carried' : 'flag' }, l.status === 'in force' ? `In force since ${day(l.since)} · version ${v.n} · by ${v.via}` : `Repealed ${day(l.repealed.at)} · by ${l.repealed.via}${l.repealed.reason ? ` (${l.repealed.reason})` : ''}`),
    lawFacts(api, v), v.changed ? h('p', { class: 'fine' }, 'Changed: ', v.changed.map(c => `${c.key} from ${JSON.stringify(c.from)} to ${JSON.stringify(c.to)}`).join('; ')) : null,
    text(h, v.text),
    h('h3', {}, 'History'), h('ol', { reversed: true }, l.versions.slice().reverse().map(x => h('li', {}, `Version ${x.n}, ${day(x.at)}, by ${x.via}${x.note ? `: ${x.note}` : ''}`))),
    inForce(l) && me?.status === 'active' ? [h('details', { class: 'propose' }, h('summary', {}, 'Propose an amendment'), lawForm(api, { amend: l })),
      h('div', { class: 'buttons' },
        isMP ? h('button', { class: 'quiet', onclick: () => { const r = prompt('Why should it be repealed? This is published.'); if (r) api.sign('law.bill', { bill: `repeal-${id}-${Date.now().toString(36)}`, action: 'repeal', law: id, reason: r }, `Your bill to repeal ${l.title}`); } }, 'Introduce a bill to repeal it') : null,
        h('button', { class: 'danger', onclick: () => { const r = prompt('Why should it be repealed? This is published.'); if (r) api.propose(`Repeal ${l.title} (by referendum)`, [{ kind: 'law.repeal', law: id, rule, reason: r }]); } }, 'Put its repeal to a referendum'))] : null);
}
