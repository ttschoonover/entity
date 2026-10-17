// A node over HTTP(S): `entity serve` on someone's machine or server.
export default function http(dest) {
  const base = dest.url.replace(/\/+$/, '');
  const timeout = dest.timeout || 8000;
  const req = async (p, init = {}) => {
    const r = await fetch(`${base}${p}`, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`${base}${p} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  return {
    name: dest.name || base,
    async push(bundle) {
      const res = await req('/bundle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bundle) });
      if (res.action === 'refused' || res.action === 'diverged') throw new Error(res.why);
    },
    async pull() { return req('/bundle'); },
  };
}
