// LocalLog - main controller: start-up, timer controls, header, tabs, shortcuts, PWA.

import { APP_VERSION } from './version.js';
import { t, detectLanguage, setLanguage, getLanguage } from './i18n.js';
import { initStorage, getSetting, setSetting, onRemoteChange, updateEntry, updateEntryIfOpen } from './storage.js';
import { state, loadSettings, saveSetting, refreshData, watchDatabase, onData } from './state.js';
import { initBackup, requestPersistence } from './backup.js';
import { TimerEngine, RECOVER_AFTER_MS } from './timer.js';
import { AmbientManager } from './ambient.js';
import {
  formatClock, parseMs, overlappingEntries, toTimeInputValue, latestOccurrenceUpTo, firstOccurrenceAfter,
  isLongRunning
} from './core/time.js';
import { formatTime, formatDate, formatRate } from './core/format.js';
import { effectiveRate } from './core/export.js';
import { validateStartNotFuture } from './core/validate.js';
import { setIcon, setColor, toast, errorText } from './ui/dom.js';
import { fillProjectSelect } from './ui/picker.js';
import { renderEntries, initEntries, tickEntries } from './ui/entries.js';
import { renderCatalog, initCatalog } from './ui/catalog.js';
import { renderWeekly, initWeekly } from './ui/weekly.js';
import { renderDay, initDay, tickDay, goToDay } from './ui/day.js';
import { renderStatus, initStatus, maybeShowWelcome } from './ui/status.js';
import { copyTable } from './ui/export.js';

const $ = (id) => document.getElementById(id);

const SWITCH_DELAY_MS = 800;       // wait before a project change starts a new entry (arrow keys)
const NOTE_SAVE_DELAY_MS = 500;
const LONG_RUN_ACK_LIMIT = 50;     // how many "keep running" answers are remembered

let timer = null;
let ambient = null;
let deferredInstallPrompt = null;
let currentTheme = 'light';
let switchTimeout = null;
let noteTimeout = null;
let editingStart = false;
let fieldsFollowedEntry = false;
let awayInfo = null;

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function init() {
  // Show the right language straight away; the saved choice is applied once the database is open.
  setLanguage(detectLanguage());
  $('appVersion').textContent = `v${APP_VERSION}`;
  $('footerVersion').textContent = `LocalLog v${APP_VERSION}`;
  $('techVersion').textContent = APP_VERSION;
  setupTabs();
  setupPwa();

  try {
    await initStorage();
  } catch (err) {
    console.error(err);
    $('bannerPrivate').querySelector('span').textContent = t('err.storage');
    $('bannerPrivate').hidden = false;
    return;
  }

  await applyPreferences();
  await refreshData();
  watchDatabase();

  timer = new TimerEngine();
  applyTimerSettings();
  ambient = new AmbientManager(timer);
  // A handle for testing in the browser console (for example to simulate a gap in the heartbeat).
  window.localLog = { timer };

  const entriesApi = initEntries({ getPreferredProjectId: () => $('cmbProjects').value, adjustStart });
  initCatalog();
  initDay({ openAddDialog: entriesApi.openAddDialog });
  initWeekly({ openDay: (date) => { goToDay(date); showTab('tab-btn-day'); } });
  initStatus({ onDataReplaced: reloadTimer });
  setupHeader();
  setupTimerControls();
  setupSettings();
  setupShortcuts();

  // After every change of the data (here or in another tab) the timer re-reads the database first.
  onData(() => { timer.sync().catch(console.error).finally(renderAll); });
  document.addEventListener('rates-toggled', renderAll);
  onRemoteChange(handleRemoteChange);
  await initBackup();
  renderAll();
  await reloadTimer();
  timer.startHeartbeat();
  maybeShowWelcome();
}

/** Language, theme and the other saved settings. */
async function applyPreferences() {
  const savedLanguage = await getSetting('language', null);
  setLanguage(savedLanguage || detectLanguage());
  currentTheme = (await getSetting('theme', 'light')) === 'dark' ? 'dark' : 'light';
  await loadSettings();
}

