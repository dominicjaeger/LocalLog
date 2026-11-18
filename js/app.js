// LocalLog - Main Application Controller (WCAG 2.2 Accessible, Fluent 2 Bento, Light Mode Default)

import { formatDuration, generateTsvForExcel, formatHoursAT } from './csv.js';
import {
  initStorage,
  getProjects,
  saveProject,
  deleteProject,
  getEntries,
  saveEntry,
  deleteEntry,
  resetToDefaultProjects,
  hasFileSystemSupport,
  isFolderBound,
  getBoundFolderName,
  bindLocalDirectory,
  downloadCsvFiles,
  getSetting,
  setSetting
} from './storage.js';
import { TimerEngine } from './timer.js';
import { AmbientManager } from './ambient.js';

let timerEngine = null;
let ambientManager = null;
let deferredPrompt = null;
let includeRates = false;
let currentTheme = 'light';

// DOM Elements
const el = {
  stopwatch: document.getElementById('txtStopwatch'),
  activeRateHint: document.getElementById('txtActiveRateHint'),
  todaySummary: document.getElementById('txtTodaySummary'),
  todayEntriesCount: document.getElementById('txtTodayEntriesCount'),
  folderMiniStatus: document.getElementById('txtFolderMiniStatus'),
  cmbActiveProjects: document.getElementById('cmbActiveProjects'),
  txtQuickNote: document.getElementById('txtQuickNote'),
  btnStartPause: document.getElementById('btnStartPause'),
  btnStop: document.getElementById('btnStop'),
  orbDot: document.getElementById('orbDot'),

  // Entries
  btnAddEntryManual: document.getElementById('btnAddEntryManual'),
  btnCopyTsv: document.getElementById('btnCopyTsv'),
  chkIncludeRates: document.getElementById('chkIncludeRates'),
  txtCopyFeedback: document.getElementById('txtCopyFeedback'),
  tbodyEntries: document.getElementById('tbodyEntries'),
  colHeaderRate: document.getElementById('colHeaderRate'),
  colHeaderValue: document.getElementById('colHeaderValue'),

  // Manual Entry Dialog
  dlgEntry: document.getElementById('dlgEntry'),
  formEntry: document.getElementById('formEntry'),
  dlgEntryTitle: document.getElementById('dlgEntryTitle'),
  dlgEntryId: document.getElementById('dlgEntryId'),
  dlgEntryProject: document.getElementById('dlgEntryProject'),
  dlgEntryDate: document.getElementById('dlgEntryDate'),
  dlgEntryStartTime: document.getElementById('dlgEntryStartTime'),
  dlgEntryEndTime: document.getElementById('dlgEntryEndTime'),
  dlgDurationPreview: document.getElementById('dlgDurationPreview'),
  dlgEntryNote: document.getElementById('dlgEntryNote'),
  btnDlgEntryClose: document.getElementById('btnDlgEntryClose'),
  btnDlgEntryCancel: document.getElementById('btnDlgEntryCancel'),

  // Projects
  formNewProject: document.getElementById('formNewProject'),
  txtProjectName: document.getElementById('txtProjectName'),
  colorProject: document.getElementById('colorProject'),
  txtProjectRate: document.getElementById('txtProjectRate'),
  tbodyProjects: document.getElementById('tbodyProjects'),
  btnResetProjects: document.getElementById('btnResetProjects'),

  // Ambient & Sync
  btnTogglePip: document.getElementById('btnTogglePip'),
  pipSupportAlert: document.getElementById('pipSupportAlert'),
  btnTestNotification: document.getElementById('btnTestNotification'),
  btnBindFolder: document.getElementById('btnBindFolder'),
  txtFolderStatus: document.getElementById('txtFolderStatus'),
  btnManualDownload: document.getElementById('btnManualDownload'),
  btnToggleTheme: document.getElementById('btnToggleTheme'),

  // PWA Install & Offline
  bannerInstall: document.getElementById('bannerInstall'),
  btnInstallPwa: document.getElementById('btnInstallPwa'),
  bannerCheckIn: document.getElementById('bannerCheckIn'),
  txtCheckInMsg: document.getElementById('txtCheckInMsg'),
  btnCheckInKeep: document.getElementById('btnCheckInKeep'),
  btnCheckInSwitch: document.getElementById('btnCheckInSwitch')
};

