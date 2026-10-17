// window.js · show a Git Republic on any website, verified in each visitor's
// browser. Load it from the republic's own node:
//
//   <script type="module" src="https://coop.example/window.js"></script>
//   <gr-seal src="https://coop.example/"></gr-seal>
//   <gr-var src="https://coop.example/" name="supply"></gr-var>
//
// Or use it from JavaScript:
//
//   import { connect } from 'https://coop.example/window.js';
//   const r = await connect('https://coop.example/', { also: ['https://mirror.example/'] });
//   r.get('holders', 'treasurer');      // ['ana']
//   r.on('record', () => …);           // the record grew (and was verified again)
//   await r.act('ballot.cast', { proposal: 'd-…', choice: 'for' }, 'Vote for the budget');
//
// Nothing here trusts the website it is on, or the node: the record is fetched,
// every signature and link checked with the republic's own code, and only then
// shown. Signing happens in a window served by the republic's node, never on
// the host website, which only learns the result.

const connections = new Map();
const norm = (u) => new URL(u, location.href).href.replace(/\/?$/, '/');

export async function connect(src, { also = [] } = {}) {
  const base = norm(src);
  if (!connections.has(base)) connections.set(base, open(base, also.map(norm)));
  return connections.get(base);
}

async function open(base, also) {
  const E = await import(`${base}interface/js/engine.js`);
  const info = await (await fetch(`${base}window/info.json`, { cache: 'no-store' })).json();
  const listeners = new Map();
  const r = {
    base, info, ok: false, problems: [], state: null, params: null, records: [], head: null, disagree: [],
    on(event, fn) { (listeners.get(event) || listeners.set(event, new Set()).get(event)).add(fn); return () => listeners.get(event).delete(fn); },
    emit(event, data) { for (const fn of listeners.get(event) || []) try { fn(data); } catch (e) { console.error(e); } },
  };
  const registry = await E.loadRegistry(info.modules);

  async function load() {
    const text = await (await fetch(`${base}record/events.jsonl`, { cache: 'no-store' })).text();
    const v = await E.verifyText(registry, text);
    const before = r.records.length;
    Object.assign(r, { ok: v.ok, problems: v.problems || [], records: v.records, state: v.ok ? v.state : null, params: v.ok ? E.paramsOf(v.state) : null, head: v.records.at(-1)?.hash || null });
    if (v.ok && info.id && v.state.entity.id !== info.id) Object.assign(r, { ok: false, problems: [{ problem: `this record belongs to ${v.state.entity.id}, not ${info.id}` }] });
    // Other copies: they must agree with this one, as far as both go.
    r.disagree = [];
    for (const other of also) {
      try {
        const t = await (await fetch(`${other}record/events.jsonl`, { cache: 'no-store' })).text();
        const lines = t.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
        const n = Math.min(lines.length, r.records.length);
        if (n && lines[n - 1].hash !== r.records[n - 1].hash) r.disagree.push(other);
      } catch { r.disagree.push(other); }
    }
    if (r.disagree.length) r.emit('disagreement', r.disagree);
    for (const rec of r.records.slice(before)) r.emit(rec.kind, rec);
    r.emit('change', r);
    if (before && r.records.length > before) r.emit('record', r.records.slice(before));
  }
  await load();

  // Live: the node announces new records; each is verified before it is shown.
  try {
    const es = new EventSource(`${base}window/events`);
    let busy = Promise.resolve();
    es.addEventListener('record', () => { busy = busy.then(load).catch(e => console.error(e)); });
  } catch { /* no live updates */ }

  // ── variables ──────────────────────────────────────────────────────────────
  const now = () => new Date().toISOString();
  const live = (list) => (list || []).filter(m => m.since <= now() && (!m.until || m.until > now())).map(m => m.id);
  const titleOf = (id) => { const t = r.state.m.titles?.[id]; return (typeof t === 'string' ? t : t?.title) || r.state.participants[id]?.name || id; };
  const holdersOf = (to) => {
    if (!to) return [];
    if (to.office) return live(r.state.m.offices?.[to.office]?.holders);
    if (to.committee) return live(r.state.m.committees?.[to.committee]?.members);
    if (to.member) return [to.member];
    return [];
  };
  const VARS = {
    name: () => r.params.value('entity.name'),
    id: () => r.state.entity.id,
    founded: () => r.state.entity.founded,
    records: () => r.records.length,
    head: () => r.head,
    verified: () => r.ok,
    modules: () => r.params.value('entity.modules'),
    members: () => r.state.order.filter(id => r.state.participants[id].status === 'active').map(id => ({ id, name: titleOf(id) })),
    'member-count': () => VARS.members().length,
    offices: () => Object.values(r.state.m.offices || {}).filter(o => !o.abolished).map(o => ({ id: o.id, title: o.title, seats: o.seats, holders: live(o.holders).map(id => ({ id, name: titleOf(id) })) })),
    holders: (office) => live(r.state.m.offices?.[office]?.holders),
    committees: () => Object.values(r.state.m.committees || {}).filter(c => !c.dissolved).map(c => ({ id: c.id, title: c.title, members: live(c.members) })),
    grants: () => Object.values(r.state.m.authority?.grants || {}).filter(g => !g.revoked).map(g => ({ id: g.id, title: g.title || g.id, may: g.may, note: g.note || '', to: g.to, holders: holdersOf(g.to) })),
    supply: () => r.state.m.value?.supply ?? 0,
    currency: () => (r.params.has('value.name') ? r.params.value('value.name') : ''),
    balance: (id) => r.state.m.value?.balances?.[id] || 0,
    settings: () => Object.fromEntries(r.params.keys().map(k => [k, r.params.value(k)])),
    setting: (key) => r.params.value(key),
    proposals: () => Object.values(r.state.proposals).filter(p => !p.closed).map(p => { const t = E.tally(r.state, p.id); return { id: p.id, title: p.title, rule: p.rule, closes: p.deadline, for: t.for ?? t.yes ?? 0, against: t.against ?? t.no ?? 0, abstain: t.abstain ?? 0 }; }),
    decisions: (n = 10) => Object.values(r.state.proposals).filter(p => p.closed).sort((a, b) => (a.closed.at < b.closed.at ? 1 : -1)).slice(0, Number(n)).map(p => ({ id: p.id, title: p.title, carried: p.closed.carried, enacted: p.enacted, at: p.closed.at })),
    statute: (page) => { const w = r.state.m.wiki?.pages?.[page]; const s = w?.statute; if (!s) return null; const v = w.versions[s.version - 1]; return { title: v.title, body: v.body, version: s.version, enacted: s.at }; },
  };
  r.get = (name, arg) => {
    if (!r.ok) throw new Error('this record did not verify');
    const f = VARS[name];
    if (!f) throw new Error(`no variable "${name}"; there are: ${Object.keys(VARS).join(', ')}`);
    return f(arg);
  };
  r.variables = Object.keys(VARS);

  // ── writing: a signing window served by the republic's own node ──────────
  r.act = (kind, fields = {}, label = kind) => new Promise((resolve, reject) => {
    const req = { kind, fields, label, origin: location.origin, id: Math.random().toString(36).slice(2) };
    const w = window.open(`${base}window/sign.html#${encodeURIComponent(JSON.stringify(req))}`, `gr-sign-${req.id}`, 'width=520,height=640');
    if (!w) return reject(new Error('allow pop-ups for this site to sign'));
    const nodeOrigin = new URL(base).origin;
    const onMsg = (e) => {
      if (e.origin !== nodeOrigin || e.data?.id !== req.id) return;
      removeEventListener('message', onMsg);
      if (e.data.ok) { load().then(() => resolve(e.data)); } else reject(Object.assign(new Error(e.data.error || 'not signed'), e.data));
    };
    addEventListener('message', onMsg);
  });
  r.join = () => r.act('participant.apply', {}, `Join ${r.ok ? r.get('name') : 'this republic'}`);
  return r;
}

