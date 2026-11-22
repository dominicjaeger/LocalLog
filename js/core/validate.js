// Pure validation helpers. Each returns null when valid, otherwise an error code
// that the UI translates (see the "err.*" keys in i18n.js).

import { parseMs } from './time.js';

export function validateTimes(startIso, endIso) {
  const s = parseMs(startIso);
  const e = parseMs(endIso);
  if (s === null || e === null) return 'invalidTime';
  if (e <= s) return 'endBeforeStart';
  return null;
}

/** A running entry's start may not be later than now. */
export function validateStartNotFuture(startMs, nowMs = Date.now()) {
  if (!Number.isFinite(startMs)) return 'invalidTime';
  return startMs > nowMs ? 'startInFuture' : null;
}

export function validateName(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'nameRequired';
  if (n.length > 120) return 'nameTooLong';
  return null;
}

/** An empty template is allowed. Otherwise it must be an https:// address. */
export function validateTicketTemplate(template) {
  const t = String(template ?? '').trim();
  if (!t) return null;
  if (!t.toLowerCase().startsWith('https://')) return 'templateHttps';
  try {
    new URL(t.replace('{ticket}', 'X'));
  } catch {
    return 'templateInvalid';
  }
  return null;
}

export function validateColor(hex) {
  return /^#[0-9a-fA-F]{6}$/.test(String(hex ?? '')) ? null : 'invalidColor';
}

/** Builds the link for a ticket, or null when there is no template or no ticket. */
export function buildTicketUrl(template, ticket) {
  const t = String(template ?? '').trim();
  const id = String(ticket ?? '').trim();
  if (!t || !id) return null;
  if (validateTicketTemplate(t)) return null;
  return t.replace(/\{ticket\}/g, encodeURIComponent(id));
}