function applyTimerSettings() {
  timer.setCheckInMinutes(state.settings.checkInMinutes);
  timer.setOptions({ snap: state.settings.snapTimer, roundingMode: state.settings.roundingMode });
}

/** Another LocalLog tab changed data or a setting: follow it. */
async function handleRemoteChange(message) {
  try {
    if (message.type === 'settings') {
      await applyPreferences();
      applyTimerSettings();
      updateLanguageButtons();
      applyTheme();
      updatePipButtons(ambient.isPipActive());
      syncSettingsControls();
    }
    await refreshData();
  } catch (err) {
    console.error(err);
  }
}

function renderAll() {
  renderPicker();
  renderEntries();
  renderDay();
  renderWeekly();
  renderCatalog();
  renderStatus();
  updateTimerView(timer.getState());
}

// ---------------------------------------------------------------------------
// Header: language, theme, mini window
// ---------------------------------------------------------------------------

function updateLanguageButtons() {
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLanguage()));
  }
}

function setupHeader() {
  updateLanguageButtons();
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.addEventListener('click', async () => {
      setLanguage(btn.dataset.lang);
      await setSetting('language', btn.dataset.lang);
      updateLanguageButtons();
      applyTheme();
      updatePipButtons(ambient.isPipActive());
      renderAll();
    });
  }

  applyTheme();
  $('btnToggleTheme').addEventListener('click', async () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    await setSetting('theme', currentTheme);
    applyTheme();
  });

  if (ambient.isPipSupported()) {
    $('btnTogglePip').hidden = false;
    $('pipCard').hidden = false;
    updatePipButtons(false);
    const toggle = async () => updatePipButtons(await ambient.togglePip());
    $('btnTogglePip').addEventListener('click', toggle);
    $('btnTogglePipSettings').addEventListener('click', toggle);
    window.addEventListener('pip-opened', () => updatePipButtons(true));
    window.addEventListener('pip-closed', () => updatePipButtons(false));
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  const button = $('btnToggleTheme');
  setIcon(button, currentTheme === 'dark' ? 'sun' : 'moon');
  const label = t(currentTheme === 'dark' ? 'header.theme.dark' : 'header.theme.light');
  button.setAttribute('aria-label', label);
  button.title = label;
}

function updatePipButtons(active) {
  if (!ambient.isPipSupported()) return;
  const label = t(active ? 'mini.close' : 'mini.open');
  const header = $('btnTogglePip');
  setIcon(header, 'miniwindow');
  header.title = label;
  header.setAttribute('aria-label', label);
  $('btnTogglePipSettings').textContent = label;
}

// ---------------------------------------------------------------------------
// Timer view
// ---------------------------------------------------------------------------

function renderPicker() {
  if (switchTimeout) return; // the user just changed the project and the switch is about to happen
  const select = $('cmbProjects');
  const keep = select.value || state.settings.lastProjectId;
  fillProjectSelect(select, keep);
  // While a timer is active the picker shows the active project.
  const active = timer && timer.getState().project;
  if (active && select.querySelector(`option[value="${active.id}"]`)) select.value = String(active.id);
}

function updateTimerView(s) {
  $('txtStopwatch').textContent = formatClock(s.elapsedSeconds || 0);
  const orb = $('orbDot');
  const start = $('btnStartPause');
  const hint = $('txtActiveHint');
  const name = s.project && s.customer ? t('timer.running', { customer: s.customer.name, project: s.project.name }) : '';

  if (s.isRunning && s.project) {
    start.textContent = t('timer.pause');
    $('btnStop').disabled = false;
    const rate = effectiveRate(s.project, s.customer);
    hint.textContent = name + (state.settings.includeRates && rate !== null ? ` · ${formatRate(rate)}` : '');
    setColor(orb, s.colorHex || '#0078D4');
    orb.classList.add('orb-pulse');
  } else if (s.isPaused) {
    start.textContent = t('timer.resume');
    $('btnStop').disabled = false;
    hint.textContent = t('timer.paused');
    setColor(orb, '#F59E0B');
    orb.classList.remove('orb-pulse');
  } else {
    start.textContent = t('timer.start');
    $('btnStop').disabled = true;
    hint.textContent = t('timer.noneActive');
    setColor(orb, '#9CA3AF');
    orb.classList.remove('orb-pulse');
  }

  // Start time and the quick buttons are only there while a timer runs.
  $('startAdjust').hidden = !s.isRunning;
  if (s.isRunning) {
    $('btnStartedAt').textContent = t('timer.since', { time: formatTime(s.entry.startTime) });
  } else if (editingStart) {
    cancelStartEdit();
  }
}

