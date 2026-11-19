// entity letter · official letters on letterheads (the letters module).
//
//   entity letter list                              every letter, newest first
//   entity letter heads                             the letterheads and who issues on each
//   entity letter show ID                           a letter as text, with its authority
//   entity letter render ID [--out dir] [--pdf]     its LaTeX (and signature images); --pdf runs pdflatex
//   entity letter sample HEAD [--out dir] [--pdf]   a specimen letter on a letterhead, to judge its look
//   entity letter issue --letterhead HEAD --subject "…" (--body "…" | --body-file f)
//                       [--to "line|line"] [--salutation "…"] [--closing "…"] [--cc "a|b"]
//                       [--enclosures "a|b"] [--date YYYY-MM-DD] [--id ID] [--no-signatures] [--note "…"]
//       Uses the grant you hold for that letterhead; on the members' own
//       letterhead, lays a proposal instead. Prints the use to co-sign, if any.
//   entity letter cosign EXERCISE                   add your signature to a joint letter
//   entity letter withdraw ID --reason "…"          under the same authority as issuing
//   entity letter specimen --png FILE | --clear     deposit (or remove) your drawn signature
//   entity letter letterhead define|amend --file head.json   lay the proposal
//   entity letter letterhead retire HEAD
//
// Common: --as ID, --dir DIR, --settle

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as store from '../../kernel/store.js';
import { openEntity, refuse, out, signed, whoAmI, settlePending } from '../context.js';
import crypto from 'node:crypto';
import * as media from '../media.js';

const lines = (v) => (v === undefined || v === true ? undefined : String(v).split('|').map(s => s.trim()).filter(Boolean));

async function lettersOf(e) {
  const mod = e.registry.modules?.get?.('letters');
  if (!mod) refuse('the letters module is not installed here: `entity module add letters`');
  if (!e.params.value('entity.modules').includes('letters')) refuse('the letters module is installed but switched off');
  const dir = fs.existsSync(path.join(e.dir, 'modules', 'letters', 'render.js')) ? path.join(e.dir, 'modules', 'letters') : path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'library', 'letters');
  const render = await import(pathToFileURL(path.join(dir, 'render.js')).href);
  return { mod, render };
}

const nameOf = (e) => (id) => {
  const t = e.state.m.titles?.[id];
  return (typeof t === 'string' ? t : t?.title) || e.state.participants[id]?.name || id;
};

function renderOpts(e, mod, l, { specimen = false } = {}) {
  return {
    entity: e.params.value('entity.name') || e.state.entity.id,
    issuerTitle: mod.issuerTitle(e.state, l.head.issuer),
    name: nameOf(e), style: mod.styleOf(e.params, l.head),
    drawing: (s) => mod.specimenOf(e.state, s), specimen,
  };
}

