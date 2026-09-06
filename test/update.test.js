import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import { VERSION } from '../src/version.js';

async function run(argv, { fetchImpl, env = {} } = {}) {
  let stdout = '';
  let stderr = '';
  const calls = [];
  const code = await main({
    argv: [...argv, '--no-retry'],
    env: { FOLKCTL_CONFIG: fileURLToPath(new URL('./fixtures/no-config.json', import.meta.url)), FOLK_API_KEY: 'fk_test_secret', ...env },
    cwd: fileURLToPath(new URL('./fixtures/empty', import.meta.url)),
    stdin: Readable.from([]),
    stdout: new Writable({ write(chunk, _encoding, cb) { stdout += chunk; cb(); } }),
    stderr: new Writable({ write(chunk, _encoding, cb) { stderr += chunk; cb(); } }),
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), ...init });
      assert.ok(fetchImpl, 'Unexpected network request');
      return fetchImpl(url, init);
    },
  });
  return { code, stdout, stderr, calls };
}

async function preview(argv) {
  const result = await run([...argv, '--dry-run', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.calls.length, 0);
  assert.ok(!result.stdout.includes('fk_test_secret'));
  const payload = JSON.parse(result.stdout);
  return { ...payload.request, url: new URL(payload.request.url), stderr: result.stderr };
}

test('tasks use task filters, including repeated entity IDs and explicit assignment booleans', async () => {
  const request = await preview(['tasks', 'list', '--entity-id', 'per_1', '--entity-id', 'per_2', '--only-assigned-to-me', '--empty', 'completedAt', '--filter', 'dueAt:lt:2026-09-30']);
  assert.equal(request.url.pathname, '/v1/tasks');
  assert.deepEqual(request.url.searchParams.getAll('filter[entity][in]'), ['per_1', 'per_2']);
  assert.equal(request.url.searchParams.has('entity.id'), false);
  assert.equal(request.url.searchParams.get('onlyAssignedToMe'), 'true');
  assert.equal(request.url.searchParams.get('filter[completedAt][empty]'), '');
  assert.equal(request.url.searchParams.get('filter[dueAt][lt]'), '2026-09-30');
  for (const flags of [['--only-assigned-to-me=false'], ['--only-assigned-to-me', 'false'], ['--no-only-assigned-to-me']]) {
    const other = await preview(['tasks', 'list', ...flags]);
    assert.equal(other.url.searchParams.get('onlyAssignedToMe'), 'false');
  }
});

test('task creation sends the documented body and preserves explicit private visibility', async () => {
  const request = await preview(['tasks', 'create', '--entity-id', 'per_1', '--title', 'Follow up', '--due-at', '2026-09-08', '--due-time', '09:00', '--recurrence-frequency', 'weekly', '--is-public', 'false', '--assigned-user-id', 'usr_1', '--data', '{"description":"Bring notes"}']);
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.body, {
    entity: { id: 'per_1' }, title: 'Follow up', dueAt: '2026-09-08', dueTime: '09:00',
    recurrenceFrequency: 'weekly', isPublic: false, assignedUsers: [{ id: 'usr_1' }], description: 'Bring notes',
  });
  const cleared = await preview(['tasks', 'update', 'tsk_1', '--due-time', 'null', '--recurrence-frequency', 'null', '--field', 'description=null', '--visibility', 'private']);
  assert.deepEqual(cleared.body, { description: null, dueTime: null, recurrenceFrequency: null, isPublic: false });
  const publicTask = await preview(['tasks', 'update', 'tsk_1', '--is-public=true']);
  assert.equal(publicTask.body.isPublic, true);
});

