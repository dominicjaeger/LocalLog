// LocalLog - IndexedDB Storage Engine with File System Access API 2-Way CSV Sync

import {
  formatHoursAT,
  formatRateAT,
  formatValueAT,
  formatDateAT,
  formatTimeAT,
  formatDuration,
  parseCsv,
  serializeCsv
} from './csv.js';

const DB_NAME = 'locallog_db';
const DB_VERSION = 1;

let dbInstance = null;
let boundDirectoryHandle = null;

function openDb() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const entryStore = db.createObjectStore('entries', { keyPath: 'id' });
        entryStore.createIndex('projectId', 'projectId', { unique: false });
        entryStore.createIndex('startTime', 'startTime', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode, callback) {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try {
        request = callback(store);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
    });
  });
}

export async function seedDefaultProjects() {
  const nowIso = new Date().toISOString();
  const seed = [
    { id: 1, name: 'Operation', colorHex: '#0078D4', hourlyRate: 75.0, isActive: 1, createdAt: nowIso },
    { id: 2, name: 'General Changes', colorHex: '#8764B8', hourlyRate: 80.0, isActive: 1, createdAt: nowIso },
    { id: 3, name: 'Project A', colorHex: '#107C10', hourlyRate: 95.0, isActive: 1, createdAt: nowIso },
    { id: 4, name: 'Project B', colorHex: '#D83B01', hourlyRate: 90.0, isActive: 1, createdAt: nowIso }
  ];
  for (const p of seed) {
    await saveProject(p, false);
  }
}

export async function resetToDefaultProjects() {
  const [projects, rawEntries] = await Promise.all([
    getProjects(),
    tx('entries', 'readonly', (store) => store.getAll())
  ]);
  const entriesList = rawEntries || [];
  // Delete existing projects that have no associated entries
  for (const p of projects) {
    const hasEntries = entriesList.some(e => Number(e.projectId) === Number(p.id));
    if (!hasEntries) {
      await deleteProject(p.id);
    }
  }
  await seedDefaultProjects();
}

export async function initStorage() {
  await openDb();
  const existingProjects = await getProjects();
  if (!existingProjects || existingProjects.length === 0) {
    await seedDefaultProjects();
  } else {
    // If the database only contains the old legacy placeholder projects and 0 entries, upgrade to new requested defaults
    const rawEntries = await tx('entries', 'readonly', (store) => store.getAll());
    if ((!rawEntries || rawEntries.length === 0) && existingProjects.some(p => p.name === 'Project Alpha')) {
      for (const p of existingProjects) {
        await deleteProject(p.id);
      }
      await seedDefaultProjects();
    }
  }

  // Recover unclosed entries from accidental browser quit
  await recoverUnclosedEntries();

  // Try retrieving cached directory handle
  try {
    const savedHandle = await getSetting('dirHandle');
    if (savedHandle && (await verifyPermission(savedHandle, false))) {
      boundDirectoryHandle = savedHandle;
    }
  } catch (err) {
    console.warn('Could not restore directory handle:', err);
  }
}

export async function getProjects(activeOnly = false) {
  const all = await tx('projects', 'readonly', (store) => store.getAll());
  const list = all || [];
  const filtered = activeOnly ? list.filter(p => Number(p.isActive) === 1) : list;
  return filtered.sort((a, b) => {
    if (b.isActive !== a.isActive) return b.isActive - a.isActive;
    return a.name.localeCompare(b.name);
  });
}

export async function saveProject(project, triggerSync = true) {
  if (!project.id) {
    const all = await getProjects();
    const maxId = all.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0);
    project.id = maxId + 1;
  }
  project.hourlyRate = parseFloat(project.hourlyRate) || 0.0;
  project.isActive = Number(project.isActive) === 1 ? 1 : 0;
  if (!project.createdAt) project.createdAt = new Date().toISOString();

  await tx('projects', 'readwrite', (store) => store.put(project));
  if (triggerSync) autoSyncToDisk();
  return project;
}