function write(dir, base, { tex, images }, pdf) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${base}.tex`);
  fs.writeFileSync(f, tex);
  for (const im of images) fs.writeFileSync(path.join(dir, im.file), Buffer.from(im.dataUrl.split(',')[1], 'base64'));
  out(`${f}${images.length ? ` and ${images.length} signature image(s)` : ''}`);
  if (!pdf) return;
  const run = () => execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', `${base}.tex`], { cwd: dir, stdio: 'pipe' });
  try { run(); run(); } catch (x) { refuse(`pdflatex failed; see ${path.join(dir, `${base}.log`)}\n${String(x.stdout || '').split('\n').filter(s => s.startsWith('!')).join('\n')}`); }
  for (const ext of ['aux', 'log', 'out']) fs.rmSync(path.join(dir, `${base}.${ext}`), { force: true });
  out(path.join(dir, `${base}.pdf`));
}

// The grants the member may use to carry this effect on this letterhead.
function grantFor(e, by, effect) {
  const A = e.registry.modules.get('authority');
  if (!A) return null;
  const at = new Date().toISOString();
  return Object.values(e.state.m.authority?.grants || {}).find(g => A.inForce(e.state, g.id) && g.may.includes(effect.kind)
    && !A.outside(g.where, effect) && (A.body(e.state, g.to, at) || []).includes(by)) || null;
}

async function carry(e, opt, effect, title) {
  const { mod } = await lettersOf(e);
  const head = e.state.m.letters?.heads?.[effect.letterhead || mod.letterOf(e.state, effect.letter)?.letterhead];
  if (!head) refuse(`there is no letterhead ${effect.letterhead}`);
  const by = whoAmI(e.state.entity.id, opt);
  if (head.issuer === 'entity') {
    const { required, proposalId } = await import('../../modules/deliberation/index.js');
    const fields = { title, effects: [effect] };
    fields.rule = opt.rule || required(e.params, fields, e.registry).name;
    const a = await signed(e, 'proposal.lay', fields, opt);
    store.writePending(e.dir, a);
    out(`proposal ${proposalId(a)} laid under the ${fields.rule} rule: the letter is issued if the members carry it`);
  } else {
    const g = grantFor(e, by, effect);
    if (!g) refuse(`you hold no grant to ${effect.kind} on "${head.letterhead}", which belongs to ${head.issuer}. The members grant it, e.g.\n  entity propose --title "Letters" --effects '[{"kind":"authority.grant","grant":"${head.letterhead}-letters","to":{${head.issuer.replace(':', '":"').replace(/^/, '"')}"},"may":["letter.issue","letter.withdraw"],"where":{"letterhead":"${head.letterhead}"}}]'`);
    const a = await signed(e, 'authority.exercise', { grant: g.id, effects: [effect], ...(opt.note ? { note: String(opt.note) } : {}) }, opt);
    store.writePending(e.dir, a);
    const A = e.registry.modules.get('authority');
    const n = A.needed(g, e.state, (A.body(e.state, g.to, a.at) || []).length);
    out(n > 1 ? `signed under the grant ${g.id}: use ${A.exerciseId(a)} needs ${n} signatures; the others run\n  entity letter cosign ${A.exerciseId(a)}` : `signed under the grant ${g.id}`);
  }
  if (opt.settle) { const r = await settlePending(e); for (const x of r.refused) out(`refused: ${x.reason}`); }
}

