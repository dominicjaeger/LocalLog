// LocalLog - backup folder, last-backup tracking and storage protection.
// The folder backup uses the browser's folder access. Nothing ever leaves this device.

import { APP_VERSION, SCHEMA_VERSION } from './version.js';
import { BACKUP_FILES, toBackupFiles, fromBackupFiles } from './core/backup.js';
import { getSnapshot, replaceAll, getSetting, setSetting, onDataChanged } from './storage.js';

let handle = null;
let permission = 'none'; // 'none' | 'granted' | 'prompt' | 'denied'
let lastBackupAt = null;
let persisted = false;
let privateWindow = false;
let lastError = null;
let syncTimer = null;
const subscribers = new Set();

export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function emit() {
  for (const cb of subscribers) {
    try { cb(getState()); } catch (err) { console.error(err); }
  }
}

export function hasFolderSupport() {
  return typeof window.showDirectoryPicker === 'function';
}

export function getState() {
  return {
    folderSupported: hasFolderSupport(),
    folderName: handle ? handle.name : null,
    permission,
    lastBackupAt,
    persisted,
    privateWindow,
    lastError
  };
}

async function queryPermission(h) {
  try {
    return await h.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

export async function initBackup() {
  lastBackupAt = await getSetting('lastBackupAt', null);

  try {
    const saved = await getSetting('dirHandle', null);
    if (saved) {
      handle = saved;
      // Only query here. Asking for permission needs a click (see reconnectFolder).
      permission = await queryPermission(handle);
    }
  } catch (err) {
    console.warn('Could not restore the backup folder:', err);
  }

  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
    privateWindow = await detectPrivateWindow();
  } catch { /* storage hints are optional */ }

  onDataChanged(scheduleFolderSync);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
      writeToFolder();
    }
  });
  emit();
}

/** Heuristic: private windows get a much smaller storage quota. */
async function detectPrivateWindow() {
  if (!navigator.storage || !navigator.storage.estimate) return false;
  const { quota } = await navigator.storage.estimate();
  return typeof quota === 'number' && quota < 120 * 1024 * 1024;
}

/** Asks the browser to keep the data (once, after the first data entry). */
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    if (persisted) return;
    persisted = await navigator.storage.persist();
    await setSetting('persistGranted', persisted);
    emit();
  } catch { /* optional */ }
}

async function markBackup() {
  lastBackupAt = new Date().toISOString();
  await setSetting('lastBackupAt', lastBackupAt);
}

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

export async function pickFolder() {
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'locallog-backup' });
}

async function readText(dirHandle, name) {
  try {
    const fh = await dirHandle.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch (err) {
    if (err && err.name === 'NotFoundError') return undefined;
    throw err;
  }
}

export async function folderHasBackup(dirHandle) {
  return (await readText(dirHandle, BACKUP_FILES.entries)) !== undefined
    || (await readText(dirHandle, BACKUP_FILES.customers)) !== undefined;
}

export async function attachFolder(dirHandle) {
  handle = dirHandle;
  permission = 'granted';
  lastError = null;
  await setSetting('dirHandle', dirHandle);
  emit();
}

export async function detachFolder() {
  handle = null;
  permission = 'none';
  await setSetting('dirHandle', null);
  emit();
}

/** Must be called from a click. */
export async function reconnectFolder() {
  if (!handle) return false;
  try {
    permission = await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    permission = 'denied';
  }
  emit();
  if (permission === 'granted') return writeToFolder();
  return false;
}

/**
 * Replaces the data in this browser with the backup files in the folder. The files are checked first.
 * When the browser holds entries, a safety copy of them is downloaded before anything is replaced.
 * Returns { ok, safetyCopy, warnings } or { ok: false, error, detail, row }.
 */
export async function loadFromFolder(dirHandle) {
  const texts = {};
  for (const name of Object.values(BACKUP_FILES)) texts[name] = await readText(dirHandle, name);
  const parsed = fromBackupFiles(texts, SCHEMA_VERSION);
  if (!parsed.ok) return parsed;

  const current = await getSnapshot();
  const safetyCopy = current.entries.length > 0;
  if (safetyCopy) await downloadBackup();

  await replaceAll(parsed.data);
  return { ok: true, safetyCopy, warnings: parsed.warnings || [] };
}

async function writeFileSafely(dirHandle, name, text) {
  // Write to a temporary file first and rename it where the browser supports that.
  const tmpName = `${name}.tmp`;
  try {
    const tmp = await dirHandle.getFileHandle(tmpName, { create: true });
    const w = await tmp.createWritable();
    await w.write(text);
    await w.close();
    if (typeof tmp.move === 'function') {
      await tmp.move(name);
      return;
    }
    await dirHandle.removeEntry(tmpName).catch(() => {});
  } catch {
    await dirHandle.removeEntry(tmpName).catch(() => {});
  }
  // Fallback: overwrite directly.
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

export async function writeToFolder() {
  if (!handle) return false;
  permission = await queryPermission(handle);
  if (permission !== 'granted') {
    emit();
    return false;
  }
  try {
    const snapshot = await getSnapshot();
    const files = toBackupFiles({ ...snapshot, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION });
    for (const [name, text] of Object.entries(files)) await writeFileSafely(handle, name, text);
    lastError = null;
    await markBackup();
    emit();
    return true;
  } catch (err) {
    console.error('Backup to folder failed:', err);
    lastError = err && err.name ? err.name : 'error';
    emit();
    return false;
  }
}

function scheduleFolderSync() {
  if (!handle) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    writeToFolder();
  }, 1000);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export function downloadText(text, filename, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads the four backup files. */
export async function downloadBackup() {
  const snapshot = await getSnapshot();
  const files = toBackupFiles({ ...snapshot, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION });
  let first = true;
  for (const [name, text] of Object.entries(files)) {
    if (!first) await new Promise((r) => setTimeout(r, 300));
    downloadText(text, name);
    first = false;
  }
  await markBackup();
  emit();
}

/** Back up now: to the folder when it is connected, otherwise as a download. */
export async function backupNow() {
  if (handle && permission === 'granted') {
    if (await writeToFolder()) return 'folder';
  }
  await downloadBackup();
  return 'download';
}
