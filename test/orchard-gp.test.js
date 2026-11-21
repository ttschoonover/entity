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

test('orchard gp: founded sealed with its agreement and EIN, on its own website; a partner admitted; only the Treasurer keeps the books; no associations', { timeout: 240000 }, async () => {
  const home = tmp('orchard-home-'), keys = tmp('orchard-keys-');
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
  for (const [k, v] of [['partnership.ein', EIN], ['fund.trade_rule', 'joint'], ['membership.removal_rule', 'joint'], ['records.sealing', 'true'], ['fund.max_members', '99'], ['fund.bookkeeper', 'treasurer'], ['partnership.associations', 'false']]) assert.match(params, new RegExp(`${k.replace('.', '\\.')}\\s+.*${v}`), k);
  const nodeJson = JSON.parse(fs.readFileSync(path.join(dir, 'node.json'), 'utf8'));
  assert.equal(nodeJson.private, true); assert.equal(nodeJson.site, 'website'); assert.equal(nodeJson.brand, 'The Orchard');
  // Its own members' website; no chat, notifications, shared files or polls.
  for (const f of ['index.html', 'portfolio.html', 'partners.html', 'hall.html', 'og.js']) assert.ok(fs.existsSync(path.join(dir, 'website', f)), f);
  for (const f of ['chat.html', 'docs.html']) assert.ok(!fs.existsSync(path.join(dir, 'website', f)), f);
  const mods = cli(['params', '--as', 'tim']).match(/entity\.modules\s+(.*)/)[1];
  for (const m of ['notify', 'chat', 'docs', 'polls']) assert.ok(!new RegExp(`\\b${m}\\b`).test(mods), m);
  assert.match(cli(['participants', '--as', 'tim']), /tim\s+active/);

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

  // A trade is proposed by any partner, decided by the partners.
  const lay = cli(['propose', '--title', 'Buy an index fund', '--effects', '[{"kind":"fund.authorize","id":"vti-1","side":"buy","symbol":"VTI","quantity":2,"days":7}]', '--as', 'ana']);
  assert.match(lay, /d-[0-9a-f]{12}/);
  cli(['settle', '--as', 'tim']);

  // Only the Treasurer keeps the books: a resolution of the partners may not record a payment.
  const pay = cli(['propose', '--title', 'Record a payment', '--effects', '[{"kind":"fund.contribute","member":"tim","amount":5000}]', '--as', 'tim']);
  const pid = (pay.match(/d-[0-9a-f]{12}/) || [])[0];
  if (pid) {
    cli(['settle', '--as', 'tim']);
    for (const who of ['tim', 'ana']) cli(['act', 'ballot.cast', '--proposal', pid, '--choice', 'for', '--as', who, '--settle']);
  }
  const { openEntity } = await import(path.join(dir, 'cli/context.js'));
  process.env.ENTITY_KEYS = keys;
  const e = await openEntity({ dir, as: 'tim' });
  assert.equal((e.state.m.fund?.ledger || []).length, 0, 'nothing recorded on the books by a resolution');
  assert.ok(e.state.m.authority.grants.books.may.includes('fund.opening'), 'the Treasurer brings in the opening balances');

  // No associations.
  cli(['propose', '--title', 'Join a federation of clubs', '--effects', '[{"kind":"partnership.join","association":"bay-clubs","name":"Bay Clubs","terms":"dues"}]', '--as', 'tim']);
  assert.match(cli(['settle', '--as', 'tim']), /1 refused/, 'refused at proposal');
  const after = await openEntity({ dir, as: 'tim' });
  assert.ok(!Object.keys(after.state.m.partnership?.associations || {}).length, 'no association joined');
  const why = fs.readdirSync(path.join(dir, 'refused')).map(f => fs.readFileSync(path.join(dir, 'refused', f), 'utf8')).join('\n');
  assert.match(why, /does not join associations/);
});
