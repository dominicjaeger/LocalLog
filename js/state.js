// In-memory copy of the data for the screens. Reloaded whenever the database changes.

import { getCustomers, getProjects, getEntries, getSetting, setSetting, onDataChanged } from './storage.js';
import { indexById } from './core/export.js';

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
    lastProjectId: null
  }
};

const listeners = new Set();
let refreshQueued = false;

export function onData(cb) {
  listeners.add(cb);
}

export async function loadSettings() {
  state.settings.includeRates = (await getSetting('includeRates', false)) === true;
  state.settings.exportRange = await getSetting('exportRange', 'week');
  state.settings.checkInMinutes = await getSetting('checkInMinutes', 30);
  state.settings.lastProjectId = await getSetting('lastProjectId', null);
}

export async function saveSetting(key, value) {
  state.settings[key] = value;
  await setSetting(key, value);
}

export async function refreshData() {
  const [customers, projects, entries] = await Promise.all([getCustomers(), getProjects(), getEntries()]);
  state.customers = customers;
  state.projects = projects;
  state.entries = entries;
  state.customersById = indexById(customers);
  state.projectsById = indexById(projects);
  for (const cb of listeners) {
    try { cb(); } catch (err) { console.error(err); }
  }
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
