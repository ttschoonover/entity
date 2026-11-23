// house.js · house access for a private node (node.json "house"): a house's own
// hub that its residents open without an account.
//
// A private node shows nothing but its sign-in page to strangers. With a
// "house" section in node.json it also lets in, to read and to make an account:
//
//   - anyone on the house's network: a direct connection from one of
//     house.networks (the private ranges of the house Wi-Fi), or a connection
//     through the Cloudflare tunnel whose visitor address is the house's own
//     public address (found every half hour when house.detect is on, plus any
//     listed in house.publicIps);
//   - anyone who types the house password (kept as a scrypt hash, never in
//     clear): a cookie then lets that browser in for 30 days, until the
//     password changes.
//
// Reading and joining are all house access gives. Editing and notifications
// are a member's, signed with their own key, as everywhere else. The house's
// admins (house.admins: member ids) change the hub's name, the password and
// the networks from the House settings page, signed in as themselves. None of
// this is in the record: it is the node's own setting, like its port.
//
//   "house": { "name": "…", "admins": ["tim"], "networks": ["10.0.0.0/8", …],
//              "publicIps": [], "detect": true, "password": { "salt", "hash", "set" } }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import * as store from '../kernel/store.js';

export const DEFAULT_NETWORKS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7', 'fe80::/10'];
export const COOKIE = 'gr_house';
const COOKIE_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const MIN_PASSWORD = 8;

export const houseOf = (dir) => { const h = store.readNode(dir).house; return h && typeof h === 'object' ? h : null; };

export function writeHouse(dir, house) {
  const f = path.join(dir, 'node.json');
  const node = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  node.house = house;
  fs.writeFileSync(f, `${JSON.stringify(node, null, 2)}\n`);
}

// ── addresses ────────────────────────────────────────────────────────────
const LOOPBACK = (ip) => ip === '127.0.0.1' || ip === '::1' || /^127\./.test(ip);
export const plainIp = (ip) => String(ip || '').trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1').replace(/%.*$/, '');

// Who is asking: the connection's own address, or, only when the connection
// comes from this machine (cloudflared runs here), the visitor address the
// Cloudflare tunnel passes on. A stranger cannot set that header for us: from
// anywhere else it is ignored.
export function clientIp(req) {
  const remote = plainIp(req.socket?.remoteAddress);
  const cf = req.headers?.['cf-connecting-ip'];
  if (LOOPBACK(remote) && cf && net.isIP(plainIp(String(cf)))) return { ip: plainIp(String(cf)), via: 'tunnel' };
  return { ip: remote, via: LOOPBACK(remote) ? 'local' : 'direct' };
}

function toBig(ip) {
  const v = net.isIP(ip);
  if (v === 4) return { v, n: ip.split('.').reduce((a, o) => (a << 8n) | BigInt(Number(o)), 0n), bits: 32 };
  if (v === 6) {
    let [head, tail] = ip.split('::');
    const h = head ? head.split(':') : [], t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
    // an embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups
    const fix = (g) => g.flatMap(x => (x.includes('.') ? (() => { const b = x.split('.').map(Number); return [((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16)]; })() : [x]));
    const H = fix(h), T = t === null ? [] : fix(t);
    const groups = t === null ? H : [...H, ...Array(8 - H.length - T.length).fill('0'), ...T];
    if (groups.length !== 8) return null;
    return { v, n: groups.reduce((a, g) => (a << 16n) | BigInt(parseInt(g || '0', 16)), 0n), bits: 128 };
  }
  return null;
}

// "10.0.0.0/8", "203.0.113.7" (one address), "2001:db8:1:2::/64"
export function parseCidr(s) {
  const [addr, len] = String(s || '').trim().split('/');
  const a = toBig(plainIp(addr));
  if (!a) return null;
  const prefix = len === undefined || len === '' ? a.bits : Number(len);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > a.bits) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(a.bits - prefix);
  return { v: a.v, net: a.n & mask, mask, text: `${plainIp(addr)}${len !== undefined && len !== '' ? `/${prefix}` : ''}` };
}
export const validCidr = (s) => !!parseCidr(s);

export function inCidr(ip, cidr) {
  const c = typeof cidr === 'string' ? parseCidr(cidr) : cidr, a = toBig(plainIp(ip));
  return !!(c && a && c.v === a.v && (a.n & c.mask) === c.net);
}

// ── the house's own public address(es) ──────────────────────────────────
// Asked of Cloudflare's trace page (the address it sees this machine come
// from), over IPv4 and IPv6. An IPv6 address stands for its /64, which is the
// house network's.
async function trace(url, timeout = 6000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try { const r = await fetch(url, { signal: ctl.signal }); const m = (await r.text()).match(/^ip=(.+)$/m); return m ? plainIp(m[1]) : null; }
  catch { return null; } finally { clearTimeout(t); }
}
export async function detectPublic() {
  const [v4, v6] = await Promise.all([trace('https://1.1.1.1/cdn-cgi/trace'), trace('https://[2606:4700:4700::1111]/cdn-cgi/trace')]);
  const out = [];
  if (v4 && net.isIPv4(v4)) out.push(v4);
  if (v6 && net.isIPv6(v6)) { const c = parseCidr(`${v6}/64`); if (c) out.push(`${v6}/64`); }
  return out;
}