async function init() {
  setupTheme();
  await initStorage();
  timerEngine = new TimerEngine();
  ambientManager = new AmbientManager(timerEngine);

  includeRates = (await getSetting('includeRates', false)) === true;
  el.chkIncludeRates.checked = includeRates;
  updateRateColumnsVisibility();

  setupEventListeners();
  setupAccessibleTabs();
  setupKeyboardShortcuts();
  setupPwa();

  await refreshAll();

  // Check PiP support
  if (!ambientManager.isPipSupported()) {
    el.btnTogglePip.disabled = true;
    el.btnTogglePip.title = 'Document Picture-in-Picture is only supported in Chromium browsers (Chrome/Edge)';
    el.pipSupportAlert.style.display = 'block';
  }

  updateFolderSyncStatus();
}

// ==============================================================================
// THEME MANAGEMENT (Light Mode Preferred by Default)
// ==============================================================================
function setupTheme() {
  const saved = localStorage.getItem('locallog_theme');
  currentTheme = saved === 'dark' ? 'dark' : 'light';
  applyTheme(currentTheme);

  el.btnToggleTheme.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('locallog_theme', currentTheme);
    applyTheme(currentTheme);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  el.btnToggleTheme.textContent = theme === 'dark' ? '🌙' : '☀️';
  el.btnToggleTheme.setAttribute('aria-label', `Current theme: ${theme}. Click to switch.`);
}

function updateRateColumnsVisibility() {
  el.colHeaderRate.style.display = includeRates ? '' : 'none';
  el.colHeaderValue.style.display = includeRates ? '' : 'none';
}

function updateFolderSyncStatus() {
  if (isFolderBound()) {
    const name = getBoundFolderName();
    el.txtFolderStatus.innerHTML = `Active Local Sync: <strong>${escapeHtml(name)}</strong> (Direct 2-way CSV)`;
    el.folderMiniStatus.textContent = `Disk: ${name}`;
    el.btnBindFolder.textContent = 'Change Synced Folder';
  } else if (!hasFileSystemSupport()) {
    el.txtFolderStatus.textContent = 'File System Access API not available in this browser. Use manual CSV export.';
    el.folderMiniStatus.textContent = 'IndexedDB Only';
    el.btnBindFolder.style.display = 'none';
  } else {
    el.txtFolderStatus.textContent = 'No local folder linked. Click to enable 2-way disk sync.';
    el.folderMiniStatus.textContent = 'IndexedDB (Offline)';
    el.btnBindFolder.textContent = 'Link Local Folder';
  }
}

async function refreshAll() {
  await Promise.all([refreshProjects(), refreshEntries()]);
}