export async function deleteProject(id) {
  await tx('projects', 'readwrite', (store) => store.delete(Number(id)));
  autoSyncToDisk();
}

export async function getEntries() {
  const [rawEntries, projects] = await Promise.all([
    tx('entries', 'readonly', (store) => store.getAll()),
    getProjects()
  ]);

  const projectsById = new Map();
  for (const p of projects) projectsById.set(Number(p.id), p);

  const list = [];
  for (const r of (rawEntries || [])) {
    if (!r.endTime) continue; // Skip in-progress segment
    const startDt = new Date(r.startTime);
    const endDt = new Date(r.endTime);
    const secs = Number(r.durationSeconds) || 0;
    const hours = Math.round((secs / 3600.0) * 100) / 100;
    const proj = projectsById.get(Number(r.projectId));
    const pName = proj ? proj.name : (r.projectName || 'Unknown Project');
    const colorHex = proj ? proj.colorHex : '#0078D4';
    const rate = proj ? proj.hourlyRate : 0.0;
    const valEur = Math.round(hours * rate * 100) / 100;

    list.push({
      id: Number(r.id),
      projectId: Number(r.projectId),
      projectName: pName,
      colorHex,
      startTime: r.startTime,
      endTime: r.endTime,
      startSort: startDt.getTime(),
      dateDisplay: formatDateAT(startDt),
      timeRange: `${formatTimeAT(startDt)} - ${formatTimeAT(endDt)}`,
      durationSeconds: secs,
      durationDisplay: formatDuration(secs),
      hoursDecimal: hours,
      hoursDisplay: formatHoursAT(hours),
      rateDisplay: formatRateAT(rate),
      valueDisplay: formatValueAT(valEur),
      note: r.note || ''
    });
  }

  // Sort newest first
  return list.sort((a, b) => b.startSort - a.startSort);
}

export async function saveEntry(entry, triggerSync = true) {
  if (!entry.id) {
    const all = await tx('entries', 'readonly', (store) => store.getAll());
    const maxId = (all || []).reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
    entry.id = maxId + 1;
  }
  entry.projectId = Number(entry.projectId);
  entry.durationSeconds = Number(entry.durationSeconds) || 0;

  await tx('entries', 'readwrite', (store) => store.put(entry));
  if (triggerSync) autoSyncToDisk();
  return entry;
}

export async function deleteEntry(id) {
  await tx('entries', 'readwrite', (store) => store.delete(Number(id)));
  autoSyncToDisk();
}

export async function recoverUnclosedEntries() {
  const all = await tx('entries', 'readonly', (store) => store.getAll());
  if (!all) return;
  for (const r of all) {
    if (!r.endTime && r.startTime) {
      const startDt = new Date(r.startTime);
      const savedSecs = Math.max(60, Number(r.durationSeconds) || 60);
      r.durationSeconds = savedSecs;
      r.endTime = new Date(startDt.getTime() + savedSecs * 1000).toISOString();
      await tx('entries', 'readwrite', (store) => store.put(r));
    }
  }
}

export async function getSetting(key, defaultValue = null) {
  const row = await tx('settings', 'readonly', (store) => store.get(key));
  return row ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  await tx('settings', 'readwrite', (store) => store.put({ key, value }));
}

// ==============================================================================
// FILE SYSTEM ACCESS API (Direct local 2-way CSV disk synchronization)
// ==============================================================================

export function hasFileSystemSupport() {
  return typeof window.showDirectoryPicker === 'function';
}

export function isFolderBound() {
  return boundDirectoryHandle !== null;
}

export function getBoundFolderName() {
  return boundDirectoryHandle ? boundDirectoryHandle.name : null;
}

async function verifyPermission(fileHandle, readWrite = true) {
  const options = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  return (await fileHandle.requestPermission(options)) === 'granted';
}

