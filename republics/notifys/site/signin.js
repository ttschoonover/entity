// signin.js · signing in, or asking to join as a resident of a house.
// Nothing secret leaves the browser: the password makes a key here, which signs.
import { $, h, get, post, keyFor, signIn } from '/hub.js';
import * as keys from '/kernel/keys.js';
import { canonical } from '/kernel/canonical.js';
import { passwordProblem } from '/kernel/password.js';

const say = (el, text, bad = false) => { el.textContent = text; el.className = bad ? 'msg bad' : 'msg'; };
let entity = null;

(async () => {
  try { entity = (await get('/auth/info')).entity; } catch { /* sign-in reports it */ }
  try {
    const { houses } = await get('/m/notifys/houses');
    $('#j-house').replaceChildren(h('option', { value: '', disabled: true, selected: houses.length !== 1 }, 'Choose your house'),
      ...houses.map(x => h('option', { value: x.id, selected: houses.length === 1 }, x.name)));
  } catch { /* the form says so on send */ }
})();

// Two tabs: sign in, ask to join.
const show = (join) => {
  $('#member').hidden = join; $('#join').hidden = !join;
  $('#tab-in').setAttribute('aria-pressed', String(!join)); $('#tab-join').setAttribute('aria-pressed', String(join));
  $('#tab-in').className = join ? 'secondary outline' : ''; $('#tab-join').className = join ? '' : 'secondary outline';
};
$('#tab-in').addEventListener('click', () => show(false));
$('#tab-join').addEventListener('click', () => show(true));

$('#member').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const m = $('#pw-msg'), id = $('#id').value.trim().toLowerCase();
  if (!id || !$('#pw').value) return say(m, 'Your username and password.', true);
  say(m, 'Signing in…');
  try {
    const key = await keyFor(entity, id, $('#pw').value);
    const { challenge } = await post('/auth/challenge', {});
    await post('/auth/verify', { id, challenge, signature: await signIn(entity, challenge, key) });
    location.replace('/');
  } catch (e) { say(m, e.message, true); }
});

$('#join').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const m = $('#j-msg'), id = $('#j-id').value.trim().toLowerCase(), pw = $('#j-pw').value, house = $('#j-house').value, name = $('#j-name').value.trim();
  if (!house) return say(m, 'Choose the house you live in.', true);
  if (!name) return say(m, 'Your name, so your house can recognise you.', true);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return say(m, 'A username is lowercase letters, digits and -.', true);
  if (pw !== $('#j-pw2').value) return say(m, 'The two passwords differ.', true);
  const why = passwordProblem(pw, id); if (why) return say(m, why, true);
  say(m, 'Sending…');
  try {
    const key = await keyFor(entity, id, pw);
    const act = { kind: 'participant.apply', salt: [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''),
      entity, by: id, at: new Date().toISOString(), key: keys.publicKeyLine(key.publicKey), name, about: { house } };
    act.signature = await keys.sign(canonical(act), key, 'entity.act');
    const r = await post('/auth/apply', act);
    if (r.refused?.length) throw new Error(r.refused[0].why);
    say(m, 'Sent. Your house\'s emergency manager will check it; then sign in with this username and password.');
    $('#join').reset();
  } catch (e) { say(m, e.message, true); }
});
