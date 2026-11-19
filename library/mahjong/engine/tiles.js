// tiles.js · the 144 tiles of Hong Kong mahjong, as short codes.
//
//   m1–m9  characters (萬)    p1–p9  dots (筒)    s1–s9  bamboo (索)
//   zE zS zW zN  winds (東 南 西 北)    zC zF zP  dragons (中 發 白)
//   f1–f4  flowers (梅 蘭 菊 竹)        g1–g4  seasons (春 夏 秋 冬)
//
// The 34 playing kinds have an index 0–33 for counting: suits in order, then
// winds, then dragons. Flowers and seasons are bonus tiles, never in a hand.

export const SUITS = ['m', 'p', 's'];
export const WINDS = ['zE', 'zS', 'zW', 'zN'];
export const DRAGONS = ['zC', 'zF', 'zP'];
export const BONUS = ['f1', 'f2', 'f3', 'f4', 'g1', 'g2', 'g3', 'g4'];
export const KINDS = [...SUITS.flatMap(s => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => s + n)), ...WINDS, ...DRAGONS];
const INDEX = Object.fromEntries(KINDS.map((t, i) => [t, i]));

export const idx = (t) => INDEX[t];
export const kind = (i) => KINDS[i];
export const isBonus = (t) => t[0] === 'f' || t[0] === 'g';
export const isHonor = (t) => t[0] === 'z';
export const isSuited = (t) => SUITS.includes(t[0]);
export const suitOf = (t) => (isSuited(t) ? t[0] : null);
export const num = (t) => (isSuited(t) ? Number(t[1]) : 0);
export const isTerminal = (t) => isSuited(t) && (num(t) === 1 || num(t) === 9);
export const isDragon = (t) => DRAGONS.includes(t);
export const isWind = (t) => WINDS.includes(t);

// The full set, four of each playing kind and one of each bonus tile.
export function fullSet(withBonus = true) {
  const out = [];
  for (const t of KINDS) for (let i = 0; i < 4; i++) out.push(t);
  if (withBonus) out.push(...BONUS);
  return out;
}

const ORDER = (t) => (isBonus(t) ? 100 + BONUS.indexOf(t) : INDEX[t]);
export const sortTiles = (ts) => [...ts].sort((a, b) => ORDER(a) - ORDER(b));

export function counts(ts) {
  const c = new Array(34).fill(0);
  for (const t of ts) if (!isBonus(t)) c[INDEX[t]]++;
  return c;
}

// How tiles are written on their faces, and named in words.
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_CN = { m: '萬', p: '筒', s: '索' };
const SUIT_EN = { m: 'characters', p: 'dots', s: 'bamboo' };
const HONOR = { zE: ['東', 'East wind'], zS: ['南', 'South wind'], zW: ['西', 'West wind'], zN: ['北', 'North wind'], zC: ['中', 'Red dragon'], zF: ['發', 'Green dragon'], zP: ['白', 'White dragon'] };
const FLOWER = { f1: ['梅', 'Plum'], f2: ['蘭', 'Orchid'], f3: ['菊', 'Chrysanthemum'], f4: ['竹', 'Bamboo flower'], g1: ['春', 'Spring'], g2: ['夏', 'Summer'], g3: ['秋', 'Autumn'], g4: ['冬', 'Winter'] };

export function face(t) {
  if (isSuited(t)) return { top: t[0] === 'm' ? CN[num(t)] : String(num(t)), bottom: SUIT_CN[t[0]], suit: t[0] };
  if (HONOR[t]) return { top: HONOR[t][0], bottom: '', suit: isDragon(t) ? t : 'z' };
  if (FLOWER[t]) return { top: FLOWER[t][0], bottom: t[1], suit: t[0] };
  return { top: '?', bottom: '', suit: '' };
}
export function name(t) {
  if (isSuited(t)) return `${num(t)} of ${SUIT_EN[t[0]]}`;
  return (HONOR[t] || FLOWER[t] || [t, t])[1];
}
