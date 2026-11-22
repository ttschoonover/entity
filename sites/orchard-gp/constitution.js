// constitution.js · the partnership's settings, set out as a constitution:
// articles of numbered sections, each with its value in words, what it means,
// and the resolution that changes it. Read from the record in the partner's
// browser, so it is always the text in force.
import { start, ctx, h, $, me, onChange, onSigned, fullName, nameOf } from './common.js';
import { blocked, short } from './og.js';

const main = $('#main');
await start();

// The articles, in reading order: each gathers settings groups.
const ARTICLES = [
  ['The Partnership', ['Identity', 'Partnership']],
  ['Partners', ['Membership', 'Invitations', 'Partner details', 'Participation']],
  ['Decisions', ['Decisions', 'Deliberation']],
  ['Officers', ['Offices', 'Elections', 'Authority']],
  ['The Fund', ['Fund', 'Shares']],
  ['The Agreement', ['Agreements', 'Wiki']],
  ['Meetings', ['Meetings']],
  ['The Record and Privacy', ['Record', 'Signing in', 'Two-factor', 'Finality']],
];
const SCHEDULE = ['Vocabulary', 'Titles']; // words and limits, in a closing schedule
const ASSOC = ['partnership.join_rule', 'partnership.profits_rule', 'partnership.assets_rule'];
const SKIP = (k, P) => k.startsWith('amendment.rules.') || (ASSOC.includes(k) && P.has('partnership.associations') && P.value('partnership.associations') === false);
// Modules as institutions a partner would recognise; the machinery is left out.
const INSTITUTION = { offices: 'Officers', elections: 'Elections', authority: 'Delegated powers', shares: 'Units', agreements: 'The partnership agreement',
  partnership: 'Certificates', meetings: 'Meetings', fund: 'The fund and its books', participation: 'Participation', invites: 'Invitations', details: 'Partner particulars',
  twofactor: 'Two-factor sign-in', polls: 'Polls', chat: 'Chat', docs: 'Shared documents', notify: 'Notifications', budget: 'Budget', wiki: 'Pages' };
const MACHINERY = new Set(['page', 'deliberation', 'titles', 'vocabulary', 'passwords', 'passkeys', 'finality', 'wiki', 'republic']);