/** Project, ticket and note follow the entry, unless the user is typing in them right now. */
function followEntryFields(s) {
  const source = s.isRunning ? s.entry : (s.isPaused ? s.paused : null);
  const note = $('txtQuickNote');
  const ticket = $('txtTicket');
  if (source) {
    if (!noteTimeout) {
      if (document.activeElement !== note) note.value = source.note || '';
      if (document.activeElement !== ticket) ticket.value = source.ticket || '';
    }
    fieldsFollowedEntry = true;
  } else if (fieldsFollowedEntry) {
    // The timer was stopped (here or in another tab): empty the fields for the next entry.
    if (document.activeElement !== note) note.value = '';
    if (document.activeElement !== ticket) ticket.value = '';
    fieldsFollowedEntry = false;
  }
}

/** Banners that only make sense while a timer is running go away when it stops. */
function hideRunningBanners(s) {
  if (s.isRunning) return;
  for (const id of ['bannerCheckIn', 'bannerRecover', 'bannerAway', 'bannerLong']) $(id).hidden = true;
  awayInfo = null;
}

async function toggleTimer() {
  const s = timer.getState();
  try {
    if (s.isRunning) {
      await timer.pause();
    } else if (s.isPaused) {
      await timer.resume();
    } else {
      const projectId = $('cmbProjects').value;
      if (!projectId) {
        toast(t('timer.needProject'), 'warning');
        return;
      }
      await timer.start(projectId, $('txtQuickNote').value, $('txtTicket').value);
      await saveSetting('lastProjectId', Number(projectId));
      requestPersistence();
    }
  } catch (err) {
    console.error(err);
    toast(errorText('startFailed'), 'error');
  }
}

async function stopTimer(endIso = null) {
  clearTimeout(noteTimeout);
  noteTimeout = null;
  await timer.stop(endIso);
  $('txtQuickNote').value = '';
  $('txtTicket').value = '';
  fieldsFollowedEntry = false;
  for (const id of ['bannerCheckIn', 'bannerRecover', 'bannerAway', 'bannerLong']) $(id).hidden = true;
  awayInfo = null;
}

/** Picks up a running timer from the database. After a reload it only asks what to do when the app was closed for a while. */
async function reloadTimer() {
  const entry = await timer.load();
  if (!entry) return;
  const note = $('txtQuickNote');
  const ticket = $('txtTicket');
  if (document.activeElement !== note) note.value = entry.note || '';
  if (document.activeElement !== ticket) ticket.value = entry.ticket || '';
  fieldsFollowedEntry = true;
  renderPicker();

  const last = parseMs(await timer.getLastActivity());
  const wasAway = last === null || Date.now() - last > RECOVER_AFTER_MS;
  if (!wasAway) return; // the timer simply continues
  $('txtRecoverMsg').textContent = t('recover.msg', {
    project: timer.project ? timer.project.name : '',
    time: formatTime(entry.startTime)
  });
  $('bannerRecover').hidden = false;
}

// ---------------------------------------------------------------------------
// Start time of the running entry
// ---------------------------------------------------------------------------

/** Moves the start of the running entry to `newStartMs` (checked, never later than now). */
async function applyStart(newStartMs) {
  const s = timer.getState();
  if (!s.isRunning) return false;
  const error = validateStartNotFuture(newStartMs, Date.now());
  if (error) { toast(errorText(error), 'error'); return false; }
  const startIso = new Date(newStartMs).toISOString();
  // Overlaps only give a warning; nothing else is changed.
  if (overlappingEntries({ ...s.entry, startTime: startIso }, state.entries).length > 0) {
    toast(t('entry.overlapWarning'), 'warning');
  }
  try {
    return await timer.setStart(startIso);
  } catch (err) {
    console.error(err);
    toast(errorText('saveFailed'), 'error');
    return false;
  }
}

