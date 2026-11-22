// The Partner details tab. A partner gives or corrects their particulars; the
// officers who keep them (details.readers) read them, export them for the
// returns and registrations, and share them with a new officer. Everything is
// sealed and opened in this browser (kernel/details.js); the node keeps only
// ciphertext, off the record.
import * as D from '../../kernel/details.js';
import { b64 } from '../../kernel/crypto.js';
import { readers as readerIds } from './index.js';

async function ask(api, key, body) {
  const full = { entity: api.state.entity.id, member: api.me.id, at: new Date().toISOString(), ...body };
  const signature = await api.E.keys.sign(D.requestMessage(full), key, D.REQUEST_NAMESPACE);
  const r = await fetch('auth/details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: full, signature }) });
  const j = await r.json().catch(() => ({ why: `the node answered ${r.status}` }));
  if (!r.ok) throw new Error(j.why || `the node answered ${r.status}`);
  return j;
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export default function render(api) {
  const { h, state, me, who, when } = api;
  const tin = !api.params?.has?.('details.tin') || api.params.value('details.tin') !== false;
  const sec = h('section', {}, h('h2', {}, 'Partner details'),
    h('p', { class: 'hint' }, (tin ? 'What the law asks the partnership to know about each partner: for each partner’s Schedule K-1, the fictitious business name statement and the partnership’s accounts.' : 'What the partnership needs to know about each partner: for its accounts and registrations. It asks for no taxpayer number.') + ' Encrypted in your browser to you and to the officers who keep them, and stored off the record. Nobody else, not even the server, can read them.'));
  if (!me || !['active', 'applicant'].includes(me.status)) return sec;
  const mine = D.fieldsFor({ tin }), out = h('p', { class: 'fine', 'aria-live': 'polite' });
  const say = (t, bad) => { out.textContent = t; out.className = bad ? 'flag' : 'fine'; };
  const filed = state.m.details?.[me.id];
  const form = h('div', { class: 'inline-form' }, mine.map(([k, label, req]) =>
    k === 'tax_status' ? [h('label', { for: `dt-${k}` }, label), h('select', { id: `dt-${k}` }, h('option', { value: 'us-person' }, 'U.S. person (citizen or resident): Form W-9'), h('option', { value: 'foreign-person' }, 'Foreign person: Form W-8BEN'))]
    : k === 'tin_type' ? [h('label', { for: `dt-${k}` }, label), h('select', { id: `dt-${k}` }, ['SSN', 'ITIN', 'foreign TIN'].map(x => h('option', { value: x }, x)))]
    : k === 'certified' ? h('label', { class: 'check' }, h('input', { id: `dt-${k}`, type: 'checkbox' }), ' I certify, under penalties of perjury, that the number above is my correct taxpayer identification number; that I am not subject to backup withholding; that I am a U.S. person (if I chose U.S. person); and that I am exempt from FATCA reporting. (A foreign person gives the Treasurer a signed Form W-8BEN instead.)')
    : [h('label', { for: `dt-${k}` }, `${label}${req ? '' : ' (optional)'}`), h(k === 'residence' || k === 'mailing' ? 'textarea' : 'input', { id: `dt-${k}`, autocomplete: 'off', rows: 2, type: k === 'date_of_birth' ? 'date' : 'text' })]));
  const fields = () => Object.fromEntries(mine.map(([k]) => [k, k === 'certified' ? document.getElementById(`dt-${k}`).checked : document.getElementById(`dt-${k}`).value.trim()]));
  const fill = (f) => { for (const [k] of mine) { const el = document.getElementById(`dt-${k}`); if (!el || f[k] === undefined) continue; if (k === 'certified') el.checked = !!f[k]; else el.value = f[k]; } };
  sec.append(h('h3', {}, 'Yours'), h('p', {}, filed ? `Given ${when(filed.at)}. Open them to read or correct them.` : 'Not given yet.'),
    h('div', { class: 'buttons' }, filed ? h('button', { class: 'quiet', onclick: async () => {
      try { const key = await api.key('Opening your particulars'); if (!key) return; const sk = await api.E.sealing.memberSecret(state, me.id, key.seed);
        const r = await ask(api, key, { op: 'mine' }); if (!r.blob) return say('The node holds none for you: give them again.', true); fill(await D.openDetails(r.blob, me.id, sk)); say('Opened here. Correct anything and save.'); } catch (e) { say(e.message, true); } } }, 'Open mine') : null),
    form,
    h('div', { class: 'buttons' }, h('button', { onclick: async () => {
      const f = fields(), bad = D.problems(f, { tin }); if (bad.length) return say(bad.join('; '), true);
      try {
        const key = await api.key('Sealing your particulars'); if (!key) return;
        // Sealed to your record key as published (a password's own key may differ: see member.keywrap).
        const mineKey = state.sealing?.keys?.[me.id] || b64((await api.E.sealing.recordKeyFromSeed(key.seed)).pk);
        const { readers } = await ask(api, key, { op: 'readers' });
        const blob = await D.sealDetails({ entity: state.entity.id, member: me.id }, f, [{ id: me.id, key: mineKey }, ...readers.filter(r => r.id !== me.id)]);
        const r = await ask(api, key, { op: 'file', blob });
        if (filed?.digest !== r.digest) api.sign('details.filed', { digest: r.digest }, 'That you have given your particulars');
        say(`Sealed to you${readers.length ? ` and ${readers.map(r => api.nameOf ? api.nameOf(r.id) : r.id).join(', ')}` : ''}.`);
      } catch (e) { say(e.message, true); }
    } }, filed ? 'Save my corrections' : 'Seal and give my particulars')), out);

  // The officers who keep them.
  const at = new Date().toISOString(), isReader = me.status === 'active' && readerIds(state, api.params, at).includes(me.id);
  if (!isReader) return sec;
  const active = Object.values(state.participants).filter(p => p.status === 'active' || p.status === 'applicant');
  const missing = active.filter(p => !state.m.details?.[p.id]);
  const table = h('div');
  let opened = [];
  sec.append(h('h3', {}, 'Every partner’s'),
    h('p', { class: 'hint' }, missing.length ? ['Not given yet: ', ...missing.flatMap((p, i) => [i ? ', ' : '', who(p.id)])] : 'Every partner has given theirs.'),
    h('div', { class: 'buttons' },
      h('button', { class: 'quiet', onclick: async () => {
        try {
          const key = await api.key('Opening partners’ particulars'); if (!key) return; const sk = await api.E.sealing.memberSecret(state, me.id, key.seed);
          const { blobs } = await ask(api, key, { op: 'list' });
          opened = [];
          for (const b of blobs) { try { opened.push({ member: b.member, ...(await D.openDetails(b, me.id, sk)) }); } catch { opened.push({ member: b.member, legal_name: '(not shared with you yet)' }); } }
          table.replaceChildren(h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Partner', 'Legal name', 'Born', 'Residence', 'Tax status', ...(tin ? ['TIN'] : [])].map(x => h('th', {}, x)))),
            h('tbody', {}, opened.map(o => h('tr', {}, h('td', {}, who(o.member)), h('td', {}, o.legal_name || ''), h('td', {}, o.date_of_birth || ''), h('td', {}, o.residence || ''), h('td', {}, `${o.tax_status || ''} ${tin ? o.tin_type || '' : ''}`), tin ? h('td', { class: 'hash' }, o.tin ? `•••-••-${String(o.tin).slice(-4)}` : '') : null))))));
          say(`${opened.length} opened in this browser.`);
        } catch (e) { say(e.message, true); }
      } }, 'Open them'),
      h('button', { class: 'quiet', onclick: () => {
        if (!opened.length) return say('Open them first.', true);
        const cols = ['member', ...mine.map(([k]) => k)];
        const csv = [cols.join(','), ...opened.map(o => cols.map(c => csvCell(o[c])).join(','))].join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'partner-particulars.csv'; a.click();
        say('Downloaded. It is not encrypted: keep it safe and delete it once the returns are filed.');
      } }, 'Download for the returns (CSV)'),
      h('button', { class: 'quiet', onclick: async () => {
        try {
          const key = await api.key('Sharing particulars with the other officers'); if (!key) return; const sk = await api.E.sealing.memberSecret(state, me.id, key.seed);
          const [{ blobs }, { readers }] = [await ask(api, key, { op: 'list' }), await ask(api, key, { op: 'readers' })];
          const out2 = [];
          for (const b of blobs) { const add = readers.filter(r => !b.wraps[r.id]); if (add.length && b.wraps[me.id]) out2.push(await D.rewrap(b, me.id, sk, add)); }
          if (!out2.length) return say('Every officer can already read every partner’s particulars you can.');
          const r = await ask(api, key, { op: 'share', blobs: out2 });
          say(`Shared ${r.shared} partner’s particulars with the current officers.`);
        } catch (e) { say(e.message, true); }
      } }, 'Share with new officers')),
    table);
  return sec;
}
