// Pure backup file format (customers.csv, projects.csv, entries.csv, meta.csv).
// Locale-neutral: UTF-8, ',' separator, ISO timestamps, '.' decimals. No DOM access.

import { parseCsv, serializeCsv } from './csv.js';

export const BACKUP_FILES = {
  customers: 'customers.csv',
  projects: 'projects.csv',
  entries: 'entries.csv',
  meta: 'meta.csv'
};

const CUSTOMER_HEADERS = ['Id', 'Name', 'ColorHex', 'DefaultRate', 'IsActive', 'CreatedAt'];
const PROJECT_HEADERS = ['Id', 'CustomerId', 'Name', 'HourlyRate', 'TicketUrlTemplate', 'IsActive', 'CreatedAt'];
const ENTRY_HEADERS = ['Id', 'ProjectId', 'StartTime', 'EndTime', 'Note', 'Ticket', 'CreatedAt', 'UpdatedAt'];

const num = (v) => (v === null || v === undefined ? '' : String(v));
const flag = (v) => (v ? '1' : '0');

/** Returns { 'customers.csv': text, ... } for the given data. */
export function toBackupFiles({ customers, projects, entries, appVersion, schemaVersion }) {
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
    [BACKUP_FILES.meta]: serializeCsv(['Key', 'Value'], [
      ['AppVersion', appVersion],
      ['SchemaVersion', schemaVersion]
    ])
  };
}

const toNumberOrNull = (v) => {
  if (v === '' || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const toBool = (v) => v === '1' || String(v).toLowerCase() === 'true';

/**
 * Parses backup files. `texts` maps file name to text.
 * Returns { ok: true, data: { customers, projects, entries }, meta } or { ok: false, error }.
 */
export function fromBackupFiles(texts, supportedSchemaVersion) {
  for (const key of ['customers', 'projects', 'entries']) {
    if (typeof texts[BACKUP_FILES[key]] !== 'string') return { ok: false, error: 'missingFile', detail: BACKUP_FILES[key] };
  }

  const meta = {};
  if (typeof texts[BACKUP_FILES.meta] === 'string') {
    for (const row of parseCsv(texts[BACKUP_FILES.meta])) meta[row.Key] = row.Value;
  }
  if (meta.SchemaVersion !== undefined && Number(meta.SchemaVersion) > supportedSchemaVersion) {
    return { ok: false, error: 'newerSchema' };
  }

  const bad = (detail) => ({ ok: false, error: 'badData', detail });

  const customers = [];
  for (const r of parseCsv(texts[BACKUP_FILES.customers])) {
    const id = Number(r.Id);
    const defaultRate = toNumberOrNull(r.DefaultRate);
    if (!Number.isInteger(id) || id <= 0 || !r.Name || Number.isNaN(defaultRate)) return bad(BACKUP_FILES.customers);
    customers.push({ id, name: r.Name, colorHex: r.ColorHex || '#0078D4', defaultRate, isActive: toBool(r.IsActive), createdAt: r.CreatedAt });
  }
  const customerIds = new Set(customers.map((c) => c.id));

  const projects = [];
  for (const r of parseCsv(texts[BACKUP_FILES.projects])) {
    const id = Number(r.Id);
    const customerId = Number(r.CustomerId);
    const hourlyRate = toNumberOrNull(r.HourlyRate);
    if (!Number.isInteger(id) || id <= 0 || !r.Name || !customerIds.has(customerId) || Number.isNaN(hourlyRate)) return bad(BACKUP_FILES.projects);
    projects.push({
      id, customerId, name: r.Name, hourlyRate,
      ticketUrlTemplate: r.TicketUrlTemplate || null,
      isActive: toBool(r.IsActive), createdAt: r.CreatedAt
    });
  }
  const projectIds = new Set(projects.map((p) => p.id));

  const entries = [];
  for (const r of parseCsv(texts[BACKUP_FILES.entries])) {
    const id = Number(r.Id);
    const projectId = Number(r.ProjectId);
    if (!Number.isInteger(id) || id <= 0 || !projectIds.has(projectId) || Number.isNaN(Date.parse(r.StartTime))) return bad(BACKUP_FILES.entries);
    if (r.EndTime && Number.isNaN(Date.parse(r.EndTime))) return bad(BACKUP_FILES.entries);
    entries.push({
      id, projectId, startTime: r.StartTime, endTime: r.EndTime || '',
      note: r.Note || '', ticket: r.Ticket || '',
      createdAt: r.CreatedAt || r.StartTime, updatedAt: r.UpdatedAt || r.StartTime
    });
  }

  return { ok: true, data: { customers, projects, entries }, meta };
}
