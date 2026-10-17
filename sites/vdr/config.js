// config.js · what the VDR's website says about itself. The shared kit
// (sites/kit) reads it; what citizens and bills are called comes from the
// Republic's vocabulary.
export default {
  // How the site refers to the entity in running text.
  body: 'the Republic',
  // After the name, in the footer.
  about: 'is a democratic experiment that exists online. It claims no territory and no authority over anyone, and has no connection to any government.',
  // The masthead: [href, label, module it needs]. The first is the home page.
  pages: [['index.html', 'Home'], ['index.html#floor', 'The floor'], ['hall.html#/parliament', 'Parliament', 'laws'], ['laws.html', 'Laws'], ['chat.html', 'Chat', 'chat'], ['hall.html', 'Institutions']],
  // The order of module tabs on the Institutions page.
  order: ['elections', 'offices', 'committees', 'polls', 'meetings', 'wiki', 'badges', 'authority'],
  institutions: ({ many }) => ({
    committees: ['Committees', `Groups of ${many} with a job to do, such as the Supreme Court.`],
    offices: ['Offices', 'The posts of state, their terms and who holds them.'],
    republic: ['The Republic', 'The motto, the privacy contact and the minimum age.'],
  }),
  minAge: 16,
};
