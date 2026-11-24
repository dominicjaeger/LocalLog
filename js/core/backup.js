// Pure backup file format (customers.csv, projects.csv, entries.csv, transfers.csv, meta.csv).
// Written locale-neutral: UTF-8, ',' separator, ISO timestamps, '.' decimals. Reading is more
// forgiving so that files that were opened and saved in Excel (';' separator, BOM) still load.
// No DOM access.

import { parseCsv, serializeCsv } from './csv.js';
import { parseMs, repairOpenEntries } from './time.js';
import { validateColor, validateTicketTemplate } from './validate.js';

export const BACKUP_FILES = {
  customers: 'customers.csv',
  projects: 'projects.csv',
  entries: 'entries.csv',
  transfers: 'transfers.csv',
  meta: 'meta.csv'
};

const CUSTOMER_HEADERS = ['Id', 'Name', 'ColorHex', 'DefaultRate', 'IsActive', 'CreatedAt'];
const PROJECT_HEADERS = ['Id', 'CustomerId', 'Name', 'HourlyRate', 'TicketUrlTemplate', 'IsActive', 'CreatedAt'];
const ENTRY_HEADERS = ['Id', 'ProjectId', 'StartTime', 'EndTime', 'Note', 'Ticket', 'CreatedAt', 'UpdatedAt'];

const TRANSFER_HEADERS = ['Key', 'Date', 'ProjectId', 'Hours', 'Seconds', 'TransferredAt'];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_COLOR = '#0078D4';
// A full ISO timestamp with a time zone, as LocalLog writes it. Excel turns these into local dates.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

const num = (v) => (v === null || v === undefined ? '' : String(v));
const flag = (v) => (v ? '1' : '0');

/** Returns { 'customers.csv': text, ... } for the given data. */
export function toBackupFiles({ customers, projects, entries, transfers = [], appVersion, schemaVersion }) {
  return {
    [BACKUP_FILES.customers]: serializeCsv(CUSTOMER_HEADERS, customers.map((c) => [
      c.id, c.name, c.colorHex, num(c.defaultRate), flag(c.isActive), c.createdAt
    ])),
    [BACKUP_FILES.projects]: serializeCsv(PROJECT_HEADERS, projects.map((p) => [
      p.id, p.customerId, p.name, num(p.hourlyRate), p.ticketUrlTemplate || '', flag(p.isActive), p.createdAt
    ])),
    [BACKUP_FILES.entries]: serializeCsv(ENTRY_HEADERS, entries.map((e) => [
      e.id, e.projectId, e.startTime, e.endTime || '', e.note || '', e.ticket || '', e.createdAt, e.updatedAt
    ])),
    [BACKUP_FILES.transfers]: serializeCsv(TRANSFER_HEADERS, transfers.map((x) => [
      x.key, x.date, x.projectId, x.hours, x.seconds, x.transferredAt
    ])),
    [BACKUP_FILES.meta]: serializeCsv(['Key', 'Value'], [
      ['AppVersion', appVersion],
      ['SchemaVersion', schemaVersion]
    ])
  };
}

/** ',' or ';', decided by the header line (the headers themselves never contain either). */
export function detectSeparator(text) {
  const clean = String(text ?? '').replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  return firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
}

const readRows = (text) => parseCsv(text, detectSeparator(text));

// Excel with a German region writes decimals as "85,5". A single comma between digits is accepted.
const toNumberOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
};
const toBool = (v) => v === '1' || String(v).trim().toLowerCase() === 'true';
const isIso = (v) => ISO_TIMESTAMP.test(String(v ?? '').trim()) && parseMs(String(v).trim()) !== null;

/**
 * Parses backup files. `texts` maps file name to text.
 * Returns { ok: true, data: { customers, projects, entries }, meta, warnings } or
 * { ok: false, error, detail?, row? }. `detail` is the file name and `row` the data row (1 = first row
 * under the header). `warnings` is a list of { code, count } for things that were repaired:
 * 'badColor', 'badTemplate', 'extraOpen', 'skippedTransfers'. A backup of data layout version 1 has no
 * transfers.csv; it loads without transfer marks.
 */
