// Pure rounding helpers for the 15-minute grid. No DOM access.
// The grid is fixed (R7). The direction is a setting so that "up" and "down" can be offered later.

export const GRID_MINUTES = 15;
export const GRID_SECONDS = GRID_MINUTES * 60;
export const GRID_MS = GRID_SECONDS * 1000;
export const ROUNDING_MODES = ['nearest', 'up', 'down'];
export const DEFAULT_ROUNDING_MODE = 'nearest';

/** Anything that is not a known mode falls back to the default. */
export function normalizeMode(mode) {
  return ROUNDING_MODES.includes(mode) ? mode : DEFAULT_ROUNDING_MODE;
}

function roundToGrid(value, grid, mode) {
  const quotient = value / grid;
  switch (normalizeMode(mode)) {
    case 'up': return Math.ceil(quotient) * grid;
    case 'down': return Math.floor(quotient) * grid;
    default: return Math.round(quotient) * grid;
  }
}

/** Rounds a number of seconds to the grid. */
export function roundSeconds(seconds, mode) {
  return roundToGrid(seconds, GRID_SECONDS, mode);
}

/** Rounds a point in time (Date or milliseconds) to the grid in local time. Returns a Date. */
export function roundTime(date, mode) {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  // Round in local time so that the grid follows the wall clock.
  const offset = -new Date(ms).getTimezoneOffset() * 60000;
  return new Date(roundToGrid(ms + offset, GRID_MS, mode) - offset);
}

/** The start of a timer that is started at `nowMs` while snapping is on (milliseconds). */
export function snapStart(nowMs, mode) {
  return roundTime(nowMs, mode).getTime();
}

/**
 * The end of a timer that stops at `nowMs` while snapping is on.
 * If rounding would make the end not later than the start, the end becomes start + 15 minutes.
 * Returns { endMs, extended }.
 */
export function snapEnd(startMs, nowMs, mode) {
  const endMs = roundTime(nowMs, mode).getTime();
  if (endMs <= startMs) return { endMs: startMs + GRID_MS, extended: true };
  return { endMs, extended: false };
}
