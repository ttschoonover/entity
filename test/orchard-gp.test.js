// make-orchard-gp.sh, end to end: The Orchard General Partnership founded
// sealed, with its agreement, officers and settings; a second partner applies,
// signs the agreement with a drawn signature (sealed in transit) and is admitted by joint resolution;
// a trade proposal alerts the partners; a reminder goes out before it closes;
// and nothing private is on disk in the clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, tmp } from './helpers.js';

const EIN = '98-7654321';
// A 1×1 PNG stands in for a drawn signature.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('orchard gp: founded sealed with its agreement and EIN; a partner admitted; trades alerted; reminded before close', { timeout: 240000 }, async () => {
  const home = tmp('orchard-home-'), keys = tmp('orchard-keys-'), outbox = tmp('orchard-mail-');
  const env = { ...process.env, ENTITIES: home, SRC: ROOT, ENTITY_KEYS: keys, ENTITY_NEW_PASSWORD: 'correct horse battery staple', YOUR_NAME: 'Founding Partner', ORCHARD_EIN: EIN, NO_RADICLE: '1', HOME: home };
  const outp = execFileSync('bash', [path.join(ROOT, 'make-orchard-gp.sh'), 'tim', 'orchard-gp', '7799'], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.match(outp, /The EIN and principal office \(sealed\)\s+closed early: CARRIED, enacted/);
  assert.match(outp, /every partner signs it with a drawn signature/);
  const dir = path.join(home, 'orchard-gp');
  const cli = (args, extra = {}) => execFileSync(process.execPath, [path.join(dir, 'cli', 'index.js'), ...args], { cwd: dir, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

  // Private: the EIN and the agreement are nowhere in the clear on disk.
  const disk = fs.readFileSync(path.join(dir, 'record', 'events.jsonl'), 'utf8');
  assert.ok(!disk.includes(EIN) && !disk.includes('Uniform Partnership Act'), 'sealed');
  const params = cli(['params', '--as', 'tim']);
  for (const [k, v] of [['partnership.ein', EIN], ['fund.trade_rule', 'joint'], ['membership.removal_rule', 'joint'], ['records.sealing', 'true'], ['fund.max_members', '99'], ['notify.events', 'trades']]) assert.match(params, new RegExp(`${k.replace('.', '\\.')}\\s+.*${v}`), k);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8')).private, true);
  assert.match(cli(['participants', '--as', 'tim']), /tim\s+active/);

  // Notices by email (content-free): the founder subscribes to trades and reminders.
  const node = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8'));
  node.notify = { ...(node.notify || {}), mail: `cat >> "${outbox}/$NOTIFY_TO"` };
  fs.writeFileSync(path.join(dir, 'node.json'), JSON.stringify(node, null, 2));
  cli(['notify', 'subscribe', '--email', 'tim@example.org', '--as', 'tim']);

  // A second partner applies; signs the agreement, sealed to the applicants' key; is admitted.
  cli(['join', '--id', 'ana', '--name', 'Ana']);
  cli(['settle', '--as', 'tim']);
  const signed = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; process.chdir(${JSON.stringify(dir)});
    const { openEntity, loadKey } = await import(${JSON.stringify(path.join(dir, 'cli/context.js'))});
    const { fingerprint } = await import(${JSON.stringify(path.join(dir, 'modules/agreements/index.js'))});
    const K = await import(${JSON.stringify(path.join(dir, 'kernel/index.js'))});
    const store = await import(${JSON.stringify(path.join(dir, 'kernel/store.js'))});
    const PNG = ${JSON.stringify(PNG)};
    const e = await openEntity({ dir: ${JSON.stringify(dir)}, as: 'tim' });
    const p = e.state.m.wiki.pages['partnership-agreement'], v = p.versions[p.statute.version - 1];
    const act = await K.signAct(e.registry, K.draft('agreement.sign', { entity: e.state.entity.id, by: 'ana', at: new Date().toISOString(), page: 'partnership-agreement', version: v.n, text: fingerprint('partnership-agreement', v), drawing: PNG }), loadKey(e.state.entity.id, 'ana'));
    const box = await K.sealing.sealActTo(K.sealing.latestPeriod(e.records), act);
    console.log(store.writePending(e.dir, box));`], { env, cwd: dir }).toString();
  assert.match(signed, /pending/);
  cli(['settle', '--as', 'tim']);
  const admit = cli(['propose', '--title', 'Admit Ana', '--effects', '[{"kind":"participant.admit","id":"ana"}]', '--as', 'tim']);
  const aid = admit.match(/d-[0-9a-f]{12}/)[0];
  cli(['settle', '--as', 'tim']);
  cli(['act', 'ballot.cast', '--proposal', aid, '--choice', 'for', '--as', 'tim', '--settle']);
  assert.match(cli(['participants', '--as', 'tim']), /ana\s+active/, 'admitted by joint resolution');
  cli(['records', 'key', '--as', 'ana']);   // from her own copy, which cannot read yet
  cli(['settle', '--as', 'tim']);           // ana is a reader now: a new key period
  assert.match(cli(['records', 'status', '--as', 'tim']), /key period: \d+, for ana, tim|key period: \d+, for tim, ana/);

  // A trade proposal: the founder is alerted (content-free email, sealed inbox).
  const lay = cli(['propose', '--title', 'Buy an index fund', '--effects', '[{"kind":"fund.authorize","id":"vti-1","side":"buy","symbol":"VTI","quantity":2,"days":7}]', '--as', 'ana']);
  const tid = lay.match(/d-[0-9a-f]{12}/)[0];
  cli(['settle', '--as', 'tim']);
  cli(['notify', 'send']);
  const mail = fs.readFileSync(path.join(outbox, 'tim@example.org'), 'utf8');
  assert.match(mail, /something new for you in your group/);
  assert.ok(!mail.includes('VTI'), 'the email says nothing of the trade');
  assert.match(cli(['notify', 'inbox', '--as', 'tim']), /Trade to vote on: buy up to 2 VTI at market/);

  // A reminder, as if a day before it closes (the node checks every five minutes).
  const notify = await import(path.join(dir, 'cli/notify.js'));
  const { openEntity } = await import(path.join(dir, 'cli/context.js'));
  process.env.ENTITY_KEYS = keys;
  const e = await openEntity({ dir, as: 'tim' });
  const deadline = Date.parse(e.state.proposals[tid].deadline);
  assert.equal((await notify.remind(e, { now: deadline - 3 * 3600000 })).queued, 1, 'tim has not voted: reminded');
  assert.equal((await notify.remind(e, { now: deadline - 2 * 3600000 })).queued, 0, 'once only');
  assert.match(cli(['notify', 'inbox', '--as', 'tim']), /Vote closes in 3 h: Buy an index fund/);
});
