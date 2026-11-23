// signin.js · the way in, off the house Wi-Fi: the house password (to read the
// wiki), a member's own password (everything else), or asking to join.
import { $, get, post, keyFor, signIn, applyAct } from '/hub.js';
import { passwordProblem } from '/kernel/password.js';

const say = (el, text, bad = false) => { el.textContent = text; el.className = bad ? 'msg bad' : 'msg'; };
const memberOnly = new URLSearchParams(location.search).has('member');
let entity = null;

(async () => {
  try { const b = await get('/signin/brand'); if (b.name) { $('#name').textContent = b.name; document.title = b.name; } } catch { /* the default name */ }
  try { entity = (await get('/auth/info')).entity; } catch { /* sign-in reports it */ }
  let st = null; try { st = await get('/house/status'); } catch { /* not a house hub */ }
  if (st?.access === 'member') return location.replace('/');
  if (st?.access && !memberOnly) return location.replace('/');     // on the house Wi-Fi, or the password is already in
  if (memberOnly || !st?.password) { $('#house').hidden = true; $('#split').hidden = true; }
})();

$('#house').addEventListener('submit', async (ev) => {
  ev.preventDefault(); const m = $('#hp-msg');
  say(m, '…');
  try { await post('/auth/house', { password: $('#hp').value }); location.replace('/'); } catch (e) { say(m, e.message, true); }
});

$('#member').addEventListener('submit', async (ev) => {
  ev.preventDefault(); const m = $('#pw-msg'), id = $('#id').value.trim().toLowerCase();
  if (!id || !$('#pw').value) return say(m, 'Your id and password.', true);
  say(m, 'Signing in…');
  try {
    const key = await keyFor(entity, id, $('#pw').value);
    const { challenge } = await post('/auth/challenge', {});
    await post('/auth/verify', { id, challenge, signature: await signIn(entity, challenge, key) });
    location.replace('/');
  } catch (e) { say(m, e.message, true); }
});

const show = (join) => { $('#member').hidden = join; $('#join').hidden = !join; (join ? $('#j-id') : $('#id')).focus(); };
$('#to-join').addEventListener('click', () => show(true));
$('#to-member').addEventListener('click', () => show(false));

$('#join').addEventListener('submit', async (ev) => {
  ev.preventDefault(); const m = $('#j-msg'), id = $('#j-id').value.trim().toLowerCase(), pw = $('#j-pw').value;
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return say(m, 'An id is lowercase letters, digits and -.', true);
  if (pw !== $('#j-pw2').value) return say(m, 'The two passwords differ.', true);
  const why = passwordProblem(pw, id); if (why) return say(m, why, true);
  say(m, 'Sending…');
  try {
    const key = await keyFor(entity, id, pw);
    const r = await post('/auth/apply', await applyAct(entity, id, key, $('#j-name').value.trim()));
    if (r.refused?.length) throw new Error(r.refused[0].why);
    say(m, 'Sent. An admin will let you in; then sign in with this id and password.');
    $('#join').reset();
  } catch (e) { say(m, e.status === 403 ? 'Joining works from the house Wi-Fi, or after typing the house password.' : e.message, true); }
});
