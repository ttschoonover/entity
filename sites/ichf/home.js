// home.js · the ICHF's front page: the federation and its national federations
// on one bilingual page. The street (a house per member, by federation), each
// national federation in its own names and languages, the labor credit, the
// open votes of all of them, the officers and committees, and the founding
// texts. Every record is fetched from its own node and verified here.
import { start, onChange, onSigned, ctx, h, $, joinDialog, signInDialog, withEntity, toast, E, day } from './common.js';
import { drawOpen } from './floor.js';
import { lockSeed, unlockSeed } from './interface/js/lock.js';
import * as K from './interface/js/keystore.js';
import { t, lang, setLang, names, officialLanguages, half, LANGS } from './i18n.js';

const fed = () => ctx.all[0];
const nationals = () => ctx.all.slice(1);
const hue = (i) => `var(--f${i % 4})`;
const now = () => new Date().toISOString();
const active = (x) => x.r.state.order.filter(id => x.r.state.participants[id].status === 'active');
const person = (x, id) => { const tt = x.r.state.m.titles?.[id]; return (typeof tt === 'string' ? tt : tt?.title) || x.r.state.participants[id]?.name || id; };
const holders = (x, office) => { const o = x.r.state.m.offices?.[office]; return !o || o.abolished ? [] : o.holders.filter(k => !k.until || k.until > now()).map(k => k.id); };
const known = (x) => (fed().r?.ok && x.r?.ok ? Object.values(fed().r.state.m.federation?.states || {}).find(s => s.entity === x.r.state.entity.id && !s.released) || null : null);
const myId = () => ctx.all.find(x => x.ident)?.ident.id || null;
const fedMod = () => fed().registry.modules.get('federation');
const fmt = (n) => (n / 100).toLocaleString(lang() === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unit = () => (lang() === 'fr' ? 'CT' : 'LC');

// ── the language switch, in the masthead ────────────────────────────────────
function drawSwitch() {
  const m = document.querySelector('.masthead'); if (!m) return;
  let sw = m.querySelector('.lang-switch');
  if (!sw) { sw = h('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Language · Langue' }); m.append(sw); }
  sw.replaceChildren(...['en', 'fr'].map(l => h('button', { type: 'button', 'aria-pressed': String(lang() === l), lang: l, onclick: () => { setLang(l); draw(); } }, l === 'en' ? 'EN' : 'FR')));
}
function drawStrings() { for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t); document.documentElement.lang = lang(); relabel(); }
// The masthead's links and the brand, in the reader's language.
const NAV = { Federations: 'Fédérations', 'Labor credits': 'Crédits de travail', Votes: 'Votes', Wiki: 'Wiki', Letters: 'Lettres', Chat: 'Discussion', Institutions: 'Institutions', 'Sign in': 'Se connecter', 'Sign out': 'Se déconnecter' };
export function relabel() {
  for (const a of document.querySelectorAll('.masthead nav a, .masthead nav button, .masthead .who a, .masthead .who button')) {
    if (a.closest('#entities')) continue;
    const en = a.dataset.en || a.textContent.trim(); if (!(en in NAV)) continue;
    a.dataset.en = en; a.textContent = lang() === 'fr' ? NAV[en] : en;
  }
  if (fed()?.r?.ok) { const n = names(fed().r); const b = document.getElementById('brand-name'), m = document.getElementById('brand-motto'); if (b) b.textContent = n.name; if (m) m.textContent = n.motto; }
}

