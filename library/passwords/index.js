// passwords · signing in with a username and a password, as well as (or
// instead of) a key file or a passkey. With this module on, the page offers it.
//
// A password is turned into a key on the member's own device (kernel/password.js);
// only its public half is registered, and nothing about the password is stored
// anywhere. This module records which of a member's keys is their password, so
// that it can be changed or removed.
//
//   password.set    { key }   add a password key, replacing the member's old one
//   password.remove { }       remove it (never the member's last way to sign in)
//
// A forgotten password cannot be recovered: nobody has it. A member signs in
// another way and sets a new one, or the members give them a new key by
// decision (participant.rekey).

import { keyId, isPasskey, parsePublicKeyLine } from '../../kernel/keys.js';

const book = (state) => (state.m.passwords ||= {});
const owner = (state, k) => Object.values(state.participants).find(p => p.keys.includes(k)) || null;
const drop = (p, k, at) => { p.keys = p.keys.filter(x => x !== k); p.retired = [...(p.retired || []), { key: k, until: at }]; };

function install(r) {
  r.registerKind({
    name: 'password.set', module: 'passwords',
    check(state, act) {
      const p = state.participants[act.by];
      if (!['active', 'applicant'].includes(p.status)) return `${act.by} is not a member`;
      if (typeof act.key !== 'string' || isPasskey(act.key)) return 'key is the public key the password makes';
      try { parsePublicKeyLine(act.key); } catch { return 'key is the public key the password makes'; }
      const o = owner(state, keyId(act.key));
      return o && o.id !== act.by ? 'that key belongs to another member' : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = state.participants[a.by], k = keyId(a.key), old = book(state)[a.by]?.key;
      if (old && old !== k && p.keys.includes(old)) drop(p, old, rec.at);
      if (!p.keys.includes(k)) p.keys.push(k);
      book(state)[a.by] = { key: k, at: rec.at };
    },
  });
  r.registerKind({
    name: 'password.remove', module: 'passwords',
    check(state, act) {
      const mine = state.m.passwords?.[act.by];
      if (!mine) return 'you have no password to remove';
      return state.participants[act.by].keys.length > 1 ? null : 'it is your only way to sign in: add another first';
    },
    reduce(state, rec) {
      const by = rec.payload.act.by, p = state.participants[by];
      drop(p, book(state)[by].key, rec.at);
      delete book(state)[by];
    },
  });
}

export default { name: 'passwords', core: '0.7', install, parameterKeys: ['passwords.min_length'] };
