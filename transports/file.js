// Class 0 · a single file. Carried by hand, by USB stick, by email. Always works.
import fs from 'node:fs';
export default function file(dest) {
  return {
    name: dest.name || `file:${dest.path}`,
    async push(bundle) { fs.writeFileSync(dest.path, JSON.stringify(bundle) + '\n'); },
    async pull() { return fs.existsSync(dest.path) ? JSON.parse(fs.readFileSync(dest.path, 'utf8')) : null; },
  };
}
