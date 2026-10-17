// A local log of what this copy's node is doing, one JSON object per line,
// for anything that wants to react: LEDs on a Pi, a dashboard, a notifier.
// It lives in .entity/ (this copy's own files) and is never replicated.
import fs from 'node:fs';
import path from 'node:path';

const MAX = 1_000_000;

export function emit(dir, type, data = {}) {
  try {
    const f = path.join(dir, '.entity', 'events.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > MAX) fs.renameSync(f, `${f}.1`);
    fs.appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n');
  } catch { /* events are a convenience; never let them break the node */ }
}
