// config.js · what the Nomic table's website says about itself.
export default {
  body: 'the table',
  about: 'is a game of Nomic: players take turns proposing changes to the rules, everyone votes, and points go to those whose changes pass. Any rule can change, including this one.',
  pages: [['index.html', 'The board'], ['game.html', 'Rules & scores', 'nomic'], ['docs.html', 'Documents', 'docs'], ['chat.html', 'Table talk', 'chat'], ['hall.html#/proposals', 'Votes'], ['hall.html', 'The table']],
  order: ['nomic', 'chat', 'polls', 'wiki'],
  institutions: () => ({
    nomic: ['The game', 'The rules in force, whose turn it is, the scores, and calls for judgment.'],
    chat: ['Table talk', 'Talk the game over: alliances, objections, bad puns.'],
  }),
  minAge: 13,
};
