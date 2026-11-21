// Security headers for every response the node sends.
//
// Members' keys live in the browser, on the republic's own origin, so anything
// that runs script there can sign as them. The Content Security Policy lets a
// page run only what this node serves: its own script files, and the inline
// scripts written into the very HTML file being sent (each allowed by its hash,
// so a script injected into a page later does not run). A page built on windows
// of other republics may load their window.js: the origins of the <script src>
// tags in that same file are allowed to load and connect, and nothing else.
//
// node.json "csp" tunes it:
//   { "mode": "enforce" | "report-only" | "off",   default "enforce"
//     "allow": ["https://other.example"] }          extra origins to load and connect
import crypto from 'node:crypto';

const INLINE = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;
const EXTERNAL = /<script\b[^>]*\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
const DATA_TYPES = /type\s*=\s*["']?(application\/(ld\+)?json|text\/template|text\/plain)/i;

const cache = new Map();   // the policy for an HTML body depends only on its bytes

// What an HTML body needs: the hashes of its inline scripts and the origins of its external ones.
export function scanHtml(html) {
  const text = Buffer.isBuffer(html) ? html.toString('utf8') : String(html ?? '');
  const key = crypto.createHash('sha256').update(text).digest('base64');
  if (cache.has(key)) return cache.get(key);
  const hashes = new Set(), origins = new Set();
  for (const [, attrs, body] of text.matchAll(INLINE)) {
    if (DATA_TYPES.test(attrs)) continue;   // a JSON data block is never executed
    hashes.add(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  for (const [, src] of text.matchAll(EXTERNAL)) { try { origins.add(new URL(src).origin); } catch { /* not a URL */ } }
  const found = { hashes: [...hashes], origins: [...origins] };
  if (cache.size > 500) cache.clear();
  cache.set(key, found);
  return found;
}

const cleanOrigins = (list) => (Array.isArray(list) ? list : [])
  .map(o => { try { const u = new URL(String(o)); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } })
  .filter(Boolean);

// The Content-Security-Policy for one HTML response.
export function policy(html, cfg = {}) {
  const { hashes, origins } = scanHtml(html);
  const others = [...new Set([...origins, ...cleanOrigins(cfg.allow)])];
  const load = ["'self'", ...others].join(' ');
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...hashes, ...others].join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${load}`,
    "frame-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const isHttps = (req) => String(req?.headers?.['x-forwarded-proto'] || '').includes('https') || !!req?.headers?.['cf-visitor'] || !!req?.socket?.encrypted;

// The headers to add to one response. `given` are the headers the handler set; they win.
export function securityHeaders({ req, given = {}, body, privateMode = false, csp = {} }) {
  const lower = Object.fromEntries(Object.entries(given || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const type = String(lower['content-type'] || '');
  const add = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
  if (privateMode) add['cross-origin-resource-policy'] = 'same-origin';
  if (isHttps(req)) add['strict-transport-security'] = 'max-age=15552000';
  const mode = csp?.mode || 'enforce';
  if (mode !== 'off' && /text\/html/i.test(type)) {
    add[mode === 'report-only' ? 'content-security-policy-report-only' : 'content-security-policy'] = policy(body, csp);
  }
  for (const k of Object.keys(add)) if (k in lower) delete add[k];
  return add;
}

// Wrap one response so every writeHead, however it is called, carries the
// headers above. Headers are held until the body is known (end) or a stream
// starts (write), so an HTML page's own inline scripts can be hashed.
export function guard(req, res, settings) {
  const writeHead = res.writeHead.bind(res), write = res.write.bind(res), end = res.end.bind(res);
  let held = null;
  const flush = (body) => {
    if (!held) return;
    const [code, a, b] = held; held = null;
    const given = { ...res.getHeaders(), ...(typeof a === 'object' && a !== null ? a : (b || {})) };
    const reason = typeof a === 'string' ? a : undefined;
    const s = settings();
    const headers = { ...securityHeaders({ req, given, body, privateMode: s.privateMode, csp: s.csp }), ...given };
    reason ? writeHead(code, reason, headers) : writeHead(code, headers);
  };
  res.writeHead = (code, a, b) => { held = [code, a, b]; return res; };
  res.write = (chunk, ...rest) => { flush(''); return write(chunk, ...rest); };
  res.end = (chunk, ...rest) => {
    if (held) flush(typeof chunk === 'function' ? '' : chunk);
    else if (!res.headersSent) { held = [res.statusCode || 200, {}]; flush(typeof chunk === 'function' ? '' : chunk); }
    return end(chunk, ...rest);
  };
}
