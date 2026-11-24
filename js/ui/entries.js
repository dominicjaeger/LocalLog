// Entries tab: table with inline editing, the "Add entry" dialog and today's total.

import { state, saveSetting } from '../state.js';
import { t, tn } from '../i18n.js';
import { h, clear, colorDot, icon, toast, errorText } from './dom.js';
import { fillProjectSelect } from './picker.js';
import { createExportMenu } from './export.js';
import { isEditing, startInlineEdit } from './entry-editor.js';
import {
  entryDurationSeconds, formatClock, rangeFor, inRange, dayRange, totalSeconds, secondsToHours,
  overlappingEntries, toDateInputValue, toTimeInputValue, combineDateTime
} from '../core/time.js';
import { formatDate, formatTime, formatHours, formatMoney } from '../core/format.js';
import { resolveEntry } from '../core/export.js';
import { buildTicketUrl } from '../core/validate.js';
import { addEntry, deleteEntry } from '../storage.js';
import { requestPersistence } from '../backup.js';

const $ = (id) => document.getElementById(id);

// At most this many rows are drawn; "Show more" adds another page. Totals always use all entries.
const ROW_PAGE = 200;

let visibleRows = ROW_PAGE;
let adjustStart = async () => {};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderEntries() {
  if (isEditing()) return; // the screen is redrawn when the edit ends

  const now = new Date();
  const showMoney = state.settings.includeRates;
  $('colRate').hidden = !showMoney;
  $('colValue').hidden = !showMoney;
  $('chkIncludeRates').checked = showMoney;
  $('selRange').value = state.settings.exportRange;

  const range = rangeFor(state.settings.exportRange, now, 0);
  const matching = state.entries
    .filter((e) => !e.endTime || inRange(e, range))
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
  // The running entry is always drawn, even when it is not within the first rows.
  const rows = matching.slice(0, visibleRows);
  for (const open of matching) {
    if (!open.endTime && !rows.includes(open)) rows.unshift(open);
  }

  const tbody = clear($('tbodyEntries'));
  if (rows.length === 0) {
    tbody.append(h('tr', {}, h('td', { class: 'empty-row', colspan: showMoney ? 11 : 9 }, t('entries.empty'))));
  }
  for (const entry of rows) tbody.append(buildRow(entry, now, showMoney));

  const moreRow = $('moreRow');
  moreRow.hidden = matching.length <= visibleRows;
  if (!moreRow.hidden) $('txtMoreInfo').textContent = t('entries.showing', { shown: visibleRows, total: matching.length });

  renderToday();
}

function editableCell(field, label, ...content) {
  return h('td', { class: 'editable', dataset: { field, label: t('col.' + field) }, tabindex: '0', 'aria-label': label }, ...content);
}

