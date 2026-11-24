// Day tab: hours per project for one day (rounded to 15 minutes, with a copy button and a
// "transferred" tick per project) and the entries of that day with their boundaries and gaps.

import { state } from '../state.js';
import { t } from '../i18n.js';
import { h, clear, colorDot, toast, errorText } from './dom.js';
import { createExportMenu } from './export.js';
import { isEditing, startInlineEdit } from './entry-editor.js';
import { startOfDay, addDays, toDateInputValue, combineDateTime, formatClock } from '../core/time.js';
import { formatHours, formatMoney, formatTime, formatFullDate, formatHm } from '../core/format.js';
import { resolveEntry } from '../core/export.js';
import { buildTicketUrl } from '../core/validate.js';
import { ADJACENT_TOLERANCE_MS, planGapAction } from '../core/adjacent.js';
import { projectDayTotals, splitAtMidnight, localDateKey, transferKey, transferState } from '../core/report.js';
import { setTransfer, deleteTransfer, updateEntries } from '../storage.js';

const $ = (id) => document.getElementById(id);

let selected = startOfDay(new Date());
let lastRenderedMinute = null;
let openAddDialog = () => {};

/** The selected day (a Date at local midnight). */
export function getSelectedDay() {
  return selected;
}

/** Shows another day (used by the week grid). */
export function goToDay(date) {
  selected = startOfDay(date);
  renderDay();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderDay() {
  if (isEditing()) return; // the screen is redrawn when the edit ends
  const now = new Date();
  lastRenderedMinute = Math.floor(now.getTime() / 60000);

  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.focusKey : null;

  $('dayLabel').textContent = formatFullDate(selected);
  $('dayDate').value = toDateInputValue(selected);

  renderProjects(now);
  renderEntryList(now);

  if (focusKey) {
    const again = document.querySelector(`#tabDay [data-focus-key="${focusKey}"]`);
    if (again) again.focus();
  }
}

/** Once per second from the timer: while a timer runs the values move on, redrawn once a minute. */
export function tickDay() {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  if (minute === lastRenderedMinute) return;
  if (!state.entries.some((e) => !e.endTime)) { lastRenderedMinute = minute; return; }
  renderDay();
}

function renderProjects(now) {
  const rows = projectDayTotals({
    entries: state.entries, projects: state.projects, customers: state.customers,
    date: selected, mode: state.settings.roundingMode, now
  });
  const showMoney = state.settings.includeRates;
  const dateKey = localDateKey(selected);
  const list = clear($('dayProjects'));

  if (rows.length === 0) {
    list.append(h('p', { class: 'empty-note' }, t('day.empty')));
  }
  for (const row of rows) list.append(projectRow(row, dateKey, showMoney));

  let sumRounded = 0;
  let sumExact = 0;
  let sumValue = 0;
  let anyValue = false;
  for (const row of rows) {
    sumRounded += row.roundedSeconds;
    sumExact += row.seconds;
    if (row.value !== null) { sumValue += row.value; anyValue = true; }
  }
  const foot = clear($('dayTotals'));
  foot.hidden = rows.length === 0;
  foot.append(
    h('span', { class: 'day-total-label' }, t('day.total')),
    h('strong', {}, `${formatHours(sumRounded / 3600)} h`),
    h('span', { class: 'day-exact' }, t('day.exact', { time: formatHm(sumExact) })));
  if (showMoney && anyValue) foot.append(h('span', { class: 'day-money' }, formatMoney(Math.round(sumValue * 100) / 100)));
}

function projectRow(row, dateKey, showMoney) {
  const key = transferKey(dateKey, row.project.id);
  const record = state.transfersByKey.get(key) || null;
  const stateOfMark = transferState(record, row.hours);
  const hoursText = formatHours(row.hours);

  const checkbox = h('input', {
    type: 'checkbox', checked: stateOfMark !== 'none', disabled: row.running,
    dataset: { focusKey: `done-${row.project.id}` }
  });
  checkbox.checked = stateOfMark !== 'none';
  checkbox.addEventListener('change', async () => {
    try {
      if (checkbox.checked) {
        await setTransfer({
          key, date: dateKey, projectId: row.project.id, hours: row.hours, seconds: row.seconds,
          transferredAt: new Date().toISOString()
        });
      } else {
        await deleteTransfer(key);
      }
    } catch (err) {
      console.error(err);
      toast(errorText('saveFailed'), 'error');
    }
  });

  const copy = h('button', {
    type: 'button', class: 'btn btn-sm btn-outline', dataset: { focusKey: `copy-${row.project.id}` },
    'aria-label': t('day.copyLabel', { project: row.label })
  }, t('day.copy'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(hoursText);
      toast(t('day.copied', { value: hoursText }), 'success');
    } catch {
      toast(t('export.copyFailed'), 'error');
    }
  });

  return h('div', { class: `day-row${row.running ? ' is-running' : ''}` },
    h('div', { class: 'day-row-name' },
      colorDot(row.customer ? row.customer.colorHex : '#9CA3AF'),
      h('span', {}, row.label),
      row.running ? h('span', { class: 'pill pill-running' }, t('status.running')) : null),
    h('div', { class: 'day-row-hours' },
      h('strong', {}, `${hoursText} h`),
      h('span', { class: 'day-exact' }, t('day.exact', { time: formatHm(row.seconds) }))),
    showMoney ? h('div', { class: 'day-row-money' }, row.value === null ? '' : formatMoney(row.value)) : null,
    h('div', { class: 'day-row-actions' },
      copy,
      h('label', { class: 'check-label' }, checkbox, h('span', {}, t('day.transferred'))),
      stateOfMark === 'changed'
        ? h('span', { class: 'transfer-changed' }, t('day.changedSince', { was: formatHours(record.hours) }))
        : null,
      row.running ? h('span', { class: 'day-exact' }, t('day.runningHint')) : null));
}

