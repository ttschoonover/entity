// rng.js · randomness that is never random: a generator seeded from a hash,
// so the same seed always gives the same wall and the same AI choices, on
// every computer. (sfc32, seeded with the first 16 bytes of SHA-256.)
import { hash } from '../../../kernel/hash.js';

export const H = (s) => hash(String(s));

export function rngFrom(seedText) {
  const h = H(seedText);
  let a = parseInt(h.slice(0, 8), 16) >>> 0, b = parseInt(h.slice(8, 16), 16) >>> 0, c = parseInt(h.slice(16, 24), 16) >>> 0, d = parseInt(h.slice(24, 32), 16) >>> 0;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
    const r = (t + d) | 0; c = (c + r) | 0;
    return r >>> 0;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    int: (n) => next() % n,              // 0 … n-1 (n is small, the bias negligible and the same everywhere)
    pick: (xs) => xs[next() % xs.length],
  };
}

export function shuffle(xs, rng) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
