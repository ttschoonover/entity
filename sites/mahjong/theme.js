// theme.js · the table's look, chosen with a row of swatches and kept in a
// cookie (mj_theme, a year, this site only), with a copy in local storage for
// the offline file, which browsers do not give cookies. A tiny script in each
// page's <head> applies it before anything is drawn, so the page never flashes.
export const THEMES = [
  { id: 'traditional', name: 'Traditional', table: '#4A1C14', rim: '#A47F33', tile: '#FBF6EA', back: '#2E7D5B' },
  { id: 'minimal', name: 'Minimal', table: '#FAFAF8', rim: '#E6E6E1', tile: '#EFEFEB', back: '#DADAD4' },
  { id: 'swiss', name: 'Swiss', table: '#FFFFFF', rim: '#000000', tile: '#FFFFFF', back: '#E30613' },
  { id: 'fancy', name: 'Art Deco', table: '#0B0B0C', rim: '#C9A54C', tile: '#FFFBF0', back: '#C9A54C' },
  { id: 'arcade', name: 'Arcade', table: '#1A1440', rim: '#FF4FA3', tile: '#F5F1FF', back: '#4F3BD9' },
  { id: 'contrast', name: 'High contrast', table: '#000000', rim: '#FFFFFF', tile: '#FFFFFF', back: '#FFD400' },
];
// Names from the first version of the picker, so a saved choice still lands somewhere sensible.
const OLD = { rosewood: 'traditional', jade: 'traditional', paper: 'minimal', neon: 'arcade' };
const COOKIE = 'mj_theme', YEAR = 365 * 24 * 3600;

export function current() {
  const m = document.cookie.match(/(?:^|;\s*)mj_theme=([a-z]+)/);
  let t = m ? m[1] : null;
  if (!t) { try { t = localStorage.getItem('mj:theme'); } catch { /* none */ } }
  t = OLD[t] || t;
  return THEMES.some(x => x.id === t) ? t : 'traditional';
}
export function choose(id) {
  if (!THEMES.some(x => x.id === id)) return;
  if (id === 'traditional') delete document.documentElement.dataset.mjTheme; else document.documentElement.dataset.mjTheme = id;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${id}; Max-Age=${YEAR}; Path=/; SameSite=Lax${secure}`;
  try { localStorage.setItem('mj:theme', id); } catch { /* the cookie is enough */ }
  const now = current();
if (now === 'traditional') delete document.documentElement.dataset.mjTheme; else document.documentElement.dataset.mjTheme = now;
draw();
}

// Every [data-mj-themes] on the page becomes a picker.
export function draw(root = document) {
  const now = current();
  for (const box of root.querySelectorAll('[data-mj-themes]')) {
    box.classList.add('mj-themes');
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Table look');
    box.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Table' }), ...THEMES.map(t => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mj-swatch'; b.setAttribute('aria-pressed', String(t.id === now));
      b.style.cssText = `--sw-table:${t.table};--sw-rim:${t.rim};--sw-tile:${t.tile};--sw-back:${t.back}`;
      b.append(document.createElement('i'), t.name);
      b.addEventListener('click', () => choose(t.id));
      return b;
    }));
  }
}
const now = current();
if (now === 'traditional') delete document.documentElement.dataset.mjTheme; else document.documentElement.dataset.mjTheme = now;
draw();