async function refreshProjects() {
  const projects = await getProjects();
  const activeProjects = projects.filter(p => Number(p.isActive) === 1);

  const currentVal = el.cmbActiveProjects.value;
  el.cmbActiveProjects.innerHTML = '';

  if (activeProjects.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No Active Projects (Create one below) --';
    el.cmbActiveProjects.appendChild(opt);
  } else {
    for (const p of activeProjects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.colorHex})`;
      el.cmbActiveProjects.appendChild(opt);
    }
  }

  if (currentVal && activeProjects.some(p => String(p.id) === String(currentVal))) {
    el.cmbActiveProjects.value = currentVal;
  }

  el.tbodyProjects.innerHTML = '';
  for (const p of projects) {
    const tr = document.createElement('tr');
    const isActive = Number(p.isActive) === 1;

    tr.innerHTML = `
      <td>
        <span class="color-badge" style="background-color: ${p.colorHex};"></span>
        <strong>${escapeHtml(p.name)}</strong>
      </td>
      <td>€ ${p.hourlyRate.toFixed(2)}/h</td>
      <td>
        <span class="status-pill ${isActive ? 'pill-active' : 'pill-inactive'}">
          ${isActive ? 'Active' : 'Deactivated'}
        </span>
      </td>
      <td style="text-align: right;">
        <button class="btn btn-sm btn-secondary btn-toggle-act" data-id="${p.id}" aria-label="${isActive ? 'Deactivate' : 'Activate'} ${escapeHtml(p.name)}">
          ${isActive ? 'Deactivate' : 'Activate'}
        </button>
        <button class="btn btn-sm btn-danger btn-del-proj" data-id="${p.id}" style="margin-left: 6px;" aria-label="Delete ${escapeHtml(p.name)}">
          Delete
        </button>
      </td>
    `;
    el.tbodyProjects.appendChild(tr);
  }

  el.tbodyProjects.querySelectorAll('.btn-toggle-act').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      const proj = projects.find(p => p.id === id);
      if (proj) {
        proj.isActive = proj.isActive === 1 ? 0 : 1;
        await saveProject(proj);
        await refreshAll();
      }
    });
  });

  el.tbodyProjects.querySelectorAll('.btn-del-proj').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      const entries = await getEntries();
      const hasEntries = entries.some(e => e.projectId === id);
      if (hasEntries) {
        alert('This project has logged time entries. Deactivate it instead of deleting.');
        return;
      }
      if (confirm('Are you sure you want to delete this project?')) {
        await deleteProject(id);
        await refreshAll();
      }
    });
  });
}

// ==============================================================================
// DATE / TIME HELPERS & MANUAL ENTRY MODAL CONTROLLER
// ==============================================================================
function toLocalDateInputValue(d) {
  if (!(d instanceof Date) || isNaN(d)) d = new Date(d);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalTimeInputValue(d) {
  if (!(d instanceof Date) || isNaN(d)) d = new Date(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
}

function updateDurationPreview() {
  const dateVal = el.dlgEntryDate.value;
  const startVal = el.dlgEntryStartTime.value;
  const endVal = el.dlgEntryEndTime.value;

  if (!dateVal || !startVal || !endVal) {
    el.dlgDurationPreview.innerHTML = 'Calculated Duration: <em>Please enter start and end time</em>';
    return 0;
  }

  const [y, m, d] = dateVal.split('-').map(Number);
  const [sh, sm] = startVal.split(':').map(Number);
  const [eh, em] = endVal.split(':').map(Number);

  const startDt = new Date(y, m - 1, d, sh, sm, 0, 0);
  let endDt = new Date(y, m - 1, d, eh, em, 0, 0);

  let diffSecs = Math.round((endDt.getTime() - startDt.getTime()) / 1000);
  if (diffSecs <= 0) {
    el.dlgDurationPreview.innerHTML = '<span style="color: var(--danger); font-weight: 600;">⚠️ End time must be after start time</span>';
    return -1;
  }

  const hours = Math.round((diffSecs / 3600.0) * 100) / 100;
  const durStr = formatDuration(diffSecs);
  const hoursStr = formatHoursAT(hours);
  el.dlgDurationPreview.innerHTML = `Calculated Duration: <strong>${durStr} (${hoursStr} h)</strong>`;
  return diffSecs;
}

async function populateDialogProjects(selectedId = null) {
  const projects = await getProjects();
  el.dlgEntryProject.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} ${Number(p.isActive) === 1 ? '' : '(Deactivated)'}`;
    if (selectedId && Number(selectedId) === Number(p.id)) {
      opt.selected = true;
    }
    el.dlgEntryProject.appendChild(opt);
  }
}

async function openAddEntryDialog() {
  const projects = await getProjects();
  if (!projects || projects.length === 0) {
    alert('Please create a project first before logging time entries.');
    return;
  }

  el.dlgEntryId.value = '';
  el.dlgEntryTitle.textContent = 'Add Time Entry';

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000);

  el.dlgEntryDate.value = toLocalDateInputValue(now);
  el.dlgEntryStartTime.value = toLocalTimeInputValue(oneHourAgo);
  el.dlgEntryEndTime.value = toLocalTimeInputValue(now);
  el.dlgEntryNote.value = '';

  const activeProjVal = el.cmbActiveProjects.value || (projects[0] ? projects[0].id : null);
  await populateDialogProjects(activeProjVal);
  updateDurationPreview();
  el.dlgEntry.showModal();
}

async function openEditEntryDialog(entryId) {
  const entries = await getEntries();
  const entry = entries.find(e => e.id === Number(entryId));
  if (!entry) return;

  el.dlgEntryId.value = entry.id;
  el.dlgEntryTitle.textContent = 'Edit Time Entry';

  const startDt = new Date(entry.startTime);
  const endDt = new Date(entry.endTime);

  el.dlgEntryDate.value = toLocalDateInputValue(startDt);
  el.dlgEntryStartTime.value = toLocalTimeInputValue(startDt);
  el.dlgEntryEndTime.value = toLocalTimeInputValue(endDt);
  el.dlgEntryNote.value = entry.note || '';

  await populateDialogProjects(entry.projectId);
  updateDurationPreview();
  el.dlgEntry.showModal();
}

async function handleDeleteEntry(entryId) {
  const entries = await getEntries();
  const entry = entries.find(e => e.id === Number(entryId));
  if (!entry) return;

  const desc = `Delete entry "${entry.projectName}" on ${entry.dateDisplay} (${entry.timeRange}, ${entry.durationDisplay})?`;
  if (confirm(desc)) {
    await deleteEntry(entryId);
    await refreshAll();
  }
}

