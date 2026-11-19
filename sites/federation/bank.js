// bank.js · the Federal Bank: the committee that issues the federal currency
// into its reserve and destroys currency held there. A member moves to issue
// or to destroy an amount; the motion carries when enough members have voted
// for it (the committee's rule: with two members, both), and lapses if they
// have not within authority.cosign_days. Every motion and vote is signed on
// the federation's record, and so is what it did.
//
// The bank is set up by make-federal-bank.sh: the committee federal-bank, and
// two grants of power, bank-issue (value.issue into committee:federal-bank)
// and bank-destroy (value.revoke from it).
import { start, ctx, h, $, me, sign, displayName, nameOf, day, when, setting, W, toast, onChange, onSigned } from './common.js';

const BANK = 'federal-bank', ACCOUNT = `committee:${BANK}`, ISSUE = 'bank-issue', DESTROY = 'bank-destroy';
const main = $('#main');
await start();
const st = () => ctx.r.state;
const dec = () => setting('value.decimals', 0);
const unit = () => setting('value.name', 'units');
const fmt = (n) => (n / 10 ** dec()).toLocaleString(undefined, { minimumFractionDigits: dec(), maximumFractionDigits: dec() });
const money = (n) => `${fmt(n)} ${unit()}`;
const paint = (...k) => main.replaceChildren(...k.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));

function members(c, at) { return (c?.members || []).filter(m => !m.until || m.until > at).map(m => m.id); }
function needed(c, n) { const r = c?.needs ?? 'majority'; return r === 'all' ? n : r === 'majority' ? Math.floor(n / 2) + 1 : Math.min(Number(r), n); }
const what = (x) => {
  const e = x.effects[0];
  return e.kind === 'value.issue' ? `Issue ${money(e.amount)} into the reserve` : e.kind === 'value.revoke' ? `Destroy ${money(e.amount)} from the reserve` : e.kind === 'value.pay' ? `Pay ${money(e.amount)} to ${nameOf(e.to)}` : e.kind;
};

