import fs from 'node:fs/promises';
import { CliError } from './errors.js';
import { flagString, flagValues, flagBooleanStrict } from './args.js';
import { parseAssignment, setDeep } from './util.js';

export async function readStdinText(stdin) {
  if (!stdin) return '';
  let data = '';
  stdin.setEncoding?.('utf8');
  for await (const chunk of stdin) data += chunk;
  return data;
}

export async function readJsonInput(source, stdin) {
  if (!source) return undefined;
  let text;
  if (source === '-') {
    text = await readStdinText(stdin);
  } else if (source.startsWith('@')) {
    text = await fs.readFile(source.slice(1), 'utf8');
  } else {
    text = source;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`Invalid JSON supplied to --data: ${error.message}`, { exitCode: 2, cause: error });
  }
}

export async function buildGenericBody(flags, stdin) {
  let body = {};
  const dataFlag = flagString(flags, 'data') || flagString(flags, 'body') || flagString(flags, 'file');
  if (dataFlag) {
    body = await readJsonInput(dataFlag.startsWith('@') || dataFlag === '-' ? dataFlag : dataFlag, stdin);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new CliError('--data must be a JSON object for this command.', { exitCode: 2 });
    }
  }
  for (const raw of flagValues(flags, 'field')) {
    const [key, value] = parseAssignment(raw, { label: '--field' });
    setDeep(body, key, value);
  }
  return body;
}

export async function buildPersonBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
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

export async function buildCompanyBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, {
    name: 'name',
    description: 'description',
    industry: 'industry',
    'employee-range': 'employeeRange',
    'foundation-date': 'foundationDate',
    'foundation-year': 'foundationYear',
    'funding-raised': 'fundingRaised',
    'last-funding-date': 'lastFundingDate',
  });
  copyArrayFlags(body, flags, { email: 'emails', phone: 'phones', address: 'addresses', url: 'urls' });
  addGroups(body, flags);
  addGroupedCustomFields(body, flags);
  return body;
}

export async function buildDealBody(flags, stdin) {
  const body = await buildGenericBody(flags, stdin);
  copyStringFlags(body, flags, { name: 'name' });
  const companyIds = flagValues(flags, 'company-id');
  const personIds = flagValues(flags, 'person-id');
  if (companyIds.length) body.companies = [...(body.companies || []), ...companyIds.map((id) => ({ id }))];
  if (personIds.length) body.people = [...(body.people || []), ...personIds.map((id) => ({ id }))];
  addFlatCustomFields(body, flags);
  return body;
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
    body.customFieldValues[fieldName] = value;
  }
}
