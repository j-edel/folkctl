import fs from 'node:fs/promises';
import { CliError } from './errors.js';
import { flagString, flagValues, flagBooleanStrict } from './args.js';
import { BATCH_MAX_RECORDS, ENRICHMENT_MAX_PEOPLE } from './endpoints.js';
import { assertSafeKey, parseAssignment, setDeep, splitList } from './util.js';

export async function readStdinText(stdin) {
  if (!stdin) return '';
  let data = '';
  stdin.setEncoding?.('utf8');
  for await (const chunk of stdin) data += chunk;
  return data;
}

async function readInputText(source, stdin) {
  let text = source;
  if (source === '-') text = await readStdinText(stdin);
  else if (source.startsWith('@')) text = await fs.readFile(source.slice(1), 'utf8');
  // Editors and spreadsheet exports often start files with a byte-order mark, which JSON.parse rejects.
  return String(text).replace(/^﻿/, '');
}

function dataSource(flags) {
  return flagString(flags, 'data') || flagString(flags, 'body') || flagString(flags, 'file');
}

export async function readJsonInput(source, stdin) {
  if (!source) return undefined;
  const text = await readInputText(source, stdin);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`Invalid JSON supplied to --data: ${error.message}`, { exitCode: 2, cause: error });
  }
}

async function readDataObject(flags, stdin) {
  const source = dataSource(flags);
  if (!source) return {};
  const body = await readJsonInput(source, stdin);
  if (!isPlainObject(body)) throw new CliError('--data must be a JSON object for this command.', { exitCode: 2 });
  return body;
}

// --field path.to.key=value applies generic deep assignment on top of --data.
export function applyFieldFlags(body, flags) {
  for (const raw of flagValues(flags, 'field')) {
    const [key, value] = parseAssignment(raw, { label: '--field' });
    setDeep(body, key, value);
  }
  return body;
}

export async function buildGenericBody(flags, stdin) {
  return applyFieldFlags(await readDataObject(flags, stdin), flags);
}

// Each apply*Flags function maps resource flags onto a body. Single-record commands apply them on top of
// --data; batch commands apply them to every record.
export function applyPersonFlags(body, flags) {
  applyFieldFlags(body, flags);
  copyStringFlags(body, flags, {
    'first-name': 'firstName',
    'last-name': 'lastName',
    'full-name': 'fullName',
    description: 'description',
    birthday: 'birthday',
    'job-title': 'jobTitle',
    gender: 'gender',
  });
  copyArrayFlags(body, flags, { email: 'emails', phone: 'phones', address: 'addresses', url: 'urls' });
  addGroups(body, flags);
  addCompanies(body, flags);
  addGroupedCustomFields(body, flags);
  return body;
}

export async function buildPersonBody(flags, stdin) {
  return applyPersonFlags(await readDataObject(flags, stdin), flags);
}

export function applyCompanyFlags(body, flags) {
  if (flagString(flags, 'foundation-date') !== undefined) {
    throw new CliError('--foundation-date is not a Folk company field. Use --foundation-year YYYY, or --last-funding-date YYYY-MM-DD for funding.', { exitCode: 2 });
  }
  applyFieldFlags(body, flags);
  copyStringFlags(body, flags, {
    name: 'name',
    description: 'description',
    industry: 'industry',
    'employee-range': 'employeeRange',
    'foundation-year': 'foundationYear',
    'funding-raised': 'fundingRaised',
    'last-funding-date': 'lastFundingDate',
  });
  copyArrayFlags(body, flags, { email: 'emails', phone: 'phones', address: 'addresses', url: 'urls' });
  addGroups(body, flags);
  addGroupedCustomFields(body, flags);
  return body;
}

export async function buildCompanyBody(flags, stdin) {
  return applyCompanyFlags(await readDataObject(flags, stdin), flags);
}

export function applyDealFlags(body, flags) {
  applyFieldFlags(body, flags);
  copyStringFlags(body, flags, { name: 'name' });
  const companyIds = flagValues(flags, 'company-id');
  const personIds = flagValues(flags, 'person-id');
  if (companyIds.length) body.companies = [...(body.companies || []), ...companyIds.map((id) => ({ id }))];
  if (personIds.length) body.people = [...(body.people || []), ...personIds.map((id) => ({ id }))];
  addFlatCustomFields(body, flags);
  return body;
}

export async function buildDealBody(flags, stdin) {
  return applyDealFlags(await readDataObject(flags, stdin), flags);
}

export async function buildNoteBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, { content: 'content', visibility: 'visibility' });
  const entityId = flagString(flags, 'entity-id');
  const parentNoteId = flagString(flags, 'parent-note-id');
  if (entityId) body.entity = { ...(body.entity || {}), id: entityId };
  if (parentNoteId) body.parentNote = { ...(body.parentNote || {}), id: parentNoteId };
  return body;
}