test('invalid task booleans fail before a request, instead of exposing private tasks', async (t) => {
  for (const [command, name] of [
    [['tasks', 'create', '--entity-id', 'per_1', '--title', 'Follow up'], 'is-public'],
    [['tasks', 'update', 'tsk_1'], 'is-public'],
    [['tasks', 'list'], 'only-assigned-to-me'],
  ]) {
    for (const value of ['maybe', '', '2', '-']) {
      for (const flags of [[`--${name}=${value}`], [`--${name}`, value]]) {
        await t.test(JSON.stringify([...command, ...flags]), async () => {
          const result = await run([...command, ...flags]);
          assert.equal(result.code, 2, result.stderr);
          assert.equal(result.calls.length, 0);
          assert.equal(result.stdout, '');
          assert.match(result.stderr, new RegExp(`Invalid --${name}\\. Expected true or false\\.`));
        });
      }
    }
  }
  const visibility = await run(['tasks', 'create', '--visibility', 'maybe']);
  assert.equal(visibility.code, 2, visibility.stderr);
  assert.equal(visibility.calls.length, 0);
});

test('task operations and completion aliases use the exact documented routes', async () => {
  for (const [action, method, suffix, flags] of [
    ['get', 'GET', '', []], ['update', 'PATCH', '', ['--title', 'Rescheduled']],
    ['delete', 'DELETE', '', []],
    ...['done', 'mark-done', 'mark-as-done'].map(action => [action, 'POST', '/mark-as-done', ['--completed-at', '2026-09-06T12:00:00.000Z']]),
    ...['todo', 'mark-todo', 'mark-as-todo'].map(action => [action, 'POST', '/mark-as-todo', []]),
  ]) {
    const request = await preview(['tasks', action, 'tsk_1', ...flags]);
    assert.equal(request.method, method, action);
    assert.equal(request.url.pathname, `/v1/tasks/tsk_1${suffix}`, action);
    if (suffix === '/mark-as-done') assert.deepEqual(request.body, { completedAt: '2026-09-06T12:00:00.000Z' });
    if (suffix === '/mark-as-todo') assert.equal(request.body, undefined);
  }
  const request = await preview(['tasks', 'done', '--task-id', 'tsk_1', '--data', '{"completedAt":"2026-09-06T12:00:00Z"}']);
  assert.deepEqual(request.body, { completedAt: '2026-09-06T12:00:00Z' });
});

test('completion requires an explicit timestamp and cannot be changed through task PATCH', async () => {
  for (const argv of [
    ['tasks', 'done', 'tsk_1'], ['tasks', 'done', '--completed-at', '2026-09-06T12:00:00Z'],
    ['tasks', 'update', 'tsk_1', '--completed-at', '2026-09-06T12:00:00Z'],
    ['tasks', 'update', 'tsk_1', '--data', '{"completedAt":null}'], ['tasks', 'search', 'proposal'],
  ]) {
    const result = await run(argv);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.calls.length, 0);
  }
});

test('interaction reads and deletion carry the entity query and the required route', async () => {
  for (const [action, path, method] of [
    ['past', '/v1/interactions/past', 'GET'], ['list', '/v1/interactions/past', 'GET'],
    ['upcoming', '/v1/interactions/upcoming', 'GET'], ['get', '/v1/interactions/lit_1', 'GET'],
    ['delete', '/v1/interactions/lit_1', 'DELETE'],
  ]) {
    const args = ['get', 'delete'].includes(action) ? ['lit_1'] : [];
    const request = await preview(['interactions', action, ...args, '--entity-id', 'per_1']);
    assert.equal(request.method, method);
    assert.equal(request.url.pathname, path);
    assert.equal(request.url.searchParams.get('entity.id'), 'per_1');
    assert.equal(request.body, undefined);
  }
  const raw = await preview(['interactions', 'get', 'lit_1', '--param', 'entity.id=per_1']);
  assert.equal(raw.url.searchParams.get('entity.id'), 'per_1');
});

