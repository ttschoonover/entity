// The Invitations tab: invite one person with a personal link; see who has
// been invited, who has joined, and withdraw an invitation not yet used.
import { open } from './index.js';

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'guest';

export default function render(api) {
  const { h, state, me, when, who, $ } = api;
  const at = new Date().toISOString(), max = api.params.value('invites.max_days');
  const all = Object.values(state.m.invites || {}).sort((a, b) => (a.at < b.at ? 1 : -1));
  const status = (i) => (i.used ? ['joined', `as `, who(i.used.by), ` · ${when(i.used.at)}`] : i.revoked ? ['withdrawn'] : at > i.expires ? ['expired'] : [`open until ${when(i.expires)}`]);
  const sec = h('section', {}, h('h2', {}, 'Invitations'),
    h('p', { class: 'hint' }, 'A personal link for one person. Whoever opens it applies, signs the partnership agreement with their drawn signature', api.params.has('details.required') && api.params.value('details.required') ? ', gives their particulars' : '', ', and is admitted: the invitation was the partners’ decision. The link is shown once, here; only a fingerprint of it is recorded.'));
  const linkBox = h('div', { 'aria-live': 'polite' });
  if (me?.status === 'active') sec.append(h('div', { class: 'inline-form' },
    h('label', { for: 'inv-name' }, 'Who is invited (their name)'), h('input', { id: 'inv-name', maxlength: 120, autocomplete: 'off' }),
    h('label', { for: 'inv-days' }, `Days the link stays valid (1 to ${max})`), h('input', { id: 'inv-days', type: 'number', min: 1, max, value: Math.min(14, max) }),
    h('div', { class: 'buttons' }, h('button', { onclick: async () => {
      const name = $('#inv-name').value.trim(), days = Number($('#inv-days').value);
      if (!name) return alert('Give their name.');
      if (!Number.isInteger(days) || days < 1 || days > max) return alert(`Between 1 and ${max} days.`);
      const secret = b64u(crypto.getRandomValues(new Uint8Array(18)));
      const id = `${slug(name)}-${b64u(crypto.getRandomValues(new Uint8Array(3))).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
      const link = `${location.origin}/signin?invite=${id}.${secret}`;
      // Show the link before signing: it exists only in this browser until it is sent.
      linkBox.replaceChildren(h('div', { class: 'card' },
        h('p', {}, h('strong', {}, `The link for ${name}`), ' (send it to them privately; it works once the invitation is decided or signed):'),
        h('p', { class: 'hash', style: 'word-break:break-all' }, link),
        h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => navigator.clipboard?.writeText(link).then(() => alert('Copied.')) }, 'Copy the link'))));
      await api.propose(`Invite ${name}`, [{ kind: 'invite.create', invite: id, name, hash: await hex(secret), days }]);
    } }, 'Create an invitation link'))), linkBox);
  sec.append(api.list({
    key: 'invites', items: all, noun: 'invitations', empty: 'No invitations yet.',
    text: (i) => `${i.name} ${i.id}`,
    render: (i) => h('li', {}, h('h3', {}, i.name), h('p', { class: 'meta' }, ...status(i), ' · invited ', when(i.at)),
      me?.status === 'active' && open(i, at) ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: () => api.propose(`Withdraw the invitation to ${i.name}`, [{ kind: 'invite.revoke', invite: i.id }]) }, 'Withdraw')) : null),
  }));
  return sec;
}
