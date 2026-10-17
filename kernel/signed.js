// 2.5 · Acts and the material their signatures cover.
//
// act := { kind, entity, by, at, salt, ...payload, signature }
//
// signedMaterial is the ONE function every verifier calls. Different kinds may
// sign different material; nothing may reimplement this decision.

import { canonical, omit } from './canonical.js';
import { hash, randomHex } from './hash.js';
import { sign, verify } from './keys.js';

// 1.4 · Namespaces. Fixed at the start; changing them invalidates every signature.
export const NS = Object.freeze({
  act: 'entity.act',
  ballot: 'entity.ballot',
  attestation: 'entity.attestation',
  checkpoint: 'entity.checkpoint',
});

export function signedMaterial(registry, act) {
  const def = registry.get(act.kind);
  if (def && def.signs) return def.signs(act);
  return { message: canonical(omit(act, 'signature')), namespace: NS.act };
}

export const actHash = (act) => hash(canonical(act));
// Knowable before signing: identifies the act independent of its signature.
export const actId = (act) => hash(canonical(omit(act, 'signature')));

export function draft(kind, fields) {
  return { kind, salt: randomHex(16), ...fields };
}

export async function signAct(registry, act, privateKey) {
  const unsigned = omit(act, 'signature');
  const { message, namespace } = signedMaterial(registry, unsigned);
  return { ...unsigned, signature: await sign(message, privateKey, namespace) };
}

export async function verifyAct(registry, act, keys) {
  if (typeof act.signature !== 'string') return { ok: false, error: 'unsigned' };
  const { message, namespace } = signedMaterial(registry, act);
  return verify(message, act.signature, keys, namespace);
}
