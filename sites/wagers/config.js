// config.js · what the Paddock's website says about itself.
export default {
  body: 'the paddock',
  about: 'is a betting club that plays for points, never money: pools, over/unders, head-to-head challenges and a prediction market, settled by an arbiter the members elect.',
  pages: [['index.html', 'The board'], ['bets.html', 'Place a bet', 'wagers'], ['docs.html', 'Documents', 'docs'], ['chat.html', 'The rail', 'chat'], ['hall.html#/proposals', 'Votes'], ['hall.html', 'The club']],
  order: ['wagers', 'value', 'offices', 'elections', 'chat'],
  institutions: () => ({
    wagers: ['Bets', 'Every open market, pool, line and challenge, the arbiter’s results, and appeals.'],
    value: ['Points', 'The club’s points: issued by vote, and who holds how many.'],
    offices: ['The arbiter', 'Who resolves bets, and for how long.'],
    chat: ['The rail', 'Tips, trash talk and arguments about what really happened.'],
  }),
  minAge: 18,
};
