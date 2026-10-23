import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { preview, run, stdinText, tty } from './helpers.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function batchResponse(results) {
  return async () => Response.json({ data: { results } });
}

test('batch create reads a JSON array, a records object, NDJSON, or one object, and applies flags to every record', async (t) => {
  const array = await preview(['people', 'batch', 'create', '--data', '[{"firstName":"Ada"},{"firstName":"Grace","groups":[{"id":"grp_0"}]}]', '--group-id', 'grp_1']);
  assert.equal(array.method, 'POST');
  assert.equal(array.url.pathname, '/v1/people/batch/create');
  assert.match(array.headers['Idempotency-Key'], UUID_V4);
  assert.deepEqual(array.body, { records: [
    { firstName: 'Ada', groups: [{ id: 'grp_1' }] },
    { firstName: 'Grace', groups: [{ id: 'grp_0' }, { id: 'grp_1' }] },
  ] });
  const wrapped = await preview(['companies', 'batch', 'create', '--data', '{"records":[{"name":"Acme"}]}', '--industry', 'Fintech']);
  assert.equal(wrapped.url.pathname, '/v1/companies/batch/create');
  assert.deepEqual(wrapped.body, { records: [{ name: 'Acme', industry: 'Fintech' }] });
  const single = await preview(['companies', 'batch', 'create', '--data', '{"name":"Globex"}']);
  assert.deepEqual(single.body, { records: [{ name: 'Globex' }] });

  const ndjson = await run(['companies', 'batch', 'create', '--data', '-', '--dry-run', '--json'], { stdin: stdinText('{"name":"Acme"}\n\n{"name":"Globex","urls":["https://globex.example"]}\n') });
  assert.equal(ndjson.code, 0, ndjson.stderr);
  assert.deepEqual(JSON.parse(ndjson.stdout).request.body.records.map(record => record.name), ['Acme', 'Globex']);
  // Files exported with a byte-order mark parse too, as JSON and as NDJSON.
  for (const text of ['﻿{"name":"Acme"}\n{"name":"Globex"}\n', '﻿[{"name":"Acme"},{"name":"Globex"}]']) {
    const bom = await run(['companies', 'batch', 'create', '--data', '-', '--dry-run', '--json'], { stdin: stdinText(text) });
    assert.equal(bom.code, 0, bom.stderr);
    assert.equal(JSON.parse(bom.stdout).request.body.records.length, 2);
  }

  const dir = await mkdtemp(join(tmpdir(), 'folkctl-batch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'people.ndjson'), '{"firstName":"Ada","customFieldValues":{"grp_1":{"Status":"Lead"}}}\n{"firstName":"Grace"}\n');
  const file = await preview(['people', 'batch', 'create', '--data', `@${join(dir, 'people.ndjson')}`, '--custom', 'grp_1.Source=Import']);
  assert.deepEqual(file.body.records, [
    { firstName: 'Ada', customFieldValues: { grp_1: { Status: 'Lead', Source: 'Import' } } },
    { firstName: 'Grace', customFieldValues: { grp_1: { Source: 'Import' } } },
  ]);
});

test('batch update applies one change to each ID, or reads records with IDs from --data', async () => {
  const sameChange = await preview(['companies', 'batch', 'update', 'com_1', 'com_2', '--industry', 'Fintech', '--field', 'employeeRange=11-50']);
  assert.equal(sameChange.url.pathname, '/v1/companies/batch/update');
  assert.deepEqual(sameChange.body.records, [
    { id: 'com_1', employeeRange: '11-50', industry: 'Fintech' },
    { id: 'com_2', employeeRange: '11-50', industry: 'Fintech' },
  ]);
  const template = await preview(['people', 'batch', 'update', 'per_1', '--id', 'per_2', '--data', '{"id":"ignored","jobTitle":"Partner"}']);
  assert.deepEqual(template.body.records, [{ id: 'per_1', jobTitle: 'Partner' }, { id: 'per_2', jobTitle: 'Partner' }]);
  const records = await preview(['people', 'batch', 'update', '--data', '[{"id":"per_1","jobTitle":"CEO"},{"id":"per_2","lastName":"Hopper"}]']);
  assert.deepEqual(records.body.records, [{ id: 'per_1', jobTitle: 'CEO' }, { id: 'per_2', lastName: 'Hopper' }]);
  for (const [argv, message] of [
    [['people', 'batch', 'update', 'per_1', '--data', '[{"id":"per_2"}]'], /not both/],
    [['people', 'batch', 'update', 'per_1', 'per_2'], /at least one field/],
    [['people', 'batch', 'update', '--data', '[{"id":"per_1","jobTitle":"CEO"},{"jobTitle":"CTO"}]'], /records\[1\] needs a string id/],
    [['people', 'batch', 'create', 'per_1', '--data', '[{"firstName":"Ada"}]'], /reads records from --data/],
  ]) {
    const result = await run(argv);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(result.calls.length, 0);
  }
});

test('batch delete takes IDs from arguments, --id, and --data, and sends only each id', async () => {
  const request = await preview(['people', 'batch', 'delete', 'per_1', 'per_2', '--id', 'per_3', '--data', '["per_4",{"id":"per_5","fullName":"Ada Lovelace","emails":["ada@example.com"]}]']);
  assert.equal(request.url.pathname, '/v1/people/batch/delete');
  assert.deepEqual(request.body.records, ['per_4', 'per_5', 'per_1', 'per_2', 'per_3'].map(id => ({ id })));
  const ndjson = await run(['companies', 'batch', 'rm', '--data', '-', '--dry-run', '--json'], { stdin: stdinText('{"id":"com_1","name":"Acme"}\n{"id":"com_2","name":"Globex"}\n') });
  assert.equal(ndjson.code, 0, ndjson.stderr);
  assert.deepEqual(JSON.parse(ndjson.stdout).request.body, { records: [{ id: 'com_1' }, { id: 'com_2' }] });
});

test('batch input limits fail before any request', async () => {
  const tooMany = JSON.stringify(Array.from({ length: 101 }, (_, index) => ({ id: `per_${index}` })));
  for (const [argv, message, stdin] of [
    [['people', 'batch', 'update', '--data', tooMany], /at most 100 records; got 101/],
    [['people', 'batch', 'delete', ...Array.from({ length: 101 }, (_, index) => `per_${index}`), '--yes'], /at most 100 records/],
    [['people', 'batch', 'create', '--data', '[]'], /needs at least one record/],
    [['people', 'batch', 'create', '--data', '-'], /needs at least one record/, stdinText('  \n')],
    [['people', 'batch', 'delete', '--yes'], /needs at least one record/],
    [['people', 'batch', 'create', '--data', '[{"firstName":"Ada"}, 42]'], /records\[1\] must be a JSON object/],
    [['people', 'batch', 'create', '--data', '{"firstName":'], /Invalid JSON or NDJSON/],
    [['people', 'batch', 'archive', '--data', '[]'], /Use batch create, batch update, or batch delete/],
    [['notes', 'batch', 'create', '--data', '[{}]'], /no batch endpoints/],
    [['deals', 'batch', 'create', '--group-id', 'grp_1', '--data', '[{"name":"A"}]'], /--object-type/],
  ]) {
    const result = await run(argv, { stdin });
    assert.equal(result.code, 2, `${argv.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, message);
    assert.equal(result.calls.length, 0);
  }
});

test('batch deletes and group replacements need confirmation; other batch writes do not', async () => {
  // One succeeded result per record sent, as Folk answers.
  const ok = async (url, init) => Response.json({ data: { results: JSON.parse(init.body).records.map(record => ({ status: 'succeeded', data: { id: record.id ?? 'new_1' } })) } });
  for (const [argv, refusal] of [
    [['people', 'batch', 'delete', 'per_1'], /Refusing to delete 1 person without confirmation/],
    [['companies', 'batch', 'delete', 'com_1', 'com_2'], /Refusing to delete 2 companies without confirmation/],
    [['deals', 'batch', 'delete', 'grp_1', 'Deals', 'obj_1'], /Refusing to delete 1 object of type Deals without confirmation/],
    [['people', 'batch', 'update', 'per_1', '--group-id', 'grp_1'], /Refusing to replace the groups of 1 person without confirmation/],
    [['companies', 'batch', 'update', '--data', '[{"id":"com_1","groups":[]},{"id":"com_2","name":"Acme"}]'], /Refusing to replace the groups of 1 company/],
  ]) {
    const refused = await run([...argv, '--json']);
    assert.equal(refused.code, 3, refused.stderr);
    assert.match(refused.stderr, refusal);
    assert.equal(refused.calls.length, 0);
    const confirmed = await run([...argv, '--yes', '--json', '--quiet'], { fetchImpl: ok });
    assert.equal(confirmed.code, 0, confirmed.stderr);
    assert.equal(confirmed.calls.length, 1);
  }
  const typed = await run(['companies', 'batch', 'delete', 'com_1', 'com_2', '--json'], { stdin: tty('2'), fetchImpl: ok });
  assert.equal(typed.code, 0, typed.stderr);
  assert.match(typed.stderr, /Delete 2 companies\? Type 2 to confirm/);
  const mistyped = await run(['companies', 'batch', 'delete', 'com_1', 'com_2'], { stdin: tty('yes'), fetchImpl: ok });
  assert.equal(mistyped.code, 3);
  assert.match(mistyped.stderr, /Delete cancelled/);
  assert.equal(mistyped.calls.length, 0);
  for (const argv of [
    ['people', 'batch', 'create', '--data', '[{"firstName":"Ada"}]', '--group-id', 'grp_1'],
    ['objects', 'batch', 'update', 'obj_1', '--group-id', 'grp_1', '--object-type', 'Projects', '--person-id', 'per_1'],
    ['people', 'batch', 'update', 'per_1', '--job-title', 'CEO'],
  ]) {
    const result = await run([...argv, '--json', '--quiet'], { fetchImpl: ok });
    assert.equal(result.code, 0, `${argv.join(' ')}: ${result.stderr}`);
    assert.equal(result.calls.length, 1);
  }
  const raw = await run(['api', 'request', 'POST', '/v1/people/batch/delete', '--data', '{"records":[{"id":"per_1"}]}']);
  assert.equal(raw.code, 3);
  assert.equal(raw.calls.length, 0);
  // A terminal whose input --data - already read to the end cannot answer the prompt, so refuse instead of waiting.
  const consumed = await run(['people', 'batch', 'delete', '--data', '-'], { stdin: tty('["per_1","per_2"]') });
  assert.equal(consumed.code, 3);
  assert.match(consumed.stderr, /Refusing to delete 2 people without confirmation/);
  assert.equal(consumed.calls.length, 0);
});

test('batch results keep request order, summarize on stderr, and exit 5 when a record fails', async () => {
  const mixed = batchResponse([
    { status: 'succeeded', data: { id: 'per_1', fullName: 'Ada Lovelace' }, warnings: ['Could not add the person to group grp_9.'] },
    { status: 'failed', error: { code: 'NOT_FOUND', message: 'Person not found.', documentationUrl: 'https://developer.folk.app/api-reference/errors#not-found' } },
    { status: 'succeeded', data: { id: 'per_3', fullName: 'Grace Hopper' }, removedGroups: [{ id: 'grp_2' }] },
  ]);
  const argv = ['people', 'batch', 'update', '--data', '[{"id":"per_1","jobTitle":"CEO"},{"id":"per_2","jobTitle":"CTO"},{"id":"per_3","jobTitle":"CFO"}]'];
  const table = await run(argv, { fetchImpl: mixed });
  assert.equal(table.code, 5, table.stderr);
  const lines = table.stdout.trim().split('\n');
  assert.match(lines[0], /^index\s+status\s+id\s+name\s+error\s+warnings\s+removedGroups$/);
  assert.match(lines[2], /^0\s+succeeded\s+per_1\s+Ada Lovelace\s+Could not add/);
  assert.match(lines[3], /^1\s+failed\s+NOT_FOUND: Person not found\./);
  assert.match(lines[4], /^2\s+succeeded\s+per_3\s+Grace Hopper\s+grp_2$/);
  assert.equal(table.stderr, 'people batch update: 3 records, 2 succeeded, 1 failed, 1 with warnings.\n');

  const json = await run([...argv, '--json'], { fetchImpl: mixed });
  assert.equal(json.code, 5);
  assert.deepEqual(JSON.parse(json.stdout).batch, { records: 3, succeeded: 2, failed: 1, withWarnings: 1 });
  const plain = await run([...argv, '--plain', '--quiet'], { fetchImpl: mixed });
  assert.equal(plain.stdout, 'per_1\nper_3\n');
  assert.equal(plain.stderr, '');
  const ndjson = await run([...argv, '--ndjson', '--quiet'], { fetchImpl: mixed });
  assert.deepEqual(ndjson.stdout.trim().split('\n').map(line => JSON.parse(line).status), ['succeeded', 'failed', 'succeeded']);
  const csv = await run([...argv, '--csv', '--quiet'], { fetchImpl: mixed });
  assert.equal(csv.stdout.split('\n')[0], 'index,status,id,name,error,warnings,removedGroups');

  const created = await run(['companies', 'batch', 'create', '--data', '[{"name":"Acme"}]'], { fetchImpl: batchResponse([{ status: 'succeeded', operation: 'updated', data: { id: 'com_1', name: 'Acme' } }]) });
  assert.equal(created.code, 0, created.stderr);
  assert.match(created.stdout, /operation[\s\S]*updated/);
  const malformed = await run(['objects', 'batch', 'create', 'grp_1', 'Projects', '--data', '[{"name":"Launch"}]', '--verbose'], { fetchImpl: async () => Response.json({ data: { items: [] } }) });
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /data\.results is missing, so each record's outcome is unknown/);
  assert.ok(malformed.stderr.includes(`idempotencyKey=${malformed.calls[0].headers['Idempotency-Key']}`));
  assert.match(malformed.stderr, /"items": \[\]/);
  // Results map to records by position, so a short (or long) results array leaves every outcome uncertain.
  for (const results of [[{ status: 'succeeded', data: { id: 'per_1' } }], [{ status: 'succeeded' }, { status: 'succeeded' }, { status: 'succeeded' }]]) {
    const mismatch = await run(['people', 'batch', 'update', 'per_1', 'per_2', '--job-title', 'CEO'], { fetchImpl: batchResponse(results) });
    assert.equal(mismatch.code, 1);
    assert.equal(mismatch.stdout, '');
    assert.match(mismatch.stderr, new RegExp(`${results.length} results for 2 records, so each record's outcome is unknown`));
    assert.ok(mismatch.stderr.includes(`idempotencyKey=${mismatch.calls[0].headers['Idempotency-Key']}`));
  }
});

test('object batches carry the group and URL-encoded object type in every form', async () => {
  const create = await preview(['objects', 'batch', 'create', 'grp_1', 'Job Applications', '--data', '[{"name":"Ada"}]', '--person-id', 'per_1']);
  assert.equal(create.url.pathname, '/v1/groups/grp_1/Job%20Applications/batch/create');
  assert.deepEqual(create.body.records, [{ name: 'Ada', people: [{ id: 'per_1' }] }]);
  const update = await preview(['deals', 'batch', 'update', 'obj_1', 'obj_2', '--group-id', 'grp_1', '--object-type', 'Deals', '--custom', 'Status=Closed-won']);
  assert.equal(update.url.pathname, '/v1/groups/grp_1/Deals/batch/update');
  assert.deepEqual(update.body.records, [{ id: 'obj_1', customFieldValues: { Status: 'Closed-won' } }, { id: 'obj_2', customFieldValues: { Status: 'Closed-won' } }]);
  const remove = await preview(['deals', 'batch', 'delete', '--group-id', 'grp_1', 'Deals', 'obj_1']);
  assert.equal(remove.url.pathname, '/v1/groups/grp_1/Deals/batch/delete');
  assert.deepEqual(remove.body.records, [{ id: 'obj_1' }]);
});

test('single updates warn that groups replace the existing groups', async () => {
  for (const resource of ['people', 'companies']) {
    const update = await preview([resource, 'update', 'id_1', '--group-id', 'grp_1']);
    assert.match(update.stderr, /Warning: groups replaces the groups of this (person|company)/);
    const quiet = await preview([resource, 'update', 'id_1', '--group-id', 'grp_1', '--quiet']);
    assert.equal(quiet.stderr, '');
    const create = await preview([resource, 'create', '--group-id', 'grp_1']);
    assert.equal(create.stderr, '');
  }
});

test('batch and credit metadata appear in the endpoint catalog', async () => {
  const docs = await run(['api', 'docs', 'people.batch.delete']);
  assert.match(docs.stdout, /POST \/v1\/people\/batch\/delete/);
  assert.match(docs.stdout, /Batch: up to 100 records/);
  const enrich = await run(['api', 'docs', 'enrichments.create']);
  assert.match(enrich.stdout, /Asynchronous/);
  assert.match(enrich.stdout, /Uses workspace credits/);
  const list = JSON.parse((await run(['api', 'ls', 'companies', '--json'])).stdout).data.items;
  assert.ok(list.some(endpoint => endpoint.key === 'companies.batch.update' && endpoint.batch === true));
});
