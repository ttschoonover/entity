// The home page of the Virtual Democratic Republic's website: a client of its Git Republic,
// through windows. Everything shown is computed in the visitor's browser from
// the signed record, checked first; every vote or bill is signed in the
// republic's own signing window, never on this page.
import { start as connectRepublic, onChange, onSigned, ctx, sign, joinDialog, me, isCitizen, displayName, renderText, INSTITUTIONS, institutionTitle } from './common.js';
import { drawOpen } from './floor.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const SVGNS = 'http://www.w3.org/2000/svg';
let firstDraw = true;

// ── the hemicycle: one seat per citizen, plus the empty seat at the top ──────
function seatsFor(total) {
  // Rows grow with the chamber; each row holds seats in proportion to its length.
  const rows = Math.max(1, Math.min(9, Math.round(Math.sqrt(total / 3.2))));
  const r0 = 0.42, r1 = 1, radii = Array.from({ length: rows }, (_, i) => (rows === 1 ? 0.78 : r0 + (r1 - r0) * i / (rows - 1)));
  const sum = radii.reduce((a, b) => a + b, 0);
  let counts = radii.map(r => Math.max(1, Math.round(total * r / sum)));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) { if (diff > 0) { counts[i]++; diff--; } else if (counts[i] > 1) { counts[i]--; diff++; } }
  const seats = [];
  radii.forEach((r, i) => {
    const n = counts[i];
    for (let k = 0; k < n; k++) {
      const a = n === 1 ? Math.PI / 2 : Math.PI - k * Math.PI / (n - 1);
      seats.push({ x: r * Math.cos(a), y: r * Math.sin(a), a, row: i });
    }
  });
  const longest = Math.max(...counts.map((n, i) => (Math.PI * radii[i]) / Math.max(1, n - 1 || 1)));
  const size = Math.min(0.075, Math.min(...counts.map((n, i) => (n > 1 ? (Math.PI * radii[i]) / (n - 1) : 0.3))) * 0.36, (r1 - r0) / Math.max(1, rows - 1) * 0.36 || 0.075);
  return { seats, size: Math.max(0.012, size), longest };
}

function drawChamber(r) {
  const members = r.get('members');
  const open = Object.values(r.state.proposals).filter(p => !p.closed).sort((a, b) => (a.at < b.at ? 1 : -1));
  const bill = open[0] || null;
  const choiceOf = {};
  const roll = new Set(bill?.roll || []);
  if (bill) for (const b of [...bill.ballots].filter(b => roll.has(b.by)).sort((x, y) => (x.at < y.at ? -1 : 1))) choiceOf[b.by] = b.choice;
  // The chamber never seats fewer than the flag's 54; unclaimed seats stay open.
  const { seats, size } = seatsFor(Math.max(54, members.length + 1));
  // The empty seat: the outer row's seat nearest the top.
  const outer = Math.max(...seats.map(s => s.row));
  const yours = seats.filter(s => s.row === outer).reduce((best, s) => (Math.abs(s.a - Math.PI / 2) < Math.abs(best.a - Math.PI / 2) ? s : best));
  const rest = seats.filter(s => s !== yours).sort((p, q) => q.a - p.a);
  const rank = { for: 0, abstain: 1, undefined: 2, against: 3 };
  const late = members.some(m => !roll.has(m.id));
  const people = [...members].sort((p, q) => rank[choiceOf[p.id]] - rank[choiceOf[q.id]] || (p.name < q.name ? -1 : 1));
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '-1.1 -1.1 2.2 1.18');
  const add = (s, cls, title, i) => {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', s.x.toFixed(4)); c.setAttribute('cy', (-s.y).toFixed(4)); c.setAttribute('r', size.toFixed(4));
    c.setAttribute('class', `seat ${cls}`);
    if (firstDraw) c.style.animationDelay = `${Math.min(1.2, i * (1.2 / Math.max(1, seats.length)))}s`;
    const t = document.createElementNS(SVGNS, 'title'); t.textContent = title; c.append(t);
    svg.append(c);
  };
  const fill = { for: 'var(--aye)', against: 'var(--no)', abstain: 'var(--abstain)' };
  rest.forEach((s, i) => {
    const m = people[i];
    if (!m) {
      add(s, 'open', 'Empty seat', i);
      const c = svg.lastChild; c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'var(--rule)'); c.setAttribute('stroke-width', (size * 0.28).toFixed(4));
      return;
    }
    const ch = choiceOf[m.id];
    add(s, ch ? `voted ${ch}` : 'pending', `${displayName(m.id)}${bill ? (ch ? ` · ${ch === 'for' ? 'for' : ch === 'against' ? 'against' : 'abstaining'}` : roll.has(m.id) ? ' · not yet voted' : ' · joined after this bill was laid') : ''}`, i);
    const c = svg.lastChild;
    if (ch) c.setAttribute('fill', fill[ch]);
    else if (bill && roll.has(m.id)) { c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'var(--abstain)'); c.setAttribute('stroke-width', (size * 0.32).toFixed(4)); }
    else c.setAttribute('fill', 'var(--ink)');
  });
  add(yours, 'yours', isCitizen() ? 'For the next citizen' : 'Your seat, if you join', rest.length);
  const y = svg.lastChild; y.setAttribute('fill', 'none'); y.setAttribute('stroke', 'var(--gold)'); y.setAttribute('stroke-width', (size * 0.36).toFixed(4));
  const floor = document.createElementNS(SVGNS, 'rect');
  floor.setAttribute('x', '-1.1'); floor.setAttribute('y', '0.035'); floor.setAttribute('width', '2.2'); floor.setAttribute('height', '0.045'); floor.setAttribute('fill', 'var(--gold)'); floor.setAttribute('rx', '0.01');
  svg.append(floor);
  const box = $('#hemicycle');
  box.classList.toggle('drawing', firstDraw);
  box.replaceChildren(svg);
  box.setAttribute('aria-label', `The chamber: ${members.length} citizen${members.length === 1 ? '' : 's'}${bill ? `, voting on "${bill.title}"` : ''}`);
  firstDraw = false;
  const n = members.length;
  $('#chamber-title').innerHTML = bill
    ? `${n} citizen${n === 1 ? '' : 's'}. <span class="bill">Voting on: ${esc(bill.title)}</span>`
    : `${n} citizen${n === 1 ? '' : 's'}. <span class="bill">No vote is open.</span>`;
  $('#legend').hidden = false;
  const show = { bill: !!bill, idle: !bill || late, open: members.length + 1 < seats.length };
  for (const li of $('#legend').children) if (li.dataset.when) li.hidden = !show[li.dataset.when];
}

