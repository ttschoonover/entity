// value · a unit of account: points, credits, hours, a currency. Units are
// created and destroyed only by decision; holders may send them to each other
// if the entity allows it, and may always retire their own.
//
// Amounts are whole numbers of the smallest unit. value.decimals says where the
// point goes when they are shown: 1250 with decimals 2 is 12.50.

const whole = (n) => Number.isSafeInteger(n) && n > 0;
const bal = (state, id) => state.m.value?.balances?.[id] || 0;
const ledger = (state) => (state.m.value = state.m.value || { balances: {}, supply: 0 });
const alive = (state, id) => state.participants[id] && state.participants[id].status !== 'left';

export function show(amount, params) {
  const d = params.has('value.decimals') ? params.value('value.decimals') : 0;
  const s = (amount / 10 ** d).toFixed(d);
  return `${s} ${params.has('value.name') ? params.value('value.name') : 'units'}`;
}

function install(r) {
  r.registerEffect({
    name: 'value.issue', module: 'value',
    rule: (p) => p.value('value.issue_rule'),
    describe: (e) => `Issue ${e.amount} to ${e.to}${e.memo ? ` (${e.memo})` : ''}`,
    check(state, e, p) {
      if (!whole(e.amount)) return 'amount must be a whole number above zero, in the smallest unit';
      if (!alive(state, e.to)) return `${e.to} is not a participant`;
      const cap = p.value('value.max_supply');
      if (cap > 0 && (state.m.value?.supply || 0) + e.amount > cap) return `this would exceed the maximum supply of ${cap}`;
      return null;
    },
  });
  r.registerEffect({
    name: 'value.revoke', module: 'value',
    rule: (p) => p.value('value.issue_rule'),
    describe: (e) => `Revoke ${e.amount} from ${e.from}${e.memo ? ` (${e.memo})` : ''}`,
    check(state, e) {
      if (!whole(e.amount)) return 'amount must be a whole number above zero';
      if (bal(state, e.from) < e.amount) return `${e.from} holds only ${bal(state, e.from)}`;
      return null;
    },
  });
  r.registerRecord('value.issue', (state, rec) => {
    const l = ledger(state); l.balances[rec.payload.to] = bal(state, rec.payload.to) + rec.payload.amount; l.supply += rec.payload.amount;
  });
  r.registerRecord('value.revoke', (state, rec) => {
    const l = ledger(state); l.balances[rec.payload.from] -= rec.payload.amount; l.supply -= rec.payload.amount;
  });

  // decision.electorate "value": holders vote with their balance. One unit, one
  // vote: a shareholder meeting, a token vote. Balances are read when a
  // proposal is laid, so buying units during a vote changes nothing.
  r.registerElectorate({
    name: 'value', module: 'value',
    describe: () => 'holders of the unit, one vote per smallest unit held',
    check: (state, arg) => (arg ? '"value" takes no argument' : null),
    roll: (state) => ({ ...(state.m.value?.balances || {}) }),
  });

  r.registerKind({
    name: 'value.transfer', module: 'value',
    check(state, act, { params }) {
      if (!params.value('value.transferable')) return 'units cannot be transferred in this entity';
      if (!whole(act.amount)) return 'amount must be a whole number above zero';
      if (act.to === act.by) return 'you cannot send units to yourself';
      if (!alive(state, act.to)) return `${act.to} is not a participant`;
      if (bal(state, act.by) < act.amount) return `you hold ${bal(state, act.by)}`;
      if (act.memo !== undefined && (typeof act.memo !== 'string' || act.memo.length > 200)) return 'a memo is at most 200 characters';
      return null;
    },
    reduce(state, rec) {
      const { by, to, amount } = rec.payload.act; const l = ledger(state);
      l.balances[by] -= amount; l.balances[to] = bal(state, to) + amount;
    },
  });
  r.registerKind({
    name: 'value.retire', module: 'value',
    check(state, act) {
      if (!whole(act.amount)) return 'amount must be a whole number above zero';
      return bal(state, act.by) < act.amount ? `you hold ${bal(state, act.by)}` : null;
    },
    reduce(state, rec) { const { by, amount } = rec.payload.act; const l = ledger(state); l.balances[by] -= amount; l.supply -= amount; },
  });
}

export const balance = bal;
export default { name: 'value', core: '0.4', install, show, balance: bal,
  parameterKeys: ['value.name', 'value.decimals', 'value.transferable', 'value.issue_rule', 'value.max_supply'] };
