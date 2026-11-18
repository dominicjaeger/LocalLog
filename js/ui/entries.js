// Entries tab: table with inline editing, the "Add entry" dialog and today's total.

import { state, saveSetting, refreshData } from '../state.js';
import { t, tn } from '../i18n.js';
import { h, clear, colorDot, icon, toast, errorText } from './dom.js';
import { fillProjectSelect } from './picker.js';
import { createExportMenu } from './export.js';
import {
  entryDurationSeconds, formatClock, rangeFor, inRange, dayRange, totalSeconds, secondsToHours,
  overlappingEntries, toDateInputValue, toTimeInputValue, combineDateTime
} from '../core/time.js';
import { formatDate, formatTime, formatHours, formatMoney } from '../core/format.js';
import { resolveEntry } from '../core/export.js';
import { validateTimes, buildTicketUrl } from '../core/validate.js';
import { addEntry, updateEntry, deleteEntry } from '../storage.js';
import { requestPersistence } from '../backup.js';

const $ = (id) => document.getElementById(id);

let editing = null;
let renderPending = false;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderEntries() {
  if (editing) { renderPending = true; return; }
  renderPending = false;

  const now = new Date();
  const showMoney = state.settings.includeRates;
  $('colRate').hidden = !showMoney;
  $('colValue').hidden = !showMoney;
  $('chkIncludeRates').checked = showMoney;
  $('selRange').value = state.settings.exportRange;

  const range = rangeFor(state.settings.exportRange, now, 0);
  const rows = state.entries
    .filter((e) => !e.endTime || inRange(e, range))
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));

  const tbody = clear($('tbodyEntries'));
  if (rows.length === 0) {
    tbody.append(h('tr', {}, h('td', { class: 'empty-row', colspan: showMoney ? 11 : 9 }, t('entries.empty'))));
  }
  for (const entry of rows) tbody.append(buildRow(entry, now, showMoney));

  renderToday();
}

