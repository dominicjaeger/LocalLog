// Pure logic for adjacent entries: two entries are "adjacent" when one ends within a minute of the
// other's start. Editing that shared boundary can move the neighbour too (the user is asked first).
// No DOM access.

import { parseMs } from './time.js';

export const ADJACENT_TOLERANCE_MS = 60000;

const endMsOf = (entry, nowMs) => (entry.endTime ? parseMs(entry.endTime) : nowMs);

/** The closest other entry that ends within the tolerance of this entry's start (closed entries only). */
export function findPrevious(entries, entry) {
  const start = parseMs(entry.startTime);
  if (start === null) return null;
  let best = null;
  let bestGap = Infinity;
  for (const other of entries) {
    if (other.id === entry.id || !other.endTime) continue;
    const end = parseMs(other.endTime);
    if (end === null) continue;
    const gap = Math.abs(end - start);
    if (gap <= ADJACENT_TOLERANCE_MS && gap < bestGap) { best = other; bestGap = gap; }
  }
  return best;
}

/** The closest other entry that starts within the tolerance of this entry's end (may be the running one). */
export function findNext(entries, entry) {
  if (!entry.endTime) return null; // a running entry has no end yet
  const end = parseMs(entry.endTime);
  if (end === null) return null;
  let best = null;
  let bestGap = Infinity;
  for (const other of entries) {
    if (other.id === entry.id) continue;
    const start = parseMs(other.startTime);
    if (start === null) continue;
    const gap = Math.abs(start - end);
    if (gap <= ADJACENT_TOLERANCE_MS && gap < bestGap) { best = other; bestGap = gap; }
  }
  return best;
}

/** True when the entry would still have a positive length with these (new) times. */
function hasLength(startMs, endMs) {
  return startMs !== null && endMs !== null && endMs > startMs;
}

/**
 * Plans the change of one boundary of an entry together with its neighbour.
 * side 'start': the previous entry's end gets the same time. side 'end': the next entry's start does.
 * Returns { patches: [{ id, patch, onlyIfOpen? }], adjusted: [ids], neighbour, error }.
 * `neighbour` is the entry that would move (or null when there is none); `error` is 'boundaryCollapse'
 * when any affected entry would end up with no time (a running entry counts up to `now`).
 * Only the direct neighbour moves, never a chain.
 */
export function planBoundaryEdit(entries, entryId, side, newIso, now = new Date()) {
  const entry = entries.find((e) => e.id === entryId);
  const newMs = parseMs(newIso);
  const result = { patches: [], adjusted: [], neighbour: null, error: null };
  if (!entry || newMs === null) { result.error = 'boundaryCollapse'; return result; }
  const nowMs = now.getTime();
  const running = !entry.endTime;

  if (side === 'start') {
    result.neighbour = findPrevious(entries, entry);
    if (!hasLength(newMs, endMsOf(entry, nowMs))) result.error = 'boundaryCollapse';
    result.patches.push({ id: entry.id, patch: { startTime: newIso }, onlyIfOpen: running });
    if (result.neighbour) {
      if (!hasLength(parseMs(result.neighbour.startTime), newMs)) result.error = 'boundaryCollapse';
      result.patches.push({ id: result.neighbour.id, patch: { endTime: newIso } });
      result.adjusted.push(result.neighbour.id);
    }
  } else {
    result.neighbour = findNext(entries, entry);
    if (!hasLength(parseMs(entry.startTime), newMs)) result.error = 'boundaryCollapse';
    result.patches.push({ id: entry.id, patch: { endTime: newIso } });
    if (result.neighbour) {
      const neighbourRunning = !result.neighbour.endTime;
      if (!hasLength(newMs, endMsOf(result.neighbour, nowMs))) result.error = 'boundaryCollapse';
      result.patches.push({ id: result.neighbour.id, patch: { startTime: newIso }, onlyIfOpen: neighbourRunning });
      result.adjusted.push(result.neighbour.id);
    }
  }
  return result;
}

/**
 * The two buttons of a gap or overlap row. `which`:
 *   'extendPrevious' - the previous entry's end becomes the next entry's start;
 *   'extendNext'     - the next entry's start becomes the previous entry's end.
 * For an overlap the same buttons shorten instead of extend. Returns { patches, error }.
 */
export function planGapAction(entries, previousId, nextId, which, now = new Date()) {
  const previous = entries.find((e) => e.id === previousId);
  const next = entries.find((e) => e.id === nextId);
  if (!previous || !next || !previous.endTime) return { patches: [], error: 'boundaryCollapse' };
  const nowMs = now.getTime();

  if (which === 'extendPrevious') {
    const endMs = parseMs(next.startTime);
    if (!hasLength(parseMs(previous.startTime), endMs)) return { patches: [], error: 'boundaryCollapse' };
    return { patches: [{ id: previous.id, patch: { endTime: next.startTime } }], error: null };
  }
  const startMs = parseMs(previous.endTime);
  if (!hasLength(startMs, endMsOf(next, nowMs))) return { patches: [], error: 'boundaryCollapse' };
  return { patches: [{ id: next.id, patch: { startTime: previous.endTime }, onlyIfOpen: !next.endTime }], error: null };
}
