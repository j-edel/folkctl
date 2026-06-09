import { CliError } from './errors.js';

export function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function ensureArray(value) {
  if (value === undefined || value === null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

export function coerceJsonish(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (/^(true|false|null)$/i.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed) || /^[\[{\"]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

export function setDeep(object, dottedKey, value) {
  const path = String(dottedKey).split('.').filter(Boolean);
  if (path.length === 0) throw new CliError(`Invalid empty field path: ${dottedKey}`, { exitCode: 2 });
  let cursor = object;
  for (const key of path.slice(0, -1)) {
    if (cursor[key] === undefined) cursor[key] = {};
    if (typeof cursor[key] !== 'object' || cursor[key] === null || Array.isArray(cursor[key])) {
      throw new CliError(`Cannot set nested field through non-object path: ${dottedKey}`, { exitCode: 2 });
    }
    cursor = cursor[key];
  }
  cursor[path.at(-1)] = value;
}

export function parseAssignment(raw, { label = 'assignment' } = {}) {
  const index = String(raw).indexOf('=');
  if (index === -1) throw new CliError(`Invalid ${label} ${JSON.stringify(raw)}. Expected key=value.`, { exitCode: 2 });
  const key = String(raw).slice(0, index).trim();
  const value = String(raw).slice(index + 1);
  if (!key) throw new CliError(`Invalid ${label} ${JSON.stringify(raw)}. Key cannot be empty.`, { exitCode: 2 });
  return [key, coerceJsonish(value)];
}

export function redact(value) {
  if (!value) return value;
  const text = String(value);
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

export function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}