// ── certifying and enrolling (as on the federation site) ────────────────────
function askPassword(title, text) {
  return new Promise((resolve) => {
    const input = h('input', { id: 'fd-pw', type: 'password', autocomplete: 'current-password', required: true });
    const form = h('form', { method: 'dialog' }, h('h2', {}, title), h('p', { class: 'fine' }, text), h('label', { for: 'fd-pw' }, lang() === 'fr' ? 'Votre mot de passe' : 'Your password'), input,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, lang() === 'fr' ? 'Signer et envoyer' : 'Sign and send'), h('button', { class: 'secondary', type: 'button', onclick: () => { d.close(); resolve(null); } }, lang() === 'fr' ? 'Annuler' : 'Cancel')));
    const d = h('dialog', { class: 'site-dialog' }, form); document.body.append(d); d.showModal();
    d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = input.value; d.close(); resolve(v); });
  });
}
async function send(base, act) {
  const res = await fetch(new URL('acts', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(act) });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.refused?.length || b.why) throw new Error(b.refused?.[0]?.why || b.why || `the node answered ${res.status}`);
}
function report(x) {
  const citizens = {};
  for (const id of active(x)) citizens[id] = [...x.r.state.participants[id].keys];
  return { citizens, senate: holders(x, 'federal-senator'), assembly: holders(x, 'federal-deputy') };
}
function outOfDate(x) {
  const s = known(x); if (!s) return false;
  const c = s.certified, r = report(x); if (!c) return true;
  const norm = (o) => JSON.stringify(Object.keys(o).sort().map(k => [k, [...o[k]].sort()]));
  return norm(c.citizens) !== norm(r.citizens) || [...c.senate].sort().join() !== [...r.senate].sort().join() || [...c.assembly].sort().join() !== [...r.assembly].sort().join();
}
async function certify(x) {
  const s = known(x), ident = x.ident;
  let seed = ident.seed;
  if (!seed) {
    const pw = await askPassword(t('report'), `${names(x.r).acronym}: ${active(x).length} ${t('members').toLowerCase()}.`);
    if (!pw) return;
    try { seed = await unlockSeed(ident.locked, pw); } catch { toast('Wrong password · Mot de passe incorrect', true); return; }
  }
  try {
    const act = await E.makeActWith(fed().registry, fed().r.state, 'state.certify',
      { by: s.id, key: E.keys.publicKeyLine(ident.publicKey), state: s.id, count: x.r.records.length, head: x.r.head, ...report(x) }, (m, ns) => E.keys.sign(m, { seed, publicKey: ident.publicKey }, ns));
    await send(fed().r.base, act); toast('✓');
  } catch (e) { toast(e.message, true); }
}
async function enroll(x) {
  const id = x.ident.id, s = known(x);
  const pw = await askPassword(t('enroll'), lang() === 'fr' ? 'Votre clé à la FIHC est faite du même mot de passe ; votre clé dans votre fédération nationale prouve que c’est vous.' : 'Your ICHF key is made from the same password; your key in your national federation proves it is you.');
  if (!pw) return;
  try {
    const sk = await E.passwordKey(x.r.state.entity.id, id, pw);
    if (!x.r.state.participants[id].keys.includes(E.keys.keyId(E.keys.publicKeyLine(sk.publicKey)))) throw new Error('wrong password · mot de passe incorrect');
    const fk = await E.passwordKey(fed().r.state.entity.id, id, pw), line = E.keys.publicKeyLine(fk.publicKey), F = fedMod();
    const state_sig = await E.keys.sign(F.enrollMaterial({ entity: fed().r.state.entity.id, id, key: E.keys.keyId(line) }), sk, F.NS);
    const act = await E.makeActWith(fed().registry, fed().r.state, 'citizen.enroll', { by: id, key: line, state: s.id, state_key: E.keys.publicKeyLine(sk.publicKey), state_sig }, (m, ns) => E.keys.sign(m, fk, ns));
    await send(fed().r.base, act);
    fed().ident = { id, publicKey: fk.publicKey, locked: await lockSeed(fk.seed, pw), via: 'password', created: now() };
    if (ctx.key === fed().key) ctx.ident = fed().ident;
    await K.saveIdentity(fed().r.state.entity.id, fed().ident).catch(() => {});
    toast('✓');
  } catch (e) { toast(e.message, true); }
}

// ── the front: names, and the street ────────────────────────────────────────
function drawFront() {
  if (!fed().r?.ok) return;
  const here = names(fed().r), other = names(fed().r, lang() === 'fr' ? 'en' : 'fr');
  $('#acronyms').textContent = `${here.acronym} · ${other.acronym}`;
  $('#name').textContent = here.name; $('#name').lang = here.lang;
  $('#other-name').textContent = other.name; $('#other-name').lang = other.lang;
  $('#motto').textContent = here.motto;
  document.title = `${here.acronym} · ${other.acronym}`;
  const me = myId(), mine = me ? nationals().find(x => x.r?.ok && x.r.state.participants[me]?.status === 'active') : null;
  const inFed = me && fed().r.state.participants[me]?.status === 'active';
  $('#who-note').textContent = !me ? t('newHere') : mine ? `${t('signedAs')} ${person(mine, me)}, ${t('memberOf')} ${names(mine.r).acronym}${inFed ? ` · ${here.acronym}` : ` (${t('notEnrolled')})`}.` : `${t('signedAs')} ${me}.`;
  $('#hero-actions').replaceChildren(...(me ? [h('a', { class: 'primary', href: '#votes' }, t('votes')), h('a', { class: 'secondary', href: '#credits' }, t('credits'))]
    : [h('a', { class: 'primary', href: '#federations' }, t('join')), h('button', { class: 'secondary', type: 'button', onclick: async () => { if (await signInDialog()) draw(); } }, t('signin'))]));
}

