// config.js · what the Commune's website says about itself. The shared kit
// (sites/kit) reads it; what comrades and motions are called comes from the
// Commune's vocabulary.
export default {
  body: 'the Commune',
  about: 'is a council commune that exists online. It claims no territory and no authority over anyone, and has no connection to any government or party.',
  pages: [['index.html', 'Home'], ['index.html#floor', 'The Congress'], ['hall.html#/parliament', 'The Council', 'laws'], ['laws.html', 'Laws'], ['index.html#labour', 'Labour'], ['chat.html', 'Chat', 'chat'], ['hall.html', 'Organs']],
  order: ['elections', 'offices', 'committees', 'tasks', 'budget', 'value', 'deeds', 'lending', 'disputes', 'letters', 'meetings', 'polls', 'badges', 'wiki', 'authority'],
  institutions: ({ many }) => ({
    committees: ['The Presidium and the Commission', `The Presidium of the Council and the Control Commission.`],
    offices: ['Delegates and Commissars', 'The Council of seven delegates and the five People’s Commissars, elected by season.'],
    tasks: ['The list of work', 'Work the Commune needs. Claim it, do it, have it verified, and be paid a voucher an hour.'],
    value: ['Labour vouchers', `What each of the ${many} has earned and not yet spent. Vouchers cannot be given away.`],
    budget: ['The Plan', 'This season’s lines, adopted by the Congress, and what has been spent from each.'],
    deeds: ['Common property', 'Everything the Commune holds in common.'],
    lending: ['The lending list', 'Borrow what the Commune holds, free, in turn.'],
    disputes: ['The Control Commission', 'Disputes and complaints, heard and decided on the record.'],
    republic: ['Settings', 'The motto, the privacy contact and the minimum age.'],
  }),
  minAge: 16,
};
