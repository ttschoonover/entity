// The two-factor tab: your own setting, this browser, and the republic's rule.
// It talks to the node that serves the page; nothing here goes on the record.
export const tabs = [{ id: 'twofactor', title: 'Two-factor', render: (api) => render(api) }];

const POLICY = {
  optional: 'Each member chooses whether to use it.',
  officers: 'Everyone holding an office or a committee seat must use it; other members choose.',
  everyone: 'Every member must use it.',
};

export default function render(api) {
  const { h, params, me } = api;
  const policy = params.value('twofactor.require');
  const box = h('div', {}, h('p', { class: 'hint' }, 'Asking this republic’s server…'));
  const sec = h('section', {}, h('h2', {}, 'Two-factor sign-in'),
    h('p', { class: 'hint' }, `Signing in, and acting from a browser, takes your password or key and a six-digit code emailed to you. Your email address is kept by this republic’s server alone, never on the record. ${POLICY[policy] || ''}`),
    box);
  const T = () => import(new URL('../../interface/js/twofactor.js', import.meta.url).href);
  const signFn = async () => {
    const key = await api.key('Confirm this browser for two-factor');
    if (!key) throw new Error(api.ident?.passkey ? 'passkeys are already a second factor: two-factor by email is for passwords and keys' : 'sign in first');
    return (m, ns) => api.E.keys.sign(m, key, ns);
  };
  const say = (text, bad) => box.append(h('p', { class: bad ? 'flag' : 'state-carried' }, text));
  const run = async (fn) => { try { await fn(); await draw(); } catch (e) { if (e.message !== 'cancelled') say(e.message, true); } };

  async function draw() {
    let t, s;
    try { t = await T(); s = await t.status(); }
    catch { box.replaceChildren(h('p', { class: 'hint' }, 'Two-factor works on the page this republic’s own server serves; this copy of the page is not served by it.')); return; }
    const kids = [];
    if (!s.mail) kids.push(h('p', { class: 'flag' }, 'This server cannot send email yet, so no one can turn two-factor on. Its operator sets it up on the server: entity twofactor mail --host … --user … --from …'));
    if (!me) { kids.push(h('p', { class: 'hint' }, 'Sign in to see or change your own setting.')); box.replaceChildren(...kids); return; }
    const confirmed = s.signedIn === me.id && s.confirmed;
    kids.push(h('dl', { class: 'facts' },
      h('dt', {}, 'Your two-factor'), h('dd', {}, s.signedIn === me.id ? (s.enrolled ? `on: codes go to ${s.to}` : s.covered ? 'required of you, and not yet set up' : 'off') : 'confirm this browser to see it'),
      h('dt', {}, 'This browser'), h('dd', {}, confirmed ? 'confirmed with a code (for twelve hours)' : s.signedIn === me.id ? 'signed in to the server without a code' : 'not signed in to the server'),
      h('dt', {}, 'The republic’s rule'), h('dd', {}, `${policy} · codes work for ${params.value('twofactor.code_minutes')} minutes`)));
    const buttons = h('div', { class: 'buttons' });
    if (s.signedIn !== me.id || (s.enrolled && !confirmed)) buttons.append(h('button', { onclick: () => run(async () => { await t.confirmBrowser({ id: me.id, sign: await signFn(), ask: t.promptAsk }); }) }, s.enrolled ? 'Confirm this browser with a code' : 'Sign in to the server'));
    if (s.signedIn === me.id && !s.enrolled) {
      const input = h('input', { type: 'email', id: 'tf-email', placeholder: 'you@example.org', autocomplete: 'email' });
      kids.push(h('div', { class: 'inline-form' }, h('label', { for: 'tf-email' }, 'Email address for sign-in codes'), input,
        h('div', { class: 'buttons' }, h('button', { disabled: !s.mail || null, onclick: () => run(async () => { await t.turnOn({ email: input.value, ask: t.promptAsk }); say('Two-factor is on. From now on, signing in asks for a code.'); }) }, 'Turn on two-factor'))));
    }
    if (confirmed && s.enrolled) {
      buttons.append(h('button', { class: 'quiet', onclick: () => run(async () => { await t.turnOn({ email: prompt('The new address for sign-in codes') || '', ask: t.promptAsk }); }) }, 'Change the address'));
      if (!s.covered) buttons.append(h('button', { class: 'danger', onclick: () => run(async () => { if (confirm('Turn two-factor off? Your password alone will sign for you again.')) await t.turnOff(); }) }, 'Turn it off'));
    }
    kids.push(buttons);
    kids.push(h('p', { class: 'fine' }, 'Lost access to your email? The server’s operator can turn two-factor off for you: entity twofactor reset ', me.id, '. The members can change the rule by decision (twofactor.require).'));
    box.replaceChildren(...kids);
  }
  draw();
  return sec;
}