// ── bills on the floor ─────────────────────────────────────────────────────
function drawBills() {
  drawOpen($('#bills'), { empty: 'Nothing is open for a vote. Any citizen can propose something below.' });
}

// ── offices and elections ──────────────────────────────────────────────────
function drawOffices(r) {
  const name = Object.fromEntries(r.get('members').map(m => [m.id, m.name]));
  const offices = r.get('offices');
  const court = (r.get('committees') || []).find(c => c.id === 'supreme-court');
  $('#office-list').innerHTML = [...offices.map(o => `<div class="office"><h3>${esc(o.title)}</h3><p>${o.holders.length ? o.holders.map(h => esc(displayName(h.id))).join(', ') : '<span class="vacant">Vacant</span>'}</p></div>`),
    court ? `<div class="office"><h3>${esc(court.title)}</h3><p>${court.members.length ? court.members.map(id => esc(displayName(id))).join(', ') : '<span class="vacant">No justices yet</span>'}</p></div>` : ''].join('');
  const now = new Date().toISOString();
  const elections = Object.values(r.state.m.elections || {}).filter(e => !e.counted);
  const title = Object.fromEntries(offices.map(o => [o.id, o.title]));
  $('#elections').innerHTML = elections.map(e => {
    const phase = now <= e.standUntil ? 'candidacy' : now <= e.voteUntil ? 'voting' : 'closed';
    const cands = Object.keys(e.candidates);
    const list = cands.length ? cands.map(c => esc(displayName(c))).join(', ') : 'no one yet';
    if (phase === 'candidacy') return `<p data-election="${esc(e.id)}"><b>${esc(title[e.office] || e.office)}.</b> Nominations close ${day(e.standUntil)}. Standing: ${list}. <button class="linklike" data-act="stand" type="button">Stand as a candidate</button></p>`;
    if (phase === 'voting') return `<p data-election="${esc(e.id)}"><b>${esc(title[e.office] || e.office)}.</b> Voting closes ${day(e.voteUntil)}. ${cands.length ? `Tick everyone you approve of: ${cands.map(c => `<label class="approve"><input type="checkbox" value="${esc(c)}"> ${esc(displayName(c))}</label>`).join(' ')} <button class="linklike" data-act="vote" type="button">Cast my ballot</button>` : 'No one stood.'}</p>`;
    return `<p data-election="${esc(e.id)}"><b>${esc(title[e.office] || e.office)}.</b> Voting has closed. <button class="linklike" data-act="count" type="button">Count the ballots</button></p>`;
  }).join('');
  for (const btn of $('#elections').querySelectorAll('button')) btn.onclick = async () => {
    const p = btn.closest('[data-election]'), election = p.dataset.election;
    const fields = btn.dataset.act === 'vote' ? { election, choices: [...p.querySelectorAll('input:checked')].map(i => i.value) } : { election };
    const kind = { stand: 'election.stand', vote: 'election.vote', count: 'election.count' }[btn.dataset.act];
    await sign(kind, fields, btn.textContent);
  };
}

