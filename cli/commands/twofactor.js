// entity twofactor — the node's side of email two-factor (the twofactor module).
//
//   entity twofactor status                      the rule, the mail setup, who uses it
//   entity twofactor mail --host H [--port 465] --user U --from "Name <a@b>"
//                                                 how this node sends email; the password is
//                                                 asked for and kept in .entity/smtp-password
//   entity twofactor mail --outbox DIR           write emails to files instead (testing)
//   entity twofactor test you@example.org        send a test email
//   entity twofactor reset <member>              turn it off for a member who lost their email
//   entity twofactor set <member> <email>        turn it on for a member, as the operator
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../../kernel/store.js';
import { refuse, openEntity, out, askPassword } from '../context.js';
import { twoFactor, mask, validEmail } from '../twofactor.js';
import { mailConfig, sendMail } from '../mail.js';

export async function twofactor({ pos, opt }) {
  const sub = pos[0] || 'status';
  const e = await openEntity(opt);
  const tf = twoFactor(e.dir), node = store.readNode(e.dir), name = e.params.value('entity.name');
  if (sub === 'status') {
    const cfg = mailConfig(e.dir, node);
    out(`two-factor module: ${tf.on(e.params) ? `installed; twofactor.require is ${tf.policy(e.params)}` : 'not installed (entity module add twofactor, by decision)'}`);
    out(`mail: ${!cfg ? 'not set up (entity twofactor mail …)' : cfg.outbox ? `written to ${cfg.outbox} (testing)` : `${cfg.user || '(no login)'} via ${cfg.host}:${cfg.port}${cfg.password ? '' : ', NO PASSWORD SET'}`}`);
    const list = tf.list();
    out(list.length ? list.map(m => `  ${m.id.padEnd(20)} ${mask(m.email)}  since ${m.since.slice(0, 10)}`).join('\n') : '  no member uses it yet');
    return;
  }
  if (sub === 'mail') {
    if (opt.outbox) node.mail = { outbox: String(opt.outbox), from: opt.from || `${name} <republic@localhost>` };
    else {
      if (!opt.host || !opt.user) refuse('usage: entity twofactor mail --host smtp.example.org [--port 465|587] --user you@example.org --from "Name <you@example.org>"');
      node.mail = { host: String(opt.host), port: Number(opt.port || 465), user: String(opt.user), from: String(opt.from || `${name} <${opt.user}>`) };
      const pw = process.env.ENTITY_SMTP_PASSWORD || await askPassword(`Password (or app password) for ${opt.user}: `);
      fs.mkdirSync(path.join(e.dir, '.entity'), { recursive: true });
      fs.writeFileSync(path.join(e.dir, '.entity', 'smtp-password'), pw + '\n', { mode: 0o600 });
    }
    fs.writeFileSync(path.join(e.dir, 'node.json'), JSON.stringify(node, null, 2) + '\n');
    out(`mail set up${node.mail.outbox ? ` to write to ${node.mail.outbox}` : ` through ${node.mail.host}:${node.mail.port}`}. Try it: entity twofactor test you@example.org`);
    return;
  }
  if (sub === 'test') {
    if (!validEmail(pos[1])) refuse('usage: entity twofactor test you@example.org');
    const r = await sendMail(mailConfig(e.dir, node), pos[1], `A test from ${name}`, `This node can send email. Two-factor codes for ${name} will come from this address.\n`);
    out(r.outbox ? 'written to the outbox' : `sent to ${pos[1]}`);
    return;
  }
  if (sub === 'reset') {
    if (!pos[1]) refuse('usage: entity twofactor reset <member>');
    out(tf.remove(pos[1]) ? `two-factor is off for ${pos[1]}. If the republic requires it of them, they set it up again at their next sign-in.` : `${pos[1]} did not use two-factor`);
    return;
  }
  if (sub === 'set') {
    if (!e.state.participants[pos[1]] || !validEmail(pos[2])) refuse('usage: entity twofactor set <member> <email>');
    tf.enroll(pos[1], pos[2]);
    out(`two-factor is on for ${pos[1]}; codes go to ${mask(pos[2])}`);
    return;
  }
  refuse('usage: entity twofactor status | mail … | test <email> | reset <member> | set <member> <email>');
}
