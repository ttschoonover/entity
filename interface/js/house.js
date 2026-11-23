// house.js · the House settings page of a house hub (node.json "house"; see
// cli/house.js): its name, the house password, the house network and its admins.
// Only an admin, signed in as themselves, reaches it.
const $ = (s) => document.querySelector(s);
const lines = (s) => s.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
let C = null;

async function load() {
  fetch('status', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(s => { if (s?.look) document.documentElement.dataset.look = s.look; }).catch(() => {});
  const r = await fetch('config', { cache: 'no-store', credentials: 'same-origin' });
  if (r.status === 401) { location.replace('../signin?next=%2Fhouse%2Fsettings'); return; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $('#who').textContent = j.why || 'These settings could not be loaded.'; $('#who').className = 'bad'; return; }
  draw(j);
}

function draw(c) {
  C = c;
  $('#who').textContent = `Signed in as ${c.you.id}, an admin.`;
  $('#name').value = c.name;
  $('#pw-state').textContent = c.password ? `A house password is set (since ${new Date(c.password.set).toLocaleDateString()}).` : 'No house password yet: away from the house, only members can get in.';
  $('#detect').checked = c.detect;
  $('#publicIps').value = c.publicIps.join('\n');
  $('#networks').value = c.networks.join('\n');
  const found = c.detected?.addresses?.length ? `The house’s own address, as found automatically: ${c.detected.addresses.join(', ')}.` : (c.detect ? 'The house’s own address has not been found yet.' : '');
  const you = c.you.via === 'tunnel' ? ` You are connecting from ${c.you.ip}.` : c.you.via === 'direct' ? ` You are connected directly, from ${c.you.ip}.` : '';
  $('#seen').textContent = `${found}${you}`;
  const box = $('#members'); box.replaceChildren();
  for (const id of c.members) {
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', value: id, checked: c.admins.includes(id), id: `adm-${id}` });
    const l = Object.assign(document.createElement('label'), { className: 'check', htmlFor: cb.id }); l.append(cb, ` ${id}${id === c.you.id ? ' (you)' : ''}`);
    const li = document.createElement('li'); li.append(l); box.append(li);
  }
}

async function save(form, changes, out) {
  out.textContent = 'Saving…'; out.className = 'out';
  const r = await fetch('config', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(changes) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { out.textContent = j.why || `Not saved (${r.status}).`; out.className = 'out bad'; return false; }
  draw(j); out.textContent = 'Saved.'; out.className = 'out good'; return true;
}

$('#f-name').addEventListener('submit', (ev) => { ev.preventDefault(); save(ev.target, { name: $('#name').value }, $('#o-name')); });
$('#f-pw').addEventListener('submit', async (ev) => {
  ev.preventDefault(); const out = $('#o-pw');
  if ($('#pw').value !== $('#pw2').value) { out.textContent = 'The two passwords differ.'; out.className = 'out bad'; return; }
  if (await save(ev.target, { password: $('#pw').value }, out)) { $('#pw').value = ''; $('#pw2').value = ''; }
});
$('#f-net').addEventListener('submit', (ev) => { ev.preventDefault(); save(ev.target, { detect: $('#detect').checked, publicIps: lines($('#publicIps').value), networks: lines($('#networks').value) }, $('#o-net')); });
$('#f-admins').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const admins = [...document.querySelectorAll('#members input:checked')].map(x => x.value);
  if (C && !admins.includes(C.you.id) && !confirm('You are removing yourself as an admin. You will no longer reach this page. Continue?')) return;
  save(ev.target, { admins }, $('#o-admins'));
});
load();
