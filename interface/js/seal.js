// The founding seal: an emblem drawn only from an entity's first record.
//
// seal(genesisHash, { name, founded, colors }) returns an SVG string. The same
// hash always gives the same seal, so anyone holding the record can redraw it
// and check that a seal is genuine: it is a picture of the entity's first act.
//
//   ring    64 ticks, one per hex digit of the hash; a tick's length is the digit
//   star    5 to 12 points (byte 0), turned by byte 1, its waist set by byte 2
//   lattice up to 8 chords (bytes 3 to 12) joining the star's inner corners
//   rim     the name, the founding day and the first 16 digits of the hash
//
// Nothing else goes in: no randomness, no clock, no font metrics that change
// the geometry. Text sits on a circle; only its rendering depends on the font.

const TAU = Math.PI * 2;
const f = (n) => Math.round(n * 100) / 100;

export function sealGeometry(hash) {
  const hex = String(hash).toLowerCase().replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('seal: the genesis hash must be 64 hex digits');
  const b = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const at = (r, a) => `${f(r * Math.sin(a))} ${f(-r * Math.cos(a))}`;

  let ring = '';
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU, len = 3 + parseInt(hex[i], 16) * 0.8;
    ring += `M${at(76, a)}L${at(76 + len, a)}`;
  }

  const k = 5 + (b(0) % 8), turn = (b(1) / 256) * (TAU / k), waist = 0.32 + (b(2) / 255) * 0.36;
  let star = '';
  for (let i = 0; i < k * 2; i++) {
    const a = turn + (i / (k * 2)) * TAU, r = i % 2 ? 58 * waist : 58;
    star += (i ? 'L' : 'M') + at(r, a);
  }
  star += 'Z';

  const spokes = 3 + (b(3) % 6), seen = new Set();
  let lattice = '';
  for (let s = 0; s < spokes; s++) {
    const i = (s * (1 + (b(4) % 3))) % k, j = (i + 2 + (b(5 + s) % Math.max(1, k - 3))) % k;
    const key = [i, j].sort((x, y) => x - y).join('-');
    if (i === j || seen.has(key)) continue; seen.add(key);
    const va = turn + ((2 * i + 1) / (k * 2)) * TAU, vb = turn + ((2 * j + 1) / (k * 2)) * TAU;
    lattice += `M${at(58 * waist, va)}L${at(58 * waist, vb)}`;
  }
  return { hex, ring, star, lattice, points: k, spokes };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function seal(hash, { name = '', founded = '', colors = {}, id = 'seal' } = {}) {
  const g = sealGeometry(hash);
  const c = { field: '#23408E', accent: '#C7A33B', light: '#F3F4F0', ...colors };
  const rim = `${name.toUpperCase()} · FOUNDED ${founded} · ${g.hex.slice(0, 16).toUpperCase()}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-120 -120 240 240" role="img" aria-label="Founding seal of ${esc(name)}">
<circle r="119" fill="${c.field}"/>
<circle r="114" fill="none" stroke="${c.accent}" stroke-width="1.5"/>
<circle r="96" fill="none" stroke="${c.accent}" stroke-width="0.8"/>
<path id="${id}-rim" d="M0 105A105 105 0 1 1 0.01 105" fill="none"/>
<text font-family="Public Sans, system-ui, sans-serif" font-size="9.5" letter-spacing="1.6" fill="${c.light}"><textPath href="#${id}-rim" startOffset="50%" text-anchor="middle">${esc(rim)}</textPath></text>
<path d="${g.ring}" stroke="${c.light}" stroke-width="1.6" stroke-linecap="round"/>
<path d="${g.star}" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linejoin="round"/>
<path d="${g.lattice}" stroke="${c.light}" stroke-width="1" opacity="0.7"/>
<circle r="7" fill="${c.accent}"/>
</svg>`;
}
