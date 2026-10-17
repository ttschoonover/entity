// The sign-in page of a private republic: proves membership by signing a
// one-time challenge from the node, with a password-derived key, a key file,
// a passkey, or the key this browser keeps. Nothing secret is sent.
import * as keys from '../../kernel/keys.js';
import { passwordKey, passwordProblem } from '../../kernel/password.js';
import { canonical } from '../../kernel/canonical.js';
import { loadIdentity, saveIdentity } from './keystore.js';
import { lockSeed, unlockSeed } from './lock.js';

const $ = (s) => document.querySelector(s);
const post = async (url, data) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}), credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); return { ok: r.ok, ...j }; };
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
let ENTITY = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The documents a candidate must sign, each with a signature pad if needed.
function pad(canvas) {
  const ctx = canvas.getContext('2d'); let drawing = false, used = false;
  const fit = () => { const r = canvas.getBoundingClientRect(); canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = getComputedStyle(document.body).color; };
  requestAnimationFrame(fit);
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.onpointerdown = (e) => { drawing = true; used = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...at(e)); };
  canvas.onpointermove = (e) => { if (drawing) { ctx.lineTo(...at(e)); ctx.stroke(); } };
  canvas.onpointerup = () => { drawing = false; };
  return { used: () => used, png: () => { const c = document.createElement('canvas'); const s = Math.min(1, 480 / canvas.width); c.width = canvas.width * s; c.height = canvas.height * s; c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); return c.toDataURL('image/png'); }, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); used = false; } };
}
async function showDocuments(box, who) {
  const { documents } = await (await fetch(`auth/required${who ? `?for=${encodeURIComponent(who)}` : ''}`, { cache: 'no-store' })).json();
  box.replaceChildren();
  const todo = [];
  for (const d of documents.filter(d => !d.signed)) {
    const el = document.createElement('div'); el.className = 'doc';
    if (d.missing) { el.textContent = `"${d.page}" must be signed before admission, but the members have not enacted it yet. Applications can be sent; signing waits until it is.`; box.append(el); continue; }
    const h = document.createElement('h2'); h.textContent = d.title;
    const body = document.createElement('div'); body.className = 'body'; body.textContent = d.body;
    const note = document.createElement('p'); note.className = 'dim'; note.textContent = d.drawn === 'off' ? 'Signing this records your agreement to exactly this text.' : `Draw your signature below${d.drawn === 'required' ? '' : ' (optional)'}. It is sealed into your signed act.`;
    el.append(h, body, note);
    let p = null;
    if (d.drawn !== 'off') { const c = document.createElement('canvas'); c.className = 'pad'; const clr = document.createElement('button'); clr.type = 'button'; clr.className = 'quiet'; clr.textContent = 'Clear'; el.append(c, clr); p = pad(c); clr.onclick = () => p.clear(); }
    box.append(el);
    todo.push({ d, p });
  }
  return todo;
}
async function signDocuments(todo, id, key) {
  for (const { d, p } of todo) {
    if (d.drawn === 'required' && !p.used()) throw new Error(`draw your signature on "${d.title}" first`);
  }
  for (const { d, p } of todo) {
    await sleep(1200);
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    const act = { kind: 'agreement.sign', salt, entity: ENTITY, by: id, at: new Date().toISOString(), page: d.page, version: d.version, text: d.text, ...(p && p.used() ? { drawing: p.png() } : {}) };
    act.signature = await keys.sign(canonical(act), key, 'entity.act');
    const r = await post('auth/apply', act);
    if (!r.ok || r.refused?.length) throw new Error(`"${d.title}" was not signed: ${r.refused?.[0]?.why || r.why || 'refused'}`);
  }
}

async function signIn(id, signFn, key) {
  const { challenge, why } = await post('auth/challenge');
  if (!challenge) throw new Error(why || 'the node did not answer');
  const signature = await signFn(`entity.signin\n${ENTITY}\n${challenge}`, 'entity.signin');
  let r = await post('auth/verify', { id, challenge, signature });
  if (r.need) { const T = await import('./twofactor.js'); r = await T.finishSignIn(r, T.promptAsk).catch(e => ({ why: e.message === 'cancelled' ? 'not signed in' : e.message })); }
  if (!r.ok && /not been admitted/.test(r.why || '') && key) {
    const box = $('#pending'); const todo = await showDocuments(box, id);
    if (todo.length) {
      const go = document.createElement('button'); go.textContent = 'Sign'; const out = document.createElement('p'); out.className = 'bad';
      box.prepend(Object.assign(document.createElement('p'), { textContent: 'Before the members can admit you, sign:' }));
      box.append(go, out);
      go.onclick = async () => { out.textContent = 'Signing…'; try { await signDocuments(todo, id, key); out.textContent = 'Signed. The members can now admit you.'; go.remove(); } catch (e) { out.textContent = e.message; } };
    }
  }
  if (!r.ok) throw new Error(r.why || 'not signed in');
  location.replace('./');
}
const viaKey = (key) => (m, ns) => keys.sign(m, key, ns);
async function viaPasskey(line, message, namespace) {
  const pk = keys.parsePasskey(line);
  const cred = await navigator.credentials.get({ publicKey: { challenge: await keys.passkeyChallenge(message, namespace), rpId: pk.rp, userVerification: 'preferred', timeout: 120000, allowCredentials: [{ type: 'public-key', id: unb64u(pk.credentialId) }] } });
  if (!cred) throw new Error('the passkey was not used');
  return keys.passkeySignature(line, cred.response);
}

