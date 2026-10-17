// entity seal — sealed content from the terminal, as the page's Sealed tab does.
//   entity seal status
//   entity seal key    --as ID              publish your encryption key
//   entity seal epoch  --as ID              start a new key period
//   entity seal grant  MEMBER --as ID       give a member the key(s) they lack
//   entity seal post   --as ID --title "…" --body "…"   (or --file path)
//   entity seal read   [POST] --as ID       open sealed posts
// Add --password to use your password instead of your key file.
import fs from 'node:fs';
import { refuse, openEntity, out, signed, loadKey, whoAmI, askPassword } from '../context.js';
import * as store from '../../kernel/store.js';
import { settle } from './act.js';

async function myKey(e, by, opt) {
  if (opt.password) {
    const { passwordKey, keys } = await import('../../kernel/index.js');
    const key = await passwordKey(e.state.entity.id, by, await askPassword(`Password for ${by}: `));
    if (!e.state.participants[by]?.keys.includes(keys.keyId(keys.publicKeyLine(key.publicKey)))) refuse(`that is not ${by}'s password`);
    return key;
  }
  return loadKey(e.state.entity.id, by, opt.key);
}

export async function seal({ pos, opt }) {
  const sub = pos[0];
  const e = await openEntity(opt);
  if (!e.params.value('entity.modules').includes('sealed')) refuse('the sealed module is not enabled here: install it first');
  const box = await import(`${e.dir}/modules/sealed/box.js`).catch(() => import('../../library/sealed/box.js'));
  const s = e.state.m.sealed || { pubs: {}, epochs: [], posts: [] }, cur = s.epochs.at(-1) || null;
  const active = (id) => e.state.participants[id]?.status === 'active';
  const departed = cur ? Object.keys(cur.wraps).filter(id => !active(id)) : [];
  if (sub === 'status' || !sub) {
    out(cur ? `key period ${cur.n}, held by ${Object.keys(cur.wraps).join(', ')}` : 'no key period yet');
    if (departed.length) out(`${departed.join(', ')} held it and left: start a new period before sealing anything (entity seal epoch)`);
    out(`encryption keys published by: ${Object.keys(s.pubs).filter(active).join(', ') || 'nobody'}`);
    out(`${s.posts.length} sealed post${s.posts.length === 1 ? '' : 's'}${s.posts.length ? `: ${s.posts.map(p => `${p.id} "${p.title}"`).join(', ')}` : ''}`);
    return;
  }
  const by = opt.as || whoAmI(e.state.entity.id, opt);
  const key = await myKey(e, by, opt);
  const sign = async (kind, fields) => {
    const a = await signed(e, kind, { by, ...fields }, { ...opt, as: by });
    out(`signed ${kind} by ${by} → ${store.writePending(e.dir, a)}`);
  };
  if (sub === 'key') {
    await sign('seal.key', { pub: box.b64((await box.memberKeys(key.seed)).pub) });
  } else if (sub === 'epoch') {
    const gk = box.newGroupKey(), wraps = {};
    for (const [id, pub] of Object.entries(s.pubs)) if (active(id)) wraps[id] = await box.sealTo(pub, gk);
    await sign('seal.epoch', { epoch: cur ? cur.n + 1 : 1, wraps });
  } else if (sub === 'grant') {
    const member = pos[1]; if (!member) refuse('usage: entity seal grant MEMBER --as ID');
    if (!s.pubs[member]) refuse(`${member} has not published an encryption key (entity seal key --as ${member})`);
    const mine = await box.groupKeys(e.state, by, key.seed);
    const periods = e.params.value('sealed.history') === 'all' ? s.epochs : [cur];
    let n = 0;
    for (const ep of periods) if (ep && mine[ep.n] && !ep.wraps[member]) { await sign('seal.grant', { member, epoch: ep.n, wrap: await box.sealTo(s.pubs[member], mine[ep.n]) }); n++; }
    if (!n) refuse(`there is no key you hold that ${member} lacks`);
  } else if (sub === 'post') {
    if (!cur) refuse('no key period yet: entity seal epoch');
    const text = opt.file ? fs.readFileSync(opt.file, 'utf8') : opt.body;
    if (typeof text !== 'string' || !text) refuse('give --body "…" or --file path');
    const gk = (await box.groupKeys(e.state, by, key.seed))[cur.n]; if (!gk) refuse('you do not hold the current key');
    await sign('seal.post', { post: opt.post || `s-${Date.now().toString(36)}`, epoch: cur.n, ...(opt.title ? { title: String(opt.title) } : {}), ...(await box.encrypt(gk, text)) });
  } else if (sub === 'read') {
    const mine = await box.groupKeys(e.state, by, key.seed);
    const posts = pos[1] ? s.posts.filter(p => p.id === pos[1]) : s.posts;
    if (!posts.length) refuse(pos[1] ? `no sealed post ${pos[1]}` : 'nothing sealed yet');
    for (const p of posts) {
      out(`── ${p.id} · "${p.title}" · ${p.by} · ${p.at} · period ${p.epoch}`);
      out(mine[p.epoch] ? await box.decrypt(mine[p.epoch], p) : '(you do not hold this period’s key)');
    }
    return;
  } else refuse('usage: entity seal status | key | epoch | grant MEMBER | post --title … --body … | read [POST]');
  if (opt.settle) return settle({ pos: [], opt });
}