/** The -5 / -15 minute buttons. */
async function adjustStart(minutes) {
  const s = timer.getState();
  if (!s.isRunning) return;
  await applyStart(parseMs(s.entry.startTime) - minutes * 60000);
}

function startStartEdit() {
  const s = timer.getState();
  if (!s.isRunning) return;
  editingStart = true;
  const input = $('inpStartedAt');
  input.value = toTimeInputValue(new Date(s.entry.startTime));
  $('btnStartedAt').hidden = true;
  input.hidden = false;
  input.focus();
}

function cancelStartEdit() {
  editingStart = false;
  $('inpStartedAt').hidden = true;
  $('btnStartedAt').hidden = false;
}

async function commitStartEdit() {
  if (!editingStart) return;
  const input = $('inpStartedAt');
  const value = input.value;
  cancelStartEdit();
  const s = timer.getState();
  if (!s.isRunning || !value) return;
  if (value === toTimeInputValue(new Date(s.entry.startTime))) return; // unchanged
  // A time that has not happened yet today means yesterday (corrections across midnight).
  const date = latestOccurrenceUpTo(Date.now(), value);
  if (!date) { toast(errorText('invalidTime'), 'error'); return; }
  await applyStart(date.getTime());
}

// ---------------------------------------------------------------------------
// Away and long-running banners
// ---------------------------------------------------------------------------

function showAway({ from, to }) {
  // A second gap while the banner is still open extends the first one.
  awayInfo = awayInfo ? { from: awayInfo.from, to } : { from, to };
  $('txtAwayMsg').textContent = t('away.msg', { from: formatTime(awayInfo.from), to: formatTime(awayInfo.to) });
  $('btnAwayStop').textContent = t('away.stop', { from: formatTime(awayInfo.from) });
  $('bannerAway').hidden = false;
}

function checkLongRunning(s) {
  if (!s.isRunning) return;
  const banner = $('bannerLong');
  const acknowledged = state.settings.longRunAck.includes(s.entry.id);
  if (acknowledged) { banner.hidden = true; return; }
  if (!banner.hidden || !$('bannerRecover').hidden) return;
  if (!isLongRunning(s.entry)) return;

  const start = new Date(s.entry.startTime);
  $('txtLongMsg').textContent = t('long.msg', { since: `${formatDate(start)} ${formatTime(start)}` });
  // Suggest the time of the last sign of life, which is usually when the work ended.
  timer.getLastActivity().then((last) => {
    const lastMs = parseMs(last);
    const useLast = lastMs !== null && lastMs > start.getTime();
    $('inpLongStop').value = toTimeInputValue(new Date(useLast ? lastMs : Date.now()));
  });
  banner.hidden = false;
}

function setupAwayAndLongBanners() {
  timer.on('away', showAway);

  $('btnAwayKeep').addEventListener('click', () => { $('bannerAway').hidden = true; awayInfo = null; });
  $('btnAwayBreak').addEventListener('click', async () => {
    const info = awayInfo;
    $('bannerAway').hidden = true;
    awayInfo = null;
    if (info) await timer.splitAway(info.from, info.to).catch(console.error);
  });
  $('btnAwayStop').addEventListener('click', async () => {
    const info = awayInfo;
    if (info) await stopTimer(new Date(info.from).toISOString());
  });

  $('btnLongKeep').addEventListener('click', async () => {
    const s = timer.getState();
    $('bannerLong').hidden = true;
    if (!s.isRunning) return;
    const ack = [...state.settings.longRunAck, s.entry.id].slice(-LONG_RUN_ACK_LIMIT);
    await saveSetting('longRunAck', ack);
  });
  $('btnLongStopAt').addEventListener('click', async () => {
    const s = timer.getState();
    if (!s.isRunning) return;
    const startMs = parseMs(s.entry.startTime);
    // The first time after the start that shows the typed clock time (the day the timer was forgotten).
    const end = firstOccurrenceAfter(startMs, $('inpLongStop').value);
    if (!end) { toast(errorText('invalidTime'), 'error'); return; }
    if (end.getTime() > Date.now()) { toast(errorText('endBeforeStart'), 'error'); return; }
    await stopTimer(end.toISOString());
  });
  $('btnLongStopNow').addEventListener('click', () => stopTimer());
}

