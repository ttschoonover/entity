// The Notices tab: what members posted to everyone, and a form to post one.
// Where your own notices go (this device, email, text) is on the You screen.

export default function render(api) {
  const { h, state, me, $, when, who } = api;
  const all = (state.m.notices || []).slice().reverse();
  const sec = h('section', {}, h('h2', {}, 'Notices'),
    h('p', { class: 'hint' }, 'Notices to every member. Each member’s devices get them sealed to that member’s own key: the server, the push service and any mail provider see only ciphertext. Choose where yours go on ', h('a', { href: '#/you' }, 'You'), '.'));
  sec.append(api.list({
    key: 'notices', items: all, noun: 'notices', empty: 'No notices yet.',
    text: (n) => `${n.title} ${n.text || ''}`,
    render: (n) => h('li', {}, h('h3', {}, n.title), h('p', { class: 'meta' }, who(n.by), ' · ', when(n.at)), n.text ? h('p', { class: 'read' }, n.text) : null),
  }));
  if (me?.status === 'active' && api.params.value('notify.broadcast') !== 'nobody') sec.append(h('details', {}, h('summary', {}, 'Post a notice'), h('div', { class: 'inline-form' },
    h('label', { for: 'nt-title' }, 'Title'), h('input', { id: 'nt-title', maxlength: 120 }),
    h('label', { for: 'nt-text' }, 'Text (optional)'), h('textarea', { id: 'nt-text', maxlength: 1000, class: 'read' }),
    h('div', { class: 'buttons' }, h('button', { onclick: () => {
      const title = $('#nt-title').value.trim(), text = $('#nt-text').value.trim();
      if (!title) return alert('Give it a title.');
      api.sign('notice.post', { title, ...(text ? { text } : {}) }, `Your notice "${title}"`);
    } }, 'Sign and send to every member')))));
  return sec;
}

// Home: the latest notice.
export function cards(api) {
  if (!api.kit) return null;
  const n = (api.state.m.notices || []).at(-1);
  if (!n) return null;
  return api.kit.card({ title: n.title, href: '#/notify', meta: `${api.nameOf ? api.nameOf(n.by) : n.by} · ${api.when(n.at)}`, body: n.text ? api.h('p', { class: 'fine' }, n.text.length > 160 ? `${n.text.slice(0, 160)}…` : n.text) : null });
}
