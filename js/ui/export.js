// Export: "Copy table" (for Excel) and "Download as CSV", plus the small drop-down menu that offers them.

import { state } from '../state.js';
import { t } from '../i18n.js';
import { h, icon, toast } from './dom.js';
import { rangeFor } from '../core/time.js';
import { buildExportTable, toClipboardText, toCsvText, exportFileName } from '../core/export.js';
import { downloadText } from '../backup.js';

function labels() {
  const keys = ['date', 'start', 'end', 'customer', 'project', 'ticket', 'duration', 'hours', 'rate', 'value', 'note'];
  return Object.fromEntries(keys.map((k) => [k, t(`col.${k}`)]));
}

/** spec: { kind: 'today' | 'week' | 'month' | 'all', offset?: number } */
function tableFor(spec) {
  const now = new Date();
  return buildExportTable({
    entries: state.entries,
    projects: state.projects,
    customers: state.customers,
    range: rangeFor(spec.kind, now, spec.offset || 0),
    includeRates: state.settings.includeRates,
    labels: labels(),
    now
  });
}

export async function copyTable(spec) {
  const table = tableFor(spec);
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
  const table = tableFor(spec);
  if (table.rows.length === 0) {
    toast(t('export.nothing'), 'warning');
    return;
  }
  downloadText(toCsvText(table), exportFileName(spec.kind), 'text/csv;charset=utf-8');
  toast(t('export.downloaded', { n: table.rows.length }), 'success');
}

/** Builds an "Export" button with its menu. `getSpec` returns the range to export when an item is chosen. */
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
