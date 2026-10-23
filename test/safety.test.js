import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { parseFlagArgs, flagBoolean } from '../src/args.js';
import { preview, run } from './helpers.js';

const ok = async () => Response.json({ data: { results: [{ status: 'succeeded', data: { id: 'per_1' } }] } });

test('api request applies the wrapper confirmations to every spelling of a guarded route', async () => {
  const enrichment = '{"fields":["emails"],"ids":["per_1"]}';
  for (const path of [
    '/v1/person-enrichments', 'v1/person-enrichments', '/v1/./person-enrichments', '/v1/%2e/person-enrichments',
    '/v1/person-enrichments#', '/V1/PERSON-ENRICHMENTS/', '//v1//person-enrichments', '/v1/x/../person-enrichments',
    '/v1/person%2Denrichments', 'https://api.folk.app/v1/person-enrichments?source=cli',
  ]) {
    const result = await run(['api', 'request', 'POST', path, '--data', enrichment], { fetchImpl: ok });
    assert.equal(result.code, 3, `${path}: ${result.stderr}`);
    assert.match(result.stderr, /Refusing to spend enrichment credits/, path);
    assert.equal(result.calls.length, 0, path);
  }
  for (const path of ['/v1/people/batch/delete', '/v1/people/batch/./delete', '/v1/people/batch/delete#x', '/v1/groups/grp_1/Deals/batch/delete', '/v1/notes/batch/delete']) {
    const result = await run(['api', 'request', 'POST', path, '--data', '{"records":[{"id":"per_1"}]}'], { fetchImpl: ok });
    assert.equal(result.code, 3, `${path}: ${result.stderr}`);
    assert.match(result.stderr, /Refusing to delete/, path);
    assert.equal(result.calls.length, 0, path);
  }
  const groups = await run(['api', 'request', 'POST', '/v1/companies/batch/update', '--data', '{"records":[{"id":"com_1","groups":[{"id":"grp_1"}]}]}'], { fetchImpl: ok });
  assert.equal(groups.code, 3);
  assert.match(groups.stderr, /Refusing to replace the groups of 1 records/);
  const options = await run(['api', 'request', 'PATCH', '/v1/groups/grp_1/custom-fields/Projects%20%2F%20Deals/Stage', '--data', '{"removeOptions":["gpco_1"]}'], { fetchImpl: ok });
  assert.equal(options.code, 3);
  assert.match(options.stderr, /Refusing to delete options and their associated data/);
  for (const argv of [
    ['api', 'request', 'POST', '/v1/people/batch/update', '--data', '{"records":[{"id":"per_1","jobTitle":"CEO"}]}'],
    ['api', 'request', 'GET', '/v1/person-enrichments'],
    ['api', 'request', 'PATCH', '/v1/groups/grp_1/custom-fields/person/Stage', '--data', '{"addOptions":[{"label":"Won"}]}'],
  ]) {
    const allowed = await run([...argv, '--json'], { fetchImpl: ok });
    assert.equal(allowed.code, 0, `${argv.join(' ')}: ${allowed.stderr}`);
    assert.equal(allowed.calls.length, 1);
  }
  // A base URL with a path, as a proxy may use, still matches the catalog after that path.
  for (const [argv, refusal] of [
    [['api', 'request', 'POST', '/v1/person-enrichments', '--data', enrichment], /Refusing to spend enrichment credits/],
    [['api', 'request', 'POST', 'https://proxy.example/folk/v1/companies/batch/update', '--data', '{"records":[{"id":"com_1","groups":[]}]}'], /Refusing to replace the groups/],
    [['api', 'request', 'PATCH', '/v1/groups/grp_1/custom-fields/person/Stage', '--data', '{"removeOptions":["gpco_1"]}'], /Refusing to delete options/],
    [['api', 'request', 'POST', '/v1/people/batch/delete', '--data', '{"records":[{"id":"per_1"}]}'], /Refusing to delete/],
  ]) {
    const proxied = await run([...argv, '--base-url', 'https://proxy.example/folk/'], { fetchImpl: ok });
    assert.equal(proxied.code, 3, `${argv.join(' ')}: ${proxied.stderr}`);
    assert.match(proxied.stderr, refusal);
    assert.equal(proxied.calls.length, 0);
  }
  const single = await run(['api', 'request', 'PATCH', '/v1/people/per_1', '--data', '{"groups":[]}', '--json'], { fetchImpl: async () => Response.json({ data: {} }) });
  assert.equal(single.code, 0);
  assert.match(single.stderr, /Warning: groups replaces the groups of this record/);
});