test('interaction history and editing refuse missing IDs without contacting Folk', async () => {
  for (const argv of [
    ['interactions', 'past'], ['interactions', 'upcoming'], ['interactions', 'get', 'lit_1'],
    ['interactions', 'delete', 'lit_1', '--yes'], ['interactions', 'update', 'lit_1', '--title', 'Call'],
    ['interactions', 'get', '--entity-id', 'per_1'],
  ]) {
    const result = await run(argv);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.calls.length, 0);
  }
});

test('logged interactions use activityType and send entity in the PATCH body', async () => {
  const created = await preview(['interactions', 'create', '--type', 'coffee', '--activity-type', 'call']);
  assert.deepEqual(created.body, { activityType: 'call' });
  const legacy = await preview(['interactions', 'create', '--type', '☕️']);
  assert.deepEqual(legacy.body, { activityType: '☕️' });
  const updated = await preview(['interactions', 'update', 'lit_1', '--entity-id', 'per_1', '--activity-type', 'meeting', '--title', 'Revised meeting']);
  assert.equal(updated.method, 'PATCH');
  assert.equal(updated.url.search, '');
  assert.deepEqual(updated.body, { title: 'Revised meeting', activityType: 'meeting', entity: { id: 'per_1' } });
  const raw = await preview(['interactions', 'update', 'lit_1', '--data', '{"entity":{"id":"com_1"},"content":"Updated notes"}']);
  assert.equal(raw.body.entity.id, 'com_1');
});

test('notes full-text search uses query and ISO date parameters instead of name filters', async () => {
  const request = await preview(['notes', 'search', 'contract', 'renewal', '--entity-id', 'per_1', '--created-after', '2026-08-01T00:00:00Z', '--created-before', '2026-09-01T00:00:00Z', '--limit', '50']);
  assert.deepEqual(Object.fromEntries(request.url.searchParams), {
    limit: '50', query: 'contract renewal', 'entity.id': 'per_1', createdAfter: '2026-08-01T00:00:00Z', createdBefore: '2026-09-01T00:00:00Z',
  });
  const list = await preview(['notes', 'list', '--query', 'pricing']);
  assert.equal(list.url.searchParams.get('query'), 'pricing');
});

test('groups can be created, updated, and filtered by visibility', async () => {
  const created = await preview(['groups', 'create', '--name', 'Partners', '--visibility', 'private']);
  assert.equal(created.url.pathname, '/v1/groups');
  assert.equal(created.method, 'POST');
  assert.deepEqual(created.body, { name: 'Partners', visibility: 'private' });
  const updated = await preview(['groups', 'update', 'grp_1', '--name', 'Partner pipeline']);
  assert.equal(updated.url.pathname, '/v1/groups/grp_1');
  assert.equal(updated.method, 'PATCH');
  assert.deepEqual(updated.body, { name: 'Partner pipeline' });
  const listed = await preview(['groups', 'list', '--visibility', 'private']);
  assert.equal(listed.url.searchParams.get('visibility'), 'private');
});

test('group visibility filters retrieved pages when the server ignores the parameter', async () => {
  for (const all of [false, true]) {
    let page = 0;
    const result = await run(['groups', 'list', '--visibility', 'private', '--json', ...(all ? ['--all'] : [])], {
      fetchImpl: async url => {
        page += 1;
        const next = new URL(url);
        next.searchParams.set('cursor', 'page2');
        return Response.json({ data: {
          items: page === 1 ? [{ id: 'grp_public', visibility: 'public' }] : [{ id: 'grp_private', visibility: 'private' }],
          pagination: { nextLink: page === 1 ? next.href : null },
        } });
      },
    });
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.data.data.items, all ? [{ id: 'grp_private', visibility: 'private' }] : []);
    assert.equal(payload.clientFilter.visibility, 'private');
    if (all) {
      assert.equal(payload.data.data.itemCount, 1);
      assert.equal(payload.data.data.pageCount, 2);
    } else assert.ok(payload.data.data.pagination.nextLink);
  }
  const invalid = await run(['groups', 'list', '--visibility', 'unknown']);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.calls.length, 0);
  const malformed = await run(['groups', 'list', '--visibility', 'private'], { fetchImpl: async () => Response.json({ data: {} }) });
  assert.equal(malformed.code, 1);
  assert.equal(malformed.stdout, '');
});