// Plain titles for sections; anything not here is titled from its key.
const TITLE = {
  'entity.name': 'Name', 'entity.founded': 'Founded', 'entity.modules': 'Institutions', 'partnership.ein': 'Employer identification number',
  'partnership.office': 'Principal office', 'partnership.unit_class': 'Units of interest', 'partnership.associations': 'Associations',
  'partnership.certificates': 'Certificates', 'partnership.join_rule': 'Joining an association', 'partnership.profits_rule': 'Claims on profits',
  'partnership.assets_rule': 'Claims on assets', 'membership.admission': 'How partners are admitted', 'membership.admission_rule': 'Admitting a partner',
  'membership.removal_rule': 'Removing a partner', 'membership.transferable': 'Transferring a partnership interest', 'membership.recovery_rule': 'Replacing a lost key',
  'exit.unconditional': 'Leaving the partnership', 'invites.max_days': 'Invitations expire after', 'details.required': 'Particulars before admission',
  'details.tin': 'Taxpayer numbers', 'details.readers': 'Who reads particulars', 'participation.min_votes': 'Share of votes a partner must cast',
  'participation.window_votes': 'Votes counted toward standing', 'participation.min_meetings': 'Share of meetings a partner must attend', 'participation.window_meetings': 'Meetings counted toward standing',
  'participation.cure_days': 'Time to make up a shortfall', 'participation.grace_days': 'Grace period for new partners', 'decision.electorate': 'Who votes',
  'decision.referendum': 'Referendums', 'deliberation.period': 'How long a vote stays open', 'offices.create_rule': 'Creating an office',
  'offices.fill_rule': 'Appointing an officer', 'offices.term_limit': 'Term limit', 'elections.call_rule': 'Calling an election',
  'elections.incompatible': 'Offices one person may not hold together', 'authority.grant_rule': 'Delegating a power', 'authority.cosign_days': 'Time to co-sign',
  'fund.bookkeeper': 'Who keeps the books', 'fund.trade_rule': 'Buying or selling an investment', 'fund.books_rule': 'Recording on the books by resolution',
  'fund.withdraw_rule': 'Paying out a partner', 'fund.currency': 'Currency', 'fund.initial_unit_value': 'Value of a unit at the start',
  'fund.max_share': 'Most of the fund one partner may hold', 'fund.max_members': 'Most partners', 'fund.withdrawal_fee': 'Fee on a withdrawal',
  'fund.valuation_max_days': 'Prices may be no older than', 'shares.class_rule': 'Creating a class of units', 'shares.issue_rule': 'Issuing units',
  'shares.dividend_rule': 'Distributions', 'agreements.required': 'Documents every partner signs', 'agreements.drawn_signature': 'Drawn signatures',
  'agreements.amendments': 'When the agreement changes', 'agreements.enacted_only': 'Only enacted text is signed', 'wiki.enact_rule': 'Amending the agreement',
  'wiki.max_length': 'Longest text', 'meetings.call_rule': 'Calling a meeting', 'meetings.minutes_rule': 'Approving minutes',
  'meetings.checkin_hours': 'Check-in window', 'meetings.max_length': 'Longest minutes', 'records.sealing': 'Sealed records',
  'records.public': 'Public parts of the record', 'records.history': 'What a new partner can read', 'record.immutable': 'The record cannot be rewritten',
  'record.checkpoint_cosigners': 'Checkpoint co-signers', 'passwords.min_length': 'Shortest password', 'twofactor.require': 'Two-factor sign-in',
  'twofactor.code_minutes': 'A sign-in code lasts', 'titles.max_length': 'Longest name',
};
// Sections follow the order of TITLE above; others come after, by key.
const ORDER = Object.keys(TITLE);
const byOrder = (a, b) => { const x = ORDER.indexOf(a), y = ORDER.indexOf(b); return (x < 0 ? 1e9 : x) - (y < 0 ? 1e9 : y) || (a < b ? -1 : 1); };
const titleOf = (k) => TITLE[k] || k.split('.').pop().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// A rule in words: "a joint resolution: more than half of the partners and of the units, with half taking part".
const FRACTION = [[0.5, 'more than half'], [0.6, 'three-fifths'], [0.6666, 'two-thirds'], [0.67, 'two-thirds'], [0.75, 'three-quarters'], [0.8, 'four-fifths'], [1, 'everyone']];
const frac = (x) => FRACTION.find(([v]) => Math.abs(v - x) < 0.005)?.[1] || `${Math.round(x * 100)}%`;
const quorum = (x) => (x ? `${Math.round(x * 100)}% taking part` : 'no quorum');
function ruleWords(name) {
  const r = ctx.r.params.rules[name];
  if (!r) return name;
  if (r.changeable === false) return 'never: it cannot be changed';
  const who = r.concurrent ? 'of the partners and of the units' : 'of the partners voting';
  return `${frac(r.threshold)} ${who}, ${quorum(r.quorum)}${r.readings > 1 ? `, in ${r.readings} readings ${r.apart || 0} days apart` : ''}`;
}
const ruleName = (name) => `${name === 'joint-super' ? 'joint super-majority' : name} resolution`;
const aRule = (name) => `${/^[aeiou]/.test(ruleName(name)) ? 'an' : 'a'} ${ruleName(name)}`;
// Words for particular values.
const WORDS = {
  'membership.admission': { decision: 'By resolution of the partners, or by personal invitation', open: 'Anyone who applies is admitted' },
  'partnership.certificates': { own: 'Only the partner who holds it sees it', officers: 'The partner who holds it, and the officers' },
  'exit.unconditional': { true: 'Any partner may leave at any time; no rule can prevent it' },
  'membership.transferable': { false: 'No: an interest cannot be sold, given or inherited' },
  'agreements.drawn_signature': { required: 'Required: every partner draws their signature', optional: 'Optional', off: 'Not used' },
  'records.sealing': { true: 'Yes: only partners can read the record' },
  'records.history': { full: 'Everything, from the founding', 'from-join': 'Only what comes after they join' },
};

const MONEY = new Set(['fund.initial_unit_value']);
const PERCENT = new Set(['fund.max_share', 'fund.withdrawal_fee', 'finality.threshold', 'participation.min_meetings', 'participation.min_votes']);
function valueWords(k, d, v) {
  const w = WORDS[k]?.[String(v)];
  if (w) return w;
  if (d.type === 'rule' || (/_rule$/.test(k) && typeof v === 'string' && ctx.r.params.rules[v])) return [h('strong', {}, aRule(v)), `: ${ruleWords(v)}`];
  if (k === 'entity.modules') return v.filter(m => !MACHINERY.has(m)).map(m => INSTITUTION[m] || m).join(', ');
  if (/^participation\.window_/.test(k)) return `The last ${v}`;
  if (k === 'entity.founded') return short(v);
  if (k === 'fund.bookkeeper' || k === 'details.readers') return [].concat(v).map(o => ctx.r.state.m.offices?.[o]?.title || o).join(' and ') + (k === 'fund.bookkeeper' ? ' alone' : '');
  if (d.type === 'boolean') return v ? 'Yes' : 'No';
  if (MONEY.has(k)) return `$${(v / 100).toFixed(2)}`;
  if (PERCENT.has(k)) return `${Math.round(v * 1000) / 10}%`;
  if (/_days$/.test(k)) return `${v} day${v === 1 ? '' : 's'}`;
  if (/_hours$/.test(k)) return `${v} hour${v === 1 ? '' : 's'}`;
  if (/_minutes$/.test(k)) return `${v} minute${v === 1 ? '' : 's'}`;
  if (/_length$/.test(k)) return `${Number(v).toLocaleString()} characters`;
  if (Array.isArray(v)) return v.length ? v.map(x => (Array.isArray(x) ? x.join(' and ') : x)).join('; ') : 'None';
  if (v === '' || v === null || v === undefined) return 'Not set';
  return String(v);
}

