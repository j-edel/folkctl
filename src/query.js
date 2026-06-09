import { CliError } from './errors.js';
import { flagInteger, flagString, flagValues, flagBoolean } from './args.js';

const OPERATOR_ALIASES = new Map([
  ['is', 'in'],
  ['is_not', 'not_in'],
  ['contains', 'like'],
  ['not_contains', 'not_like'],
]);
const REFERENCE_KEYS = new Set(['id', 'email']);
const REFERENCE_OPERATORS = new Set(['all', 'in', 'not_in']);
const IMPLICIT_REFERENCE_FIELDS = new Set(['groups', 'companies', 'people', 'createdBy']);

export function buildQuery(flags = {}) {
  const query = new URLSearchParams();
  const limit = flagInteger(flags, 'limit');
  const cursor = flagString(flags, 'cursor');
  if (limit !== undefined) query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  if (flagBoolean(flags, 'or')) query.set('combinator', 'or');
  if (flagBoolean(flags, 'and')) query.set('combinator', 'and');
  const combinator = flagString(flags, 'combinator');
  if (combinator) query.set('combinator', combinator);

  for (const raw of flagValues(flags, 'param')) addRawParam(query, raw);
  for (const raw of flagValues(flags, 'query-param')) addRawParam(query, raw);
  for (const raw of flagValues(flags, 'filter')) addFilter(query, raw);
  for (const raw of flagValues(flags, 'filter-empty')) addFilter(query, `${raw}:empty`);
  for (const raw of flagValues(flags, 'empty')) addFilter(query, `${raw}:empty`);
  for (const raw of flagValues(flags, 'not-empty')) addFilter(query, `${raw}:not_empty`);

  const entityId = flagString(flags, 'entity-id');
  if (entityId) query.set('entity.id', entityId);

  return query;
}

export function addRawParam(query, raw) {
  const text = String(raw);
  const index = text.indexOf('=');
  if (index === -1) throw new CliError(`Invalid --param ${JSON.stringify(raw)}. Expected key=value.`, { exitCode: 2 });
  query.append(text.slice(0, index), text.slice(index + 1));
}

export function addFilter(query, raw) {
  const parsed = parseFilter(raw);
  if (parsed.value === undefined) {
    query.append(`filter[${parsed.field}][${parsed.operator}]`, '');
  } else if (parsed.referenceKey) {
    query.append(`filter[${parsed.field}][${parsed.operator}][${parsed.referenceKey}]`, parsed.value);
  } else {
    query.append(`filter[${parsed.field}][${parsed.operator}]`, parsed.value);
  }
}

export function parseFilter(raw) {
  const text = String(raw);
  const parts = text.split(':');
  if (parts.length < 2) {
    throw new CliError(`Invalid --filter ${JSON.stringify(raw)}. Expected field:operator:value, field:operator:refKey:value, or field:empty.`, { exitCode: 2 });
  }
  const [field, rawOperator] = parts;
  const operator = normalizeOperator(rawOperator);
  if (!field || !operator) throw new CliError(`Invalid --filter ${JSON.stringify(raw)}. Field and operator are required.`, { exitCode: 2 });
  if (operator === 'empty' || operator === 'not_empty') return { field, operator };
  const valueParts = parts.slice(2);
  if (!valueParts.length) throw new CliError(`Invalid --filter ${JSON.stringify(raw)}. Missing value.`, { exitCode: 2 });

  if (valueParts.length >= 2 && REFERENCE_KEYS.has(valueParts[0])) {
    return { field, operator, referenceKey: valueParts[0], value: valueParts.slice(1).join(':') };
  }

  const value = valueParts.join(':');
  const implicitReferenceKey = implicitReferenceKeyFor(field, operator, value);
  if (implicitReferenceKey) return { field, operator, referenceKey: implicitReferenceKey, value };
  return { field, operator, value };
}

function normalizeOperator(operator) {
  return OPERATOR_ALIASES.get(operator) || operator;
}

function implicitReferenceKeyFor(field, operator, value) {
  if (!REFERENCE_OPERATORS.has(operator) || !IMPLICIT_REFERENCE_FIELDS.has(field)) return undefined;
  return String(value).includes('@') ? 'email' : 'id';
}

export function queryForSearch(resource, terms) {
  const query = new URLSearchParams();
  const term = terms.join(' ').trim();
  if (!term) throw new CliError(`${resource} search requires a search term.`, { exitCode: 2 });
  query.set('limit', '20');
  query.set('combinator', 'or');
  if (resource === 'people') {
    query.append('filter[fullName][like]', term);
    query.append('filter[emails][like]', term.includes('@') ? term : `@${term}`);
    query.append('filter[jobTitle][like]', term);
  } else if (resource === 'companies') {
    query.append('filter[name][like]', term);
    query.append('filter[emails][like]', term.includes('@') ? term : `@${term}`);
    query.append('filter[urls][like]', term);
  } else if (resource === 'deals') {
    query.append('filter[name][like]', term);
  } else {
    query.append('filter[name][like]', term);
  }
  return query;
}
