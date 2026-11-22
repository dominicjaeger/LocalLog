// Pure time helpers. No DOM access.

const DAY_MS = 86400000;

export function parseMs(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function isRunning(entry) {
  return !entry.endTime;
}

/** Duration of an entry in whole seconds (= end - start). A running entry counts up to `now`. */
export function entryDurationSeconds(entry, now = new Date()) {
  const s = parseMs(entry.startTime);
  if (s === null) return 0;
  const e = entry.endTime ? parseMs(entry.endTime) : now.getTime();
  if (e === null) return 0;
  return Math.max(0, Math.round((e - s) / 1000));
}

export function secondsToHours(seconds) {
  return Math.round((seconds / 3600) * 100) / 100;
}

/** HH:MM:SS (hours may exceed 24). */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---- Calendar helpers (local time) ----

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Monday 00:00 of the week containing d. */
export function startOfWeek(d) {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(startOfDay(d), -day);
}

/** Week Monday–Sunday; offset moves by whole weeks. `end` is exclusive (next Monday 00:00). */
export function weekRange(now, offset = 0) {
  const start = addDays(startOfWeek(now), offset * 7);
  return { start, end: addDays(start, 7) };
}

export function monthRange(now) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1)
  };
}

export function dayRange(now) {
  const start = startOfDay(now);
  return { start, end: addDays(start, 1) };
}

/** kind: 'today' | 'week' | 'month' | 'all'. Returns null for 'all'. */
export function rangeFor(kind, now, weekOffset = 0) {
  if (kind === 'today') return dayRange(now);
  if (kind === 'week') return weekRange(now, weekOffset);
  if (kind === 'month') return monthRange(now);
  return null;
}

export function inRange(entry, range) {
  if (!range) return true;
  const s = parseMs(entry.startTime);
  return s !== null && s >= range.start.getTime() && s < range.end.getTime();
}

// ---- Overlap ----

/** Entries (other than the candidate itself) whose time span intersects the candidate's. */
export function overlappingEntries(candidate, entries, now = new Date()) {
  const s = parseMs(candidate.startTime);
  const e = candidate.endTime ? parseMs(candidate.endTime) : now.getTime();
  if (s === null || e === null) return [];
  return entries.filter((o) => {
    if (candidate.id !== undefined && o.id === candidate.id) return false;
    const os = parseMs(o.startTime);
    const oe = o.endTime ? parseMs(o.endTime) : now.getTime();
    if (os === null || oe === null) return false;
    return s < oe && os < e;
  });
}

// ---- Date/time input helpers ----

const pad = (n) => String(n).padStart(2, '0');

export function toDateInputValue(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInputValue(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Combines 'YYYY-MM-DD' and 'HH:mm' (local) into a Date, or null if invalid. */
export function combineDateTime(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '');
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- Time of day (for typed start and stop times) ----

/** Reads "H:mm" or "HH:mm" (seconds allowed, ignored). Returns { hours, minutes } or null. */
export function parseTimeOfDay(text) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  return hours > 23 || minutes > 59 ? null : { hours, minutes };
}

/**
 * The most recent moment up to `nowMs` that shows the typed clock time: today, or yesterday when
 * the time has not happened yet today. So 23:50 typed just after midnight means the previous day.
 */
export function latestOccurrenceUpTo(nowMs, text) {
  const tod = parseTimeOfDay(text);
  if (!tod) return null;
  const now = new Date(nowMs);
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), tod.hours, tod.minutes, 0, 0);
  if (candidate.getTime() > nowMs) candidate.setDate(candidate.getDate() - 1);
  return candidate;
}

/** The first moment after `afterMs` that shows the typed clock time (same day, or the next day). */
export function firstOccurrenceAfter(afterMs, text) {
  const tod = parseTimeOfDay(text);
  if (!tod) return null;
  const after = new Date(afterMs);
  const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate(), tod.hours, tod.minutes, 0, 0);
  if (candidate.getTime() <= afterMs) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

// ---- Long-running timer ----

/** A running timer is "long-running" after this much time (named constant, R15). */
export const LONG_RUNNING_MS = 10 * 3600 * 1000;

/** True for a running entry that passed 10 hours or that started before today. */
export function isLongRunning(entry, now = new Date()) {
  if (!entry || entry.endTime) return false;
  const start = parseMs(entry.startTime);
  if (start === null) return false;
  return now.getTime() - start > LONG_RUNNING_MS || start < startOfDay(now).getTime();
}

// ---- More than one open entry ----

/**
 * When more than one entry is open, only the newest may stay open. The others are closed:
 * at the start of the next open entry, or at their own start + 1 minute if that is earlier.
 * Returns the patches [{ id, endTime }]; nothing is written here and nothing is deleted.
 */
export function repairOpenEntries(entries) {
  const open = entries
    .filter((e) => !e.endTime && parseMs(e.startTime) !== null)
    .sort((a, b) => parseMs(a.startTime) - parseMs(b.startTime));
  const patches = [];
  for (let i = 0; i < open.length - 1; i += 1) {
    const ownStart = parseMs(open[i].startTime);
    const nextStart = parseMs(open[i + 1].startTime);
    const endMs = Math.max(Math.min(nextStart, ownStart + 60000), ownStart + 1000);
    patches.push({ id: open[i].id, endTime: new Date(endMs).toISOString() });
  }
  return patches;
}

// ---- Segments (pause = segment) ----

/**
 * Pausing closes the current entry and resuming starts a new one with the same project, note and ticket.
 * Returns the patch for the entry being closed and the template for the next entry.
 */
export function splitSegment(entry, nowIso) {
  return {
    closePatch: { endTime: nowIso },
    next: {
      projectId: entry.projectId,
      startTime: nowIso,
      endTime: '',
      note: entry.note || '',
      ticket: entry.ticket || ''
    }
  };
}

// ---- Totals ----

export function totalSeconds(entries, now = new Date()) {
  let sum = 0;
  for (const e of entries) sum += entryDurationSeconds(e, now);
  return sum;
}
