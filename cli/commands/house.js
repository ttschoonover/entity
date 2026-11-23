// entity house · a house hub's own settings, from the machine that runs its node
// (node.json "house"; see cli/house.js). The admins change the same things on
// the hub's House settings page; this is for setting it up, and for when no
// admin can sign in.
//
//   entity house status
//   entity house on [--name "…"] [--admin id]     turn house access on (the node must be private)
//   entity house name "…"
//   entity house password                         asked twice, or HOUSE_PASSWORD
//   entity house admin add|remove <id>
//   entity house address add|remove <ip or network>   a public address that counts as the house
//   entity house detect on|off
//   entity house off
import { openEntity, out, refuse, askPassword } from '../context.js';
import * as H from '../house.js';
import * as store from '../../kernel/store.js';

export async function house({ pos, opt }) {
  const e = await openEntity(opt);
  const sub = pos[0] || 'status';
  let h = H.houseOf(e.dir);
  const save = (changes) => { const r = H.applyChanges(h || {}, changes, e.state); if (r.why) refuse(r.why); H.writeHouse(e.dir, r.house); h = r.house; };
  const need = () => { if (!h) refuse('house access is off here: turn it on with  entity house on --admin <your id>'); };
  if (sub === 'on') {
    if (store.readNode(e.dir).private !== true) refuse('house access is for a private node: set "private": true in node.json first');
    const admin = opt.admin || e.state.order.find(id => e.state.participants[id]?.status === 'active');
    h = h || {};
    save({ name: opt.name || h.name || e.params.value('entity.name'), admins: h.admins?.length ? h.admins : [admin], ...(h.networks ? {} : { networks: H.DEFAULT_NETWORKS }), detect: h.detect !== false });
    out(`house access is on for ${h.name}. Admins: ${h.admins.join(', ')}. Set a house password with  entity house password  (restart the node to apply).`);
  } else if (sub === 'off') {
    need(); const f = (await import('node:path')).join(e.dir, 'node.json'), fs = await import('node:fs');
    const n = JSON.parse(fs.readFileSync(f, 'utf8')); delete n.house; fs.writeFileSync(f, `${JSON.stringify(n, null, 2)}\n`);
    out('house access is off: only members get in (restart the node to apply).');
  } else if (sub === 'name') {
    need(); const name = pos.slice(1).join(' '); if (!name) refuse('usage: entity house name "The hub\'s name"');
    save({ name }); out(`the hub is now called ${h.name}.`);
  } else if (sub === 'password') {
    need();
    let pw = process.env.HOUSE_PASSWORD;
    if (!pw) { pw = await askPassword('New house password: '); if (pw !== await askPassword('The same again: ')) refuse('the two passwords differ; nothing changed'); }
    save({ password: pw }); out('the house password is set. Every browser that used the old one must type the new one.');
  } else if (sub === 'admin') {
    need(); const [, op, id] = pos; if (!['add', 'remove'].includes(op) || !id) refuse('usage: entity house admin add|remove <member id>');
    const list = new Set(h.admins || []); op === 'add' ? list.add(id) : list.delete(id);
    save({ admins: [...list] }); out(`admins: ${h.admins.join(', ')}`);
  } else if (sub === 'address') {
    need(); const [, op, a] = pos; if (!['add', 'remove'].includes(op) || !a) refuse('usage: entity house address add|remove <address or network>');
    const list = new Set(h.publicIps || []); op === 'add' ? list.add(a) : list.delete(a);
    save({ publicIps: [...list] }); out(`addresses that count as the house: ${h.publicIps.join(', ') || 'none besides the one found automatically'}`);
  } else if (sub === 'detect') {
    need(); if (!['on', 'off'].includes(pos[1])) refuse('usage: entity house detect on|off');
    save({ detect: pos[1] === 'on' }); out(`finding the house's own address automatically: ${pos[1]}`);
  } else if (sub === 'status') {
    if (!h) return out('house access: off');
    const found = await H.detectPublic().catch(() => []);
    out([`house access: on${store.readNode(e.dir).private === true ? '' : ' (but the node is not private, so everyone gets in anyway)'}`,
      `name:        ${h.name || '(the entity\'s own)'}`,
      `admins:      ${(h.admins || []).join(', ') || 'none'}`,
      `password:    ${h.password ? `set ${h.password.set}` : 'not set: away from the house, only members get in'}`,
      `networks:    ${(h.networks || H.DEFAULT_NETWORKS).join(', ')}`,
      `addresses:   ${(h.publicIps || []).join(', ') || 'none listed'}`,
      `detect:      ${h.detect === false ? 'off' : `on (this machine is at ${found.join(', ') || 'unknown: no answer'})`}`].join('\n'));
  } else refuse('usage: entity house status | on | name | password | admin | address | detect | off');
  if (sub !== 'status') out('Restart the node, or wait: the name, password and admins apply at once; detection restarts with the node.');
}