// ---------------------------------------------------------------------------
// Entries of the day
// ---------------------------------------------------------------------------

/** The parts of entries that fall on the selected day, oldest first. */
function dayItems(now) {
  const key = localDateKey(selected);
  const items = [];
  for (const entry of state.entries) {
    const entryStart = Date.parse(entry.startTime);
    for (const part of splitAtMidnight(entry, now)) {
      if (part.dateKey !== key) continue;
      const entryEnd = entry.endTime ? Date.parse(entry.endTime) : now.getTime();
      items.push({
        entry, startMs: part.startMs, endMs: part.endMs,
        fromPrevious: part.startMs > entryStart,
        continuesNext: part.endMs < entryEnd
      });
    }
  }
  return items.sort((a, b) => a.startMs - b.startMs || a.entry.id - b.entry.id);
}

function minutesText(ms) {
  const minutes = Math.round(ms / 60000);
  return minutes < 60 ? t('day.minutes', { n: minutes }) : formatHm(minutes * 60);
}

function renderEntryList(now) {
  const box = clear($('dayEntries'));
  const items = dayItems(now);
  if (items.length === 0) {
    box.append(h('p', { class: 'empty-note' }, t('day.noEntries')));
    return;
  }
  items.forEach((item, i) => {
    box.append(entryRow(item, now));
    const next = items[i + 1];
    if (next) {
      const between = betweenRow(item, next);
      if (between) box.append(between);
    }
  });
}

/** Boundary, gap or overlap row between two chronological items (only for two ordinary entries). */
function betweenRow(a, b) {
  if (a.entry.id === b.entry.id) return null;
  if (a.continuesNext || b.fromPrevious || !a.entry.endTime) return null;
  const gap = Date.parse(b.entry.startTime) - Date.parse(a.entry.endTime);

  if (Math.abs(gap) <= ADJACENT_TOLERANCE_MS) {
    // The shared boundary: editing it asks whether the neighbour moves too ("Move both" is the default).
    return h('div', { class: 'day-between day-boundary' },
      h('span', { class: 'day-between-label' }, t('day.boundary')),
      editableCell(a.entry, 'end', 'boundary', formatTime(a.entry.endTime)));
  }

  const overlap = gap < 0;
  const from = formatTime(overlap ? b.entry.startTime : a.entry.endTime);
  const to = formatTime(overlap ? a.entry.endTime : b.entry.startTime);
  const message = overlap
    ? t('day.overlap', { from, to })
    : t('day.gap', { from, to, duration: minutesText(gap) });
  const apply = (which) => applyGapAction(a.entry.id, b.entry.id, which);
  return h('div', { class: `day-between ${overlap ? 'day-overlap' : 'day-gap'}` },
    h('span', { class: 'day-between-label' }, message),
    h('span', { class: 'day-between-actions' },
      h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => apply('extendPrevious') },
        t(overlap ? 'day.shortenPrevious' : 'day.extendPrevious')),
      h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => apply('extendNext') },
        t(overlap ? 'day.shortenNext' : 'day.extendNext'))));
}

