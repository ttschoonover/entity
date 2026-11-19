// config.js · the investment club's website: a California general partnership.
// The site is private (node.json "private": true): partners sign in to see it.
export default {
  body: 'the partnership',
  about: 'is a California general partnership whose partners invest together and decide together. Its record is kept by its partners and open only to them.',
  pages: [['index.html', 'The partnership'], ['certificates.html', 'Certificates', 'partnership'], ['hall.html#/fund', 'Books', 'fund'], ['hall.html#/proposals', 'Resolutions'], ['docs.html', 'Documents', 'docs'], ['chat.html', 'Chat', 'chat'], ['hall.html', 'Offices']],
  order: ['partnership', 'fund', 'offices', 'elections', 'shares', 'agreements', 'wiki', 'finality', 'meetings', 'polls'],
  institutions: () => ({
    partnership: ['Associations & certificates', 'The associations the partnership belongs to, their claims, and every partner’s certificate.'],
    fund: ['The books', 'Cash, holdings with their cost and price, every trade the partners authorized, income and expenses.'],
    offices: ['Officers', 'The Treasurer, the Secretary and the Audit Committee, each elected on its own.'],
    elections: ['Elections', 'Who is standing for each office, and the count.'],
    shares: ['Units', 'Each partner’s units, and every issue and redemption.'],
    agreements: ['The agreement', 'The partnership agreement, and who has signed which version.'],
    finality: ['Checkpoints', 'Points in the record the Audit Committee has signed as final.'],
  }),
  minAge: 18,
  private: true,
};
