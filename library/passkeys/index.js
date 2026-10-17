// passkeys · signing in with Face ID, Touch ID, a fingerprint, a phone or a
// security key. With this module on, the page offers it.
//
// A passkey lives on the member's device and never leaves it; the entity holds
// its public key and the website it belongs to (kernel/keys.js). It works only
// on that website: a passkey made on poezine.org signs only there, and cannot
// sign from the command line.
//
//   passkey.add    { key, name }   add a passkey ("iPhone", "YubiKey")
//   passkey.remove { key }         remove one (never the member's last way in)

import { keyId, isPasskey, parsePasskey } from '../../kernel/keys.js';

const book = (state) => (state.m.passkeys ||= {});
const owner = (state, k) => Object.values(state.participants).find(p => p.keys.includes(k)) || null;

function install(r) {
  r.registerKind({
    name: 'passkey.add', module: 'passkeys',
    check(state, act, { params }) {
      const p = state.participants[act.by];
      if (!['active', 'applicant'].includes(p.status)) return `${act.by} is not a member`;
      if (!isPasskey(act.key)) return 'key is a passkey line (webauthn-es256 …)';
      try { parsePasskey(act.key); } catch { return 'that passkey line is damaged'; }
      if (typeof act.name !== 'string' || !act.name.trim() || act.name.length > 60) return 'name it (1–60 characters), e.g. "iPhone"';
      const o = owner(state, keyId(act.key));
      if (o && o.id !== act.by) return 'that passkey belongs to another member';
      const max = params.value('passkeys.max');
      return (book(state)[act.by] || []).length >= max ? `you have ${max} passkeys already, the most allowed` : null;
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = state.participants[a.by], k = keyId(a.key);
      if (!p.keys.includes(k)) p.keys.push(k);
      (book(state)[a.by] ||= []).push({ key: k, name: a.name.trim(), at: rec.at });
    },
  });
  r.registerKind({
    name: 'passkey.remove', module: 'passkeys',
    check(state, act) {
      const p = state.participants[act.by], k = keyId(act.key || '');
      if (!isPasskey(k) || !p.keys.includes(k)) return 'you hold no such passkey';
      return p.keys.length > 1 ? null : 'it is your only way to sign in: add another first';
    },
    reduce(state, rec) {
      const a = rec.payload.act, p = state.participants[a.by], k = keyId(a.key);
      p.keys = p.keys.filter(x => x !== k); p.retired = [...(p.retired || []), { key: k, until: rec.at }];
      book(state)[a.by] = (book(state)[a.by] || []).filter(x => x.key !== k);
    },
  });
}

export default { name: 'passkeys', core: '0.7', install, parameterKeys: ['passkeys.max'] };
