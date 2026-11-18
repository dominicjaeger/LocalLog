// LocalLog - Timer State Machine & Heartbeat Engine

import { getProjects, saveEntry } from './storage.js';

export class TimerEngine {
  constructor() {
    this.state = {
      isRunning: false,
      isPaused: false,
      activeProject: null,
      activeEntryId: null,
      segmentStartTime: null,
      accumulatedSeconds: 0,
      lastCheckpointTime: null,
      lastCheckInTime: null
    };

    this.listeners = {
      tick: [],
      stateChange: [],
      checkIn: []
    };

    this.intervalId = null;
    this.startHeartbeat();
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        try { cb(data); } catch (e) { console.error(`Error in timer listener [${event}]:`, e); }
      }
    }
  }

  getElapsedSeconds() {
    let secs = this.state.accumulatedSeconds;
    if (this.state.isRunning && this.state.segmentStartTime) {
      const currentSegment = Math.floor((Date.now() - this.state.segmentStartTime) / 1000);
      secs += Math.max(0, currentSegment);
    }
    return Math.max(0, secs);
  }

  async start(projectId, note = '') {
    if (this.state.isRunning || this.state.isPaused) {
      await this.stop();
    }

    const projects = await getProjects();
    const proj = projects.find(p => Number(p.id) === Number(projectId));
    if (!proj) throw new Error('Selected project was not found.');

    const now = new Date();
    const newEntry = await saveEntry({
      projectId: proj.id,
      projectName: proj.name,
      startTime: now.toISOString(),
      endTime: '',
      durationSeconds: 0,
      note: (note || '').replace(/[\r\n]/g, ' ')
    });

    this.state.isRunning = true;
    this.state.isPaused = false;
    this.state.activeProject = proj;
    this.state.activeEntryId = newEntry.id;
    this.state.segmentStartTime = now.getTime();
    this.state.accumulatedSeconds = 0;
    this.state.lastCheckpointTime = now.getTime();
    this.state.lastCheckInTime = now.getTime();

    this.emit('stateChange', this.getState());
  }

  async pause() {
    if (!this.state.isRunning) return;
    const elapsed = Math.floor((Date.now() - this.state.segmentStartTime) / 1000);
    this.state.accumulatedSeconds += Math.max(0, elapsed);
    this.state.isRunning = false;
    this.state.isPaused = true;
    this.state.segmentStartTime = null;

    await saveEntry({
      id: this.state.activeEntryId,
      projectId: this.state.activeProject.id,
      projectName: this.state.activeProject.name,
      durationSeconds: this.state.accumulatedSeconds
    });

    this.emit('stateChange', this.getState());
  }

  resume() {
    if (!this.state.isPaused || !this.state.activeProject) return;
    const now = Date.now();
    this.state.segmentStartTime = now;
    this.state.lastCheckpointTime = now;
    this.state.lastCheckInTime = now;
    this.state.isRunning = true;
    this.state.isPaused = false;

    this.emit('stateChange', this.getState());
  }

  async stop(adjustSeconds = 0) {
    if (!this.state.isRunning && !this.state.isPaused) return;

    let totalSecs = this.state.accumulatedSeconds;
    if (this.state.isRunning && this.state.segmentStartTime) {
      totalSecs += Math.floor((Date.now() - this.state.segmentStartTime) / 1000);
    }
    totalSecs = Math.max(1, totalSecs + adjustSeconds);

    const nowIso = new Date().toISOString();
    await saveEntry({
      id: this.state.activeEntryId,
      projectId: this.state.activeProject.id,
      projectName: this.state.activeProject.name,
      endTime: nowIso,
      durationSeconds: totalSecs
    });

    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.activeProject = null;
    this.state.activeEntryId = null;
    this.state.segmentStartTime = null;
    this.state.accumulatedSeconds = 0;
    this.state.lastCheckpointTime = null;
    this.state.lastCheckInTime = null;

    this.emit('stateChange', this.getState());
  }

  resetCheckIn() {
    this.state.lastCheckInTime = Date.now();
  }

  getState() {
    return {
      isRunning: this.state.isRunning,
      isPaused: this.state.isPaused,
      activeProject: this.state.activeProject,
      activeEntryId: this.state.activeEntryId,
      elapsedSeconds: this.getElapsedSeconds()
    };
  }

  startHeartbeat() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(async () => {
      const now = Date.now();
      const elapsed = this.getElapsedSeconds();

      this.emit('tick', {
        ...this.getState(),
        elapsedSeconds: elapsed
      });

      // 60-second crash protection checkpoint save
      if (this.state.isRunning && this.state.lastCheckpointTime) {
        if ((now - this.state.lastCheckpointTime) >= 60000) {
          this.state.lastCheckpointTime = now;
          saveEntry({
            id: this.state.activeEntryId,
            projectId: this.state.activeProject.id,
            projectName: this.state.activeProject.name,
            durationSeconds: elapsed
          }, false).catch(console.error);
        }
      }

      // 30-minute anti-drift check-in
      if (this.state.isRunning && this.state.lastCheckInTime) {
        if ((now - this.state.lastCheckInTime) >= (30 * 60 * 1000)) {
          this.state.lastCheckInTime = now;
          this.emit('checkIn', this.getState());
        }
      }
    }, 1000);
  }
}
