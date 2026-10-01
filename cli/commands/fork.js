// entity fork · collective exit: a new entity that names its parent.
//
// The fork starts from the parent's record at a point (the head by default):
// its parameters and modules as they stood, and, if the forkers choose,
// module state such as balances or deeds (--carry). Members are not carried
// over. Each joins the fork by signing in it; the parent's members keep their
// ids, claimable only with a key they held in the parent. Their signatures in
// the parent cannot be replayed here: every act names its entity.
//
// The parent's records up to the fork point are kept in parent/events.jsonl,
// so anyone holding the fork can check where it came from (`entity verify`).

import fs from 'node:fs';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { keys, draft, signAct, randomHex, loadDocument, foldRecords, prefixRoot, serialiseAll, forkMembers, emptyState, settle } from '../../kernel/index.js';
import { refuse, openEntity, entityDir, out, now, loadKey, saveKey, keyDir } from '../context.js';
import { copyCode } from './dist.js';
import { fetchSource, install, moduleStatus } from '../modules.js';

export async function fork({ opt }) {
  const e = await openEntity(opt);
  const parentId = e.state.entity.id;
  const name = opt.name || refuse('give the fork a --name');
  const to = path.resolve(opt.out || refuse('say where the fork goes: --out <new directory>'));
  if (fs.existsSync(to) && fs.readdirSync(to).length) refuse(`${to} is not empty`);
  const count = opt.at ? Number(opt.at) : e.records.length;
  if (!Number.isInteger(count) || count < 1 || count > e.records.length) refuse(`--at is a record number from 1 to ${e.records.length}`);

  const slice = e.records.slice(0, count);
  const ps = foldRecords(e.registry, slice);
  const members = forkMembers(ps);
  const by = opt.as || opt.id || refuse('say who founds the fork: --as <your id in the parent>, or --id <a new id>');
  let key;
  if (members[by]) {
    key = loadKey(parentId, by, opt.key);
    if (!members[by].includes(keys.keyId(keys.publicKeyLine(key.publicKey)))) refuse(`the key for ${by} is not one ${by} held in the parent at record ${count}`);
  } else {
    if (e.state.participants[by]) refuse(`${by} was not a member of the parent at record ${count}; choose a new --id`);
    key = (await keys.generate()).privateKey;
  }

  // Parameters as they stood, under the new name and any electorate chosen.
  const doc = structuredClone(ps.doc);
  doc.parameters['entity.name'].value = name;
  if (opt.electorate) (doc.parameters['decision.electorate'] ||= {}).value = String(opt.electorate);
  const source = store.parametersText({ ...ps, doc });
  const document = loadDocument(source);
  const enabled = document.parameters['entity.modules'].value;

  const carry = {};
  for (const m of String(opt.carry || '').split(',').map(x => x.trim()).filter(Boolean)) {
    if (!enabled.includes(m)) refuse(`--carry ${m}: the ${m} module is not enabled in the parent at record ${count}`);
    carry[m] = structuredClone(ps.m[m] ?? {});
  }

  // Code: the parent's, with each module at the digest the record held then.
  fs.mkdirSync(to, { recursive: true });
  copyCode(e.dir, to);
  const installList = Object.entries(ps.modules).map(([n, m]) => ({ name: n, source: m.source, digest: m.digest }));
  for (const m of installList) {
    if (moduleStatus(to, m.name, m.digest) === 'ok') continue;
    try { fetchSource(to, m.source, m.name); install(to, m.name, m.digest); }
    catch (x) { refuse(`module ${m.name} at ${m.digest.slice(0, 12)}…: ${x.message}`); }
  }
  fs.mkdirSync(path.join(to, 'parent'), { recursive: true });
  fs.writeFileSync(path.join(to, 'parent', 'events.jsonl'), serialiseAll(slice));

  const entity = opt.entity || `e-${randomHex(8)}`;
  const registry = await store.registryFor(to);
  const act = await signAct(registry, draft('entity.found', {
    entity, by, at: now(), key: keys.publicKeyLine(key.publicKey), document, source,
    ...(installList.length ? { install: installList } : {}),
    parent: { entity: parentId, name: e.params.value('entity.name'), count, head: slice[count - 1].hash, root: prefixRoot(slice, count), members },
    ...(Object.keys(carry).length ? { carry } : {}),
  }), key);
  const r = await settle(registry, emptyState(), [act]);
  if (r.refused.length) { fs.rmSync(to, { recursive: true, force: true }); refuse(`the fork could not be founded: ${r.refused[0].reason}`); }
  store.appendRecords(to, r.records);
  store.writeDerived(to, r.state);
  fs.writeFileSync(path.join(to, 'node.json'), JSON.stringify({ port: 7780, destinations: [], classes: {} }, null, 2) + '\n');
  const kd = keyDir(entity);
  if (!fs.existsSync(path.join(kd, by))) saveKey(entity, by, key);

  out(`Forked ${e.params.value('entity.name')} (${parentId}) at record ${count} into ${name} (${entity}), in ${to}.`);
  out(`  founder     ${by}${members[by] ? ', with the key they held in the parent' : ', a new member with a new key'}`);
  out(`  carried     ${Object.keys(carry).length ? Object.keys(carry).join(', ') : 'no module state'}`);
  out(`  reserved    ${Object.keys(members).length} id(s) of the parent's members, claimable with their parent keys (\`entity join --id ID\` finds them)`);
  out(`  evidence    parent/events.jsonl: the parent's ${count} records; \`entity verify\` checks the fork against them`);
}
