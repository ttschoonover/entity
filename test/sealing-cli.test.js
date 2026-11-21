// Sealed records through the command line and between copies: a sealed
// republic founded, joined and left; acts travelling sealed in bundles, in
// git's pending/ and to a node; and what an outsider's copy can do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT, tmp } from './helpers.js';

const PRESET = '_: A sealed assembly, for testing.\n\nmodules: [page, deliberation, titles, vocabulary]\n\nset:\n  entity.name: The Sealed Assembly\n  records.sealing: true\n';
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

async function sealedCopy() {
  const dir = tmp('sealed-');
  const { copyCode } = await import('../cli/commands/dist.js');
  copyCode(ROOT, dir);
  for (const d of ['library']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'presets', 'sealed.yml'), PRESET);
  const env = { ...process.env, ENTITY_KEYS: tmp('sealed-keys-') };
  const cli = (args, d = dir, extra = {}) => execFileSync(process.execPath, [path.join(d, 'cli', 'index.js'), ...args], { cwd: d, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  cli(['found', '--id', 'p-0001', '--preset', 'sealed']);
  cli(['join', '--id', 'p-0002', '--name', 'Second Person']);
  cli(['settle', '--as', 'p-0001']);
  cli(['records', 'key', '--as', 'p-0002']);
  cli(['settle', '--as', 'p-0001']);
  return { dir, env, cli };
}
const recordText = (d) => fs.readFileSync(path.join(d, 'record', 'events.jsonl'), 'utf8');

test('sealed cli: founded, joined, included with grants; nothing in the clear on disk', async () => {
  const { dir, cli } = await sealedCopy();
  assert.match(cli(['records', 'status', '--as', 'p-0001']), /key period: 2, for p-0001, p-0002/);
  assert.match(cli(['participants', '--as', 'p-0002']), /p-0002\s+active/, 'the newcomer reads it all');
  assert.ok(!recordText(dir).includes('Second Person'));
  assert.match(cli(['verify', '--as', 'p-0002']), /reproduced byte for byte/);
  // An outsider: the chain only, and a clear refusal to read.
  assert.match(cli(['verify'], dir, { ENTITY_KEYS: tmp('none-') }), /chain: whole .* sealed/);
  assert.throws(() => cli(['participants'], dir, { ENTITY_KEYS: tmp('none-') }), /sealed record\(s\) it cannot open/);
  // The register and parameters stay off git once the record is sealed.
  execFileSync('git', ['init', '-q'], { cwd: dir });
  cli(['settle', '--as', 'p-0001']);  // writeDerived marks them
  const excl = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.match(excl, /\/participants\/\n\/parameters\.yml/);
});

test('sealed cli: an act travels sealed in a bundle from one copy and settles in another', async () => {
  const { dir, env, cli } = await sealedCopy();
  const other = tmp('sealed-b-');
  fs.cpSync(dir, other, { recursive: true });
  cli(['propose', '--title', 'A secret proposal', '--changes', '{"entity.name":"Renamed in secret"}', '--as', 'p-0002'], other);
  const out = path.join(os.tmpdir(), `bundle-${process.pid}.json`);
  cli(['bundle', '--out', out, '--as', 'p-0002'], other);
  const b = fs.readFileSync(out, 'utf8');
  assert.ok(!b.includes('Renamed in secret') && !b.includes('A secret proposal'), 'the bundle carries the act sealed');
  assert.match(b, /"sealedAct"/);
  cli(['absorb', out, '--as', 'p-0001']);
  const s = cli(['settle', '--as', 'p-0001']);
  assert.match(s, /1 settled/);
  assert.ok(!recordText(dir).includes('Renamed in secret'));
  const shown = execFileSync(process.execPath, ['-e', `
    const { openEntity } = await import(${JSON.stringify(path.join(dir, 'cli', 'context.js'))});
    const e = await openEntity({ dir: ${JSON.stringify(dir)}, as: 'p-0001' });
    console.log(Object.values(e.state.proposals).map(p => p.title).join('|'));`], { env, input: '', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  assert.match(shown, /A secret proposal/, 'and a member reads it once settled');
});

test('sealed cli: pending/ is sealed before git carries it, and still settles', async () => {
  const { dir, cli } = await sealedCopy();
  cli(['propose', '--title', 'Pending in git', '--changes', '{"entity.name":"Not for seeds"}', '--as', 'p-0001']);
  const { sealPendingFiles } = await import(path.join(dir, 'transports', 'radicle.js'));
  assert.equal(await sealPendingFiles(dir), 1);
  const files = fs.readdirSync(path.join(dir, 'pending'));
  const text = files.map(f => fs.readFileSync(path.join(dir, 'pending', f), 'utf8')).join('');
  assert.ok(!text.includes('Not for seeds') && text.includes('sealedAct'));
  assert.match(cli(['settle', '--as', 'p-0001']), /1 settled/, 'a reader opens it and settles');
});

test('sealed cli: a node takes a sealed act, opens it with its member key, and settles it', async () => {
  const { dir, env, cli } = await sealedCopy();
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--settle', '--port', String(port), '--as', 'p-0001'], { cwd: dir, env });
  try {
    await new Promise((ok) => { proc.stdout.on('data', (d) => { if (String(d).includes('served')) ok(); }); setTimeout(ok, 4000); });
    const box = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const { openEntity, signed } = await import(${JSON.stringify(path.join(dir, 'cli', 'context.js'))});
      const { sealing } = await import(${JSON.stringify(path.join(dir, 'kernel', 'index.js'))});
      const e = await openEntity({ dir: ${JSON.stringify(dir)}, as: 'p-0002' });
      const a = await signed(e, 'proposal.lay', { title: 'Over the wire, sealed', rule: 'constitutional', changes: { 'entity.name': 'Wire' } }, { as: 'p-0002' });
      console.log(JSON.stringify(await sealing.sealAct(e.state, a)));`], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    assert.ok(!box.includes('Over the wire'));
    const r = await (await fetch(`http://127.0.0.1:${port}/acts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: box })).json();
    assert.equal(r.refused.length, 0, JSON.stringify(r.refused));
    assert.equal(r.settled, true);
    assert.ok(!recordText(dir).includes('Over the wire'));
    assert.match(cli(['verify', '--as', 'p-0001']), /reproduced byte for byte/);
  } finally { proc.kill(); }
});

test('sealed cli: a zero-knowledge node stores and relays what it cannot read; a member settles it', async () => {
  const { dir, env, cli } = await sealedCopy();
  const port = await freePort();
  const noKeys = { ...env, ENTITY_KEYS: tmp('no-keys-') };
  const proc = spawn(process.execPath, [path.join(dir, 'cli', 'index.js'), 'serve', '--settle', '--port', String(port)], { cwd: dir, env: noKeys });
  let said = '';
  try {
    await new Promise((ok) => { proc.stdout.on('data', (d) => { said += d; if (String(d).includes('served')) ok(); }); setTimeout(ok, 4000); });
    assert.match(said, /zero-knowledge/);
    const box = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const { openEntity, signed } = await import(${JSON.stringify(path.join(dir, 'cli', 'context.js'))});
      const { sealing } = await import(${JSON.stringify(path.join(dir, 'kernel', 'index.js'))});
      const e = await openEntity({ dir: ${JSON.stringify(dir)}, as: 'p-0002' });
      const a = await signed(e, 'proposal.lay', { title: 'Through a node that cannot read', rule: 'constitutional', changes: { 'entity.name': 'Relay' } }, { as: 'p-0002' });
      console.log(JSON.stringify(await sealing.sealAct(e.state, a)));`], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    const r = await (await fetch(`http://127.0.0.1:${port}/acts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: box })).json();
    assert.equal(r.refused.length, 0); assert.equal(r.settled, false, 'it stores; it does not settle');
    assert.match(r.accepted[0], /^sealed:/);
    const bundle = await (await fetch(`http://127.0.0.1:${port}/bundle`)).text();
    assert.ok(!bundle.includes('Through a node') && bundle.includes('sealedAct'), 'it relays the act sealed');
  } finally { proc.kill(); }
  assert.match(cli(['settle', '--as', 'p-0001']), /1 settled/, 'a member\'s copy opens and settles it');
  assert.ok(!recordText(dir).includes('Through a node'));
});

test('sealed cli: fork --sealed makes a private republic from a public one', async () => {
  const dir = tmp('pub-');
  const { copyCode } = await import('../cli/commands/dist.js');
  copyCode(ROOT, dir); fs.cpSync(path.join(ROOT, 'library'), path.join(dir, 'library'), { recursive: true });
  const env = { ...process.env, ENTITY_KEYS: tmp('pub-keys-') };
  const cli = (args, d = dir) => execFileSync(process.execPath, [path.join(d, 'cli', 'index.js'), ...args], { cwd: d, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  cli(['preset', 'apply', 'assembly']); cli(['found', '--id', 'p-0001']);
  const to = path.join(tmp('fork-'), 'f');
  cli(['fork', '--name', 'The Private Fork', '--out', to, '--as', 'p-0001', '--sealed']);
  cli(['settle', '--as', 'p-0001'], to);
  const st = cli(['records', 'status', '--as', 'p-0001'], to);
  assert.match(st, /sealing: on/); assert.match(st, /key period: 1, for p-0001/);
});
