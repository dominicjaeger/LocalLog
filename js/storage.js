// LocalLog - IndexedDB storage (database "locallog", version = SCHEMA_VERSION).
// No DOM access. All data stays in this browser.

import { SCHEMA_VERSION } from './version.js';

const DB_NAME = 'locallog';
const DB_VERSION = SCHEMA_VERSION;

let dbPromise = null;
const changeListeners = new Set();
const remoteListeners = new Set();

// Every write is announced to the other open tabs of LocalLog (BroadcastChannel stays inside the
// browser; the page's security policy does not allow any network traffic).
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('locallog') : null;
if (channel) {
  channel.onmessage = (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    for (const cb of remoteListeners) {
      try { cb(message); } catch (err) { console.error(err); }
    }
  };
}

function broadcast(message) {
  try { if (channel) channel.postMessage(message); } catch { /* other tabs simply do not hear it */ }
}

/** Called after customers, projects or entries changed in THIS tab (not for settings). */
export function onDataChanged(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

/** Called when ANOTHER tab changed data ({ type: 'changed' }) or a setting ({ type: 'settings', key }). */
export function onRemoteChange(cb) {
  remoteListeners.add(cb);
  return () => remoteListeners.delete(cb);
}

function notifyChanged() {
  broadcast({ type: 'changed' });
  for (const cb of changeListeners) {
    try { cb(); } catch (err) { console.error(err); }
  }
}

// Settings that only matter inside one tab are not announced.
const LOCAL_ONLY_SETTINGS = new Set(['lastSeenAt', 'lastBackupAt', 'dirHandle', 'persistGranted', 'welcomeSeen']);

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Each step only runs for databases older than that layout version, so an existing
      // version-1 database is upgraded without touching its data.
      if (event.oldVersion < 1) {
        db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
        const projects = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        projects.createIndex('customerId', 'customerId');
        const entries = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        entries.createIndex('projectId', 'projectId');
        entries.createIndex('startTime', 'startTime');
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (event.oldVersion < 2) {
        // Transfer marks: key = 'YYYY-MM-DD|projectId'.
        const transfers = db.createObjectStore('transfers', { keyPath: 'key' });
        transfers.createIndex('projectId', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database upgrade blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const rq = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Runs fn(stores) inside one transaction. Only await IndexedDB requests inside fn. */
async function withTx(names, mode, fn) {
  const db = await openDb();
  const list = Array.isArray(names) ? names : [names];
  const transaction = db.transaction(list, mode);
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
  });
  done.catch(() => {});
  const stores = {};
  for (const n of list) stores[n] = transaction.objectStore(n);
  let result;
  try {
    result = await fn(stores);
  } catch (err) {
    try { transaction.abort(); } catch { /* already finished */ }
    throw err;
  }
  await done;
  return result;
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

/** Opens the database and creates the first-run data (one customer "Internal" with one project "General"). */
export async function initStorage() {
  await openDb();
  const count = await withTx('customers', 'readonly', ({ customers }) => rq(customers.count()));
  if (count === 0) {
    const t = nowIso();
    await withTx(['customers', 'projects'], 'readwrite', async ({ customers, projects }) => {
      const customerId = await rq(customers.add({
        name: 'Internal', colorHex: '#0078D4', defaultRate: null, isActive: true, createdAt: t
      }));
      await rq(projects.add({
        customerId, name: 'General', hourlyRate: null, ticketUrlTemplate: null, isActive: true, createdAt: t
      }));
    });
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function getCustomers() {
  const all = await withTx('customers', 'readonly', ({ customers }) => rq(customers.getAll()));
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addCustomer({ name, colorHex, defaultRate = null }) {
  const record = {
    name: name.trim(), colorHex, defaultRate, isActive: true, createdAt: nowIso()
  };
  record.id = await withTx('customers', 'readwrite', ({ customers }) => rq(customers.add(record)));
  notifyChanged();
  return record;
}

export async function updateCustomer(id, patch) {
  const updated = await withTx('customers', 'readwrite', async ({ customers }) => {
    const current = await rq(customers.get(id));
    if (!current) throw new Error('Customer not found');
    const next = { ...current, ...patch, id };
    await rq(customers.put(next));
    return next;
  });
  notifyChanged();
  return updated;
}

/**
 * Deletes a customer and its projects. Refuses (error.code === 'hasEntries') while any entry references them.
 */
export async function deleteCustomer(id) {
  await withTx(['customers', 'projects', 'entries', 'transfers'], 'readwrite', async ({ customers, projects, entries, transfers }) => {
    const owned = await rq(projects.index('customerId').getAll(id));
    for (const p of owned) {
      const used = await rq(entries.index('projectId').count(p.id));
      if (used > 0) throw Object.assign(new Error('Customer has entries'), { code: 'hasEntries' });
    }
    await deleteTransfersOf(transfers, owned.map((p) => p.id));
    for (const p of owned) await rq(projects.delete(p.id));
    await rq(customers.delete(id));
  });
  notifyChanged();
}

/** Deletes the transfer marks of the given projects (inside the caller's transaction). */
async function deleteTransfersOf(transfersStore, projectIds) {
  for (const projectId of projectIds) {
    const keys = await rq(transfersStore.index('projectId').getAllKeys(projectId));
    for (const key of keys) await rq(transfersStore.delete(key));
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function getProjects() {
  const all = await withTx('projects', 'readonly', ({ projects }) => rq(projects.getAll()));
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addProject({ customerId, name, hourlyRate = null, ticketUrlTemplate = null }) {
  const record = {
    customerId, name: name.trim(), hourlyRate, ticketUrlTemplate, isActive: true, createdAt: nowIso()
  };
  record.id = await withTx('projects', 'readwrite', ({ projects }) => rq(projects.add(record)));
  notifyChanged();
  return record;
}

export async function updateProject(id, patch) {
  const updated = await withTx('projects', 'readwrite', async ({ projects }) => {
    const current = await rq(projects.get(id));
    if (!current) throw new Error('Project not found');
    const next = { ...current, ...patch, id };
    await rq(projects.put(next));
    return next;
  });
  notifyChanged();
  return updated;
}

/** Refuses (error.code === 'hasEntries') while any entry references the project. */
export async function deleteProject(id) {
  await withTx(['projects', 'entries', 'transfers'], 'readwrite', async ({ projects, entries, transfers }) => {
    const used = await rq(entries.index('projectId').count(id));
    if (used > 0) throw Object.assign(new Error('Project has entries'), { code: 'hasEntries' });
    await deleteTransfersOf(transfers, [id]);
    await rq(projects.delete(id));
  });
  notifyChanged();
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** All entries including the running one (empty endTime). */
export async function getEntries() {
  return withTx('entries', 'readonly', ({ entries }) => rq(entries.getAll()));
}

export async function getRunningEntries() {
  const all = await getEntries();
  return all.filter((e) => !e.endTime);
}

export async function addEntry({ projectId, startTime, endTime = '', note = '', ticket = '' }) {
  const t = nowIso();
  const record = {
    projectId: Number(projectId),
    startTime,
    endTime,
    note: String(note || '').replace(/[\r\n]+/g, ' '),
    ticket: String(ticket || '').trim(),
    createdAt: t,
    updatedAt: t
  };
  record.id = await withTx('entries', 'readwrite', ({ entries }) => rq(entries.add(record)));
  notifyChanged();
  return record;
}

function mergeEntry(current, patch, id) {
  const next = { ...current, ...patch, id, updatedAt: nowIso() };
  if (typeof next.note === 'string') next.note = next.note.replace(/[\r\n]+/g, ' ');
  if (typeof next.ticket === 'string') next.ticket = next.ticket.trim();
  return next;
}

/** Read-modify-write: only the fields in `patch` change; everything else is kept. */
export async function updateEntry(id, patch) {
  const updated = await withTx('entries', 'readwrite', async ({ entries }) => {
    const current = await rq(entries.get(id));
    if (!current) throw new Error('Entry not found');
    const next = mergeEntry(current, patch, id);
    await rq(entries.put(next));
    return next;
  });
  notifyChanged();
  return updated;
}

/**
 * Like updateEntry, but only while the entry is still open (empty endTime). The check happens inside
 * the same transaction as the write, so another tab that closed or deleted the entry in the meantime
 * is never overwritten. Returns the saved entry, or null when nothing was written.
 */
export async function updateEntryIfOpen(id, patch) {
  const updated = await withTx('entries', 'readwrite', async ({ entries }) => {
    const current = await rq(entries.get(id));
    if (!current || current.endTime) return null;
    const next = mergeEntry(current, patch, id);
    await rq(entries.put(next));
    return next;
  });
  if (updated) notifyChanged();
  return updated;
}

/**
 * Opens a closed entry again (resume right after a pause). Only when its end time is still the one that
 * was written by the pause and no other entry is open. Returns the entry or null.
 */
export async function reopenEntry(id, expectedEndTime) {
  const reopened = await withTx('entries', 'readwrite', async ({ entries }) => {
    const current = await rq(entries.get(id));
    if (!current || current.endTime !== expectedEndTime) return null;
    const all = await rq(entries.getAll());
    if (all.some((e) => !e.endTime)) return null;
    const next = { ...current, endTime: '', updatedAt: nowIso() };
    await rq(entries.put(next));
    return next;
  });
  if (reopened) notifyChanged();
  return reopened;
}

export async function deleteEntry(id) {
  await withTx('entries', 'readwrite', ({ entries }) => rq(entries.delete(id)));
  notifyChanged();
}

/**
 * Saves several entry changes in ONE transaction: patches = [{ id, patch }].
 * A patch with `onlyIfOpen: true` is only applied while the entry is still open; if any such entry was
 * closed or deleted elsewhere, nothing is written and the result is { ok: false, reason: 'changedElsewhere' }.
 * Returns { ok: true, entries: [saved...] }.
 */
export async function updateEntries(patches) {
  const result = await withTx('entries', 'readwrite', async ({ entries }) => {
    const saved = [];
    for (const { id, patch, onlyIfOpen } of patches) {
      const current = await rq(entries.get(id));
      if (!current || (onlyIfOpen && current.endTime)) return { ok: false, reason: 'changedElsewhere' };
      saved.push(mergeEntry(current, patch, id));
    }
    for (const next of saved) await rq(entries.put(next));
    return { ok: true, entries: saved };
  });
  if (result.ok) notifyChanged();
  return result;
}

/** Deletes an entry only while it is still open. Returns true when it was deleted. */
export async function deleteEntryIfOpen(id) {
  const deleted = await withTx('entries', 'readwrite', async ({ entries }) => {
    const current = await rq(entries.get(id));
    if (!current || current.endTime) return false;
    await rq(entries.delete(id));
    return true;
  });
  if (deleted) notifyChanged();
  return deleted;
}

// ---------------------------------------------------------------------------
// Transfer marks ("this day and project was transferred to another system")
// ---------------------------------------------------------------------------

export async function getTransfers() {
  return withTx('transfers', 'readonly', ({ transfers }) => rq(transfers.getAll()));
}

/** record: { key, date, projectId, hours, seconds, transferredAt } */
export async function setTransfer(record) {
  await withTx('transfers', 'readwrite', ({ transfers }) => rq(transfers.put(record)));
  notifyChanged();
}

export async function deleteTransfer(key) {
  await withTx('transfers', 'readwrite', ({ transfers }) => rq(transfers.delete(key)));
  notifyChanged();
}

// ---------------------------------------------------------------------------
// Snapshot / replace (backup)
// ---------------------------------------------------------------------------

export async function getSnapshot() {
  return withTx(['customers', 'projects', 'entries', 'transfers'], 'readonly', async ({ customers, projects, entries, transfers }) => ({
    customers: await rq(customers.getAll()),
    projects: await rq(projects.getAll()),
    entries: await rq(entries.getAll()),
    transfers: await rq(transfers.getAll())
  }));
}

/** Replaces all customers, projects, entries and transfer marks with the given data (single transaction). */
export async function replaceAll({ customers, projects, entries, transfers = [] }) {
  await withTx(['customers', 'projects', 'entries', 'transfers'], 'readwrite', async (stores) => {
    await rq(stores.customers.clear());
    await rq(stores.projects.clear());
    await rq(stores.entries.clear());
    await rq(stores.transfers.clear());
    for (const c of customers) await rq(stores.customers.put(c));
    for (const p of projects) await rq(stores.projects.put(p));
    for (const e of entries) await rq(stores.entries.put(e));
    for (const tr of transfers) await rq(stores.transfers.put(tr));
  });
  notifyChanged();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSetting(key, defaultValue = null) {
  const row = await withTx('settings', 'readonly', ({ settings }) => rq(settings.get(key)));
  return row ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  await withTx('settings', 'readwrite', ({ settings }) => rq(settings.put({ key, value })));
  if (!LOCAL_ONLY_SETTINGS.has(key)) broadcast({ type: 'settings', key });
}