test('group custom field discovery keeps the original syntax and supports explicit actions', async () => {
  for (const argv of [
    ['groups', 'fields', 'grp_1', 'person'], ['groups', 'fields', 'list', 'grp_1', 'person'],
    ['groups', 'custom-fields', '--group-id', 'grp_1', '--entity-type', 'person'],
    ['groups', 'fields', 'list', '--group-id', 'grp_1', 'person'],
  ]) {
    const request = await preview(argv);
    assert.equal(request.url.pathname, '/v1/groups/grp_1/custom-fields/person');
    assert.equal(request.method, 'GET');
  }
  const fetched = await preview(['groups', 'fields', 'get', 'grp_1', 'Projects / Deals', 'Sales Stage']);
  assert.equal(fetched.url.pathname, '/v1/groups/grp_1/custom-fields/Projects%20%2F%20Deals/Sales%20Stage');
  const created = await preview(['groups', 'fields', 'create', 'grp_1', 'person', '--name', 'Stage', '--type', 'singleSelect', '--data', '{"options":[{"label":"Lead","color":"#5738ff"}]}']);
  assert.equal(created.method, 'POST');
  assert.deepEqual(created.body, { name: 'Stage', type: 'singleSelect', options: [{ label: 'Lead', color: '#5738ff' }] });
  const updated = await preview(['groups', 'fields', 'update', '--group-id', 'grp_1', '--entity-type', 'person', '--custom-field-name', 'Stage', '--data', '{"updateOptions":[{"id":"gpco_1","label":"Qualified"}]}']);
  assert.equal(updated.method, 'PATCH');
  assert.equal(updated.url.pathname, '/v1/groups/grp_1/custom-fields/person/Stage');
  assert.deepEqual(updated.body.updateOptions, [{ id: 'gpco_1', label: 'Qualified' }]);
});

test('group members use id in the add body, role in updates, and userId in removal paths', async () => {
  const list = await preview(['groups', 'members', 'list', 'grp_1', '--limit', '10']);
  assert.equal(list.url.pathname, '/v1/groups/grp_1/members');
  assert.equal(list.url.searchParams.get('limit'), '10');
  const add = await preview(['groups', 'members', 'add', 'grp_1', 'usr_1', '--role', 'reader']);
  assert.equal(add.method, 'POST');
  assert.equal(add.url.pathname, '/v1/groups/grp_1/members');
  assert.deepEqual(add.body, { id: 'usr_1', role: 'reader' });
  const raw = await preview(['groups', 'members', 'add', 'grp_1', '--data', '{"id":"usr_1","role":"reader"}']);
  assert.deepEqual(raw.body, add.body);
  const update = await preview(['groups', 'members', 'update', '--group-id', 'grp_1', '--user-id', 'usr_1', '--role', 'contributor']);
  assert.equal(update.method, 'PATCH');
  assert.equal(update.url.pathname, '/v1/groups/grp_1/members/usr_1');
  assert.deepEqual(update.body, { role: 'contributor' });
  const remove = await preview(['groups', 'members', 'remove', 'grp_1', 'usr_1']);
  assert.equal(remove.method, 'DELETE');
  assert.equal(remove.url.pathname, '/v1/groups/grp_1/members/usr_1');
});

