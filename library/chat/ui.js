// The chat tab: what the channels are, who may read and write each, who
// moderates and how long messages are kept, with a way into the chat itself.
// The conversations are on the chat page; none of it is on the record.
export const tabs = [{ id: 'chat', title: 'Chat', render: (api) => render(api) }];

export default function render(api) {
  const { h, params, words } = api;
  const channels = (params.value('chat.channels') || []).filter(c => c && c.id);
  const mods = params.value('chat.moderators');
  const who = (spec) => (!spec || spec === 'members' ? `all ${words.many}` : spec.replace(/^office:/, 'holders of the office ').replace(/^committee:/, 'the committee '));
  return h('section', {}, h('h2', {}, 'Chat'),
    h('p', { class: 'hint' }, `Channels for talking things over. Messages are signed with each writer’s own key and kept by this site’s server for ${params.value('chat.retention_days')} days; they are never part of the public record. Members-only channels are end-to-end encrypted: messages are sealed in each member’s browser, and the server keeps only ciphertext (it still sees who wrote, when, and where). ${mods ? `Moderators (${who(mods)}) can delete any message in a channel or room.` : 'Only a message’s author can delete it.'} ${params.has('chat.room_creators') && params.value('chat.room_creators') ? `Besides these channels, ${who(params.value('chat.room_creators'))} may open rooms of their own, which their opener or a moderator closes.` : ''} ${!params.has('chat.direct_messages') || params.value('chat.direct_messages') ? `${words.many[0].toUpperCase() + words.many.slice(1)} can also write to each other directly; those messages are sealed for the two of them, and only their author can delete one.` : ''}`),
    h('p', {}, h('a', { class: 'primary', href: 'chat.html', style: 'text-decoration:none;display:inline-block' }, 'Open the chat')),
    channels.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Channel'), h('th', {}, 'About'), h('th', {}, 'Who reads'), h('th', {}, 'Who writes'))),
      h('tbody', {}, channels.map(c => h('tr', {}, h('td', {}, h('a', { href: `chat.html#/${c.id}` }, `#${c.id}`)), h('td', { class: 'fine' }, c.about || c.title || ''), h('td', { class: 'fine' }, c.read === 'public' ? 'anyone' : `${who('members')}${c.encrypt === false ? '' : ' (encrypted)'}`), h('td', { class: 'fine' }, who(c.post)))))))
      : h('p', { class: 'hint' }, 'No channels yet.'),
    h('p', { class: 'fine' }, `The channels, who reads and writes each, the moderators, who may open rooms, direct messages and how long messages are kept are settings (chat.channels, chat.moderators, chat.room_creators, chat.max_rooms, chat.direct_messages, chat.retention_days), changed by the ${words.many} like any other.`));
}
