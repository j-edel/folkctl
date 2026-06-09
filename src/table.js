const DEFAULT_COLUMNS = ['id', 'name', 'fullName', 'email', 'jobTitle', 'entityType', 'status', 'createdAt'];

export function renderTable(items, { columns } = {}) {
  if (!Array.isArray(items) || items.length === 0) return '(no items)';
  const selected = columns?.length ? columns : inferColumns(items);
  const rows = items.map((item) => selected.map((column) => stringifyCell(readPath(item, column))));
  const widths = selected.map((column, index) => Math.min(60, Math.max(column.length, ...rows.map((row) => row[index].length))));
  const header = selected.map((column, index) => pad(column, widths[index])).join('  ');
  const rule = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = rows.map((row) => row.map((cell, index) => pad(truncate(cell, widths[index]), widths[index])).join('  '));
  return [header, rule, ...body].join('\n');
}

export function inferColumns(items) {
  const seen = new Set();
  for (const preferred of DEFAULT_COLUMNS) {
    if (items.some((item) => readPath(item, preferred) !== undefined)) seen.add(preferred);
  }
  for (const item of items) {
    for (const key of Object.keys(item || {})) {
      if (seen.size >= 8) break;
      const value = item[key];
      if (!seen.has(key) && isPrimitiveish(value)) seen.add(key);
    }
  }
  return [...seen].slice(0, 8);
}

export function readPath(object, path) {
  return String(path).split('.').reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), object);
}

function stringifyCell(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry == null) return '';
      if (typeof entry === 'object') return entry.email || entry.name || entry.fullName || entry.id || JSON.stringify(entry);
      return String(entry);
    }).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') return value.email || value.name || value.fullName || value.id || JSON.stringify(value);
  return String(value);
}

function isPrimitiveish(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function pad(value, width) {
  const text = truncate(value, width);
  return `${text}${' '.repeat(Math.max(0, width - text.length))}`;
}

function truncate(value, width) {
  const text = String(value);
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}
