// Week tab: the timesheet grid (projects x Monday-Sunday) with rounded day hours.
// Clicking a cell or a day heading opens the Day tab on that date.

import { state } from '../state.js';
import { t } from '../i18n.js';
import { h, clear, colorDot } from './dom.js';
import { createExportMenu } from './export.js';
import { startOfWeek, addDays } from '../core/time.js';
import { formatHours, formatMoney, formatLongDate, formatDayShort, formatHm } from '../core/format.js';
import { weekGrid, transferKey, transferState } from '../core/report.js';

const $ = (id) => document.getElementById(id);
let offset = 0;
let openDay = () => {};

const weekStart = (now = new Date()) => addDays(startOfWeek(now), offset * 7);

export function renderWeekly() {
  const now = new Date();
  const start = weekStart(now);
  const grid = weekGrid({
    entries: state.entries, projects: state.projects, customers: state.customers,
    weekStart: start, mode: state.settings.roundingMode, now
  });
  const showMoney = state.settings.includeRates;

  $('weekLabel').textContent = `${formatLongDate(start)} – ${formatLongDate(addDays(start, 6))}`;
  $('weekTotal').textContent = `${formatHours(grid.totalRounded / 3600)} h`
    + (showMoney && grid.totalValue !== null ? ` · ${formatMoney(grid.totalValue)}` : '');
  $('weekExact').textContent = t('week.exact', { time: formatHm(grid.totalExact) });

  const wrap = clear($('weekGridWrap'));
  if (grid.rows.length === 0) {
    wrap.append(h('p', { class: 'empty-note' }, t('week.empty')));
    $('weekExact').hidden = true;
    return;
  }
  $('weekExact').hidden = false;

  const dayButton = (day) => h('button', {
    type: 'button', class: 'week-day-btn', title: t('week.openDay'),
    onclick: () => openDay(day)
  }, formatDayShort(day));

  const head = h('tr', {},
    h('th', { scope: 'col', class: 'week-col-name' }, t('col.project')),
    ...grid.days.map((day) => h('th', { scope: 'col', class: 'week-col-day' }, dayButton(day))),
    h('th', { scope: 'col', class: 'week-col-total' }, t('week.total')),
    showMoney ? h('th', { scope: 'col', class: 'week-col-total' }, t('col.value')) : null);

  const body = grid.rows.map((row) => h('tr', {},
    h('th', { scope: 'row', class: 'week-col-name' }, colorDot(row.customer ? row.customer.colorHex : '#9CA3AF'), row.label),
    ...row.cells.map((cell, i) => weekCell(grid, row, cell, i, openDay)),
    h('td', { class: 'week-col-total' }, h('strong', {}, formatHours(row.totalRounded / 3600))),
    showMoney ? h('td', { class: 'week-col-total' }, row.value === null ? '' : formatMoney(row.value)) : null));

  const foot = h('tr', {},
    h('th', { scope: 'row', class: 'week-col-name' }, t('week.dayTotal')),
    ...grid.dayTotals.map((d) => h('td', { class: 'week-col-day' }, d.seconds === 0 ? '' : formatHours(d.roundedSeconds / 3600))),
    h('td', { class: 'week-col-total' }, h('strong', {}, formatHours(grid.totalRounded / 3600))),
    showMoney ? h('td', { class: 'week-col-total' }, grid.totalValue === null ? '' : formatMoney(grid.totalValue)) : null);

  wrap.append(h('div', { class: 'table-responsive week-grid-scroll' },
    h('table', { class: 'data-table week-grid', 'aria-label': t('week.gridLabel') },
      h('thead', {}, head), h('tbody', {}, ...body), h('tfoot', {}, foot))));
}

function weekCell(grid, row, cell, index, open) {
  if (cell.seconds === 0) return h('td', { class: 'week-col-day' });
  const hours = cell.roundedSeconds / 3600;
  const record = state.transfersByKey.get(transferKey(grid.dateKeys[index], row.project.id)) || null;
  const mark = transferState(record, hours);
  const markText = mark === 'done' ? t('week.markDone') : (mark === 'changed' ? t('week.markChanged') : '');
  const button = h('button', {
    type: 'button', class: `week-cell${mark === 'none' ? '' : ` is-${mark}`}`,
    title: t('week.openDay'),
    'aria-label': `${formatHours(hours)} h${markText ? `, ${markText}` : ''}`,
    onclick: () => open(grid.days[index])
  }, formatHours(hours), mark === 'none' ? null : h('span', { class: 'cell-mark', 'aria-hidden': 'true', title: markText }, mark === 'done' ? '✓' : '!'));
  return h('td', { class: 'week-col-day' }, button);
}

export function initWeekly({ openDay: open }) {
  openDay = open;
  $('weekExportSlot').append(createExportMenu(() => ({ kind: 'weekgrid', weekStart: weekStart() }), 'week.export'));
  $('weekPrev').addEventListener('click', () => { offset -= 1; renderWeekly(); });
  $('weekThis').addEventListener('click', () => { offset = 0; renderWeekly(); });
  $('weekNext').addEventListener('click', () => { offset += 1; renderWeekly(); });
}
