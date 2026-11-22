// "Your data" card, storage warnings, welcome panel and the backup folder settings.

import { state, refreshData } from '../state.js';
import { t, tn } from '../i18n.js';
import { toast } from './dom.js';
import { startOfDay } from '../core/time.js';
import { getSetting, setSetting } from '../storage.js';
import {
  getState, subscribe, backupNow, downloadBackup, hasFolderSupport, pickFolder, folderHasBackup, attachFolder,
  detachFolder, loadFromFolder, writeToFolder, reconnectFolder
} from '../backup.js';

const $ = (id) => document.getElementById(id);
const DAY_MS = 86400000;
const BACKUP_DUE_DAYS = 7;

let afterDataReplaced = async () => {};

function daysSince(iso, now = new Date()) {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS);
}

export function renderStatus() {
  const s = getState();

  // Where the data is saved
  $('dataLocation').textContent = s.folderName ? t('data.browserFolder', { name: s.folderName }) : t('data.browserOnly');

  // Protection
  $('dataProtection').textContent = t(s.persisted ? 'data.protected' : 'data.notProtected');

  // Last backup
  let lastText;
  let due = false;
  if (!s.lastBackupAt) {
    lastText = t('data.never');
    due = state.entries.length > 0;
  } else {
    const days = daysSince(s.lastBackupAt);
    lastText = days <= 0 ? t('data.today') : tn('data.daysAgo', days);
    due = days > BACKUP_DUE_DAYS && state.entries.length > 0;
  }
  $('dataLastBackup').textContent = lastText;
  $('dataBackupRow').classList.toggle('is-due', due);
  $('btnBackupNow').hidden = !due;

  $('dataError').hidden = !s.lastError;
  if (s.lastError) $('dataError').textContent = t('data.writeError');

  // Banners
  $('bannerPrivate').hidden = !s.privateWindow;
  $('bannerFolder').hidden = !(s.folderName && s.permission !== 'granted');

  // Settings tab
  const folderText = !s.folderSupported ? t('settings.folderUnsupported')
    : s.folderName ? t('settings.folderActive', { name: s.folderName }) : t('settings.folderNone');
  $('settingsFolderStatus').textContent = folderText;
  $('btnChooseFolder').hidden = !s.folderSupported;
  $('btnChooseFolder').textContent = t(s.folderName ? 'settings.changeFolder' : 'settings.chooseFolder');
  $('btnDisconnectFolder').hidden = !s.folderName;
  $('btnWelcomeFolder').hidden = !s.folderSupported;
}

// ---------------------------------------------------------------------------
// Folder selection
// ---------------------------------------------------------------------------

function askFolderChoice() {
  return new Promise((resolve) => {
    const dlg = $('dlgFolderChoice');
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
    dlg.showModal();
  });
}

/** A clear message for a backup that could not be loaded. */
function loadErrorText(result) {
  const params = { file: result.detail || '', row: result.row || '' };
  if (result.error === 'badData' && result.row) return t('folder.error.badRow', params);
  return t(`folder.error.${result.error}`, params);
}

export async function chooseFolderFlow() {
  let dir;
  try {
    dir = await pickFolder();
  } catch (err) {
    if (err && err.name !== 'AbortError') toast(t('folder.pickFailed'), 'error');
    return;
  }

  if (await folderHasBackup(dir)) {
    const choice = await askFolderChoice();
    if (choice === 'load') {
      if (!confirm(t('folder.confirmLoad'))) return;
      const result = await loadFromFolder(dir);
      if (!result.ok) {
        toast(loadErrorText(result), 'error');
        return;
      }
      await attachFolder(dir);
      await refreshData();
      await afterDataReplaced();
      toast(t(result.safetyCopy ? 'folder.loadedSafety' : 'folder.loaded'), 'success');
      const notes = result.warnings.map((w) => t(`folder.warn.${w.code}`, { n: w.count }));
      if (notes.length) setTimeout(() => toast(notes.join(' '), 'warning'), 4200);
    } else if (choice === 'replace') {
      if (!confirm(t('folder.confirmReplace'))) return;
      await attachFolder(dir);
      await writeToFolder();
      toast(t('folder.linked', { name: dir.name }), 'success');
    }
    return;
  }

  await attachFolder(dir);
  await writeToFolder();
  toast(t('folder.linked', { name: dir.name }), 'success');
}

// ---------------------------------------------------------------------------
// Welcome panel
// ---------------------------------------------------------------------------

export function showWelcome() {
  const dlg = $('dlgWelcome');
  if (!dlg.open) dlg.showModal();
}

export async function maybeShowWelcome() {
  if ((await getSetting('welcomeSeen', false)) !== true) showWelcome();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export function initStatus({ onDataReplaced }) {
  afterDataReplaced = onDataReplaced;
  subscribe(renderStatus);

  $('btnBackupNow').addEventListener('click', async () => {
    const how = await backupNow();
    toast(t(how === 'folder' ? 'data.backedUpFolder' : 'data.backedUpDownload'), 'success');
  });
  $('btnReconnect').addEventListener('click', async () => {
    const ok = await reconnectFolder();
    toast(t(ok ? 'folder.reconnected' : 'folder.reconnectFailed'), ok ? 'success' : 'error');
  });

  $('btnChooseFolder').addEventListener('click', chooseFolderFlow);
  $('btnDisconnectFolder').addEventListener('click', async () => {
    if (confirm(t('settings.confirmDisconnect'))) await detachFolder();
  });
  $('btnDownloadBackup').addEventListener('click', async () => {
    await downloadBackup();
    toast(t('data.backedUpDownload'), 'success');
  });

  $('btnWelcomeFolder').addEventListener('click', async () => {
    await setSetting('welcomeSeen', true);
    $('dlgWelcome').close();
    chooseFolderFlow();
  });
  $('btnWelcomeOk').addEventListener('click', async () => {
    await setSetting('welcomeSeen', true);
    $('dlgWelcome').close();
  });
  $('btnShowWelcome').addEventListener('click', showWelcome);
  $('dlgWelcome').addEventListener('close', () => { setSetting('welcomeSeen', true).catch(() => {}); });

  if (!hasFolderSupport()) $('btnWelcomeFolder').hidden = true;
}
