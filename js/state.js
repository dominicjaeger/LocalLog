// In-memory copy of the data for the screens. Reloaded whenever the database changes.

import { getCustomers, getProjects, getEntries, getSetting, setSetting, onDataChanged } from './storage.js';
import { indexById } from './core/export.js';
import { DEFAULT_ROUNDING_MODE, normalizeMode } from './core/rounding.js';

export const state = {
  customers: [],
  projects: [],
  entries: [],
  customersById: new Map(),
  projectsById: new Map(),
  settings: {
    includeRates: false,
    exportRange: 'week',
    checkInMinutes: 30,
    lastProjectId: null,
    snapTimer: false,                       // opt-in: snap the timer's start and stop to quarter hours
    roundingMode: DEFAULT_ROUNDING_MODE,    // 'nearest' | 'up' | 'down' (no interface yet)
    longRunAck: []                          // ids of running entries the user chose to keep running
  }
};

const listeners = new Set();
let refreshQueued = false;
let refreshSeq = 0;
let latestRefresh = Promise.resolve();

export function onData(cb) {
  listeners.add(cb);
}

export async function loadSettings() {
  state.settings.includeRates = (await getSetting('includeRates', false)) === true;
  state.settings.exportRange = await getSetting('exportRange', 'week');
  state.settings.checkInMinutes = await getSetting('checkInMinutes', 30);
  state.settings.lastProjectId = await getSetting('lastProjectId', null);
  state.settings.snapTimer = (await getSetting('snapTimer', false)) === true;
  state.settings.roundingMode = normalizeMode(await getSetting('roundingMode', DEFAULT_ROUNDING_MODE));
  const ack = await getSetting('longRunAck', []);
  state.settings.longRunAck = Array.isArray(ack) ? ack : [];
}

export async function saveSetting(key, value) {
  state.settings[key] = value;
  await setSetting(key, value);
}

/**
 * Reloads everything from the database and tells the screens. When several reloads overlap, only the
 * newest result is used, so an older and slower read can never overwrite newer data.
 */
export function refreshData() {
  const seq = ++refreshSeq;
  latestRefresh = (async () => {
    const [customers, projects, entries] = await Promise.all([getCustomers(), getProjects(), getEntries()]);
    if (seq !== refreshSeq) return latestRefresh;
    state.customers = customers;
    state.projects = projects;
    state.entries = entries;
    state.customersById = indexById(customers);
    state.projectsById = indexById(projects);
    for (const cb of listeners) {
      try { cb(); } catch (err) { console.error(err); }
    }
    return undefined;
  })();
  return latestRefresh;
}

/** Reload (coalesced) whenever customers, projects or entries change. */
export function watchDatabase() {
  onDataChanged(() => {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(() => {
      refreshQueued = false;
      refreshData().catch(console.error);
    }, 0);
  });
}

/**
 * Active customers with their active projects, for pickers.
 * `keepProjectId` keeps one project visible even when it (or its customer) is inactive.
 */
export function pickerGroups(keepProjectId = null) {
  const groups = [];
  for (const customer of state.customers) {
    const projects = state.projects.filter((p) => p.customerId === customer.id
      && ((customer.isActive && p.isActive) || p.id === keepProjectId));
    if (projects.length) groups.push({ customer, projects });
  }
  return groups;
}
