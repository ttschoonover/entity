// entity notify · notices to members, sealed to each one's record key (the notify module)
//
//   entity notify status                         keys, who is subscribed where, what waits
//   entity notify send                           deliver what waits now (entity serve does it every few seconds)
//   entity notify subscribe --email a@b.c  [--events proposals,decisions] [--plaintext]  --as you
//   entity notify subscribe --sms +15105551234 [--events …]                               --as you
//   entity notify list | unsubscribe <id>                                                 --as you
//   entity notify inbox                          your notices, opened here with your key  --as you
//
// The member commands publish your key file's record key if you have none.
// If a different one is published (the page's), they refuse rather than
// replace it, since that would end the page's subscriptions: --replace-key.
//
// Email and text messages are sent by the commands in node.json "notify"
// ("mail", "sms"); push by the page (You → Notifications). See cli/notify.js.
import * as store from '../../kernel/store.js';
import * as N from '../../kernel/notice.js';
import { sealing as S } from '../../kernel/index.js';
import { refuse, openEntity, out, settlePending, signed, loadKey, whoAmI } from '../context.js';
import * as notify from '../notify.js';

export async function notifyCommand({ pos, opt }) {
  const sub = pos[0] || 'status';
  const e = await openEntity(opt, { readable: sub === 'status' || sub === 'send' ? false : true });
  if (!notify.enabled(e) && !e.unreadable) refuse('the notify module is not enabled here: propose it, entity module …');

  if (sub === 'status') {
    const k = await notify.publicKeys(e.dir), subs = notify.readSubs(e.dir), node = store.readNode(e.dir).notify || {};
    out(`node notify key: ${k.nodeKey}`);
    out(`push (VAPID) key: ${k.vapidKey}`);
    const rows = Object.entries(subs).filter(([, l]) => l.length);
    out(rows.length ? 'subscribed:' : 'nobody is subscribed yet');
    for (const [m, l] of rows) out(`  ${m.padEnd(16)} ${l.map(s => `${s.channel}${s.label ? ` (${s.label})` : ''}: ${s.events.join(',')}`).join(' · ')}`);
    out(`waiting to be delivered: ${notify.pending(e.dir).length}`);
    out(`email: ${node.mail ? `by "${node.mail}"` : 'no "mail" command in node.json "notify"'} · text messages: ${node.sms ? `by "${node.sms}"` : 'no "sms" command'} · links: ${node.url || '(relative: set node.json notify.url)'}`);
    if (!e.unreadable) out(`events this republic allows: ${e.params.value('notify.events').join(', ')}; plaintext email ${e.params.value('notify.plaintext_email') ? 'allowed' : 'not allowed'}`);
    return;
  }
  if (sub === 'send') { const r = await notify.deliver(e.dir); out(`sent ${r.sent}, failed ${r.failed}, waiting ${r.waiting}`); return; }

  // The rest act as a member, proved with their record key.
  const id = whoAmI(e.state.entity.id, opt), key = loadKey(e.state.entity.id, id, opt.key);
  const rk = await S.recordKeyFromSeed(key.seed);
  const published = S.sealingState(e.state).keys[id];
  if (published !== S.cryptoB64(rk.pk)) {
    // A different key is published (usually the page's, from signing in with a
    // password): replacing it would silently end every subscription made with it.
    if (published && !opt['replace-key']) refuse(`${id}'s published record key is not the one in this key file: it most likely comes from signing in with a password in the page. Replacing it would end every notification set up there, so nothing was changed. Manage ${id}'s notifications in the page, or pass --replace-key to replace it anyway.`);
    // No record key published yet (or --replace-key): publish it first.
    store.writePending(e.dir, await signed(e, 'member.recordkey', { by: id, key: S.cryptoB64(rk.pk) }, opt));
    const r = await settlePending(e);
    if (!r.applied.some(a => a.act.kind === 'member.recordkey')) refuse(`could not publish ${id}'s record key: ${r.refused[0]?.reason || 'it waits to be settled'}`);
    out(`published ${id}'s record key`);
  }
  const { nodeKey } = await notify.publicKeys(e.dir);
  const ask = async (body) => notify.handle(e, await N.signRequest({ entity: e.state.entity.id, member: id, at: new Date().toISOString(), ...body }, { recordSk: rk.sk, nodeKey }));
  const done = (r) => { if (!r.ok) refuse(r.error); return r; };

  if (sub === 'subscribe') {
    const channel = opt.email ? 'email' : opt.sms ? 'sms' : refuse('say where: --email address or --sms +number (push is set up in the page)');
    const r = done(await ask({ op: 'subscribe', channel, address: String(opt.email || opt.sms), ...(opt.events ? { events: String(opt.events).split(',') } : {}), ...(opt.plaintext ? { plaintext: true } : {}) }));
    out(`subscribed (${r.id}): ${r.events.join(', ')}`);
    if (opt.plaintext && channel === 'email' && !e.params.value('notify.plaintext_email')) out('emails will say only that there is something new: notify.plaintext_email is off here');
    return;
  }
  if (sub === 'list') { for (const s of done(await ask({ op: 'list' })).subscriptions) out(`${s.id}  ${s.channel}  ${s.address || s.endpoint || ''}  ${s.events.join(',')}${s.plaintext ? '  (titles in clear)' : ''}`); return; }
  if (sub === 'unsubscribe') { done(await ask({ op: 'unsubscribe', id: pos[1] || refuse('which? entity notify list shows the ids') })); out('unsubscribed'); return; }
  if (sub === 'inbox') {
    const r = done(await ask({ op: 'inbox' }));
    if (!r.notices.length) return out('no notices');
    for (const s of r.notices) { const n = await N.openNotice(s, rk.sk); out(`${n.at}  ${n.title}${n.text ? ` — ${n.text}` : ''}`); }
    return;
  }
  refuse('entity notify status | send | subscribe | list | unsubscribe <id> | inbox');
}
