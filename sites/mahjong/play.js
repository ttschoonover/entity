// play.js · the solo page. Two ways to play against the AIs:
//   just for fun   nothing leaves this browser; the game is saved here so you can come back to it
//   for my profile the deal is signed first (its record's hash is the shuffle), the finished
//                  game is signed after, and the record replays it before it counts
import { start, ctx, h, $, me, sign, onChange, enabled, displayName } from './common.js';
import { soloGame } from './solo.js';

const SAVE = 'mj:solo';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
const randomSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
let game = null;

function settings() {
  const lv = Number($('#mj-level').value);
  const mixed = $('#mj-mixed').open;
  const opponents = mixed ? ['#mj-l1', '#mj-l2', '#mj-l3'].map(s => Number($(s).value)) : [lv, lv, lv];
  return { opponents, rules: { minFaan: Number($('#mj-min').value), flowers: $('#mj-flowers').checked, rounds: Number($('#mj-rounds').value) } };
}
const names = (opp) => ['You', ...opp.map((l, i) => `${['South', 'West', 'North'][i]} AI`)];

function begin({ seed, seats, rules, moves = [], profileGame = null }) {
  game?.stop();
  $('#setup').hidden = true; $('#game').hidden = false;
  $('#mj-mode').textContent = profileGame ? 'For your profile: this game is recorded when it ends.' : 'Just for fun: nothing is recorded.';
  game = soloGame($('#table'), $('#result'), {
    seats, rules, seed, names: names(seats.slice(1)), moves,
    onChange: ({ moves: mv }) => write(profileGame ? `mj:game:${profileGame}` : SAVE, { seed, seats, rules, moves: mv, profileGame }),
    onOver: async ({ m, moves: mv }) => {
      write(profileGame ? `mj:game:${profileGame}` : SAVE, null);
      const after = h('div', { class: 'mj-after' });
      $('#result').querySelector('.mj-result')?.append(after);
      if (profileGame) {
        after.append(h('p', {}, 'Sign the finished game to add it to your profile. The record replays every move before it counts.'),
          h('button', { class: 'mj-act a-win', type: 'button', onclick: async () => {
            const r = await sign('mahjong.finish', { game: profileGame, moves: mv }, 'Your finished game');
            if (r) after.replaceChildren(h('p', {}, 'Recorded. ', h('a', { href: 'hall.html#/mahjong' }, 'See your profile'), '.'));
          } }, 'Record it'));
      }
      after.append(h('button', { class: 'mj-act', type: 'button', onclick: () => { game?.stop(); $('#game').hidden = true; $('#setup').hidden = false; drawSetup(); } }, 'New game'));
      void m;
    },
  });
}

async function startProfile() {
  const s = settings();
  const r = await sign('mahjong.deal', s, 'Deal a game for your profile');
  if (!r) return;
  const at = r[0].act.at;
  const g = Object.values(ctx.r.state.m.mahjong?.games || {}).find(x => x.by === me().id && x.at === at);
  if (!g) return alert('The deal was signed but has not reached the record yet. Reload in a moment and resume it.');
  begin({ seed: g.seed, seats: g.seats, rules: s.rules, profileGame: g.id });
}

function drawSetup() {
  const p = me(), on = ctx.r?.ok && enabled('mahjong');
  const canProfile = on && p?.status === 'active';
  $('#mj-profile').disabled = !canProfile;
  $('#mj-profile-note').replaceChildren(canProfile ? `Signed in as ${displayName(p.id)}.` : on ? 'Sign in as a member (top of the page) to play for your profile.' : 'Profiles need this world\'s mahjong module.');
  const saved = read(SAVE);
  const box = $('#mj-resume');
  box.replaceChildren();
  if (saved) box.append(h('button', { class: 'mj-act', type: 'button', onclick: () => begin(saved) }, 'Resume your game'), ' ');
  if (canProfile) {
    const open = Object.values(ctx.r.state.m.mahjong?.games || {}).filter(g => g.by === p.id && g.status === 'playing');
    for (const g of open) {
      const local = read(`mj:game:${g.id}`);
      box.append(h('button', { class: 'mj-act', type: 'button', onclick: () => begin({ seed: g.seed, seats: g.seats, rules: g.rules, moves: local?.moves || [], profileGame: g.id }) },
        local ? `Resume profile game ${g.id.slice(3, 9)}` : `Replay profile game ${g.id.slice(3, 9)} from the start`), ' ');
    }
  }
}

$('#mj-start').addEventListener('click', () => {
  const s = settings();
  if ($('#mj-profile').checked && !$('#mj-profile').disabled) return startProfile();
  begin({ seed: randomSeed(), seats: ['human', ...s.opponents], rules: s.rules });
});
$('#mj-quit').addEventListener('click', () => { if (confirm('Leave this game? A game just for fun stays saved here; a profile game can be resumed in this browser.')) { game?.stop(); $('#game').hidden = true; $('#setup').hidden = false; drawSetup(); } });

await start();
drawSetup();
onChange(() => { if ($('#game').hidden) drawSetup(); });
