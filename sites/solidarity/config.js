// config.js · what the solidarity network's website says about itself. The
// shared kit (sites/kit) reads it; what members and proposals are called
// comes from the network's vocabulary.
export default {
  body: 'the network',
  about: 'is a cooperative of neighbours who lend each other what they own, hold some things in common, and decide together as equals.',
  pages: [['index.html', 'Home'], ['library.html', 'Library', 'things'], ['wiki.html', 'Wiki', 'wiki'], ['chat.html', 'Chat', 'chat'], ['hall.html#/proposals', 'Votes'], ['hall.html', 'The network']],
  order: ['things', 'wiki', 'agreements', 'budget', 'meetings', 'threads', 'tasks', 'polls', 'elections', 'offices', 'committees', 'authority'],
  institutions: ({ many }) => ({
    committees: ['Committees', `Groups of ${many} with a job to do, such as the Solidarity Committee.`],
    budget: ['The fund', 'Money the Assembly approved, the solidarity fund among it, and every payment from it.'],
    agreements: ['The Pledge', `The documents every one of the ${many} signs: the Solidarity Pledge.`],
    wiki: ['Wiki', 'The Pledge, the Principles, the handbook and anything else written together, with every version kept.'],
  }),
  minAge: 16,
};
