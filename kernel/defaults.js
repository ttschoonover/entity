// The kernel's parameters added since 0.3, with their defaults. Parameters in
// parameters.base.yml are written into every founding document; these are not,
// so that entities founded before they existed read the same defaults as new
// ones. Setting one records an override in the entity's document.
//
// A default is code: changing one is a change to the kernel, approved like one.

export const KERNEL_DEFAULTS = Object.freeze({
  'decision.electorate': {
    value: 'members', type: 'string', changed_by: 'entrenched', group: 'Decisions',
    describe: 'Who votes on proposals, and with what weight. "members": every active member, one vote each. ' +
      '"founder" or "member:ID": one person decides alone. "office:ID": the holders of an office. ' +
      '"committee:ID": the members of a committee. "value": holders of the value unit, weighted by balance. ' +
      '"none": nothing can ever be decided again; the entity is frozen as it stands.',
  },
  'membership.removal_rule': {
    value: 'ordinary', type: 'rule', changed_by: 'organic', group: 'Membership',
    describe: 'The rule under which a member is removed (any of the entity\'s rules, a partnership\'s joint rule for instance). Their past acts stay in the record; they can no longer act. A reason is required and published.',
  },
  'membership.recovery_rule': {
    value: 'ordinary', type: 'string', one_of: ['ordinary', 'organic', 'constitutional', 'entrenched'], changed_by: 'organic', group: 'Membership',
    describe: 'The rule under which a member who lost their key is given a new one. The page flags every recovery: a majority could use it to take over someone\'s vote.',
  },
  // Sealed records (kernel/sealing.js, docs/SPEC-RECORD-V2.md).
  'records.sealing': {
    value: false, type: 'boolean', changed_by: 'constitutional', group: 'Record',
    describe: 'Seal the record: from here on, only members can read what it says. Anyone can still check it has not been altered. What was recorded before stays as it was.',
  },
  'records.public': {
    value: [], type: 'list', changed_by: 'constitutional', group: 'Record',
    describe: 'Kinds of record left readable by everyone when the record is sealed (enacted law, say). The founding, record keys and key periods are always readable.',
  },
  'records.history': {
    value: 'full', type: 'string', one_of: ['full', 'from-join'], changed_by: 'constitutional', group: 'Record',
    describe: 'What a new member can read of a sealed record. "full": everything, earlier key periods included, granted when a key period first includes them; their copy can then check the whole record. "from-join": only from the key period that first includes them; their copy cannot replay what came before, so it cannot work out the present state either (until state snapshots exist, it suits nobody).',
  },
});