// A row of gabled houses: one per member of each national federation, and an
// empty one at the end. Drawn small and many, like a street seen from across it.
function drawStreet() {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  const houses = [];
  nationals().forEach((x, i) => { if (x.r?.ok) for (const id of active(x)) houses.push({ c: hue(i), t: `${person(x, id)} · ${names(x.r).acronym}` }); });
  houses.push({ c: null, t: lang() === 'fr' ? 'Pour le prochain membre' : 'For whoever joins next' });
  const n = Math.max(houses.length, 12), per = Math.min(14, Math.max(6, Math.ceil(Math.sqrt(n * 2.2)))), rows = Math.ceil(n / per);
  const W = 30, G = 6, H = 34;
  svg.setAttribute('viewBox', `0 0 ${per * (W + G) + G} ${rows * (H + 14) + 8}`);
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / per), c = k % per, x = G + c * (W + G), y = 8 + r * (H + 14), hs = houses[k];
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', `house${!hs ? ' lot' : hs.c ? '' : ' next'}`);
    if (hs?.c) g.style.setProperty('--h', hs.c);
    const body = document.createElementNS(NS, 'path');
    body.setAttribute('d', `M${x} ${y + 13} L${x + W / 2} ${y} L${x + W} ${y + 13} L${x + W} ${y + H} L${x} ${y + H} Z`);
    const door = document.createElementNS(NS, 'rect');
    door.setAttribute('x', x + W / 2 - 3.5); door.setAttribute('y', y + H - 11); door.setAttribute('width', 7); door.setAttribute('height', 11); door.setAttribute('class', 'door');
    const tt = document.createElementNS(NS, 'title'); tt.textContent = hs ? hs.t : '';
    g.append(body, door, tt);
    if (k < 40 && !matchMedia('(prefers-reduced-motion: reduce)').matches) g.style.animationDelay = `${k * 25}ms`;
    svg.append(g);
  }
  const ground = document.createElementNS(NS, 'path');
  for (let r = 0; r < rows; r++) { const l = document.createElementNS(NS, 'line'); const y = 8 + r * (H + 14) + H + .5; l.setAttribute('x1', 0); l.setAttribute('x2', per * (W + G) + G); l.setAttribute('y1', y); l.setAttribute('y2', y); l.setAttribute('class', 'ground'); svg.append(l); }
  void ground;
  $('#street').replaceChildren(svg);
  $('#street').setAttribute('aria-label', `${houses.length - 1} ${t('members').toLowerCase()}`);
  $('#street-key').replaceChildren(...nationals().map((x, i) => x.r?.ok ? h('li', {}, h('i', { style: `background:${hue(i)}` }), `${names(x.r).acronym} · ${active(x).length}`) : null).filter(Boolean));
}

