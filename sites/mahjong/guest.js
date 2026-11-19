// guest.js · who you are at a table. Signed in as a member: your own key, and
// results go on your profile. Not signed in: a key this browser made for you,
// kept here, with the name you choose. No account either way.
import { ctx, E, me } from './common.js';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: the seat lasts this visit */ } };
const memo = {};

export async function identity({ guest = false } = {}) {
  const p = me();
  if (!guest && p && ctx.ident?.seed) return { id: p.id, key: { seed: ctx.ident.seed, publicKey: ctx.ident.publicKey }, member: true };
  let g = read('mj:guest');
  if (!g) { g = { seed: Array.from(crypto.getRandomValues(new Uint8Array(32))) }; write('mj:guest', g); }
  if (!memo.guest) memo.guest = await E.keys.keyFromSeed(Uint8Array.from(g.seed));
  return { id: null, key: memo.guest, member: false };
}
export const keyLine = (k) => E.keys.publicKeyLine(k.publicKey);
export const signWith = (k, message) => E.keys.sign(message, k, 'entity.mahjong');
export const savedName = () => read('mj:name') || '';
export const saveName = (n) => write('mj:name', n);
export const tokenFor = (table) => read(`mj:token:${table}`);
export const saveToken = (table, t) => write(`mj:token:${table}`, t);
export const canonical = (x) => E.canonical(x); // the record's own canonical form, so signatures match the node's