async function applyGapAction(previousId, nextId, which) {
  const plan = planGapAction(state.entries, previousId, nextId, which, new Date());
  if (plan.error) { toast(errorText(plan.error), 'error'); return; }
  try {
    const result = await updateEntries(plan.patches);
    if (!result.ok) toast(t('entry.changedElsewhere'), 'warning');
  } catch (err) {
    console.error(err);
    toast(errorText('saveFailed'), 'error');
  }
}

/** An editable cell of an entry (works for the entry row and for the shared boundary row). */
function editableCell(entry, field, where, ...content) {
  const cell = h('div', {
    class: 'editable day-cell', tabindex: '0', role: 'button',
    dataset: { entry: entry.id, field, where },
    'aria-label': t(`edit.${field}`)
  }, ...content);
  const edit = () => {
    if (cell.classList.contains('editing')) return;
    const current = state.entries.find((e) => e.id === entry.id);
    if (!current) return;
    startInlineEdit(cell, current, field, () => document.querySelector(
      `#dayEntries [data-entry="${entry.id}"][data-field="${field}"][data-where="${where}"]`));
  };
  cell.addEventListener('click', (e) => { if (!e.target.closest('a')) edit(); });
  cell.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === 'F2') && e.target === cell) { e.preventDefault(); edit(); }
  });
  return cell;
}

function entryRow(item, now) {
  const { entry } = item;
  const running = !entry.endTime;
  const r = resolveEntry(entry, state.projectsById, state.customersById, now);

  const startText = formatTime(item.startMs);
  const endText = item.continuesNext ? '24:00' : formatTime(item.endMs);
  const url = buildTicketUrl(r.project && r.project.ticketUrlTemplate, entry.ticket);
  const ticketContent = entry.ticket
    ? (url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, entry.ticket) : entry.ticket)
    : h('span', { class: 'placeholder' }, '–');

  const note = item.continuesNext ? t('day.continues') : (item.fromPrevious ? t('day.fromPrevious') : null);
  const seconds = Math.round((item.endMs - item.startMs) / 1000);

  return h('div', { class: `day-entry${running ? ' row-running' : ''}`, dataset: { id: entry.id } },
    h('div', { class: 'day-entry-times' },
      editableCell(entry, 'start', 'entry', startText),
      h('span', { class: 'day-dash', 'aria-hidden': 'true' }, '–'),
      running
        ? h('span', { class: 'pill pill-running' }, t('status.running'))
        : editableCell(entry, 'end', 'entry', endText),
      note ? h('span', { class: 'day-part-note' }, note) : null,
      h('code', { class: 'day-duration' }, formatClock(seconds))),
    h('div', { class: 'day-entry-project' },
      running
        ? h('span', { class: 'day-cell' }, colorDotFor(r), projectText(r))
        : editableCell(entry, 'project', 'entry', colorDotFor(r), projectText(r))),
    h('div', { class: 'day-entry-text' },
      editableCell(entry, 'ticket', 'entry', ticketContent),
      editableCell(entry, 'note', 'entry', entry.note || h('span', { class: 'placeholder' }, '–'))));
}

const colorDotFor = (r) => colorDot(r.colorHex);
const projectText = (r) => (r.customerName ? `${r.customerName} › ${r.projectName}` : t('entries.unknownProject'));

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export function initDay({ openAddDialog: openDialog }) {
  openAddDialog = openDialog;
  $('dayExportSlot').append(createExportMenu(() => ({ kind: 'day', date: selected }), 'day.export'));

  $('dayPrev').addEventListener('click', () => goToDay(addDays(selected, -1)));
  $('dayToday').addEventListener('click', () => goToDay(new Date()));
  $('dayNext').addEventListener('click', () => goToDay(addDays(selected, 1)));
  $('dayDate').addEventListener('change', () => {
    const date = combineDateTime($('dayDate').value, '00:00');
    if (date) goToDay(date);
    else $('dayDate').value = toDateInputValue(selected);
  });
  $('btnDayAddEntry').addEventListener('click', () => openAddDialog(selected));
}
