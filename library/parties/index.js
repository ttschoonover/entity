// parties · political parties: groups of members with a name, a platform and a
// leader, who campaign, stand together and decide some things among themselves.
//
// Acts, signed by members:
//   party.found    { party, title, platform?, joining? }   start a party; you are its first member and leader
//                  joining: "open" (anyone may join) or "approval" (the leader admits)
//   party.join     { party }                 join it, or ask to (approval)
//   party.accept   { party, member }         the leader admits someone who asked
//   party.leave    { party }                 leave; always allowed
//   party.platform { party, platform }       the leader rewrites the platform
//   party.leader   { party, to }             the leader hands over; or any member's
//                  call for a new leader, which takes effect once more than half
//                  of the party's members have called for the same person
//
// By decision of the whole entity:
//   party.dissolve { party, reason }         under parties.dissolve_rule
//
// Electorate:  party:ID   the party's members, each after parties.cooling_days.
// A party is registered while it has parties.min_members active members. With
// parties.exclusive (the default) a member belongs to one party at a time.
//
// allocate(votes, seats, method) shares seats among parties by D'Hondt or
// Sainte-Laguë, deterministically, for any module that elects by party lists.

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = 86400000;
const book = (state) => (state.m.parties = state.m.parties || { parties: {} });
const party = (state, id) => state.m.parties?.parties?.[id];
const active = (state, id) => state.participants[id]?.status === 'active';

// The members of a party at a time, with the date each joined.
export function members(state, id, at = null) {
  const p = party(state, id);
  if (!p || p.dissolved) return [];
  return p.members.filter(m => !m.until && active(state, m.id) && (!at || m.since <= at)).map(m => m.id);
}
export const registered = (state, id, params) => members(state, id).length >= params.value('parties.min_members');
// The party a member belongs to now, or null.
export function partyOf(state, who) {
  for (const p of Object.values(state.m.parties?.parties || {})) {
    if (!p.dissolved && p.members.some(m => m.id === who && !m.until)) return p.id;
  }
  return null;
}
const isMember = (state, id, who) => members(state, id).includes(who);
const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;

// Seats among parties by the highest-averages method: D'Hondt (divisors 1, 2,
// 3…) or Sainte-Laguë (1, 3, 5…). Ties go to the party with more votes, then
// the earlier id, so every copy reaches the same answer.
export function allocate(votes, seats, method = 'dhondt') {
  const out = Object.fromEntries(Object.keys(votes).map(k => [k, 0]));
  const div = method === 'sainte-lague' ? (n) => 2 * n + 1 : (n) => n + 1;
  for (let s = 0; s < seats; s++) {
    let best = null;
    for (const k of Object.keys(votes).sort()) {
      if (votes[k] <= 0) continue;
      const q = votes[k] / div(out[k]);
      if (!best || q > best.q || (q === best.q && votes[k] > votes[best.k])) best = { k, q };
    }
    if (!best) break;
    out[best.k]++;
  }
  return out;
}

