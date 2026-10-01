import * as store from '../../kernel/store.js';
import { attest as makeAttestation, makeCheckpoint, cosign, checkpointStatus, prefixRoot, keys } from '../../kernel/index.js';

// Refuse to sign as someone with a key that is not theirs. The signature would
// never count (every copy checks it against the register), but it would sit in
// the file under their name, and it misleads.
function keyFor(e, by, key) {
  const p = e.state.participants[by];
  if (!p) refuse(`${by} is not on the register`);
  if (p.status !== 'active') refuse(`${by} is not an active member`);
  if (!p.keys.includes(keys.keyId(keys.publicKeyLine(key.publicKey)))) refuse(`that key is not one of ${by}'s registered keys; nothing was signed`);
  return key;
}
import { refuse, openEntity, out, loadKey, whoAmI, now } from '../context.js';

export async function attest({ opt }) {
  const e = await openEntity(opt);
  const by = whoAmI(e.state.entity.id, opt);
  const a = await makeAttestation(e.records, { entity: e.state.entity.id, by, at: now() }, keyFor(e, by, loadKey(e.state.entity.id, by, opt.key)));
  store.writeAttestations(e.dir, [a]);
  out(`${by} attests ${a.count} records, root ${a.root.slice(0, 16)}…`);
}

export async function checkpoint({ pos, opt }) {
  const e = await openEntity(opt);
  const sub = pos[0] || 'status';
  const cps = store.readCheckpoints(e.dir);
  const need = e.params.value('record.checkpoint_cosigners');
  if (sub === 'status') {
    if (!cps.length) return out('no checkpoints yet');
    for (const c of cps) {
      const s = await checkpointStatus(c, e.state, need, e.records);
      out(`checkpoint ${c.number} at ${c.count}: ${s.binding ? 'binding' : s.why}; signed by ${s.valid.join(', ') || 'nobody'}${s.consistent === false ? '; CONTRADICTS this record' : ''}`);
      for (const x of s.invalid) out(`  not counted: a signature under ${x.by}'s name (${x.why})`);
    }
    return;
  }
  if (sub === 'tidy') {
    // Drop signatures that do not verify: they never counted, and only mislead.
    let n = 0;
    for (const c of store.readCheckpoints(e.dir)) {
      const s = await checkpointStatus(c, e.state, need, e.records);
      if (!s.invalid.length) continue;
      const keep = [], seen = new Set();
      for (const sig of c.signatures) if (s.valid.includes(sig.by) && !seen.has(sig.by)) {
        const one = await checkpointStatus({ ...c, signatures: [sig] }, e.state, 1, e.records);
        if (one.valid.length) { keep.push(sig); seen.add(sig.by); }
      }
      store.writeCheckpoints(e.dir, [{ ...c, signatures: keep }]);
      n += c.signatures.length - keep.length;
      out(`checkpoint ${c.number}: removed ${c.signatures.length - keep.length} signature(s) that did not verify`);
    }
    if (!n) out('every signature on every checkpoint verifies; nothing to remove');
    return;
  }
  const by = whoAmI(e.state.entity.id, opt);
  const key = keyFor(e, by, loadKey(e.state.entity.id, by, opt.key));
  if (sub === 'make') {
    const prev = cps[cps.length - 1] || null;
    if (prev && prev.count === e.records.length) refuse(`checkpoint ${prev.number} already marks ${prev.count}; co-sign it with \`entity checkpoint sign\``);
    const c = await cosign(makeCheckpoint(e.records, e.state.entity.id, prev), by, key);
    store.writeCheckpoints(e.dir, [c]);
    out(`checkpoint ${c.number} made at ${c.count} and signed by ${by}; ${need - 1} more signature(s) needed for it to bind`);
    return;
  }
  if (sub === 'sign') {
    const n = pos[1] ? Number(pos[1]) : cps[cps.length - 1]?.number;
    const c = cps.find(x => x.number === n) || refuse(`no checkpoint ${n}`);
    if (c.count > e.records.length) refuse(`checkpoint ${n} marks ${c.count} records; this copy holds ${e.records.length}. Sync first.`);
    if (prefixRoot(e.records, c.count) !== c.root) refuse(`checkpoint ${n} contradicts this copy's record; refusing to sign it`);
    // A signature under this name that does not verify (a wrong key, a damaged
    // file) counts for nothing; it gives way to a real one rather than block it.
    const before = await checkpointStatus(c, e.state, need, e.records);
    if (before.valid.includes(by)) refuse(`${by} has already signed checkpoint ${n}`);
    const signedCp = await cosign({ ...c, signatures: c.signatures.filter(x => x.by !== by) }, by, key);
    store.writeCheckpoints(e.dir, [signedCp]);
    const s = await checkpointStatus(signedCp, e.state, need, e.records);
    out(`${by} co-signed checkpoint ${n}; ${s.binding ? 'it is now binding' : s.why}`);
    return;
  }
  refuse(`unknown checkpoint command "${sub}"; use status, make or sign`);
}
