// LocalLog - timer. Pause = segment: pausing closes the current entry, resuming starts a new
// entry with the same project, note and ticket. Every entry is exactly start -> end.
// The running entry lives in the database (empty endTime), so it survives a reload.

import {
  getProjects, getCustomers, getRunningEntries, addEntry, updateEntry, deleteEntry, getSetting, setSetting
} from './storage.js';
import { splitSegment, parseMs } from './core/time.js';

export class TimerEngine {
  constructor() {
    this.running = null;          // raw running entry, or null
    this.paused = null;           // { projectId, note, ticket } while paused
    this.project = null;
    this.customer = null;
    this.accumulated = 0;         // seconds of closed segments in this work session
    this.checkInMinutes = 30;     // 0 = off
    this.lastCheckInTime = null;
    this.lastSeenWrite = 0;
    this.listeners = { tick: [], stateChange: [], checkIn: [] };
    this.intervalId = setInterval(() => this.heartbeat(), 1000);
  }

  on(event, cb) {
    if (this.listeners[event]) this.listeners[event].push(cb);
  }

  emit(event, data) {
    for (const cb of this.listeners[event] || []) {
      try { cb(data); } catch (err) { console.error(`Timer listener [${event}] failed:`, err); }
    }
  }

  async resolve(projectId) {
    const [projects, customers] = await Promise.all([getProjects(), getCustomers()]);
    this.project = projects.find((p) => p.id === projectId) || null;
    this.customer = this.project ? customers.find((c) => c.id === this.project.customerId) || null : null;
  }

  /** Picks up a running entry from the database (after a reload or after data was replaced). Returns it or null. */
  async load() {
    const open = (await getRunningEntries()).sort((a, b) => parseMs(b.startTime) - parseMs(a.startTime));
    // More than one open entry should not happen; drop the older ones (they have no end and no duration).
    for (const stale of open.slice(1)) await deleteEntry(stale.id);

    this.paused = null;
    this.accumulated = 0;
    this.running = open[0] || null;
    if (this.running) {
      await this.resolve(this.running.projectId);
      this.lastCheckInTime = Date.now();
    } else {
      this.project = null;
      this.customer = null;
    }
    this.emit('stateChange', this.getState());
    return this.running;
  }

  setCheckInMinutes(minutes) {
    this.checkInMinutes = Number(minutes) || 0;
    this.lastCheckInTime = Date.now();
  }

  getElapsedSeconds() {
    let secs = this.accumulated;
    if (this.running) {
      const start = parseMs(this.running.startTime);
      if (start !== null) secs += Math.max(0, Math.floor((Date.now() - start) / 1000));
    }
    return secs;
  }

  getState() {
    return {
      isRunning: Boolean(this.running),
      isPaused: Boolean(this.paused),
      entry: this.running,
      project: this.project,
      customer: this.customer,
      colorHex: this.customer ? this.customer.colorHex : null,
      elapsedSeconds: this.getElapsedSeconds()
    };
  }

  async start(projectId, note = '', ticket = '') {
    if (this.running || this.paused) await this.stop();
    await this.resolve(Number(projectId));
    if (!this.project) throw new Error('Selected project was not found.');
    this.running = await addEntry({
      projectId: this.project.id,
      startTime: new Date().toISOString(),
      note,
      ticket
    });
    this.accumulated = 0;
    this.lastCheckInTime = Date.now();
    this.emit('stateChange', this.getState());
  }

  async pause() {
    if (!this.running) return;
    const nowIso = new Date().toISOString();
    const { closePatch, next } = splitSegment(this.running, nowIso);
    const seconds = Math.max(0, Math.round((parseMs(nowIso) - parseMs(this.running.startTime)) / 1000));
    this.accumulated += seconds;
    await updateEntry(this.running.id, closePatch);
    this.paused = { projectId: next.projectId, note: next.note, ticket: next.ticket };
    this.running = null;
    this.emit('stateChange', this.getState());
  }

  async resume() {
    if (!this.paused) return;
    const { projectId, note, ticket } = this.paused;
    await this.resolve(projectId);
    this.running = await addEntry({ projectId, startTime: new Date().toISOString(), note, ticket });
    this.paused = null;
    this.lastCheckInTime = Date.now();
    this.emit('stateChange', this.getState());
  }

  /** Stops the timer. `endIso` lets the caller end it earlier (for example at the last activity). */
  async stop(endIso = null) {
    if (this.running) {
      const start = parseMs(this.running.startTime);
      let end = endIso ? parseMs(endIso) : Date.now();
      if (end === null || end < start) end = Date.now();
      if (end - start < 1000) {
        await deleteEntry(this.running.id); // an accidental click, nothing worth keeping
      } else {
        await updateEntry(this.running.id, { endTime: new Date(end).toISOString() });
      }
    }
    this.running = null;
    this.paused = null;
    this.project = null;
    this.customer = null;
    this.accumulated = 0;
    this.lastCheckInTime = null;
    this.emit('stateChange', this.getState());
  }

  /** The time of the last sign of life, saved about every 30 seconds while a timer runs. */
  async getLastActivity() {
    const iso = await getSetting('lastSeenAt', null);
    return iso || null;
  }

  async updateActive(patch) {
    if (this.running) {
      this.running = await updateEntry(this.running.id, patch);
    } else if (this.paused) {
      this.paused = { ...this.paused, ...patch };
    }
  }

  resetCheckIn() {
    this.lastCheckInTime = Date.now();
  }

  heartbeat() {
    const now = Date.now();
    this.emit('tick', this.getState());

    if (this.running && now - this.lastSeenWrite >= 30000) {
      this.lastSeenWrite = now;
      setSetting('lastSeenAt', new Date(now).toISOString()).catch(() => {});
    }

    if (this.running && this.checkInMinutes > 0 && this.lastCheckInTime
        && now - this.lastCheckInTime >= this.checkInMinutes * 60000) {
      this.lastCheckInTime = now;
      this.emit('checkIn', this.getState());
    }
  }
}
