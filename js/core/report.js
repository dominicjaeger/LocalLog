// Pure evaluations for transferring hours: hours per project for one day and the week timesheet.
// Entries across midnight are split at local midnight here (the stored entries are never changed).
// Each day and project is rounded to the 15-minute grid. No DOM access.

import { parseMs, startOfDay, addDays } from './time.js';
import { roundSeconds } from './rounding.js';
import { effectiveRate, indexById } from './export.js';
import { formatHours, formatMoney, formatHm, formatDayShort } from './format.js';
import { protectCell } from './csv.js';

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of a Date in local time. */
export function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The key of a transfer mark: local date and project. */
export function transferKey(dateKey, projectId) {
  return `${dateKey}|${projectId}`;
}

/**
 * The parts of an entry per local day: [{ dateKey, startMs, endMs }]. Uses local midnights, so a
 * daylight-saving day has 23 or 25 hours. A running entry is split up to `now`.
 */
export function splitAtMidnight(entry, now = new Date()) {
  const start = parseMs(entry.startTime);
  const end = entry.endTime ? parseMs(entry.endTime) : now.getTime();
  if (start === null || end === null || end <= start) return [];
  const parts = [];
  let day = startOfDay(new Date(start));
  let cursor = start;
  while (cursor < end) {
    const nextMidnight = addDays(day, 1).getTime();
    const partEnd = Math.min(end, nextMidnight);
    parts.push({ dateKey: localDateKey(day), startMs: cursor, endMs: partEnd });
    cursor = partEnd;
    day = addDays(day, 1);
  }
  return parts;
}

/**
 * Exact seconds per day and project for the days in `dateKeys` (a Set).
 * Returns { seconds: Map('dateKey|projectId' -> seconds), running: Set('dateKey|projectId') }.
 */
function collectSeconds(entries, dateKeys, rangeStartMs, rangeEndMs, now) {
  const seconds = new Map();
  const running = new Set();
  for (const entry of entries) {
    const start = parseMs(entry.startTime);
    if (start === null) continue;
    const end = entry.endTime ? parseMs(entry.endTime) : now.getTime();
    if (end === null || end <= start || end <= rangeStartMs || start >= rangeEndMs) continue;
    for (const part of splitAtMidnight(entry, now)) {
      if (!dateKeys.has(part.dateKey)) continue;
      const key = transferKey(part.dateKey, entry.projectId);
      seconds.set(key, (seconds.get(key) || 0) + Math.round((part.endMs - part.startMs) / 1000));
      if (!entry.endTime) running.add(key);
    }
  }
  return { seconds, running };
}

const byLabel = (a, b) => a.customerName.localeCompare(b.customerName) || a.projectName.localeCompare(b.projectName);

function describe(project, customer) {
  const customerName = customer ? customer.name : '';
  return { customerName, projectName: project.name, label: customerName ? `${customerName} › ${project.name}` : project.name };
}

/**
 * Hours per project on one local day, rounded to 15 minutes per project (D3-4).
 * Returns [{ project, customer, label, seconds, roundedSeconds, hours, rate, value, running }],
 * sorted by customer name, then project name. Projects without a known project record are left out.
 */
export function projectDayTotals({ entries, projects, customers, date, mode, now = new Date() }) {
  const dayStart = startOfDay(date);
  const dayEnd = addDays(dayStart, 1);
  const dateKey = localDateKey(dayStart);
  const { seconds, running } = collectSeconds(entries, new Set([dateKey]), dayStart.getTime(), dayEnd.getTime(), now);
  const projectsById = indexById(projects);
  const customersById = indexById(customers);

  const rows = [];
  for (const [key, secs] of seconds) {
    const project = projectsById.get(Number(key.split('|')[1]));
    if (!project) continue;
    const customer = customersById.get(project.customerId) || null;
    const roundedSeconds = roundSeconds(secs, mode);
    const hours = roundedSeconds / 3600;
    const rate = effectiveRate(project, customer);
    rows.push({
      project, customer, ...describe(project, customer),
      seconds: secs, roundedSeconds, hours,
      rate, value: rate === null ? null : Math.round(hours * rate * 100) / 100,
      running: running.has(key)
    });
  }
  return rows.sort(byLabel);
}