export async function buildReminderBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, {
    name: 'name',
    'recurrence-rule': 'recurrenceRule',
    visibility: 'visibility',
  });
  if (typeof body.recurrenceRule === 'string') body.recurrenceRule = body.recurrenceRule.replace(/\\n/g, '\n');
  const entityId = flagString(flags, 'entity-id');
  if (entityId) body.entity = { ...(body.entity || {}), id: entityId };
  addAssignedUsers(body, flags);
  return body;
}

export async function buildTaskBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, {
    title: 'title',
    description: 'description',
    'due-at': 'dueAt',
    'due-time': 'dueTime',
    'recurrence-frequency': 'recurrenceFrequency',
    'completed-at': 'completedAt',
  });
  for (const field of ['dueTime', 'recurrenceFrequency']) {
    if (body[field] === 'null') body[field] = null;
  }
  const entityId = flagString(flags, 'entity-id');
  if (entityId) body.entity = { ...(body.entity || {}), id: entityId };
  const visibility = flagString(flags, 'visibility');
  if (visibility !== undefined) {
    if (!['public', 'private'].includes(visibility)) throw new CliError('Task --visibility must be public or private.', { exitCode: 2 });
    body.isPublic = visibility === 'public';
  }
  const isPublic = flagBooleanStrict(flags, 'is-public');
  if (isPublic !== undefined) body.isPublic = isPublic;
  addAssignedUsers(body, flags);
  return body;
}

export async function buildGroupBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, { name: 'name', visibility: 'visibility' });
  return body;
}

export async function buildGroupFieldBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, { name: 'name', type: 'type' });
  return body;
}

export async function buildWebhookBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, { name: 'name', 'target-url': 'targetUrl', url: 'targetUrl', status: 'status' });
  const subscribedEvents = [];
  for (const raw of flagValues(flags, 'event').concat(flagValues(flags, 'subscribed-event'))) {
    const [eventType, groupId] = String(raw).split(':');
    if (!eventType) throw new CliError(`Invalid --event ${JSON.stringify(raw)}. Expected eventType or eventType:groupId.`, { exitCode: 2 });
    subscribedEvents.push({ eventType, ...(groupId ? { filter: { groupId } } : {}) });
  }
  if (subscribedEvents.length) body.subscribedEvents = [...(Array.isArray(body.subscribedEvents) ? body.subscribedEvents : []), ...subscribedEvents];
  return body;
}

export async function buildInteractionBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  // The legacy type flag remains usable, including on the new PATCH endpoint.
  copyStringFlags(body, flags, {
    title: 'title',
    type: 'activityType',
    'activity-type': 'activityType',
    content: 'content',
    'date-time': 'dateTime',
    datetime: 'dateTime',
    'occurred-at': 'dateTime',
  });
  const entityId = flagString(flags, 'entity-id');
  if (entityId) body.entity = { ...(body.entity || {}), id: entityId };
  return body;
}

// Enrichment bodies are {fields, ids}. IDs come from --data ids, --id, and positional arguments.
export async function buildEnrichmentBody(flags, stdin, ids = []) {
  const body = await buildGenericBody(flags, stdin);
  const fields = splitList(flagValues(flags, 'fields')).map(normalizeEnrichmentField);
  if (fields.length) body.fields = [...(Array.isArray(body.fields) ? body.fields : []), ...fields];
  if (Array.isArray(body.fields)) body.fields = [...new Set(body.fields)];
  const allIds = [...(Array.isArray(body.ids) ? body.ids : []).map(String), ...splitList(flagValues(flags, 'id')), ...splitList(ids)];
  // Folk enriches duplicate IDs once; removing them here keeps them from counting toward the limit.
  if (allIds.length) body.ids = [...new Set(allIds)];
  if (!Array.isArray(body.fields) || !body.fields.length) {
    throw new CliError('Enrichment requires --fields emails, phones, or emails,phones.', { exitCode: 2 });
  }
  if (!Array.isArray(body.ids) || !body.ids.length) {
    throw new CliError('Enrichment requires at least one person ID, as arguments, --id, or ids in --data.', { exitCode: 2 });
  }
  if (body.ids.length > ENRICHMENT_MAX_PEOPLE) {
    throw new CliError(`An enrichment accepts at most ${ENRICHMENT_MAX_PEOPLE} people; got ${body.ids.length}. Split the IDs into several enrichments.`, { exitCode: 2 });
  }
  return body;
}

function normalizeEnrichmentField(field) {
  const value = String(field).toLowerCase();
  if (value === 'email') return 'emails';
  if (value === 'phone') return 'phones';
  return value;
}

// Batch input: a JSON array of records, an object with a records array, a single record object, or NDJSON
// (one record per line, as printed by --ndjson). Delete batches also accept a JSON array of ID strings.
export async function readBatchRecords(flags, stdin) {
  const source = dataSource(flags);
  if (!source) return { records: [], shape: 'none' };
  const text = await readInputText(source, stdin);
  if (!String(text).trim()) return { records: [], shape: 'empty' };
  const parsed = parseJsonOrNdjson(text);
  if (Array.isArray(parsed.value)) return { records: parsed.value, shape: parsed.ndjson ? 'ndjson' : 'array' };
  if (isPlainObject(parsed.value) && Array.isArray(parsed.value.records)) return { records: parsed.value.records, shape: 'records' };
  if (isPlainObject(parsed.value)) return { records: [parsed.value], shape: 'object' };
  throw new CliError('--data must be a JSON array of records, an object with a records array, or NDJSON.', { exitCode: 2 });
}

