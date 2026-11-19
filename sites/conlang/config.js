// config.js · what the language society's website says about itself.
export default {
  body: 'the society',
  about: 'is a society building a language together. Anyone may coin a word or draft the grammar; the members vote, and what they adopt is the language.',
  pages: [['index.html', 'Home'], ['dictionary.html', 'Dictionary', 'lexicon'], ['grammar.html', 'Grammar', 'lexicon'], ['docs.html', 'Documents', 'docs'], ['chat.html', 'The salon', 'chat'], ['hall.html#/proposals', 'Votes'], ['hall.html', 'The society']],
  order: ['lexicon', 'chat', 'wiki', 'polls'],
  institutions: () => ({
    lexicon: ['Dictionary & grammar', 'Every official word and section of the grammar, and the coinages and drafts awaiting a vote.'],
    chat: ['The salon', 'Talk about words, sounds and sentences, in any language.'],
    wiki: ['Notes', 'Working notes, word lists and texts written in the language.'],
  }),
  minAge: 13,
};
