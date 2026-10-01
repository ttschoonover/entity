import fs from 'node:fs';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { refuse, openEntity, out, signed, entityDir, bringModules } from '../context.js';
import { fetchSource, describeModule, moduleDigest, recordedModules, moduleStatus, ensureModules, replaysWith, STAGED, pin, packSource, available } from '../modules.js';
import { sourceFor } from './found.js';

// entity module list | available | source [SOURCE] | add SOURCE-or-NAME | upgrade NAME | fetch | enable NAME | disable NAME
export async function module({ pos, opt }) {
  const sub = pos[0] || 'list';
  const dir = entityDir(opt);

  // Where modules are published: library.yml's "from" line.
  if (sub === 'source') {
    const f = path.join(dir, 'library.yml');
    if (!pos[1]) {
      const from = packSource(dir);
      out(from ? `modules come from ${from}` : 'no module source is set: modules come from a pack on this computer. Set one: `entity module source github:YOU/entity-modules@main`');
      return;
    }
    const src = pos[1];
    if (!/^(github|git):/.test(src)) refuse('a module source is github:OWNER/REPO[/SUBDIR]@BRANCH-OR-COMMIT or git:URL[#SUBDIR]@REF');
    let text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 'modules: {}\n';
    text = /^from:.*$/m.test(text) ? text.replace(/^from:.*$/m, `from: ${src}`) : `# Where modules are published. \`entity module add NAME\` fetches NAME from here,\n# pinned to the commit the branch points at, unless "modules" below names another source.\nfrom: ${src}\n\n${text}`;
    fs.writeFileSync(f, text);
    out(`modules now come from ${src}. See what it offers: \`entity module available\``);
    return;
  }

  // What the published pack offers, before anything is installed.
  if (sub === 'available') {
    const from = pos[1] || packSource(dir) || refuse('no module source is set: `entity module source github:YOU/entity-modules@main`');
    let list;
    try { list = await available(dir, from); } catch (x) { refuse(x.message); }
    const installed = new Set(store.installedModules(dir));
    out(`${from} (${pin(from).split('@').pop().slice(0, 12)}):`);
    for (const m of list) out(`  ${m.name.padEnd(12)} ${installed.has(m.name) ? 'installed ' : '          '} ${m.about}${m.core ? `  [core ${m.core}+]` : ''}`);
    out('Install one by decision: `entity module add NAME --as ID`.');
    return;
  }

  // fetch works from the raw record, so it can repair a copy that cannot fold.
  if (sub === 'fetch') {
    const records = store.read(dir).records;
    const r = ensureModules(dir, records);
    for (const n of r.installed) out(`installed ${n}: its code matches the digest the record approved`);
    for (const f of r.failed) out(`FAILED ${f.name}: ${f.why}`);
    if (!r.installed.length && !r.failed.length) out('every module the record relies on is here, with matching code');
    if (r.failed.length) process.exitCode = 1;
    return;
  }

  const e = await openEntity(opt);
  const enabled = e.params.value('entity.modules');
  const recorded = recordedModules(e.records);

  if (sub === 'list') {
    const names = [...new Set(['deliberation', ...enabled, ...Object.keys(recorded), ...store.installedModules(dir)])].sort();
    for (const n of names) {
      const r = recorded[n];
      const status = n === 'deliberation' ? 'core' : r ? moduleStatus(dir, n, r.digest) : fs.existsSync(path.join(dir, 'modules', n)) ? 'present, never approved' : '-';
      out(`${n.padEnd(14)} ${(enabled.includes(n) ? 'enabled' : 'off').padEnd(8)} ${status.padEnd(24)} ${r ? `${r.source}  ${r.digest.slice(0, 12)}…` : ''}`);
    }
    return;
  }

  if (sub === 'add') {
    const what = pos[1] || refuse('which module? a name from library.yml, or a source such as github:OWNER/REPO/SUBDIR@COMMIT');
    let source;
    try { source = /[:]/.test(what) ? pin(what) : sourceFor(dir, what); } catch (x) { refuse(x.message); }
    const guess = /[:]/.test(what) ? (opt.name || what.replace(/@.*$/, '').split(/[/:#]/).pop()) : what;
    let staged;
    try { staged = fetchSource(dir, source, guess); } catch (x) { refuse(x.message); }
    let d;
    try { d = await describeModule(staged); } catch (x) { refuse(`not a usable module: ${x.message}`); }
    if (d.name !== guess) { fs.renameSync(staged, path.join(dir, STAGED, d.name)); staged = path.join(dir, STAGED, d.name); }
    if (d.name === 'deliberation') refuse('deliberation is part of the core');
    if (recorded[d.name]) refuse(`${d.name} is already installed; use \`entity module enable ${d.name}\``);
    const digest = moduleDigest(staged, d.name);
    const rule = e.params.rule('entity.modules').name;
    out(`fetched ${d.name} from ${source}`);
    out(`  ${d.files.length} file(s), for review in ${path.relative(dir, staged)}/:`);
    for (const f of d.files) out(`    ${f}`);
    out(`  digest ${digest}`);
    const a = await signed(e, 'proposal.lay', {
      title: `Install and enable the ${d.name} module`, rule,
      text: `Installs ${d.name} from ${source}, exactly the code with digest ${digest}.`,
      changes: { 'entity.modules': [...enabled, d.name] },
      install: [{ name: d.name, source, digest }],
    }, opt);
    store.writePending(dir, a);
    const { default: delib } = await import('../../modules/deliberation/index.js');
    out(`proposal to install it signed (${rule} rule); its ${Object.keys(d.parameters).length} setting(s) start at the defaults in its code`);
    out(`proposal id ${delib.proposalId(a)}`);
    out('Review the code before voting. If it carries, every copy fetches it, checks the digest, and installs it.');
    return;
  }

  if (sub === 'upgrade') {
    const name = pos[1] || refuse('which module? `entity module upgrade NAME [SOURCE]`');
    if (name === 'deliberation') refuse('deliberation is part of the core; it changes with the kernel, by `entity adopt`');
    const was = recorded[name] || refuse(`${name} was never installed here; use \`entity module add ${name}\``);
    let source;
    try { source = pos[2] || opt.source ? pin(pos[2] || opt.source) : sourceFor(dir, name); } catch (x) { refuse(x.message); }
    let staged, d;
    try { staged = fetchSource(dir, source, name); d = await describeModule(staged); } catch (x) { refuse(x.message); }
    if (d.name !== name) refuse(`${source} holds the module "${d.name}", not "${name}"`);
    const digest = moduleDigest(staged, name);
    if (digest === was.digest) refuse(`${source} holds exactly the code already installed (${digest.slice(0, 12)}…)`);
    out(`fetched ${name} from ${source}: ${d.files.length} file(s) in ${path.relative(dir, staged)}/, digest ${digest}`);
    out(`  replacing ${was.digest.slice(0, 12)}… from ${was.source}`);
    const check = await replaysWith(dir, name, staged, e.records);
    if (!check.ok) refuse(`the new code does not reproduce this entity's record (record ${check.problem?.seq}: ${check.problem?.problem}). An upgrade must replay the history it inherits; this one would rewrite it.`);
    out(`  the whole record (${e.records.length} records) replays byte for byte with the new code`);
    const rule = e.params.rule('entity.modules').name;
    const a = await signed(e, 'proposal.lay', {
      title: `Upgrade the ${name} module`, rule,
      text: `Replaces the ${name} code ${was.digest} with ${digest}, from ${source}. The record so far replays exactly with it.`,
      install: [{ name, source, digest }],
    }, opt);
    store.writePending(dir, a);
    const { default: delib } = await import('../../modules/deliberation/index.js');
    out(`proposal to upgrade it signed (${rule} rule), id ${delib.proposalId(a)}`);
    out('Read the difference before voting: `diff -r modules/' + name + ' ' + path.relative(dir, staged) + '`.');
    return;
  }

  if (sub !== 'enable' && sub !== 'disable') refuse(`unknown module command "${sub}"; use list, add, upgrade, fetch, enable or disable`);
  const name = pos[1] || refuse('which module?');
  if (name === 'deliberation') refuse('deliberation is always on');
  if (!recorded[name] && !enabled.includes(name)) refuse(`${name} was never installed here; use \`entity module add ${name}\``);
  if (sub === 'enable' && enabled.includes(name)) refuse(`${name} is already enabled`);
  if (sub === 'disable' && !enabled.includes(name)) refuse(`${name} is not enabled`);
  const next = sub === 'enable' ? [...enabled, name] : enabled.filter(m => m !== name);
  const rule = e.params.rule('entity.modules').name;
  const a = await signed(e, 'proposal.lay', { title: `${sub === 'enable' ? 'Enable' : 'Disable'} the ${name} module`, rule, changes: { 'entity.modules': next } }, opt);
  store.writePending(dir, a);
  const { default: delib } = await import('../../modules/deliberation/index.js');
  out(`proposal to ${sub} ${name} signed (${rule} rule)`);
  out(`proposal id ${delib.proposalId(a)}`);
  if (sub === 'disable') out('Its code stays: the record may still need it to be replayed.');
}
