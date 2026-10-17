// entity federation · what passes between a state and its federation.
//
//   entity federation certify --from <state dir> --state ID --as <registrar id> [--password]
//          [--senate-office federal-senator] [--assembly-office federal-deputy] [--node URL] [--settle]
//     Reads the state's own record (verified by replay first), lists its active
//     citizens and the current holders of its senate and assembly offices, and
//     signs that, with the registrar's state key, for the federation.
//
//   entity federation enroll --from <state dir> --state ID --as <id> [--password] [--node URL] [--settle]
//     Takes up federal citizenship: makes your federal key (from your password,
//     or a new key file) and proves it is yours with your state key.
//
//   entity federation status
//
// Run in the federation's folder (or --dir). --node posts the act to a running
// federal node instead of writing it into this folder; --settle settles it here.

import fs from 'node:fs';
import path from 'node:path';
import { openEntity, refuse, out, loadKey, saveKey, keyDir, askPassword, now, settlePending, fullVerify } from '../context.js';
import { keys, draft, signAct, passwordKey } from '../../kernel/index.js';
import * as store from '../../kernel/store.js';

const line = (k) => keys.publicKeyLine(k.publicKey);
const pwCache = new Map();
async function keyIn(e, id, opt) {
  if (opt.password) {
    const pw = pwCache.get(id) ?? await askPassword(`Password for ${id}: `);
    pwCache.set(id, pw);
    const k = await passwordKey(e.state.entity.id, id, pw);
    return k;
  }
  return loadKey(e.state.entity.id, id, opt.key);
}

async function submit(fe, act, opt) {
  if (opt.node) {
    const r = await fetch(`${String(opt.node).replace(/\/+$/, '')}/acts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(act) });
    const b = await r.json().catch(() => ({}));
    if (b.refused?.length) refuse(`the federation refused it: ${b.refused[0].why}`);
    out(b.settled ? 'Settled by the federation.' : 'Sent; the federation settles it with its next batch.');
    return;
  }
  store.writePending(fe.dir, act);
  if (!opt.settle) { out(`Written to ${path.join(fe.dir, 'pending')}; settle it with \`entity settle\`.`); return; }
  const r = await settlePending(fe);
  if (r.refused.length) refuse(`the federation refused it: ${r.refused[0].reason}`);
  out(`Settled: the federation's record now holds ${fe.records.length} records.`);
}

export async function federation({ pos, opt }) {
  const sub = pos[0] || 'status';
  const fe = await openEntity(opt);
  if (!fe.params.value('entity.modules').includes('federation')) refuse('this entity is not a federation (the federation module is not enabled)');
  const states = fe.state.m.federation?.states || {};

  if (sub === 'status') {
    const fedmod = fe.registry.modules.get('federation');
    const seats = fedmod.seatsOf(fe.state, fe.params);
    out(`${fe.params.value('entity.name')}: ${Object.values(states).filter(s => !s.released).length} state(s), ${fe.params.value('federation.senators_per_state')} senators each, ${fe.params.value('federation.assembly_seats')} assembly seats`);
    for (const s of Object.values(states)) {
      const c = s.certified;
      out(`  ${s.id.padEnd(10)} ${s.name}${s.released ? `  (released ${s.released.at.slice(0, 10)}: ${s.released.reason})` : ''}`);
      if (s.released) continue;
      out(`             ${c ? `${Object.keys(c.citizens).length} citizens, certified from its record at ${c.count} (${c.at.slice(0, 16)})` : 'not certified yet'}`);
      out(`             senate: ${(c?.senate || []).join(', ') || '—'}   assembly (${seats[s.id] ?? 0} seats): ${(c?.assembly || []).join(', ') || '—'}`);
    }
    return;
  }

  const sid = opt.state;
  if (!sid || !states[sid] || states[sid].released) refuse(`--state names one of this federation's states (${Object.keys(states).filter(k => !states[k].released).join(', ') || 'none admitted yet'})`);
  if (!opt.from) refuse('--from <the state\'s folder>');
  const se = await openEntity({ dir: opt.from });
  if (se.state.entity.id !== states[sid].entity) refuse(`${opt.from} holds ${se.state.entity.id}, but ${sid} is ${states[sid].entity}`);
  const v = await fullVerify(se);
  if (!v.ok) refuse(`the state's record does not verify: ${v.problems[0]?.problem}`);
  const id = opt.as;
  if (!id) refuse('--as <id>: who is signing');

  if (sub === 'certify') {
    const key = await keyIn(se, id, opt);
    if (!states[sid].keys.includes(keys.keyId(line(key)))) refuse(`${id}'s key in ${sid} is not ${sid}'s registrar key in the federation`);
    const at = now();
    const citizens = {};
    for (const pid of se.state.order) { const p = se.state.participants[pid]; if (p.status === 'active') citizens[pid] = [...p.keys]; }
    const offices = se.registry.modules.get('offices');
    const holders = (o) => (offices && se.state.m.offices?.[o] && !se.state.m.offices[o].abolished ? offices.current(se.state.m.offices[o], at).map(h => h.id) : []);
    const senate = holders(opt['senate-office'] || 'federal-senator'), assembly = holders(opt['assembly-office'] || 'federal-deputy');
    const act = await signAct(fe.registry, draft('state.certify', { entity: fe.state.entity.id, by: sid, at, key: line(key), state: sid,
      count: se.records.length, head: se.records.at(-1).hash, citizens, senate, assembly }), key);
    out(`${se.params.value('entity.name')} certifies ${Object.keys(citizens).length} citizen(s); senate: ${senate.join(', ') || '—'}; assembly: ${assembly.join(', ') || '—'}`);
    return submit(fe, act, opt);
  }

  if (sub === 'enroll') {
    const p = se.state.participants[id];
    if (!p || p.status !== 'active') refuse(`${id} is not an active citizen of ${sid}`);
    const stateKey = await keyIn(se, id, opt);
    if (!p.keys.includes(keys.keyId(line(stateKey)))) refuse(`that is not ${id}'s key in ${sid}`);
    let fedKey;
    if (opt.password) fedKey = await passwordKey(fe.state.entity.id, id, pwCache.get(id));
    else {
      const f = path.join(keyDir(fe.state.entity.id), id);
      if (fs.existsSync(f)) fedKey = loadKey(fe.state.entity.id, id);
      else { fedKey = (await keys.generate()).privateKey; saveKey(fe.state.entity.id, id, fedKey); out(`Your federal key: ${f}`); }
    }
    const fed = fe.registry.modules.get('federation');
    const state_sig = await keys.sign(fed.enrollMaterial({ entity: fe.state.entity.id, id, key: keys.keyId(line(fedKey)) }), stateKey, fed.NS);
    const act = await signAct(fe.registry, draft('citizen.enroll', { entity: fe.state.entity.id, by: id, at: now(), key: line(fedKey), state: sid, state_key: line(stateKey), state_sig }), fedKey);
    out(`${id} takes up citizenship of ${fe.params.value('entity.name')}, as a citizen of ${states[sid].name}.`);
    return submit(fe, act, opt);
  }
  refuse(`unknown federation command "${sub}"; use certify, enroll or status`);
}
