// Everything but an id can be changed, under the rule that created it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecords } from '../kernel/index.js';
import { worldWith, decide, enact } from './helpers.js';

const ok = (r) => assert.equal(r.enacted, true, r.refused?.[0]?.reason || r.notEnacted);
const why = (r) => r.refused?.[0]?.reason || r.notEnacted || '';

test('amend: offices, committees, badges, budget lines, deeds, share classes, boards', async () => {
  const w = await worldWith(['offices', 'committees', 'badges', 'budget', 'deeds', 'shares', 'threads']);
  ok(await enact(w, { title: 'Make things', rule: 'constitutional', effects: [
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 2 },
    { kind: 'office.fill', office: 'treasurer', holder: 'p-0001' }, { kind: 'office.fill', office: 'treasurer', holder: 'p-0002' },
    { kind: 'committee.create', committee: 'finance', title: 'Finance', remit: 'money' },
    { kind: 'badge.create', badge: 'founder', title: 'Founder' },
    { kind: 'budget.line', line: 'ops', title: 'Ops', amount: 1000 },
    { kind: 'deed.grant', deed: 'oven', title: 'Oven', to: null },
    { kind: 'share.class', class: 'member', title: 'Member shares', voting: true, transferable: false }] }));
  await w.settle(await w.sign('board.create', 'p-0001', { board: 'recipes', title: 'Recipes' }));
  ok(await enact(w, { title: 'Rename everything', rule: 'constitutional', effects: [
    { kind: 'office.amend', office: 'treasurer', title: 'Financial Officer', term_days: 365 },
    { kind: 'committee.amend', committee: 'finance', title: 'Finance Committee', needs: 'all' },
    { kind: 'badge.amend', badge: 'founder', title: 'Founding Member', description: 'Here from the start' },
    { kind: 'budget.amend', line: 'ops', title: 'Operations', period: 'Year I' },
    { kind: 'deed.amend', deed: 'oven', title: 'The deck oven', description: 'Bought 2026' },
    { kind: 'share.amend', class: 'member', title: 'Membership shares', transferable: true },
    { kind: 'board.amend', board: 'recipes', title: 'Recipes and methods' }] }));
  const m = w.state.m;
  assert.equal(m.offices.treasurer.title, 'Financial Officer'); assert.equal(m.offices.treasurer.term_days, 365);
  assert.equal(m.committees.finance.needs, 'all'); assert.equal(m.badges.founder.title, 'Founding Member');
  assert.equal(m.budget.lines.ops.title, 'Operations'); assert.equal(m.deeds.oven.title, 'The deck oven');
  assert.equal(m.shares.classes.member.transferable, true); assert.equal(m.threads.boards.recipes.title, 'Recipes and methods');
  assert.match(why(await decide(w, { title: 'Too few seats', rule: 'organic', effects: [{ kind: 'office.amend', office: 'treasurer', seats: 1 }] })), /2 people hold it now/);
  assert.match(why(await decide(w, { title: 'Nothing', rule: 'organic', effects: [{ kind: 'badge.amend', badge: 'founder' }] })), /say what to change/);
  assert.match(why(await decide(w, { title: 'No such', rule: 'organic', effects: [{ kind: 'deed.amend', deed: 'nope', title: 'x' }] })), /there is no the deed nope|there is no/);
  assert.equal(m.offices.treasurer.amended.length, 1);
  assert.equal((await verifyRecords(w.registry, w.records)).ok, true);
});

test('amend: a grant can be renamed and its powers changed, checked as a new grant; never under a grant', async () => {
  const w = await worldWith(['offices', 'authority', 'budget']);
  ok(await decide(w, { title: 'Treasurer', rule: 'organic', effects: [
    { kind: 'office.create', office: 'treasurer', title: 'Treasurer', seats: 1 },
    { kind: 'office.fill', office: 'treasurer', holder: 'p-0002' },
    { kind: 'budget.line', line: 'ops', title: 'Ops', amount: 1000 },
    { kind: 'authority.grant', grant: 'books', to: { office: 'treasurer' }, may: ['budget.spend'] },
    { kind: 'authority.grant', grant: 'meta', to: { office: 'treasurer' }, may: ['budget.adjust'] }] }));
  ok(await decide(w, { title: 'Rename', rule: 'organic', effects: [{ kind: 'authority.amend', grant: 'books', title: 'Spending within the budget', note: 'Within lines only.' }] }));
  assert.equal(w.state.m.authority.grants.books.title, 'Spending within the budget');
  assert.match(why(await decide(w, { title: 'Powers without may', rule: 'organic', effects: [{ kind: 'authority.amend', grant: 'books', limit: { count: 2, days: 30 } }] })), /include may/);
  ok(await decide(w, { title: 'Limit it', rule: 'organic', effects: [{ kind: 'authority.amend', grant: 'books', may: ['budget.spend'], limit: { count: 2, days: 30 } }] }));
  assert.deepEqual(w.state.m.authority.grants.books.limit, { count: 2, days: 30 });
  assert.match(why(await enact(w, { title: 'Protected', rule: 'constitutional', effects: [{ kind: 'authority.amend', grant: 'books', may: ['authority.grant'] }] })), /delegable/);
  const r = await w.settle(await w.sign('authority.exercise', 'p-0002', { grant: 'meta', effects: [{ kind: 'authority.amend', grant: 'books', title: 'mine now' }] }));
  assert.match(r.refused[0].reason, /may not|amended by the members|not permit/);
});

test('amend: a meeting before it starts; a task by its poster until claimed', async () => {
  const w = await worldWith(['meetings', 'tasks']);
  const starts = new Date(Date.parse(w.at()) + 2 * 86400000).toISOString();
  ok(await decide(w, { title: 'Call', rule: 'ordinary', effects: [{ kind: 'meeting.call', meeting: 'gm', title: 'GM', starts }] }));
  ok(await decide(w, { title: 'Move it', rule: 'ordinary', effects: [{ kind: 'meeting.amend', meeting: 'gm', title: 'General Meeting', place: 'The kitchen', starts: new Date(Date.parse(starts) + 3600000).toISOString() }] }));
  assert.equal(w.state.m.meetings.gm.place, 'The kitchen');
  w.jump(3);
  assert.match(why(await decide(w, { title: 'Too late', rule: 'ordinary', effects: [{ kind: 'meeting.amend', meeting: 'gm', starts }] })), /already started/);
  ok(await decide(w, { title: 'Retitle', rule: 'ordinary', effects: [{ kind: 'meeting.amend', meeting: 'gm', title: 'First General Meeting' }] }));
  const act = async (kind, by, f) => w.settle(await w.sign(kind, by, f));
  await act('task.post', 'p-0001', { task: 'dishes', title: 'Dishes', hours: 1 });
  assert.match((await act('task.edit', 'p-0002', { task: 'dishes', title: 'x' })).refused[0].reason, /only the member who posted/);
  assert.equal((await act('task.edit', 'p-0001', { task: 'dishes', title: 'Dishes and counters', hours: 1.5 })).applied.length, 1);
  await act('task.claim', 'p-0002', { task: 'dishes' });
  assert.match((await act('task.edit', 'p-0001', { task: 'dishes', hours: 3 })).refused[0].reason, /can no longer change/);
  assert.equal(w.state.m.tasks.items.dishes.title, 'Dishes and counters');
});
