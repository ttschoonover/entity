// config.js · what the mahjong world's website says about itself.
export default {
  body: 'the world',
  about: 'is a mahjong world: tables where friends play each other and the AI, solo games against the AI, and profiles kept on a record anyone can check.',
  pages: [['index.html', 'Home'], ['play.html', 'Play solo'], ['tables.html', 'Tables', 'mahjong'], ['hall.html#/mahjong', 'Standings', 'mahjong'], ['docs.html', 'Documents', 'docs'], ['chat.html', 'Chat', 'chat'], ['hall.html', 'The world']],
  order: ['mahjong', 'chat', 'polls'],
  institutions: () => ({
    mahjong: ['Mahjong', 'Profiles, standings and every recorded table, each replayed by the record before it counted.'],
    chat: ['Chat', 'Talk between hands.'],
  }),
  minAge: 13,
};
