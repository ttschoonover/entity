// club.js · the partnership's home: the register of partners and units, the
// resolutions before the partners (each counted twice where the rule says so:
// by partners and by units), the associations and their claims, the officers,
// and applicants waiting to be admitted. Everything is computed in the reader's
// browser from the signed record.
import { start, ctx, h, $, me, sign, propose, displayName, nameOf, day, when, setting, W, onChange, onSigned, toast, fullName } from './common.js';

const main = $('#main');
await start();
const P = await import(new URL('modules/partnership/index.js', ctx.r.base).href);
const T = await import(new URL('modules/deliberation/count.js', ctx.r.base).href);
const st = () => ctx.r.state;
const UNIT = () => setting('partnership.unit_class', 'units');
const paint = (...k) => main.replaceChildren(...k.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
const pct = (x) => `${(x * 100).toFixed(x * 100 < 10 ? 1 : 0)}%`;
const active = () => Object.values(st().participants).filter(p => p.status === 'active');
const holders = () => st().m.shares?.classes?.[UNIT()]?.holders || {};
const total = () => Object.values(holders()).reduce((a, b) => a + b, 0);
const RULES = {
  ordinary: 'a majority of the partners voting',
  joint: 'a majority of the partners and a majority of the units',
  associate: '60% of the partners and 60% of the units',
  organic: 'two thirds of the partners voting',
  'joint-super': 'two thirds of the partners and two thirds of the units',
  constitutional: 'two thirds of the partners voting, with half of them voting',
  entrenched: 'three quarters of the partners voting',
};

function register() {
  const certs = P.certificates(ctx.r.records, UNIT()).filter(c => !c.cancelled);
  const certOf = Object.fromEntries(certs.map(c => [c.partner, c]));
  const t = total() || 1;
  const rows = active().map(p => ({ id: p.id, units: holders()[p.id] || 0 })).sort((a, b) => b.units - a.units);
  return h('section', { class: 'wide' }, h('h2', {}, 'The register of partners'),
    h('table', { class: 'register' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Partner'), h('th', { class: 'n' }, 'Units'), h('th', { class: 'n' }, 'Interest'), h('th', { class: 'n' }, 'Certificate'))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', {}, displayName(r.id)),
        h('td', { class: 'n' }, r.units.toLocaleString()),
        h('td', { class: 'n' }, pct(r.units / t), h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${100 * r.units / t}%` }))),
        h('td', { class: 'n' }, certOf[r.id] ? h('a', { href: `certificates.html#no-${certOf[r.id].number}` }, `No. ${certOf[r.id].number}`) : '—'))))));
}

function countBox(label, t, threshold, quorumNeeded, of) {
  const decisive = t.for + t.against, need = threshold * 100;
  const met = t.quorumMet && t.thresholdMet;
  return h('div', { class: `count${met ? ' met' : ''}` }, h('h4', {}, label),
    h('div', { class: 'tally', role: 'img', 'aria-label': `${label}: ${t.for} for, ${t.against} against, of ${of}` },
      h('span', { class: 'aye', style: `width:${of ? 100 * t.for / of : 0}%` }), h('span', { class: 'no', style: `width:${of ? 100 * t.against / of : 0}%` }),
      ),
    h('p', {}, `${t.for} for, ${t.against} against${t.abstain ? `, ${t.abstain} abstaining` : ''} of ${of}${decisive ? ` · ${pct(t.for / decisive)} in favour` : ''} · ${t.cast} of ${quorumNeeded} needed to vote`));
}
function resolutions() {
  const open = Object.values(st().proposals).filter(p => !p.closed).sort((a, b) => (a.at < b.at ? 1 : -1));
  const mine = me()?.status === 'active' ? ctx.ident.id : null;
  return h('section', { class: 'wide' }, h('h2', {}, 'Resolutions before the partners'),
    open.length ? open.map(p => {
      const t = T.tallyOf(p), rule = ctx.r.params.rules[p.rule] || {};
      const voted = mine && p.ballots.filter(b => b.by === mine).at(-1)?.choice;
      const cast = (choice) => sign('ballot.cast', { proposal: p.id, choice }, `Your vote ${choice} "${p.title}"`);
      return h('article', { class: 'resolution' },
        h('h3', {}, p.title),
        h('p', { class: 'meta' }, `${p.rule} rule: ${RULES[p.rule] || p.rule} · moved by ${nameOf(p.by)} · closes ${day(p.deadline)}`),
        p.text ? h('p', { class: 'serif' }, p.text) : null,
        h('div', { class: 'counts' },
          countBox('Partners', t, rule.threshold, t.quorumNeeded, t.electorate),
          t.concurrent ? countBox('Units', t.concurrent, rule.threshold, t.concurrent.quorumNeeded, t.concurrent.electorate_total) : null),
        mine && p.roll.includes(mine) ? h('div', { class: 'row' },
          h('button', { class: voted === 'for' ? 'primary' : 'secondary', onclick: () => cast('for') }, 'For'),
          h('button', { class: voted === 'against' ? 'primary' : 'secondary', onclick: () => cast('against') }, 'Against'),
          h('button', { class: 'linklike', onclick: () => cast('abstain') }, 'Abstain'),
          voted ? h('span', { class: 'fine' }, ` You voted ${voted}; you can change it until it closes.`) : null) : null);
    }) : h('p', { class: 'hint' }, 'Nothing is before the partners.'));
}

function associations() {
  const all = Object.values(st().m.partnership?.associations || {}).filter(a => !a.left);
  const can = me()?.status === 'active';
  const bp = (x) => `${(x / 100).toFixed(2)}%`;
  const sec = h('section', {}, h('h2', {}, 'Associations'),
    all.length ? all.map(a => h('div', { class: 'assoc' }, h('h3', {}, a.name), h('p', { class: 'fine' }, `${a.id} · joined ${day(a.joined)}`),
      P.liveClaims(a).length ? h('ul', {}, P.liveClaims(a).map(c => h('li', {}, `${bp(c.share)} of ${c.on === 'assets' ? 'net assets' : 'profits'}${c.cap ? `, up to $${(c.cap / 100).toLocaleString()}` : ''} (claim ${c.id}, since ${day(c.since)}) `,
        can ? h('button', { class: 'linklike', onclick: () => propose(`End ${a.name}'s claim ${c.id}`, [{ kind: 'partnership.release', association: a.id, claim: c.id, on: c.on }]) }, 'Propose ending it') : null))) : h('p', { class: 'fine' }, 'No claims on the partnership.'),
      h('details', {}, h('summary', { class: 'fine' }, 'Terms of membership'), h('p', { class: 'terms' }, a.terms)),
      can && !P.liveClaims(a).length ? h('button', { class: 'linklike', onclick: () => propose(`Leave ${a.name}`, [{ kind: 'partnership.leave', association: a.id }]) }, 'Propose leaving') : null))
      : h('p', { class: 'hint' }, 'The partnership belongs to no association.'),
    h('p', { class: 'fine' }, `Joining needs ${RULES[setting('partnership.join_rule', 'associate')]}; a claim on profits, ${RULES[setting('partnership.profits_rule', 'joint')]}; a claim on assets, ${RULES[setting('partnership.assets_rule', 'joint-super')]}.`));
  if (!can) return sec;
  sec.append(h('details', { class: 'form-box' }, h('summary', {}, 'Propose joining an association'),
    h('label', { for: 'as-name' }, 'Name'), h('input', { id: 'as-name', placeholder: 'Bay Area Investment Clubs' }),
    h('label', { for: 'as-id' }, 'Short name'), h('input', { id: 'as-id', placeholder: 'bay-clubs' }),
    h('label', { for: 'as-terms' }, 'Its terms of membership: what it may ask of the partnership'), h('textarea', { id: 'as-terms', rows: 5 }),
    h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => {
      const name = $('#as-name').value.trim(), id = ($('#as-id').value.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 40), terms = $('#as-terms').value.trim();
      if (!name || !terms) return toast('Give its name and its terms.', true);
      propose(`Join ${name}`, [{ kind: 'partnership.join', association: id, name, terms }]);
    } }, 'Propose it'))));
  if (all.length) sec.append(h('details', { class: 'form-box' }, h('summary', {}, 'Propose granting a claim'),
    h('label', { for: 'cl-a' }, 'Association'), h('select', { id: 'cl-a' }, all.map(a => h('option', { value: a.id }, a.name))),
    h('label', { for: 'cl-on' }, 'On'), h('select', { id: 'cl-on' }, h('option', { value: 'profits' }, 'profits (a share of each distribution of profits)'), h('option', { value: 'assets' }, 'assets (a share of net assets, on distribution or dissolution)')),
    h('label', { for: 'cl-share' }, 'Share, in per cent'), h('input', { id: 'cl-share', type: 'number', min: 0.01, max: 100, step: 0.01 }),
    h('label', { for: 'cl-cap' }, 'Cap, in dollars (claims on assets only; optional)'), h('input', { id: 'cl-cap', type: 'number', min: 1, step: 1 }),
    h('label', { for: 'cl-terms' }, 'Terms of the claim'), h('textarea', { id: 'cl-terms', rows: 3 }),
    h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => {
      const a = $('#cl-a').value, on = $('#cl-on').value, share = Math.round(Number($('#cl-share').value) * 100), cap = $('#cl-cap').value ? Math.round(Number($('#cl-cap').value) * 100) : undefined;
      if (!(share >= 1 && share <= 10000)) return toast('A share is between 0.01% and 100%.', true);
      const claim = `${on}-${Date.now().toString(36)}`;
      propose(`Grant ${st().m.partnership.associations[a].name} ${(share / 100).toFixed(2)}% of the partnership's ${on === 'assets' ? 'net assets' : 'profits'}`,
        [{ kind: 'partnership.claim', association: a, claim, on, share, ...(on === 'assets' && cap ? { cap } : {}), ...($('#cl-terms').value.trim() ? { terms: $('#cl-terms').value.trim() } : {}) }]);
    } }, 'Propose it'))));
  return sec;
}

