// LocalLog - timer. Pause = segment: pausing closes the current entry, resuming starts a new
// entry with the same project, note and ticket (or, within a minute, continues the same entry).
// Every entry is exactly start -> end.
//
// The running entry lives in the database (empty endTime). The engine only keeps a copy for display
// and re-reads the database after every change, in this tab and in other tabs. Every write that
// closes or changes the running entry is guarded: it checks inside the write transaction that the
// entry is still open, so two tabs can never overwrite each other.
//
// No DOM access. Events: tick, stateChange, checkIn, away, notice.

import {
  getProjects, getCustomers, getRunningEntries, addEntry, updateEntryIfOpen, deleteEntryIfOpen,
  reopenEntry, getSetting, setSetting
} from './storage.js';
import { parseMs, entryDurationSeconds, repairOpenEntries } from './core/time.js';
import { snapStart, snapEnd, GRID_MS, DEFAULT_ROUNDING_MODE } from './core/rounding.js';

/** Changing the project within this time after the entry was created corrects that entry (R6). */
export const PROJECT_CORRECTION_MS = 2 * 60 * 1000;
/** Resuming within this time after a pause continues the previous entry (R12). */
export const RESUME_JOIN_MS = 60 * 1000;
/** A gap between two heartbeat ticks longer than this counts as "away" (R14). */
export const AWAY_GAP_MS = 10 * 60 * 1000;
/** After a reload the "timer was running" prompt only appears when the last sign of life is older (R13). */
export const RECOVER_AFTER_MS = 5 * 60 * 1000;
/** An entry that is closed within this time after it was created is an accidental click and is dropped. */
const ACCIDENTAL_MS = 1000;
const LAST_SEEN_EVERY_MS = 30000;

const iso = (ms) => new Date(ms).toISOString();
const byStart = (a, b) => parseMs(a.startTime) - parseMs(b.startTime);

export class TimerEngine {
  constructor() {
    this.running = null;          // the open entry as read from the database, or null
    this.paused = null;           // { projectId, note, ticket, entryId, endTime, at, seconds } while paused
    this.project = null;
    this.customer = null;
    this.options = { snap: false, roundingMode: DEFAULT_ROUNDING_MODE };
    this.checkInMinutes = 30;     // 0 = off
    this.lastCheckInTime = null;
    this.lastSeenWrite = 0;
    this.lastTickAt = null;
    this.intervalId = null;
    this.queue = Promise.resolve();
    this.listeners = { tick: [], stateChange: [], checkIn: [], away: [], notice: [] };
  }

