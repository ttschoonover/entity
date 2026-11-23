// hub.js · what the site and its sign-in page share: talking to the node,
// and signing with the member's password (nothing secret leaves the browser).
import * as keys from '/kernel/keys.js';
import { canonical } from '/kernel/canonical.js';
import { passwordKey } from '/kernel/password.js';

export const $ = (s, el = document) => el.querySelector(s);
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
};

export async function get(path) {
  const r = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.why || `the hub answered ${r.status}`), { status: r.status });
  return j;
}
export async function post(path, body) {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.why || j.refused?.[0]?.why || `the hub answered ${r.status}`), { status: r.status, body: j });
  return j;
}

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

// A password-derived key, kept in memory for this visit only.
let held = null;
export const keyFor = async (entity, id, password) => (held = { id, k: await passwordKey(entity, id, password) }).k;
export const heldKey = (id) => (held && held.id === id ? held.k : null);
export const forgetKey = () => { held = null; };

// An act, signed: { kind, salt, entity, by, at, ...fields, signature }.
export async function signAct(entity, by, key, kind, fields) {
  const act = { kind, salt: hex(16), entity, by, at: new Date().toISOString(), ...fields };
  act.signature = await keys.sign(canonical(act), key, 'entity.act');
  return act;
}
// The same for an application, which carries its own public key.
export async function applyAct(entity, id, key, name) {
  const act = { kind: 'participant.apply', salt: hex(16), entity, by: id, at: new Date().toISOString(), key: keys.publicKeyLine(key.publicKey), ...(name ? { name } : {}) };
  act.signature = await keys.sign(canonical(act), key, 'entity.act');
  return act;
}
export const signIn = async (entity, challenge, key) => keys.sign(`entity.signin\n${entity}\n${challenge}`, key, 'entity.signin');

// Send acts to the node; the reason a rule refused one becomes the error.
export async function send(acts) {
  const r = await fetch('/acts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(acts) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.refused?.length) throw new Error(j.refused?.[0]?.why || j.why || `the hub answered ${r.status}`);
  return j;
}

// Text size, kept in this browser.
export function sizes() {
  const now = (() => { try { return localStorage.getItem('loth:size') || 'm'; } catch { return 'm'; } })();
  document.documentElement.dataset.size = now;
  const box = h('div', { class: 'sizes', role: 'group', 'aria-label': 'Text size' });
  const names = { s: 'Smaller text', m: 'Normal text', l: 'Larger text', xl: 'Largest text' };
  const draw = (cur) => box.replaceChildren(...Object.keys(names).map(k => h('button', { type: 'button', 'aria-label': names[k], 'aria-pressed': String(k === cur),
    onclick: () => { document.documentElement.dataset.size = k; try { localStorage.setItem('loth:size', k); } catch { /* storage off */ } draw(k); } }, 'A')));
  draw(now);
  return box;
}
