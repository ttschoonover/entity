// screens · Home, the proposal composer, the settings list and the vote
// meters, built on the kit (interface/js/kit.js). They are given the page's
// internals (app.js) rather than reaching for them, so each reads as what it
// shows. Everything they show comes from the record as this browser verified it.
import { t, until } from './i18n.js';

export function makeScreens(d) {
  const { h, kit, E } = d;
  const now = () => new Date().toISOString();

  // ── a proposal as a card, with its two meters and the ballot ────────────
  function meters(x, tally) {
    const tl = tally || E.tally(d.state(), x.id);
    const e = tl.electorate || 1, decisive = tl.for + tl.against;
    return [
      kit.meter({ label: t('v.quorum'), value: tl.cast, of: e, mark: tl.quorumNeeded / e, met: tl.quorumMet,
        text: `${tl.cast}/${tl.electorate} · ${t('v.needs')} ${tl.quorumNeeded}` }),
      kit.meter({ label: t('v.share'), value: tl.for, of: decisive || 1, mark: x.terms.threshold, met: tl.thresholdMet,
        text: decisive ? `${Math.round((tl.for / decisive) * 100)}% · ${t('v.needs')} ${Math.round(x.terms.threshold * 100)}%` : `— · ${t('v.needs')} ${Math.round(x.terms.threshold * 100)}%` }),
    ];
  }
  function proposalCard(x, { urgent = false } = {}) {
    const tl = E.tally(d.state(), x.id);
    const closes = x.closed ? `${t('v.closed')} ${d.day(x.closed.at)}` : `${t('v.closes')} ${until(x.deadline)}`;
    return kit.card({ title: x.title, href: `#/votes/${encodeURIComponent(x.id)}`, tone: urgent ? 'urgent' : null,
      meta: [`${x.rule} · ${closes}`, x.terms.readings > 1 ? ` · ${t('v.reading')} ${x.reading}/${x.terms.readings}` : ''].join(''),
      body: meters(x, tl), actions: d.ballotButtons(x, tl) });
  }

  // ── what happened lately, in words ──────────────────────────────────────
  const DESCRIBE = {
    'entity.found': (r) => `Founded by ${d.nameOf(r.author)}`,
    'entity.preset': (r) => `${d.nameOf(r.author)} set the founding parameters`,
    'participant.apply': (r) => `${d.nameOf(r.author)} applied to join`,
    'participant.admitted': (r) => `${d.nameOf(r.payload.id || r.author)} was admitted`,
    'participant.leave': (r) => `${d.nameOf(r.author)} left`,
    'proposal.lay': (r) => `${d.nameOf(r.author)} proposed “${r.payload.act.title}”`,
    'ballot.cast': (r) => `${d.nameOf(r.author)} voted on ${r.payload.act.proposal}`,
    'proposal.closed': (r) => `${r.payload.proposal} ${r.payload.carried ? 'carried' : 'was not carried'}`,
    'parameters.changed': (r) => `Settings changed: ${Object.keys(r.payload.changes || {}).join(', ')}`,
    'member.recordkey': (r) => `${d.nameOf(r.author)} published a record key`,
    'notice.post': (r) => `${d.nameOf(r.author)} posted a notice: ${r.payload.act.title}`,
    'epoch.open': (r) => `Key period ${r.payload.act.n} opened, for ${Object.keys(r.payload.act.wraps).length}`,
  };
  // Otherwise the kind's own words: an effect describes itself (a decision's
  // records carry the effect's fields), as the vote page already shows them.
  const describe = (r) => {
    if (DESCRIBE[r.kind]) return DESCRIBE[r.kind](r);
    const eff = d.registry().effects?.get(r.kind);
    if (eff?.describe) { try { return eff.describe(r.payload); } catch { /* fall through */ } }
    return `${r.kind}${r.author ? ` · ${d.nameOf(r.author)}` : ''}`;
  };
  function lately(n = 8) {
    const rs = d.records().filter(r => r && r.kind && r.kind !== 'ballot.cast').slice(-n).reverse();
    return rs.length ? kit.feed(rs.map(r => ({ when: d.day(r.at), text: describe(r) }))) : kit.empty('—');
  }

  // ── Home ────────────────────────────────────────────────────────────────
  function home() {
    const st = d.state(), p = d.me(), at = now();
    const open = Object.values(st.proposals).filter(x => !x.closed);
    const mine = (x) => p && p.status === 'active' && x.roll.includes(p.id) && at <= x.deadline && !E.tally(st, x.id).counted.some(b => b.by === p.id);
    const due = open.filter(mine).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const rest = open.filter(x => !due.includes(x)).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const active = st.order.filter(id => st.participants[id].status === 'active').length;
    const out = [];
    if (!p) out.push(d.youPanel());
    out.push(h('section', {}, kit.stats(kit.stat(active, t('home.members')), kit.stat(open.length, t('home.open.n')), kit.stat(d.records().length, t('home.records'))),
      h('p', { class: 'read' }, d.decidesText())));
    if (p && p.status === 'active') out.push(h('section', {}, kit.heading(t('home.needs'), 1),
      due.length ? kit.cards(due.map(x => proposalCard(x, { urgent: true }))) : kit.empty(t('home.none.needs'))));
    out.push(h('section', {}, kit.heading(t('home.open'), 2),
      rest.length ? kit.cards(rest.map(x => proposalCard(x))) : kit.empty(open.length ? t('home.none.others') : t('home.none.open')),
      h('p', { class: 'buttons' }, h('a', { href: '#/votes' }, t('home.all')), p && p.status === 'active' ? h('a', { href: '#/compose', class: 'button-link' }, `＋ ${t('home.propose')}`) : null)));
    out.push(h('section', {}, kit.heading(t('home.recent'), 3), lately()));
    out.push(h('section', {}, kit.heading(t('home.health'), 4), kit.cards(health())));
    const extra = d.moduleCards();
    if (extra.length) out.push(h('section', {}, kit.heading(t('home.modules'), 5), kit.cards(extra)));
    // Your key and how it is kept: last for a member (first, above, for anyone else).
    if (p) out.push(...[].concat(d.youPanel()));
    return out;
  }
  function health() {
    const v = d.verified(), st = d.state(), S = E.sealing, sealed = d.sealed();
    const ep = S.currentEpoch(st), p = d.me();
    const copy = kit.card({ title: v.ok ? t('h.verified') : t('h.broken'), tone: v.ok ? 'good' : 'bad',
      body: [h('p', { class: 'meta' }, `${v.count} ${t('home.records')}${sealed ? ` · ${sealed} ${t('h.sealed')}, ${v.count - sealed} ${t('h.public')}` : ''}`),
        h('p', { class: 'fine' }, h('a', { href: '#/record' }, d.short(st.head.hash || '')))] });
    const period = S.sealingOn(st) ? kit.card({ title: `${t('h.period')} ${ep ? ep.n : '—'}`,
      body: [h('p', { class: 'meta' }, ep ? ep.members.map(d.nameOf).join(', ') : ''), sealed ? kit.badge(t('h.sealed'), 'lock') : null,
        p && sealed ? h('p', { class: 'fine' }, t('h.reads')) : null] }) : null;
    const you = kit.card({ title: p ? `${t('h.you')}: ${d.nameOf(p.id)}` : t('h.out'),
      body: [p ? h('p', { class: 'meta' }, `${p.id} · ${p.status}`) : h('p', { class: 'fine' }, h('a', { href: 'signin' }, 'Sign in'))] });
    return [copy, period, you];
  }

  // ── the composer ────────────────────────────────────────────────────────
  function terms(name) {
    const r = d.params().rules[name];
    return `${Math.round(r.quorum * 100)}% must vote; ${Math.round(r.threshold * 100)}% of decisive votes${r.readings > 1 ? `; ${r.readings} readings, ${r.apart} days apart` : ''}`;
  }
  function compose(path) {
    const P = d.params(), p = d.me();
    if (!p || p.status !== 'active') return h('section', {}, kit.heading(t('c.heading')), h('p', {}, 'Only an active member can propose. '), d.youPanel());
    const changeable = P.keys().filter(k => P.rule(k).changeable !== false);
    let key = path[0] && changeable.includes(path[0]) ? path[0] : '';
    const title = h('input', { id: 'c-title', autocomplete: 'off' });
    const text = h('textarea', { id: 'c-text', class: 'read', rows: 4, style: 'font-family:var(--read)' });
    const find = h('input', { type: 'search', placeholder: t('c.find'), 'aria-label': t('c.find') });
    const picker = h('div', { class: 'picker', role: 'group', 'aria-label': t('c.what') });
    const detail = h('div', {}), preview = h('div', { class: 'preview', 'aria-live': 'polite' }), ruleBox = h('div', { class: 'rule-box' });
    const draw = () => {
      const q = find.value.trim().toLowerCase();
      const opts = [['', t('c.motion'), '']].concat(changeable.filter(k => !q || k.includes(q) || (P.def(k).describe || '').toLowerCase().includes(q))
        .map(k => [k, k, P.def(k).describe || '']));
      picker.replaceChildren(...opts.slice(0, 80).map(([k, label, what]) => h('button', { type: 'button', 'aria-pressed': String(k === key),
        onclick: () => { key = k; draw(); } }, label, what ? h('small', {}, what.length > 110 ? `${what.slice(0, 110)}…` : what) : null)));
      detail.replaceChildren();
      if (key) {
        const def = P.def(key);
        detail.append(h('label', { for: 'lay-value' }, `${t('c.new')} · ${key}`), d.valueInput(key, def));
        detail.querySelector('#lay-value')?.addEventListener('input', update);
        detail.querySelector('#lay-value')?.addEventListener('change', update);
      }
      update();
    };
    const update = () => {
      const r = key ? P.rule(key).name : P.ruleOrder()[0];
      ruleBox.replaceChildren(...[h('strong', {}, `${t('c.rule')}: ${r}`), h('div', { class: 'fine' }, terms(r)),
        P.rules[r].readings > 1 ? kit.timeline(Array.from({ length: P.rules[r].readings }, (_, i) => ({ text: `${t('v.reading')} ${i + 1}`, when: i ? `+${i * P.rules[r].apart} ${t('when.d')}` : t('v.now'), state: i ? 'future' : 'now' }))) : null].filter(Boolean));
      if (!key) { preview.replaceChildren(h('strong', {}, t('c.preview')), h('p', { class: 'fine' }, t('c.motion.does'))); return; }
      const def = P.def(key);
      let to; try { to = d.readValue(key, def); } catch { to = undefined; }
      preview.replaceChildren(h('strong', {}, t('c.preview')), h('div', {}, h('code', {}, key), ': ', fmt(def, def.value), h('span', { class: 'arrow' }, '→'), to === undefined ? '…' : fmt(def, to)));
    };
    find.addEventListener('input', draw);
    queueMicrotask(draw);
    const submit = () => {
      const tt = title.value.trim();
      if (!tt) return alert(t('c.notitle'));
      const fields = { title: tt, text: text.value.trim() || undefined, rule: key ? P.rule(key).name : P.ruleOrder()[0] };
      if (key) {
        const def = P.def(key);
        let v; try { v = d.readValue(key, def); } catch (e) { return alert(e.message); }
        if (JSON.stringify(v) === JSON.stringify(def.value)) return alert(t('c.same'));
        const why = P.check(key, v); if (why) return alert(why);
        fields.changes = { [key]: v };
      }
      d.sign('proposal.lay', fields, `“${tt}” (${fields.rule})`);
    };
    return h('section', { class: 'compose' }, kit.heading(t('c.heading')),
      h('div', {}, h('label', { for: 'c-title' }, t('c.title')), title),
      h('div', {}, h('label', { for: 'c-text' }, t('c.text')), text),
      h('div', {}, h('label', {}, t('c.what')), find, picker),
      detail, preview, ruleBox,
      h('div', { class: 'buttons' }, h('button', { onclick: submit }, t('c.sign'))));
  }

  // ── settings, from their own descriptions ───────────────────────────────
  function fmt(def, v) {
    if (v === undefined || v === null) return h('code', {}, t('s.none'));
    if (def.type === 'boolean') return h('span', { class: 'now' }, v ? t('s.yes') : t('s.no'));
    if (def.type === 'fraction') return h('span', { class: 'now' }, `${Math.round(v * 1000) / 10}%`);
    if (Array.isArray(v)) return v.length ? h('span', { class: 'chips' }, v.map(x => h('code', {}, String(x)))) : h('code', {}, t('s.none'));
    if (typeof v === 'object') return h('code', {}, JSON.stringify(v));
    return h('span', { class: 'now' }, String(v));
  }
  function settingsList() {
    const P = d.params(), p = d.me(), can = p && p.status === 'active';
    const groups = {};
    for (const k of P.keys()) (groups[P.def(k).group || 'Other'] ||= []).push(k);
    const find = h('input', { type: 'search', class: 'find', placeholder: t('s.search'), 'aria-label': t('s.search'), oninput: (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const g of e.target.closest('section').querySelectorAll('[data-group]')) {
        let any = false;
        for (const row of g.querySelectorAll('.setting')) { const hit = !q || row.textContent.toLowerCase().includes(q); row.hidden = !hit; any ||= hit; }
        g.hidden = !any;
      }
    } });
    return h('section', {}, kit.heading(t('s.heading')), find,
      Object.entries(groups).map(([g, ks]) => h('div', { 'data-group': g }, h('h3', { style: 'margin-top:1.2rem' }, g),
        ks.map(k => {
          const def = P.def(k), r = P.rule(k), fixed = r.changeable === false;
          return h('div', { class: 'setting' },
            h('div', { class: 'key' }, h('a', { href: `#/settings/${k}` }, k), ' ', fixed ? kit.badge(t('s.fixed')) : kit.badge(t('s.by', { rule: r.name }))),
            h('div', { class: 'value' }, fmt(def, def.value), P.isSet(k) ? null : h('span', { class: 'fine' }, t('s.default')),
              can && !fixed ? h('button', { class: 'quiet', onclick: () => { location.hash = `#/compose/${k}`; } }, t('s.change')) : null),
            h('div', { class: 'what' }, def.describe || ''));
        }))));
  }

  // ── a proposal's life, as a timeline ────────────────────────────────────
  function voteTimeline(x) {
    const st = d.state(), chain = [];
    for (let q = x; q; q = q.reading_of ? st.proposals[q.reading_of] : null) chain.unshift(q);
    const items = [];
    for (const q of chain) {
      items.push({ when: d.when(q.at), text: `${t('v.laid')} · ${t('v.reading')} ${q.reading}/${q.terms.readings} · ${d.nameOf(q.by)}`, state: 'done' });
      if (q.closed) items.push({ when: d.when(q.closed.at), text: q.closed.carried ? `${t('v.closed')}: carried${q.enacted && !q.next ? ` · ${t('v.enacted')}` : ''}` : `${t('v.closed')}: not carried`, state: 'done' });
    }
    if (!x.closed) items.push({ when: `${d.when(x.deadline)} (${until(x.deadline)})`, text: t('v.closes'), state: 'now' });
    for (let n = x.reading + 1; !x.closed && n <= x.terms.readings; n++) items.push({ text: `${t('v.reading')} ${n}/${x.terms.readings}`, when: `+${x.terms.apart} ${t('when.d')}`, state: 'future' });
    return kit.timeline(items);
  }

  // ── the record's health: verified, sealed, key periods, checkpoints ──────
  function recordHealth() {
    const st = d.state(), S = E.sealing, s = S.sealingState(st), cards = [...health()];
    if (S.sealingOn(st) && s.epochs.length) {
      cards.push(kit.card({ title: `${t('h.period')}s`, body: kit.timeline(s.epochs.slice().reverse().slice(0, 6).map((e, i) => ({
        when: d.day(e.at), text: `${e.n} · ${e.members.map(d.nameOf).join(', ')}`, state: i ? 'done' : 'now' }))) }));
    }
    return h('section', {}, kit.heading(t('home.health')), kit.cards(cards.filter(Boolean)));
  }

  return { home, compose, settingsList, meters, voteTimeline, proposalCard, fmt, describe, recordHealth };
}
