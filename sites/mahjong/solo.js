// solo.js · one person against three AIs, entirely in this browser. Used by
// the world's solo page (just for fun, or for a profile) and by the offline file.
//
//   const g = soloGame(table, resultBox, { seats, rules, seed, names, moves?, onChange, onOver })
// seed decides every wall (one per hand, derived from it); moves resumes a game.
import { newMatch, startHand, pending, options, act, view, choose, handSeed, DEFAULT_RULES } from './mj-engine.js';
import { drawTable, drawResult } from './mj-ui.js';

const PACE = 550; // ms between AI moves, so a person can follow them

export function soloGame(table, resultBox, { seats, rules = {}, seed, names, moves = [], onChange, onOver, paced = true }) {
  const m = newMatch({ rules: { ...DEFAULT_RULES, ...rules }, seats, names });
  const mine = [];       // the human's decisions, in order: all a replay needs
  const queue = moves.slice();
  let hand = 0, timer = null, stopped = false;

  const draw = () => { drawTable(table, view(m, 0), { onAct: human }); drawResult(resultBox, view(m, 0), resultOpts()); onChange?.({ m, moves: mine }); };
  const resultOpts = () => (m.phase === 'over' ? { final: finalLine() } : { next: () => { nextHand(); } });
  const finalLine = () => {
    const order = [0, 1, 2, 3].sort((a, b) => m.scores[b] - m.scores[a]);
    return `Final: ${order.map(s => `${m.names[s]} ${m.scores[s]}`).join(' · ')}`;
  };

  function nextHand() {
    if (m.phase === 'over') return;
    startHand(m, handSeed(seed, hand++));
    loop();
  }
  function human(a) {
    if (stopped || !pending(m).includes(0)) return;
    act(m, 0, a); mine.push(a);
    loop();
  }
  // Let the AIs play, one move at a time, until it is the person's turn or the hand ends.
  function loop() {
    clearTimeout(timer);
    if (stopped) return;
    if (m.phase !== 'play') { draw(); if (m.phase === 'over') onOver?.({ m, moves: mine }); return; }
    // Replaying a saved game: feed the saved decisions back without pausing.
    if (queue.length && pending(m).includes(0)) { const a = queue.shift(); act(m, 0, a); mine.push(a); return loop(); }
    const ai = pending(m).filter(s => s !== 0);
    if (ai.length) {
      const go = () => { for (const s of pending(m).filter(x => x !== 0)) { if (!pending(m).includes(s)) continue; act(m, s, choose(m, s, seats[s])); if (m.phase !== 'play') break; } loop(); };
      if (paced && !queue.length && pending(m).includes(0) === false && m.hand.stage === 'discard') { draw(); timer = setTimeout(go, PACE); return; }
      return go();
    }
    draw();
  }

  // A resumed game skips the hands it already finished.
  startHand(m, handSeed(seed, hand++));
  loop();
  while (queue.length && m.phase === 'between') { startHand(m, handSeed(seed, hand++)); loop(); }
  return { match: m, moves: mine, stop: () => { stopped = true; clearTimeout(timer); }, options: () => options(m, 0) };
}