export function fromBackupFiles(texts, supportedSchemaVersion) {
  for (const key of ['customers', 'projects', 'entries']) {
    if (typeof texts[BACKUP_FILES[key]] !== 'string') return { ok: false, error: 'missingFile', detail: BACKUP_FILES[key] };
  }

  const meta = {};
  if (typeof texts[BACKUP_FILES.meta] === 'string') {
    for (const row of readRows(texts[BACKUP_FILES.meta])) meta[row.Key] = row.Value;
  }
  if (meta.SchemaVersion !== undefined && Number(meta.SchemaVersion) > supportedSchemaVersion) {
    return { ok: false, error: 'newerSchema' };
  }

  const fail = (error, detail, row) => ({ ok: false, error, detail, row });
  const warn = { badColor: 0, badTemplate: 0, extraOpen: 0, skippedTransfers: 0 };

  // ---- customers ----
  const customers = [];
  const customerIds = new Set();
  let rowNo = 0;
  for (const r of readRows(texts[BACKUP_FILES.customers])) {
    rowNo += 1;
    const id = Number(r.Id);
    const defaultRate = toNumberOrNull(r.DefaultRate);
    if (!Number.isInteger(id) || id <= 0 || !r.Name || Number.isNaN(defaultRate)) return fail('badData', BACKUP_FILES.customers, rowNo);
    if (customerIds.has(id)) return fail('duplicateId', BACKUP_FILES.customers, rowNo);
    customerIds.add(id);
    let colorHex = String(r.ColorHex || '').trim();
    if (validateColor(colorHex)) { colorHex = DEFAULT_COLOR; warn.badColor += 1; }
    customers.push({ id, name: r.Name, colorHex, defaultRate, isActive: toBool(r.IsActive), createdAt: r.CreatedAt });
  }

  // ---- projects ----
  const projects = [];
  const projectIds = new Set();
  rowNo = 0;
  for (const r of readRows(texts[BACKUP_FILES.projects])) {
    rowNo += 1;
    const id = Number(r.Id);
    const customerId = Number(r.CustomerId);
    const hourlyRate = toNumberOrNull(r.HourlyRate);
    if (!Number.isInteger(id) || id <= 0 || !r.Name || !customerIds.has(customerId) || Number.isNaN(hourlyRate)) {
      return fail('badData', BACKUP_FILES.projects, rowNo);
    }
    if (projectIds.has(id)) return fail('duplicateId', BACKUP_FILES.projects, rowNo);
    projectIds.add(id);
    let template = r.TicketUrlTemplate || null;
    if (template && validateTicketTemplate(template)) { template = null; warn.badTemplate += 1; }
    projects.push({
      id, customerId, name: r.Name, hourlyRate,
      ticketUrlTemplate: template,
      isActive: toBool(r.IsActive), createdAt: r.CreatedAt
    });
  }

  // ---- entries ----
  const entries = [];
  const entryIds = new Set();
  rowNo = 0;
  for (const r of readRows(texts[BACKUP_FILES.entries])) {
    rowNo += 1;
    const id = Number(r.Id);
    const projectId = Number(r.ProjectId);
    if (!Number.isInteger(id) || id <= 0 || !projectIds.has(projectId)) return fail('badData', BACKUP_FILES.entries, rowNo);
    const startTime = String(r.StartTime ?? '').trim();
    const endTime = String(r.EndTime ?? '').trim();
    if (!startTime) return fail('badData', BACKUP_FILES.entries, rowNo);
    // Timestamps that are not ISO dates were most likely rewritten by a spreadsheet program.
    if (!isIso(startTime) || (endTime && !isIso(endTime))) return fail('spreadsheetChanged', BACKUP_FILES.entries, rowNo);
    if (entryIds.has(id)) return fail('duplicateId', BACKUP_FILES.entries, rowNo);
    entryIds.add(id);
    if (endTime && parseMs(endTime) <= parseMs(startTime)) return fail('endBeforeStart', BACKUP_FILES.entries, rowNo);
    entries.push({
      id, projectId, startTime, endTime,
      note: r.Note || '', ticket: r.Ticket || '',
      createdAt: r.CreatedAt || startTime, updatedAt: r.UpdatedAt || startTime
    });
  }

  // ---- transfers (optional file; absent in version-1 backups) ----
  const transfers = [];
  const transferKeys = new Set();
  if (typeof texts[BACKUP_FILES.transfers] === 'string') {
    rowNo = 0;
    for (const r of readRows(texts[BACKUP_FILES.transfers])) {
      rowNo += 1;
      const projectId = Number(r.ProjectId);
      const hours = toNumberOrNull(r.Hours);
      const seconds = toNumberOrNull(r.Seconds);
      const date = String(r.Date ?? '').trim();
      const transferredAt = String(r.TransferredAt ?? '').trim();
      const key = `${date}|${projectId}`;
      if (!DATE_KEY.test(date) || !Number.isInteger(projectId) || projectId <= 0
          || hours === null || Number.isNaN(hours) || seconds === null || Number.isNaN(seconds)
          || String(r.Key ?? '').trim() !== key) {
        return fail('badData', BACKUP_FILES.transfers, rowNo);
      }
      if (transferKeys.has(key)) return fail('duplicateId', BACKUP_FILES.transfers, rowNo);
      transferKeys.add(key);
      // A mark for a project that is not in the backup cannot be shown anywhere: skip it and tell the user.
      if (!projectIds.has(projectId)) { warn.skippedTransfers += 1; continue; }
      transfers.push({ key, date, projectId, hours, seconds, transferredAt });
    }
  }

  // At most one entry may be open. Older ones are closed, never deleted.
  const patches = repairOpenEntries(entries);
  for (const patch of patches) {
    const entry = entries.find((e) => e.id === patch.id);
    if (entry) entry.endTime = patch.endTime;
  }
  warn.extraOpen = patches.length;

  const warnings = Object.entries(warn).filter(([, count]) => count > 0).map(([code, count]) => ({ code, count }));
  return { ok: true, data: { customers, projects, entries, transfers }, meta, warnings };
}
