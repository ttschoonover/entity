// config.js · The Orchard General Partnership's website: an investment club's
// members' site. The node is private, so visitors see only the sign-in page;
// everything here is for partners, worked out in their browser from the record.
export default {
  body: 'the partnership',
  brand: 'The Orchard',
  about: 'is an investment club organized as a California general partnership. Its partners decide every investment together; the Treasurer keeps the books, which every partner can read.',
  pages: [
    ['index.html', 'Overview'],
    ['portfolio.html', 'Portfolio', 'fund'],
    ['hall.html#/resolutions', 'Votes'],
    ['partners.html', 'Partners'],
    ['hall.html#/meetings', 'Meetings', 'meetings'],
    ['hall.html#/agreements', 'Agreement', 'agreements'],
    ['constitution.html', 'Constitution'],
    ['hall.html#/details', 'My details', 'details'],
    ['hall.html#/modules', 'Modules', null, 'secretary'],
  ],
  order: ['agreements', 'partnership', 'details', 'invites', 'meetings', 'elections', 'offices'],
  // Kept by the partnership but not shown as pages of their own.
  hide: ['wiki', 'finality', 'authority', 'shares', 'fund', 'participation', 'twofactor', 'record'],
  institutions: () => ({
    agreements: ['The partnership agreement', 'The agreement in force, signed by every partner with a drawn signature.'],
    partnership: ['Certificates', 'Each partner’s certificate of units, signed by the officers.'],
    details: ['My details', 'The particulars the partnership needs for its tax returns, encrypted to you, the Treasurer and the Secretary.'],
    invites: ['Invitations', 'Personal links that let one named person apply, sign and join.'],
    meetings: ['Meetings', 'Partners’ meetings, check-in and minutes.'],
    elections: ['Elections', 'Candidates and votes for Treasurer and Secretary.'],
    offices: ['Officers', 'The Treasurer and the Secretary.'],
  }),
  minAge: 18,
  private: true,
};