function parseJsonOrNdjson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1) {
      try {
        return { value: lines.map((line) => JSON.parse(line)), ndjson: true };
      } catch {
        // Report the original JSON error below.
      }
    }
    throw new CliError(`Invalid JSON or NDJSON supplied to --data: ${error.message}`, { exitCode: 2, cause: error });
  }
}

export function validateBatchRecords(records, { label, requireId }) {
  if (!records.length) throw new CliError(`${label} needs at least one record. Pass records with --data${requireId ? ' or record IDs as arguments' : ''}.`, { exitCode: 2 });
  if (records.length > BATCH_MAX_RECORDS) {
    throw new CliError(`A batch accepts at most ${BATCH_MAX_RECORDS} records; got ${records.length}. Split the input into several commands, for example with split -l ${BATCH_MAX_RECORDS} on NDJSON.`, { exitCode: 2 });
  }
  records.forEach((record, index) => {
    if (!isPlainObject(record)) throw new CliError(`records[${index}] must be a JSON object.`, { exitCode: 2 });
    if (requireId && (typeof record.id !== 'string' || !record.id)) throw new CliError(`records[${index}] needs a string id for ${label}.`, { exitCode: 2 });
  });
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addAssignedUsers(body, flags) {
  const assignedUsers = [];
  for (const id of flagValues(flags, 'assigned-user-id').concat(flagValues(flags, 'assignee-id'))) assignedUsers.push({ id: String(id) });
  for (const email of flagValues(flags, 'assigned-user-email').concat(flagValues(flags, 'assignee-email'))) assignedUsers.push({ email: String(email) });
  if (assignedUsers.length) body.assignedUsers = [...(Array.isArray(body.assignedUsers) ? body.assignedUsers : []), ...assignedUsers];
}

function copyStringFlags(body, flags, mapping) {
  for (const [flag, field] of Object.entries(mapping)) {
    const value = flagString(flags, flag);
    if (value !== undefined) body[field] = value;
  }
}

function copyArrayFlags(body, flags, mapping) {
  for (const [flag, field] of Object.entries(mapping)) {
    const values = flagValues(flags, flag).map(String);
    if (values.length) body[field] = [...(Array.isArray(body[field]) ? body[field] : []), ...values];
  }
}

function addGroups(body, flags) {
  const groups = flagValues(flags, 'group').concat(flagValues(flags, 'group-id')).map((id) => ({ id: String(id) }));
  if (groups.length) body.groups = [...(Array.isArray(body.groups) ? body.groups : []), ...groups];
}

function addCompanies(body, flags) {
  const companies = [];
  for (const id of flagValues(flags, 'company-id')) companies.push({ id: String(id) });
  for (const name of flagValues(flags, 'company-name')) companies.push({ name: String(name) });
  if (companies.length) body.companies = [...(Array.isArray(body.companies) ? body.companies : []), ...companies];
}

function addGroupedCustomFields(body, flags) {
  const entries = flagValues(flags, 'custom').concat(flagValues(flags, 'custom-field'));
  if (!entries.length) return;
  body.customFieldValues = body.customFieldValues && typeof body.customFieldValues === 'object' ? body.customFieldValues : {};
  for (const raw of entries) {
    const [left, value] = parseAssignment(raw, { label: '--custom' });
    const dot = left.indexOf('.');
    if (dot === -1) throw new CliError(`Invalid --custom ${JSON.stringify(raw)}. Expected groupId.Field Name=value.`, { exitCode: 2 });
    const groupId = left.slice(0, dot);
    const fieldName = left.slice(dot + 1);
    if (!groupId || !fieldName) throw new CliError(`Invalid --custom ${JSON.stringify(raw)}. Expected groupId.Field Name=value.`, { exitCode: 2 });
    assertSafeKey(groupId, '--custom');
    assertSafeKey(fieldName, '--custom');
    body.customFieldValues[groupId] = body.customFieldValues[groupId] || {};
    body.customFieldValues[groupId][fieldName] = value;
  }
}

function addFlatCustomFields(body, flags) {
  const entries = flagValues(flags, 'custom').concat(flagValues(flags, 'custom-field'));
  if (!entries.length) return;
  body.customFieldValues = body.customFieldValues && typeof body.customFieldValues === 'object' ? body.customFieldValues : {};
  for (const raw of entries) {
    const [fieldName, value] = parseAssignment(raw, { label: '--custom' });
    assertSafeKey(fieldName, '--custom');
    body.customFieldValues[fieldName] = value;
  }
}
