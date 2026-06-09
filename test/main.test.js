import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { main } from '../src/main.js';

function memoryStream() {
  let data = '';
  return {
    stream: new Writable({
      write(chunk, _enc, cb) { data += chunk.toString(); cb(); },
    }),
    get data() { return data; },
  };
}

test('people list dry-run prints request as JSON without requiring token', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await main({
    argv: ['people', 'list', '--dry-run', '--json', '--pretty', '--limit', '5', '--filter', 'fullName:like:Justin'],
    env: { HOME: '/tmp/folkctl-test-home' },
    cwd: '/tmp/folkctl-test-empty',
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(code, 0, stderr.data);
  const parsed = JSON.parse(stdout.data);
  assert.equal(parsed.request.method, 'GET');
  assert.match(parsed.request.url, /\/v1\/people/);
  assert.match(parsed.request.url, /limit=5/);
  assert.match(parsed.request.url, /filter%5BfullName%5D%5Blike%5D=Justin/);
});

test('missing flag values return a formatted CLI error', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await main({
    argv: ['people', 'create', '--email', '--group-id', 'grp_123', '--dry-run'],
    env: { HOME: '/tmp/folkctl-test-home' },
    cwd: '/tmp/folkctl-test-empty',
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(code, 2);
  assert.equal(stdout.data, '');
  assert.match(stderr.data, /Missing value for --email/);
});

test('api docs reports endpoint metadata', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await main({ argv: ['api', 'docs', 'people.create'], env: {}, cwd: '/tmp/folkctl-test-empty', stdin: Readable.from([]), stdout: stdout.stream, stderr: stderr.stream });
  assert.equal(code, 0, stderr.data);
  assert.match(stdout.data, /POST \/v1\/people/);
});

test('delete refuses non-interactive requests without --yes', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await main({ argv: ['people', 'delete', 'per_123', '--dry-run'], env: {}, cwd: '/tmp/folkctl-test-empty', stdin: Readable.from([]), stdout: stdout.stream, stderr: stderr.stream });
  assert.equal(code, 0, stderr.data);
  assert.match(stdout.data, /DELETE .*\/v1\/people\/per_123/);
});

test('api request delete refuses non-interactive requests without confirmation', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  let fetchCalled = false;
  const code = await main({
    argv: ['api', 'request', 'DELETE', '/v1/people/per_123', '--json'],
    env: { HOME: '/tmp/folkctl-test-home', FOLK_API_KEY: 'fk_test_secret' },
    cwd: '/tmp/folkctl-test-empty',
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(code, 3);
  assert.equal(fetchCalled, false);
  assert.match(stderr.data, /Refusing to delete DELETE \/v1\/people\/per_123 without confirmation/);
});

test('explicit false confirmation flags do not bypass delete confirmation', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  let fetchCalled = false;
  const code = await main({
    argv: ['people', 'delete', 'per_123', '--yes=false', '--json'],
    env: { HOME: '/tmp/folkctl-test-home', FOLK_API_KEY: 'fk_test_secret' },
    cwd: '/tmp/folkctl-test-empty',
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(code, 3);
  assert.equal(fetchCalled, false);
  assert.match(stderr.data, /Refusing to delete people per_123 without confirmation/);
});

test('auth login requires token stdin to avoid echoing secrets', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await main({
    argv: ['auth', 'login'],
    env: { HOME: '/tmp/folkctl-test-home' },
    cwd: '/tmp/folkctl-test-empty',
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(code, 2);
  assert.match(stderr.data, /auth login requires --token-stdin/);
});

test('auth status reads FOLK_API_KEY from cwd .env.local', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folkctl-env-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, '.env.local'), 'FOLK_API_KEY=fk_test_local_secret\n');

  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await main({
    argv: ['auth', 'status', '--json'],
    env: { HOME: dir },
    cwd: dir,
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(code, 0, stderr.data);
  const parsed = JSON.parse(stdout.data);
  assert.equal(parsed.data.authenticated, true);
  assert.equal(parsed.data.tokenSource, '.env.local:FOLK_API_KEY');
  assert.notEqual(parsed.data.token, 'fk_test_local_secret');
});
