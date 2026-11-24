// Export: "Copy table" (for Excel) and "Download as CSV", plus the small drop-down menu that offers them.

import { state } from '../state.js';
import { t } from '../i18n.js';
import { h, icon, toast } from './dom.js';
import { rangeFor } from '../core/time.js';
import { buildExportTable, toClipboardText, toCsvText, exportFileName } from '../core/export.js';
import { projectDayTotals, weekGrid, buildDayTable, buildWeekTable } from '../core/report.js';
import { downloadText } from '../backup.js';

function labels() {
  const keys = ['date', 'start', 'end', 'customer', 'project', 'ticket', 'duration', 'hours', 'rate', 'value', 'note'];
  return Object.fromEntries(keys.map((k) => [k, t(`col.${k}`)]));
}

const evaluationLabels = () => ({
  project: t('col.project'),
  hours: t('day.colHours'),
  exact: t('day.colExact'),
  value: t('col.value'),
  total: t('week.total')
});

/**
 * spec: { kind: 'today' | 'week' | 'month' | 'all', offset? }  - the entries of a range;
 *       { kind: 'day', date }                                   - the per-project rows of one day;
 *       { kind: 'weekgrid', weekStart }                          - the week timesheet grid.
 * Returns { table, fileName }.
 */
function exportFor(spec) {
  const now = new Date();
  const base = { entries: state.entries, projects: state.projects, customers: state.customers };
  const mode = state.settings.roundingMode;
  const includeRates = state.settings.includeRates;

  if (spec.kind === 'day') {
    const rows = projectDayTotals({ ...base, date: spec.date, mode, now });
    return { table: buildDayTable({ rows, includeRates, labels: evaluationLabels() }), fileName: exportFileName('day', spec.date) };
  }
  if (spec.kind === 'weekgrid') {
    const grid = weekGrid({ ...base, weekStart: spec.weekStart, mode, now });
    return { table: buildWeekTable({ grid, includeRates, labels: evaluationLabels() }), fileName: exportFileName('week', spec.weekStart) };
  }
  const table = buildExportTable({
    ...base, range: rangeFor(spec.kind, now, spec.offset || 0), includeRates, labels: labels(), now
  });
  return { table, fileName: exportFileName(spec.kind) };
}

export async function copyTable(spec) {
  const { table } = exportFor(spec);
  if (table.rows.length === 0) {
    toast(t('export.nothing'), 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(toClipboardText(table));
    toast(t('export.copied', { n: table.rows.length }), 'success');
  } catch {
    toast(t('export.copyFailed'), 'error');
  }
}

export function downloadCsv(spec) {
  const { table, fileName } = exportFor(spec);
  if (table.rows.length === 0) {
    toast(t('export.nothing'), 'warning');
    return;
  }
  downloadText(toCsvText(table), fileName, 'text/csv;charset=utf-8');
  toast(t('export.downloaded', { n: table.rows.length }), 'success');
}

/** Builds an "Export" button with its menu. `getSpec` returns what to export when an item is chosen. */
export function createExportMenu(getSpec, label = 'export.button') {
  const button = h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    icon('export'), h('span', { 'data-i18n': label }, t(label)));
  const list = h('div', { class: 'menu-list', hidden: true, role: 'menu' },
    h('button', { type: 'button', role: 'menuitem', class: 'menu-item', 'data-i18n': 'export.copy', onclick: () => { close(); copyTable(getSpec()); } }, t('export.copy')),
    h('button', { type: 'button', role: 'menuitem', class: 'menu-item', 'data-i18n': 'export.csv', onclick: () => { close(); downloadCsv(getSpec()); } }, t('export.csv'))
  );
  const root = h('div', { class: 'menu' }, button, list);

  function close() {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = list.hidden;
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) list.querySelector('button').focus();
  });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); button.focus(); }
  });
  return root;
}
