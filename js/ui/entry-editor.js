// Inline editing of one entry field. Shared by the Entries table and the Day view:
// a cell is turned into an input, Enter saves, Esc cancels. Times of a boundary that touches another
// entry ask first whether the neighbour should move too.

import { state, refreshData } from '../state.js';
import { t } from '../i18n.js';
import { h, toast, errorText } from './dom.js';
import { fillProjectSelect } from './picker.js';
import { askBoundary } from './boundary-dialog.js';
import { overlappingEntries, toDateInputValue, toTimeInputValue, latestOccurrenceUpTo } from '../core/time.js';
import { formatTime } from '../core/format.js';
import { resolveEntry } from '../core/export.js';
import { planBoundaryEdit } from '../core/adjacent.js';
import { validateTimes, validateStartNotFuture } from '../core/validate.js';
import { updateEntry, updateEntryIfOpen, updateEntries } from '../storage.js';

let editing = null;

/** True while a cell is being edited (screens then wait with redrawing). */
export function isEditing() {
  return editing !== null;
}

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

/** "Customer › Project, 10:00–11:00" for the question about the neighbour. */
function describeEntry(entry) {
  const r = resolveEntry(entry, state.projectsById, state.customersById);
  const label = r.customerName ? `${r.customerName} › ${r.projectName}` : t('entries.unknownProject');
  const end = entry.endTime ? formatTime(entry.endTime) : t('status.running');
  return `${label}, ${formatTime(entry.startTime)}–${end}`;
}

/**
 * Asks about the neighbour when the edited boundary touches another entry.
 * Returns 'none' (no neighbour: carry on as usual), 'only' (carry on, only this entry),
 * 'done' (both entries were saved) or 'cancel'.
 */
async function handleBoundary(entry, field, patch) {
  const side = field;
  const newIso = patch[side === 'start' ? 'startTime' : 'endTime'];
  const plan = planBoundaryEdit(state.entries, entry.id, side, newIso, new Date());
  if (!plan.neighbour) return 'none';

  const params = { entry: describeEntry(plan.neighbour), time: formatTime(newIso) };
  const answer = await askBoundary({
    text: t(side === 'end' ? 'boundary.next' : 'boundary.prev', params),
    error: plan.error ? t('boundary.collapse') : null
  });
  if (answer === 'cancel') return 'cancel';
  if (answer === 'only') return 'only';

  try {
    const result = await updateEntries(plan.patches);
    if (!result.ok) toast(t('entry.changedElsewhere'), 'warning');
    return 'done';
  } catch (err) {
    console.error(err);
    fail('saveFailed');
    return 'cancel';
  }
}

/** Applies the edited value. Returns false when the change was rejected or cancelled. */
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
  } else if (field === 'start' && !entry.endTime) {
    // Running entry: a typed time later than now means yesterday, so corrections across midnight work.
    if (!timeMatch) return fail('invalidTime');
    if (value === toTimeInputValue(new Date(entry.startTime))) return true;
    const moved = latestOccurrenceUpTo(Date.now(), value);
    if (!moved) return fail('invalidTime');
    const problem = validateStartNotFuture(moved.getTime(), Date.now());
    if (problem) return fail(problem);
    patch = { startTime: moved.toISOString() };
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
  }

  // A start or end that touches a neighbouring entry: ask each time whether to move it too.
  if (field === 'start' || field === 'end') {
    const outcome = await handleBoundary(entry, field, patch);
    if (outcome === 'cancel') return false;
    if (outcome === 'done') return true;
  }

  // Overlap with another entry only gives a warning; nothing else is changed.
  if (entry.endTime ? overlappingEntries(merged, state.entries).length > 0
    : (patch.startTime && overlappingEntries(merged, state.entries).length > 0)) {
    toast(t('entry.overlapWarning'), 'warning');
  }

  try {
    if (!entry.endTime) {
      // Running entry: only written while it is still open (another window may have stopped it).
      const saved = await updateEntryIfOpen(entry.id, patch);
      if (!saved) toast(t('entry.changedElsewhere'), 'warning');
      return true;
    }
    await updateEntry(entry.id, patch);
    return true;
  } catch (err) {
    console.error(err);
    return fail('saveFailed');
  }
}

/** Fields that may be edited while the entry is running. */
export function isEditableWhileRunning(field) {
  return field === 'note' || field === 'ticket' || field === 'start';
}

/**
 * Turns `cell` into an editor for `field` of `entry`. `refocus()` returns the cell to focus after saving
 * (the screen was redrawn by then). Does nothing while another cell is being edited.
 */
export function startInlineEdit(cell, entry, field, refocus) {
  if (editing) return;
  if (!entry.endTime && !isEditableWhileRunning(field)) return;

  const editor = makeEditor(field, entry);
  editing = { id: entry.id, field, done: false };
  cell.classList.add('editing');
  cell.replaceChildren(editor);
  editor.focus();
  if (typeof editor.select === 'function' && editor.type === 'text') editor.select();

  const finish = async (commit, wantFocus) => {
    if (!editing || editing.done) return;
    editing.done = true;
    if (commit) await commitEdit(entry, field, editor.value);
    editing = null;
    await refreshData(); // renders with the saved values
    if (wantFocus) {
      const target = refocus();
      if (target) target.focus();
    }
  };

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
  });
  editor.addEventListener('blur', () => finish(true, false));
  if (editor.tagName === 'SELECT') editor.addEventListener('change', () => finish(true, true));
}