/** 'none' (not transferred), 'done' (transferred, same value) or 'changed' (value differs now). */
export function transferState(record, currentHours) {
  if (!record) return 'none';
  return Math.abs(record.hours - currentHours) < 1e-9 ? 'done' : 'changed';
}

/**
 * The week timesheet: projects x Monday-Sunday with rounded day values.
 * Row and week totals are sums of the rounded cells, so the week matches what was transferred per day.
 */
export function weekGrid({ entries, projects, customers, weekStart, mode, now = new Date() }) {
  const start = startOfDay(weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const keys = days.map(localDateKey);
  const { seconds } = collectSeconds(entries, new Set(keys), start.getTime(), addDays(start, 7).getTime(), now);
  const projectsById = indexById(projects);
  const customersById = indexById(customers);

  const byProject = new Map();
  for (const [key, secs] of seconds) {
    const [dateKey, projectId] = key.split('|');
    const project = projectsById.get(Number(projectId));
    if (!project) continue;
    let row = byProject.get(project.id);
    if (!row) {
      const customer = customersById.get(project.customerId) || null;
      row = {
        project, customer, ...describe(project, customer),
        cells: keys.map(() => ({ seconds: 0, roundedSeconds: 0 })),
        totalRounded: 0, totalSeconds: 0
      };
      byProject.set(project.id, row);
    }
    const index = keys.indexOf(dateKey);
    row.cells[index] = { seconds: secs, roundedSeconds: roundSeconds(secs, mode) };
  }

  const rows = [...byProject.values()].sort(byLabel);
  const dayTotals = keys.map(() => ({ seconds: 0, roundedSeconds: 0 }));
  let totalRounded = 0;
  let totalExact = 0;
  let totalValue = 0;
  let anyValue = false;
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      row.totalRounded += cell.roundedSeconds;
      row.totalSeconds += cell.seconds;
      dayTotals[i].roundedSeconds += cell.roundedSeconds;
      dayTotals[i].seconds += cell.seconds;
    });
    totalRounded += row.totalRounded;
    totalExact += row.totalSeconds;
    row.rate = effectiveRate(row.project, row.customer);
    row.value = row.rate === null ? null : Math.round((row.totalRounded / 3600) * row.rate * 100) / 100;
    if (row.value !== null) { totalValue += row.value; anyValue = true; }
  }
  return {
    days, dateKeys: keys, rows, dayTotals, totalRounded, totalExact,
    totalValue: anyValue ? Math.round(totalValue * 100) / 100 : null
  };
}

// ---------------------------------------------------------------------------
// Tables for "Copy table" and "Download as CSV"
// ---------------------------------------------------------------------------

/** Per-project rows of one day. labels: { project, hours, exact, value } */
export function buildDayTable({ rows, includeRates, labels }) {
  const headers = [labels.project, labels.hours, labels.exact];
  if (includeRates) headers.push(labels.value);
  const body = rows.map((r) => {
    const line = [protectCell(r.label), formatHours(r.hours), formatHm(r.seconds)];
    if (includeRates) line.push(r.value === null ? '' : formatMoney(r.value));
    return line;
  });
  return { headers, rows: body };
}

/** The week grid as a table: Project, Mon dd.mm., ..., Sun dd.mm., Total [, Value]. */
export function buildWeekTable({ grid, includeRates, labels }) {
  const headers = [labels.project, ...grid.days.map(formatDayShort), labels.total];
  if (includeRates) headers.push(labels.value);
  const body = grid.rows.map((row) => {
    const line = [
      protectCell(row.label),
      ...row.cells.map((c) => (c.seconds === 0 ? '' : formatHours(c.roundedSeconds / 3600))),
      formatHours(row.totalRounded / 3600)
    ];
    if (includeRates) line.push(row.value === null ? '' : formatMoney(row.value));
    return line;
  });
  return { headers, rows: body };
}
