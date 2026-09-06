import { CliError } from './errors.js';

const DEFAULT_ALIASES = new Map([
  ['h', 'help'],
  ['j', 'json'],
  ['q', 'quiet'],
  ['v', 'verbose'],
  ['y', 'yes'],
]);

const BOOLEAN_FLAGS = new Set([
  'all',
  'and',
  'check',
  'csv',
  'dry-run',
  'force',
  'help',
  'json',
  'is-public',
  'only-assigned-to-me',
  'or',
  'ndjson',
  'no-color',
  'no-input',
  'no-retry',
  'plain',
  'pretty',
  'quiet',
  'raw',
  'table',
  'token-stdin',
  'verbose',
  'version',
  'yes',
]);

export function parseFlagArgs(argv, { aliases = DEFAULT_ALIASES } = {}) {
  const flags = Object.create(null);
  const positionals = [];
  let passthrough = false;

  function addFlag(name, value) {
    const normalized = normalizeFlagName(name);
    if (Object.prototype.hasOwnProperty.call(flags, normalized)) {
      const previous = flags[normalized];
      flags[normalized] = Array.isArray(previous) ? [...previous, value] : [previous, value];
    } else {
      flags[normalized] = value;
    }
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (passthrough) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      passthrough = true;
      continue;
    }
    if (token.startsWith('--no-') && token.length > 5) {
      const name = token.slice(5);
      addFlag(name, false);
      addFlag(`no-${name}`, true);
      continue;
    }
    if (token.startsWith('--') && token.length > 2) {
      const raw = token.slice(2);
      const equalsIndex = raw.indexOf('=');
      if (equalsIndex !== -1) {
        addFlag(raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1));
        continue;
      }
      const name = normalizeFlagName(raw);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(name)) {
        if (next !== undefined && (!next.startsWith('-') || next === '-')) {
          addFlag(name, next);
          i += 1;
        } else {
          throw new CliError(`Missing value for --${name}.`, { exitCode: 2 });
        }
      } else {
        if (['is-public', 'only-assigned-to-me'].includes(name) && next !== undefined && (!next.startsWith('-') || next === '-')) {
          addFlag(name, next);
          i += 1;
        } else addFlag(name, true);
      }
      continue;
    }
    if (/^-[A-Za-z]+$/.test(token) && token !== '-') {
      const shorts = token.slice(1).split('');
      for (const short of shorts) {
        addFlag(aliases.get(short) || short, true);
      }
      continue;
    }
    positionals.push(token);
  }

  return { flags, positionals };
}

export function normalizeFlagName(name) {
  return String(name).replace(/_/g, '-');
}

export function getFlag(flags, name, fallback = undefined) {
  const normalized = normalizeFlagName(name);
  return Object.prototype.hasOwnProperty.call(flags, normalized) ? flags[normalized] : fallback;
}

export function hasFlag(flags, name) {
  return Object.prototype.hasOwnProperty.call(flags, normalizeFlagName(name));
}

export function flagValues(flags, name) {
  const value = getFlag(flags, name);
  if (value === undefined || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

export function flagString(flags, name, fallback = undefined) {
  const value = getFlag(flags, name, fallback);
  if (Array.isArray(value)) return value.at(-1);
  if (value === true || value === false || value === undefined) return fallback;
  return String(value);
}

export function flagBoolean(flags, name, fallback = false) {
  const value = getFlag(flags, name, fallback);
  if (Array.isArray(value)) return coerceBoolean(value.at(-1), fallback);
  return coerceBoolean(value, fallback);
}

export function flagBooleanStrict(flags, name) {
  const raw = getFlag(flags, name);
  const value = Array.isArray(raw) ? raw.at(-1) : raw;
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (['true', '1', 'yes', 'on', 'false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase())) {
    return coerceBoolean(value, false);
  }
  throw new CliError(`Invalid --${name}. Expected true or false.`, { exitCode: 2 });
}

export function flagInteger(flags, name, fallback = undefined) {
  const value = flagString(flags, name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coerceBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  }
  return Boolean(value);
}
