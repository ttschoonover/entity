// The home page of the People's Commune of the Long Table: a client of its Git
// Republic, through windows. Everything shown is computed in the visitor's
// browser from the signed record, checked first; every vote or motion is
// signed in the commune's own signing window, never on this page.
import { start as connect, onChange, onSigned, sign, joinDialog, me, isCitizen, displayName, renderText } from './common.js';
import { drawOpen } from './floor.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const SVGNS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;
const v = (n) => `${(n / 10).toFixed(1)} v.`;
let firstDraw = true;

// ── the calendar: years from the founding, four seasons of ninety days ──────
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (n) => ROMAN.reduce((s, [k, r]) => { while (n >= k) { s += r; n -= k; } return s; }, '');
const ORD = ['First', 'Second', 'Third', 'Fourth'];
const nth = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10)] || 'th'}`;
function calendar(founded, now = new Date()) {
  const f = new Date(founded); const start = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / DAY);
  const year = Math.floor(days / 365) + 1, inYear = days % 365;
  const season = Math.min(4, Math.floor(inYear / 90) + 1), inSeason = inYear - (season - 1) * 90 + 1;
  return { year, season, inSeason, leftover: inYear >= 360, founded: f };
}
function holidays(founded, now = new Date()) {
  const y = now.getUTCFullYear(), f = new Date(founded);
  const next = (m, d) => { let t = Date.UTC(y, m, d); if (t < Date.UTC(y, now.getUTCMonth(), now.getUTCDate())) t = Date.UTC(y + 1, m, d); return new Date(t); };
  return [
    ['The Day of the Commune', '18 March', 'for the Paris Commune of 1871, which elected its delegates, paid them a worker’s wage, and could recall them.', next(2, 18)],
    ['The Day of Labour', '1 May', 'for everyone who works.', next(4, 1)],
    ['Founding Day', f.toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }), 'the birthday of this commune.', next(f.getUTCMonth(), f.getUTCDate())],
  ].sort((a, b) => a[3] - b[3]);
}
function drawCalendar(r) {
  const c = calendar(r.get('founded'));
  const line = c.leftover ? `One of the leftover days of Year ${roman(c.year)} of the Commune` : `The ${nth(c.inSeason)} day of the ${ORD[c.season - 1]} Season, Year ${roman(c.year)} of the Commune`;
  $('#calendar').textContent = line;
  $('#cal-long').textContent = `Today is ${line.replace(/^T/, 't').replace(/^O/, 'o')}. The season ends in ${c.leftover ? 0 : 90 - c.inSeason} days, and with it every delegate's and commissar's term.`;
  $('#holidays').innerHTML = holidays(r.get('founded')).map(([n, d, why, next]) => {
    const inDays = Math.round((next - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / DAY);
    return `<li><b>${esc(n)}</b>, ${esc(d)}: ${esc(why)} <span class="fine">${inDays === 0 ? 'Today.' : `In ${inDays} day${inDays === 1 ? '' : 's'}.`}</span></li>`;
  }).join('');
}

// ── the table: one chair per comrade, and the empty chair at the top ─────────
function drawTable(r) {
  const members = r.get('members');
  const open = Object.values(r.state.proposals).filter(p => !p.closed).sort((a, b) => (a.at < b.at ? 1 : -1));
  const bill = open[0] || null;
  const roll = new Set(bill?.roll || []), choiceOf = {};
  if (bill) for (const b of [...bill.ballots].filter(b => roll.has(b.by)).sort((x, y) => (x.at < y.at ? -1 : 1))) choiceOf[b.by] = b.choice;
  const n = Math.max(12, members.length + 1);
  const rank = { for: 0, abstain: 1, undefined: 2, against: 3 };
  const people = [...members].sort((p, q) => rank[choiceOf[p.id]] - rank[choiceOf[q.id]] || (p.name < q.name ? -1 : 1));
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '-1.25 -1.25 2.5 2.5');
  const el = (tag, attrs, title) => { const e = document.createElementNS(SVGNS, tag); for (const [k, x] of Object.entries(attrs)) e.setAttribute(k, x); if (title) { const t = document.createElementNS(SVGNS, 'title'); t.textContent = title; e.append(t); } svg.append(e); return e; };
  const R = 0.72, D = R + 0.24 + Math.min(0.08, n / 900);
  el('circle', { cx: 0, cy: 0, r: R, class: 'tabletop' });
  // The star at the centre.
  const star = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.13 : 0.32; return `${(rr * Math.cos(a)).toFixed(3)},${(rr * Math.sin(a)).toFixed(3)}`; }).join(' ');
  el('polygon', { points: star, class: 'star' });
  const w = Math.min(0.24, (2 * Math.PI * D / n) * 0.62), hgt = w * 0.62;
  const fill = { for: 'var(--aye)', against: 'var(--no)', abstain: 'var(--abstain)' };
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n, x = D * Math.cos(a), y = D * Math.sin(a);
    const rot = (a * 180 / Math.PI + 90).toFixed(1);
    const attrs = { x: (x - w / 2).toFixed(3), y: (y - hgt / 2).toFixed(3), width: w.toFixed(3), height: hgt.toFixed(3), rx: (hgt * 0.25).toFixed(3), transform: `rotate(${rot} ${x.toFixed(3)} ${y.toFixed(3)})` };
    if (firstDraw) attrs.style = `animation-delay:${Math.min(1.2, i * 1.2 / n).toFixed(2)}s`;
    if (i === 0) { el('rect', { ...attrs, class: 'chair yours', fill: 'none' }, isCitizen() ? 'Kept for whoever comes next' : 'Your chair, if you join'); continue; }
    const m = people[i - 1];
    if (!m) { el('rect', { ...attrs, class: 'chair open', fill: 'none' }, 'An empty chair'); continue; }
    const ch = choiceOf[m.id];
    const c = el('rect', { ...attrs, class: `chair ${ch ? `voted ${ch}` : 'pending'}` }, `${displayName(m.id)}${bill ? (ch ? ` · ${ch === 'for' ? 'for' : ch === 'against' ? 'against' : 'abstaining'}` : roll.has(m.id) ? ' · not yet voted' : ' · joined after this motion') : ''}`);
    if (ch) c.style.fill = fill[ch];
    else if (bill && roll.has(m.id)) c.setAttribute('class', 'chair pending ring');
  }
  const box = $('#table');
  box.classList.toggle('drawing', firstDraw);
  box.replaceChildren(svg);
  firstDraw = false;
  const k = members.length;
  box.setAttribute('aria-label', `The table: ${k} comrade${k === 1 ? '' : 's'}${bill ? `, voting on "${bill.title}"` : ''}`);
  $('#table-title').innerHTML = `${k} comrade${k === 1 ? '' : 's'} at the table. <span class="bill">${bill ? `Before the Congress: ${esc(bill.title)}` : 'No motion is open.'}</span>`;
  $('#legend').hidden = false;
  for (const li of $('#legend').children) if (li.dataset.when) li.hidden = li.dataset.when === 'bill' ? !bill : false;
}

// ── where power sits ──────────────────────────────────────────────────────────
function drawOrgans(r) {
  const offices = Object.fromEntries(r.get('offices').map(o => [o.id, o]));
  const committees = Object.fromEntries((r.get('committees') || []).map(c => [c.id, c]));
  const names = (ids, none) => (ids.length ? ids.map(id => esc(displayName(typeof id === 'string' ? id : id.id))).join(', ') : `<span class="vacant">${none}</span>`);
  const grants = r.get('grants');
  const pretty = (g) => (g.title && g.title !== g.id ? g.title : g.id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()));
  const powers = (to) => grants.filter(g => (to.office && g.to.office === to.office) || (to.committee && g.to.committee === to.committee)).map(g => `<a href="hall.html#/authority/${esc(g.id)}">${esc(pretty(g))}</a>`).join(' · ');
  const commissars = Object.values(offices).filter(o => o.id.startsWith('commissar-'));
  const del = offices.delegate, pres = committees.presidium, cc = committees['control-commission'];
  const n = r.get('member-count');
  const items = [
    ['congress', 'The Congress of Comrades', `Every comrade, one vote each (${n} now). The highest organ: it may decide anything, recall anyone, and alone amends the Fundamental Law.`, '<a href="hall.html#/citizens">Every comrade</a>'],
    ['council', 'The Council of Delegates', `${del ? del.seats : 7} delegates, elected for one season by approval voting, recallable at any time. Makes the laws.`, del ? names(del.holders, 'No delegates yet') : ''],
    ['presidium', pres?.title || 'The Presidium', 'Three delegates appointed by the Congress, acting only when all three sign. Issues decrees, calls the Congress, confers honours, writes for the Commune.', pres ? `${names(pres.members, 'Not yet appointed')}<span class="powers">${powers({ committee: 'presidium' })}</span>` : ''],
    ['commissars', 'The People’s Commissars', 'Five officers, elected by season, each acting only within a published grant.', commissars.map(o => `<span class="commissar"><b>${esc(o.title.replace('People’s Commissar of ', '').replace(/^./, c => c.toUpperCase()))}</b> ${names(o.holders, 'vacant')}<span class="powers">${powers({ office: o.id })}</span></span>`).join('')],
    ['control', cc?.title || 'The Control Commission', 'Three comrades holding no other office. Hears disputes and complaints against any organ, audits everyone, reports each season. Stands beside the ladder, not on it.', cc ? names(cc.members, 'Not yet appointed') : ''],
  ];
  $('#organs').innerHTML = items.map(([id, t, d, who]) => `<li class="organ organ-${id}"><h3>${esc(t)}</h3><p>${d}</p><p class="holders">${who}</p></li>`).join('');

  const now = new Date().toISOString();
  const elections = Object.values(r.state.m.elections || {}).filter(e => !e.counted);
  const title = Object.fromEntries(Object.values(offices).map(o => [o.id, o.title]));
  $('#elections').innerHTML = elections.length ? `<h3>Elections</h3>${elections.map(e => {
    const phase = now <= e.standUntil ? 'candidacy' : now <= e.voteUntil ? 'voting' : 'closed';
    const cands = Object.keys(e.candidates);
    const list = cands.length ? cands.map(c => esc(displayName(c))).join(', ') : 'no one yet';
    if (phase === 'candidacy') return `<p data-election="${esc(e.id)}"><b>${esc(title[e.office] || e.office)}.</b> Nominations close ${day(e.standUntil)}. Standing: ${list}. <button class="linklike" data-act="stand" type="button">Stand</button></p>`;
    if (phase === 'voting') return `<p data-election="${esc(e.id)}"><b>${esc(title[e.office] || e.office)}.</b> Voting closes ${day(e.voteUntil)}. ${cands.length ? `Tick everyone you approve of: ${cands.map(c => `<label class="approve"><input type="checkbox" value="${esc(c)}"> ${esc(displayName(c))}</label>`).join(' ')} <button class="linklike" data-act="vote" type="button">Cast my ballot</button>` : 'No one stood.'}</p>`;
    return `<p data-election="${esc(e.id)}"><b>${esc(title[e.office] || e.office)}.</b> Voting has closed. <button class="linklike" data-act="count" type="button">Count the ballots</button></p>`;
  }).join('')}` : '';
  for (const btn of $('#elections').querySelectorAll('button')) btn.onclick = async () => {
    const p = btn.closest('[data-election]'), election = p.dataset.election;
    const fields = btn.dataset.act === 'vote' ? { election, choices: [...p.querySelectorAll('input:checked')].map(i => i.value) } : { election };
    await sign({ stand: 'election.stand', vote: 'election.vote', count: 'election.count' }[btn.dataset.act], fields, btn.textContent);
  };
}

// ── labour, vouchers and the Plan ───────────────────────────────────────────
function drawLabour(r) {
  const tasks = Object.values(r.state.m.tasks?.items || {});
  const open = tasks.filter(t => !t.cancelled && !t.claimer && !t.done);
  const hours = Object.values(r.state.m.tasks?.hours || {}).reduce((a, b) => a + b, 0);
  const things = Object.values(r.state.m.deeds || {}).filter(d => d && !d.retired && d.holder === null);
  const stats = [[v(r.get('supply')).replace(' v.', ''), 'vouchers unspent'], [String(Math.round(hours * 10) / 10), 'hours worked, all told'], [String(open.length), 'jobs waiting'], [String(things.length), 'things held in common']];
  $('#stats').innerHTML = stats.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('');
  $('#work').innerHTML = open.length ? open.slice(0, 6).map(t => `<li><a href="hall.html#/tasks/${esc(t.id)}">${esc(t.title)}</a> <span class="fine">${t.hours} h · ${v(t.hours * 10)}</span></li>`).join('') : '<li class="empty">Nothing waiting. Any comrade can post work.</li>';
  const lines = Object.values(r.state.m.budget?.lines || {}).filter(l => !l.closed);
  $('#plan').innerHTML = lines.length ? lines.map(l => { const spent = (l.spending || []).reduce((a, s) => a + s.amount, 0); return `<li><b>${esc(l.title)}</b> <span class="fine">${(spent / 10).toFixed(1)} of ${(l.amount / 10).toFixed(1)} hours used</span><span class="bar"><span style="width:${Math.min(100, 100 * spent / Math.max(1, l.amount)).toFixed(0)}%"></span></span></li>`; }).join('') : '<li class="empty">The Congress has not yet adopted a Plan for this season.</li>';
}

// ── the Fundamental Law ───────────────────────────────────────────────────────
function drawLaw(r) {
  const l = r.state.m.laws?.laws?.['fundamental-law'];
  if (!l || l.status !== 'in force') { $('#law-text').innerHTML = '<p class="empty">The Fundamental Law has not been enacted yet.</p>'; $('#law-toc').innerHTML = ''; return; }
  const text = l.versions.at(-1).text;
  $('#law-meta').textContent = `Version ${l.versions.length}, in force since ${day(l.since)}.`;
  const preamble = text.split(/\n\s*\n/)[0];
  $('#law-text').innerHTML = /^#/.test(preamble) ? '' : `<p class="preamble">${esc(preamble)}</p>`;
  $('#law-toc').innerHTML = renderText(text, { anchors: 'a' }).heads.map(x => `<li><a href="laws.html#law/fundamental-law/@${esc(x.id)}">${esc(x.text)}</a></li>`).join('');
}

function drawHonours(r) {
  const badges = Object.values(r.state.m.badges || {}).filter(b => !b.retired);
  $('#honours').innerHTML = badges.length ? badges.map(b => { const who = Object.keys(b.holders || {}); return `<li><b>${esc(b.title)}</b>${b.description ? `: ${esc(b.description)}` : ''} <span class="fine">${who.length ? `Held by ${who.map(id => esc(displayName(id))).join(', ')}.` : 'Not yet conferred.'}</span></li>`; }).join('') : '<li class="empty">None yet.</li>';
}

function drawDecisions(r) {
  const list = r.get('decisions', 10);
  $('#decisions').innerHTML = list.length ? list.map(d => `<li><time datetime="${esc(d.at)}">${day(d.at)}</time><span>${esc(d.title)}</span><span class="outcome ${d.carried ? 'carried' : 'failed'}">${d.carried ? (d.enacted ? 'Carried' : 'Carried, needs a second vote') : 'Lost'}</span></li>`).join('') : '<li><span class="empty">Nothing decided yet.</span></li>';
}

function drawJoin() {
  const p = me();
  $('#join').hidden = isCitizen();
  $('#join-note').textContent = p ? (isCitizen() ? `Seated as ${displayName(p.id)}.` : `Signed in as ${displayName(p.id)}. Status: ${p.status}.`) : 'Open to anyone. You need an id and a password.';
}

function drawAll(r) {
  if (!r.ok) { $('#table-title').textContent = 'The record did not verify, so nothing is shown.'; return; }
  drawCalendar(r); drawTable(r); drawOpen($('#bills'), { empty: 'Nothing is before the Congress. Any comrade can move a motion below.' });
  drawOrgans(r); drawLabour(r); drawLaw(r); drawDecisions(r); drawHonours(r); drawJoin();
}

async function start() {
  let r;
  try { r = await connect(); }
  catch (e) { $('#table-title').textContent = `The Commune's record could not be reached: ${e.message}`; return; }
  drawAll(r);
  const busy = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA)$/.test(a.tagName); };
  onChange(() => { if (!busy() && !document.querySelector('dialog[open]')) drawAll(r); });
  onSigned(() => drawAll(r));
  $('#propose').hidden = false;
  $('#join').onclick = () => joinDialog();
  $('#propose-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const title = $('#p-title').value.trim(), text = $('#p-text').value.trim();
    if (await sign('proposal.lay', { title, ...(text ? { text } : {}), rule: 'ordinary' }, `Your motion "${title}"`)) { ev.target.reset(); $('#propose').open = false; }
  };
}
start();
