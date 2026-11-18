// Pure export / reporting logic: rows for the table, range filters, clipboard text, CSV text,
// and the weekly summary. No DOM access.

import { entryDurationSeconds, secondsToHours, formatClock, inRange, rangeFor } from './time.js';
import { formatHours, formatMoney, formatDate, formatTime, decimalSeparator } from './format.js';
import { protectCell, flattenCell, serializeCsv } from './csv.js';

export function indexById(list) {
  const map = new Map();
  for (const item of list) map.set(item.id, item);
  return map;
}

/** A project's own rate, or its customer's default rate, or null. */
export function effectiveRate(project, customer) {
  if (project && project.hourlyRate !== null && project.hourlyRate !== undefined) return project.hourlyRate;
  if (customer && customer.defaultRate !== null && customer.defaultRate !== undefined) return customer.defaultRate;
  return null;
}

/** Adds the derived values (names, duration, hours, rate, value) to a raw entry. */
export function resolveEntry(entry, projectsById, customersById, now = new Date()) {
  const project = projectsById.get(entry.projectId) || null;
  const customer = project ? customersById.get(project.customerId) || null : null;
  const seconds = entryDurationSeconds(entry, now);
  const hours = secondsToHours(seconds);
  const rate = effectiveRate(project, customer);
  const value = rate === null ? null : Math.round(hours * rate * 100) / 100;
  return {
    entry,
    project,
    customer,
    customerName: customer ? customer.name : '',
    projectName: project ? project.name : '',
    colorHex: customer ? customer.colorHex : '#9CA3AF',
    seconds,
    hours,
    rate,
    value
  };
}

/** Closed entries only, in the given range, newest first. */
export function entriesForExport(entries, range) {
  return entries
    .filter((e) => e.endTime && inRange(e, range))
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

/**
 * Builds the export table.
 * labels: { date, start, end, customer, project, ticket, duration, hours, rate, value, note }
 */
export function buildExportTable({ entries, projects, customers, range, includeRates, labels, now = new Date() }) {
  const projectsById = indexById(projects);
  const customersById = indexById(customers);

  const headers = [labels.date, labels.start, labels.end, labels.customer, labels.project, labels.ticket, labels.duration, labels.hours];
  if (includeRates) headers.push(labels.rate, labels.value);
  headers.push(labels.note);

  const rows = entriesForExport(entries, range).map((entry) => {
    const r = resolveEntry(entry, projectsById, customersById, now);
    const row = [
      formatDate(entry.startTime),
      formatTime(entry.startTime),
      formatTime(entry.endTime),
      protectCell(r.customerName),
      protectCell(r.projectName),
      protectCell(entry.ticket),
      formatClock(r.seconds),
      formatHours(r.hours)
    ];
    if (includeRates) {
      row.push(r.rate === null ? '' : formatMoney(r.rate), r.value === null ? '' : formatMoney(r.value));
    }
    row.push(protectCell(entry.note));
    return row;
  });

  return { headers, rows };
}

/** Tab-separated text for pasting into Excel. */
export function toClipboardText(table) {
  const lines = [table.headers, ...table.rows].map((cells) => cells.map(flattenCell).join('\t'));
  return lines.join('\n');
}

/** CSV text for download: UTF-8 with BOM; ';' separator when the locale's decimal separator is ','. */
export function toCsvText(table, decimalSep = decimalSeparator()) {
  const sep = decimalSep === ',' ? ';' : ',';
  return serializeCsv(table.headers, table.rows, { sep, bom: true });
}

export function exportFileName(kind, now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `locallog-${y}-${m}-${d}-${kind}.csv`;
}

/**
 * Hours per customer and project in a range (running entries count up to `now`).
 * Returns { seconds, value, customers: [{ customer, seconds, value, projects: [{ project, seconds, value }] }] }.
 */
export function summarizeByCustomer({ entries, projects, customers, range, now = new Date() }) {
  const projectsById = indexById(projects);
  const customersById = indexById(customers);
  const byCustomer = new Map();
  let total = 0;
  let totalValue = 0;
  let anyValue = false;

  for (const entry of entries) {
    if (!inRange(entry, range)) continue;
    const r = resolveEntry(entry, projectsById, customersById, now);
    if (!r.project || !r.customer) continue;
    total += r.seconds;
    // Value is based on exact seconds so that group sums stay consistent.
    const exactValue = r.rate === null ? null : (r.seconds / 3600) * r.rate;
    if (exactValue !== null) { totalValue += exactValue; anyValue = true; }

    let c = byCustomer.get(r.customer.id);
    if (!c) { c = { customer: r.customer, seconds: 0, value: null, projects: new Map() }; byCustomer.set(r.customer.id, c); }
    c.seconds += r.seconds;
    if (exactValue !== null) c.value = (c.value || 0) + exactValue;

    let p = c.projects.get(r.project.id);
    if (!p) { p = { project: r.project, seconds: 0, value: null }; c.projects.set(r.project.id, p); }
    p.seconds += r.seconds;
    if (exactValue !== null) p.value = (p.value || 0) + exactValue;
  }

  const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
  const list = [...byCustomer.values()]
    .map((c) => ({
      customer: c.customer,
      seconds: c.seconds,
      value: round(c.value),
      projects: [...c.projects.values()]
        .map((p) => ({ project: p.project, seconds: p.seconds, value: round(p.value) }))
        .sort((a, b) => b.seconds - a.seconds)
    }))
    .sort((a, b) => b.seconds - a.seconds);

  return { seconds: total, value: anyValue ? round(totalValue) : null, customers: list };
}

export { rangeFor };
