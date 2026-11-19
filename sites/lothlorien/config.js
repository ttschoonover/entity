// config.js · Lothlórien's house wiki. The site is private (node.json
// "private": true): only members of the house who sign in see anything.
export default {
  body: 'the house',
  about: 'is a student housing cooperative. This is its members’ own wiki: how the house works, written down by the people who live in it.',
  pages: [['index.html', 'Wiki'], ['hall.html#/citizens', 'Members'], ['hall.html#/proposals', 'Votes']],
  order: ['wiki'],
  institutions: () => ({
    wiki: ['Wiki', 'How the house works, written by the people who live in it. Every version is kept.'],
  }),
  minAge: 16,
  private: true,
};
