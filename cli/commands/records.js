// entity records · sealed records (kernel/sealing.js, docs/SPEC-RECORD-V2.md)
//
//   entity records status                  sealing, key periods, readers, what this copy can open
//   entity records key    [--settle]       publish your record key, so key periods include you
//   entity records rotate [--settle]       open a new key period for the current readers
//   entity records password [--settle]     let your password open the records too (member.keywrap)
//   entity records disclose <seq> [--out f]  hand one sealed record to an outsider, nothing else
//   entity records check <disclosure.json>   check a disclosure against this copy's record
import fs from 'node:fs';
import * as store from '../../kernel/store.js';
import { sealing as S } from '../../kernel/index.js';
import { refuse, openEntity, out, settlePending, openKeyPeriod, publishRecordKey, signed, whoAmI, loadKey, askPassword } from '../context.js';

export async function records({ pos, opt }) {
  const sub = pos[0] || 'status';
  if (sub === 'check') return check(pos[1], opt);
  const e = await openEntity(opt, { readable: sub === 'status' || sub === 'key' ? false : true });
  const st = e.state, on = S.sealingOn(st);

  if (sub === 'status') {
    const sealed = e.records.filter(S.isSealed).length, ep = S.currentEpoch(st), s = S.sealingState(st);
    out(`sealing: ${on ? 'on' : 'off'}${on ? '' : ' (records.sealing; a constitutional decision turns it on)'}`);
    out(`records: ${e.records.length} (${sealed} sealed, ${e.records.length - sealed} public)`);
    if (e.unreadable) out(`this copy cannot open ${e.unreadable} of them: it holds no reader's key. Shown up to the first.`);
    out(`readers: ${S.readers(st).join(', ') || 'none yet'} (active members with a record key)`);
    const nokey = Object.keys(st.participants).filter(id => st.participants[id].status === 'active' && !s.keys[id]);
    if (on && nokey.length) out(`without a record key (cannot read yet): ${nokey.join(', ')}`);
    out(`key period: ${ep ? `${ep.n}, for ${ep.members.join(', ')}, since ${ep.at}` : 'none yet'}`);
    if (on && S.rotationNeeded(st)) out('a new key period is needed before anything more is sealed: entity records rotate (a reader\'s node does it when it settles)');
    const waiting = S.waitingReaders(st);
    if (on && ep && waiting.length) out(`waiting to be included in the next key period: ${waiting.join(', ')}`);
    out(`this copy reads as: ${e.me || 'nobody (no member key here)'}`);
    return;
  }
  if (sub === 'key') {
    if (!on) {
      // Without sealing, a record key still receives notices (the notify module).
      if (!e.params.value('entity.modules').includes('notify')) refuse('records are not sealed here (records.sealing is off), and the notify module is not enabled');
      const id = whoAmI(e.state.entity.id, opt), rk = await S.recordKeyFromSeed(loadKey(e.state.entity.id, id, opt.key).seed);
      if (S.sealingState(st).keys[id] === S.cryptoB64(rk.pk)) refuse(`${id} already has this record key`);
      const file = store.writePending(e.dir, await signed(e, 'member.recordkey', { by: id, key: S.cryptoB64(rk.pk) }, opt));
      out(`signed member.recordkey by ${id} → ${file}`);
      if (opt.settle) report(await settlePending(e));
      return;
    }
    const r = await publishRecordKey(e);
    if (!r) refuse(`${e.me || 'you'} already ${e.me && S.sealingState(st).keys[e.me] ? 'has a record key' : 'cannot publish one (an active member, with their key here)'}`);
    out(`signed member.recordkey by ${e.me} → ${r.file}`);
    if (opt.settle) report(await settlePending(e));
    return;
  }
  if (sub === 'password') {
    // Your record key comes from the key file on this machine. Your password
    // makes another signing key; this seals your record secret to it, so
    // signing in with the password opens the records as the key file does.
    if (!on) refuse('records are not sealed here (records.sealing is off)');
    const id = whoAmI(st.entity.id, opt), mine = await S.recordKeyFromSeed(loadKey(st.entity.id, id, opt.key).seed);
    if (S.sealingState(st).keys[id] !== S.cryptoB64(mine.pk)) refuse(`the key here is not ${id}'s record key: run this where ${id}'s key file is (the one that published it)`);
    const { passwordKey, keys } = await import('../../kernel/index.js');
    const pw = process.env.ENTITY_NEW_PASSWORD || await askPassword(`${id}'s password on the page: `);
    const k = await passwordKey(st.entity.id, id, pw);
    if (!st.participants[id].keys.includes(keys.keyId(keys.publicKeyLine(k.publicKey)))) refuse(`that is not ${id}'s password here (set one with: entity password set)`);
    const to = await S.recordKeyFromSeed(k.seed);
    if ((S.sealingState(st).keywraps?.[id] || []).some(w => w.key === S.cryptoB64(to.pk))) { out(`${id}'s password already opens the records`); return; }
    const fields = await S.makeKeywrap({ entity: st.entity.id, member: id, recordSk: mine.sk, toPk: to.pk });
    const file = store.writePending(e.dir, await signed(e, 'member.keywrap', { by: id, ...fields }, { ...opt, password: false }));
    out(`signed member.keywrap by ${id} → ${file}: signing in with the password now opens the records`);
    if (opt.settle) report(await settlePending(e));
    return;
  }
  if (sub === 'rotate') {
    if (!on) refuse('records are not sealed here (records.sealing is off)');
    if (!e.me || !S.readers(st).includes(e.me)) refuse('only a reader opens a key period: publish your record key first (entity records key)');
    const r = await openKeyPeriod(e);
    out(`signed epoch.open ${S.sealingState(st).current + 1} for ${S.readers(st).join(', ')} → ${r.file}`);
    if (opt.settle) report(await settlePending(e));
    return;
  }
  if (sub === 'disclose') {
    const seq = Number(pos[1]);
    const rec = e.records[seq - 1];
    if (!rec || !S.isSealed(rec)) refuse(`record ${pos[1]} is not a sealed record here`);
    const E = await e.ring.epochKey(rec.sealed.epoch);
    if (!E) refuse(`this copy holds no key for key period ${rec.sealed.epoch}`);
    const d = { ...(await S.disclose(rec, { entity: st.entity.id, E })), record: rec, head: { seq: st.head.seq, hash: st.head.hash } };
    const text = JSON.stringify(d, null, 2) + '\n';
    if (opt.out) { fs.writeFileSync(opt.out, text); out(`record ${seq} disclosed to ${opt.out}: it opens that record and no other`); }
    else process.stdout.write(text);
    return;
  }
  refuse(`unknown records command "${sub}": status | key | rotate | disclose <seq> | check <file>`);
}

async function check(file, opt) {
  if (!file || !fs.existsSync(file)) refuse('usage: entity records check <disclosure.json>');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const e = await store.open((await import('../context.js')).entityDir(opt));
  const mine = e.records[d.seq - 1];
  if (!mine) refuse(`this copy has no record ${d.seq}`);
  if (mine.hash !== d.record.hash) refuse(`record ${d.seq} here differs from the one disclosed`);
  const body = await S.checkDisclosure(mine, d);
  out(`record ${d.seq} is in this copy's record and says:`);
  out(JSON.stringify(body, null, 2));
}

function report(r) {
  out(`settled ${r.applied.length} act(s) into ${r.records.length} record(s)${r.refused.length ? `; refused ${r.refused.length}: ${r.refused.map(x => x.reason).join('; ')}` : ''}${r.held.length ? `; ${r.held.length} waiting: ${r.waitingFor.join(', ')}` : ''}`);
}
