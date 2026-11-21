// The partnership tab on the standard page: associations and their claims,
// and the partnership certificates read from the record.
import { liveClaims, certificates } from './index.js';

const pct = (bp) => `${(bp / 100).toFixed(2)}%`;
// Everyone now in an office, with the drawn signature they signed the agreement with.
function officersNow(state, at) {
  const out = [];
  for (const o of Object.values(state.m.offices || {})) if (!o.abolished) for (const x of o.holders || []) if (!x.until || x.until > at) out.push({ id: x.id, office: o.title });
  return out.map(o => {
    let best = null;
    for (const sigs of Object.values(state.m.agreements?.[o.id] || {})) for (const s of sigs) if (s.drawing && (!best || s.at > best.at)) best = s;
    return { ...o, drawing: best?.drawing || null };
  });
}
function certificate(api, c, officers) {
  const { h, day, state } = api, name = api.params.value('entity.name');
  const pct = c.outstanding ? ` of ${c.outstanding} (${(100 * c.units / c.outstanding).toFixed(2)}%)` : '';
  const nm = (id) => (api.nameOf ? api.nameOf(id) : id);
  return h('article', { class: 'card certificate' },
    h('p', { class: 'meta' }, `Certificate No. ${c.number} · ${c.units} units`),
    h('h3', { class: 'read' }, name),
    h('p', { class: 'read' }, 'This certifies that ', h('strong', {}, nm(c.partner)), ` is a partner holding ${c.units} units${pct} on ${day(c.issued)}.`),
    h('div', { class: 'cert-sigs' }, officers.length ? officers.map(o => h('figure', {},
      o.drawing ? h('img', { src: o.drawing, alt: `Signature of ${nm(o.id)}` }) : h('span', { class: 'read' }, `/s/ ${nm(o.id)}`),
      h('figcaption', {}, nm(o.id), h('br'), h('small', {}, o.office)))) : h('p', { class: 'fine' }, 'No officer in office yet.')),
    h('p', { class: 'fine' }, `Evidence of units only: not a security, not negotiable, transferable to no one. Record ${c.seq}, ${c.record.slice(0, 12)}.`),
    h('div', { class: 'buttons' }, h('a', { class: 'button quiet', href: `documents/certificate/${c.number}.pdf`, target: '_blank', rel: 'noopener' }, 'PDF')));
}
function view(api) {
  const { h, state, day, who } = api;
  const assoc = Object.values(state.m.partnership?.associations || {});
  const certs = api.records ? certificates(api.records, api.params?.value?.('partnership.unit_class') || 'units') : [];
  const officers = officersNow(state, new Date().toISOString());
  return h('section', {}, h('h2', {}, 'Partnership'),
    h('h3', {}, 'Associations'),
    assoc.length ? h('ul', {}, assoc.map(a => h('li', {}, h('strong', {}, a.name), ` (${a.id}) · joined ${day(a.joined)}${a.left ? ` · left ${day(a.left)}` : ''}`,
      liveClaims(a).length ? h('ul', {}, liveClaims(a).map(c => h('li', {}, `claim ${c.id}: ${pct(c.share)} of ${c.on === 'assets' ? 'net assets' : 'profits'}${c.cap ? `, up to ${(c.cap / 100).toFixed(2)}` : ''}, since ${day(c.since)}`))) : null)))
      : h('p', { class: 'hint' }, 'The partnership belongs to no association.'),
    h('h3', {}, 'Certificates in force'),
    h('p', { class: 'hint' }, 'Each partner’s certificate, signed by the officers in office. Download one as a PDF set in LaTeX.'),
    certs.filter(c => !c.cancelled).length ? h('div', { class: 'cards' }, certs.filter(c => !c.cancelled).map(c => certificate(api, c, officers)))
      : h('p', { class: 'hint' }, 'None yet.'));
}
export const tabs = [{ id: 'partnership', title: 'Partnership', render: (api) => view(api) }];
