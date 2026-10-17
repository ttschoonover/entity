// The participant's key: made in this page, kept in this browser's IndexedDB,
// never sent anywhere. Exporting it is a deliberate act by the participant.
const DB = 'entity-keys', STORE = 'keys';

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
export const loadIdentity = (entityId) => tx('readonly', s => s.get(entityId));
export const saveIdentity = (entityId, ident) => tx('readwrite', s => s.put(ident, entityId));
export const forgetIdentity = (entityId) => tx('readwrite', s => s.delete(entityId));
