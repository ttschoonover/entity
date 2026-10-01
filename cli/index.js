#!/usr/bin/env node
// entity <command> — five commands cover ordinary life:
//   found, act <kind>, settle, verify, sync
import { parseArgs, Refusal } from './context.js';
import * as f from './commands/found.js';
import * as a from './commands/act.js';
import * as i from './commands/inspect.js';
import * as c from './commands/corroborate.js';
import * as t from './commands/transport.js';
import * as g from './commands/gate.js';
import * as s from './commands/site.js';
import * as d from './commands/dist.js';
import * as r from './commands/radicle.js';
import * as m from './commands/module.js';
import * as fk from './commands/fork.js';
import * as up from './commands/upgrade.js';
import * as fin from './commands/finality.js';

const COMMANDS = {
  found: [f.found, 'bring it into being            [--preset name] [--id p-0001] [--name "…"]'],
  act: [a.act, 'do something, signed           <kind> [--field value …] [--as id] [--out file] [--settle]'],
  settle: [a.settle, 'fold pending acts into the record [--dry]'],
  verify: [i.verify, 'check it, offline, needing nobody [--json]'],
  sync: [t.sync, 'push and pull everywhere at once [--to name] [--settle]'],
  '': null,
  propose: [a.propose, 'lay a proposal, rule chosen for you --title "…" [--effects json] [--changes json]'],
  join: [a.join, 'make a key and sign an application --id <id> [--name "…"]'],
  key: [a.key, 'show or rotate your key          show | rotate'],
  status: [i.status, 'what this copy holds'],
  count: [i.count, 'count the ballots on a proposal  <proposal id> [--json]'],
  params: [i.params, 'every settable value            [key]'],
  participants: [i.participants, 'the register'],
  preset: [f.preset, 'shapes to found from            list | apply <name>'],
  attest: [c.attest, 'sign what you hold'],
  checkpoint: [c.checkpoint, 'signed positions                status | make | sign [n] | tidy'],
  bundle: [t.bundle, 'the record as one file          [--out file] [--from n]'],
  absorb: [t.absorb, 'fold in a bundle or signed act  <file> [--settle]'],
  clone: [t.clone, 'a new copy from any holder      <bundle | url> <dir>'],
  diagnose: [i.diagnose, 'describe damage to the record'],
  repair: [i.repair, 'rechain after concurrent appends [--merge bundle] [--resettle] [--write]'],
  module: [m.module, 'modules, by decision        list | available | source [src] | add <n> | upgrade <n> | enable <n> | disable <n> | fetch'],
  finality: [fin.finality, 'checkpoints that decide          status | sign | evidence <file> | scan <copy>'],
  upgrade: [up.upgrade, 'the core, by decision           check [source] | propose [source] | apply | status'],
  fork: [fk.fork, 'a new entity naming this one as its parent --name "…" --out <dir> --as <id> [--at n] [--carry value,deeds] [--electorate spec]'],
  radicle: [r.radicle, 'publish and replicate on Radicle  init | status'],
  adopt: [r.adopt, 'bring in approved code or law     <git ref> [--decision <id>] [--dry]'],
  gate: [g.gate, 'may these files change?         <paths…> --decision <id> | --against <dir> | digest <paths…>'],
  serve: [s.serve, 'run a node and its page         [--port 7780] [--settle]'],
  build: [s.build, 'the static page                 [--out site]'],
  dist: [d.dist, 'the code as an archive, never the state [--out file]'],
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log('entity <command>\n');
    for (const [k, v] of Object.entries(COMMANDS)) console.log(v ? `  ${k.padEnd(13)} ${v[1]}` : '');
    console.log('\nCommon options: --dir <entity directory>  --as <participant id>  --key <private key file>');
    return;
  }
  const entry = COMMANDS[cmd];
  if (!entry) throw new Refusal(`unknown command "${cmd}"; \`entity help\` lists them`);
  await entry[0](parseArgs(rest));
}

main().catch(e => {
  if (e instanceof Refusal) { console.error(`refused: ${e.message}`); process.exit(2); }
  console.error(e.stack || e.message); process.exit(1);
});
