// A drop directory: a shared folder, a synced drive, a mounted stick. Each push
// adds a bundle; pull takes the longest one there.
import fs from 'node:fs';
import path from 'node:path';
export default function dir(dest) {
  const reach = () => { if (!fs.existsSync(dest.path) || !fs.statSync(dest.path).isDirectory()) throw new Error(`${dest.path} is not reachable`); };
  return {
    name: dest.name || `dir:${dest.path}`,
    async push(bundle) {
      reach();
      const f = path.join(dest.path, `${bundle.entity.id}-${String(bundle.range.to).padStart(8, '0')}.bundle.json`);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(bundle) + '\n'); fs.renameSync(`${f}.tmp`, f);
    },
    async pull() {
      reach();
      const files = fs.readdirSync(dest.path).filter(f => f.endsWith('.bundle.json')).sort();
      return files.length ? JSON.parse(fs.readFileSync(path.join(dest.path, files[files.length - 1]), 'utf8')) : null;
    },
  };
}