// ── the password ─────────────────────────────────────────────────────────
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32, SCRYPT).toString('hex');
  return { salt, hash, set: new Date().toISOString() };
}
export function checkPassword(house, pw) {
  const p = house?.password;
  if (!p?.salt || !p?.hash || typeof pw !== 'string' || !pw) return false;
  const got = crypto.scryptSync(pw, p.salt, 32, SCRYPT), want = Buffer.from(p.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `the house password needs at least ${MIN_PASSWORD} characters`;
  if (pw.length > 200) return 'that password is too long';
  return null;
}

// ── the cookie: "<password set>.<expires>.<mac>", signed with the node's own key ──
function secret(dir) {
  const f = path.join(dir, '.entity', 'house.key');
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 }); }
  return fs.readFileSync(f, 'utf8').trim();
}
const mac = (dir, s) => crypto.createHmac('sha256', secret(dir)).update(`house\n${s}`).digest('base64url');
export function makeCookie(dir, house) {
  const until = Date.now() + COOKIE_DAYS * 86400000;
  const body = `${Buffer.from(house.password?.set || '').toString('base64url')}.${until}`;
  return { value: `${body}.${mac(dir, body)}`, maxAge: COOKIE_DAYS * 86400 };
}
export function cookieValid(dir, house, value) {
  if (!house?.password || typeof value !== 'string') return false;
  const i = value.lastIndexOf('.'); if (i < 0) return false;
  const body = value.slice(0, i), sig = value.slice(i + 1), want = mac(dir, body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  const [set, until] = body.split('.');
  return Buffer.from(set || '', 'base64url').toString() === house.password.set && Number(until) > Date.now();
}
export const cookieFrom = (req) => (String(req.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_.-]+)`)) || [])[1];

// ── the node's side ──────────────────────────────────────────────────────
// One per node: its detected addresses, refreshed, and failed-password counts.
export function houseNode(dir) {
  let detected = [], checkedAt = null, timer = null;
  const tries = new Map();   // ip → { n, since }
  const refresh = async () => {
    const h = houseOf(dir);
    if (!h || h.detect === false) { detected = []; return; }
    const got = await detectPublic();
    if (got.length) { detected = got; checkedAt = new Date().toISOString(); }
  };
  const start = () => { if (timer) return; refresh().catch(() => {}); timer = setInterval(() => refresh().catch(() => {}), 30 * 60000); timer.unref?.(); };

  // How this request gets in, if at all: 'network' or 'password' (null: it doesn't).
  function access(req) {
    const h = houseOf(dir);
    if (!h) return null;
    const { ip, via } = clientIp(req);
    if (via === 'direct' && (h.networks || DEFAULT_NETWORKS).some(c => inCidr(ip, c))) return 'network';
    if (via === 'tunnel' && [...(h.publicIps || []), ...(h.detect === false ? [] : detected)].some(c => inCidr(ip, c))) return 'network';
    if (cookieValid(dir, h, cookieFrom(req))) return 'password';
    return null;
  }
  // Ten wrong passwords from one address in fifteen minutes, then a pause.
  function limited(ip) {
    const t = tries.get(ip);
    if (t && Date.now() - t.since > 15 * 60000) { tries.delete(ip); return false; }
    return !!(t && t.n >= 10);
  }
  const failed = (ip) => { const t = tries.get(ip); if (!t || Date.now() - t.since > 15 * 60000) tries.set(ip, { n: 1, since: Date.now() }); else t.n += 1; if (tries.size > 5000) tries.clear(); };
  return { start, refresh, access, limited, failed, detected: () => ({ addresses: detected, checkedAt }) };
}

// What an admin may change, checked and applied; returns the new house or { why }.
export function applyChanges(house, b, state) {
  const h = { ...house };
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n || n.length > 80) return { why: 'the name needs 1 to 80 characters' };
    h.name = n;
  }
  if (b.password !== undefined && b.password !== '') {
    const why = passwordProblem(b.password); if (why) return { why };
    h.password = hashPassword(b.password);
  }
  if (b.clearPassword === true) delete h.password;
  for (const k of ['networks', 'publicIps']) {
    if (b[k] === undefined) continue;
    const list = (Array.isArray(b[k]) ? b[k] : String(b[k]).split(/[\s,]+/)).map(s => String(s).trim()).filter(Boolean);
    const bad = list.find(s => !validCidr(s)); if (bad) return { why: `${bad} is not an address or a network (like 10.0.0.0/8)` };
    if (list.length > 50) return { why: 'at most 50 entries' };
    h[k] = list;
  }
  if (b.detect !== undefined) h.detect = b.detect === true;
  if (b.admins !== undefined) {
    const list = [...new Set((Array.isArray(b.admins) ? b.admins : String(b.admins).split(/[\s,]+/)).map(s => String(s).trim()).filter(Boolean))];
    if (!list.length) return { why: 'the hub needs at least one admin' };
    const notMember = list.find(id => state.participants[id]?.status !== 'active');
    if (notMember) return { why: `${notMember} is not an active member` };
    h.admins = list;
  }
  return { house: h };
}
export const isAdmin = (house, state, id) => !!(id && house?.admins?.includes(id) && state?.participants?.[id]?.status === 'active');
