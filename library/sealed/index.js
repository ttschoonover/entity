// sealed · content only members can read.
//
//   seal.key   { pub }                   publish your encryption key (made from
//                                        your signing key; see box.js)
//   seal.epoch { epoch, wraps }          start a key period: a new group key,
//                                        sealed to every member with a key
//   seal.grant { member, epoch, wrap }   give a period's key to a member who
//                                        lacks it (a newcomer, say)
//   seal.post  { post, epoch, title?, nonce, ct }   a sealed post
//
// Only shapes are checked here: settlement never decrypts anything, so every
// copy (members' or not) settles and verifies the record alike. Anyone can
// hold a copy; only holders of a period's key can read what was sealed in it.
//
// The rule that makes removal safe: nothing new can be sealed while anyone who
// holds the current period's key has left or been removed. The first sealed
// act after someone departs must be a new period, which they are not part of.

const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const book = (state) => (state.m.sealed ||= { pubs: {}, epochs: [], posts: [] });
const active = (state, id) => state.participants[id]?.status === 'active';
const isBox = (b) => b && B64.test(b.epk || '') && B64.test(b.nonce || '') && B64.test(b.ct || '') && b.ct.length < 200;
export const current = (state) => state.m.sealed?.epochs.at(-1) || null;
export const holders = (epoch) => Object.keys(epoch?.wraps || {});
// Who holds the current key but is no longer a member: while anyone does,
// a new period must come first.
export const departed = (state) => holders(current(state)).filter(id => !active(state, id));

function install(r) {
  const kind = (name, check, reduce) => r.registerKind({ name, module: 'sealed', check, reduce });

  kind('seal.key', (state, a) => {
    if (!active(state, a.by)) return 'only a member publishes an encryption key';
    return typeof a.pub === 'string' && B64.test(a.pub) && a.pub.length === 44 ? null : 'pub is a 32-byte key, in base64';
  }, (state, rec) => { const a = rec.payload.act; book(state).pubs[a.by] = a.pub; });

  kind('seal.epoch', (state, a) => {
    const s = state.m.sealed || { pubs: {}, epochs: [] }, cur = current(state);
    if (!active(state, a.by)) return 'only a member starts a key period';
    if (a.epoch !== (cur ? cur.n + 1 : 1)) return `the next period is ${cur ? cur.n + 1 : 1}`;
    if (cur && !cur.wraps[a.by]) return 'only a holder of the current key starts the next period';
    if (!s.pubs[a.by]) return 'publish your own encryption key first';
    const due = Object.keys(s.pubs).filter(id => active(state, id)).sort();
    const given = Object.keys(a.wraps || {}).sort();
    if (given.join() !== due.join()) return `the new key must be sealed to exactly the members with keys: ${due.join(', ')}`;
    return Object.values(a.wraps).every(isBox) ? null : 'each wrap is { epk, nonce, ct } in base64';
  }, (state, rec) => {
    const a = rec.payload.act;
    book(state).epochs.push({ n: a.epoch, by: a.by, at: rec.at, wraps: { ...a.wraps } });
  });

  kind('seal.grant', (state, a, { params }) => {
    const s = state.m.sealed, e = s?.epochs.find(x => x.n === a.epoch);
    if (!e) return 'there is no such key period';
    if (!e.wraps[a.by]) return 'only a holder of that period’s key can give it';
    if (!active(state, a.member) || !s.pubs[a.member]) return 'give keys only to members who have published an encryption key';
    if (e.wraps[a.member]) return `${a.member} already holds it`;
    if (params.value('sealed.history') === 'current' && e !== current(state)) return 'newcomers receive only the current period’s key here (sealed.history)';
    if (e === current(state) && departed(state).length) return 'someone who holds the current key has left: start a new period instead';
    return isBox(a.wrap) ? null : 'the wrap is { epk, nonce, ct } in base64';
  }, (state, rec) => { const a = rec.payload.act; state.m.sealed.epochs.find(x => x.n === a.epoch).wraps[a.member] = a.wrap; });

  kind('seal.post', (state, a) => {
    const cur = current(state);
    if (!cur) return 'no key period has started yet';
    if (a.epoch !== cur.n) return `seal it under the current period, ${cur.n}`;
    if (!cur.wraps[a.by]) return 'only a holder of the current key can seal content';
    const gone = departed(state);
    if (gone.length) return `${gone.join(', ')} held the current key and ${gone.length > 1 ? 'have' : 'has'} left: start a new key period first`;
    if (!ID.test(a.post || '') || state.m.sealed.posts.some(p => p.id === a.post)) return 'a new post id: lowercase letters, digits and -';
    if (a.title !== undefined && (typeof a.title !== 'string' || a.title.length > 120)) return 'a title is at most 120 characters (it is not sealed)';
    return B64.test(a.nonce || '') && B64.test(a.ct || '') && a.ct.length <= 400000 ? null : 'nonce and ct are base64; the content is at most about 300 KB';
  }, (state, rec) => {
    const a = rec.payload.act;
    state.m.sealed.posts.push({ id: a.post, by: a.by, at: rec.at, epoch: a.epoch, title: a.title || '', nonce: a.nonce, ct: a.ct });
  });
}

export default { name: 'sealed', core: '0.9.0', install, parameterKeys: ['sealed.history'] };