// ── ready-made elements ──────────────────────────────────────────────────────
// They render plain markup with gr-* classes, so the host site styles them.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ids = (list) => list.map(x => esc(typeof x === 'string' ? x : x.name || x.id)).join(', ');

class GrBase extends HTMLElement {
  async connectedCallback() {
    if (this._r) return;
    try {
      this._r = await connect(this.getAttribute('src') || '/', { also: (this.getAttribute('also') || '').split(/\s+/).filter(Boolean) });
      this._r.on('change', () => this.paint());
      this.paint();
    } catch (e) { this.innerHTML = `<span class="gr-error">Could not reach the republic: ${esc(e.message)}</span>`; }
  }
  paint() {
    const r = this._r;
    if (!r.ok) { this.innerHTML = `<span class="gr-error">This record did not verify: ${esc(r.problems[0]?.problem || 'unknown problem')}</span>`; return; }
    try { this.innerHTML = this.render(r); } catch (e) { this.innerHTML = `<span class="gr-error">${esc(e.message)}</span>`; }
  }
}

// <gr-var name="supply" arg="…">: one value as text.
customElements.get('gr-var') || customElements.define('gr-var', class extends GrBase {
  render(r) { const v = r.get(this.getAttribute('name'), this.getAttribute('arg') ?? undefined); return Array.isArray(v) ? ids(v) : typeof v === 'object' && v ? esc(JSON.stringify(v)) : esc(v); }
});