// ── national federations ────────────────────────────────────────────────────
function drawFeds() {
  const me = myId(), mineAny = me ? nationals().find(x => x.r?.ok && x.r.state.participants[me]) : null;
  const seats = fed().r?.ok ? fedMod().seatsOf(fed().r.state, fed().r.params) : {};
  $('#fed-cards').replaceChildren(...nationals().map((x, i) => {
    if (!x.r?.ok) return h('article', { class: 'fed', style: `--h:${hue(i)}` }, h('h3', {}, x.label || x.key), h('p', { class: 'note' }, t('unreachable')));
    const own = names(x.r), shown = names(x.r, lang()), langs = officialLanguages(x.r);
    const s = known(x), c = s?.certified, mine = me && x.r.state.participants[me];
    const enrolled = c ? Object.keys(c.citizens).filter(id => fed().r.state.participants[id]?.status === 'active').length : 0;
    const isRegistrar = s && x.ident && s.keys.includes(E.keys.keyId(E.keys.publicKeyLine(x.ident.publicKey)));
    const canEnroll = mine?.status === 'active' && c?.citizens?.[me] && fed().r.state.participants[me]?.status !== 'active';
    const open = x.r.get('proposals').length;
    const actions = [h('a', { class: 'secondary', href: `national.html?e=${encodeURIComponent(x.key)}` }, t('itsPage'))];
    if (open) actions.push(h('a', { class: 'secondary', href: `hall.html?e=${encodeURIComponent(x.key)}#/proposals` }, `${open} ${t('openVotes')}`));
    if (!mineAny) actions.push(h('button', { class: 'primary', type: 'button', onclick: async () => { if (await withEntity(x.key, joinDialog)) draw(); } }, t('apply')));
    if (canEnroll) actions.push(h('button', { class: 'primary', type: 'button', onclick: () => enroll(x) }, t('enroll')));
    if (isRegistrar && outOfDate(x)) actions.push(h('button', { class: 'primary', type: 'button', onclick: () => certify(x) }, t('report')));
    return h('article', { class: 'fed', style: `--h:${hue(i)}` },
      h('p', { class: 'fed-acronym' }, own.acronym),
      h('h3', { lang: shown.lang }, shown.name),
      shown.name !== own.name ? h('p', { class: 'fed-own', lang: own.lang }, own.name) : null,
      own.motto ? h('p', { class: 'fed-motto', lang: shown.lang }, shown.motto || own.motto) : null,
      h('dl', {},
        h('dt', {}, t('languages')), h('dd', {}, h('span', { class: 'langs' }, langs.map((l, k) => h('span', { class: `lang-chip${k === 0 ? ' first' : ''}`, title: LANGS[l] || l }, l.toUpperCase())))),
        h('dt', {}, t('members')), h('dd', {}, `${active(x).length}${c ? ` · ${enrolled} ${t('inIchf')}` : ''}`),
        h('dt', {}, t('chair')), h('dd', {}, holders(x, 'chair').map(id => person(x, id)).join(', ') || '—'),
        h('dt', {}, t('council')), h('dd', {}, holders(x, 'federal-senator').map(id => person(x, id)).join(', ') || '—'),
        h('dt', {}, t('assembly')), h('dd', {}, s ? String(seats[s.id] || 0) : '—')),
      s ? h('p', { class: 'note' }, outOfDate(x) ? t('stale') : t('matches')) : null,
      h('div', { class: 'actions' }, actions));
  }));
}

// ── labor credits ───────────────────────────────────────────────────────────
function drawCredits() {
  if (!fed().r?.ok) return;
  const st = fed().r.state, v = st.m.value || { balances: {}, supply: 0 };
  const holdersN = Object.entries(v.balances).filter(([k, b]) => b > 0 && !k.startsWith('committee:')).length;
  const me = myId(), mine = me && st.participants[me]?.status === 'active' ? v.balances[me] || 0 : null;
  const hours = Object.values(st.m.tasks?.hours || {}).reduce((a, b) => a + b, 0);
  $('#ledger').replaceChildren(
    h('div', { class: 'figure' }, h('b', {}, fmt(v.supply || 0)), h('span', {}, `${unit()} ${t('circulation')}`)),
    h('div', { class: 'figure' }, h('b', {}, String(holdersN)), h('span', {}, t('holders'))),
    h('div', { class: 'figure' }, h('b', {}, (Math.round(hours * 100) / 100).toLocaleString()), h('span', {}, t('hours'))),
    ...(mine !== null ? [h('div', { class: 'figure mine' }, h('b', {}, fmt(mine)), h('span', {}, `${unit()} · ${t('yours')}`))] : []));
  const open = Object.values(st.m.tasks?.items || {}).filter(x => !x.cancelled && !x.claimer && !x.done);
  $('#work').replaceChildren(...(open.length ? open.slice(0, 6).map(x => h('li', {}, h('a', { href: `hall.html#/tasks/${encodeURIComponent(x.id)}` }, x.title), h('span', { class: 'fine' }, ` ${x.hours} h · ${fmt(x.hours * 100)} ${unit()}`)))
    : [h('li', { class: 'empty' }, t('noWork'))]), h('li', { class: 'links' }, h('a', { href: 'hall.html#/tasks' }, t('allWork')), ' · ', h('a', { href: 'hall.html#/value' }, t('send')), ' · ', h('a', { href: 'hall.html#/wiki/labor-credit-statute' }, t('statute'))));
  $('#credit-def').replaceChildren(h('p', { class: 'equation' }, h('span', {}, `${fmt(100)} ${unit()}`), h('span', { class: 'eq' }, '='), h('span', {}, lang() === 'fr' ? '1 heure de travail coopératif' : '1 hour of co-operative work')),
    h('p', { class: 'fine' }, lang() === 'fr' ? 'Cuisine, ménage, réparations, comptabilité, soin : une heure vaut une heure. Les maisons et les fédérations nationales peuvent tenir leurs propres unités ; le Comité de compensation publie chaque année leurs taux de conversion.'
      : 'Cooking, cleaning, repairs, bookkeeping, care: an hour is an hour. Houses and national federations may keep units of their own; the Clearing Committee publishes their conversion rates each year.'));
}

