// config.js · what the writing room's website says about itself. The shared
// kit (sites/kit) reads it; its home page is the Documents page.
export default {
  body: 'the room',
  about: 'is a shared writing room. Members keep documents of their own, shared with whom they choose and encrypted in their browsers, and the room keeps documents that change only by its decisions.',
  pages: [['index.html', 'Documents'], ['chat.html', 'Chat', 'chat'], ['hall.html#/proposals', 'Votes'], ['hall.html', 'The room']],
  order: ['docs', 'committees', 'authority', 'chat', 'polls'],
  institutions: () => ({
    docs: ['Documents', 'Who may read, comment on and write each document, and which version of the room’s documents is in force.'],
    committees: ['Committees', 'Groups with a job to do, such as an editorial board that approves changes.'],
    authority: ['Powers', 'What committees and offices may do without a vote, and every time they did it.'],
  }),
  minAge: 13,
};