function install(r) {
  r.registerKind({
    name: 'party.found', module: 'parties',
    check(state, act, { params }) {
      if (!ID.test(act.party || '')) return 'a party id is lowercase letters, digits and -';
      if (party(state, act.party)) return `there is already a party ${act.party}`;
      if (!text(act.title, 120)) return 'a party needs a name of 1–120 characters';
      if (act.platform !== undefined && (typeof act.platform !== 'string' || act.platform.length > 20000)) return 'a platform is at most 20,000 characters';
      if (act.joining !== undefined && !['open', 'approval'].includes(act.joining)) return 'joining is "open" or "approval"';
      if (!active(state, act.by)) return 'only active members found parties';
      const mine = partyOf(state, act.by);
      if (mine && params.value('parties.exclusive')) return `you belong to ${mine}: leave it first`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act;
      book(state).parties[a.party] = { id: a.party, title: a.title, platform: a.platform || '', joining: a.joining || 'open', founded: rec.at, by: a.by,
        leader: a.by, members: [{ id: a.by, since: rec.at }], asking: [], calls: {} };
    },
  });
  r.registerKind({
    name: 'party.join', module: 'parties',
    check(state, act, { params }) {
      const p = party(state, act.party);
      if (!p || p.dissolved) return `there is no party ${act.party}`;
      if (!active(state, act.by)) return 'only active members join parties';
      if (isMember(state, act.party, act.by)) return `you already belong to ${act.party}`;
      if (p.asking.includes(act.by)) return 'you have already asked to join';
      const mine = partyOf(state, act.by);
      if (mine && params.value('parties.exclusive')) return `you belong to ${mine}: leave it first`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = party(state, a.party);
      if (p.joining === 'approval') p.asking.push(a.by);
      else p.members.push({ id: a.by, since: rec.at });
    },
  });
  r.registerKind({
    name: 'party.accept', module: 'parties',
    check(state, act, { params }) {
      const p = party(state, act.party);
      if (!p || p.dissolved) return `there is no party ${act.party}`;
      if (p.leader !== act.by) return `only the leader of ${act.party} admits members`;
      if (!p.asking.includes(act.member)) return `${act.member} has not asked to join`;
      const theirs = partyOf(state, act.member);
      if (theirs && params.value('parties.exclusive')) return `${act.member} has since joined ${theirs}`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = party(state, a.party);
      p.asking = p.asking.filter(x => x !== a.member);
      p.members.push({ id: a.member, since: rec.at });
    },
  });
  r.registerKind({
    name: 'party.leave', module: 'parties',
    check(state, act) {
      const p = party(state, act.party);
      if (!p || p.dissolved) return `there is no party ${act.party}`;
      if (!p.members.some(m => m.id === act.by && !m.until) && !p.asking.includes(act.by)) return `you do not belong to ${act.party}`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = party(state, a.party);
      p.asking = p.asking.filter(x => x !== a.by);
      for (const m of p.members) if (m.id === a.by && !m.until) m.until = rec.at;
      for (const k of Object.keys(p.calls)) p.calls[k] = p.calls[k].filter(x => x !== a.by);
      const left = p.members.filter(m => !m.until).map(m => m.id);
      // The last one out winds the party up; a leader who leaves hands over to
      // the longest-standing member.
      if (!left.length) p.dissolved = { at: rec.at, reason: 'its last member left' };
      else if (p.leader === a.by) p.leader = left[0];
    },
  });
  r.registerKind({
    name: 'party.platform', module: 'parties',
    check(state, act) {
      const p = party(state, act.party);
      if (!p || p.dissolved) return `there is no party ${act.party}`;
      if (p.leader !== act.by) return `only the leader of ${act.party} rewrites its platform`;
      if (typeof act.platform !== 'string' || act.platform.length > 20000) return 'a platform is at most 20,000 characters';
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = party(state, a.party);
      (p.platforms ||= []).push({ at: p.platformAt || p.founded, text: p.platform });
      p.platform = a.platform; p.platformAt = rec.at;
    },
  });
  r.registerKind({
    name: 'party.leader', module: 'parties',
    check(state, act) {
      const p = party(state, act.party);
      if (!p || p.dissolved) return `there is no party ${act.party}`;
      if (!isMember(state, act.party, act.by)) return `you do not belong to ${act.party}`;
      if (!isMember(state, act.party, act.to)) return `${act.to} does not belong to ${act.party}`;
      if (p.leader === act.to) return `${act.to} already leads ${act.party}`;
      return null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = party(state, a.party);
      if (p.leader === a.by) { p.leader = a.to; p.calls = {}; return; }
      for (const k of Object.keys(p.calls)) p.calls[k] = p.calls[k].filter(x => x !== a.by);
      (p.calls[a.to] ||= []).push(a.by);
      const n = members(state, a.party).length;
      if (p.calls[a.to].length > n / 2) { p.leader = a.to; p.calls = {}; }
    },
  });

  r.registerEffect({
    name: 'party.dissolve', module: 'parties',
    rule: (params) => params.value('parties.dissolve_rule'),
    describe: (e) => `Dissolve the party ${e.party} (${e.reason})`,
    check(state, e) {
      const p = party(state, e.party);
      if (!p || p.dissolved) return `there is no party ${e.party}`;
      if (!text(e.reason, 500)) return 'dissolving a party needs a published reason';
      return null;
    },
  });
  r.registerRecord('party.dissolve', (state, rec) => {
    const p = party(state, rec.payload.party);
    if (p) p.dissolved = { at: rec.at, reason: rec.payload.reason, proposal: rec.payload.proposal || null };
  });

  r.registerElectorate({
    name: 'party', module: 'parties',
    describe: (id) => `the members of the party ${id}`,
    check: (state, id) => (!id ? 'name the party: party:ID' : !party(state, id) || party(state, id).dissolved ? `there is no party ${id}` : null),
    roll(state, id, params, at) {
      const wait = params.value('parties.cooling_days') * DAY;
      const cutoff = at ? new Date(Date.parse(at) - wait).toISOString() : null;
      return Object.fromEntries(members(state, id, cutoff).map(m => [m, 1]));
    },
  });
}

export default { name: 'parties', core: '0.7.7', install, members, partyOf, registered, allocate,
  parameterKeys: ['parties.min_members', 'parties.exclusive', 'parties.cooling_days', 'parties.dissolve_rule'] };
