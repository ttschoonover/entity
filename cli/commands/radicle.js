import fs from 'node:fs';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { keys, gate as runGate, changeDigest, classify } from '../../kernel/index.js';
import { count } from '../../modules/deliberation/count.js';
import { refuse, openEntity, out, keyDir, fullVerify } from '../context.js';
import { radHome, runner, selfNid, participantNids, peerRemotes, ensureCommitIdentity } from '../../transports/radicle.js';

// What git carries for the entity. State that is this copy's alone stays out.
export const GITIGNORE = `# entity: this copy's own files, never replicated
node.json
.staged/
settled/
refused/
site/
.entity/
*.bundle.json
*.tmp-*
record/events.jsonl.before-repair-*
`;

// ── one key for both: a participant's Radicle key can be their entity key ──

export function radicleKeyFile(opt) {
  const f = path.join(radHome({ home: opt.home }), 'keys', 'radicle');
  if (!fs.existsSync(f)) refuse(`no Radicle key at ${f}. Create one with \`rad auth\`, or set RAD_HOME.`);
  try { keys.importPrivateKey(fs.readFileSync(f, 'utf8')); }
  catch (e) {
    refuse(`your Radicle key cannot be read by the entity (${e.message}). A passphrase-protected Radicle key cannot double as an entity key; join without --radicle to use a separate key.`);
  }
  return f;
}

// The entity refers to the Radicle key where it lives; it keeps no copy.
export function linkKey(entityId, id, file) {
  const d = keyDir(entityId);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const f = path.join(d, id);
  if (fs.existsSync(f)) refuse(`a key for ${id} already exists at ${f}`);
  fs.symlinkSync(file, f);
  fs.symlinkSync(`${file}.pub`, `${f}.pub`);
  return `${file} (your Radicle key)`;
}

// ── entity radicle init | status ──