test('a separated true/false word belongs to the boolean flag before it', async () => {
  const { flags, positionals } = parseFlagArgs(['people', 'delete', 'per_1', '--yes', 'false', '--json', 'TRUE', '-y', 'no']);
  assert.deepEqual(positionals, ['people', 'delete', 'per_1']);
  assert.equal(flagBoolean(flags, 'yes'), false);
  assert.equal(flagBoolean(flags, 'json'), true);
  const kept = parseFlagArgs(['people', 'delete', '--yes', 'per_1', '--dry-run', '--', 'false']);
  assert.deepEqual(kept.positionals, ['people', 'delete', 'per_1', 'false']);
  assert.equal(flagBoolean(kept.flags, 'yes'), true);
  for (const argv of [['people', 'delete', 'per_1', '--yes', 'false'], ['people', 'delete', 'per_1', '-y', 'off'], ['people', 'batch', 'delete', 'per_1', '--force', 'no']]) {
    const refused = await run(argv, { fetchImpl: ok });
    assert.equal(refused.code, 3, `${argv.join(' ')}: ${refused.stderr}`);
    assert.equal(refused.calls.length, 0);
  }
  const batch = await preview(['people', 'batch', 'delete', 'per_1', '--yes', 'false']);
  assert.deepEqual(batch.body.records, [{ id: 'per_1' }]);
  const confirmed = await run(['people', 'delete', 'per_1', '--yes', 'true', '--json'], { fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(confirmed.code, 0, confirmed.stderr);
  assert.equal(confirmed.calls.length, 1);
});

test('--no-flag=value and --no-retries mean what they say', async () => {
  const failing = async () => Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } }, { status: 503 });
  for (const [flags, calls] of [
    [['--no-retry=true'], 1], [['--no-retries'], 1], [['--no-retry=false'], 4], [['--no-retries=false'], 4],
    [['--retries', '1'], 2], [['--retries', '1', '--no-retries'], 1],
  ]) {
    const result = await run(['users', 'me', ...flags], { fetchImpl: failing, retries: true });
    assert.equal(result.code, 1, flags.join(' '));
    assert.equal(result.calls.length, calls, flags.join(' '));
  }
  const invalid = await run(['people', 'delete', 'per_1', '--no-yes=maybe']);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Invalid --no-yes=maybe/);
  // Negating a value flag falls back to its default instead of failing.
  const waited = await run(['enrichments', 'get', 'enr_1', '--wait', '--no-wait-timeout', '--no-wait-interval'], {
    fetchImpl: async (url, init, call) => Response.json({ data: { id: 'enr_1', status: call === 1 ? 'pending' : 'completed', fields: ['emails'], summary: null, items: null } }),
  });
  assert.equal(waited.code, 0, waited.stderr);
  assert.deepEqual(waited.sleeps, [5000]);
});

// Node's readline question never settles on end of input, so a regression would hang: fail it quickly.
test('a confirmation prompt whose input ends cancels instead of waiting', { timeout: 5000 }, async () => {
  const ended = Object.assign(Readable.from([]), { isTTY: true });
  const result = await run(['people', 'delete', 'per_1'], { stdin: ended, fetchImpl: ok });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /Delete cancelled\./);
  assert.equal(result.calls.length, 0);
});

test('flag-built bodies refuse keys that reach Object.prototype', async () => {
  for (const argv of [
    ['people', 'create', '--field', '__proto__.polluted=1'],
    ['people', 'update', 'per_1', '--field', 'customFieldValues.constructor.prototype.polluted=1'],
    ['people', 'create', '--custom', '__proto__.polluted=1'],
    ['people', 'create', '--custom', 'grp_1.__proto__=1'],
    ['deals', 'create', '--group-id', 'grp_1', '--object-type', 'Deals', '--custom', '__proto__=1'],
  ]) {
    const result = await run([...argv, '--dry-run']);
    assert.equal(result.code, 2, `${argv.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /Invalid key/);
  }
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.polluted, undefined);
});

test('batch updates warn when list fields replace existing values, and --id splits on commas', async () => {
  const update = await preview(['people', 'batch', 'update', 'per_1', '--id', 'per_2,per_3', '--email', 'team@example.com']);
  assert.deepEqual(update.body.records.map(record => record.id), ['per_1', 'per_2', 'per_3']);
  assert.match(update.stderr, /Warning: On update, emails replaces each record's existing values/);
  const objects = await preview(['objects', 'batch', 'update', 'obj_1', '--group-id', 'grp_1', '--object-type', 'Projects', '--person-id', 'per_1', '--company-id', 'com_1']);
  assert.match(objects.stderr, /On update, people, companies replace each record's existing values/);
  const create = await preview(['people', 'batch', 'create', '--data', '[{"firstName":"Ada"}]', '--email', 'ada@example.com']);
  assert.equal(create.stderr, '');
  const remove = await preview(['companies', 'batch', 'delete', 'com_1,com_2']);
  assert.deepEqual(remove.body.records, [{ id: 'com_1' }, { id: 'com_2' }]);
});