// The wiki as letters: each page (the version in force if enacted, else the
// latest) set on a letterhead, written to letters/wiki/PAGE.tex and, with
// --pdf, PAGE.pdf. The node serves letters/ to signed-in members only when
// the site is private. A page already rendered at its current version is
// skipped unless --force. The letterhead is --letterhead, else node.json
// "wikiLetters": { "letterhead": … }, else the members' own letterhead, else
// a plain one in the house style made from the entity's name.
// The pictures a page shows, as files beside its .tex: pictures from the
// entity's media/ are copied (after checking them against their names); a
// picture at an http(s) address is downloaded once and kept as img-HASH. Only
// JPEG and PNG can be set by pdflatex; any other picture prints as its words.
async function picturesFor(e, dir, md) {
  const files = {};
  for (const { src } of media.imagesIn(md)) {
    if (files[src]) continue;
    try {
      const m = src.match(media.MEDIA_PATH);
      if (m) {
        const f = path.join(e.dir, src);
        if (!fs.existsSync(f) || !['jpg', 'png'].includes(m[2])) continue;
        const buf = fs.readFileSync(f);
        if (media.fullHash(buf).slice(0, 32) !== m[1]) { out(`  ${src} does not match its name; left out`); continue; }
        const name = path.basename(src);
        if (!fs.existsSync(path.join(dir, name))) fs.writeFileSync(path.join(dir, name), buf);
        files[src] = name;
      } else if (/^https?:\/\//.test(src)) {
        const stem = `img-${crypto.createHash('sha256').update(src).digest('hex').slice(0, 16)}`;
        const have = ['.jpg', '.png'].map(x => stem + x).find(n => fs.existsSync(path.join(dir, n)));
        if (have) { files[src] = have; continue; }
        const res = await fetch(src, { headers: { 'user-agent': 'entity-letters/1.0 (an Athènes node)' }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) { out(`  ${src}: the address answered ${res.status}; left out`); continue; }
        const buf = Buffer.from(await res.arrayBuffer()), ext = media.sniff(buf);
        if (!['.jpg', '.png'].includes(ext)) { out(`  ${src}: not a JPEG or PNG; left out`); continue; }
        fs.writeFileSync(path.join(dir, stem + ext), buf);
        files[src] = stem + ext;
      }
    } catch (x) { out(`  ${src}: ${x.message}; left out`); }
  }
  return files;
}

export async function wikiLetters(e, mod, render, pages, opt) {
  const wiki = e.state.m.wiki?.pages || {};
  const node = store.readNode(e.dir).wikiLetters || {};
  const heads = e.state.m.letters?.heads || {};
  const name = e.params.value('entity.name');
  const head = heads[opt.letterhead || node.letterhead]
    || Object.values(heads).find(h => h.issuer === 'entity' && !h.retired)
    || { letterhead: 'wiki', issuer: 'entity', name, title: 'From the wiki' };
  if ((opt.letterhead || node.letterhead) && !heads[opt.letterhead || node.letterhead]) refuse(`there is no letterhead ${opt.letterhead || node.letterhead}`);
  const ids = pages.length ? pages : Object.keys(wiki);
  const dir = path.resolve(e.dir, opt.out || node.out || 'letters/wiki');
  fs.mkdirSync(dir, { recursive: true });
  const index = [];
  let made = 0;
  for (const id of ids) {
    const p = wiki[id] || refuse(`there is no wiki page ${id}`);
    const v = p.statute ? p.versions[p.statute.version - 1] : p.versions[p.versions.length - 1];
    const stamp = path.join(dir, `${id}.version`);
    index.push({ page: id, title: v.title, version: v.n, statute: !!p.statute, category: v.category || p.versions.findLast?.(x => x.category)?.category || '' });
    if (!opt.force && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === `${v.n}:${head.letterhead}` && (!opt.pdf || fs.existsSync(path.join(dir, `${id}.pdf`)))) continue;
    const l = { letter: `${id}`, letterhead: head.letterhead, head, date: v.at.slice(0, 10), to: [], salutation: '', subject: v.title, body: v.body,
      closing: '', cc: [], enclosures: [], signatures: false, signatories: [], fingerprint: mod.letterFingerprint({ letter: id, letterhead: head.letterhead, date: v.at.slice(0, 10), subject: v.title, body: v.body }) };
    const o = { entity: name, issuerTitle: '', name: nameOf(e), style: mod.styleOf(e.params, head), drawing: () => null,
      document: { subtitle: `${p.statute ? `Adopted as version ${v.n} on ${render.formatDate(p.statute.at.slice(0, 10), mod.styleOf(e.params, head).dates)}` : `Version ${v.n}, ${render.formatDate(v.at.slice(0, 10), mod.styleOf(e.params, head).dates)}`} · written by ${nameOf(e)(v.by)}`,
        footer: `From the wiki of ${name} · page ${id}, version ${v.n}` } };
    const pics = await picturesFor(e, dir, v.body);
    o.image = (src) => pics[src] || null;
    write(dir, id, render.renderLetter(l, o), !!opt.pdf);
    fs.writeFileSync(stamp, `${v.n}:${head.letterhead}\n`);
    made++;
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  out(`${made} page(s) rendered, ${ids.length - made} already current, in ${path.relative(e.dir, dir) || '.'}`);
}

export async function letter({ pos, opt }) {
  const [sub, ...rest] = pos;
  const e = await openEntity(opt);
  const { mod, render } = await lettersOf(e);
  const book = e.state.m.letters || { heads: {}, letters: {}, order: [] };

  if (!sub || sub === 'list') {
    const all = [...book.order].reverse().map(id => book.letters[id]);
    if (!all.length) return out('No letters yet.');
    for (const l of all) out(`${l.letter.padEnd(16)} ${l.date}  ${l.letterhead.padEnd(18)} ${l.subject}${l.withdrawn ? '  (withdrawn)' : ''}`);
    return;
  }
  if (sub === 'heads') {
    for (const h of Object.values(book.heads)) out(`${h.letterhead.padEnd(20)} ${h.name}${h.title ? ` · ${h.title}` : ''}  issued by ${h.issuer === 'entity' ? 'the members, by decision' : `${h.issuer}${h.joint ? ` (${h.joint === 'all' ? 'unanimously' : 'by majority'})` : ''}`}${h.retired ? '  (retired)' : ''}`);
    return;
  }
  if (sub === 'show') {
    const l = mod.letterOf(e.state, rest[0]) || refuse(`there is no letter ${rest[0]}`);
    const o = renderOpts(e, mod, l);
    out(`${l.letter} · ${l.date} · on "${l.letterhead}" (${l.head.name}${l.head.title ? `, ${l.head.title}` : ''})`);
    if (l.withdrawn) out(`WITHDRAWN ${l.withdrawn.at.slice(0, 10)}: ${l.withdrawn.reason}`);
    if (l.to.length) out(`To: ${l.to.join(', ')}`);
    out(`Re: ${l.subject}\n\n${l.salutation ? `${l.salutation}\n\n` : ''}${l.body}\n`);
    out(l.signatures ? `Signed: ${l.signatories.map(s => `${o.name(s.id)} (${s.role})`).join('; ')}` : 'No signatures shown.');
    out(render.authorityLine(l, o.issuerTitle));
    out(`Fingerprint ${l.fingerprint}${l.record ? ` · record ${l.record}` : ''}`);
    return;
  }
  if (sub === 'render') {
    const l = mod.letterOf(e.state, rest[0]) || refuse(`there is no letter ${rest[0]}`);
    return write(path.resolve(opt.out || '.'), l.letter, render.renderLetter(l, renderOpts(e, mod, l)), !!opt.pdf);
  }
  if (sub === 'sample') {
    const head = opt.file ? { letterhead: 'sample', ...JSON.parse(fs.readFileSync(opt.file, 'utf8')) } : book.heads[rest[0]] || refuse(`there is no letterhead ${rest[0]}; or give --file head.json`);
    const is = mod.parseIssuer(head.issuer) || refuse('the letterhead needs an issuer');
    const people = Object.values(e.state.participants).filter(p => p.status === 'active').map(p => p.id).slice(0, is.kind === 'office' ? 1 : 3);
    const role = is.kind === 'office' ? mod.issuerTitle(e.state, head.issuer) : is.kind === 'committee' ? `Member, ${mod.issuerTitle(e.state, head.issuer)}` : 'Member';
    const l = { letter: `${head.letterhead.toUpperCase()}-SPECIMEN`, letterhead: head.letterhead, head, date: new Date().toISOString().slice(0, 10),
      to: ['The Recipient', 'Their Organisation', 'Their City'], salutation: 'Dear Recipient,', subject: 'A specimen of this letterhead',
      body: 'This is a specimen of the letterhead, set in the house style with this letterhead\'s own adjustments. It has not been issued, and it carries no authority.\n\nA letter on this letterhead is issued only by **' + (is.kind === 'entity' ? 'the members, by decision' : mod.issuerTitle(e.state, head.issuer)) + '**, and shows the signatures of those who agreed to it.',
      closing: '', cc: [], enclosures: [], signatures: true, signatories: people.map(id => ({ id, role, specimen: null })),
      ...(is.kind === 'committee' ? { joint: { signed: people.length, of: people.length, unanimous: true } } : {}), fingerprint: '' };
    return write(path.resolve(opt.out || '.'), l.letter, render.renderLetter(l, renderOpts(e, mod, l, { specimen: true })), !!opt.pdf);
  }
  if (sub === 'wiki') return wikiLetters(e, mod, render, rest, opt);
  if (sub === 'issue') {
    const head = book.heads[opt.letterhead] || refuse(`there is no letterhead ${opt.letterhead}; \`entity letter heads\` lists them`);
    const text = opt['body-file'] ? fs.readFileSync(opt['body-file'], 'utf8') : opt.body ? String(opt.body).replace(/\\n/g, '\n') : refuse('give --body "…" or --body-file letter.md');
    const date = opt.date || new Date().toISOString().slice(0, 10);
    const effect = { kind: 'letter.issue', letter: opt.id || mod.nextId(e.state, head, date.slice(0, 4)), letterhead: head.letterhead,
      subject: opt.subject || refuse('give a --subject'), body: text,
      ...(lines(opt.to) ? { to: lines(opt.to) } : {}), ...(opt.salutation ? { salutation: String(opt.salutation) } : {}),
      ...(opt.closing ? { closing: String(opt.closing) } : {}), ...(lines(opt.cc) ? { cc: lines(opt.cc) } : {}),
      ...(lines(opt.enclosures) ? { enclosures: lines(opt.enclosures) } : {}), ...(opt.date ? { date: opt.date } : {}),
      ...(opt['no-signatures'] ? { signatures: false } : {}) };
    out(`letter ${effect.letter}`);
    return carry(e, opt, effect, `Letter ${effect.letter}: ${effect.subject}`);
  }
  if (sub === 'cosign') {
    const x = e.state.m.authority?.exercises?.[rest[0]] || refuse(`there is no use of a grant ${rest[0]}`);
    const l = x.effects.find(f => f.kind === 'letter.issue');
    if (l) out(`co-signing letter ${l.letter} on "${l.letterhead}": ${l.subject}\n\n${l.body}\n`);
    const a = await signed(e, 'authority.cosign', { exercise: x.id }, opt);
    store.writePending(e.dir, a);
    out(`your signature on ${x.id} (${x.signers.length + 1} of ${x.needs})`);
    if (opt.settle) await settlePending(e);
    return;
  }
  if (sub === 'withdraw') {
    const l = mod.letterOf(e.state, rest[0]) || refuse(`there is no letter ${rest[0]}`);
    return carry(e, opt, { kind: 'letter.withdraw', letter: l.letter, reason: opt.reason || refuse('give a --reason; it is published') }, `Withdraw letter ${l.letter}`);
  }
  if (sub === 'specimen') {
    const drawing = opt.clear ? null : `data:image/png;base64,${fs.readFileSync(opt.png || refuse('give --png signature.png (a transparent PNG works best), or --clear')).toString('base64')}`;
    const a = await signed(e, 'letter.specimen', { drawing }, opt);
    store.writePending(e.dir, a);
    out(drawing ? 'your drawn signature is signed and waiting to settle' : 'your drawn signature will be removed from letters signed from now on');
    if (opt.settle) await settlePending(e);
    return;
  }
  if (sub === 'letterhead') {
    const [what, id] = rest;
    const { required, proposalId } = await import('../../modules/deliberation/index.js');
    let effect;
    if (what === 'define' || what === 'amend') effect = { kind: `letterhead.${what}`, ...JSON.parse(fs.readFileSync(opt.file || refuse('give --file head.json'), 'utf8')) };
    else if (what === 'retire') effect = { kind: 'letterhead.retire', letterhead: id || refuse('which letterhead?') };
    else refuse('entity letter letterhead define|amend --file head.json | retire HEAD');
    const fields = { title: `${what[0].toUpperCase()}${what.slice(1)} the letterhead ${effect.letterhead}`, effects: [effect] };
    fields.rule = opt.rule || required(e.params, fields, e.registry).name;
    const a = await signed(e, 'proposal.lay', fields, opt);
    store.writePending(e.dir, a);
    out(`proposal ${proposalId(a)} laid under the ${fields.rule} rule`);
    if (opt.settle) await settlePending(e);
    return;
  }
  refuse('entity letter list | heads | show ID | render ID | sample HEAD | issue … | cosign X | withdraw ID | specimen | letterhead …');
}
