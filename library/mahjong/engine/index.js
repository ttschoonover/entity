// The mahjong engine: tiles, rules, the game and its AI, plus replay.
export * from './tiles.js';
export { winningShapes, shanten, score, bestScore, payments, base, LIMIT } from './rules.js';
export { newMatch, startHand, pending, options, act, view, seatWind, sameAction, DEFAULT_RULES } from './game.js';
export { choose } from './ai.js';
export { rngFrom, H } from './rng.js';
import { newMatch, startHand, pending, act } from './game.js';
import { choose } from './ai.js';
import { H } from './rng.js';

// A solo game's hand seeds all come from one seed.
export const handSeed = (seed, n) => H(`hand:${seed}:${n}`);

// Play the AIs' moves until a human must decide or the hand ends.
export function runAI(m) {
  for (let guard = 0; guard < 2000; guard++) {
    if (m.phase !== 'play') return m;
    const ai = pending(m).filter(s => m.seats[s] !== 'human');
    if (!ai.length) return m;
    for (const s of ai) { if (!pending(m).includes(s)) continue; act(m, s, choose(m, s, m.seats[s])); if (m.phase !== 'play') return m; }
  }
  throw new Error('the AIs did not finish');
}

// Replay a match from its hand seeds and each human seat's decisions, in order.
// Returns { match, complete, error }: complete when every seed was played out.
export function replay({ rules, seats, names, seeds, moves }) {
  const m = newMatch({ rules, seats, names });
  const queue = (moves || [[], [], [], []]).map(q => q.slice());
  let hand = 0;
  try {
    while (m.phase !== 'over') {
      if (m.phase === 'ready' || m.phase === 'between') {
        if (hand >= seeds.length) return { match: m, complete: false, error: null };
        startHand(m, seeds[hand++]);
      }
      runAI(m);
      if (m.phase !== 'play') continue;
      const human = pending(m).filter(s => m.seats[s] === 'human');
      let moved = false;
      for (const s of human) {
        if (!pending(m).includes(s)) continue;
        const next = queue[s].shift();
        if (!next) continue;
        act(m, s, next); moved = true;
        if (m.phase !== 'play') break;
      }
      if (!moved && m.phase === 'play') return { match: m, complete: false, error: null };
    }
    const leftover = queue.reduce((a, q) => a + q.length, 0);
    return { match: m, complete: true, error: leftover ? `${leftover} decision(s) left over after the match ended` : null };
  } catch (x) { return { match: m, complete: false, error: x.message }; }
}
