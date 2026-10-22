import fs from 'node:fs/promises';
import { parseFlagArgs, flagBoolean, flagString, flagValues, hasFlag } from './args.js';
import {
  applyCompanyFlags, applyDealFlags, applyPersonFlags,
  buildCompanyBody, buildDealBody, buildEnrichmentBody, buildGenericBody, buildGroupBody, buildGroupFieldBody,
  buildInteractionBody, buildNoteBody, buildPersonBody, buildReminderBody, buildTaskBody, buildWebhookBody,
  isPlainObject, readBatchRecords, readStdinText, validateBatchRecords,
} from './body.js';
import { getEffectiveConfig, writeConfig, removeConfigToken } from './config.js';
import { ENDPOINTS, findEndpoint, fillPath, listEndpoints } from './endpoints.js';
import { CliError, errorToExitCode, formatError } from './errors.js';
import { buildUrl, defaultSleep, delayForPolicies, requestFolk } from './http.js';
import { buildQuery, queryForSearch } from './query.js';
import { authHelp, apiHelp, creditsHelp, dealsHelp, enrichmentsHelp, groupsHelp, interactionsHelp, mcpHelp, resourceHelp, topHelp, usersHelp, VERSION } from './help.js';
import { mcpConfig, MCP_INFO } from './mcp.js';
import { writeOutput } from './output.js';
import { redact, splitList } from './util.js';

// Folk accepted the request, but some batch records, or a waited enrichment, did not succeed.
export const PARTIAL_FAILURE_EXIT_CODE = 5;

const BODY_BUILDERS = {
  people: buildPersonBody,
  companies: buildCompanyBody,
  deals: buildDealBody,
  notes: buildNoteBody,
  reminders: buildReminderBody,
  tasks: buildTaskBody,
  webhooks: buildWebhookBody,
  interactions: buildInteractionBody,
};

const SIMPLE_RESOURCES = new Map([
  ['people', { idParam: 'personId' }],
  ['companies', { idParam: 'companyId' }],
  ['notes', { idParam: 'noteId' }],
  ['reminders', { idParam: 'reminderId' }],
  ['tasks', { idParam: 'taskId' }],
  ['webhooks', { idParam: 'webhookId' }],
]);

// On people and companies, an update's groups replaces the record's groups and deletes the custom field
// values of every group left out.
// List fields also replace the existing values on update rather than adding to them.
const BATCH_RESOURCES = new Map([
  ['people', { applyFlags: applyPersonFlags, nouns: ['person', 'people'], groupsReplace: true, listFields: ['emails', 'phones', 'urls', 'addresses', 'companies'] }],
  ['companies', { applyFlags: applyCompanyFlags, nouns: ['company', 'companies'], groupsReplace: true, listFields: ['emails', 'phones', 'urls', 'addresses'] }],
]);
const OBJECT_LIST_FIELDS = ['people', 'companies'];

const TASK_COMPLETION_ACTIONS = new Map([
  ['done', 'done'], ['mark-done', 'done'], ['mark-as-done', 'done'],
  ['todo', 'todo'], ['mark-todo', 'todo'], ['mark-as-todo', 'todo'],
]);

const ENRICHMENT_COLUMNS = ['id', 'status', 'fields', 'createdAt', 'finishedAt', 'errorReason'];
const ENRICHMENT_ITEM_COLUMNS = ['id', 'status', 'enrichedFields', 'missingInputs'];
const CREDIT_COLUMNS = ['feature', 'scope', 'used', 'limit', 'periodStart', 'periodEnd'];
const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const DEFAULT_WAIT_INTERVAL_SECONDS = 5;

