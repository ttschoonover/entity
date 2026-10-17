// privacy.js · the privacy page: its tools (download your data, change your
// name, leave, clear this browser) and the settings it quotes.
import { start, onChange, onSigned, ctx, h, $, me, isCitizen, displayName, nameOf, setting, sign, signInDialog, enabled, downloadMyData, clearThisBrowser, preferencesDialog, toast, W } from './common.js';

function drawTools() {
  const box = $('#tools-box'), p = me();
  const kids = [];
  if (p) {
    kids.push(h('p', {}, `Signed in as ${displayName(p.id)}.`));
    kids.push(h('div', { class: 'buttons' },
      h('button', { class: 'primary', type: 'button', onclick: downloadMyData }, 'Download my data'),
      enabled('titles') && isCitizen() ? h('button', { class: 'secondary', type: 'button', onclick: async () => {
        const name = prompt('The name others will see. It goes on the public record.', nameOf(p.id) === p.id ? '' : nameOf(p.id));
        if (name && name.trim()) await sign('title.set', { title: name.trim() }, `Your name: ${name.trim()}`);
      } }, 'Change my name') : null,
      enabled('twofactor') ? h('a', { class: 'secondary', href: 'hall.html#/twofactor' }, 'Two-factor and email') : null,
      isCitizen() ? h('button', { class: 'secondary', type: 'button', onclick: async () => {
        if (!confirm(`Leave ${W().body}? You will no longer be ${W().a} ${W().one}. What you signed stays on the public record.`)) return;
        if (await sign('participant.leave', {}, `Leaving ${W().body}`)) toast(`You have left ${W().body}.`);
      } }, `Leave ${W().body}`) : null));
  } else {
    kids.push(h('p', {}, 'Sign in to download your data, change your name or leave. You can clear this browser without signing in.'),
      h('div', { class: 'buttons' }, h('button', { class: 'primary', type: 'button', onclick: () => signInDialog() }, 'Sign in')));
  }
  kids.push(h('div', { class: 'buttons' },
    h('button', { class: 'secondary', type: 'button', onclick: async () => { if (confirm('Remove everything this site stores in this browser: your key, your settings and the notice? You will be signed out.')) { await clearThisBrowser(); toast('This browser no longer holds anything from this site.'); } } }, 'Clear this browser'),
    h('button', { class: 'secondary', type: 'button', onclick: () => preferencesDialog() }, 'Display and accessibility')));
  box.replaceChildren(...kids);
}

function drawFacts() {
  $('#min-age').textContent = setting('republic.min_age', 16);
  const c = setting('republic.privacy_contact', '');
  $('#contact-line').replaceChildren(c ? h('span', {}, 'Write to ', /@/.test(c) ? h('a', { href: `mailto:${c}` }, c) : /^https?:/.test(c) ? h('a', { href: c }, c) : c, ' with any question or request about your data. We answer within one month.')
    : h('span', {}, enabled('republic') ? `No privacy contact has been set yet. The ${W().many} set one by law (republic.privacy_contact).` : `Ask any officer of ${W().body}, or raise it with the ${W().assembly}.`));
  if (navigator.globalPrivacyControl === true) $('#gpc').textContent = 'Your browser is sending this signal now.';
}

onSigned(drawTools);
await start();
drawTools(); drawFacts();
onChange(() => { drawTools(); drawFacts(); });
