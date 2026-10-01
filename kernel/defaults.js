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
    value: 'ordinary', type: 'string', one_of: ['ordinary', 'organic', 'constitutional', 'entrenched'], changed_by: 'organic', group: 'Membership',
    describe: 'The rule under which a member is removed. Their past acts stay in the record; they can no longer act. A reason is required and published.',
  },
  'membership.recovery_rule': {
    value: 'ordinary', type: 'string', one_of: ['ordinary', 'organic', 'constitutional', 'entrenched'], changed_by: 'organic', group: 'Membership',
    describe: 'The rule under which a member who lost their key is given a new one. The page flags every recovery: a majority could use it to take over someone\'s vote.',
  },
});