export async function radicle({ pos, opt }) {
  const e = await openEntity(opt);
  const sub = pos[0] || 'status';
  const dest = { home: opt.home };
  const run = runner(e.dir, dest);
  try { run('rad', ['--version']); } catch { refuse('the `rad` command is not installed or not on PATH. See https://radicle.xyz'); }

  if (sub === 'init') {
    if (!fs.existsSync(path.join(e.dir, '.git'))) run('git', ['init', '-q', '-b', 'main']);
    const gi = path.join(e.dir, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, GITIGNORE);
    run('git', ['add', '-A']);
    if (run('git', ['status', '--porcelain']).trim()) run('git', [...ensureCommitIdentity(run), 'commit', '-q', '-m', `${e.params.value('entity.name')}: founded`]);
    let rid;
    try { rid = run('rad', ['.']).trim(); }
    catch {
      const name = (opt.name || e.params.value('entity.name')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entity';
      run('rad', ['init', '--name', name, '--description', `${e.params.value('entity.name')} · ${e.state.entity.id}`,
        '--default-branch', 'main', opt.private ? '--private' : '--public', '--no-confirm'], { timeout: 120000 });
      rid = run('rad', ['.']).trim();
    }
    const node = store.readNode(e.dir);
    node.destinations = node.destinations || [];
    if (!node.destinations.some(d => d.class === 'radicle')) node.destinations.push({ name: 'radicle', class: 'radicle', ...(opt.home ? { home: opt.home } : {}) });
    if (node.settleAfter === undefined) node.settleAfter = 600;
    if (node.publishOnSettle === undefined) node.publishOnSettle = true;
    fs.writeFileSync(store.P(e.dir).node, JSON.stringify(node, null, 2) + '\n');
    out(`${e.params.value('entity.name')} is published on Radicle as ${rid}`);
    out(`Others join with:  entity clone ${rid} <dir>   then   entity join --id <id> --radicle`);
    out(`\`entity sync\` now pushes to your namespace and reads every participant's.`);
    out(`Acts settle once ${node.settleAfter}s old (settleAfter in node.json), giving them time to reach every peer first.`);
    out(`Every settlement is published at once (publishOnSettle in node.json).`);
    return;
  }

  if (sub === 'status') {
    let rid = null;
    try { rid = run('rad', ['.']).trim(); } catch { /* not yet */ }
    const self = selfNid(dest);
    out(`repository   ${rid || 'not published (run `entity radicle init`)'}`);
    out(`this node    ${self || 'no Radicle identity (run `rad auth`)'}`);
    const mine = participantNids(e.dir).find(p => p.nid === self);
    out(`you are      ${mine ? mine.id : 'not a participant under this Radicle identity'}`);
    const remotes = rid ? peerRemotes(run) : {};
    const followed = new Set(Object.values(remotes));
    out('participants on Radicle');
    for (const { id, nid } of participantNids(e.dir)) {
      out(`  ${id.padEnd(12)} ${nid}  ${nid === self ? 'this node' : followed.has(nid) ? 'followed' : 'not yet seen'}`);
    }
    out('Participants whose entity key is not a Radicle key are not listed; they reach the network through a node.');
    return;
  }
  refuse(`unknown radicle command "${sub}"; use init or status`);
}

// ── entity adopt <ref> ──
//
// Brings in a peer's code or law, file by file, only as a carried decision
// approved exactly those bytes. Git's merge never decides what the entity runs.

export async function adopt({ pos, opt }) {
  const e = await openEntity(opt);
  let ref = pos[0] || refuse('which participant or ref? e.g. `entity adopt p-0002`');
  const run = runner(e.dir, { home: opt.home });
  // A participant id names their branch, wherever their remote is.
  if (e.state.participants[ref]) {
    const nids = e.state.participants[ref].keys.map(k => keys.nodeId(k));
    const remote = Object.entries(peerRemotes(run)).find(([, nid]) => nids.includes(nid));
    if (!remote) refuse(`${ref} has no Radicle branch here yet. Run \`entity sync\` first.`);
    ref = `${remote[0]}/${opt.branch || 'main'}`;
  }
  try { run('git', ['rev-parse', '--verify', `${ref}^{commit}`]); } catch { refuse(`no such git ref "${ref}". Run \`entity sync\` to fetch peers.`); }
  const changed = run('git', ['diff', '--name-only', ref, '--', '.']).split('\n').filter(Boolean)
    .filter(p => classify(p).need !== null && p !== 'parameters.yml' && p !== '.gitignore');
  if (!changed.length) { out(`nothing governed differs from ${ref}`); return; }
  const at = (p) => { try { return run('git', ['show', `${ref}:${p}`], { buffer: true }); } catch { return null; } };
  const contents = changed.map(p => ({ path: p, content: at(p) }));
  const digest = changeDigest(contents);

  const v = await fullVerify(e);
  if (!v.ok) refuse(`this copy's record does not verify (${v.problems[0]?.problem}); nothing can be adopted on its authority`);
  const decision = opt.decision || Object.values(v.state.proposals).find(p => p.approved && p.digest === digest)?.id;
  const r = runGate(changed, { decision, state: v.state, count, digest });
  for (const c of contents) out(`  ${(classify(c.path).need || '').padEnd(15)} ${c.content === null ? 'delete ' : 'write  '} ${c.path}`);
  out(`digest ${digest}`);
  if (!r.ok) {
    out(`REFUSED: ${r.why.replace(/^refused: /, '')}`);
    if (!decision) out(`To propose exactly this change:\n  entity act proposal.lay --title "…" --rule ${r.need} --paths '${JSON.stringify(changed)}' --digest ${digest}`);
    process.exitCode = 1; return;
  }
  if (opt.dry) { out(`PERMITTED (dry run): ${r.why}`); return; }
  for (const c of contents) {
    const f = path.join(e.dir, c.path);
    if (c.content === null) fs.rmSync(f, { force: true });
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c.content); }
  }
  out(`ADOPTED: ${r.why}. Approved by ${r.approvers.join(', ')}. \`entity sync\` publishes it.`);
}
