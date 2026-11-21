// details.js · a partner's personal particulars, readable only by that partner
// and the officers who need them (the details module). Shared by the page and
// the node; nothing here takes part in settlement.
//
// The particulars (legal name, date of birth, residence, taxpayer number…) are
// encrypted once with a fresh content key (AES-256-GCM), and the content key is
// wrapped with HPKE to each reader's record key (kernel/sealing.js):
//
//   { v: 1, entity, member, nonce, ct, wraps: { id: { enc, ct } }, at }
//
// The record holds only details.filed { digest }: the digest commits to the
// encrypted particulars (nonce and ciphertext), never to the wraps, so an
// officer can later wrap the same particulars to a new officer without the
// digest changing. The particulars themselves are kept by the node, off the
// record, so they can be corrected or deleted as the law and the agreement
// require; an immutable record could do neither.

import * as C from './crypto.js';
import { canonical } from './canonical.js';
import { hash } from './hash.js';

export const DETAILS_VERSION = 1;
const wrapInfo = (entity, member) => C.utf8(`entity/details/v1\n${entity}\n${member}`);
const aad = (entity, member) => C.utf8(`entity/details/body/v1\n${entity}\n${member}`);

// The fields, in the order forms and exports show them.
export const FIELDS = [
  ['legal_name', 'Legal name', true],
  ['date_of_birth', 'Date of birth (YYYY-MM-DD)', true],
  ['residence', 'Residence address', true],
  ['mailing', 'Mailing address, if different', false],
  ['email', 'Email', true],
  ['phone', 'Phone', false],
  ['tax_status', 'Tax status (us-person or foreign-person)', true],
  ['tin_type', 'Taxpayer number type (SSN, ITIN or foreign TIN)', true],
  ['tin', 'Taxpayer identification number', true],
  ['certified', 'Certification (Form W-9 statements, or Form W-8BEN given to the Treasurer)', true],
];

export function problems(f) {
  const out = [];
  for (const [k, label, required] of FIELDS) if (required && !String(f[k] ?? '').trim()) out.push(`${label} is required`);
  if (f.date_of_birth) {
    const d = Date.parse(f.date_of_birth);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date_of_birth) || Number.isNaN(d)) out.push('the date of birth is YYYY-MM-DD');
    else if (Date.now() - d < 18 * 365.25 * 86400000) out.push('every partner must be at least 18 (agreement section 4.2)');
  }
  if (f.tax_status && !['us-person', 'foreign-person'].includes(f.tax_status)) out.push('tax status is us-person or foreign-person');
  if (f.tin_type === 'SSN' || f.tin_type === 'ITIN') { if (!/^\d{3}-?\d{2}-?\d{4}$/.test(String(f.tin || ''))) out.push('an SSN or ITIN has nine digits (NNN-NN-NNNN)'); }
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) out.push('that is not an email address');
  if (f.certified !== undefined && f.certified !== true && f.certified !== 'yes') out.push('the certification must be confirmed');
  return out;
}

const pkOf = (k) => (typeof k === 'string' ? C.unb64(k) : k);

// Seal particulars to readers [{ id, key }] (keys: record public keys).
export async function sealDetails({ entity, member }, fields, readers) {
  const K = C.random(32), nonce = C.random(12);
  const ct = await C.aeadSeal(K, nonce, C.utf8(JSON.stringify(fields)), aad(entity, member));
  const blob = { v: DETAILS_VERSION, entity, member, nonce: C.b64(nonce), ct: C.b64(ct), wraps: {}, at: new Date().toISOString() };
  for (const r of readers) blob.wraps[r.id] = await wrap(entity, member, K, r.key);
  return blob;
}
async function wrap(entity, member, K, key) {
  const { enc, ct } = await C.hpkeSeal(pkOf(key), K, { info: wrapInfo(entity, member) });
  return { enc: C.b64(enc), ct: C.b64(ct) };
}
async function contentKey(blob, id, sk) {
  const w = blob.wraps?.[id];
  if (!w) throw new Error(`these particulars are not shared with ${id}`);
  return C.hpkeOpen(sk, C.unb64(w.enc), C.unb64(w.ct), { info: wrapInfo(blob.entity, blob.member) });
}
export async function openDetails(blob, id, sk) {
  const K = await contentKey(blob, id, sk);
  const pt = await C.aeadOpen(K, C.unb64(blob.nonce), C.unb64(blob.ct), aad(blob.entity, blob.member));
  return JSON.parse(new TextDecoder().decode(pt));
}
// A reader who can open them wraps the same particulars to more readers.
export async function rewrap(blob, id, sk, readers) {
  const K = await contentKey(blob, id, sk);
  const out = { ...blob, wraps: { ...blob.wraps } };
  for (const r of readers) out.wraps[r.id] = await wrap(blob.entity, blob.member, K, r.key);
  return out;
}
// What the record commits to: the encrypted particulars, not who can read them.
export const digestOf = (blob) => hash(canonical({ v: blob.v, entity: blob.entity, member: blob.member, nonce: blob.nonce, ct: blob.ct }));

// A request to the node, signed with the member's own signing key.
export const requestMessage = (body) => canonical(body);
export const REQUEST_NAMESPACE = 'entity.details';
