// The documents tab on the standard page: what the record says about each
// document (who may do what, which version is in force). The text itself is
// written and read on a site's Documents page (docs.html), where it is
// decrypted in the reader's browser.
import { roleOf, inForce, allDocs } from './index.js';

const nm = (api, id) => (api.nameOf ? api.nameOf(id) : id);
const who = (api, spec) => (spec === 'members' ? 'every member' : spec === 'public' ? 'anyone' : spec.startsWith('office:') ? `the office ${spec.slice(7)}` : spec.startsWith('committee:') ? `the committee ${spec.slice(10)}` : nm(api, spec));

function list(api) {
  const { h, state, me, day } = api;
  const at = state.head.at, id = me?.id;
  const mine = allDocs(state).filter(d => d.mode === 'personal' && roleOf(state, d.id, id, at) && (!d.public || d.owner === id));
  const theirs = allDocs(state).filter(d => d.mode === 'governed');
  const sec = h('section', {}, h('h2', {}, 'Documents'),
    h('p', { class: 'hint' }, 'Written together and signed by each author. The record keeps who may read, comment and write, and which version of each of the entity\'s documents is in force; never the text. Encrypted documents open only in the browsers of the people named here. Write and read them on the site\'s Documents page.'));
  sec.append(h('h3', {}, 'The entity\'s documents'));
  sec.append(theirs.length ? h('ul', {}, theirs.map(d => h('li', {}, h('strong', {}, d.title), ` (${d.id}) · read by ${who(api, d.read)}, drafted by ${who(api, d.draft)} · `,
    inForce(d) ? `version ${inForce(d).slice(0, 8)} in force since ${day(d.adopted.at(-1).at)}` : 'no version in force yet', d.retired ? ' · retired' : '', d.encrypted ? ' · encrypted' : ''))) : h('p', { class: 'hint' }, 'None yet. A decision creates one.'));
  if (id) {
    sec.append(h('h3', {}, 'Yours, and shared with you'));
    sec.append(mine.length ? h('ul', {}, mine.map(d => h('li', {}, `${d.id} · ${roleOf(state, d.id, id, at)} · owned by ${nm(api, d.owner)} · ${day(d.created)}`,
      d.archived ? ' · archived' : '', d.public ? ' · public' : ' · encrypted',
      Object.entries(d.shares).some(([, l]) => l.some(s => !s.until)) ? h('span', { class: 'meta' }, ' · shared with ' + Object.entries(d.shares).filter(([, l]) => l.some(s => !s.until)).map(([to, l]) => `${who(api, to)} (${l.find(s => !s.until).role})`).join(', ')) : null))) : h('p', { class: 'hint' }, 'Nothing yet.'));
    if (me.status === 'active' && api.params?.value?.('docs.personal') !== false) sec.append(h('div', { class: 'buttons' }, h('button', { onclick: () => api.sign('doc.create', {}, 'A new encrypted document of your own') }, 'Start an encrypted document')));
  }
  return sec;
}
export const tabs = [{ id: 'docs', title: 'Documents', render: (api) => list(api) }];
