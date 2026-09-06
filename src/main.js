import fs from 'node:fs/promises';
import { parseFlagArgs, flagBoolean, flagString } from './args.js';
import { buildGenericBody, buildPersonBody, buildCompanyBody, buildDealBody, buildNoteBody, buildReminderBody, buildTaskBody, buildGroupBody, buildGroupFieldBody, buildWebhookBody, buildInteractionBody, readStdinText } from './body.js';
import { getEffectiveConfig, writeConfig, removeConfigToken } from './config.js';
import { findEndpoint, fillPath, listEndpoints } from './endpoints.js';
import { CliError, errorToExitCode, formatError } from './errors.js';
import { requestFolk } from './http.js';
import { buildQuery, queryForSearch } from './query.js';
import { authHelp, apiHelp, dealsHelp, groupsHelp, interactionsHelp, mcpHelp, resourceHelp, topHelp, VERSION } from './help.js';
import { mcpConfig, MCP_INFO } from './mcp.js';
import { writeOutput } from './output.js';
import { redact } from './util.js';

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

const TASK_COMPLETION_ACTIONS = new Map([
  ['done', 'done'], ['mark-done', 'done'], ['mark-as-done', 'done'],
  ['todo', 'todo'], ['mark-todo', 'todo'], ['mark-as-todo', 'todo'],
]);

export async function main({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, fetchImpl = globalThis.fetch } = {}) {
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

    const context = { command, flags, positionals, env, cwd, stdin, stdout, stderr, fetchImpl };
    if (command === 'auth') return await handleAuth(context);
    if (command === 'api' || command === 'docs') return await handleApi(context);
    if (command === 'mcp') return handleMcp(context);
    if (command === 'groups') return await withConfig(context, handleGroups);
    if (command === 'users') return await withConfig(context, handleUsers);
    if (command === 'deals' || command === 'objects') return await withConfig(context, handleObjects);
    if (command === 'interactions') return await withConfig(context, handleInteractions);
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
  if (command === 'users') return `Usage:\n  folkctl users list [--limit n] [--all]\n  folkctl users me [--json]\n  folkctl users get <userId> [--json]\n`;
  if (command === 'interactions') return interactionsHelp();
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
    const endpoints = listEndpoints({ resource }).map(({ key, method, path, summary, docsUrl, deprecated, beta }) => ({
      key, method, path, summary, docsUrl,
      ...(deprecated ? { deprecated: true } : {}),
      ...(beta ? { beta: true } : {}),
    }));
    writeOutput({ data: { items: endpoints } }, context);
    return 0;
  }
  if (action === 'docs') {
    const key = context.positionals[offset];
    if (!key) throw new CliError('api docs requires an endpoint key, e.g. people.create', { exitCode: 2 });
    const endpoint = requireEndpoint(key);
    const text = `${endpoint.key}\n${endpoint.method} ${endpoint.path}\n${endpoint.summary}\nDocs: ${endpoint.docsUrl}\n${endpoint.paginated ? 'Paginated: yes' : 'Paginated: no'}${endpoint.filters ? '\nFilters: yes' : ''}${endpoint.beta ? '\nOpen beta: API surface may change.' : ''}${endpoint.deprecation ? `\nDeprecated: ${endpoint.deprecation}` : ''}${endpoint.requiredQuery ? `\nRequired query: ${endpoint.requiredQuery.join(', ')}` : ''}\n`;
    context.stdout.write(text);
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
    if (normalizedMethod === 'DELETE') await confirmDestructive(context, `${normalizedMethod} ${path}`, path);
    const body = ['POST', 'PUT', 'PATCH'].includes(normalizedMethod) || flagString(context.flags, 'data') ? await buildGenericBody(context.flags, context.stdin) : undefined;
    const result = await requestFolk({ method: normalizedMethod, path, query: buildQuery(context.flags), body, config: context.config, flags: context.flags, fetchImpl: context.fetchImpl, paginate: flagBoolean(context.flags, 'all') });
    writeOutput(result, context);
    return 0;
  }
  throw new CliError(`Unknown api action: ${action}\n\n${apiHelp()}`, { exitCode: 2 });
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
  if (action === 'list') action = 'past';
  if (action === 'rm') action = 'delete';
  if (!['create', 'past', 'upcoming', 'get', 'update', 'delete'].includes(action)) throw new CliError(`Unknown interactions action: ${action}\n\n${interactionsHelp()}`, { exitCode: 2 });
  const interactionId = context.positionals[2] || flagString(context.flags, 'id') || flagString(context.flags, 'interaction-id');
  if (['get', 'update', 'delete'].includes(action)) requireValue(interactionId, `interactions ${action} requires an interaction id.`);
  const query = ['past', 'upcoming', 'get', 'delete'].includes(action) ? buildQuery(context.flags) : undefined;
  if (query) requireValue(query.get('entity.id'), `interactions ${action} requires --entity-id or --param entity.id=<id>.`);
  let body;
  if (action === 'create' || action === 'update') body = await buildInteractionBody(context.flags, context.stdin);
  if (action === 'update') requireValue(body.entity?.id, 'interactions update requires --entity-id or entity.id in --data.');
  if (action === 'delete') await confirmDestructive(context, `interaction ${interactionId}`, interactionId);
  const result = await requestEndpoint(context, `interactions.${action}`, { params: { interactionId }, body, query });
  writeOutput(result, context);
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
  if (endpoint.deprecation && !flagBoolean(context.flags, 'quiet')) context.stderr.write(`Warning: ${endpoint.deprecation}\n`);
  return requestFolk({ method: endpoint.method, path, query, body, config: context.config, flags: context.flags, fetchImpl: context.fetchImpl, paginate: endpoint.paginated });
}

function requireEndpoint(key) {
  const endpoint = findEndpoint(key);
  if (!endpoint) throw new CliError(`Unknown endpoint key: ${key}`, { exitCode: 2 });
  return endpoint;
}

function requireValue(value, message) {
  if (value === undefined || value === null || value === '') throw new CliError(message, { exitCode: 2 });
}

function mergeQuery(target, source) {
  for (const [key, value] of source.entries()) {
    if (['limit', 'cursor', 'combinator', 'query', 'createdAfter', 'createdBefore', 'entity.id'].includes(key)) target.set(key, value);
    else target.append(key, value);
  }
  return target;
}

async function confirmDestructive(context, label, expected) {
  if (flagBoolean(context.flags, 'dry-run') || flagBoolean(context.flags, 'yes') || flagBoolean(context.flags, 'force')) return;
  if (flagBoolean(context.flags, 'no-input') || !context.stdin.isTTY) {
    throw new CliError(`Refusing to delete ${label} without confirmation. Pass --yes or --force to confirm.`, { exitCode: 3 });
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: context.stdin, output: context.stderr });
  const answer = await rl.question(`Delete ${label}? Type ${expected} to confirm: `);
  rl.close();
  if (answer !== String(expected)) throw new CliError('Delete cancelled.', { exitCode: 3 });
}

export async function rmrf(filePath) {
  await fs.rm(filePath, { force: true, recursive: true });
}
