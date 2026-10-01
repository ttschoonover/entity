// 6.2 · Counting. Pure. The interface imports this same file; there is no
// second implementation to disagree with.
//
// Carried  ⇔  quorum met  ∧  for ÷ (for + against) ≥ threshold  ∧  for > against
// Abstentions count toward quorum and not toward the share.
// Every figure is a sum of weights. With one vote each (the usual case) a
// weight is a person; with a weighted electorate, a unit or a share.
// A proposal closes at the earlier of its deadline or the moment its outcome
// cannot change. Ballots may be replaced while it is open; the latest counts.

const EPS = 1e-9;

export function tallyOf(p) {
  const roll = new Set(p.roll);
  const latest = new Map();
  const rejected = [], replaced = [];
  for (const b of p.ballots) {
    if (!roll.has(b.by)) { rejected.push({ id: b.hash, by: b.by, why: 'not on the roll when the proposal was laid' }); continue; }
    if (b.afterClose || b.at > p.deadline) { rejected.push({ id: b.hash, by: b.by, why: 'cast after close' }); continue; }
    if (latest.has(b.by)) replaced.push({ id: latest.get(b.by).hash, by: b.by, why: 'replaced by a later ballot' });
    latest.set(b.by, b);
  }
  const weight = (id) => (p.weights ? p.weights[id] || 0 : 1);
  const counted = [...latest.values()].map(b => ({ id: b.hash, by: b.by, choice: b.choice, at: b.at, ...(p.weights ? { weight: weight(b.by) } : {}) }));
  const n = (c) => counted.filter(b => b.choice === c).reduce((s, b) => s + weight(b.by), 0);
  const f = n('for'), a = n('against'), ab = n('abstain');
  const electorate = [...roll].reduce((s, id) => s + weight(id), 0), cast = counted.reduce((s, b) => s + weight(b.by), 0);
  const { quorum, threshold } = p.terms;
  const quorumNeeded = Math.max(0, Math.ceil(quorum * electorate - EPS));
  const quorumMet = cast >= quorumNeeded && cast > 0;
  const decisive = f + a;
  const share = decisive ? f / decisive : 0;
  const thresholdMet = decisive > 0 && share >= threshold - EPS && f > a;
  const remaining = electorate - cast;
  const certainCarry = quorumMet && f / (f + a + remaining) >= threshold - EPS && f > a + remaining;
  const certainFail = (f + remaining) === 0 || (f + remaining) / (f + remaining + a) < threshold - EPS || f + remaining <= a;
  return {
    electorate, cast, quorumNeeded, quorumMet, voters: roll.size, weighted: !!p.weights,
    for: f, against: a, abstain: ab, share, thresholdMet,
    remaining, certain: certainCarry ? 'carried' : certainFail ? 'failed' : null,
    counted, rejected, replaced,
  };
}

export function count(state, proposalId) {
  const p = state.proposals[proposalId];
  if (!p) throw new Error(`no proposal ${proposalId}`);
  const t = tallyOf(p);
  return {
    proposal: p.id,
    electorate: t.electorate, cast: t.cast, quorumNeeded: t.quorumNeeded, quorumMet: t.quorumMet, voters: t.voters, weighted: t.weighted, electorateSpec: p.electorate || 'members',
    for: t.for, against: t.against, abstain: t.abstain, share: t.share, thresholdMet: t.thresholdMet,
    open: !p.closed,
    closedEarly: p.closed ? !!p.closed.closedEarly : false,
    carried: p.closed ? p.closed.carried : false,
    projected: p.closed ? null : (t.quorumMet && t.thresholdMet ? 'carrying' : 'not carrying'),
    certain: t.certain,
    deadline: p.deadline,
    counted: t.counted, rejected: t.rejected, replaced: t.replaced,
  };
}
