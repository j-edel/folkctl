import { flagBoolean, flagString } from './args.js';
import { renderTable } from './table.js';

const BATCH_COLUMNS = ['index', 'status', 'id', 'name', 'operation', 'error', 'warnings', 'removedGroups'];

export function writeOutput(result, { flags = {}, stdout = process.stdout, columns } = {}) {
  const text = formatOutput(result, { flags, columns });
  if (text !== undefined && text !== '') stdout.write(`${text}\n`);
}

// columns sets the default table columns for a command; --columns still takes precedence.
export function formatOutput(result, { flags = {}, columns: defaultColumns } = {}) {
  if (flagBoolean(flags, 'raw')) {
    return typeof result === 'string' ? result : JSON.stringify(result, null, flagBoolean(flags, 'pretty') ? 2 : 0);
  }
  if (flagBoolean(flags, 'json')) return JSON.stringify(result, null, flagBoolean(flags, 'pretty') ? 2 : 0);
  if (flagBoolean(flags, 'ndjson')) return toNdjson(result);
  if (result?.dryRun) return formatDryRun(result);
  const batchResults = batchResultsOf(result);
  if (batchResults) return formatBatch(batchResults, { flags });
  if (flagBoolean(flags, 'plain')) return toPlain(result);
  if (flagBoolean(flags, 'csv')) return toCsv(extractItems(result));
  const columns = flagString(flags, 'columns')?.split(',').map((column) => column.trim()).filter(Boolean);
  const items = extractItems(result);
  if (Array.isArray(items)) return renderTable(items, { columns: columns?.length ? columns : presentColumns(items, defaultColumns) });
  if (result?.data?.data && typeof result.data.data === 'object') return JSON.stringify(result.data.data, null, 2);
  if (result?.data !== undefined) return JSON.stringify(result.data, null, 2);
  return JSON.stringify(result, null, 2);
}

export function extractItems(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data?.data?.items)) return result.data.data.items;
  if (Array.isArray(result?.data?.data?.results)) return result.data.data.results;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.data)) return result.data;
  return undefined;
}

function batchResultsOf(result) {
  const results = result?.data?.data?.results;
  return Array.isArray(results) ? results : undefined;
}

// One row per record, in request order, so row N is the outcome of records[N].
export function flattenBatchResult(entry, index) {
  const row = {
    index,
    status: entry?.status,
    id: entry?.data?.id,
    name: entry?.data?.fullName || entry?.data?.name,
    operation: entry?.operation,
    error: entry?.error ? [entry.error.code, entry.error.message].filter(Boolean).join(': ') : undefined,
    warnings: Array.isArray(entry?.warnings) && entry.warnings.length ? entry.warnings.join('; ') : undefined,
    removedGroups: Array.isArray(entry?.removedGroups) && entry.removedGroups.length ? entry.removedGroups.map((group) => group.id).join(', ') : undefined,
  };
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function formatBatch(results, { flags }) {
  const rows = results.map(flattenBatchResult);
  if (flagBoolean(flags, 'plain')) return rows.filter((row) => row.status === 'succeeded' && row.id).map((row) => row.id).join('\n');
  if (flagBoolean(flags, 'csv')) return toCsv(rows, BATCH_COLUMNS);
  const columns = flagString(flags, 'columns')?.split(',').map((column) => column.trim()).filter(Boolean);
  return renderTable(rows, { columns: columns?.length ? columns : presentColumns(rows, BATCH_COLUMNS) });
}

function presentColumns(items, columns) {
  if (!columns?.length) return undefined;
  const present = columns.filter((column) => items.some((item) => item?.[column] !== undefined && item?.[column] !== null));
  return present.length ? present : undefined;
}

function formatDryRun(result) {
  const request = result.request || result;
  const lines = [`${request.method || 'GET'} ${request.url}`];
  for (const [name, value] of Object.entries(request.headers || {})) lines.push(`${name}: ${value}`);
  if (request.body !== undefined) lines.push('', JSON.stringify(request.body, null, 2));
  return lines.join('\n');
}

function toPlain(result) {
  const items = extractItems(result);
  if (Array.isArray(items)) return items.map((item) => item.id || item.fullName || item.name || item.email || JSON.stringify(item)).join('\n');
  const data = result?.data?.data ?? result?.data ?? result;
  if (data == null) return '';
  if (typeof data === 'object') return data.id || data.fullName || data.name || JSON.stringify(data);
  return String(data);
}

function toNdjson(result) {
  const items = extractItems(result);
  if (Array.isArray(items)) return items.map((item) => JSON.stringify(item)).join('\n');
  return JSON.stringify(result);
}

function toCsv(items, preferred) {
  if (!Array.isArray(items) || !items.length) return '';
  const keys = [...new Set(items.flatMap((item) => Object.keys(item).filter((key) => item[key] == null || typeof item[key] !== 'object')))];
  const columns = (preferred ? [...preferred.filter((key) => keys.includes(key)), ...keys.filter((key) => !preferred.includes(key))] : keys).slice(0, 30);
  return [columns.join(','), ...items.map((item) => columns.map((column) => csvCell(item[column])).join(','))].join('\n');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
