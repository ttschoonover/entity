// The sealed tab: key periods, your part in them, and sealed posts, opened in
// your browser with a key derived from your own signing key.
import { current, holders, departed } from './index.js';
import { memberKeys, sealTo, newGroupKey, encrypt, decrypt, groupKeys, b64 } from './box.js';

const opened = new Map(); // post id → text, for this visit
let cachedKeys = null;     // { epoch: groupKey }, for this visit

export default function render(api) {
  const { h, state, params, me, day, who } = api;
  const s = state.m.sealed || { pubs: {}, epochs: [], posts: [] };
  const cur = current(state), gone = departed(state);
  const iHold = me && cur?.wraps[me.id];
  const passkeyOnly = !!api.ident?.passkey;
  const myKeys = async (why) => {
    if (cachedKeys) return cachedKeys;
    const k = await api.key(why); if (!k) throw new Error(passkeyOnly ? 'Passkeys cannot decrypt: sign in with your password or key file to read sealed content.' : 'not unlocked');
    cachedKeys = await groupKeys(state, me.id, k.seed); return cachedKeys;
  };
  const sec = h('section', {}, h('h2', {}, 'Sealed'),
    h('p', { class: 'hint' }, 'Content only members can read. Anyone may hold a copy of the record, but what is sealed opens only with a key given to members, period by period. When someone leaves, a new period starts without them: they keep what they could already read, and nothing after.'));
  if (!cur) sec.append(h('p', {}, 'No key period has started yet.'));
  else sec.append(h('p', {}, `Key period ${cur.n}, started ${day(cur.at)} by `, who(cur.by), `. Held by ${holders(cur).length}: `, ...holders(cur).flatMap((id, i) => [i ? ', ' : '', who(id)])));
  if (gone.length) sec.append(h('p', { class: 'flag' }, `${gone.join(', ')} held the current key and ${gone.length > 1 ? 'have' : 'has'} left. Nothing new can be sealed until a member who holds it starts a new period.`));

  if (me?.status === 'active') {
    const box = h('div', { class: 'grant' }, h('h3', {}, 'Your part'));
    if (passkeyOnly) box.append(h('p', { class: 'hint' }, 'You sign in with a passkey, which cannot decrypt. To take part in sealed content, add a password under Ways to sign in, and sign in with it.'));
    else if (!s.pubs[me.id]) box.append(h('p', {}, 'Publish your encryption key, so members can give you the group key. It is made from your own key: there is nothing new to keep.'),
      h('div', { class: 'buttons' }, h('button', { onclick: async () => { const k = await api.key('Publishing your encryption key'); if (!k) return; api.sign('seal.key', { pub: b64((await memberKeys(k.seed)).pub) }, 'Your encryption key'); } }, 'Publish my encryption key')));
    else {
      const due = Object.keys(s.pubs).filter(id => state.participants[id]?.status === 'active');
      if (!cur || iHold) box.append(h('p', { class: 'hint' }, `${cur ? 'Start a new period' : 'Start the first period'}: a new group key, sealed to the ${due.length} member${due.length === 1 ? '' : 's'} with keys.${gone.length ? ' This is needed now.' : ''}`),
        h('div', { class: 'buttons' }, h('button', { onclick: async () => {
          const gk = newGroupKey(), wraps = {};
          for (const id of due) wraps[id] = await sealTo(s.pubs[id], gk);
          cachedKeys = null;
          api.sign('seal.epoch', { epoch: cur ? cur.n + 1 : 1, wraps }, `Key period ${cur ? cur.n + 1 : 1}`);
        } }, cur ? 'Start a new key period' : 'Start the first key period')));
      else if (cur) box.append(h('p', { class: 'hint' }, 'You do not hold the current key yet: any member who does can give it to you.'));
      const lacking = cur && iHold && !gone.length ? due.filter(id => !cur.wraps[id]) : [];
      if (lacking.length) box.append(h('p', {}, 'These members have published a key but cannot read yet:'), h('div', { class: 'buttons' }, lacking.map(id => h('button', { class: 'quiet', onclick: async () => {
        const mine = await myKeys(`Giving ${id} the keys`).catch(e => { alert(e.message); return null; }); if (!mine) return;
        const all = params.value('sealed.history') === 'all' ? s.epochs.filter(e => mine[e.n] && !e.wraps[id]) : [cur];
        const acts = [];
        for (const e of all) acts.push(['seal.grant', { member: id, epoch: e.n, wrap: await sealTo(s.pubs[id], mine[e.n]) }]);
        const [first, ...rest] = acts;
        api.sign(first[0], first[1], `Giving ${id} ${acts.length > 1 ? `the keys of ${acts.length} periods` : 'the current key'}`, rest);
      } }, `Give ${id} the key`))));
    }
    sec.append(box);
  }

  sec.append(api.list({
    key: 'sealed', items: [...s.posts].reverse(), noun: 'sealed posts', empty: 'Nothing sealed yet.',
    text: (p) => `${p.title} ${p.by}`,
    render: (p) => {
      const out = h('div', { class: 'post-body' }, opened.get(p.id) || '');
      return h('li', {}, h('h3', {}, p.title || '(untitled)', h('span', { class: 'category' }, `period ${p.epoch}`)), h('p', { class: 'meta' }, who(p.by), ` · ${day(p.at)}`), out,
        me && !opened.has(p.id) ? h('div', { class: 'buttons' }, h('button', { class: 'quiet', onclick: async () => {
          try { const k = (await myKeys('Opening sealed posts'))[p.epoch]; if (!k) throw new Error(`You do not hold the key of period ${p.epoch}.`); opened.set(p.id, await decrypt(k, p)); out.textContent = opened.get(p.id); }
          catch (e) { out.textContent = e.message; }
        } }, 'Open')) : null);
    },
  }));

  if (iHold && !gone.length) {
    const title = h('input', { id: 'sl-title', placeholder: 'Minutes of the 4 May meeting' }), body = h('textarea', { id: 'sl-body' });
    sec.append(h('details', {}, h('summary', {}, 'Seal a new post'), h('div', { class: 'inline-form' },
      h('label', { for: 'sl-title' }, 'Title (not sealed: everyone holding a copy can see it)'), title,
      h('label', { for: 'sl-body' }, 'What to seal'), body,
      h('div', { class: 'buttons' }, h('button', { onclick: async () => {
        try {
          const k = (await myKeys('Sealing a post'))[cur.n];
          if (!k) throw new Error('You do not hold the current key.');
          const sealed = await encrypt(k, body.value);
          api.sign('seal.post', { post: `s-${Date.now().toString(36)}`, epoch: cur.n, ...(title.value.trim() ? { title: title.value.trim() } : {}), ...sealed }, 'Your sealed post');
        } catch (e) { alert(e.message); }
      } }, 'Seal and sign')))));
  }
  return sec;
}
