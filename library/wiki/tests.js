import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldWith, decide } from '../../test/helpers.js';
import wiki from './index.js';

test('wiki: versions are kept; stale edits refused; a version enacted, amended and repealed as a statute', async () => {
  const w = await worldWith(['wiki']);
  const edit = async (by, f) => w.settle(await w.sign('wiki.edit', by, { page: 'house-rules', title: 'House rules', ...f }));
  assert.equal((await edit('p-0001', { body: 'Quiet after 22:00.', base: 0 })).applied.length, 1);
  assert.equal((await edit('p-0002', { body: 'Quiet after 23:00.', base: 1, note: 'weekends' })).applied.length, 1);
  assert.match((await edit('p-0003', { body: 'No rules.', base: 1 })).refused[0].reason, /edited since version 1: it is at version 2/);
  assert.match((await edit('p-0003', { body: 'Quiet after 23:00.', base: 2 })).refused[0].reason, /nothing changed/);
  const r = await decide(w, { title: 'Enact the house rules', rule: 'organic', effects: [{ kind: 'wiki.enact', page: 'house-rules', version: 2 }] });
  assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
  await edit('p-0003', { body: 'Quiet after 23:00.\nGuests welcome.', base: 2 });
  const p = w.state.m.wiki.pages['house-rules'];
  assert.equal(wiki.statuteText(p).n, 2, 'drafts do not change the law');
  const weak = await decide(w, { title: 'Quietly', rule: 'ordinary', effects: [{ kind: 'wiki.enact', page: 'house-rules', version: 3 }] });
  assert.match(weak.refused[0].reason, /requires "organic"/);
  await decide(w, { title: 'Amend', rule: 'organic', effects: [{ kind: 'wiki.enact', page: 'house-rules', version: 3 }] });
  await decide(w, { title: 'Repeal', rule: 'organic', effects: [{ kind: 'wiki.repeal', page: 'house-rules', reason: 'moved to the charter' }] });
  assert.deepEqual(w.state.m.wiki.pages['house-rules'].enactments.map(x => `${x.action} ${x.version}`), ['enacted 2', 'amended 3', 'repealed 3']);
  assert.equal(w.state.m.wiki.pages['house-rules'].versions.length, 3);
  assert.deepEqual(wiki.diffLines('a\nb', 'a\nc'), [[' ', 'a'], ['-', 'b'], ['+', 'c']]);
});
