// Project picker: <select> with one <optgroup> per customer.

import { h } from './dom.js';
import { t } from '../i18n.js';
import { pickerGroups } from '../state.js';

/**
 * Fills a <select> with the customers and projects that can be chosen.
 * `selectedId` is selected when present; it also stays listed when it is inactive.
 * Returns true when at least one project is available.
 */
export function fillProjectSelect(select, selectedId = null, { placeholder = false } = {}) {
  const previous = selectedId !== null && selectedId !== undefined ? Number(selectedId) : null;
  select.replaceChildren();
  const groups = pickerGroups(previous);

  if (groups.length === 0) {
    select.append(h('option', { value: '' }, t('picker.none')));
    return false;
  }
  if (placeholder) select.append(h('option', { value: '' }, t('picker.choose')));

  for (const { customer, projects } of groups) {
    const group = h('optgroup', { label: customer.name });
    for (const p of projects) {
      const inactive = !p.isActive || !customer.isActive;
      group.append(h('option', { value: p.id }, inactive ? `${p.name} (${t('status.inactive')})` : p.name));
    }
    select.append(group);
  }
  if (previous !== null && select.querySelector(`option[value="${previous}"]`)) select.value = String(previous);
  return true;
}
