// The kernel's public surface, identical in server and browser.
export * from './canonical.js';
export * from './hash.js';
export * as keys from './keys.js';
export * from './password.js';
export * from './signed.js';
export * from './record.js';
export * from './kinds.js';
export * from './state.js';
export * from './settle.js';
export * from './verify.js';
export * from './attest.js';
export * from './checkpoint.js';
export * from './repair.js';
export * from './parameters.js';
export * as yaml from './yaml.js';
export * as people from './participants.js';
export * from './effects.js';
export * from './version.js';
export * from './fork.js';
export { KERNEL_DEFAULTS } from './defaults.js';
export * from './gate.js';
export * from './transport.js';

import { Registry } from './kinds.js';
import { install as installParticipants } from './participants.js';
import { CORE_VERSION, versionAtLeast } from './version.js';

// A registry holding the kernel's kinds and every module passed in.
// Modules are installed whether or not an entity enables them; settlement
// refuses kinds of modules the entity has not enabled.
//
// A module that needs a newer core than this one is not installed: it is
// listed in registry.incompatible, and settlement holds acts as it does for
// any module whose code is missing.
export function createRegistry(modules = []) {
  const r = new Registry();
  installParticipants(r);
  for (const m of modules) {
    if (m.core && !versionAtLeast(CORE_VERSION, m.core)) { r.incompatible.set(m.name, m.core); continue; }
    r.modules.set(m.name, m);
    r.catalog[m.name] = m.parameters || {};
    m.install(r);
  }
  return r;
}
