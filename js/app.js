// LocalLog - main controller: start-up, timer controls, header, tabs, shortcuts, PWA.

import { APP_VERSION } from './version.js';
import { t, detectLanguage, setLanguage, getLanguage } from './i18n.js';
import { initStorage, getSetting, setSetting } from './storage.js';
import { state, loadSettings, saveSetting, refreshData, watchDatabase, onData } from './state.js';
import { initBackup, requestPersistence } from './backup.js';
import { TimerEngine } from './timer.js';
import { AmbientManager } from './ambient.js';
import { formatClock } from './core/time.js';
import { formatTime, formatRate } from './core/format.js';
import { effectiveRate } from './core/export.js';
import { setIcon, setColor, toast, errorText } from './ui/dom.js';
import { fillProjectSelect } from './ui/picker.js';
import { renderEntries, initEntries, tickEntries } from './ui/entries.js';
import { renderCatalog, initCatalog } from './ui/catalog.js';
import { renderWeekly, initWeekly } from './ui/weekly.js';
import { renderStatus, initStatus, maybeShowWelcome } from './ui/status.js';
import { copyTable } from './ui/export.js';

const $ = (id) => document.getElementById(id);

let timer = null;
let ambient = null;
let deferredInstallPrompt = null;
let currentTheme = 'light';
let switchTimeout = null;
let noteTimeout = null;

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

  const savedLanguage = await getSetting('language', null);
  setLanguage(savedLanguage || detectLanguage());
  currentTheme = (await getSetting('theme', 'light')) === 'dark' ? 'dark' : 'light';
  await loadSettings();
  await refreshData();
  watchDatabase();

  timer = new TimerEngine();
  timer.setCheckInMinutes(state.settings.checkInMinutes);
  ambient = new AmbientManager(timer);

  initEntries(() => $('cmbProjects').value);
  initCatalog();
  initWeekly();
  initStatus({ onDataReplaced: reloadTimer });
  setupHeader();
  setupTimerControls();
  setupSettings();
  setupShortcuts();

  onData(renderAll);
  document.addEventListener('rates-toggled', renderAll);
  await initBackup();
  renderAll();
  await reloadTimer();
  maybeShowWelcome();
}

function renderAll() {
  renderPicker();
  renderEntries();
  renderWeekly();
  renderCatalog();
  renderStatus();
  updateTimerView(timer.getState());
}

// ---------------------------------------------------------------------------
// Header: language, theme, mini window
// ---------------------------------------------------------------------------

function setupHeader() {
  const updateLanguageButtons = () => {
    for (const btn of document.querySelectorAll('.lang-btn')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLanguage()));
    }
  };
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
  const label = t(active ? 'mini.close' : 'mini.open');
  const header = $('btnTogglePip');
  setIcon(header, 'miniwindow');
  header.title = label;
  header.setAttribute('aria-label', label);
  $('btnTogglePipSettings').textContent = label;
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

function renderPicker() {
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
  await timer.stop(endIso);
  $('txtQuickNote').value = '';
  $('txtTicket').value = '';
  $('bannerCheckIn').hidden = true;
  $('bannerRecover').hidden = true;
}

/** Picks up a running timer from the database and, if there is one, asks what to do with it. */
async function reloadTimer() {
  const entry = await timer.load();
  if (!entry) return;
  $('txtQuickNote').value = entry.note || '';
  $('txtTicket').value = entry.ticket || '';
  renderPicker();
  $('txtRecoverMsg').textContent = t('recover.msg', {
    project: timer.project ? timer.project.name : '',
    time: formatTime(entry.startTime)
  });
  $('bannerRecover').hidden = false;
}

function setupTimerControls() {
  timer.on('tick', (s) => {
    $('txtStopwatch').textContent = formatClock(s.elapsedSeconds || 0);
    tickEntries();
  });
  timer.on('stateChange', (s) => {
    updateTimerView(s);
    renderPicker();
  });

  $('btnStartPause').addEventListener('click', toggleTimer);
  $('btnStop').addEventListener('click', () => stopTimer());

  // Changing the project while a timer is active switches to the new project.
  $('cmbProjects').addEventListener('change', () => {
    const s = timer.getState();
    const projectId = Number($('cmbProjects').value);
    if (!projectId) return;
    saveSetting('lastProjectId', projectId);
    if (s.isRunning && s.project && s.project.id !== projectId) {
      clearTimeout(switchTimeout);
      // Wait a moment so that arrow-keying through the list does not create many entries.
      switchTimeout = setTimeout(async () => {
        try {
          await timer.start(projectId, $('txtQuickNote').value, $('txtTicket').value);
        } catch (err) {
          console.error(err);
        }
      }, 800);
    } else if (s.isPaused) {
      timer.updateActive({ projectId }).catch(console.error);
    }
  });

  // Note and ticket changes are applied to the active entry.
  const applyNoteAndTicket = () => {
    clearTimeout(noteTimeout);
    noteTimeout = setTimeout(() => {
      timer.updateActive({ note: $('txtQuickNote').value, ticket: $('txtTicket').value }).catch(console.error);
    }, 500);
  };
  $('txtQuickNote').addEventListener('input', applyNoteAndTicket);
  $('txtTicket').addEventListener('input', applyNoteAndTicket);

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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function setupSettings() {
  const select = $('selCheckIn');
  select.value = String(state.settings.checkInMinutes);
  select.addEventListener('change', async () => {
    const minutes = Number(select.value);
    await saveSetting('checkInMinutes', minutes);
    timer.setCheckInMinutes(minutes);
    if (minutes > 0) await ambient.requestNotificationPermission();
  });
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

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
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // A new version took over: reload once so the new files are used.
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
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