// ── the Constitution: its preamble and articles; the text is on laws.html ──
function drawConstitution(r) {
  const lc = r.state.m.laws?.laws?.constitution;
  const s = lc && lc.status === 'in force' ? { body: lc.versions.at(-1).text, version: lc.versions.length, enacted: lc.since } : r.get('statute', 'constitution');
  if (!s) { $('#const-text').innerHTML = '<p class="empty">The Constitution has not been enacted yet.</p>'; $('#const-toc').innerHTML = ''; return; }
  $('#const-meta').textContent = `Version ${s.version}, in force since ${day(s.enacted)}.`;
  const preamble = s.body.split(/\n\s*\n/)[0];
  $('#const-text').innerHTML = /^#/.test(preamble) ? '' : `<p class="preamble">${esc(preamble)}</p>`;
  $('#const-toc').innerHTML = renderText(s.body, { anchors: 'a' }).heads.map(x => `<li><a href="laws.html#law/constitution/@${esc(x.id)}">${esc(x.text)}</a></li>`).join('');
}

// ── institutions: every module the Assembly installed, by itself ──────────
const PLUMBING = new Set(['deliberation', 'titles', 'vocabulary', 'passwords', 'passkeys', 'page', 'republic']);
function drawInstitutions(r) {
  const mods = r.params.value('entity.modules').filter(m => !PLUMBING.has(m));
  const items = [['hall.html#/citizens', 'Citizens', `${r.get('member-count')} citizen${r.get('member-count') === 1 ? '' : 's'}, one vote each.`], ['hall.html#/bills', 'Bills', 'Everything put to a vote, open or decided.'], ['laws.html', 'Laws', 'The Constitution and the laws in force.'],
    ...mods.map(m => [m === 'laws' ? 'hall.html#/parliament' : `hall.html#/${m}`, institutionTitle(m), INSTITUTIONS[m]?.[1] || ''])];
  $('#inst-list').innerHTML = items.map(([href, t, d]) => `<li><a href="${href}">${esc(t)}</a><p>${esc(d)}</p></li>`).join('');
}

// ── decisions ──────────────────────────────────────────────────────────────
function drawDecisions(r) {
  const list = r.get('decisions', 12);
  $('#decisions').innerHTML = list.length ? list.map(d => `<li><time datetime="${esc(d.at)}">${day(d.at)}</time><span>${esc(d.title)}</span><span class="outcome ${d.carried ? 'carried' : 'failed'}">${d.carried ? (d.enacted ? 'Passed' : 'Passed, needs a second vote') : 'Rejected'}</span></li>`).join('') : '<li><span class="empty">Nothing decided yet.</span></li>';
}

function drawJoin() {
  const p = me();
  const y = document.querySelector('#legend .key.yours')?.parentElement;
  if (y) y.lastChild.textContent = isCitizen() ? 'For the next citizen' : 'Your seat, if you join';
  $('#join').hidden = isCitizen();
  $('#join-note').textContent = p ? (isCitizen() ? `Signed in as ${displayName(p.id)}.` : `Signed in as ${displayName(p.id)}. Status: ${p.status}.`)
    : 'Open to anyone. You need an id and a password.';
}


function drawAll(r) {
  if (!r.ok) { $('#chamber-title').textContent = 'The record did not verify, so nothing is shown.'; return; }
  drawChamber(r); drawBills(r); drawOffices(r); drawConstitution(r); drawInstitutions(r); drawDecisions(r); drawJoin();
}

async function start() {
  let r;
  try { r = await connectRepublic(); }
  catch (e) { $('#chamber-title').textContent = `The republic's record could not be reached: ${e.message}`; return; }
  drawAll(r);
  const busy = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA)$/.test(a.tagName); };
  onChange(() => { if (!busy() && !document.querySelector('dialog[open]')) drawAll(r); });
  onSigned(() => drawAll(r));
  $('#propose').hidden = false;
  $('#join').onclick = () => joinDialog();
  $('#propose-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const title = $('#p-title').value.trim(), text = $('#p-text').value.trim();
    if (await sign('proposal.lay', { title, ...(text ? { text } : {}), rule: 'ordinary' }, `Your resolution "${title}"`)) { ev.target.reset(); $('#propose').open = false; }
  };
}
start();
