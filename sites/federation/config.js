// config.js · the federation's website: the federation and its states on one
// site. entities.json (written when the federation is founded) lists where
// each one's node is; the first is this site's own, the federation.
export default {
  body: 'the federation',
  about: 'is a federation of states, each with its own citizens and government, sharing a senate, an assembly and one currency.',
  pages: [['index.html', 'Home'], ['hall.html#/proposals', 'Votes'], ['hall.html', 'Institutions'], ['chat.html', 'Chat', 'chat']],
  order: ['federation', 'value', 'parties', 'offices', 'elections', 'wiki', 'authority'],
  institutions: ({ many }) => ({
    federation: ['The states', 'Every state, its citizens, and whom it sends to the senate and the assembly.'],
    value: ['Currency', `The federal currency, held and sent by ${many} of every state.`],
    parties: ['Parties', `Parties ${many} found and join, one at a time.`],
  }),
  entities: 'entities.json',
  minAge: 16,
};