test('object and deal paths preserve positional and mixed flag forms, with full search terms', async () => {
  for (const resource of ['objects', 'deals']) {
    for (const argv of [
      [resource, 'search', 'Alpha', 'renewal', '--group-id', 'grp_1', '--object-type', 'Projects'],
      [resource, 'search', 'grp_1', 'Projects', 'Alpha', 'renewal'],
      [resource, 'search', '--group-id', 'grp_1', 'Projects', 'Alpha', 'renewal'],
    ]) {
      const request = await preview(argv);
      assert.equal(request.url.pathname, '/v1/groups/grp_1/Projects');
      assert.equal(request.url.searchParams.get('filter[name][like]'), 'Alpha renewal');
    }
    const request = await preview([resource, 'get', '--id', 'obj_1', 'grp_1', 'Service Projects']);
    assert.equal(request.url.pathname, '/v1/groups/grp_1/Service%20Projects/obj_1');
  }
  const create = await preview(['objects', 'create', 'grp_1', 'Projects', '--name', 'Implementation', '--person-id', 'per_1', '--custom', 'Status=Active']);
  assert.equal(create.method, 'POST');
  assert.deepEqual(create.body, { name: 'Implementation', people: [{ id: 'per_1' }], customFieldValues: { Status: 'Active' } });
});

test('all new destructive commands require confirmation, including field option data removal', async () => {
  for (const argv of [
    ['tasks', 'delete', 'tsk_1'], ['objects', 'delete', 'obj_1', 'grp_1', 'Projects'],
    ['interactions', 'delete', 'lit_1', '--entity-id', 'per_1'],
    ['groups', 'members', 'remove', 'grp_1', 'usr_1'],
    ['groups', 'fields', 'update', 'grp_1', 'person', 'Stage', '--data', '{"removeOptions":["gpco_1"]}'],
  ]) {
    const refused = await run([...argv, '--no-input', '--yes=false', '--json']);
    assert.equal(refused.code, 3, refused.stderr);
    assert.equal(refused.calls.length, 0);
    assert.equal(refused.stdout, '');
    await preview(argv);
    const confirmed = await run([...argv, '--yes', '--json'], { fetchImpl: async () => new Response(null, { status: 204 }) });
    assert.equal(confirmed.code, 0, confirmed.stderr);
    assert.equal(confirmed.calls.length, 1);
  }
});

test('invalid group operations fail with input errors before network access', async () => {
  for (const argv of [
    ['groups', 'update'], ['groups', 'fields', 'get', 'grp_1', 'person'],
    ['groups', 'fields', 'delete', 'grp_1', 'person', 'Stage'],
    ['groups', 'fields', 'update', 'grp_1', 'person', 'Stage', '--type', 'textField'],
    ['groups', 'members', 'add', 'grp_1', '--role', 'reader'],
    ['groups', 'members', 'update', 'grp_1', 'usr_1'],
    ['groups', 'members', 'remove', 'grp_1', '--yes'],
  ]) {
    const result = await run(argv);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.calls.length, 0);
  }
});

test('new list commands follow all pages and keep machine output usable', async () => {
  for (const argv of [
    ['tasks', 'list'], ['interactions', 'past', '--entity-id', 'per_1'], ['interactions', 'upcoming', '--entity-id', 'per_1'],
    ['groups', 'members', 'list', 'grp_1'], ['groups', 'fields', 'list', 'grp_1', 'person'],
    ['objects', 'list', 'grp_1', 'Projects'], ['notes', 'search', 'renewal'],
  ]) {
    let page = 0;
    const result = await run([...argv, '--all', '--ndjson'], {
      fetchImpl: async url => {
        page += 1;
        const next = new URL(url);
        next.searchParams.set('cursor', 'page2');
        return Response.json({ data: { items: [{ id: `item_${page}` }], pagination: { nextLink: page === 1 ? next.href : null } } });
      },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.calls.length, 2);
    assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse), [{ id: 'item_1' }, { id: 'item_2' }]);
  }
});