function section(n, a, k) {
  const P = ctx.r.params, d = P.def(k), v = P.value(k), by = P.rule(k);
  return h('section', { class: 'c-sec', id: k },
    h('h3', {}, h('span', { class: 'c-num' }, `§ ${a}.${n}`), ' ', titleOf(k), '.'),
    h('p', { class: 'c-val' }, valueWords(k, d, v)),
    d.describe ? h('p', { class: 'c-why' }, d.describe) : null,
    h('p', { class: 'c-by' }, by.changeable === false ? 'Cannot be changed.' : `Changed by ${aRule(by.name)}.`, ' ', h('code', {}, k)));
}

function rulesTable() {
  const P = ctx.r.params, names = P.ruleOrder().filter(n => P.rules[n] && P.rules[n].changeable !== false);
  return h('section', { class: 'c-sec' },
    h('h3', {}, h('span', { class: 'c-num' }, '§ 3.0'), ' The kinds of resolution.'),
    h('p', { class: 'c-why' }, 'Every decision of the partners is one of these. A resolution passes when, by its deadline, its share of those voting is met and enough partners have taken part; a joint resolution must be met both by head and by units.'),
    h('table', { class: 'c-rules' }, h('thead', {}, h('tr', {}, ['Resolution', 'Passes with', 'Quorum', 'Counted by'].map(x => h('th', {}, x)))),
      h('tbody', {}, names.map(n => { const r = P.rules[n]; return h('tr', {}, h('td', {}, h('strong', {}, ruleName(n).replace(/ resolution$/, ''))), h('td', {}, frac(r.threshold)),
        h('td', {}, r.quorum ? `${Math.round(r.quorum * 100)}%` : 'none'), h('td', {}, r.concurrent ? 'partners and units' : 'partners')); }))));
}

function draw() {
  if (!ctx.r?.ok) { main.replaceChildren(blocked()); return; }
  const P = ctx.r.params, keys = P.keys().filter(k => !SKIP(k, P)).sort(byOrder);
  const byGroup = {}; for (const k of keys) (byGroup[P.def(k).group || 'Other'] ||= []).push(k);
  const placed = new Set(ARTICLES.flatMap(([, g]) => g).concat(SCHEDULE));
  const articles = [...ARTICLES, ...Object.keys(byGroup).filter(g => !placed.has(g)).map(g => [g, [g]])];
  const roman = (n) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'][n - 1] || String(n);
  let a = 0;
  const body = articles.map(([title, groups]) => {
    const ks = groups.flatMap(g => byGroup[g] || []);
    if (!ks.length) return null;
    a += 1;
    return h('article', { class: 'c-art', id: `article-${a}` }, h('h2', {}, h('span', {}, `Article ${roman(a)}`), title),
      title === 'Decisions' ? rulesTable() : null, ks.map((k, i) => section(i + 1, a, k)));
  }).filter(Boolean);
  const sched = SCHEDULE.flatMap(g => byGroup[g] || []);
  main.replaceChildren(h('div', { class: 'og-page constitution' },
    h('header', { class: 'c-head' }, h('p', { class: 'c-kicker' }, 'The settings in force'), h('h1', {}, `The Constitution of ${fullName()}`),
      h('p', { class: 'c-meta' }, `As it stands at record ${ctx.r.records.length}, ${short(ctx.r.state.head?.at)}, read and checked in this browser. Each section is a setting on the record; the partners change it by the resolution it names.`),
      h('nav', { class: 'c-toc', 'aria-label': 'Articles' }, body.map((el, i) => h('a', { href: `#article-${i + 1}` }, el.querySelector('h2').lastChild.textContent)))),
    body,
    sched.length ? h('article', { class: 'c-art' }, h('h2', {}, h('span', {}, 'Schedule'), 'Words and limits'), sched.map((k, i) => section(i + 1, 'S', k))) : null));
}
onChange(draw); onSigned(draw); draw();