// ---------------------------------------------------------------------------
// Timer controls
// ---------------------------------------------------------------------------

function setupTimerControls() {
  timer.on('tick', (s) => {
    $('txtStopwatch').textContent = formatClock(s.elapsedSeconds || 0);
    tickEntries();
    tickDay();
    checkLongRunning(s);
  });
  timer.on('stateChange', (s) => {
    updateTimerView(s);
    renderPicker();
    followEntryFields(s);
    hideRunningBanners(s);
  });
  timer.on('notice', ({ key, kind, params }) => toast(t(key, params), kind));

  $('btnStartPause').addEventListener('click', toggleTimer);
  $('btnStop').addEventListener('click', () => stopTimer());

  // Start time: quick buttons, and clicking the time opens an input.
  $('btnBack5').addEventListener('click', () => adjustStart(5));
  $('btnBack15').addEventListener('click', () => adjustStart(15));
  $('btnStartedAt').addEventListener('click', startStartEdit);
  const startInput = $('inpStartedAt');
  startInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitStartEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelStartEdit(); }
  });
  startInput.addEventListener('blur', commitStartEdit);

  // Changing the project while a timer is active.
  $('cmbProjects').addEventListener('change', () => {
    const s = timer.getState();
    const projectId = Number($('cmbProjects').value);
    if (!projectId) return;
    saveSetting('lastProjectId', projectId);
    clearTimeout(switchTimeout);
    switchTimeout = null;
    if (s.isRunning && s.project && s.project.id !== projectId) {
      if (timer.canCorrectProject()) {
        // Within the first minutes this is a correction of the entry, not a new entry.
        const previousId = s.project.id;
        const entryId = s.entry.id;
        timer.updateActive({ projectId })
          .then((saved) => {
            if (!saved) return;
            const now = timer.getState();
            const label = now.project && now.customer ? `${now.customer.name} › ${now.project.name}` : '';
            toast(t('timer.projectCorrectedTo', { project: label }), 'success', {
              label: t('timer.undo'),
              onClick: () => undoProjectCorrection(entryId, previousId)
            });
          })
          .catch(console.error);
        return;
      }
      // Wait a moment so that arrow-keying through the list does not create many entries.
      switchTimeout = setTimeout(async () => {
        switchTimeout = null;
        try {
          await timer.start(projectId, $('txtQuickNote').value, $('txtTicket').value);
        } catch (err) {
          console.error(err);
        }
      }, SWITCH_DELAY_MS);
    } else if (s.isPaused) {
      timer.updateActive({ projectId }).catch(console.error);
    }
  });

  // Note and ticket changes are applied to the active entry.
  const saveNoteAndTicket = () => {
    clearTimeout(noteTimeout);
    noteTimeout = null;
    timer.updateActive({ note: $('txtQuickNote').value, ticket: $('txtTicket').value }).catch(console.error);
  };
  const applyNoteAndTicket = () => {
    clearTimeout(noteTimeout);
    noteTimeout = setTimeout(saveNoteAndTicket, NOTE_SAVE_DELAY_MS);
  };
  for (const input of [$('txtQuickNote'), $('txtTicket')]) {
    input.addEventListener('input', applyNoteAndTicket);
    // Leaving the field saves at once, so the entry never falls behind what is on the screen.
    input.addEventListener('blur', () => { if (noteTimeout) saveNoteAndTicket(); });
  }

  setupAwayAndLongBanners();

  // Reminder banner
  window.addEventListener('in-app-checkin', (e) => {
    $('txtCheckInMsg').textContent = t('checkin.msg', { project: e.detail.projectName, time: e.detail.timeStr });
    $('bannerCheckIn').hidden = false;
  });
  $('btnCheckInKeep').addEventListener('click', () => {
    timer.resetCheckIn();
    $('bannerCheckIn').hidden = true;
  });
  $('btnCheckInSwitch').addEventListener('click', () => {
    timer.resetCheckIn();
    $('bannerCheckIn').hidden = true;
    $('cmbProjects').scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('cmbProjects').focus();
  });
  $('btnCheckInStop').addEventListener('click', () => stopTimer());

  // Running timer found after a reload
  $('btnRecoverKeep').addEventListener('click', () => { $('bannerRecover').hidden = true; });
  $('btnRecoverNow').addEventListener('click', () => stopTimer());
  $('btnRecoverLast').addEventListener('click', async () => {
    await stopTimer(await timer.getLastActivity());
  });
}