async function refreshEntries() {
  const entries = await getEntries();
  el.tbodyEntries.innerHTML = '';

  const todayStr = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  let todayTotalHours = 0.0;
  let todayBlocksCount = 0;

  if (entries.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${includeRates ? 9 : 7}" style="text-align: center; color: var(--text-muted); padding: 28px;">No logged entries yet. Start a project timer above or add an entry manually!</td>`;
    el.tbodyEntries.appendChild(tr);
  } else {
    for (const e of entries) {
      if (e.dateDisplay === todayStr) {
        todayTotalHours += e.hoursDecimal;
        todayBlocksCount++;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${e.dateDisplay}</td>
        <td>${e.timeRange}</td>
        <td>
          <span class="color-badge" style="background-color: ${e.colorHex};"></span>
          ${escapeHtml(e.projectName)}
        </td>
        <td><code>${e.durationDisplay}</code></td>
        <td><strong>${e.hoursDisplay}</strong></td>
        ${includeRates ? `<td>${e.rateDisplay}</td><td>${e.valueDisplay}</td>` : ''}
        <td>${escapeHtml(e.note)}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-sm btn-secondary btn-entry-edit" data-id="${e.id}" title="Edit entry" aria-label="Edit entry ${e.id}">✏️ Edit</button>
          <button class="btn btn-sm btn-danger btn-entry-del" data-id="${e.id}" title="Delete entry" aria-label="Delete entry ${e.id}" style="margin-left: 4px;">🗑️</button>
        </td>
      `;
      el.tbodyEntries.appendChild(tr);
    }

    el.tbodyEntries.querySelectorAll('.btn-entry-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        openEditEntryDialog(id);
      });
    });

    el.tbodyEntries.querySelectorAll('.btn-entry-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        handleDeleteEntry(id);
      });
    });
  }

  el.todaySummary.textContent = `${todayTotalHours.toFixed(2).replace('.', ',')} h`;
  el.todayEntriesCount.textContent = `${todayBlocksCount} time block${todayBlocksCount === 1 ? '' : 's'} logged today`;
}

function setupEventListeners() {
  timerEngine.on('tick', (state) => {
    el.stopwatch.textContent = formatDuration(state.elapsedSeconds || 0);
  });

  timerEngine.on('stateChange', (state) => {
    el.stopwatch.textContent = formatDuration(state.elapsedSeconds || 0);
    if (state.isRunning && state.activeProject) {
      el.btnStartPause.textContent = 'Pause';
      el.btnStartPause.className = 'btn btn-primary';
      el.btnStop.disabled = false;
      el.activeRateHint.textContent = `${state.activeProject.name} • Internal rate: € ${state.activeProject.hourlyRate.toFixed(2)}/h`;
      el.orbDot.style.backgroundColor = state.activeProject.colorHex;
      el.orbDot.classList.add('orb-pulse');
    } else if (state.isPaused && state.activeProject) {
      el.btnStartPause.textContent = 'Resume';
      el.btnStartPause.className = 'btn btn-primary';
      el.btnStop.disabled = false;
      el.activeRateHint.textContent = `Paused: ${state.activeProject.name}`;
      el.orbDot.style.backgroundColor = '#F59E0B';
      el.orbDot.classList.remove('orb-pulse');
    } else {
      el.btnStartPause.textContent = 'Start';
      el.btnStartPause.className = 'btn btn-primary';
      el.btnStop.disabled = true;
      el.activeRateHint.textContent = 'No timer active';
      el.orbDot.style.backgroundColor = '#9CA3AF';
      el.orbDot.classList.remove('orb-pulse');
    }
  });

  el.btnStartPause.addEventListener('click', toggleTimer);

  el.btnStop.addEventListener('click', async () => {
    await timerEngine.stop();
    el.txtQuickNote.value = '';
    await refreshEntries();
  });

  el.btnCopyTsv.addEventListener('click', copyTsvForExcel);

  el.chkIncludeRates.addEventListener('change', async (e) => {
    includeRates = e.target.checked;
    await setSetting('includeRates', includeRates);
    updateRateColumnsVisibility();
    await refreshEntries();
  });

  el.formNewProject.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el.txtProjectName.value.trim();
    const colorHex = el.colorProject.value;
    const rate = parseFloat(el.txtProjectRate.value.replace(',', '.')) || 0.0;
    if (!name) return;

    await saveProject({
      name,
      colorHex,
      hourlyRate: rate,
      isActive: 1
    });

    el.txtProjectName.value = '';
    el.txtProjectRate.value = '85,00';
    await refreshAll();
  });

  el.btnTogglePip.addEventListener('click', async () => {
    const isOpen = await ambientManager.togglePip();
    updatePipButtonLabel(isOpen);
  });

  window.addEventListener('pip-opened', () => updatePipButtonLabel(true));
  window.addEventListener('pip-closed', () => updatePipButtonLabel(false));

  function updatePipButtonLabel(isActive) {
    el.btnTogglePip.textContent = isActive ? '✕ Close Floating Orb' : '🗔 Floating Orb (PiP)';
    el.btnTogglePip.className = isActive ? 'btn btn-secondary btn-sm' : 'btn btn-outline btn-sm';
  }

  el.btnTestNotification.addEventListener('click', async () => {
    const hasPerm = await ambientManager.requestNotificationPermission();
    if (!hasPerm) {
      alert('Notification permissions are blocked in your browser settings.');
      return;
    }
    ambientManager.triggerCheckInPrompt(timerEngine.getState());
  });

  window.addEventListener('in-app-checkin', (e) => {
    el.txtCheckInMsg.textContent = `30-Minute Check-in: Still working on "${e.detail.projName}" (${e.detail.timeStr})?`;
    el.bannerCheckIn.style.display = 'flex';
  });

  el.btnCheckInKeep.addEventListener('click', () => {
    timerEngine.resetCheckIn();
    el.bannerCheckIn.style.display = 'none';
  });

  el.btnCheckInSwitch.addEventListener('click', () => {
    timerEngine.resetCheckIn();
    el.bannerCheckIn.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  el.btnBindFolder.addEventListener('click', async () => {
    try {
      const folderName = await bindLocalDirectory();
      updateFolderSyncStatus();
      alert(`Local folder linked: "${folderName}"\nprojects.csv and entries.csv are now synchronized directly to disk!`);
    } catch (err) {
      if (err.name !== 'AbortError') alert(err.message);
    }
  });

  el.btnManualDownload.addEventListener('click', async () => {
    await downloadCsvFiles();
  });
}

async function toggleTimer() {
  const state = timerEngine.getState();
  if (state.isRunning) {
    await timerEngine.pause();
  } else if (state.isPaused) {
    timerEngine.resume();
  } else {
    const projId = el.cmbActiveProjects.value;
    if (!projId) {
      alert('Please create or select an active project first.');
      return;
    }
    await timerEngine.start(projId, el.txtQuickNote.value);
  }
}

async function copyTsvForExcel() {
  const entries = await getEntries();
  if (entries.length === 0) {
    el.txtCopyFeedback.textContent = 'No entries to copy!';
    return;
  }
  const tsv = generateTsvForExcel(entries, includeRates);
  await navigator.clipboard.writeText(tsv);
  el.txtCopyFeedback.textContent = `✓ Copied ${entries.length} rows to clipboard! Ready to paste into Excel.`;
  setTimeout(() => {
    el.txtCopyFeedback.textContent = '';
  }, 4000);
}

// ==============================================================================
// WAI-ARIA ACCESSIBLE TABS (Keyboard Arrows, Home, End)
// ==============================================================================
function setupAccessibleTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  function activateTab(tabToActivate, setFocus = true) {
    tabs.forEach(tab => {
      const isTarget = tab === tabToActivate;
      tab.classList.toggle('active', isTarget);
      tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      tab.setAttribute('tabindex', isTarget ? '0' : '-1');
    });

    const targetPanelId = tabToActivate.getAttribute('aria-controls');
    panels.forEach(panel => {
      const isTarget = panel.id === targetPanelId;
      panel.classList.toggle('active', isTarget);
    });

    if (setFocus) tabToActivate.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab, false));

    tab.addEventListener('keydown', (e) => {
      let targetIndex = null;
      if (e.key === 'ArrowRight') {
        targetIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        targetIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        targetIndex = 0;
      } else if (e.key === 'End') {
        targetIndex = tabs.length - 1;
      }

      if (targetIndex !== null) {
        e.preventDefault();
        activateTab(tabs[targetIndex], true);
      }
    });
  });
}

// ==============================================================================
// GLOBAL KEYBOARD SHORTCUTS
// ==============================================================================
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Alt + S -> Toggle Timer Start/Pause
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      toggleTimer();
    }
    // Alt + C -> Copy TSV for Excel
    else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      copyTsvForExcel();
    }
    // Alt + P -> Toggle PiP floating orb
    else if (e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      el.btnTogglePip.click();
    }
    // Escape -> Dismiss checkin banner
    else if (e.key === 'Escape') {
      if (el.bannerCheckIn.style.display !== 'none') {
        el.bannerCheckIn.style.display = 'none';
      }
    }
  });
}

function setupPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    el.bannerInstall.style.display = 'flex';
  });

  el.btnInstallPwa.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        el.bannerInstall.style.display = 'none';
      }
      deferredPrompt = null;
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', init);
