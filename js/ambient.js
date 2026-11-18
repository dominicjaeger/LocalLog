// LocalLog - status awareness: floating mini window, dynamic tab icon, window title, app badge, reminders.

import { formatClock } from './core/time.js';
import { t } from './i18n.js';

const IDLE_COLOR = '#9CA3AF';
const PAUSED_COLOR = '#F59E0B';

export class AmbientManager {
  constructor(timerEngine) {
    this.timer = timerEngine;
    this.pipWindow = null;

    this.faviconCanvas = document.createElement('canvas');
    this.faviconCanvas.width = 32;
    this.faviconCanvas.height = 32;
    this.faviconContext = this.faviconCanvas.getContext('2d');
    this.faviconLink = document.querySelector("link[rel='icon']") || this.createFaviconLink();

    this.timer.on('tick', (state) => this.onTick(state));
    this.timer.on('stateChange', (state) => this.onStateChange(state));
    this.timer.on('checkIn', (state) => this.triggerCheckIn(state));
  }

  createFaviconLink() {
    const link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
    return link;
  }

  // ---- Mini window (Document Picture-in-Picture; Chrome and Edge) ----

  isPipSupported() {
    return 'documentPictureInPicture' in window;
  }

  isPipActive() {
    return this.pipWindow !== null && !this.pipWindow.closed;
  }

  async togglePip() {
    if (this.isPipActive()) {
      this.closePip();
      return false;
    }
    await this.openPip();
    return this.isPipActive();
  }

  async openPip() {
    if (!this.isPipSupported()) return;
    try {
      this.pipWindow = await window.documentPictureInPicture.requestWindow({ width: 260, height: 90 });
      const doc = this.pipWindow.document;
      doc.title = 'LocalLog';

      // The page's security policy forbids inline styles, so the stylesheet is loaded as a file.
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./css/pip.css', document.baseURI).href;
      doc.head.append(link);

      const dot = doc.createElement('div');
      dot.id = 'miniDot';
      dot.className = 'mini-dot';
      const time = doc.createElement('span');
      time.id = 'miniTime';
      time.className = 'mini-time';
      const project = doc.createElement('span');
      project.id = 'miniProject';
      project.className = 'mini-project';
      const info = doc.createElement('div');
      info.className = 'mini-info';
      info.append(time, project);
      const main = doc.createElement('div');
      main.className = 'mini-main';
      main.append(dot, info);
      const button = doc.createElement('button');
      button.id = 'miniButton';
      button.className = 'mini-btn';
      button.addEventListener('click', () => {
        const state = this.timer.getState();
        if (state.isRunning) this.timer.pause();
        else if (state.isPaused) this.timer.resume();
      });
      doc.body.append(main, button);

      this.pipWindow.addEventListener('pagehide', () => {
        this.pipWindow = null;
        window.dispatchEvent(new CustomEvent('pip-closed'));
      });

      this.updatePipVisuals(this.timer.getState());
      window.dispatchEvent(new CustomEvent('pip-opened'));
    } catch (err) {
      console.error('Could not open the mini window:', err);
      this.pipWindow = null;
    }
  }

  closePip() {
    if (this.pipWindow) {
      this.pipWindow.close();
      this.pipWindow = null;
      window.dispatchEvent(new CustomEvent('pip-closed'));
    }
  }

  updatePipVisuals(state) {
    if (!this.isPipActive()) return;
    const doc = this.pipWindow.document;
    const dot = doc.getElementById('miniDot');
    const time = doc.getElementById('miniTime');
    const project = doc.getElementById('miniProject');
    const button = doc.getElementById('miniButton');
    if (!dot || !time || !project || !button) return;

    time.textContent = formatClock(state.elapsedSeconds || 0);
    if (state.isRunning && state.project) {
      dot.style.backgroundColor = state.colorHex || '#0078D4';
      project.textContent = state.project.name;
      button.textContent = t('timer.pause');
      button.hidden = false;
    } else if (state.isPaused) {
      dot.style.backgroundColor = PAUSED_COLOR;
      project.textContent = t('timer.paused');
      button.textContent = t('timer.resume');
      button.hidden = false;
    } else {
      dot.style.backgroundColor = IDLE_COLOR;
      project.textContent = t('timer.idle');
      button.hidden = true;
    }
  }

  // ---- Tab icon, title, badge ----

  updateDynamicFavicon(colorHex, isRunning, isPaused) {
    const ctx = this.faviconContext;
    ctx.clearRect(0, 0, 32, 32);
    if (isRunning) {
      ctx.beginPath();
      ctx.arc(16, 16, 13, 0, Math.PI * 2);
      ctx.fillStyle = colorHex || '#0078D4';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(16, 16, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    } else if (isPaused) {
      ctx.beginPath();
      ctx.arc(16, 16, 13, 0, Math.PI * 2);
      ctx.fillStyle = PAUSED_COLOR;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(11, 9, 3, 14);
      ctx.fillRect(18, 9, 3, 14);
    } else {
      ctx.beginPath();
      ctx.arc(16, 16, 12, 0, Math.PI * 2);
      ctx.strokeStyle = IDLE_COLOR;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    this.faviconLink.type = 'image/png';
    this.faviconLink.href = this.faviconCanvas.toDataURL('image/png');
  }

  updateDocumentTitle(state) {
    if (state.isRunning && state.project) {
      document.title = `(${formatClock(state.elapsedSeconds || 0)}) ${state.project.name} - LocalLog`;
    } else if (state.isPaused) {
      document.title = `(${t('timer.paused')}) LocalLog`;
    } else {
      document.title = 'LocalLog';
    }
  }

  updateAppBadge(state) {
    if (!('setAppBadge' in navigator)) return;
    if (state.isRunning) {
      const mins = Math.max(1, Math.floor((state.elapsedSeconds || 0) / 60));
      navigator.setAppBadge(mins).catch(() => {});
    } else {
      navigator.clearAppBadge().catch(() => {});
    }
  }

  // ---- Reminder ----

  async requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  }

  triggerCheckIn(state) {
    const projectName = state.project ? state.project.name : '';
    const timeStr = formatClock(state.elapsedSeconds || 0);

    // A system notification only if the user has already allowed them (never asks without a click).
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(t('checkin.notifyTitle'), {
        body: t('checkin.notifyBody', { time: timeStr, project: projectName }),
        icon: './icons/icon-192.png',
        tag: 'checkin-reminder'
      });
      notification.onclick = () => { window.focus(); notification.close(); };
    }
    window.dispatchEvent(new CustomEvent('in-app-checkin', { detail: { projectName, timeStr } }));
  }

  onTick(state) {
    this.updatePipVisuals(state);
    this.updateDocumentTitle(state);
    this.updateAppBadge(state);
  }

  onStateChange(state) {
    this.updateDynamicFavicon(state.colorHex, state.isRunning, state.isPaused);
    this.updatePipVisuals(state);
    this.updateDocumentTitle(state);
    this.updateAppBadge(state);
  }
}