export async function main({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, fetchImpl = globalThis.fetch, sleep = defaultSleep } = {}) {
  let flags = {};
  try {
    const parsed = parseFlagArgs(argv);
    flags = parsed.flags;
    const { positionals } = parsed;
    if (flagBoolean(flags, 'version')) {
      stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (positionals.length === 0 || positionals[0] === 'help') {
      stdout.write(topHelp());
      return 0;
    }

    const command = positionals[0];
    if (flagBoolean(flags, 'help')) {
      stdout.write(helpFor(command));
      return 0;
    }

    const context = { command, flags, positionals, env, cwd, stdin, stdout, stderr, fetchImpl, sleep, warnings: new Set() };
    if (command === 'auth') return await handleAuth(context);
    if (command === 'api' || command === 'docs') return await handleApi(context);
    if (command === 'mcp') return handleMcp(context);
    if (command === 'groups') return await withConfig(context, handleGroups);
    if (command === 'users') return await withConfig(context, handleUsers);
    if (command === 'deals' || command === 'objects') return await withConfig(context, handleObjects);
    if (command === 'interactions') return await withConfig(context, handleInteractions);
    if (command === 'enrichments' || command === 'person-enrichments') return await withConfig(context, handleEnrichments);
    if (command === 'credits') return await withConfig(context, handleCredits);
    if (SIMPLE_RESOURCES.has(command)) return await withConfig(context, handleSimpleResource);

    throw new CliError(`Unknown command: ${command}\n\n${topHelp()}`, { exitCode: 2 });
  } catch (error) {
    stderr.write(`${formatError(error, { verbose: flagBoolean(flags, 'verbose') })}\n`);
    return errorToExitCode(error);
  }
}

async function withConfig(context, handler) {
  context.config = await getEffectiveConfig({ flags: context.flags, env: context.env, cwd: context.cwd });
  return handler(context);
}

function helpFor(command) {
  if (command === 'api' || command === 'docs') return apiHelp();
  if (command === 'auth') return authHelp();
  if (command === 'deals' || command === 'objects') return dealsHelp(command);
  if (command === 'groups') return groupsHelp();
  if (command === 'mcp') return mcpHelp();
  if (command === 'users') return usersHelp();
  if (command === 'interactions') return interactionsHelp();
  if (command === 'enrichments' || command === 'person-enrichments') return enrichmentsHelp();
  if (command === 'credits') return creditsHelp();
  if (SIMPLE_RESOURCES.has(command)) return resourceHelp(command);
  return topHelp();
}

async function handleAuth(context) {
  const action = context.positionals[1] || 'status';
  if (action === 'help') {
    context.stdout.write(authHelp());
    return 0;
  }
  if (action === 'status') {
    const config = await getEffectiveConfig({ flags: context.flags, env: context.env, cwd: context.cwd });
    const status = {
      authenticated: Boolean(config.apiKey),
      tokenSource: config.apiKeySource,
      token: config.apiKey ? redact(config.apiKey) : undefined,
      baseUrl: config.baseUrl,
      apiVersion: config.apiVersion,
      configPath: config.configPath,
    };
    if (flagBoolean(context.flags, 'check') && config.apiKey) {
      context.config = config;
      const result = await requestEndpoint(context, 'users.me');
      status.check = result.response?.status === 200 ? 'ok' : 'unknown';
      status.user = result.data?.data;
    }
    writeOutput({ data: status }, context);
    return 0;
  }
  if (action === 'login') {
    const config = await getEffectiveConfig({ flags: context.flags, env: context.env, cwd: context.cwd });
    let token;
    if (flagBoolean(context.flags, 'token-stdin')) {
      token = (await readStdinText(context.stdin)).trim();
    } else {
      throw new CliError('auth login requires --token-stdin so the API key is not echoed by an interactive prompt.', { exitCode: 2 });
    }
    if (!token) throw new CliError('No API key provided.', { exitCode: 2 });
    await writeConfig(config.configPath, {
      ...config.fileConfig,
      apiKey: token,
      baseUrl: flagString(context.flags, 'base-url') || config.fileConfig.baseUrl,
      apiVersion: flagString(context.flags, 'api-version') || config.fileConfig.apiVersion,
    });
    context.stdout.write(`Saved folk API key to ${config.configPath}\n`);
    return 0;
  }
  if (action === 'logout') {
    const configPath = flagString(context.flags, 'config') || (await getEffectiveConfig({ flags: context.flags, env: context.env, cwd: context.cwd })).configPath;
    await removeConfigToken(configPath);
    context.stdout.write(`Removed folk API key from ${configPath}\n`);
    return 0;
  }
  throw new CliError(`Unknown auth action: ${action}\n\n${authHelp()}`, { exitCode: 2 });
}

async function handleApi(context) {
  const action = context.command === 'docs' ? 'docs' : (context.positionals[1] || 'ls');
  const offset = context.command === 'docs' ? 1 : 2;
  if (action === 'help') {
    context.stdout.write(apiHelp());
    return 0;
  }
  if (action === 'ls' || action === 'list') {
    const resource = context.positionals[offset];
    const endpoints = listEndpoints({ resource }).map(({ key, method, path, summary, docsUrl, deprecated, beta, batch }) => ({
      key, method, path, summary, docsUrl,
      ...(deprecated ? { deprecated: true } : {}),
      ...(beta ? { beta: true } : {}),
      ...(batch ? { batch: true } : {}),
    }));
    writeOutput({ data: { items: endpoints } }, context);
    return 0;
  }
  if (action === 'docs') {
    const key = context.positionals[offset];
    if (!key) throw new CliError('api docs requires an endpoint key, e.g. people.create', { exitCode: 2 });
    const endpoint = requireEndpoint(key);
    const lines = [endpoint.key, `${endpoint.method} ${endpoint.path}`, endpoint.summary, `Docs: ${endpoint.docsUrl}`, `Paginated: ${endpoint.paginated ? 'yes' : 'no'}`];
    if (endpoint.filters) lines.push('Filters: yes');
    if (endpoint.batch) lines.push(`Batch: up to ${endpoint.maxRecords} records; each record succeeds or fails on its own.`);
    if (endpoint.async) lines.push('Asynchronous: answers 202 with a pending resource. Poll it, or pass --wait.');
    if (endpoint.consumesCredits) lines.push('Uses workspace credits. Check them with: folkctl credits');
    if (endpoint.beta) lines.push('Open beta: API surface may change.');
    if (endpoint.deprecation) lines.push(`Deprecated: ${endpoint.deprecation}`);
    if (endpoint.requiredQuery) lines.push(`Required query: ${endpoint.requiredQuery.join(', ')}`);
    context.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }
  if (action === 'spec') {
    const key = context.positionals[offset];
    if (!key) throw new CliError('api spec requires an endpoint key, e.g. people.create', { exitCode: 2 });
    writeOutput({ data: requireEndpoint(key) }, { ...context, flags: { ...context.flags, json: true, pretty: true } });
    return 0;
  }
  if (action === 'request') {
    context.config = await getEffectiveConfig({ flags: context.flags, env: context.env, cwd: context.cwd });
    const method = context.positionals[offset];
    const path = context.positionals[offset + 1];
    if (!method || !path) throw new CliError('api request requires METHOD and PATH.', { exitCode: 2 });
    const normalizedMethod = method.toUpperCase();
    const body = ['POST', 'PUT', 'PATCH'].includes(normalizedMethod) || flagString(context.flags, 'data') ? await buildGenericBody(context.flags, context.stdin) : undefined;
    await guardRawRequest(context, normalizedMethod, path, body);
    const result = await requestFolk({ method: normalizedMethod, path, query: buildQuery(context.flags), body, config: context.config, flags: context.flags, fetchImpl: context.fetchImpl, paginate: flagBoolean(context.flags, 'all'), sleep: context.sleep });
    warnDeprecations(context, result);
    writeOutput(result, context);
    return 0;
  }
  throw new CliError(`Unknown api action: ${action}\n\n${apiHelp()}`, { exitCode: 2 });
}

// api request applies the same confirmations as the wrapper commands. It matches the request's normalized
// path against the endpoint catalog, so variants such as v1/x, /v1/./x, /v1/%2e/x, or /V1/X/ are caught too.
async function guardRawRequest(context, method, path, body) {
  const pathnames = routePathnames(context.config.baseUrl, path);
  const endpoints = ENDPOINTS.filter((endpoint) => endpoint.method === method && pathnames.some((pathname) => templatePattern(endpoint.path).test(pathname)));
  const keys = new Set(endpoints.map((endpoint) => endpoint.key));
  const label = `${method} ${path}`;
  // Also guard batch deletes that this release does not know about yet.
  const batchDelete = method === 'POST' && pathnames.some((pathname) => /\/batch\/delete$/i.test(pathname));
  if (method === 'DELETE' || endpoints.some((endpoint) => endpoint.destructive) || batchDelete) {
    await confirmDestructive(context, label, path);
  }
  if (endpoints.some((endpoint) => endpoint.consumesCredits)) {
    await confirmAction(context, {
      prompt: `Send ${label}? It uses workspace enrichment credits.`,
      expected: path,
      refusal: `Refusing to spend enrichment credits with ${label} without confirmation.`,
    });
  }
  if (keys.has('people.batch.update') || keys.has('companies.batch.update')) {
    const records = Array.isArray(body?.records) ? body.records : [];
    const replacing = records.filter((record) => isPlainObject(record) && record.groups !== undefined).length;
    if (replacing) {
      await confirmAction(context, {
        prompt: `${replacing} of ${records.length} records set groups, which replaces their groups: each group left out is removed, with the record's custom field values in it. Continue?`,
        expected: replacing,
        refusal: `Refusing to replace the groups of ${replacing} records with ${label} without confirmation.`,
      });
    }
  }
  if (keys.has('groups.fields.update') && Array.isArray(body?.removeOptions) && body.removeOptions.length) {
    await confirmDestructive(context, `options and their associated data with ${label}`, path);
  }
  if ((keys.has('people.update') || keys.has('companies.update')) && body?.groups !== undefined) {
    warn(context, 'groups replaces the groups of this record: each group left out is removed, with its custom field values in that group.');
  }
}

// The URL parser resolves . and .. segments (including %2e) and drops fragments. Both the encoded and the
// decoded forms are matched: decoding catches encoded route words, and the encoded form keeps a %2F inside
// a name such as "Projects / Deals" from splitting a path segment.
function routePathnames(baseUrl, path) {
  let pathname;
  try {
    pathname = buildUrl(baseUrl, path).pathname;
  } catch {
    return [String(path)];
  }
  const variants = [pathname];
  try {
    variants.push(decodeURIComponent(pathname));
  } catch {
    // Malformed percent-encoding: match the encoded form only.
  }
  return [...new Set(variants.map((variant) => variant.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')))];
}

function templatePattern(template) {
  const source = template.split('/').map((segment) => (/^\{[^}]+\}$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/');
  return new RegExp(`^${source}$`, 'i');
}

async function handleSimpleResource(context) {
  const resource = context.positionals[0];
  const action = context.positionals[1] || 'list';
  const args = context.positionals.slice(2);
  const { idParam } = SIMPLE_RESOURCES.get(resource);
  const bodyBuilder = BODY_BUILDERS[resource] || buildGenericBody;
  if (action === 'help') {
    context.stdout.write(resourceHelp(resource));
    return 0;
  }
  if (action === 'batch') {
    const batch = BATCH_RESOURCES.get(resource);
    if (!batch) throw new CliError(`${resource} has no batch endpoints. Batch commands exist for people, companies, deals, and objects.`, { exitCode: 2 });
    return handleBatch(context, { resource, operation: args[0], ids: args.slice(1), params: {}, ...batch });
  }
  if (action === 'enrich') {
    if (resource !== 'people') throw new CliError('Only people can be enriched. Use folkctl people enrich <personId>... --fields emails,phones.', { exitCode: 2 });
    return handleEnrichmentCreate(context, args);
  }
  if (action === 'list') {
    const result = await requestEndpoint(context, `${resource}.list`, { query: buildQuery(context.flags, { resource }) });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'search') {
    if (!['people', 'companies', 'notes'].includes(resource)) throw new CliError(`${resource} does not support text search. Use ${resource} list with documented filters.`, { exitCode: 2 });
    const query = queryForSearch(resource, args);
    mergeQuery(query, buildQuery(context.flags, { resource }));
    const result = await requestEndpoint(context, `${resource}.list`, { query });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'get') {
    const id = args[0] || flagString(context.flags, 'id');
    requireValue(id, `${resource} get requires an id.`);
    const result = await requestEndpoint(context, `${resource}.get`, { params: { [idParam]: id } });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'create') {
    const body = await bodyBuilder(context.flags, context.stdin);
    const result = await requestEndpoint(context, `${resource}.create`, { body });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'update') {
    const id = args[0] || flagString(context.flags, 'id');
    requireValue(id, `${resource} update requires an id.`);
    const body = await bodyBuilder(context.flags, context.stdin);
    if (resource === 'tasks' && body.completedAt !== undefined) throw new CliError('Use tasks done --completed-at or tasks todo to change completion; tasks update does not accept completedAt.', { exitCode: 2 });
    if (BATCH_RESOURCES.get(resource)?.groupsReplace && body.groups !== undefined) {
      warn(context, `groups replaces the groups of this ${resource === 'people' ? 'person' : 'company'}: each group left out is removed, with its custom field values in that group.`);
    }
    const result = await requestEndpoint(context, `${resource}.update`, { params: { [idParam]: id }, body });
    writeOutput(result, context);
    return 0;
  }
  const completionAction = TASK_COMPLETION_ACTIONS.get(action);
  if (resource === 'tasks' && completionAction) {
    const taskId = args[0] || flagString(context.flags, 'id') || flagString(context.flags, 'task-id');
    requireValue(taskId, `tasks ${action} requires a task id.`);
    let body;
    if (completionAction === 'done') {
      body = await buildGenericBody(context.flags, context.stdin);
      const completedAt = flagString(context.flags, 'completed-at');
      if (completedAt !== undefined) body.completedAt = completedAt;
      requireValue(body.completedAt, 'tasks done requires --completed-at <ISO timestamp> or completedAt in --data.');
    }
    const result = await requestEndpoint(context, `tasks.${completionAction}`, { params: { taskId }, body });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'delete' || action === 'rm') {
    const id = args[0] || flagString(context.flags, 'id');
    requireValue(id, `${resource} delete requires an id.`);
    await confirmDestructive(context, `${resource} ${id}`, id);
    const result = await requestEndpoint(context, `${resource}.delete`, { params: { [idParam]: id } });
    writeOutput(result, context);
    return 0;
  }
  throw new CliError(`Unknown ${resource} action: ${action}\n\n${resourceHelp(resource)}`, { exitCode: 2 });
}

// Batch commands send up to 100 records in one request. Folk applies each record on its own and returns
// one result per record, in request order.
async function handleBatch(context, { resource, operation, ids: positionalIds, params, applyFlags, nouns, groupsReplace, listFields }) {
  const count = (n) => `${n} ${n === 1 ? nouns[0] : nouns[1]}`;
  if (operation === 'rm') operation = 'delete';
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new CliError(`Unknown ${resource} batch action: ${operation ?? '(none)'}. Use batch create, batch update, or batch delete.`, { exitCode: 2 });
  }
  const label = `${resource} batch ${operation}`;
  const ids = splitList([...positionalIds, ...flagValues(context.flags, 'id')]);
  const input = await readBatchRecords(context.flags, context.stdin);
  let records;
  if (operation === 'delete') {
    // Only the ID matters for a delete, so full records piped from --ndjson output work as input.
    const fromData = input.records.map((record) => {
      if (typeof record === 'string') return { id: record };
      return isPlainObject(record) && typeof record.id === 'string' ? { id: record.id } : record;
    });
    records = [...fromData, ...ids.map((id) => ({ id }))];
  } else if (operation === 'update' && ids.length) {
    if (!['none', 'empty', 'object'].includes(input.shape)) {
      throw new CliError(`${label}: pass record IDs as arguments or records with --data, not both. With IDs, --data must be one JSON object of fields to apply to each ID.`, { exitCode: 2 });
    }
    const { id: _ignored, ...template } = input.records[0] || {};
    records = ids.map((id) => applyFlags({ id, ...structuredClone(template) }, context.flags));
    if (records.every((record) => Object.keys(record).length === 1)) {
      throw new CliError(`${label} with IDs needs at least one field to change, from resource flags, --field, or a --data object.`, { exitCode: 2 });
    }
  } else {
    if (ids.length) throw new CliError(`${label} reads records from --data. Record IDs as arguments work with batch update and batch delete.`, { exitCode: 2 });
    records = input.records.map((record) => (isPlainObject(record) ? applyFlags(record, context.flags) : record));
  }
  validateBatchRecords(records, { label, requireId: operation !== 'create' });

  if (operation === 'delete') {
    await confirmAction(context, {
      prompt: `Delete ${count(records.length)}?`,
      expected: records.length,
      refusal: `Refusing to delete ${count(records.length)} without confirmation.`,
      cancelled: 'Delete cancelled.',
    });
  }
  if (operation === 'update') {
    const replaced = listFields.filter((field) => records.some((record) => record[field] !== undefined));
    if (replaced.length) {
      warn(context, `On update, ${replaced.join(', ')} ${replaced.length === 1 ? 'replaces' : 'replace'} each record's existing values. Send the full list for every record.`);
    }
  }
  if (operation === 'update' && groupsReplace) {
    const replacing = records.filter((record) => record.groups !== undefined).length;
    if (replacing) {
      await confirmAction(context, {
        prompt: `${replacing} of ${records.length} records set groups, which replaces their groups: each group left out is removed, with the record's custom field values in it. Continue?`,
        expected: replacing,
        refusal: `Refusing to replace the groups of ${count(replacing)} without confirmation.`,
      });
    }
  }

  const result = await requestEndpoint(context, `${resource}.batch.${operation}`, { params, body: { records } });
  return writeBatchResult(context, result, label);
}

function writeBatchResult(context, result, label) {
  if (result.dryRun) {
    writeOutput(result, context);
    return 0;
  }
  const results = result.data?.data?.results;
  if (!Array.isArray(results)) {
    // The batch may have been applied, so keep the key that lets a re-run replay instead of repeat it.
    throw new CliError(`Unexpected ${label} response: data.results is missing, so each record's outcome is unknown. Check the records before re-running, and re-run with the same --idempotency-key. Use --verbose to see the response.`, {
      idempotencyKey: result.request?.headers?.['Idempotency-Key'],
      details: result.data,
    });
  }
  const succeeded = results.filter((entry) => entry?.status === 'succeeded').length;
  const failed = results.length - succeeded;
  const withWarnings = results.filter((entry) => Array.isArray(entry?.warnings) && entry.warnings.length).length;
  result.batch = { records: results.length, succeeded, failed, withWarnings };
  writeOutput(result, context);
  if (!flagBoolean(context.flags, 'quiet')) {
    context.stderr.write(`${label}: ${results.length} records, ${succeeded} succeeded, ${failed} failed${withWarnings ? `, ${withWarnings} with warnings` : ''}.\n`);
  }
  return failed ? PARTIAL_FAILURE_EXIT_CODE : 0;
}

async function handleGroups(context) {
  const action = context.positionals[1] || 'list';
  const args = context.positionals.slice(2);
  if (action === 'help') {
    context.stdout.write(helpFor('groups'));
    return 0;
  }
  if (action === 'list') {
    const visibility = flagString(context.flags, 'visibility');
    if (visibility !== undefined && !['public', 'private'].includes(visibility)) throw new CliError('Group --visibility must be public or private.', { exitCode: 2 });
    const result = await requestEndpoint(context, 'groups.list', { query: buildQuery(context.flags, { resource: 'groups' }) });
    if (visibility !== undefined) {
      result.clientFilter = { visibility, scope: 'retrieved pages; use --all for every page' };
      if (!result.dryRun) {
        const data = result.data?.data;
        if (!Array.isArray(data?.items)) throw new CliError('Cannot filter group visibility: unexpected group list response.');
        data.items = data.items.filter(group => group.visibility === visibility);
        if (data.itemCount !== undefined) data.itemCount = data.items.length;
      }
    }
    writeOutput(result, context);
    return 0;
  }
  if (action === 'create' || action === 'update') {
    const groupId = flagString(context.flags, 'group-id') || args[0];
    if (action === 'update') requireValue(groupId, 'groups update requires a group id.');
    const body = await buildGroupBody(context.flags, context.stdin);
    const result = await requestEndpoint(context, `groups.${action}`, { params: { groupId }, body });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'fields' || action === 'custom-fields') {
    return handleGroupFields(context, args);
  }
  if (action === 'members') return handleGroupMembers(context, args);
  throw new CliError(`Unknown groups action: ${action}\n\n${helpFor('groups')}`, { exitCode: 2 });
}

async function handleGroupFields(context, args) {
  // Preserve 0.1.x: groups fields <groupId> <entityType>.
  const action = ['list', 'get', 'create', 'update'].includes(args[0]) ? args.shift() : 'list';
  const groupId = flagString(context.flags, 'group-id') || args.shift();
  const entityType = flagString(context.flags, 'entity-type') || args.shift();
  requireValue(groupId, 'groups fields requires a group id.');
  requireValue(entityType, 'groups fields requires entityType: person, company, or custom object name.');
  const params = { groupId, entityType };
  if (action === 'get' || action === 'update') {
    params.customFieldName = flagString(context.flags, 'custom-field-name') || args.shift();
    requireValue(params.customFieldName, `groups fields ${action} requires the existing custom field name.`);
  }
  if (args.length) throw new CliError(`Unexpected groups fields arguments: ${args.join(' ')}. Use list, get, create, or update; custom field deletion is not supported.`, { exitCode: 2 });
  let body;
  if (action === 'create' || action === 'update') {
    body = await buildGroupFieldBody(context.flags, context.stdin);
    if (action === 'update' && body.type !== undefined) throw new CliError('A custom field type cannot be changed with groups fields update.', { exitCode: 2 });
    if (action === 'update' && Array.isArray(body.removeOptions) && body.removeOptions.length) {
      await confirmDestructive(context, `options and their associated data on ${groupId}/${entityType}/${params.customFieldName}`, params.customFieldName);
    }
  }
  const result = await requestEndpoint(context, `groups.fields.${action}`, { params, body, query: action === 'list' ? buildQuery(context.flags) : undefined });
  writeOutput(result, context);
  return 0;
}

async function handleGroupMembers(context, args) {
  let action = args.shift() || 'list';
  if (action === 'delete' || action === 'rm') action = 'remove';
  if (!['list', 'add', 'update', 'remove'].includes(action)) throw new CliError(`Unknown groups members action: ${action}`, { exitCode: 2 });
  const groupId = flagString(context.flags, 'group-id') || args.shift();
  requireValue(groupId, 'groups members requires a group id.');
  const userId = flagString(context.flags, 'user-id') || args.shift();
  const params = { groupId, userId };
  let body;
  if (action === 'add' || action === 'update') {
    body = await buildGenericBody(context.flags, context.stdin);
    const role = flagString(context.flags, 'role');
    if (role !== undefined) body.role = role;
    if (action === 'add') {
      if (userId) body.id = userId;
      requireValue(body.id, 'groups members add requires a user id, --user-id, or id in --data.');
    }
    requireValue(body.role, `groups members ${action} requires --role or role in --data.`);
  }
  if (action === 'update' || action === 'remove') requireValue(userId, `groups members ${action} requires a user id.`);
  if (action === 'remove') await confirmDestructive(context, `member ${userId} from group ${groupId}`, userId);
  const result = await requestEndpoint(context, `groups.members.${action}`, { params, body, query: action === 'list' ? buildQuery(context.flags) : undefined });
  writeOutput(result, context);
  return 0;
}

async function handleUsers(context) {
  const action = context.positionals[1] || 'me';
  const args = context.positionals.slice(2);
  if (action === 'help') {
    context.stdout.write(helpFor('users'));
    return 0;
  }
  if (action === 'me') {
    const result = await requestEndpoint(context, 'users.me');
    writeOutput(result, context);
    return 0;
  }
  if (action === 'list') {
    const result = await requestEndpoint(context, 'users.list', { query: buildQuery(context.flags) });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'get') {
    const userId = args[0] || flagString(context.flags, 'id') || flagString(context.flags, 'user-id');
    requireValue(userId, 'users get requires a userId.');
    const result = await requestEndpoint(context, 'users.get', { params: { userId } });
    writeOutput(result, context);
    return 0;
  }
  throw new CliError(`Unknown users action: ${action}\n\n${helpFor('users')}`, { exitCode: 2 });
}

async function handleObjects(context) {
  const resource = context.command;
  const action = context.positionals[1] || 'list';
  const args = context.positionals.slice(2);
  if (action === 'help') {
    context.stdout.write(dealsHelp(resource));
    return 0;
  }
  if (action === 'batch') {
    const operation = args.shift();
    const groupId = flagString(context.flags, 'group-id') || args.shift();
    const objectType = flagString(context.flags, 'object-type') || flagString(context.flags, 'deal-field') || args.shift();
    requireValue(groupId, `${resource} batch requires --group-id or positional groupId.`);
    requireValue(objectType, `${resource} batch requires --object-type or positional objectType, e.g. Deals.`);
    return handleBatch(context, {
      resource, operation, ids: args, params: { groupId, objectType },
      applyFlags: applyDealFlags, nouns: [`object of type ${objectType}`, `objects of type ${objectType}`], groupsReplace: false, listFields: OBJECT_LIST_FIELDS,
    });
  }
  if (!['list', 'search', 'get', 'create', 'update', 'delete', 'rm'].includes(action)) throw new CliError(`Unknown ${resource} action: ${action}\n\n${dealsHelp(resource)}`, { exitCode: 2 });
  const needsId = ['get', 'update', 'delete', 'rm'].includes(action);
  const id = needsId ? flagString(context.flags, 'id') || flagString(context.flags, resource === 'deals' ? 'deal-id' : 'object-id') || args.shift() : undefined;
  const groupId = flagString(context.flags, 'group-id') || args.shift();
  const objectType = flagString(context.flags, 'object-type') || flagString(context.flags, 'deal-field') || args.shift();
  const params = { groupId, objectType, [resource === 'deals' ? 'dealId' : 'objectId']: id };
  if (needsId) requireValue(id, `${resource} ${action} requires an id.`);
  requireValue(groupId, `${resource} commands require --group-id or positional groupId.`);
  requireValue(objectType, `${resource} commands require --object-type or positional objectType, e.g. Deals.`);

  if (action === 'list') {
    const result = await requestEndpoint(context, `${resource}.list`, { params, query: buildQuery(context.flags) });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'search') {
    const query = queryForSearch(resource, args);
    mergeQuery(query, buildQuery(context.flags));
    const result = await requestEndpoint(context, `${resource}.list`, { params, query });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'get') {
    const result = await requestEndpoint(context, `${resource}.get`, { params });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'create') {
    const body = await buildDealBody(context.flags, context.stdin);
    const result = await requestEndpoint(context, `${resource}.create`, { params, body });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'update') {
    const body = await buildDealBody(context.flags, context.stdin);
    const result = await requestEndpoint(context, `${resource}.update`, { params, body });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'delete' || action === 'rm') {
    await confirmDestructive(context, `${resource} ${id}`, id);
    const result = await requestEndpoint(context, `${resource}.delete`, { params });
    writeOutput(result, context);
    return 0;
  }
}

async function handleInteractions(context) {
  let action = context.positionals[1] || 'create';
  if (action === 'help') {
    context.stdout.write(helpFor('interactions'));
    return 0;
  }
  if (action === 'rm') action = 'delete';
  if (['list', 'past', 'upcoming'].includes(action)) return listInteractions(context, action);
  if (!['create', 'get', 'update', 'delete'].includes(action)) throw new CliError(`Unknown interactions action: ${action}\n\n${interactionsHelp()}`, { exitCode: 2 });
  const interactionId = context.positionals[2] || flagString(context.flags, 'id') || flagString(context.flags, 'interaction-id');
  if (['get', 'update', 'delete'].includes(action)) requireValue(interactionId, `interactions ${action} requires an interaction id.`);
  const query = ['get', 'delete'].includes(action) ? buildQuery(context.flags) : undefined;
  if (query) requireValue(query.get('entity.id'), `interactions ${action} requires --entity-id or --param entity.id=<id>.`);
  let body;
  if (action === 'create' || action === 'update') body = await buildInteractionBody(context.flags, context.stdin);
  if (action === 'update') requireValue(body.entity?.id, 'interactions update requires --entity-id or entity.id in --data.');
  if (action === 'delete') await confirmDestructive(context, `interaction ${interactionId}`, interactionId);
  const result = await requestEndpoint(context, `interactions.${action}`, { params: { interactionId }, body, query });
  writeOutput(result, context);
  return 0;
}

// past and upcoming use GET /v1/interactions, which replaces the deprecated /past and /upcoming routes.
async function listInteractions(context, action) {
  const query = buildQuery(context.flags, { resource: 'interactions' });
  requireValue(query.get('entity.id'), `interactions ${action} requires --entity-id or --param entity.id=<id>.`);
  if (action === 'list') {
    if (!query.has('timeframe')) query.set('timeframe', 'past');
  } else {
    if (query.has('timeframe') && query.get('timeframe') !== action) {
      throw new CliError(`interactions ${action} always lists ${action} interactions. Use interactions list --timeframe past|upcoming to choose.`, { exitCode: 2 });
    }
    query.set('timeframe', action);
  }
  const result = await requestEndpoint(context, 'interactions.list', { query });
  writeOutput(result, context);
  return 0;
}

async function handleEnrichments(context) {
  const action = context.positionals[1] || 'list';
  const args = context.positionals.slice(2);
  if (action === 'help') {
    context.stdout.write(enrichmentsHelp());
    return 0;
  }
  if (action === 'list') {
    const result = await requestEndpoint(context, 'enrichments.list', { query: buildQuery(context.flags, { resource: 'enrichments' }) });
    writeOutput(result, { ...context, columns: ENRICHMENT_COLUMNS });
    return 0;
  }
  if (action === 'get') {
    const enrichmentId = args[0] || flagString(context.flags, 'id');
    requireValue(enrichmentId, 'enrichments get requires an enrichment ID.');
    const wait = readWaitOptions(context.flags);
    const result = await requestEndpoint(context, 'enrichments.get', { params: { enrichmentId } });
    return finishEnrichment(context, result, wait);
  }
  if (action === 'create' || action === 'start') return handleEnrichmentCreate(context, args);
  throw new CliError(`Unknown enrichments action: ${action}\n\n${enrichmentsHelp()}`, { exitCode: 2 });
}

async function handleEnrichmentCreate(context, ids) {
  const body = await buildEnrichmentBody(context.flags, context.stdin, ids);
  // Validate --wait options before the request, which starts spending credits.
  const wait = readWaitOptions(context.flags);
  const people = `${body.ids.length} ${body.ids.length === 1 ? 'person' : 'people'}`;
  await confirmAction(context, {
    prompt: `Enrich ${people} (${body.fields.join(', ')})? This uses workspace enrichment credits for each email or phone found.`,
    expected: body.ids.length,
    refusal: `Refusing to spend enrichment credits on ${people} without confirmation.`,
  });
  const result = await requestEndpoint(context, 'enrichments.create', { body });
  return finishEnrichment(context, result, wait);
}

function readWaitOptions(flags) {
  if (!flagBoolean(flags, 'wait')) return undefined;
  return {
    timeoutMs: secondsFlag(flags, 'wait-timeout', DEFAULT_WAIT_TIMEOUT_SECONDS, 0) * 1000,
    intervalMs: secondsFlag(flags, 'wait-interval', DEFAULT_WAIT_INTERVAL_SECONDS, 1) * 1000,
  };
}

async function finishEnrichment(context, initial, wait) {
  const result = wait ? await waitForEnrichment(context, initial, wait) : initial;
  writeOutput(result, { ...context, columns: ENRICHMENT_ITEM_COLUMNS });
  if (result.dryRun) return 0;
  const enrichment = result.data?.data;
  const summary = enrichmentSummary(enrichment);
  if (summary && !flagBoolean(context.flags, 'quiet')) context.stderr.write(`${summary}\n`);
  return wait && enrichment?.status === 'failed' ? PARTIAL_FAILURE_EXIT_CODE : 0;
}

function isPendingEnrichment(status) {
  return status === 'pending' || status === 'in_progress';
}

// Polls until the enrichment leaves pending/in_progress. Any other status, including a future one, ends the wait.
async function waitForEnrichment(context, initial, { timeoutMs, intervalMs }) {
  if (initial.dryRun) return initial;
  const enrichmentId = initial.data?.data?.id;
  if (!enrichmentId) throw new CliError('Cannot wait: the enrichment response has no data.id.');
  const resume = `Resume with: folkctl enrichments get ${enrichmentId} --wait`;
  const created = initial.request?.method === 'POST';
  const started = Date.now();
  let slept = 0;
  let current = initial;
  let lastStatus;
  while (isPendingEnrichment(current.data?.data?.status)) {
    const status = current.data.data.status;
    if (status !== lastStatus) warn(context, `Waiting for enrichment ${enrichmentId} (${status})…`, { prefix: '' });
    lastStatus = status;
    const remaining = timeoutMs - Math.max(Date.now() - started, slept);
    if (remaining <= 0) {
      throw new CliError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for enrichment ${enrichmentId}; it is still ${status}. ${resume}`, { exitCode: 1 });
    }
    // Never sleep past the deadline, so a timeout shorter than the interval still gets one poll.
    const delay = Math.min(Math.max(intervalMs, delayForPolicies(current.response?.rateLimit?.policies)), remaining);
    await context.sleep(delay);
    slept += delay;
    try {
      current = await requestEndpoint(context, 'enrichments.get', { params: { enrichmentId } });
    } catch (error) {
      // The enrichment already started. Point to it, so a re-run does not start (and pay for) a second one.
      const lead = created
        ? `Enrichment ${enrichmentId} started, but checking its status failed. Re-running the create command without --idempotency-key would start a second enrichment.`
        : `Checking enrichment ${enrichmentId} failed.`;
      throw new CliError(`${lead}\n${formatError(error, { verbose: flagBoolean(context.flags, 'verbose') })}\n${resume}`, {
        exitCode: errorToExitCode(error),
        cause: error,
        idempotencyKey: created ? initial.request?.headers?.['Idempotency-Key'] : undefined,
      });
    }
  }
  return current;
}

function enrichmentSummary(enrichment) {
  if (!enrichment?.id) return undefined;
  const fields = Array.isArray(enrichment.fields) && enrichment.fields.length ? ` (${enrichment.fields.join(', ')})` : '';
  const counts = enrichment.summary;
  if (enrichment.status === 'completed' && counts) {
    return `Enrichment ${enrichment.id} completed${fields}: ${counts.total} people; ${counts.enriched} enriched, ${counts.partiallyEnriched} partially enriched, ${counts.notEnriched} not enriched, ${counts.skipped} skipped, ${counts.error} errors.`;
  }
  if (enrichment.status === 'failed') return `Enrichment ${enrichment.id} failed${enrichment.errorReason ? `: ${enrichment.errorReason}` : ''}.`;
  if (isPendingEnrichment(enrichment.status)) return `Enrichment ${enrichment.id} is ${enrichment.status}${fields}. Follow it with: folkctl enrichments get ${enrichment.id} --wait`;
  return `Enrichment ${enrichment.id} status: ${enrichment.status}.`;
}

async function handleCredits(context) {
  const action = context.positionals[1] || 'get';
  if (action === 'help') {
    context.stdout.write(creditsHelp());
    return 0;
  }
  if (!['get', 'list'].includes(action)) throw new CliError(`Unknown credits action: ${action}\n\n${creditsHelp()}`, { exitCode: 2 });
  const result = await requestEndpoint(context, 'credits.get');
  writeOutput(result, { ...context, columns: CREDIT_COLUMNS });
  return 0;
}

function handleMcp(context) {
  const action = context.positionals[1] || 'info';
  if (action === 'help') {
    context.stdout.write(mcpHelp());
    return 0;
  }
  if (action === 'info') {
    writeOutput({ data: MCP_INFO }, context);
    return 0;
  }
  if (action === 'config') {
    const result = mcpConfig(context.positionals[2] || 'generic');
    if (flagBoolean(context.flags, 'json')) writeOutput({ data: result }, context);
    else context.stdout.write(`${result.content}\n`);
    return 0;
  }
  throw new CliError(`Unknown mcp action: ${action}\n\n${mcpHelp()}`, { exitCode: 2 });
}

async function requestEndpoint(context, key, { params = {}, query, body } = {}) {
  const endpoint = requireEndpoint(key);
  const path = fillPath(endpoint.path, params);
  let result;
  try {
    result = await requestFolk({ method: endpoint.method, path, query, body, config: context.config, flags: context.flags, fetchImpl: context.fetchImpl, paginate: endpoint.paginated, sleep: context.sleep });
  } catch (error) {
    // A deprecated endpoint can fail because Folk removed it, so keep its notice next to the error.
    if (endpoint.deprecation) warn(context, endpoint.deprecation);
    throw error;
  }
  warnDeprecations(context, result, endpoint);
  return result;
}

// Folk's own notices (the deprecations array, or Deprecation and Sunset headers) take precedence: they also
// cover endpoints deprecated after this release, and can carry newer dates than the bundled notice, which
// covers dry-runs and responses without a notice.
function warnDeprecations(context, result, endpoint) {
  const live = Boolean(result) && !result.dryRun;
  const fromFolk = live && Array.isArray(result.data?.deprecations) ? result.data.deprecations.filter((message) => typeof message === 'string' && message) : [];
  if (fromFolk.length) {
    for (const message of fromFolk) warn(context, message);
    return;
  }
  if (endpoint?.deprecation) {
    const sunset = live ? headerDate(result.response?.sunset) : undefined;
    warn(context, sunset && sunset !== endpoint.sunset ? `${endpoint.deprecation} Folk's Sunset header now says ${sunset}.` : endpoint.deprecation);
    return;
  }
  if (live && result.response?.deprecation) {
    warn(context, `Folk marks this endpoint as deprecated${result.response.sunset ? ` (sunset ${result.response.sunset})` : ''}.`);
  }
}

function headerDate(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : undefined;
}

function warn(context, message, { prefix = 'Warning: ' } = {}) {
  if (flagBoolean(context.flags, 'quiet') || context.warnings?.has(message)) return;
  context.warnings?.add(message);
  context.stderr.write(`${prefix}${message}\n`);
}

function requireEndpoint(key) {
  const endpoint = findEndpoint(key);
  if (!endpoint) throw new CliError(`Unknown endpoint key: ${key}`, { exitCode: 2 });
  return endpoint;
}

function requireValue(value, message) {
  if (value === undefined || value === null || value === '') throw new CliError(message, { exitCode: 2 });
}

// minimum 0 means any positive number; otherwise the value must be at least minimum seconds.
function secondsFlag(flags, name, fallback, minimum) {
  if (!hasFlag(flags, name)) return fallback;
  const value = Number(flagString(flags, name));
  const valid = Number.isFinite(value) && (minimum > 0 ? value >= minimum : value > 0);
  if (!valid) throw new CliError(`Invalid --${name}. Expected ${minimum > 0 ? `at least ${minimum} second` : 'a positive number of seconds'}.`, { exitCode: 2 });
  return value;
}

function mergeQuery(target, source) {
  for (const [key, value] of source.entries()) {
    if (['limit', 'cursor', 'combinator', 'query', 'createdAfter', 'createdBefore', 'entity.id'].includes(key)) target.set(key, value);
    else target.append(key, value);
  }
  return target;
}

async function confirmAction(context, { prompt, expected, refusal, cancelled = 'Cancelled.' }) {
  if (flagBoolean(context.flags, 'dry-run') || flagBoolean(context.flags, 'yes') || flagBoolean(context.flags, 'force')) return;
  // Without a terminal, or once --data - has read stdin to the end, there is no one to answer a prompt.
  if (flagBoolean(context.flags, 'no-input') || !context.stdin.isTTY || context.stdin.readableEnded) {
    throw new CliError(`${refusal} Pass --yes or --force to confirm.`, { exitCode: 3 });
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: context.stdin, output: context.stderr });
  let answer;
  try {
    // Input that ends before an answer (Ctrl-D) cancels instead of leaving the question pending. The cancel
    // waits one tick, so an answer that arrives together with the end of input still counts.
    answer = await new Promise((resolve, reject) => {
      rl.once('close', () => setImmediate(() => reject(new CliError(cancelled, { exitCode: 3 }))));
      rl.question(`${prompt} Type ${expected} to confirm: `).then(resolve, reject);
    });
  } finally {
    rl.close();
  }
  if (answer.trim() !== String(expected)) throw new CliError(cancelled, { exitCode: 3 });
}

async function confirmDestructive(context, label, expected) {
  return confirmAction(context, {
    prompt: `Delete ${label}?`,
    expected,
    refusal: `Refusing to delete ${label} without confirmation.`,
    cancelled: 'Delete cancelled.',
  });
}

export async function rmrf(filePath) {
  await fs.rm(filePath, { force: true, recursive: true });
}
