// Pure CSV helpers: parse, serialize, formula protection. No DOM access.

/**
 * Parses CSV text (RFC 4180 style: quotes, embedded separators and line breaks).
 * The first row is the header. Returns an array of objects.
 */
export function parseCsv(text, sep = ',') {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let val = '';
  let inQuotes = false;
  let touched = false;

  const endRow = () => {
    row.push(val);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    val = '';
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { val += '"'; i++; } else { inQuotes = false; }
      } else {
        val += c;
      }
    } else if (c === '"') {
      inQuotes = true;
      touched = true;
    } else if (c === sep) {
      row.push(val);
      val = '';
      touched = true;
    } else if (c === '\r') {
      // ignore; the following \n ends the row
    } else if (c === '\n') {
      endRow();
    } else {
      val += c;
      touched = true;
    }
  }
  if (touched || val !== '' || row.length > 0) endRow();

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((values) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] !== undefined ? values[idx] : ''; });
    return obj;
  });
}

function quoteIfNeeded(value, sep) {
  const s = value === null || value === undefined ? '' : String(value);
  if (s === '' ) return s;
  if (s.includes('"') || s.includes(sep) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serializes rows (arrays) to CSV text. `headers` is an array of strings; rows are arrays of values.
 * Options: sep (default ','), bom (default false), eol (default CRLF).
 */
export function serializeCsv(headers, rows, { sep = ',', bom = false, eol = '\r\n' } = {}) {
  const lines = [headers.map((h) => quoteIfNeeded(h, sep)).join(sep)];
  for (const r of rows) lines.push(r.map((v) => quoteIfNeeded(v, sep)).join(sep));
  return (bom ? '﻿' : '') + lines.join(eol) + eol;
}

/**
 * Protects text from being interpreted as a spreadsheet formula.
 * Also flattens tabs and line breaks so the text stays in a single cell.
 */
export function protectCell(text) {
  if (text === null || text === undefined || text === '') return '';
  const clean = String(text).replace(/[\r\n\t]+/g, ' ');
  return /^\s*[=+\-@]/.test(clean) ? `'${clean}` : clean;
}

/** Flattens a value so it can be used in a tab-separated cell. */
export function flattenCell(text) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ');
}
