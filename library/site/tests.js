import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith } from '../../test/helpers.js';
import site from './index.js';

test('site: posts are versioned, stale edits refused, drafts and hidden posts kept off the site', async () => {
  const w = await worldWith(['site']);
  const post = async (f) => w.settle(await w.sign('site.post', 'p-0001', { slug: 'hello', title: 'Hello', date: '2026-11-15', ...f }));
  assert.equal((await post({ body: 'First.', base: 0 })).applied.length, 1);
  assert.equal((await post({ body: 'Second.', base: 1, form: 'essay', tags: ['co-ops'] })).applied.length, 1);
  assert.match((await post({ body: 'Third.', base: 1 })).refused[0].reason, /edited since version 1/);
  assert.match((await post({ body: 'Second.', base: 2, form: 'essay', tags: ['co-ops'] })).refused[0].reason, /nothing changed/);
  assert.match((await post({ body: 'x', base: 2, date: 'yesterday' })).refused[0].reason, /YYYY-MM-DD/);
  await post({ body: 'Draft.', base: 2, status: 'draft' });
  assert.equal(site.published(w.state).posts.length, 0);
  await post({ body: 'Back.', base: 3 });
  const p = site.published(w.state).posts[0];
  assert.equal(p.body, 'Back.'); assert.equal(p.versions, 4); assert.equal(p.by, 'p-0001');
  assert.ok(!('salt' in p) && !('base' in p));
});

test('site: projects, photos, résumé and profile', async () => {
  const w = await worldWith(['site']);
  const s = async (kind, f) => w.settle(await w.sign(kind, 'p-0001', f));
  assert.equal((await s('site.project', { slug: 'china', name: 'China map', summary: 'A census map.', type: 'hosted', base: 0 })).applied.length, 1);
  assert.match((await s('site.project', { slug: 'x', name: 'X', summary: 'y', type: 'boat', base: 0 })).refused[0].reason, /type is one of/);
  assert.match((await s('site.project', { slug: 'x', name: 'X', summary: 'y', base: 0, bundle: { path: 'bundles/abc.tgz', hash: 'abc' } })).refused[0].reason, /bundle/);
  assert.equal((await s('site.photo', { id: 'p1', src: 'media/' + 'a'.repeat(32) + '.jpg', caption: 'Telegraph' })).applied.length, 1);
  assert.match((await s('site.photo', { id: 'p2', src: 'http://x/y.jpg' })).refused[0].reason, /media/);
  assert.equal((await s('site.resume', { body: '# Résumé', base: 0 })).applied.length, 1);
  assert.equal((await s('site.profile', { base: 0, profile: { lede: 'Hi.' } })).applied.length, 1);
  assert.match((await s('site.profile', { base: 0, profile: { lede: 'Hi!' } })).refused[0].reason, /edited since/);
  const pub = site.published(w.state);
  assert.equal(pub.projects[0].name, 'China map'); assert.equal(pub.photos.length, 1);
  assert.equal(pub.resume.body, '# Résumé'); assert.equal(pub.profile.lede, 'Hi.');
});