function buildRow(entry, now, showMoney) {
  const running = !entry.endTime;
  const r = resolveEntry(entry, state.projectsById, state.customersById, now);
  const start = new Date(entry.startTime);

  const tr = h('tr', { dataset: { id: entry.id }, class: running ? 'row-running' : null });
  if (running) tr.dataset.running = '1';

  const lock = (field, ...content) => (running
    ? h('td', { dataset: { field } }, ...content)
    : editableCell(field, t(`edit.${field}`), ...content));

  tr.append(lock('date', formatDate(start)));
  // The start of a running entry can be corrected; date, end and project stay locked while it runs.
  tr.append(editableCell('start', t('edit.start'), formatTime(start)));
  tr.append(running
    ? h('td', { dataset: { field: 'end' } }, h('span', { class: 'pill pill-running' }, t('status.running')))
    : lock('end', formatTime(entry.endTime)));
  tr.append(lock('project', colorDot(r.colorHex), r.customerName ? `${r.customerName} › ${r.projectName}` : t('entries.unknownProject')));

  const url = buildTicketUrl(r.project && r.project.ticketUrlTemplate, entry.ticket);
  const ticketContent = entry.ticket
    ? (url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, entry.ticket) : entry.ticket)
    : h('span', { class: 'placeholder' }, '–');
  tr.append(editableCell('ticket', t('edit.ticket'), ticketContent));

  tr.append(h('td', { dataset: { field: 'duration', label: t('col.duration') } }, h('code', {}, formatClock(r.seconds))));
  tr.append(h('td', { dataset: { field: 'hours', label: t('col.hours') } }, h('strong', {}, formatHours(r.hours))));
  if (showMoney) {
    tr.append(h('td', { dataset: { field: 'rate', label: t('col.rate') } }, r.rate === null ? '' : formatMoney(r.rate)));
    tr.append(h('td', { dataset: { field: 'value', label: t('col.value') } }, r.value === null ? '' : formatMoney(r.value)));
  }
  tr.append(editableCell('note', t('edit.note'), entry.note || h('span', { class: 'placeholder' }, '–')));

  tr.append(h('td', { class: 'cell-actions' }, running ? null
    : h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-del', 'aria-label': t('entries.delete'), title: t('entries.delete') }, icon('delete'))));

  // The quick buttons for the running entry; only shown in the phone layout (the timer card has them too).
  if (running) {
    tr.append(h('td', { class: 'cell-adjust' },
      h('button', { type: 'button', class: 'btn btn-sm btn-outline btn-adjust', dataset: { minutes: '5' }, 'aria-label': t('timer.back5.label') }, t('timer.back5')),
      h('button', { type: 'button', class: 'btn btn-sm btn-outline btn-adjust', dataset: { minutes: '15' }, 'aria-label': t('timer.back15.label') }, t('timer.back15'))));
  }
  return tr;
}

/** Cheap update once per second: running row and today's total. */
export function tickEntries() {
  const now = new Date();
  const tr = document.querySelector('#tbodyEntries tr[data-running]');
  if (tr) {
    const entry = state.entries.find((e) => e.id === Number(tr.dataset.id));
    if (entry) {
      const seconds = entryDurationSeconds(entry, now);
      const durationCell = tr.querySelector('[data-field="duration"] code');
      const hoursCell = tr.querySelector('[data-field="hours"] strong');
      if (durationCell) durationCell.textContent = formatClock(seconds);
      if (hoursCell) hoursCell.textContent = formatHours(secondsToHours(seconds));
    }
  }
  renderToday(now);
}

export function renderToday(now = new Date()) {
  const range = dayRange(now);
  const today = state.entries.filter((e) => inRange(e, range));
  $('txtTodaySummary').textContent = `${formatHours(secondsToHours(totalSeconds(today, now)))} h`;
  $('txtTodayCount').textContent = tn('today.blocks', today.length);
}

async function handleDelete(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  const r = resolveEntry(entry, state.projectsById, state.customersById);
  const text = t('entries.confirmDelete', {
    project: `${r.customerName} › ${r.projectName}`,
    date: formatDate(entry.startTime),
    time: `${formatTime(entry.startTime)}–${formatTime(entry.endTime)}`
  });
  if (!confirm(text)) return;
  await deleteEntry(id);
}

// ---------------------------------------------------------------------------
// Add entry dialog
// ---------------------------------------------------------------------------

function updateDurationPreview() {
  const box = clear($('dlgDurationPreview'));
  const start = combineDateTime($('dlgEntryDate').value, $('dlgEntryStart').value);
  const end = combineDateTime($('dlgEntryDate').value, $('dlgEntryEnd').value);
  box.classList.remove('is-error');
  if (!start || !end) { box.append(t('entry.previewEmpty')); return null; }
  const seconds = Math.round((end - start) / 1000);
  if (seconds <= 0) {
    box.classList.add('is-error');
    box.append(errorText('endBeforeStart'));
    return null;
  }
  box.append(`${t('entry.previewLabel')} `, h('strong', {}, `${formatClock(seconds)} (${formatHours(secondsToHours(seconds))} h)`));
  return { start, end };
}

/** `date` (a Date, optional) is the day the dialog opens with, for example the selected day of the Day view. */
function openAddDialog(preferredProjectId, date = null) {
  if (!fillProjectSelect($('dlgEntryProject'), preferredProjectId)) {
    toast(t('entry.needProject'), 'warning');
    return;
  }
  const now = new Date();
  $('dlgEntryDate').value = toDateInputValue(date || now);
  $('dlgEntryStart').value = toTimeInputValue(new Date(now.getTime() - 3600 * 1000));
  $('dlgEntryEnd').value = toTimeInputValue(now);
  $('dlgEntryTicket').value = '';
  $('dlgEntryNote').value = '';
  updateDurationPreview();
  $('dlgEntry').showModal();
}

async function saveDialog() {
  const range = updateDurationPreview();
  if (!range) { toast(errorText('endBeforeStart'), 'error'); return; }
  const projectId = Number($('dlgEntryProject').value);
  if (!projectId) { toast(t('entry.needProject'), 'warning'); return; }

  const candidate = { startTime: range.start.toISOString(), endTime: range.end.toISOString() };
  const overlaps = overlappingEntries(candidate, state.entries).length > 0;

  await addEntry({
    projectId,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    note: $('dlgEntryNote').value,
    ticket: $('dlgEntryTicket').value
  });
  requestPersistence();
  $('dlgEntry').close();
  toast(overlaps ? t('entry.savedOverlap') : t('entry.saved'), overlaps ? 'warning' : 'success');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export function initEntries({ getPreferredProjectId, adjustStart: adjust }) {
  adjustStart = adjust;
  $('exportMenuSlot').append(createExportMenu(() => ({ kind: state.settings.exportRange })));

  $('selRange').addEventListener('change', async (e) => {
    await saveSetting('exportRange', e.target.value);
    visibleRows = ROW_PAGE;
    renderEntries();
  });
  $('chkIncludeRates').addEventListener('change', async (e) => {
    await saveSetting('includeRates', e.target.checked);
    renderEntries();
    document.dispatchEvent(new CustomEvent('rates-toggled'));
  });
  $('btnAddEntry').addEventListener('click', () => openAddDialog(getPreferredProjectId()));
  $('btnShowMore').addEventListener('click', () => {
    visibleRows += ROW_PAGE;
    renderEntries();
  });

  const startEdit = (td) => {
    const id = Number(td.closest('tr').dataset.id);
    const field = td.dataset.field;
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    startInlineEdit(td, entry, field, () => document.querySelector(`#tbodyEntries tr[data-id="${id}"] [data-field="${field}"]`));
  };

  const tbody = $('tbodyEntries');
  tbody.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const quick = e.target.closest('.btn-adjust');
    if (quick) { adjustStart(Number(quick.dataset.minutes)); return; }
    const del = e.target.closest('.btn-del');
    if (del) { handleDelete(Number(del.closest('tr').dataset.id)); return; }
    const td = e.target.closest('td.editable');
    if (td && !td.classList.contains('editing')) startEdit(td);
  });
  tbody.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === 'F2') && e.target.matches('td.editable')) {
      e.preventDefault();
      startEdit(e.target);
    }
  });

  for (const id of ['dlgEntryDate', 'dlgEntryStart', 'dlgEntryEnd']) $(id).addEventListener('input', updateDurationPreview);
  $('formEntry').addEventListener('submit', (e) => { e.preventDefault(); saveDialog(); });
  $('btnDlgEntryClose').addEventListener('click', () => $('dlgEntry').close());
  $('btnDlgEntryCancel').addEventListener('click', () => $('dlgEntry').close());

  return { openAddDialog: (date) => openAddDialog(getPreferredProjectId(), date) };
}
