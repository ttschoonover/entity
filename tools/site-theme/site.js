// tschoonover.com · the few things the pages do in the browser: text size,
// English or French, light or dark, the writing filters, the gallery's + and
// lightbox, and the cat. Everything else is plain HTML from the publisher.
(() => {
  const root = document.documentElement;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

  // ── text size ───────────────────────────────────────────────────────────
  let step = Number(store.get('ts:size') || 0);
  const size = () => root.style.setProperty('--fs', (15 + step) + 'px');
  size();
  document.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    const d = Number(b.dataset.size); step = d === 0 ? 0 : Math.max(-2, Math.min(4, step + d)); store.set('ts:size', step); size();
  }));

  // ── language: every element with data-en / data-fr ──────────────────────
  function lang(l) {
    root.lang = l; store.set('ts:lang', l);
    document.querySelectorAll('[data-lang]').forEach(o => o.setAttribute('aria-pressed', String(o.dataset.lang === l)));
    document.querySelectorAll('[data-en]').forEach(el => { const t = el.dataset[l] || el.dataset.en; if (el.dataset.html !== undefined) el.innerHTML = t; else el.textContent = t; });
  }
  document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => lang(b.dataset.lang)));
  if (store.get('ts:lang') === 'fr') lang('fr');

  // ── light and dark ──────────────────────────────────────────────────────
  const saved = store.get('ts:mode');
  if (saved === 'dark' || saved === 'light') root.dataset.theme = saved;
  const modeBtn = document.getElementById('mode');
  if (modeBtn) modeBtn.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark'; store.set('ts:mode', root.dataset.theme);
  });

  // ── writing: filter by form ─────────────────────────────────────────────
  const tagButtons = document.querySelectorAll('.tags button');
  tagButtons.forEach(b => b.addEventListener('click', () => {
    tagButtons.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    const t = b.dataset.tag;
    document.querySelectorAll('[data-form]').forEach(li => { li.hidden = t !== 'all' && li.dataset.form !== t; });
    document.querySelectorAll('.year').forEach(y => { const list = y.nextElementSibling; y.hidden = list && ![...list.children].some(li => !li.hidden); });
  }));

  // ── the gallery: + shows more, a click opens the full picture ───────────
  document.querySelectorAll('[data-gallery]').forEach(g => {
    const per = Number(g.dataset.per || 6), items = [...g.querySelectorAll('.photo')];
    let shown = Number(g.dataset.initial || per);
    const foot = g.parentElement.querySelector('.gal-foot'), count = foot?.querySelector('.count'), plus = foot?.querySelector('.plus');
    const draw = () => {
      items.forEach((x, i) => { x.hidden = i >= shown; });
      if (count) count.textContent = `${Math.min(shown, items.length)} / ${items.length}`;
      if (plus) plus.hidden = shown >= items.length;
    };
    plus?.addEventListener('click', () => { shown += per; draw(); });
    draw();
  });
  document.addEventListener('click', (e) => {
    const p = e.target.closest('.photo[data-full]');
    if (!p) return;
    const box = document.createElement('div');
    box.className = 'lightbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', p.dataset.caption || 'Photograph');
    const fig = document.createElement('figure'); fig.style.margin = '0';
    const img = document.createElement('img'); img.src = p.dataset.full; img.alt = p.dataset.caption || '';
    fig.append(img);
    if (p.dataset.caption) { const c = document.createElement('p'); c.textContent = p.dataset.caption; fig.append(c); }
    box.append(fig); document.body.append(box);
    const close = () => { box.remove(); document.removeEventListener('keydown', esc); p.focus(); };
    const esc = (k) => { if (k.key === 'Escape') close(); };
    box.addEventListener('click', close); document.addEventListener('keydown', esc);
  });

  // ── the cat: watches the cursor, spins when clicked ─────────────────────
  const cat = document.getElementById('cat');
  if (cat) {
    const note = document.getElementById('cat-note');
    const pupils = [...cat.querySelectorAll('.pupil')].map(p => [p, Number(p.getAttribute('cx')), Number(p.getAttribute('cy'))]);
    addEventListener('pointermove', (e) => {
      const r = cat.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * 0.53;
      const a = Math.atan2(e.clientY - cy, e.clientX - cx);
      for (const [p, x, y] of pupils) { p.setAttribute('cx', x + Math.cos(a) * 2.1); p.setAttribute('cy', y + Math.sin(a) * 2.1); }
      if (cat.classList.contains('img')) { const lean = Math.max(-14, Math.min(14, (e.clientX - cx) / 40)); cat.style.setProperty('--lean', lean + 'deg'); if (!cat.classList.contains('spin')) cat.style.transform = `rotate(${lean}deg)`; }
    }, { passive: true });
    cat.addEventListener('click', () => {
      cat.classList.remove('spin'); void cat.offsetWidth; cat.classList.add('spin');
      if (note) { note.classList.add('show'); clearTimeout(cat._t); cat._t = setTimeout(() => note.classList.remove('show'), 1100); }
    });
    cat.addEventListener('animationend', () => cat.classList.remove('spin'));
  }
})();
