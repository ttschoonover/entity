// twofactor.js · the browser's half of email two-factor (the twofactor module).
// A browser confirms itself to the node once: it signs a one-time challenge
// with the member's key, then gives the six-digit code the node emailed. The
// node then accepts that member's acts from this browser for twelve hours.
//
//   await confirmBrowser({ id, sign, ask })
//     sign(message, namespace) → signature, with the member's key
//     ask({ step: 'email' | 'code', to?, error?, policy? }) → string, or null to stop
//
// Pages call it when the node refuses an act with { twofactor: true }, and
// send the act again once it resolves.

const post = async (base, p, body) => {
  const r = await fetch(new URL(p, base), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.why || `the node answered ${r.status}`), { status: r.status });
  return j;
};
const fatal = (e) => /expired|too many|sign in again|sign in first|cannot send|five codes/.test(e.message) || e.status === 503;

async function codeLoop(base, path, ticket, to, ask, extra = {}) {
  let error = null;
  for (;;) {
    const code = await ask({ step: 'code', to, error, ...extra });
    if (!code) throw new Error('cancelled');
    try { return await post(base, path, { ticket, code }); }
    catch (e) { if (fatal(e)) throw e; error = e.message; }
  }
}

export async function confirmBrowser({ id, sign, ask, base = new URL('.', location.href).href }) {
  const info = await (await fetch(new URL('auth/info', base), { credentials: 'same-origin' })).json();
  const { challenge } = await post(base, 'auth/challenge');
  const signature = await sign(`entity.signin\n${info.entity}\n${challenge}`, 'entity.signin');
  return finishSignIn(await post(base, 'auth/verify', { id, challenge, signature }), ask, base);
}

// What /auth/verify answered: signed in, or the second step it asks for.
export async function finishSignIn(r, ask, base = new URL('.', location.href).href) {
  if (r.ok && !r.need) return r;
  if (r.need === 'code') return codeLoop(base, 'auth/2fa/code', r.ticket, r.to, ask);
  if (r.need === 'enroll') {
    let error = null;
    for (;;) {
      const email = await ask({ step: 'email', policy: r.policy, error });
      if (!email) throw new Error('cancelled');
      try { const e = await post(base, 'auth/2fa/enroll', { ticket: r.ticket, email: email.trim() }); return codeLoop(base, 'auth/2fa/confirm', e.ticket, e.to, ask, { confirming: true }); }
      catch (e) { if (fatal(e)) throw e; error = e.message; }
    }
  }
  throw new Error(r.why || 'the node did not confirm this browser');
}

// For a member already confirmed (or not yet covered): turn it on, or off.
export async function status(base = new URL('.', location.href).href) {
  return (await fetch(new URL('auth/2fa/status', base), { credentials: 'same-origin' })).json();
}
export async function turnOn({ email, ask, base = new URL('.', location.href).href }) {
  const e = await post(base, 'auth/2fa/enroll', { email: email.trim() });
  return codeLoop(base, 'auth/2fa/confirm', e.ticket, e.to, ask, { confirming: true });
}
export const turnOff = (base = new URL('.', location.href).href) => post(base, 'auth/2fa/off');

// The plain way to ask, for pages without dialogs of their own.
export function promptAsk({ step, to, error, policy, confirming }) {
  if (step === 'email') return prompt(`${error ? `${error}\n\n` : ''}${policy && policy !== 'optional' ? 'This republic requires email two-factor of you.' : 'Email two-factor.'} Which email address should sign-in codes go to? (Kept by this node only, never published.)`);
  return prompt(`${error ? `${error}\n\n` : ''}${confirming ? 'To confirm the address, enter' : 'Enter'} the six-digit code sent to ${to}:`);
}
