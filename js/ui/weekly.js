// Weekly overview: hours per customer and project (Monday to Sunday) with simple bars.

import { state } from '../state.js';
import { t } from '../i18n.js';
import { h, clear, colorDot } from './dom.js';
import { createExportMenu } from './export.js';
import { weekRange, addDays, secondsToHours } from '../core/time.js';
import { summarizeByCustomer } from '../core/export.js';
import { formatHours, formatMoney, formatLongDate } from '../core/format.js';

const $ = (id) => document.getElementById(id);
let offset = 0;

function bar(seconds, max) {
  const fill = h('span', { class: 'bar-fill' });
  fill.style.setProperty('--w', `${max > 0 ? Math.max(2, Math.round((seconds / max) * 100)) : 0}%`);
  return h('span', { class: 'bar', 'aria-hidden': 'true' }, fill);
}

export function renderWeekly() {
  const now = new Date();
  const range = weekRange(now, offset);
  $('weekLabel').textContent = `${formatLongDate(range.start)} – ${formatLongDate(addDays(range.end, -1))}`;

  const summary = summarizeByCustomer({
    entries: state.entries, projects: state.projects, customers: state.customers, range, now
  });
  const showMoney = state.settings.includeRates;
  const body = clear($('weekBody'));

  $('weekTotal').textContent = `${formatHours(secondsToHours(summary.seconds))} h`
    + (showMoney && summary.value !== null ? ` · ${formatMoney(summary.value)}` : '');

  if (summary.customers.length === 0) {
    body.append(h('p', { class: 'empty-note' }, t('week.empty')));
    return;
  }

  const max = Math.max(...summary.customers.map((c) => c.seconds));
  for (const c of summary.customers) {
    const money = showMoney && c.value !== null ? formatMoney(c.value) : '';
    body.append(h('div', { class: 'week-row week-customer' },
      h('span', { class: 'week-name' }, colorDot(c.customer.colorHex), c.customer.name),
      bar(c.seconds, max),
      h('span', { class: 'week-hours' }, `${formatHours(secondsToHours(c.seconds))} h`),
      h('span', { class: 'week-money' }, money)));
    for (const p of c.projects) {
      const pm = showMoney && p.value !== null ? formatMoney(p.value) : '';
      body.append(h('div', { class: 'week-row week-project' },
        h('span', { class: 'week-name' }, p.project.name),
        bar(p.seconds, max),
        h('span', { class: 'week-hours' }, `${formatHours(secondsToHours(p.seconds))} h`),
        h('span', { class: 'week-money' }, pm)));
    }
  }
}

export function initWeekly() {
  $('weekExportSlot').append(createExportMenu(() => ({ kind: 'week', offset }), 'week.export'));
  $('weekPrev').addEventListener('click', () => { offset -= 1; renderWeekly(); });
  $('weekThis').addEventListener('click', () => { offset = 0; renderWeekly(); });
  $('weekNext').addEventListener('click', () => { offset += 1; renderWeekly(); });
}