test('reminders keep legacy routes and warn only on stderr, with metadata and quiet support', async () => {
  const request = await preview(['reminders', 'list', '--entity-id', 'per_1']);
  assert.equal(request.url.pathname, '/v1/reminders');
  assert.equal(request.url.searchParams.get('entity.id'), 'per_1');
  assert.match(request.stderr, /deprecated.*tasks/i);
  const quiet = await preview(['reminders', 'list', '--quiet']);
  assert.equal(quiet.stderr, '');
  const spec = await run(['api', 'spec', 'reminders.list']);
  assert.equal(JSON.parse(spec.stdout).data.deprecated, true);
  const beta = await run(['api', 'spec', 'interactions.get']);
  assert.equal(JSON.parse(beta.stdout).data.beta, true);
  assert.deepEqual(JSON.parse(beta.stdout).data.requiredQuery, ['entity.id']);
  const live = await run(['reminders', 'list', '--json'], { fetchImpl: async () => Response.json({ data: { items: [] }, deprecations: ['Use tasks'] }, { headers: { Deprecation: 'Thu, 13 Aug 2026 00:00:00 GMT', Sunset: 'Sat, 13 Feb 2027 00:00:00 GMT' } }) });
  assert.equal(live.code, 0);
  const payload = JSON.parse(live.stdout);
  assert.equal(payload.response.sunset, 'Sat, 13 Feb 2027 00:00:00 GMT');
  assert.equal(payload.response.deprecation, 'Thu, 13 Aug 2026 00:00:00 GMT');
  assert.deepEqual(payload.data.deprecations, ['Use tasks']);
});

test('MCP commands work without REST config and contain no API credentials', async () => {
  const env = { FOLKCTL_CONFIG: '/dev/null/not-a-config', FOLK_API_BASE_URL: 'https://unrelated.example', FOLK_API_KEY: 'fk_do_not_include' };
  const info = await run(['mcp', 'info', '--json'], { env });
  assert.equal(info.code, 0, info.stderr);
  assert.equal(info.calls.length, 0);
  assert.equal(JSON.parse(info.stdout).data.url, 'https://mcp.folk.app/mcp');
  assert.ok(!info.stdout.includes('fk_do_not_include'));
  for (const [client, expected] of [
    ['generic', { mcpServers: { folk: { url: 'https://mcp.folk.app/mcp' } } }],
    ['cursor', { mcpServers: { folk: { url: 'https://mcp.folk.app/mcp' } } }],
    ['vscode', { servers: { folk: { type: 'http', url: 'https://mcp.folk.app/mcp' } } }],
    ['windsurf', { mcpServers: { folk: { serverUrl: 'https://mcp.folk.app/mcp' } } }],
  ]) {
    const config = await run(['mcp', 'config', client], { env });
    assert.equal(config.code, 0, config.stderr);
    assert.deepEqual(JSON.parse(config.stdout), expected);
    assert.equal(config.calls.length, 0);
  }
  const codex = await run(['mcp', 'config', 'codex'], { env });
  assert.equal(codex.stdout, '[mcp_servers.folk]\nurl = "https://mcp.folk.app/mcp"\n');
  const claude = await run(['mcp', 'config', 'claude', '--json'], { env });
  assert.equal(JSON.parse(claude.stdout).data.content, 'claude mcp add --transport http folk https://mcp.folk.app/mcp');
  const invalid = await run(['mcp', 'config', 'unknown'], { env });
  assert.equal(invalid.code, 2);
});

test('version output, help, User-Agent, and new resource help stay in sync', async () => {
  const result = await run(['--version']);
  assert.equal(result.stdout.trim(), VERSION);
  const request = await preview(['tasks', 'list']);
  assert.equal(request.headers['User-Agent'], `folkctl/${VERSION}`);
  for (const resource of ['tasks', 'interactions', 'objects', 'groups', 'mcp']) {
    const help = await run([resource, '--help']);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, new RegExp(`folkctl ${resource}`));
    assert.equal(help.calls.length, 0);
  }
  const person = await preview(['people', 'update', 'per_1', '--gender', 'Other', '--field', 'birthday=null']);
  assert.equal(person.body.gender, 'Other');
  assert.equal(person.body.birthday, null);
});