// <gr-list name="offices | grants | members | committees | decisions">: a list.
customElements.get('gr-list') || customElements.define('gr-list', class extends GrBase {
  render(r) {
    const name = this.getAttribute('name'), items = r.get(name, this.getAttribute('arg') ?? undefined);
    const li = (x) => {
      if (name === 'offices') return `<li class="gr-office"><strong>${esc(x.title)}</strong> <span>${ids(x.holders) || 'vacant'}</span></li>`;
      if (name === 'grants') return `<li class="gr-grant"><strong>${esc(x.title)}</strong> <span>${ids(x.holders)}</span> <small>${esc(x.may.join(', '))}</small></li>`;
      if (name === 'committees') return `<li class="gr-committee"><strong>${esc(x.title)}</strong> <span>${ids(x.members)}</span></li>`;
      if (name === 'decisions') return `<li class="gr-decision">${esc(x.title)} <small>${x.carried ? (x.enacted ? 'carried' : 'carried, awaiting a further reading') : 'not carried'} · ${esc(x.at.slice(0, 10))}</small></li>`;
      if (name === 'members') return `<li class="gr-member">${esc(x.name)}</li>`;
      return `<li>${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</li>`;
    };
    return `<ul class="gr-list gr-${esc(name)}">${(Array.isArray(items) ? items : []).map(li).join('') || '<li class="gr-empty">None.</li>'}</ul>`;
  }
});

// <gr-seal>: that the record is verified, how long it is, and whether copies agree.
customElements.get('gr-seal') || customElements.define('gr-seal', class extends GrBase {
  render(r) {
    if (r.disagree.length) return `<span class="gr-seal gr-alarm">Copies of this republic disagree (${esc(r.disagree.join(', '))}). Do not rely on it until that is resolved.</span>`;
    return `<a class="gr-seal" href="${esc(r.base)}">${esc(r.get('name'))} · governed in the open · ${r.records.length} records, verified in your browser</a>`;
  }
});

// <gr-votes limit="5">: open votes with tallies, and buttons to vote.
customElements.get('gr-votes') || customElements.define('gr-votes', class extends GrBase {
  render(r) {
    const open = r.get('proposals').slice(0, Number(this.getAttribute('limit') || 20));
    if (!open.length) return '<p class="gr-empty">No open votes.</p>';
    return `<ul class="gr-votes">${open.map(p => `<li class="gr-proposal" data-id="${esc(p.id)}"><strong>${esc(p.title)}</strong>
      <span class="gr-tally">${p.for} for · ${p.against} against · ${p.abstain} abstaining</span>
      ${this.hasAttribute('readonly') ? '' : `<span class="gr-actions"><button data-choice="for">For</button> <button data-choice="against">Against</button> <button data-choice="abstain">Abstain</button></span>`}</li>`).join('')}</ul>`;
  }
  paint() {
    super.paint();
    for (const b of this.querySelectorAll('button[data-choice]')) b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id, title = b.closest('[data-id]').querySelector('strong').textContent;
      this._r.act('ballot.cast', { proposal: id, choice: b.dataset.choice }, `Vote ${b.dataset.choice} "${title}"`).catch(e => alert(e.message));
    };
  }
});

// <gr-act kind="…" fields='{…}' label="…">Button text</gr-act>: any act, signed by the visitor.
customElements.get('gr-act') || customElements.define('gr-act', class extends GrBase {
  render() { this._label = this._label || this.textContent.trim() || this.getAttribute('label') || 'Sign'; return `<button class="gr-act">${esc(this._label)}</button>`; }
  paint() {
    super.paint();
    const b = this.querySelector('button'); if (!b) return;
    b.onclick = () => this._r.act(this.getAttribute('kind'), JSON.parse(this.getAttribute('fields') || '{}'), this.getAttribute('label') || this._label)
      .then(x => this.dispatchEvent(new CustomEvent('signed', { detail: x }))).catch(e => alert(e.message));
  }
});

// <gr-join>Join us</gr-join>: apply to join, in the republic's own window.
customElements.get('gr-join') || customElements.define('gr-join', class extends GrBase {
  render() { this._label = this._label || this.textContent.trim() || 'Join'; return `<button class="gr-join">${esc(this._label)}</button>`; }
  paint() { super.paint(); const b = this.querySelector('button'); if (b) b.onclick = () => this._r.join().catch(e => alert(e.message)); }
});
