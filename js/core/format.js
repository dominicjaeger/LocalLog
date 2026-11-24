// Pure formatting helpers. Number, date and time formats follow the browser locale
// (Intl with an undefined locale). The interface language is handled separately in i18n.js.

const numberFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const longDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayMonthFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit' });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const toDate = (v) => (v instanceof Date ? v : new Date(v));

export function formatHours(hours) {
  return numberFmt.format(hours);
}

export function formatMoney(value) {
  return moneyFmt.format(value);
}

export function formatRate(rate) {
  return `${moneyFmt.format(rate)}/h`;
}

export function formatDate(v) {
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}

export function formatLongDate(v) {
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '' : longDateFmt.format(d);
}

/** "Monday, 16 November 2026" (browser locale). */
export function formatFullDate(v) {
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '' : fullDateFmt.format(d);
}

/** Weekday and day.month for a column heading, for example "Mon 16.11." */
export function formatDayShort(v) {
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '' : `${weekdayFmt.format(d)} ${dayMonthFmt.format(d)}`;
}

/** Whole seconds as h:mm (hours may exceed 24), for example 8220 -> "2:17". Seconds are cut off. */
export function formatHm(seconds) {
  const total = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatTime(v) {
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d);
}

export function decimalSeparator() {
  const part = new Intl.NumberFormat(undefined).formatToParts(1.1).find((p) => p.type === 'decimal');
  return part ? part.value : '.';
}

/**
 * Parses a user-typed amount such as "85", "85,50" or "1.234,50".
 * Empty input is valid and gives null. Returns { valid, value }.
 */
export function parseAmount(text) {
  const raw = String(text ?? '').replace(/[\s€]/g, '');
  if (raw === '') return { valid: true, value: null };
  let s = raw;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // The later separator is the decimal one; the other is a thousands separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { valid: false, value: null };
  return { valid: true, value: Number(s) };
}

/** Plain editable representation of an amount (for input fields). */
export function amountToInput(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace('.', decimalSeparator());
}