export async function bindLocalDirectory() {
  if (!hasFileSystemSupport()) {
    throw new Error('Your browser does not support the File System Access API. Use Chrome or Edge.');
  }
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const hasPerm = await verifyPermission(dirHandle, true);
  if (!hasPerm) throw new Error('Permission to write to the chosen directory was denied.');

  boundDirectoryHandle = dirHandle;
  await setSetting('dirHandle', dirHandle);

  // Perform initial sync: write existing DB state or import CSVs
  await syncToDisk();
  return dirHandle.name;
}

export async function unbindLocalDirectory() {
  boundDirectoryHandle = null;
  await setSetting('dirHandle', null);
}

export async function syncToDisk() {
  if (!boundDirectoryHandle) return false;
  try {
    const hasPerm = await verifyPermission(boundDirectoryHandle, true);
    if (!hasPerm) return false;

    const [projects, rawEntries] = await Promise.all([
      getProjects(),
      tx('entries', 'readonly', (store) => store.getAll())
    ]);

    const projHeaders = ['Id', 'Name', 'ColorHex', 'HourlyRate', 'IsActive', 'CreatedAt'];
    const entryHeaders = ['Id', 'ProjectId', 'ProjectName', 'StartTime', 'EndTime', 'DurationSeconds', 'Note'];

    const projRows = projects.map(p => ({
      Id: p.id,
      Name: p.name,
      ColorHex: p.colorHex,
      HourlyRate: p.hourlyRate,
      IsActive: p.isActive,
      CreatedAt: p.createdAt
    }));

    const entryRows = (rawEntries || []).map(e => ({
      Id: e.id,
      ProjectId: e.projectId,
      ProjectName: e.projectName,
      StartTime: e.startTime,
      EndTime: e.endTime,
      DurationSeconds: e.durationSeconds,
      Note: e.note || ''
    }));

    // Write projects.csv
    const projCsv = serializeCsv(projRows, projHeaders);
    const projFile = await boundDirectoryHandle.getFileHandle('projects.csv', { create: true });
    const projWritable = await projFile.createWritable();
    await projWritable.write(projCsv);
    await projWritable.close();

    // Write entries.csv
    const entryCsv = serializeCsv(entryRows, entryHeaders);
    const entryFile = await boundDirectoryHandle.getFileHandle('entries.csv', { create: true });
    const entryWritable = await entryFile.createWritable();
    await entryWritable.write(entryCsv);
    await entryWritable.close();

    return true;
  } catch (err) {
    console.error('Error during disk synchronization:', err);
    return false;
  }
}

let syncTimeout = null;
function autoSyncToDisk() {
  if (!boundDirectoryHandle) return;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncToDisk();
  }, 400);
}

/**
 * Fallback Manual CSV Export (Download directly through browser)
 */
export async function downloadCsvFiles() {
  const [projects, rawEntries] = await Promise.all([
    getProjects(),
    tx('entries', 'readonly', (store) => store.getAll())
  ]);

  const projHeaders = ['Id', 'Name', 'ColorHex', 'HourlyRate', 'IsActive', 'CreatedAt'];
  const entryHeaders = ['Id', 'ProjectId', 'ProjectName', 'StartTime', 'EndTime', 'DurationSeconds', 'Note'];

  const projRows = projects.map(p => ({
    Id: p.id, Name: p.name, ColorHex: p.colorHex, HourlyRate: p.hourlyRate, IsActive: p.isActive, CreatedAt: p.createdAt
  }));
  const entryRows = (rawEntries || []).map(e => ({
    Id: e.id, ProjectId: e.projectId, ProjectName: e.projectName, StartTime: e.startTime, EndTime: e.endTime, DurationSeconds: e.durationSeconds, Note: e.note || ''
  }));

  const projCsv = serializeCsv(projRows, projHeaders);
  const entryCsv = serializeCsv(entryRows, entryHeaders);

  triggerDownload(projCsv, 'projects.csv', 'text/csv;charset=utf-8;');
  setTimeout(() => {
    triggerDownload(entryCsv, 'entries.csv', 'text/csv;charset=utf-8;');
  }, 300);
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
