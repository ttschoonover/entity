// entity password set | remove — sign in with a password instead of a key file,
// as the page's "Ways to sign in" does. The password is asked for (twice), or
// read from ENTITY_NEW_PASSWORD; it never leaves this machine: what is recorded
// is the public key it makes, so the page can recognise it later.
import * as store from '../../kernel/store.js';
import { refuse, openEntity, out, signed, askPassword } from '../context.js';
import { settle } from './act.js';

export async function password({ pos, opt }) {
  const sub = pos[0];
  if (!['set', 'remove'].includes(sub)) refuse('usage: entity password set | remove [--as id] [--settle]');
  const e = await openEntity(opt);
  if (!e.params.value('entity.modules').includes('passwords')) refuse('the passwords module is not enabled here: install it first (entity module add passwords, or from the page)');
  const { passwordKey, passwordProblem, keys } = await import('../../kernel/index.js');
  const by = opt.as || (await import('../context.js')).whoAmI(e.state.entity.id, opt);
  if (sub === 'set') {
    let pw = process.env.ENTITY_NEW_PASSWORD;
    if (!pw) {
      pw = await askPassword(`New password for ${by}: `);
      if (pw !== await askPassword('The same again: ')) refuse('the two passwords differ; nothing changed');
    }
    const why = passwordProblem(pw, by); if (why) refuse(why);
    const k = await passwordKey(e.state.entity.id, by, pw);
    const a = await signed(e, 'password.set', { by, key: keys.publicKeyLine(k.publicKey) }, { ...opt, password: false });
    out(`signed password.set by ${by} → ${store.writePending(e.dir, a)}`);
  } else {
    const a = await signed(e, 'password.remove', { by }, { ...opt, password: false });
    out(`signed password.remove by ${by} → ${store.writePending(e.dir, a)}`);
  }
  if (opt.settle) return settle({ pos: [], opt });
}