  /** Starts the one-second heartbeat. Call it once the start-up checks are done. */
  startHeartbeat() {
    if (this.intervalId) return;
    this.lastTickAt = Date.now();
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

  notice(key, kind = 'info', params = undefined) {
    this.emit('notice', { key, kind, params });
  }

  /** Runs one change at a time, so that a reload can never interleave with a pause or a stop. */
  exclusive(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
  }

  async resolve(projectId) {
    const [projects, customers] = await Promise.all([getProjects(), getCustomers()]);
    this.project = projects.find((p) => p.id === projectId) || null;
    this.customer = this.project ? customers.find((c) => c.id === this.project.customerId) || null : null;
  }

  // ---------------------------------------------------------------------------
  // Reading the database
  // ---------------------------------------------------------------------------

  /** Picks up the running entry (and a saved pause) from the database. Returns the running entry or null. */
  load() {
    return this.exclusive(() => this.syncFromDatabase());
  }

  /** Same as load(); called after every data change in this tab or another tab. */
  sync() {
    return this.load();
  }

  async syncFromDatabase() {
    const open = (await getRunningEntries()).filter((e) => parseMs(e.startTime) !== null).sort(byStart);

    // More than one open entry should not happen. Close the older ones; never delete them.
    if (open.length > 1) {
      for (const patch of repairOpenEntries(open)) await updateEntryIfOpen(patch.id, { endTime: patch.endTime });
      this.notice('timer.repaired', 'warning');
    }
    const entry = open.length ? open[open.length - 1] : null;
    const previousId = this.running ? this.running.id : null;
    this.running = entry;

    if (entry) {
      await this.resolve(entry.projectId);
      this.paused = null;
      if (await getSetting('timerPaused', null)) await setSetting('timerPaused', null);
      if (previousId !== entry.id) this.lastCheckInTime = Date.now();
    } else {
      const saved = await getSetting('timerPaused', null);
      this.paused = null;
      this.project = null;
      this.customer = null;
      if (saved && typeof saved === 'object') {
        await this.resolve(saved.projectId);
        if (this.project) this.paused = saved;
      }
    }
    this.emit('stateChange', this.getState());
    return this.running;
  }

  setCheckInMinutes(minutes) {
    this.checkInMinutes = Number(minutes) || 0;
    this.lastCheckInTime = Date.now();
  }

  getState(now = Date.now()) {
    let seconds = 0;
    if (this.running) seconds = entryDurationSeconds(this.running, new Date(now));
    else if (this.paused) seconds = this.paused.seconds || 0;
    return {
      isRunning: Boolean(this.running),
      isPaused: !this.running && Boolean(this.paused),
      entry: this.running,
      paused: this.running ? null : this.paused,
      project: this.project,
      customer: this.customer,
      colorHex: this.customer ? this.customer.colorHex : null,
      elapsedSeconds: seconds
    };
  }

  getElapsedSeconds() {
    return this.getState().elapsedSeconds;
  }

  /** True while the running entry is young enough that a project change corrects it (R6). */
  canCorrectProject(now = Date.now()) {
    if (!this.running) return false;
    const created = parseMs(this.running.createdAt);
    const since = created !== null ? created : parseMs(this.running.startTime);
    return since !== null && now - since < PROJECT_CORRECTION_MS;
  }

  async savePaused(value) {
    this.paused = value;
    await setSetting('timerPaused', value);
  }

  // ---------------------------------------------------------------------------
  // Closing entries
  // ---------------------------------------------------------------------------

  /**
   * Closes an open entry at `endMs`, or drops it when it was an accidental click.
   * Returns { status: 'closed' | 'dropped' | 'gone', entry }. 'gone' means another tab got there first.
   */
  async closeOrDrop(entry, endMs, nowMs) {
    const start = parseMs(entry.startTime);
    const created = parseMs(entry.createdAt);
    const accidental = (created !== null && nowMs - created < ACCIDENTAL_MS) || endMs - start < ACCIDENTAL_MS;
    if (accidental) {
      return { status: (await deleteEntryIfOpen(entry.id)) ? 'dropped' : 'gone', entry: null };
    }
    const closed = await updateEntryIfOpen(entry.id, { endTime: iso(endMs) });
    return closed ? { status: 'closed', entry: closed } : { status: 'gone', entry: null };
  }

  // ---------------------------------------------------------------------------
  // Start, pause, resume, stop
  // ---------------------------------------------------------------------------

  /** Starts a new entry. Any entry that is open in the database is closed at the same moment. */
  start(projectId, note = '', ticket = '') {
    return this.exclusive(async () => {
      await this.resolve(Number(projectId));
      if (!this.project) throw new Error('Selected project was not found.');
      const nowMs = Date.now();
      const { snap, roundingMode } = this.options;
      let startMs = snap ? snapStart(nowMs, roundingMode) : nowMs;
      let extended = false;

      // The old entry ends exactly where the new one starts (no gap, no overlap).
      for (const open of await getRunningEntries()) {
        const openStart = parseMs(open.startTime);
        let endMs = startMs;
        if (snap && endMs <= openStart) {
          endMs = openStart + GRID_MS;
          extended = true;
          startMs = endMs;
        }
        await this.closeOrDrop(open, Math.max(endMs, openStart + ACCIDENTAL_MS), nowMs);
      }

      this.running = await addEntry({ projectId: this.project.id, startTime: iso(startMs), note, ticket });
      this.paused = null;
      await setSetting('timerPaused', null);
      this.touchLastSeen(nowMs);
      this.lastCheckInTime = nowMs;
      if (extended) this.notice('timer.snapExtended', 'info');
      this.emit('stateChange', this.getState());
    });
  }

  pause() {
    return this.exclusive(async () => {
      const current = this.running;
      if (!current) return;
      const nowMs = Date.now();
      const startMs = parseMs(current.startTime);
      let endMs = nowMs;
      let extended = false;
      if (this.options.snap) ({ endMs, extended } = snapEnd(startMs, nowMs, this.options.roundingMode));
      endMs = Math.max(endMs, startMs + 1);

      const result = await this.closeOrDrop(current, endMs, nowMs);
      if (result.status === 'gone') { await this.syncFromDatabase(); return; }

      // The note and ticket come from the saved entry, so edits made in the table are kept.
      const saved = result.entry || current;
      await this.savePaused({
        projectId: saved.projectId,
        note: saved.note || '',
        ticket: saved.ticket || '',
        entryId: result.entry ? saved.id : null,
        endTime: result.entry ? saved.endTime : '',
        at: nowMs,
        seconds: result.entry ? entryDurationSeconds(result.entry) : 0
      });
      this.running = null;
      if (extended && result.status === 'closed') this.notice('timer.snapExtended', 'info');
      this.emit('stateChange', this.getState());
    });
  }

  resume() {
    return this.exclusive(async () => {
      const paused = this.paused;
      if (!paused) return;

      // Somebody (another tab) started a timer in the meantime: show that one, do not start a second.
      if ((await getRunningEntries()).length > 0) { await this.syncFromDatabase(); return; }

      const nowMs = Date.now();
      if (paused.entryId && nowMs - paused.at < RESUME_JOIN_MS) {
        const reopened = await reopenEntry(paused.entryId, paused.endTime);
        if (reopened) {
          this.running = reopened;
          await this.resolve(reopened.projectId);
          await this.savePaused(null);
          this.touchLastSeen(nowMs);
          this.lastCheckInTime = nowMs;
          this.emit('stateChange', this.getState());
          return;
        }
      }

      const { snap, roundingMode } = this.options;
      const startMs = snap ? snapStart(nowMs, roundingMode) : nowMs;
      await this.resolve(paused.projectId);
      this.running = await addEntry({
        projectId: paused.projectId, startTime: iso(startMs), note: paused.note, ticket: paused.ticket
      });
      await this.savePaused(null);
      this.touchLastSeen(nowMs);
      this.lastCheckInTime = nowMs;
      this.emit('stateChange', this.getState());
    });
  }

  /** Stops the timer. `endIso` lets the caller end it earlier (for example at the last activity). */
  stop(endIso = null) {
    return this.exclusive(async () => {
      const current = this.running;
      if (current) {
        const nowMs = Date.now();
        const startMs = parseMs(current.startTime);
        let endMs = nowMs;
        let extended = false;
        if (endIso) {
          endMs = parseMs(endIso);
          if (endMs === null || endMs < startMs) endMs = nowMs;
        } else if (this.options.snap) {
          ({ endMs, extended } = snapEnd(startMs, nowMs, this.options.roundingMode));
        }
        const result = await this.closeOrDrop(current, endMs, nowMs);
        if (result.status === 'gone') { await this.syncFromDatabase(); return; }
        if (extended && result.status === 'closed') this.notice('timer.snapExtended', 'info');
      }
      this.running = null;
      this.project = null;
      this.customer = null;
      this.lastCheckInTime = null;
      await this.savePaused(null);
      this.emit('stateChange', this.getState());
    });
  }

  /** The time of the last sign of life, saved about every 30 seconds while a timer runs. */
  async getLastActivity() {
    const value = await getSetting('lastSeenAt', null);
    return value || null;
  }

  touchLastSeen(nowMs = Date.now()) {
    this.lastSeenWrite = nowMs;
    setSetting('lastSeenAt', iso(nowMs)).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Changing the active entry
  // ---------------------------------------------------------------------------

  /** Changes project, note or ticket of the running entry (or of the pause). Returns true when saved. */
  updateActive(patch) {
    return this.exclusive(async () => {
      if (this.running) {
        const updated = await updateEntryIfOpen(this.running.id, patch);
        if (!updated) { await this.syncFromDatabase(); return false; }
        this.running = updated;
        if ('projectId' in patch) await this.resolve(updated.projectId);
        this.emit('stateChange', this.getState());
        return true;
      }
      if (this.paused) {
        const next = { ...this.paused };
        if ('projectId' in patch) next.projectId = Number(patch.projectId);
        if ('note' in patch) next.note = String(patch.note || '').replace(/[\r\n]+/g, ' ');
        if ('ticket' in patch) next.ticket = String(patch.ticket || '').trim();
        await this.resolve(next.projectId);
        await this.savePaused(next);
        this.emit('stateChange', this.getState());
        return true;
      }
      return false;
    });
  }

  /** Moves the start of the running entry. Manual changes are never snapped. */
  setStart(startIso) {
    return this.exclusive(async () => {
      if (!this.running) return false;
      const updated = await updateEntryIfOpen(this.running.id, { startTime: startIso });
      if (!updated) { await this.syncFromDatabase(); return false; }
      this.running = updated;
      this.emit('stateChange', this.getState());
      return true;
    });
  }

  /**
   * "Remove as a break": closes the running entry at `fromMs` and continues in a new entry from `toMs`
   * with the same project, note and ticket.
   */
  splitAway(fromMs, toMs) {
    return this.exclusive(async () => {
      const current = this.running;
      if (!current) return false;
      const startMs = parseMs(current.startTime);
      if (fromMs <= startMs) {
        // The whole time since the start was away: the entry simply begins when the user came back.
        const moved = await updateEntryIfOpen(current.id, { startTime: iso(toMs) });
        if (!moved) { await this.syncFromDatabase(); return false; }
        this.running = moved;
        this.emit('stateChange', this.getState());
        return true;
      }
      const closed = await updateEntryIfOpen(current.id, { endTime: iso(fromMs) });
      if (!closed) { await this.syncFromDatabase(); return false; }
      this.running = await addEntry({
        projectId: closed.projectId, startTime: iso(toMs), note: closed.note, ticket: closed.ticket
      });
      this.lastCheckInTime = Date.now();
      this.emit('stateChange', this.getState());
      return true;
    });
  }

  resetCheckIn() {
    this.lastCheckInTime = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  heartbeat() {
    const now = Date.now();
    const previous = this.lastTickAt;
    this.lastTickAt = now;

    // Sleep, hibernation or a frozen tab show up as a long gap between two ticks.
    if (this.running && previous !== null && now - previous > AWAY_GAP_MS) {
      this.emit('away', { from: previous, to: now });
    }

    this.emit('tick', this.getState(now));

    if (this.running && now - this.lastSeenWrite >= LAST_SEEN_EVERY_MS) this.touchLastSeen(now);

    if (this.running && this.checkInMinutes > 0 && this.lastCheckInTime
        && now - this.lastCheckInTime >= this.checkInMinutes * 60000) {
      this.lastCheckInTime = now;
      this.emit('checkIn', this.getState(now));
    }
  }
}