async function start() {
  ENTITY = (await (await fetch('auth/info', { cache: 'no-store' })).json()).entity;
  // The key this browser already keeps, if any.
  const ident = await loadIdentity(ENTITY).catch(() => null);
  if (ident?.id) {
    const box = $('#kept');
    box.innerHTML = `<p>This device keeps a key for <strong></strong>.</p>${ident.locked ? '<label for="kpw">Its password</label><input id="kpw" type="password" autocomplete="current-password">' : ''}<button id="kept-go" type="button">Continue as ${ident.id.replace(/[<>&"]/g, '')}</button><p id="kept-out" class="bad" role="status"></p><p class="dim" style="margin-top:22px">Or sign in as someone else:</p>`;
    box.querySelector('strong').textContent = ident.id;
    $('#kept-go').onclick = async () => {
      const out = $('#kept-out'); out.textContent = 'Signing in…';
      try {
        if (ident.passkey) await signIn(ident.id, (m, ns) => viaPasskey(ident.passkey, m, ns));
        else { const seed = ident.locked ? await unlockSeed(ident.locked, $('#kpw').value) : ident.seed; const key = { seed, publicKey: ident.publicKey }; await signIn(ident.id, viaKey(key), key); }
      } catch (e) { out.textContent = e.message; }
    };
  }
  $('#pw-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const out = $('#pw-out'); out.textContent = 'Signing in… (this takes a second)';
    const id = $('#id').value.trim(), pw = $('#pw').value;
    try {
      const k = await passwordKey(ENTITY, id, pw);
      if ($('#remember').checked) await saveIdentity(ENTITY, { id, locked: await lockSeed(k.seed, pw), publicKey: k.publicKey, via: 'password', created: new Date().toISOString() });
      await signIn(id, viaKey(k), k);
    } catch (e) { out.textContent = e.message; }
  };
  $('#key-go').onclick = async () => {
    const out = $('#key-out'); out.textContent = 'Signing in…';
    try {
      const id = $('#kid').value.trim(), k = keys.importPrivateKey($('#kfile').value);
      await saveIdentity(ENTITY, { id, seed: k.seed, publicKey: k.publicKey, created: new Date().toISOString() });
      await signIn(id, viaKey(k));
    } catch (e) { out.textContent = e.message; }
  };
  let applyDocs = [];
  document.querySelector('details:last-of-type').addEventListener('toggle', async (ev) => { if (ev.target.open && !applyDocs.length) applyDocs = await showDocuments($('#docs')).catch(() => []); });
  $('#apply-go').onclick = async () => {
    const out = $('#apply-out');
    try {
      const id = $('#aid').value.trim(), name = $('#aname').value.trim(), pw = $('#apw').value;
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error('a member id is lowercase letters, digits and -');
      if (pw !== $('#apw2').value) throw new Error('the two passwords differ');
      const why = passwordProblem(pw, id); if (why) throw new Error(why);
      for (const { d, p } of applyDocs) if (d.drawn === 'required' && !p.used()) throw new Error(`draw your signature on "${d.title}" first`);
      out.textContent = 'Signing your application…';
      const k = await passwordKey(ENTITY, id, pw);
      const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      const act = { kind: 'participant.apply', salt, entity: ENTITY, by: id, at: new Date().toISOString(), key: keys.publicKeyLine(k.publicKey), ...(name ? { name } : {}) };
      act.signature = await keys.sign(canonical(act), k, 'entity.act');
      const r = await post('auth/apply', act);
      if (!r.ok || r.refused?.length) throw new Error(r.refused?.[0]?.why || r.why || 'the application was not accepted');
      await saveIdentity(ENTITY, { id, locked: await lockSeed(k.seed, pw), publicKey: k.publicKey, via: 'password', created: new Date().toISOString() });
      if (applyDocs.length) { out.textContent = 'Signing what membership requires…'; await signDocuments(applyDocs, id, k); }
      out.textContent = 'Sent. You can sign in here once the members admit you.';
    } catch (e) { out.textContent = e.message; }
  };
}
start().catch(e => { $('#pw-out').textContent = `This page could not start: ${e.message}`; });
