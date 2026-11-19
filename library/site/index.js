// site · a personal website kept as a record: posts, projects, photographs, a
// résumé and the words on the home page, every version signed and kept. The
// record is the source; tools/publish-site.mjs turns it into the public site
// (pages, feeds and LaTeX PDFs) each time something new is signed.
//
//   site.post     { slug, title, body, base, date, form?, tags?, lang?, of?, summary?, status?, note? }
//                   form: essay | note | paper | post      status: published | draft | hidden
//                   lang: en | fr; of: the slug of the post this one translates
//   site.project  { slug, name, summary, base, type?, address?, status?, live?, body?, cover?,
//                   bundle?, order?, hidden? }
//                   type: hosted (a site served at SLUG.<domain>) | app (something running
//                   elsewhere, e.g. an Athens entity) | link | archive.
//                   bundle: { path: 'bundles/<hash>.tgz', hash }, the files of a hosted site
//   site.photo    { id, src, caption?, place?, date?, order?, hidden? }      src: media/…
//   site.resume   { body, base, note? }                                       Markdown
//   site.profile  { base, profile }    the home page: lede, lately, reading, contact, links…
//
// Every edit names the version it starts from (base, 0 for something new), so
// nothing overwrites a change its author has not seen. Nothing is erased: a
// post taken down is a new version with status hidden, and the old ones stay.

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MEDIA = /^media\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
const BUNDLE = /^bundles\/[a-f0-9]{64}\.tgz$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['essay', 'note', 'paper', 'post'];
const PROJECT_KINDS = ['hosted', 'app', 'link', 'archive'];
const STATUS = ['published', 'draft', 'hidden'];

const str = (v, max, name, required = false) => {
  if (v === undefined || v === null || v === '') return required ? `${name} is required` : null;
  return typeof v === 'string' && v.length <= max ? null : `${name} is text of at most ${max} characters`;
};
const firstError = (...xs) => xs.find(Boolean) || null;
const area = (state) => (state.m.site = state.m.site || { posts: {}, projects: {}, photos: {}, resume: { versions: [] }, profile: { versions: [] } });
export const latest = (doc) => doc?.versions?.[doc.versions.length - 1] || null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const author = (state, act) => (state.participants[act.by]?.status === 'active' ? null : 'only active members may write the site');

// The fields of a versioned act that make up a version (everything but bookkeeping).
const fields = (act, drop = []) => Object.fromEntries(Object.entries(act).filter(([k]) => !['kind', 'by', 'at', 'base', 'note', 'nonce', 'salt', 'signature', 'entity', ...drop].includes(k)));
function baseCheck(doc, act, label) {
  const have = latest(doc)?.n || 0;
  if (act.base !== have) return doc ? `${label} has been edited since version ${act.base}: it is at version ${have}. Start from that one` : `${label} is new: base is 0`;
  return null;
}