function editableCell(field, label, ...content) {
  return h('td', { class: 'editable', dataset: { field }, tabindex: '0', 'aria-label': label }, ...content);
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
  tr.append(lock('start', formatTime(start)));
  tr.append(running
    ? h('td', { dataset: { field: 'end' } }, h('span', { class: 'pill pill-running' }, t('status.running')))
    : lock('end', formatTime(entry.endTime)));
  tr.append(lock('project', colorDot(r.colorHex), r.customerName ? `${r.customerName} › ${r.projectName}` : t('entries.unknownProject')));

  const url = buildTicketUrl(r.project && r.project.ticketUrlTemplate, entry.ticket);
  const ticketContent = entry.ticket
    ? (url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, entry.ticket) : entry.ticket)
    : h('span', { class: 'placeholder' }, '–');
  tr.append(editableCell('ticket', t('edit.ticket'), ticketContent));

  tr.append(h('td', { dataset: { field: 'duration' } }, h('code', {}, formatClock(r.seconds))));
  tr.append(h('td', { dataset: { field: 'hours' } }, h('strong', {}, formatHours(r.hours))));
  if (showMoney) {
    tr.append(h('td', {}, r.rate === null ? '' : formatMoney(r.rate)));
    tr.append(h('td', { dataset: { field: 'value' } }, r.value === null ? '' : formatMoney(r.value)));
  }
  tr.append(editableCell('note', t('edit.note'), entry.note || h('span', { class: 'placeholder' }, '–')));

  tr.append(h('td', { class: 'cell-actions' }, running ? null
    : h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-del', 'aria-label': t('entries.delete'), title: t('entries.delete') }, icon('delete'))));
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

// ---------------------------------------------------------------------------
// Inline editing
// ---------------------------------------------------------------------------

function makeEditor(field, entry) {
  switch (field) {
    case 'date':
      return h('input', { type: 'date', class: 'cell-input', value: toDateInputValue(new Date(entry.startTime)), required: true });
    case 'start':
      return h('input', { type: 'time', class: 'cell-input', step: '60', value: toTimeInputValue(new Date(entry.startTime)), required: true });
    case 'end':
      return h('input', { type: 'time', class: 'cell-input', step: '60', value: toTimeInputValue(new Date(entry.endTime)), required: true });
    case 'project': {
      const select = h('select', { class: 'cell-input' });
      fillProjectSelect(select, entry.projectId);
      return select;
    }
    case 'ticket':
      return h('input', { type: 'text', class: 'cell-input', maxlength: '60', value: entry.ticket || '', placeholder: t('entry.ticketPlaceholder') });
    default:
      return h('input', { type: 'text', class: 'cell-input', maxlength: '500', value: entry.note || '' });
  }
}

function fail(code) {
  toast(errorText(code), 'error');
  return false;
}

/** Applies the edited value. Returns false when the change was rejected. */
async function commitEdit(entry, field, value) {
  let patch;
  const timeMatch = /^(\d{1,2}):(\d{2})/.exec(value);

  if (field === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return fail('invalidTime');
    const oldStart = new Date(entry.startTime);
    const newStart = new Date(oldStart);
    newStart.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const shift = newStart.getTime() - oldStart.getTime();
    if (shift === 0) return true;
    // Moving to another day keeps start time and duration.
    patch = { startTime: newStart.toISOString(), endTime: new Date(Date.parse(entry.endTime) + shift).toISOString() };
  } else if (field === 'start' || field === 'end') {
    const key = field === 'start' ? 'startTime' : 'endTime';
    const base = new Date(entry[key]);
    if (!timeMatch) return fail('invalidTime');
    if (value === toTimeInputValue(base)) return true; // unchanged: keep the exact seconds
    base.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    patch = { [key]: base.toISOString() };
  } else if (field === 'project') {
    const id = Number(value);
    if (!id || id === entry.projectId) return true;
    patch = { projectId: id };
  } else if (field === 'ticket') {
    if (value.trim() === (entry.ticket || '')) return true;
    patch = { ticket: value.trim() };
  } else {
    if (value === (entry.note || '')) return true;
    patch = { note: value };
  }

  const merged = { ...entry, ...patch };
  if (entry.endTime) {
    const error = validateTimes(merged.startTime, merged.endTime);
    if (error) return fail(error);
    if (overlappingEntries(merged, state.entries).length > 0) toast(t('entry.overlapWarning'), 'warning');
  }

  try {
    await updateEntry(entry.id, patch);
    return true;
  } catch (err) {
    console.error(err);
    return fail('saveFailed');
  }
}

function startEdit(td) {
  if (editing) return;
  const tr = td.closest('tr');
  const id = Number(tr.dataset.id);
  const field = td.dataset.field;
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  if (!entry.endTime && field !== 'note' && field !== 'ticket') return;

  const editor = makeEditor(field, entry);
  editing = { id, field, done: false };
  td.classList.add('editing');
  td.replaceChildren(editor);
  editor.focus();
  if (typeof editor.select === 'function' && editor.type === 'text') editor.select();

  const finish = async (commit, refocus) => {
    if (!editing || editing.done) return;
    editing.done = true;
    if (commit) await commitEdit(entry, field, editor.value);
    editing = null;
    await refreshData(); // renders with the saved values
    if (refocus) {
      const cell = document.querySelector(`#tbodyEntries tr[data-id="${id}"] [data-field="${field}"]`);
      if (cell) cell.focus();
    }
  };

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
  });
  editor.addEventListener('blur', () => finish(true, false));
  if (editor.tagName === 'SELECT') editor.addEventListener('change', () => finish(true, true));
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

function openAddDialog(preferredProjectId) {
  if (!fillProjectSelect($('dlgEntryProject'), preferredProjectId)) {
    toast(t('entry.needProject'), 'warning');
    return;
  }
  const now = new Date();
  $('dlgEntryDate').value = toDateInputValue(now);
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

export function initEntries(getPreferredProjectId) {
  $('exportMenuSlot').append(createExportMenu(() => ({ kind: state.settings.exportRange })));

  $('selRange').addEventListener('change', async (e) => {
    await saveSetting('exportRange', e.target.value);
    renderEntries();
  });
  $('chkIncludeRates').addEventListener('change', async (e) => {
    await saveSetting('includeRates', e.target.checked);
    renderEntries();
    document.dispatchEvent(new CustomEvent('rates-toggled'));
  });
  $('btnAddEntry').addEventListener('click', () => openAddDialog(getPreferredProjectId()));

  const tbody = $('tbodyEntries');
  tbody.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
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
}