function draw() {
  const s = st(), c = s.m.committees?.[BANK], at = new Date().toISOString();
  const grants = s.m.authority?.grants || {};
  if (!c || c.dissolved || !grants[ISSUE]) {
    return paint(h('div', { class: 'bank-head' }, h('h1', {}, 'The Federal Bank'),
      h('p', { class: 'lede' }, `The Federal Bank has not been created yet. ${W().body[0].toUpperCase()}${W().body.slice(1)} creates it by decision: the committee federal-bank, with the power to issue currency into its reserve and to destroy currency held there (make-federal-bank.sh).`)));
  }
  const who = members(c, at), need = needed(c, who.length), mine = me()?.status === 'active' && who.includes(ctx.ident.id);
  const reserve = s.m.value?.balances?.[ACCOUNT] || 0, supply = s.m.value?.supply || 0;
  const xs = Object.values(s.m.authority?.exercises || {}).filter(x => x.grant === ISSUE || x.grant === DESTROY || grants[x.grant]?.to?.committee === BANK)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const open = xs.filter(x => !x.enacted && at <= x.expires), done = xs.filter(x => x.enacted || at > x.expires);
  const vote = (x) => sign('authority.cosign', { exercise: x.id }, `Your vote for: ${what(x)}`);
  const card = (x) => {
    const passed = !!x.enacted, lapsed = !passed && at > x.expires;
    const signed = new Set(x.signers);
    return h('article', { class: `motion${passed ? ' passed' : lapsed ? ' lapsed' : ''}` },
      h('h3', {}, what(x)),
      h('p', { class: 'meta' }, `Moved by ${nameOf(x.by)}, ${when(x.at)} · `, passed ? `carried ${when(x.enacted)}` : lapsed ? `lapsed ${day(x.expires)}` : `${x.signers.length} of ${x.needs} votes · open until ${day(x.expires)}`),
      x.note ? h('p', { class: 'why' }, x.note) : (x.effects[0].memo ? h('p', { class: 'why' }, x.effects[0].memo) : null),
      h('ul', { class: 'ballots' }, who.map(m => h('li', { class: signed.has(m) ? 'yes' : 'wait' }, `${nameOf(m)}${signed.has(m) ? '' : passed || lapsed ? ': did not vote' : ': to vote'}`))),
      !passed && !lapsed && mine && !signed.has(ctx.ident.id) ? h('button', { class: 'primary', onclick: () => vote(x) }, 'Vote for') : null);
  };
  const move = mine ? h('form', { class: 'move', onsubmit: async (ev) => {
    ev.preventDefault();
    const kind = $('input[name=bk-kind]:checked').value, amt = Math.round(Number($('#bk-amount').value) * 10 ** dec()), why = $('#bk-why').value.trim();
    if (!Number.isSafeInteger(amt) || amt <= 0) return toast('Give an amount above zero.', true);
    if (kind === 'destroy' && amt > reserve) return toast(`The reserve holds only ${money(reserve)}.`, true);
    const effect = kind === 'issue' ? { kind: 'value.issue', to: ACCOUNT, amount: amt, ...(why ? { memo: why.slice(0, 200) } : {}) } : { kind: 'value.revoke', from: ACCOUNT, amount: amt, ...(why ? { memo: why.slice(0, 200) } : {}) };
    const ok = await sign('authority.exercise', { grant: kind === 'issue' ? ISSUE : DESTROY, effects: [effect], ...(why ? { note: why.slice(0, 1000) } : {}) },
      `Your motion: ${kind === 'issue' ? 'issue' : 'destroy'} ${money(amt)}${need > 1 ? `. It carries when ${need} members have voted for it.` : ''}`);
    if (ok) $('#bk-amount').value = '';
  } },
    h('h2', {}, 'Move'),
    h('div', { class: 'kinds', role: 'radiogroup', 'aria-label': 'What to move' },
      h('label', {}, h('input', { type: 'radio', name: 'bk-kind', value: 'issue', checked: true }), `Issue new ${unit()} into the reserve`),
      h('label', {}, h('input', { type: 'radio', name: 'bk-kind', value: 'destroy' }), `Destroy ${unit()} held in the reserve`)),
    h('label', { for: 'bk-amount' }, `Amount, in ${unit()}`), h('input', { id: 'bk-amount', type: 'number', min: 1 / 10 ** dec(), step: 1 / 10 ** dec(), required: true }),
    h('label', { for: 'bk-why' }, 'Reason (published with the motion)'), h('textarea', { id: 'bk-why', rows: 3, maxlength: 1000 }),
    h('div', { class: 'buttons' }, h('button', { class: 'primary', type: 'submit' }, 'Sign the motion')),
    h('p', { class: 'fine' }, need > 1 ? `Your signature is your vote for it. It carries once ${need} of the ${who.length} members have voted for it.` : 'It takes effect as soon as you sign it.')) : null;

  paint(
    h('div', { class: 'bank-head' }, h('h1', {}, 'The Federal Bank'),
      h('p', { class: 'lede' }, `A committee of ${who.map(nameOf).join(' and ') || 'nobody yet'}. It issues the ${unit()} of ${W().body} into its reserve, and destroys ${unit()} held there, only when ${need === who.length ? (who.length === 2 ? 'both members vote' : 'every member votes') : `${need} of its ${who.length} members vote`} for it. Every motion and every vote is signed on the public record.`)),
    h('section', { class: 'reserve', 'aria-label': 'The money supply' }, h('dl', {},
      h('div', {}, h('dt', {}, 'Held in the reserve'), h('dd', {}, fmt(reserve), h('small', {}, unit()))),
      h('div', {}, h('dt', {}, 'In circulation'), h('dd', {}, fmt(supply - reserve), h('small', {}, unit()))),
      h('div', {}, h('dt', {}, 'Total in existence'), h('dd', {}, fmt(supply), h('small', {}, unit()))))),
    h('div', { class: 'bank-cols' },
      h('section', {}, h('h2', {}, 'Motions before the bank'),
        open.length ? open.map(card) : h('p', { class: 'hint' }, mine ? 'Nothing is before the bank. Move to issue or destroy.' : 'Nothing is before the bank.'),
        done.length ? [h('h2', { style: 'margin-top:2rem' }, 'Decided'), done.slice(0, 12).map(card)] : null),
      h('aside', {}, move,
        h('h2', { style: 'margin-top:1.6rem' }, 'Members'),
        h('ul', { class: 'members' }, who.map(m => h('li', {}, displayName(m)))),
        h('p', { class: 'fine' }, `The members are appointed and removed by ${W().body}’s decision; it can also undo any act of the bank, or take its powers away.`),
        !ctx.ident ? h('p', { class: 'fine' }, 'Members: sign in to move and vote.') : null)));
}
onChange(draw); onSigned(draw);
draw();