// ── votes, officers, texts ──────────────────────────────────────────────────
function drawVotes() {
  $('#votes-by').replaceChildren(...ctx.all.filter(x => x.r?.ok).map((x, i) => {
    const box = h('div', { class: 'bills' });
    drawOpen(box, { key: x.key, empty: t('nothingOpen') });
    return h('div', { class: 'vote-group', style: i ? `--h:${hue(i - 1)}` : '' }, h('h3', {}, i ? names(x.r).acronym + ' · ' + names(x.r, lang()).name : `${names(x.r).acronym}: ${t('councilAssembly')}`), box);
  }));
}
function drawOfficers() {
  if (!fed().r?.ok) return;
  const x = fed(), st = x.r.state;
  const offices = Object.values(st.m.offices || {}).filter(o => !o.abolished);
  const committees = Object.values(st.m.committees || {}).filter(c => !c.dissolved);
  const live = (l) => l.filter(m => !m.until || m.until > now()).map(m => m.id);
  $('#officer-list').replaceChildren(
    ...offices.map(o => h('div', { class: 'officer' }, h('h3', {}, half(o.title)), h('p', {}, live(o.holders).map(id => person(x, id)).join(', ') || h('span', { class: 'vacant' }, t('vacant'))))),
    ...committees.map(c => h('div', { class: 'officer committee' }, h('h3', {}, half(c.title)), h('p', {}, live(c.members).map(id => person(x, id)).join(', ') || h('span', { class: 'vacant' }, t('notAppointed'))))));
  const elections = Object.values(st.m.elections || {}).filter(e => !e.counted);
  const title = Object.fromEntries(offices.map(o => [o.id, half(o.title)]));
  $('#elections').replaceChildren(...(elections.length ? [h('h3', {}, t('elections')), ...elections.map(e => {
    const phase = now() <= e.standUntil ? 'stand' : now() <= e.voteUntil ? 'vote' : 'count';
    const cands = Object.keys(e.candidates);
    return h('p', {}, h('b', {}, `${title[e.office] || e.office}. `),
      phase === 'stand' ? `${t('nominations')} ${day(e.standUntil)}. ${t('standing')}: ${cands.map(c => person(x, c)).join(', ') || t('noOne')}. ` : phase === 'vote' ? `${t('votingCloses')} ${day(e.voteUntil)}. ` : '',
      h('a', { href: `hall.html#/elections/${encodeURIComponent(e.id)}` }, t(phase)));
  })] : []));
}
function drawTexts() {
  if (!fed().r?.ok) return;
  const st = fed().r.state, pages = st.m.wiki?.pages || {};
  const pair = [['constitution', 'en'], ['constitution-fr', 'fr'], ['labor-credit-statute', null]];
  const card = (id, l) => { const p = pages[id]; if (!p) return null; const v = p.statute ? p.versions[p.statute.version - 1] : p.versions.at(-1);
    return h('a', { class: `text-card${l && l !== lang() ? ' other' : ''}`, href: `hall.html#/wiki/${id}`, lang: l || null },
      h('span', { class: 'text-lang' }, l ? l.toUpperCase() : 'EN · FR'), h('b', {}, half(v.title)), h('span', { class: 'fine' }, `v${v.n} · ${p.statute ? t('adopted') : t('draft')}`)); };
  const letters = Object.values(st.m.letters?.letters || {}).sort((a, b) => (a.issued < b.issued ? 1 : -1)).slice(0, 4);
  $('#text-list').replaceChildren(h('div', { class: 'text-cards' }, ...pair.map(([id, l]) => card(id, l))),
    h('h3', {}, t('letters')), letters.length ? h('ul', { class: 'rows' }, letters.map(l => h('li', {}, h('a', { href: `hall.html#/letters/${l.letter}` }, l.subject), h('span', { class: 'fine' }, ` ${l.letter} · ${day(l.issued)}`)))) : h('p', { class: 'empty' }, t('noLetters')),
    h('p', { class: 'links' }, h('a', { href: 'hall.html#/wiki' }, t('wiki')), ' · ', h('a', { href: 'chat.html' }, t('chatCap')), ' · ', h('a', { href: 'hall.html' }, t('institutions'))));
}

function draw() { drawSwitch(); drawStrings(); drawFront(); drawStreet(); drawFeds(); drawCredits(); drawVotes(); drawOfficers(); drawTexts(); }
onChange(draw);
onSigned(draw);
await start();
draw();
