// titles · a participant chooses the name others see. Self-governed: nobody
// else's permission is needed, and nobody may take a name already in use.

function install(registry) {
  registry.registerKind({
    name: 'title.set',
    module: 'titles',
    check(state, act, { params }) {
      const t = typeof act.title === 'string' ? act.title.trim() : '';
      const max = params.value('titles.max_length');
      if (!t) return 'a title cannot be empty';
      if (t.length > max) return `a title may be at most ${max} characters`;
      if (t !== act.title) return 'a title may not begin or end with spaces';
      const taken = Object.entries(state.m.titles || {}).find(([id, x]) => id !== act.by && x.toLowerCase() === t.toLowerCase());
      if (taken) return `"${t}" is already used by ${taken[0]}`;
      return null;
    },
    reduce(state, rec) {
      state.m.titles = state.m.titles || {};
      state.m.titles[rec.payload.act.by] = rec.payload.act.title;
    },
  });
}

export const titleOf = (state, id) => (state.m.titles && state.m.titles[id]) || null;
export default { name: 'titles', parameterKeys: ['titles.max_length'], install };
