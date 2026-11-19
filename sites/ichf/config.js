// config.js · the ICHF's website: the International Co-operative Housing
// Federation and its national federations on one bilingual site. entities.json
// (written when the ICHF is founded) lists each one's node; the first is the ICHF.
export default {
  body: 'the ICHF',
  about: 'is an international federation of national federations of housing co-operatives. It is officially bilingual: English and French have equal standing. · La FIHC est officiellement bilingue.',
  pages: [['index.html', 'ICHF · FIHC'], ['index.html#federations', 'Federations'], ['index.html#credits', 'Labor credits'], ['hall.html#/proposals', 'Votes'], ['hall.html#/wiki', 'Wiki', 'wiki'], ['hall.html#/letters', 'Letters', 'letters'], ['chat.html', 'Chat', 'chat'], ['hall.html', 'Institutions']],
  order: ['federation', 'value', 'tasks', 'offices', 'committees', 'elections', 'wiki', 'letters', 'authority'],
  institutions: ({ many }) => ({
    federation: ['National federations · Fédérations nationales', 'Every national federation, its members, and its delegates to the Council and the General Assembly.'],
    value: ['Labor credits · Crédits de travail', `The international unit: 1.00 = one hour of co-operative work, held and sent by ${many} of every federation.`],
    tasks: ['Work · Travail', 'Work the ICHF and its houses need. Verified hours pay labor credits.'],
    offices: ['Officers · Dirigeants', 'The Co-Presidents, the Secretary-General and the Treasurer.'],
    committees: ['Committees · Comités', 'The Executive, Clearing and Translation Committees.'],
    letters: ['Letters · Lettres', 'Official letters of the Executive Committee and the Secretariat.'],
    republic: ['Names and languages · Noms et langues', 'Names, acronyms, mottos and official languages.'],
  }),
  entities: 'entities.json',
  minAge: 16,
};
