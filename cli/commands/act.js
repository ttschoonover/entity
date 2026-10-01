import fs from 'node:fs';
import * as store from '../../kernel/store.js';
import { keys, actHash, draft, signAct } from '../../kernel/index.js';
import { refuse, openEntity, value, signed, settlePending, out, saveKey, loadKey, whoAmI, now } from '../context.js';

const RESERVED = new Set(['dir', 'as', 'key', 'out', 'json', 'settle', 'at']);

export async function act({ pos, opt }) {
  const kind = pos[0] || refuse('which kind? e.g. `entity act proposal.lay --title … --rule ordinary`');
  const e = await openEntity(opt);
  if (!e.registry.has(kind)) refuse(`unknown kind "${kind}". Known: ${e.registry.kinds().join(', ')}`);
  const fields = opt.json ? value(opt.json) : {};
  for (const [k, v] of Object.entries(opt)) if (!RESERVED.has(k)) fields[k] = value(v);
  if (opt.at) fields.at = opt.at;
  const a = await signed(e, kind, fields, opt);
  if (opt.out) { fs.writeFileSync(opt.out, JSON.stringify(a, null, 2) + '\n'); out(`signed ${kind} written to ${opt.out}; carry it to any copy and run \`entity absorb\`.`); return; }
  const f = store.writePending(e.dir, a);
  out(`signed ${kind} by ${a.by} → ${f}`);
  if (kind === 'proposal.lay') {
    const { default: d } = await import('../../modules/deliberation/index.js');
    out(`proposal id ${d.proposalId(a)}`);
  }
  if (opt.settle) return settle({ pos: [], opt });
}

// A proposal carrying effects, laid under the least rule they need.
export async function propose({ opt }) {
  const e = await openEntity(opt);
  const { required, proposalId } = await import('../../modules/deliberation/index.js');
  const fields = { title: opt.title || refuse('give a --title') };
  if (opt.text) fields.text = String(opt.text);
  if (opt.effects) fields.effects = value(opt.effects);
  if (opt.changes) fields.changes = value(opt.changes);
  if (!fields.effects && !fields.changes) refuse('give --effects \'[{"kind":…}]\' and/or --changes \'{"key":value}\'');
  fields.rule = opt.rule || required(e.params, fields, e.registry).name;
  const a = await signed(e, 'proposal.lay', fields, opt);
  store.writePending(e.dir, a);
  out(`proposal ${proposalId(a)} signed under the ${fields.rule} rule`);
  if (opt.settle) return settle({ pos: [], opt });
}

export async function join({ opt }) {
  const e = await openEntity(opt);
  const id = opt.id || refuse('choose an id with --id (lowercase letters, digits and -)');
  if (e.state.participants[id]) refuse(`${id} is already taken`);
  const radicleKey = opt.radicle ? (await import('./radicle.js')).radicleKeyFile(opt) : null;
  // In a fork, a parent's member claims their id with the key they held there.
  const parent = e.state.entity.parent;
  if (!radicleKey && !opt.key && parent?.members?.[id]) {
    const f = (await import('../context.js')).keyDir(parent.entity) + `/${id}`;
    if (!fs.existsSync(f)) refuse(`${id} was a member of ${parent.name || parent.entity}; join with the key you held there: --key <file>`);
    opt.key = f;
  }
  const key = radicleKey || opt.key ? loadKey(e.state.entity.id, id, radicleKey || opt.key) : (await keys.generate()).privateKey;
  const a = await signAct(e.registry, draft('participant.apply', {
    entity: e.state.entity.id, by: id, at: now(), key: keys.publicKeyLine(key.publicKey), ...(opt.name ? { name: opt.name } : {}),
  }), key);
  const file = radicleKey ? (await import('./radicle.js')).linkKey(e.state.entity.id, id, radicleKey)
    : parent?.members?.[id] ? saveKey(e.state.entity.id, id, key) : opt.key || saveKey(e.state.entity.id, id, key);
  const f = opt.out ? (fs.writeFileSync(opt.out, JSON.stringify(a, null, 2) + '\n'), opt.out) : store.writePending(e.dir, a);
  out(`application for ${id} signed with ${radicleKey || opt.key ? 'the key at' : 'a new key, saved at'} ${file}.`);
  out(`  act: ${f}`);
  out(`It takes effect when settled${e.params.value('membership.admission') === 'decision' ? ' and then admitted by decision' : ''}.`);
}

export async function key({ pos, opt }) {
  const e = await openEntity(opt);
  const sub = pos[0] || 'show';
  const id = whoAmI(e.state.entity.id, opt);
  if (sub === 'show') {
    const k = loadKey(e.state.entity.id, id, opt.key);
    out(keys.publicKeyLine(k.publicKey, id));
    const p = e.state.participants[id];
    out(p ? `registered: ${p.keys.includes(keys.keyId(keys.publicKeyLine(k.publicKey))) ? 'yes' : 'NO — this key is not on the register for ' + id}` : `${id} is not on the register`);
    return;
  }
  if (sub === 'rotate') {
    const old = loadKey(e.state.entity.id, id, opt.key);
    const fresh = (await keys.generate()).privateKey;
    const a = await signAct(e.registry, draft('participant.key', {
      entity: e.state.entity.id, by: id, at: now(), add: keys.publicKeyLine(fresh.publicKey), revoke: keys.publicKeyLine(old.publicKey),
    }), old);
    const dir = (await import('../context.js')).keyDir(e.state.entity.id);
    fs.renameSync(`${dir}/${id}`, `${dir}/${id}.retired-${Date.now()}`);
    fs.renameSync(`${dir}/${id}.pub`, `${dir}/${id}.pub.retired-${Date.now()}`);
    saveKey(e.state.entity.id, id, fresh);
    store.writePending(e.dir, a);
    out(`rotation signed with the old key; the new key is saved. It takes effect when settled.`);
    return;
  }
  refuse(`unknown key command "${sub}"; use show or rotate`);
}

export async function settle({ opt }) {
  const e = await openEntity(opt);
  const r = await settlePending(e, { dry: !!opt.dry });
  for (const a of r.applied) out(`  settled   ${a.act.kind.padEnd(18)} ${a.act.by.padEnd(10)} ${a.act.at}`);
  for (const x of r.refused) out(`  refused   ${x.act.kind.padEnd(18)} ${String(x.act.by).padEnd(10)} ${x.reason}`);
  for (const m of r.fetched?.installed || []) out(`  installed module ${m} (code matches the digest its decision approved)`);
  for (const f of r.fetched?.failed || []) out(`  module ${f.name}: ${f.why}`);
  if (r.held?.length) out(`  ${r.held.length} act(s) wait: this copy lacks the code of ${r.waitingFor.join(', ')}. Run \`entity module fetch\`.`);
  if (r.waiting) out(`  ${r.waiting} act(s) wait for the settlement window (settleAfter in node.json)`);
  if (r.published) out(r.published.refused.length ? `  NOT published: ${r.published.refused.map(x => x.why).join('; ')}` : `  published to ${r.published.reached.join(', ')}`);
  out(`${opt.dry ? '(dry run) ' : ''}${r.applied.length} settled, ${r.refused.length} refused; record holds ${e.records.length + (opt.dry ? r.records.length : 0)} records.`);
}