function officers() {
  const offices = Object.values(st().m.offices || {}).filter(o => !o.abolished);
  const now = new Date().toISOString();
  const elections = Object.values(st().m.elections || {}).filter(e => !e.counted);
  return h('section', {}, h('h2', {}, 'Officers'),
    h('ul', { class: 'roll' }, offices.map(o => {
      const holders = o.holders.filter(x => !x.until || x.until > now).map(x => nameOf(x.id));
      const el = elections.find(e => e.office === o.id);
      return h('li', {}, h('strong', {}, o.title), ': ', holders.length ? holders.join(', ') : h('em', {}, 'vacant'),
        el ? h('span', { class: 'fine' }, ` · election ${now <= el.standUntil ? `open for candidates until ${day(el.standUntil)}` : `voting until ${day(el.voteUntil)}`} · `, h('a', { href: `hall.html#/elections/${el.id}` }, 'stand or vote')) : null);
    })),
    h('p', { class: 'fine' }, 'Each office has its own election, and nobody may hold two of them. The Audit Committee alone signs the checkpoints that make the record final.'));
}

function applicants() {
  const list = Object.values(st().participants).filter(p => p.status === 'applicant');
  if (!list.length) return null;
  const signed = (id) => !!st().m.agreements?.[id]?.['partnership-agreement']?.length;
  return h('section', {}, h('h2', {}, 'Applicants'),
    h('ul', { class: 'roll' }, list.map(p => h('li', {}, displayName(p.id), signed(p.id) ? ' · has signed the agreement ' : ' · has not signed the agreement yet ',
      me()?.status === 'active' && signed(p.id) ? h('button', { class: 'linklike', onclick: () => sign('proposal.lay', { title: `Admit ${nameOf(p.id)} as a partner`, rule: setting('membership.admission_rule', 'joint'), admit: [p.id], effects: [] }, `Propose admitting ${nameOf(p.id)}`) }, 'Propose admitting') : null))),
    h('p', { class: 'fine' }, `Admission needs ${RULES[setting('membership.admission_rule', 'joint')]}. Units for their contribution are issued by a separate resolution.`));
}

function draw() {
  if (!ctx.r?.ok) return;
  const assocCount = Object.values(st().m.partnership?.associations || {}).filter(a => !a.left).length;
  paint(
    h('div', { class: 'club-hero' },
      h('div', {}, h('h1', {}, fullName()), h('p', { class: 'form' }, 'A California general partnership')),
      h('dl', { class: 'figures' },
        h('div', {}, h('dt', {}, 'Partners'), h('dd', {}, String(active().length))),
        h('div', {}, h('dt', {}, 'Units'), h('dd', {}, total().toLocaleString())),
        h('div', {}, h('dt', {}, 'Associations'), h('dd', {}, String(assocCount))))),
    h('div', { class: 'club-grid' }, register(), resolutions(), associations(), h('div', {}, officers(), applicants())));
}
onChange(draw); onSigned(draw); draw();
