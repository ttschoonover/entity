// The version of the core: the kernel and deliberation. A module may say the
// oldest core it runs on (`core: '0.4'` in its default export); a copy whose
// core is older holds its acts rather than settle them with code it cannot run.
export const CORE_VERSION = '0.7.7';

// '0.4' < '0.4.1' < '0.10'. Missing parts count as 0.
export function versionAtLeast(have, need) {
  const a = String(have).split('.').map(Number), b = String(need).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}
