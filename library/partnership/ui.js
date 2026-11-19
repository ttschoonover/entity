// The partnership tab on the standard page: associations and their claims,
// and the partnership certificates read from the record.
import { liveClaims, certificates } from './index.js';

const pct = (bp) => `${(bp / 100).toFixed(2)}%`;
function view(api) {
  const { h, state, day, who } = api;
  const assoc = Object.values(state.m.partnership?.associations || {});
  const certs = api.records ? certificates(api.records, api.params?.value?.('partnership.unit_class') || 'units') : [];
  return h('section', {}, h('h2', {}, 'Partnership'),
    h('h3', {}, 'Associations'),
    assoc.length ? h('ul', {}, assoc.map(a => h('li', {}, h('strong', {}, a.name), ` (${a.id}) · joined ${day(a.joined)}${a.left ? ` · left ${day(a.left)}` : ''}`,
      liveClaims(a).length ? h('ul', {}, liveClaims(a).map(c => h('li', {}, `claim ${c.id}: ${pct(c.share)} of ${c.on === 'assets' ? 'net assets' : 'profits'}${c.cap ? `, up to ${(c.cap / 100).toFixed(2)}` : ''}, since ${day(c.since)}`))) : null)))
      : h('p', { class: 'hint' }, 'The partnership belongs to no association.'),
    h('h3', {}, 'Certificates in force'),
    certs.filter(c => !c.cancelled).length ? h('ul', {}, certs.filter(c => !c.cancelled).map(c => h('li', {}, `No. ${c.number} · `, who(c.partner), ` · ${c.units} units · issued ${day(c.issued)}`)))
      : h('p', { class: 'hint' }, 'None yet.'));
}
export const tabs = [{ id: 'partnership', title: 'Partnership', render: (api) => view(api) }];
