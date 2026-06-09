import fs from 'node:fs/promises';
import { parseFlagArgs, flagBoolean, flagString } from './args.js';
import { buildGenericBody, buildPersonBody, buildCompanyBody, buildDealBody, buildNoteBody, buildReminderBody, buildWebhookBody, buildInteractionBody, readStdinText } from './body.js';
import { getEffectiveConfig, writeConfig, removeConfigToken } from './config.js';
import { findEndpoint, fillPath, listEndpoints } from './endpoints.js';
import { CliError, errorToExitCode, formatError } from './errors.js';
import { requestFolk } from './http.js';
import { buildQuery, queryForSearch } from './query.js';
import { authHelp, apiHelp, dealsHelp, resourceHelp, topHelp, VERSION } from './help.js';
import { writeOutput } from './output.js';
import { redact } from './util.js';

const BODY_BUILDERS = {
  people: buildPersonBody,
  companies: buildCompanyBody,
  deals: buildDealBody,
  notes: buildNoteBody,
  reminders: buildReminderBody,
  webhooks: buildWebhookBody,
  interactions: buildInteractionBody,
};

const SIMPLE_RESOURCES = new Map([
  ['people', { idParam: 'personId' }],
  ['companies', { idParam: 'companyId' }],
  ['notes', { idParam: 'noteId' }],
  ['reminders', { idParam: 'reminderId' }],
  ['webhooks', { idParam: 'webhookId' }],
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
    if (command === 'groups') return await withConfig(context, handleGroups);
    if (command === 'users') return await withConfig(context, handleUsers);
    if (command === 'deals') return await withConfig(context, handleDeals);
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
  if (command === 'deals') return dealsHelp();
  if (command === 'groups') return `Usage:\n  folkctl groups list [--limit n] [--all]\n  folkctl groups fields <groupId> <entityType> [--limit n] [--all]\n\nentityType is person, company, or a custom object name such as Deals.\n`;
  if (command === 'users') return `Usage:\n  folkctl users list [--limit n] [--all]\n  folkctl users me [--json]\n  folkctl users get <userId> [--json]\n`;
  if (command === 'interactions') return `Usage:\n  folkctl interactions create --entity-id per_... --date-time 2025-07-17T09:00:00.000Z --title "Coffee" --content "Notes" --type ☕️\n`;
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
    const endpoints = listEndpoints({ resource }).map(({ key, method, path, summary, docsUrl }) => ({ key, method, path, summary, docsUrl }));
    writeOutput({ data: { items: endpoints } }, context);
    return 0;
  }
  if (action === 'docs') {
    const key = context.positionals[offset];
    if (!key) throw new CliError('api docs requires an endpoint key, e.g. people.create', { exitCode: 2 });
    const endpoint = requireEndpoint(key);
    const text = `${endpoint.key}\n${endpoint.method} ${endpoint.path}\n${endpoint.summary}\nDocs: ${endpoint.docsUrl}\n${endpoint.paginated ? 'Paginated: yes' : 'Paginated: no'}${endpoint.filters ? '\nFilters: yes' : ''}\n`;
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
    const result = await requestEndpoint(context, `${resource}.list`, { query: buildQuery(context.flags) });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'search') {
    const query = queryForSearch(resource, args);
    mergeQuery(query, buildQuery(context.flags));
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
    const result = await requestEndpoint(context, `${resource}.update`, { params: { [idParam]: id }, body });
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
    const result = await requestEndpoint(context, 'groups.list', { query: buildQuery(context.flags) });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'fields' || action === 'custom-fields') {
    const groupId = flagString(context.flags, 'group-id') || args[0];
    const entityType = flagString(context.flags, 'entity-type') || args[1];
    requireValue(groupId, 'groups fields requires a group id.');
    requireValue(entityType, 'groups fields requires entityType: person, company, or custom object name.');
    const result = await requestEndpoint(context, 'groups.fields', { params: { groupId, entityType }, query: buildQuery(context.flags) });
    writeOutput(result, context);
    return 0;
  }
  throw new CliError(`Unknown groups action: ${action}\n\n${helpFor('groups')}`, { exitCode: 2 });
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

async function handleDeals(context) {
  const action = context.positionals[1] || 'list';
  const args = context.positionals.slice(2);
  if (action === 'help') {
    context.stdout.write(dealsHelp());
    return 0;
  }
  const needsId = ['get', 'update', 'delete', 'rm'].includes(action);
  const dealId = needsId ? args[0] || flagString(context.flags, 'id') || flagString(context.flags, 'deal-id') : undefined;
  const offset = needsId ? 1 : 0;
  const groupId = flagString(context.flags, 'group-id') || args[offset];
  const objectType = flagString(context.flags, 'object-type') || flagString(context.flags, 'deal-field') || args[offset + 1];
  const params = { groupId, objectType, ...(dealId ? { dealId } : {}) };

  if (action === 'list') {
    requireDealPath(params);
    const result = await requestEndpoint(context, 'deals.list', { params, query: buildQuery(context.flags) });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'search') {
    requireDealPath(params);
    const terms = args.slice(offset + 2);
    const query = queryForSearch('deals', terms.length ? terms : args.slice(0, 1));
    mergeQuery(query, buildQuery(context.flags));
    const result = await requestEndpoint(context, 'deals.list', { params, query });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'get') {
    requireValue(dealId, 'deals get requires a dealId.');
    requireDealPath(params);
    const result = await requestEndpoint(context, 'deals.get', { params });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'create') {
    requireDealPath(params);
    const body = await buildDealBody(context.flags, context.stdin);
    const result = await requestEndpoint(context, 'deals.create', { params, body });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'update') {
    requireValue(dealId, 'deals update requires a dealId.');
    requireDealPath(params);
    const body = await buildDealBody(context.flags, context.stdin);
    const result = await requestEndpoint(context, 'deals.update', { params, body });
    writeOutput(result, context);
    return 0;
  }
  if (action === 'delete' || action === 'rm') {
    requireValue(dealId, 'deals delete requires a dealId.');
    requireDealPath(params);
    await confirmDestructive(context, `deal ${dealId}`, dealId);
    const result = await requestEndpoint(context, 'deals.delete', { params });
    writeOutput(result, context);
    return 0;
  }
  throw new CliError(`Unknown deals action: ${action}\n\n${dealsHelp()}`, { exitCode: 2 });
}

async function handleInteractions(context) {
  const action = context.positionals[1] || 'create';
  if (action === 'help') {
    context.stdout.write(helpFor('interactions'));
    return 0;
  }
  if (action !== 'create') throw new CliError('interactions only supports create in the current folk API.', { exitCode: 2 });
  const body = await buildInteractionBody(context.flags, context.stdin);
  const result = await requestEndpoint(context, 'interactions.create', { body });
  writeOutput(result, context);
  return 0;
}

async function requestEndpoint(context, key, { params = {}, query, body } = {}) {
  const endpoint = requireEndpoint(key);
  const path = fillPath(endpoint.path, params);
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

function requireDealPath(params) {
  requireValue(params.groupId, 'Deal commands require --group-id or positional groupId.');
  requireValue(params.objectType, 'Deal commands require --object-type or positional objectType, e.g. Deals.');
}

function mergeQuery(target, source) {
  for (const [key, value] of source.entries()) {
    if (['limit', 'cursor', 'combinator'].includes(key)) target.set(key, value);
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