/** Undo of the 2-minute project correction: writes the previous project back (also when the entry was stopped). */
async function undoProjectCorrection(entryId, previousProjectId) {
  try {
    const saved = await updateEntryIfOpen(entryId, { projectId: previousProjectId });
    // The entry was stopped in the meantime: the correction concerned this same entry, so write it anyway.
    if (!saved) await updateEntry(entryId, { projectId: previousProjectId });
    await saveSetting('lastProjectId', previousProjectId);
    await timer.sync();
    const picker = $('cmbProjects');
    if (picker.querySelector(`option[value="${previousProjectId}"]`)) picker.value = String(previousProjectId);
  } catch (err) {
    console.error(err);
    toast(errorText('saveFailed'), 'error');
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function syncSettingsControls() {
  $('selCheckIn').value = String(state.settings.checkInMinutes);
  $('chkSnap').checked = state.settings.snapTimer;
}

function setupSettings() {
  syncSettingsControls();
  $('selCheckIn').addEventListener('change', async () => {
    const minutes = Number($('selCheckIn').value);
    await saveSetting('checkInMinutes', minutes);
    timer.setCheckInMinutes(minutes);
    if (minutes > 0) await ambient.requestNotificationPermission();
  });
  $('chkSnap').addEventListener('change', async () => {
    await saveSetting('snapTimer', $('chkSnap').checked);
    applyTimerSettings();
  });
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

let showTabById = () => {};
const showTab = (id) => showTabById(id);

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  function activate(tab, focus) {
    for (const other of tabs) {
      const on = other === tab;
      other.classList.toggle('active', on);
      other.setAttribute('aria-selected', String(on));
      other.setAttribute('tabindex', on ? '0' : '-1');
    }
    const target = tab.getAttribute('aria-controls');
    for (const panel of panels) panel.classList.toggle('active', panel.id === target);
    if (focus) tab.focus();
  }

  showTabById = (id) => {
    const tab = tabs.find((x) => x.id === id);
    if (tab) activate(tab, false);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab, false));
    tab.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next !== null) {
        e.preventDefault();
        activate(tabs[next], true);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

function setupShortcuts() {
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (e.altKey && key === 's') {
      e.preventDefault();
      toggleTimer();
    } else if (e.altKey && key === 'c') {
      e.preventDefault();
      copyTable({ kind: state.settings.exportRange });
    } else if (e.altKey && key === 'p') {
      e.preventDefault();
      if (!$('btnTogglePip').hidden) $('btnTogglePip').click();
    } else if (e.key === 'Escape' && !$('bannerCheckIn').hidden) {
      $('bannerCheckIn').hidden = true;
    }
  });
}

// ---------------------------------------------------------------------------
// App installation and updates
// ---------------------------------------------------------------------------

function setupPwa() {
  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // A new version took over. Never reload by itself (unsaved input would be lost): offer a button.
      if (hadController) $('bannerUpdate').hidden = false;
    });
    $('btnUpdateReload').addEventListener('click', () => location.reload());
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered:', err));
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    $('bannerInstall').hidden = false;
  });
  $('btnInstallPwa').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') $('bannerInstall').hidden = true;
    deferredInstallPrompt = null;
  });
}

document.addEventListener('DOMContentLoaded', init);
