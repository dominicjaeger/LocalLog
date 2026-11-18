// LocalLog - Dual Ambient Awareness Engine (Document PiP Mini-Timer vs Badge & Notifications)

import { formatDuration } from './csv.js';

export class AmbientManager {
  constructor(timerEngine) {
    this.timer = timerEngine;
    this.pipWindow = null;
    this.mode = 'both'; // 'pip', 'badge', 'both'

    this.faviconCanvas = document.createElement('canvas');
    this.faviconCanvas.width = 32;
    this.faviconCanvas.height = 32;
    this.faviconContext = this.faviconCanvas.getContext('2d');
    this.faviconLink = document.querySelector("link[rel*='icon']") || this.createFaviconLink();

    this.timer.on('tick', (state) => this.onTick(state));
    this.timer.on('stateChange', (state) => this.onStateChange(state));
    this.timer.on('checkIn', (state) => this.triggerCheckInPrompt(state));
  }

  createFaviconLink() {
    const link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
    return link;
  }

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
    } else {
      await this.openPip();
      return true;
    }
  }

  async openPip() {
    if (!this.isPipSupported()) {
      alert('Document Picture-in-Picture is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }

    try {
      this.pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 240,
        height: 90
      });

      // Inject minimal styled HTML into PiP window
      const pipDoc = this.pipWindow.document;
      pipDoc.title = 'LocalLog Floating Orb';

      pipDoc.head.innerHTML = `
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
          body {
            background: #111827;
            color: #F9FAFB;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            height: 100vh;
            user-select: none;
            overflow: hidden;
          }
          .orb-container {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .orb-dot {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #F59E0B;
            border: 2px solid #FFFFFF;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            transition: background 0.3s ease, transform 0.2s ease;
          }
          .info {
            display: flex;
            flex-direction: column;
          }
          .timer-text {
            font-size: 20px;
            font-weight: 700;
            font-family: Consolas, monospace;
            letter-spacing: 0.5px;
          }
          .project-name {
            font-size: 11px;
            color: #9CA3AF;
            max-width: 110px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .pip-btn {
            background: #1F2937;
            border: 1px solid #374151;
            color: #FFFFFF;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
          }
          .pip-btn:hover { background: #374151; }
          .pip-btn:active { transform: scale(0.96); }
        </style>
      `;

      pipDoc.body.innerHTML = `
        <div class="orb-container">
          <div id="pipOrb" class="orb-dot"></div>
          <div class="info">
            <span id="pipTimer" class="timer-text">00:00:00</span>
            <span id="pipProject" class="project-name">Idle</span>
          </div>
        </div>
        <button id="pipBtnAction" class="pip-btn">Pause</button>
      `;

      const btn = pipDoc.getElementById('pipBtnAction');
      btn.addEventListener('click', () => {
        const state = this.timer.getState();
        if (state.isRunning) {
          this.timer.pause();
        } else if (state.isPaused) {
          this.timer.resume();
        }
      });

      this.pipWindow.addEventListener('pagehide', () => {
        this.pipWindow = null;
        window.dispatchEvent(new CustomEvent('pip-closed'));
      });

      this.updatePipVisuals(this.timer.getState());
      window.dispatchEvent(new CustomEvent('pip-opened'));
    } catch (err) {
      console.error('Failed to open Picture-in-Picture window:', err);
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
    const pipDoc = this.pipWindow.document;
    const orb = pipDoc.getElementById('pipOrb');
    const timer = pipDoc.getElementById('pipTimer');
    const proj = pipDoc.getElementById('pipProject');
    const btn = pipDoc.getElementById('pipBtnAction');

    if (!orb || !timer || !proj || !btn) return;

    timer.textContent = formatDuration(state.elapsedSeconds || 0);

    if (state.isRunning && state.activeProject) {
      orb.style.backgroundColor = state.activeProject.colorHex || '#0078D4';
      orb.style.boxShadow = `0 0 12px ${state.activeProject.colorHex || '#0078D4'}`;
      proj.textContent = state.activeProject.name;
      btn.textContent = 'Pause';
      btn.style.display = 'block';
    } else if (state.isPaused && state.activeProject) {
      orb.style.backgroundColor = '#F59E0B';
      orb.style.boxShadow = '0 0 8px #F59E0B';
      proj.textContent = `Paused: ${state.activeProject.name}`;
      btn.textContent = 'Resume';
      btn.style.display = 'block';
    } else {
      orb.style.backgroundColor = '#9CA3AF';
      orb.style.boxShadow = 'none';
      proj.textContent = 'Idle';
      btn.style.display = 'none';
    }
  }

  // ============================================================================
  // BADGE, DYNAMIC FAVICON & TITLE
  // ============================================================================

  updateDynamicFavicon(colorHex, isRunning, isPaused) {
    const ctx = this.faviconContext;
    ctx.clearRect(0, 0, 32, 32);

    if (isRunning) {
      // Solid project-colored circle with white pip
      ctx.beginPath();
      ctx.arc(16, 16, 13, 0, Math.PI * 2);
      ctx.fillStyle = colorHex || '#0078D4';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(16, 16, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    } else if (isPaused) {
      // Amber circle with two vertical pause bars
      ctx.beginPath();
      ctx.arc(16, 16, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#F59E0B';
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(11, 9, 3, 14);
      ctx.fillRect(18, 9, 3, 14);
    } else {
      // Idle hollow ring with subtle dot
      ctx.beginPath();
      ctx.arc(16, 16, 12, 0, Math.PI * 2);
      ctx.strokeStyle = '#9CA3AF';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(16, 16, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#F59E0B';
      ctx.fill();
    }

    this.faviconLink.href = this.faviconCanvas.toDataURL('image/png');
  }

  updateDocumentTitle(state) {
    const timeStr = formatDuration(state.elapsedSeconds || 0);
    if (state.isRunning && state.activeProject) {
      document.title = `(${timeStr}) ${state.activeProject.name} - LocalLog`;
    } else if (state.isPaused && state.activeProject) {
      document.title = `(Paused) ${state.activeProject.name} - LocalLog`;
    } else {
      document.title = 'LocalLog - Local-First Time Tracker';
    }
  }

  updateAppBadge(state) {
    if ('setAppBadge' in navigator) {
      if (state.isRunning) {
        // Can display running minutes
        const mins = Math.max(1, Math.floor((state.elapsedSeconds || 0) / 60));
        navigator.setAppBadge(mins).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }

  // ============================================================================
  // NATIVE WEB NOTIFICATIONS (30-Minute Check-in Prompt)
  // ============================================================================

  async requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  async triggerCheckInPrompt(state) {
    const hasPerm = await this.requestNotificationPermission();
    const projName = state.activeProject ? state.activeProject.name : 'Current Project';
    const timeStr = formatDuration(state.elapsedSeconds || 0);

    if (hasPerm) {
      const notif = new Notification('30-Minute Check-In | LocalLog', {
        body: `You've logged ${timeStr} on "${projName}". Still on this task or ready to switch?`,
        icon: './icons/icon-192.png',
        tag: 'checkin-reminder',
        requireInteraction: false
      });
      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    }

    // In addition, display an accessible toast/banner within the main page
    window.dispatchEvent(new CustomEvent('in-app-checkin', {
      detail: { projName, timeStr }
    }));
  }

  onTick(state) {
    this.updatePipVisuals(state);
    this.updateDocumentTitle(state);
    this.updateAppBadge(state);
  }

  onStateChange(state) {
    const color = state.activeProject ? state.activeProject.colorHex : '#9CA3AF';
    this.updateDynamicFavicon(color, state.isRunning, state.isPaused);
    this.updatePipVisuals(state);
    this.updateDocumentTitle(state);
    this.updateAppBadge(state);
  }
}
