// The signing window: opened by window.js on another website, served by the
// republic's own node. It shows exactly what will be signed, signs with the
// member's own key (kept in this browser, a password, a passkey or a key file),
// sends it to this node, and tells the opening website only the result.
import * as E from '../interface/js/engine.js';
import * as K from '../interface/js/keystore.js';
import { unlockSeed } from '../interface/js/lock.js';

const main = document.getElementById('main');
const req = JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reply = (msg) => { try { window.opener?.postMessage({ id: req.id, ...msg }, req.origin || '*'); } catch { /* opener gone */ } };
const fail = (why) => { main.innerHTML = `<h1>Not signed</h1><p class="bad">${esc(why)}</p><button class="quiet" id="close">Close</button>`; document.getElementById('close').onclick = () => { reply({ ok: false, error: why }); window.close(); }; };
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function passkeySign(line, message, namespace) {
  const pk = E.keys.parsePasskey(line);
  const cred = await navigator.credentials.get({ publicKey: { challenge: await E.keys.passkeyChallenge(message, namespace), rpId: pk.rp, userVerification: 'preferred', timeout: 120000, allowCredentials: [{ type: 'public-key', id: unb64u(pk.credentialId) }] } });
  if (!cred) throw new Error('the passkey was not used');
  return E.keys.passkeySignature(line, cred.response);
}

async function start() {
  if (!req.kind) return fail('Nothing was asked to be signed.');
  const info = await (await fetch('info.json', { cache: 'no-store' })).json();
  const registry = await E.loadRegistry(info.modules);
  const v = await E.verifyText(registry, await (await fetch('../record/events.jsonl', { cache: 'no-store' })).text());
  if (!v.ok) return fail('This republic’s record does not verify here, so nothing will be signed.');
  const state = v.state, name = E.paramsOf(state).value('entity.name');
  const ident = await K.loadIdentity(state.entity.id).catch(() => null);
  const from = (() => { try { return new URL(req.origin).host; } catch { return 'a website'; } })();
  const joining = req.kind === 'participant.apply';
  main.innerHTML = `<h1>${esc(req.label || req.kind)}</h1>
    <p class="dim">${esc(from)} asks you to sign this, for <strong>${esc(name)}</strong>. Check it: your signature binds you to exactly this.</p>
    <pre>${esc(JSON.stringify({ kind: req.kind, ...req.fields }, null, 2))}</pre>
    <div id="who"></div><div class="row"><button id="go">Sign and send</button><button class="quiet" id="no">Cancel</button></div><p id="out" class="dim"></p>`;
  const who = document.getElementById('who');
  let signFn = null, by = null, extra = {};
  if (ident && !joining) {
    by = ident.id;
    who.innerHTML = `<p>Signing as <strong>${esc(ident.id)}</strong>${ident.passkey ? ' with your passkey' : ident.locked ? ', with your key (its password is asked for)' : ''}.</p>${ident.locked ? '<label for="pw">Your key’s password</label><input id="pw" type="password">' : ''}`;
    signFn = async () => {
      if (ident.passkey) return (m, ns) => passkeySign(ident.passkey, m, ns);
      const seed = ident.locked ? await unlockSeed(ident.locked, document.getElementById('pw').value) : ident.seed;
      return (m, ns) => E.keys.sign(m, { seed, publicKey: ident.publicKey }, ns);
    };
  } else {
    who.innerHTML = `${joining ? '<p>Choose your member id and a password: the password signs for you from now on, here and on this republic’s page.</p>' : '<p>You are not signed in to this republic in this browser. Sign with your password, or paste your key file.</p>'}
      <label for="id">Member id</label><input id="id" autocomplete="username">
      <label for="pw">Password</label><input id="pw" type="password" autocomplete="${joining ? 'new-password' : 'current-password'}">
      ${joining ? '' : '<label for="kf">…or your key file (optional)</label><textarea id="kf"></textarea>'}`;
    signFn = async () => {
      by = document.getElementById('id').value.trim();
      const kf = document.getElementById('kf')?.value.trim();
      if (kf) { const key = E.keys.importPrivateKey(kf); return (m, ns) => E.keys.sign(m, key, ns); }
      const pw = document.getElementById('pw').value;
      if (joining) { const why = E.passwordProblem(pw, by); if (why) throw new Error(why); }
      const key = await E.passwordKey(state.entity.id, by, pw);
      if (joining) extra = { key: E.keys.publicKeyLine(key.publicKey) };
      return (m, ns) => E.keys.sign(m, key, ns);
    };
  }
  document.getElementById('no').onclick = () => { reply({ ok: false, error: 'cancelled' }); window.close(); };
  document.getElementById('go').onclick = async () => {
    const out = document.getElementById('out'); out.className = 'dim'; out.textContent = 'Signing…';
    try {
      const fn = await signFn(); if (!by) throw new Error('enter your member id');
      const act = await E.makeActWith(registry, state, req.kind, { by, ...extra, ...req.fields }, fn);
      const sendIt = async () => { const r = await fetch('../acts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(act) }); return { r, body: await r.json().catch(() => ({})) }; };
      let { r, body } = await sendIt();
      if (body.twofactor) {
        // Email two-factor: confirm this browser with the emailed code, then send again.
        out.textContent = 'This republic uses email two-factor: confirming this browser…';
        const T = await import('../interface/js/twofactor.js');
        await T.confirmBrowser({ id: by, sign: fn, ask: T.promptAsk, base: new URL('../', location.href).href });
        ({ r, body } = await sendIt());
      }
      if (!r.ok || body.refused?.length || body.why) throw new Error(body.refused?.[0]?.why || body.why || `the node answered ${r.status}`);
      out.textContent = 'Signed and sent.';
      reply({ ok: true, kind: req.kind, by, result: body });
      setTimeout(() => window.close(), 700);
    } catch (e) { out.className = 'bad'; out.textContent = e.message; }
  };
}
start().catch(e => fail(e.message));
