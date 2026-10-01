// What the interface computes. Everything here is the kernel's and the
// modules' own code; the interface adds no second implementation of any rule.
// Importable in node, so the engine and the interface can be tested together.

import { createRegistry, parseLines, verifyRecords, prefixRoot, compare, signAct, draft, keys, actHash, Parameters, checkpointStatus,
  paramsOf, resolveElectorate, describeElectorate, originOf, canonical, makeCheckpoint, cosign, checkpointHash, passwordKey, passwordProblem, signedMaterial, admissionProblem } from '../../kernel/index.js';
import { loadModules } from '../../modules/index.js';
import { count } from '../../modules/deliberation/count.js';
import { proposalId, required } from '../../modules/deliberation/index.js';
import * as yaml from '../../kernel/yaml.js';

export { count, proposalId, required, keys, actHash, Parameters, yaml, paramsOf, resolveElectorate, describeElectorate, originOf, canonical, makeCheckpoint, cosign, checkpointHash, passwordKey, passwordProblem, admissionProblem };

export async function loadRegistry(moduleNames) {
  return createRegistry(await loadModules(moduleNames));
}

export async function verifyText(registry, text) {
  const { records, damage } = parseLines(text);
  const v = await verifyRecords(registry, records, damage);
  return { ...v, count: v.records, records, damage };
}

// The interface's tally is the engine's count, called on the replayed state.
export const tally = (state, proposal) => count(state, proposal);

// 7.1 · Remember. Store { count, root, at } on every visit; if the history
// served ever disagrees with what this browser saw, say so before anything else.
// What this browser has seen, and whether the record still agrees with it.
// With finality, only final records are held to that: records after the last
// final checkpoint are provisional, and their being replaced (because another
// copy's history became final) is a notice, not an alarm. `final` is the count
// of final records now, or null when the entity has no finality module.
export function remember(storage, entityId, records, at = new Date().toISOString(), final = null) {
  const k = `entity:${entityId}:seen`;
  let seen = [];
  try { seen = JSON.parse(storage.getItem(k) || '[]'); } catch { seen = []; }
  let warning = null, notice = null;
  for (const s of [...seen].reverse()) {
    const strict = typeof s.final === 'number' ? s.final : s.count;
    const strictRoot = typeof s.final === 'number' ? s.finalRoot : s.root;
    if (records.length < strict) {
      warning = { kind: 'shrunk', seen: s, now: records.length,
        text: `This browser saw ${strict} ${typeof s.final === 'number' ? 'final ' : ''}records on ${s.at.slice(0, 10)}. It is now being shown ${records.length}. Records have been removed, or this is a different entity. Do not act on this copy.` };
      break;
    }
    if (strict > 0 && prefixRoot(records, strict) !== strictRoot) {
      warning = { kind: 'rewritten', seen: s, now: records.length,
        text: `This browser saw ${strict} ${typeof s.final === 'number' ? 'final ' : ''}records on ${s.at.slice(0, 10)}. The first ${strict} records it is being shown now are different ones. The history has been rewritten, or this is a different entity. Do not act on this copy.` };
      break;
    }
    if (!notice && typeof s.final === 'number' && (records.length < s.count || prefixRoot(records, s.count) !== s.root)) {
      notice = { kind: 'reorganised', text: `Some records this browser saw after record ${s.final} were provisional, and have been replaced: another copy's history became final first. Their acts are settled again on top of it. Nothing final has changed.` };
    }
  }
  if (!warning) {
    const last = seen[seen.length - 1];
    if (!last || last.count !== records.length || (final !== null && last.final !== final)) {
      seen.push({ count: records.length, root: prefixRoot(records, records.length), at,
        ...(final !== null ? { final, finalRoot: prefixRoot(records, final) } : {}) });
      storage.setItem(k, JSON.stringify(seen.slice(-50)));
    }
  }
  return { warning, notice, visits: seen.length };
}

export { compare, checkpointStatus };

export async function makeAct(registry, state, kind, fields, privateKey, at = new Date().toISOString()) {
  return signAct(registry, draft(kind, { entity: state.entity.id, at, ...fields }), privateKey);
}

// The same, with any way of signing: signFn(message, namespace) → signature.
// (A passkey signs through the browser, not with a key this page holds.)
export async function makeActWith(registry, state, kind, fields, signFn, at = new Date().toISOString()) {
  const act = draft(kind, { entity: state.entity.id, at, ...fields });
  const { message, namespace } = signedMaterial(registry, act);
  return { ...act, signature: await signFn(message, namespace) };
}

// 7.2 · Constraints learned the hard way, said in words a participant can use.
export function environmentProblem(win) {
  if (!win.isSecureContext || !(win.crypto && win.crypto.subtle)) {
    return `This page was opened over plain HTTP (${win.location.origin}), where browsers switch off the cryptography it needs. Open it over HTTPS, from localhost, or run \`entity serve\` and visit http://localhost:7780. Nothing on this page can be verified or signed until then.`;
  }
  return null;
}

export function sendProblem(pageUrl, target) {
  try {
    const p = new URL(pageUrl), t = new URL(target, pageUrl);
    if (p.protocol === 'https:' && t.protocol === 'http:') {
      return `This page is on HTTPS and ${t.origin} is plain HTTP. Browsers block that silently. Open the node's own page (${t.origin}) and send from there, or save the act as a file.`;
    }
  } catch { return `"${target}" is not an address`; }
  return null;
}
