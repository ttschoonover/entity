// Loads modules by name. The same loader runs in node and in the browser;
// each module is a directory with index.js exporting { name, install }, and
// optionally parameters.yml declaring its parameters and their defaults.
import { parse } from '../kernel/yaml.js';

async function readText(url) {
  if (url.startsWith('file:')) {
    const fs = await import('node:fs');
    const f = new URL(url);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  }
  const r = await fetch(url, { cache: 'no-store' });
  return r.ok ? r.text() : null;
}

// The module's declared parameters, read from the parameters.yml beside its
// index.js: its defaults are part of its code, pinned by the same digest.
export async function withParameters(mod, indexUrl) {
  if (!mod || mod.parameters) return mod;
  const text = await readText(new URL('parameters.yml', indexUrl).href);
  const parameters = text ? parse(text).parameters || {} : {};
  return { ...mod, parameters };
}

export async function loadModules(names, base = import.meta.url) {
  const out = [];
  for (const n of names) {
    if (!/^[a-z][a-z0-9-]*$/.test(n)) throw new Error(`bad module name "${n}"`);
    const url = new URL(`./${n}/index.js`, base).href;
    const m = await import(url);
    out.push(await withParameters(m.default, url));
  }
  return out;
}
