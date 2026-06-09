import { flagBoolean, flagString } from './args.js';
import { renderTable } from './table.js';

export function writeOutput(result, { flags = {}, stdout = process.stdout } = {}) {
  const text = formatOutput(result, { flags });
  if (text !== undefined && text !== '') stdout.write(`${text}\n`);
}

export function formatOutput(result, { flags = {} } = {}) {
  if (flagBoolean(flags, 'raw')) {
    return typeof result === 'string' ? result : JSON.stringify(result, null, flagBoolean(flags, 'pretty') ? 2 : 0);
  }
  if (flagBoolean(flags, 'json')) return JSON.stringify(result, null, flagBoolean(flags, 'pretty') ? 2 : 0);
  if (flagBoolean(flags, 'ndjson')) return toNdjson(result);
  if (result?.dryRun) return formatDryRun(result);
  if (flagBoolean(flags, 'plain')) return toPlain(result);
  if (flagBoolean(flags, 'csv')) return toCsv(extractItems(result));
  const columns = flagString(flags, 'columns')?.split(',').map((column) => column.trim()).filter(Boolean);
  const items = extractItems(result);
  if (Array.isArray(items)) return renderTable(items, { columns });
  if (result?.data?.data && typeof result.data.data === 'object') return JSON.stringify(result.data.data, null, 2);
  if (result?.data !== undefined) return JSON.stringify(result.data, null, 2);
  return JSON.stringify(result, null, 2);
}

export function extractItems(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data?.data?.items)) return result.data.data.items;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.data)) return result.data;
  return undefined;
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

function toCsv(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const columns = [...new Set(items.flatMap((item) => Object.keys(item).filter((key) => item[key] == null || typeof item[key] !== 'object')))].slice(0, 30);
  return [columns.join(','), ...items.map((item) => columns.map((column) => csvCell(item[column])).join(','))].join('\n');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
