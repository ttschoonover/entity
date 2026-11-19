// offline.js · the offline file's own page: settings, a saved game to come
// back to, and the solo table. No network, no record, no account.
import { soloGame } from './solo.js';
import './theme.js';

const $ = (s) => document.querySelector(s);
const SAVE = 'mj:offline';
const read = () => { try { return JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch { return null; } };
const write = (v) => { try { v ? localStorage.setItem(SAVE, JSON.stringify(v)) : localStorage.removeItem(SAVE); } catch { /* a file opened without storage: the game lasts this visit */ } };
const randomSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
let game = null;

function begin({ seed, seats, rules, moves = [] }) {
  game?.stop();
  $('#setup').hidden = true; $('#game').hidden = false;
  game = soloGame($('#table'), $('#result'), {
    seats, rules, seed, moves, names: ['You', 'South AI', 'West AI', 'North AI'],
    onChange: ({ moves: mv }) => write({ seed, seats, rules, moves: mv }),
    onOver: () => {
      write(null);
      const b = document.createElement('button');
      b.className = 'mj-act'; b.type = 'button'; b.textContent = 'New game';
      b.onclick = () => { game?.stop(); $('#game').hidden = true; $('#setup').hidden = false; drawSetup(); };
      $('#result .mj-result')?.append(b);
    },
  });
}
function drawSetup() {
  const saved = read();
  $('#resume').hidden = !saved;
  $('#resume').onclick = () => begin(saved);
}
$('#start').onclick = () => {
  const lv = Number($('#level').value);
  begin({ seed: randomSeed(), seats: ['human', lv, lv, lv], rules: { minFaan: Number($('#min').value), flowers: $('#flowers').checked, rounds: Number($('#rounds').value) } });
};
$('#quit').onclick = () => { game?.stop(); $('#game').hidden = true; $('#setup').hidden = false; drawSetup(); };
drawSetup();
