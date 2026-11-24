// mail.js · sending one plain email, for the node: a minimal SMTP client with
// TLS (port 465) or STARTTLS (port 587), and AUTH PLAIN. Nothing to install.
//
// Configured in node.json, never on the record:
//   "mail": { "host": "smtp.gmail.com", "port": 465, "user": "you@gmail.com", "from": "Republic <you@gmail.com>" }
// and the password in the environment (ENTITY_SMTP_PASSWORD) or in
// .entity/smtp-password beside the record (this copy's own, never replicated).
// For testing, "outbox": a folder (or ENTITY_MAIL_OUTBOX) where each message is
// written as a file instead of being sent.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export function mailConfig(dir, node) {
  const m = node.mail || {};
  const outbox = process.env.ENTITY_MAIL_OUTBOX || m.outbox;
  if (outbox) return { outbox: path.resolve(dir, outbox), from: m.from || 'republic@localhost' };
  // No SMTP server: send through the command that already sends notices (node.json notify.mail).
  if (!m.host) return node.notify?.mail ? { command: node.notify.mail, from: m.from || '' } : null;
  const pwFile = path.join(dir, '.entity', 'smtp-password');
  const password = process.env.ENTITY_SMTP_PASSWORD || (fs.existsSync(pwFile) ? fs.readFileSync(pwFile, 'utf8').trim() : '');
  const port = Number(m.port || 465);
  return { host: m.host, port, secure: m.secure ?? port === 465, starttls: m.starttls, user: m.user || '', password, from: m.from || m.user };
}

const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const addr = (s) => (String(s).match(/<([^>]+)>/) || [null, String(s).trim()])[1];

function message(cfg, to, subject, text) {
  const id = `${crypto.randomBytes(12).toString('hex')}@${addr(cfg.from).split('@')[1] || 'localhost'}`;
  const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [`From: ${cfg.from}`, `To: ${to}`, `Subject: ${header(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${id}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body].join('\r\n');
}

export async function sendMail(cfg, to, subject, text) {
  if (!cfg) throw new Error('no mail is configured for this node (node.json "mail")');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('that is not an email address');
  const msg = message(cfg, to, subject, text);
  if (cfg.command) return viaCommand(cfg.command, to, subject, text);
  if (cfg.outbox) {
    fs.mkdirSync(cfg.outbox, { recursive: true });
    fs.writeFileSync(path.join(cfg.outbox, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.eml`), msg);
    return { outbox: true };
  }
  return smtp(cfg, to, msg);
}

// The command gets the address and subject in NOTIFY_TO and NOTIFY_SUBJECT, the text on stdin.
function viaCommand(cmd, to, subject, text) {
  return new Promise((resolve, reject) => {
    const p = spawn('/bin/sh', ['-c', cmd], { env: { ...process.env, NOTIFY_TO: to, NOTIFY_SUBJECT: subject }, stdio: ['pipe', 'ignore', 'ignore'] });
    const t = setTimeout(() => { p.kill(); reject(new Error('the mail command took too long')); }, 30000);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve({ sent: true }) : reject(new Error(`the mail command exited ${code}`)); });
    p.stdin.end(text);
  });
}

function smtp(cfg, to, msg) {
  return new Promise((resolve, reject) => {
    let sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port });
    let buf = '', step = 0, upgraded = cfg.secure || cfg.starttls === false, done = false;
    const fail = (e) => { if (done) return; done = true; try { sock.destroy(); } catch { /* gone */ } reject(e instanceof Error ? e : new Error(e)); };
    const timer = setTimeout(() => fail(new Error(`the mail server ${cfg.host} did not answer`)), 20000);
    const write = (s) => sock.write(s + '\r\n');
    const auth = Buffer.from(`\0${cfg.user}\0${cfg.password}`).toString('base64');
    const onLine = (code, text, last) => {
      if (!last) return;
      if (code >= 400) return fail(new Error(`the mail server refused: ${code} ${text}`));
      if (step === 0) { step = 1; return write(`EHLO ${addr(cfg.from).split('@')[1] || 'localhost'}`); }
      if (step === 1) {
        if (!upgraded) { step = 'tls'; return write('STARTTLS'); }
        if (cfg.user) { step = 2; return write(`AUTH PLAIN ${auth}`); }
        step = 3; return write(`MAIL FROM:<${addr(cfg.from)}>`);
      }
      if (step === 'tls') {
        sock.removeAllListeners('data');
        sock = tls.connect({ socket: sock, servername: cfg.host }, () => { upgraded = true; step = 1; write(`EHLO ${addr(cfg.from).split('@')[1] || 'localhost'}`); });
        sock.on('data', onData); sock.on('error', fail);
        return;
      }
      if (step === 2) { step = 3; return write(`MAIL FROM:<${addr(cfg.from)}>`); }
      if (step === 3) { step = 4; return write(`RCPT TO:<${addr(to)}>`); }
      if (step === 4) { step = 5; return write('DATA'); }
      if (step === 5) { step = 6; return write(`${msg}\r\n.`); }
      if (step === 6) { step = 7; write('QUIT'); done = true; clearTimeout(timer); resolve({ sent: true }); sock.end(); }
    };
    const onData = (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        const m = line.match(/^(\d{3})([ -])(.*)$/);
        if (m) onLine(Number(m[1]), m[3], m[2] === ' ');
      }
    };
    sock.on('data', onData);
    sock.on('error', fail);
    sock.on('close', () => { clearTimeout(timer); if (!done) fail(new Error('the mail server closed the connection')); });
  });
}
