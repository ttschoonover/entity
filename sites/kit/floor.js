// floor.js · what is open for a vote, as cards with the count so far and
// buttons to vote: the same on every site's home page. Ballots are signed in
// the page with the member's own key; a later ballot replaces an earlier one.
import { ctx, h, me, sign, day, W, entity, withEntity } from './common.js';

const notes = {}; // what the page last said under each card, kept across redraws

// The majority a rule needs, in words, from the rule as it stands.
export function majority(name, rr = ctx.r) {
  const r = rr.params.rules[name]; if (!r) return `the ${name} majority`;
  const f = (x) => ({ 0.5: 'a majority', 0.6: 'three-fifths', 0.66: 'two-thirds', 0.67: 'two-thirds', 0.75: 'three-quarters', 1: 'everyone' }[x] || `${Math.round(x * 100)}%`);
  return `${f(r.threshold)} of votes cast${r.quorum ? `, with ${Math.round(r.quorum * 100)}% voting` : ''}`;
}

// key: draw another entity's open votes (on a site that shows several); a vote
// is then signed with the member's key in that entity and sent to its node.
export function drawOpen(box, { empty, key } = {}) {
  const x = key ? entity(key) : null;
  const r = x ? x.r : ctx.r, w = W();
  const who = x ? (x.ident && r.state.participants[x.ident.id]) || null : me();
  const open = r.get('proposals');
  if (!open.length) { box.replaceChildren(h('p', { class: 'empty' }, empty || `Nothing is open for a vote. Any of the ${w.many} can propose something.`)); return; }
  box.replaceChildren(...open.map(b => {
    const p = r.state.proposals[b.id] || {}, roll = p.roll || [];
    const total = b.for + b.against + b.abstain || 1;
    const late = r.get('members').filter(m => !roll.includes(m.id)).length;
    const status = h('p', { class: 'status', role: 'status' }, notes[b.id] || '');
    const vote = async (choice) => {
      const say = (t) => { notes[b.id] = t; status.textContent = t; };
      say('Waiting for your signature…');
      const doIt = () => sign('ballot.cast', { proposal: b.id, choice }, `Your vote ${choice === 'abstain' ? 'to abstain on' : choice} "${b.title}"`);
      const ok = x ? await withEntity(key, doIt) : await doIt();
      say(ok ? `${choice === 'abstain' ? 'You abstained' : `You voted ${choice}`}. You can change this until it closes.` : 'Not signed.');
    };
    const mine = who && roll.includes(who.id);
    return h('article', { class: 'bill-card' },
      h('h3', {}, b.title),
      p.text ? h('p', { class: 'text' }, p.text) : null,
      h('p', { class: 'when' }, `Closes ${day(b.closes)}${b.rule !== 'ordinary' ? ` · needs ${majority(b.rule, r)}` : ''}`),
      h('div', { class: 'tally', 'aria-hidden': 'true' },
        h('span', { class: 'aye', style: `width:${100 * b.for / total}%` }), h('span', { class: 'abstain', style: `width:${100 * b.abstain / total}%` }), h('span', { class: 'no', style: `width:${100 * b.against / total}%` })),
      h('p', { class: 'counts' }, h('span', {}, h('b', {}, String(b.for)), ' for'), h('span', {}, h('b', {}, String(b.against)), ' against'), h('span', {}, h('b', {}, String(b.abstain)), ' abstaining'), h('span', {}, 'of ', h('b', {}, String(roll.length)), ' on the roll')),
      late ? h('p', { class: 'when' }, `${late === 1 ? `One of the ${w.many}` : `${late} ${w.many}`} joined after this opened and can vote from the next one.`) : null,
      !who || mine ? h('div', { class: 'vote', role: 'group', 'aria-label': `Your vote on ${b.title}` },
        h('button', { type: 'button', onclick: () => vote('for') }, 'Vote for'), h('button', { type: 'button', onclick: () => vote('against') }, 'Vote against'), h('button', { type: 'button', onclick: () => vote('abstain') }, 'Abstain')) : null,
      status);
  }));
}