function install(r) {
  r.registerKind({
    name: 'site.post', module: 'site',
    check(state, act, { params }) {
      const e = author(state, act) || firstError(
        SLUG.test(act.slug || '') ? null : 'a slug is 1–80 lowercase letters, digits and -',
        str(act.title, 200, 'a title', true),
        typeof act.body === 'string' && act.body.length <= params.value('site.max_length') ? null : `the text is at most ${params.value('site.max_length')} characters`,
        DATE.test(act.date || '') ? null : 'a date is YYYY-MM-DD',
        act.form === undefined || KINDS.includes(act.form) ? null : `form is one of ${KINDS.join(', ')}`,
        act.status === undefined || STATUS.includes(act.status) ? null : `status is one of ${STATUS.join(', ')}`,
        act.lang === undefined || ['en', 'fr'].includes(act.lang) ? null : 'lang is en or fr',
        act.of === undefined || SLUG.test(act.of) ? null : 'of is the slug of the post this translates',
        act.tags === undefined || (Array.isArray(act.tags) && act.tags.length <= 12 && act.tags.every(t => typeof t === 'string' && t.length && t.length <= 30)) ? null : 'tags are up to 12 words of at most 30 characters',
        str(act.summary, 400, 'a summary'), str(act.note, 200, 'a note'));
      if (e) return e;
      const doc = area(state).posts[act.slug];
      return baseCheck(doc, act, `the post ${act.slug}`) || (doc && same(fields(latest(doc), ['n']), fields(act)) ? 'nothing changed' : null);
    },
    reduce(state, rec) {
      const a = rec.payload.act, s = area(state);
      const doc = s.posts[a.slug] = s.posts[a.slug] || { slug: a.slug, created: rec.at, versions: [] };
      doc.versions.push({ n: doc.versions.length + 1, by: a.by, at: rec.at, note: a.note || '', ...fields(a) });
    },
  });

  r.registerKind({
    name: 'site.project', module: 'site',
    check(state, act, { params }) {
      const e = author(state, act) || firstError(
        SLUG.test(act.slug || '') ? null : 'a slug is 1–80 lowercase letters, digits and -',
        str(act.name, 120, 'a name', true), str(act.summary, 400, 'a summary', true),
        act.type === undefined || PROJECT_KINDS.includes(act.type) ? null : `type is one of ${PROJECT_KINDS.join(', ')}`,
        str(act.address, 300, 'an address'), str(act.status, 40, 'a status'),
        act.body === undefined || (typeof act.body === 'string' && act.body.length <= params.value('site.max_length')) ? null : 'the write-up is too long',
        act.cover === undefined || MEDIA.test(act.cover) ? null : 'a cover is a picture kept in media/',
        act.bundle === undefined || (act.bundle && BUNDLE.test(act.bundle.path || '') && act.bundle.path === `bundles/${act.bundle.hash}.tgz`) ? null : 'a bundle is { path: bundles/<sha256>.tgz, hash }',
        act.order === undefined || Number.isInteger(act.order) ? null : 'order is a whole number',
        act.live === undefined || typeof act.live === 'boolean' ? null : 'live is true or false',
        act.hidden === undefined || typeof act.hidden === 'boolean' ? null : 'hidden is true or false',
        str(act.note, 200, 'a note'));
      if (e) return e;
      const doc = area(state).projects[act.slug];
      return baseCheck(doc, act, `the project ${act.slug}`) || (doc && same(fields(latest(doc), ['n']), fields(act)) ? 'nothing changed' : null);
    },
    reduce(state, rec) {
      const a = rec.payload.act, s = area(state);
      const doc = s.projects[a.slug] = s.projects[a.slug] || { slug: a.slug, created: rec.at, versions: [] };
      doc.versions.push({ n: doc.versions.length + 1, by: a.by, at: rec.at, note: a.note || '', ...fields(a) });
    },
  });

  r.registerKind({
    name: 'site.photo', module: 'site',
    check(state, act) {
      return author(state, act) || firstError(
        SLUG.test(act.id || '') ? null : 'a photo id is 1–80 lowercase letters, digits and -',
        MEDIA.test(act.src || '') ? null : 'src is a picture kept in media/ (node cli/index.js media add FILE)',
        str(act.caption, 200, 'a caption'), str(act.place, 80, 'a place'),
        act.date === undefined || DATE.test(act.date) ? null : 'a date is YYYY-MM-DD',
        act.order === undefined || Number.isInteger(act.order) ? null : 'order is a whole number',
        act.hidden === undefined || typeof act.hidden === 'boolean' ? null : 'hidden is true or false',
        (() => { const p = area(state).photos[act.id]; return p && same(fields(p, ['by']), fields(act)) ? 'nothing changed' : null; })());
    },
    reduce(state, rec) {
      const a = rec.payload.act, s = area(state);
      s.photos[a.id] = { ...fields(a), by: a.by, at: rec.at, created: s.photos[a.id]?.created || rec.at };
    },
  });

  r.registerKind({
    name: 'site.resume', module: 'site',
    check(state, act, { params }) {
      const e = author(state, act) || firstError(
        typeof act.body === 'string' && act.body.trim() && act.body.length <= params.value('site.max_length') ? null : 'the résumé is Markdown text',
        str(act.note, 200, 'a note'));
      if (e) return e;
      const doc = area(state).resume;
      return baseCheck(doc.versions.length ? doc : null, act, 'the résumé') || (latest(doc)?.body === act.body ? 'nothing changed' : null);
    },
    reduce(state, rec) {
      const a = rec.payload.act, doc = area(state).resume;
      doc.versions.push({ n: doc.versions.length + 1, by: a.by, at: rec.at, note: a.note || '', body: a.body });
    },
  });

  r.registerKind({
    name: 'site.profile', module: 'site',
    check(state, act) {
      if (author(state, act)) return author(state, act);
      const p = act.profile;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return 'profile is an object: { name, sub, lede, lately, … }';
      if (JSON.stringify(p).length > 40000) return 'the profile is at most 40,000 characters';
      const doc = area(state).profile;
      return baseCheck(doc.versions.length ? doc : null, act, 'the profile') || (same(latest(doc)?.profile, p) ? 'nothing changed' : null);
    },
    reduce(state, rec) {
      const a = rec.payload.act, doc = area(state).profile;
      doc.versions.push({ n: doc.versions.length + 1, by: a.by, at: rec.at, profile: a.profile });
    },
  });
}

// What the public site shows: the latest version of each thing, as published.
export function published(state) {
  const s = state.m.site || { posts: {}, projects: {}, photos: {}, resume: { versions: [] }, profile: { versions: [] } };
  const posts = Object.values(s.posts).map(d => ({ ...latest(d), slug: d.slug, created: d.created, versions: d.versions.length }))
    .filter(p => (p.status || 'published') === 'published')
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
  const projects = Object.values(s.projects).map(d => ({ ...latest(d), slug: d.slug, versions: d.versions.length }))
    .filter(p => !p.hidden).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
  const photos = Object.values(s.photos).filter(p => !p.hidden)
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
  return { posts, projects, photos, resume: latest(s.resume), profile: latest(s.profile)?.profile || null };
}

export default { name: 'site', core: '0.4.1', install, latest, published, parameterKeys: ['site.max_length'] };
