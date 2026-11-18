// LocalLog - CSV Parsing, Serialization & Austrian Locale Formatting Engine

const CultureAT = {
  numberFormat: new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  currencyFormat: new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }),
  dateFormat: new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  timeFormat: new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', hour12: false })
};

export function formatHoursAT(hours) {
  return CultureAT.numberFormat.format(hours);
}

export function formatRateAT(rate) {
  return `${CultureAT.currencyFormat.format(rate)}/h`;
}

export function formatValueAT(val) {
  return CultureAT.currencyFormat.format(val);
}

export function formatDateAT(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj)) dateObj = new Date(dateObj);
  return CultureAT.dateFormat.format(dateObj);
}

export function formatTimeAT(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj)) dateObj = new Date(dateObj);
  return CultureAT.timeFormat.format(dateObj);
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function protectSpreadsheetCell(text) {
  if (!text) return '';
  const clean = String(text).replace(/[\r\n\t]/g, ' ');
  // Prevent Excel formula injection if text starts with =, +, -, or @
  if (/^[=+\-@]/.test(clean)) {
    return `'${clean}`;
  }
  return clean;
}

/**
 * Robust RFC 4180 CSV parser handling multiline, quotes, commas
 */
export function parseCsv(csvText) {
  if (!csvText || !csvText.trim()) return [];
  const lines = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentVal += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentVal.trim());
        currentVal = '';
      } else if (char === '\r') {
        // Ignore carriage returns
      } else if (char === '\n') {
        currentRow.push(currentVal.trim());
        lines.push(currentRow);
        currentRow = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    lines.push(currentRow);
  }

  if (lines.length === 0) return [];

  const headers = lines[0].map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    if (values.length === 1 && !values[0]) continue; // Skip blank lines
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      let val = values[j] !== undefined ? values[j] : '';
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/""/g, '"');
      }
      rowObj[headers[j]] = val;
    }
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Serializes an array of objects to standard CSV string
 */
export function serializeCsv(rows, headers) {
  const headerLine = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',');
  if (!rows || rows.length === 0) {
    return headerLine + '\n';
  }

  const lines = [headerLine];
  for (const r of rows) {
    const line = headers.map(h => {
      const val = r[h] !== undefined && r[h] !== null ? String(r[h]) : '';
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',');
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

/**
 * Generates tab-separated text (TSV) ready for direct paste into Excel
 */
export function generateTsvForExcel(entries, includeRates = false) {
  const headers = ['Date', 'Time', 'Project / Work Block', 'Duration', 'Hours (h)'];
  if (includeRates) {
    headers.push('Rate (EUR/h)', 'Value (EUR)');
  }
  headers.push('Note');

  const lines = [headers.join('\t')];

  for (const e of entries) {
    const safeNote = protectSpreadsheetCell(e.note || '');
    const row = [
      e.dateDisplay,
      e.timeRange,
      e.projectName,
      e.durationDisplay,
      e.hoursDisplay
    ];
    if (includeRates) {
      row.push(e.rateDisplay || '€ 0,00/h', e.valueDisplay || '€ 0,00');
    }
    row.push(safeNote);
    lines.push(row.join('\t'));
  }

  return lines.join('\n');
}
