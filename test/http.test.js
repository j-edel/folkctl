import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getEffectiveConfig, writeConfig } from '../src/config.js';
import { CliError, FolkApiError, formatError } from '../src/errors.js';
import { parseRateLimitHeaders, requestFolk, throttleDelayMs } from '../src/http.js';

const CONFIG = {
  apiKey: 'fk_test_secret',
  baseUrl: 'https://api.folk.app',
  apiVersion: '2025-06-09',
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Replays a scripted sequence of responses (a status, a Response, or an Error to throw) and records calls.
function scripted(steps) {
  const calls = [];
  const sleeps = [];
  return {
    calls,
    sleeps,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), ...init });
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (step instanceof Error) throw step;
      if (step instanceof Response) return step;
      return Response.json(step >= 400 ? { error: { code: `HTTP_${step}`, message: `status ${step}` } } : { data: { ok: true } }, { status: step });
    },
  };
}

test('rejects absolute request URLs outside the configured folk origin', async () => {
  await assert.rejects(
    requestFolk({
      method: 'GET',
      path: 'https://attacker.example/collect',
      config: CONFIG,
      fetchImpl: async () => new Response('{}', { status: 200 }),
    }),
    /Refusing to send folk credentials to https:\/\/attacker\.example/,
  );
});

test('rejects cross-origin pagination next links before a second request', async () => {
  let calls = 0;
  await assert.rejects(
    requestFolk({
      method: 'GET',
      path: '/v1/people',
      config: CONFIG,
      flags: { all: true },
      paginate: true,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          data: {
            items: [],
            pagination: { nextLink: 'https://attacker.example/next' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    }),
    /Refusing to send folk credentials to https:\/\/attacker\.example/,
  );
  assert.equal(calls, 1);
});

test('writes send a generated Idempotency-Key and reuse it on every retry', async () => {
  const run = scripted([new TypeError('fetch failed'), 503, 200]);
  const result = await requestFolk({ method: 'POST', path: '/v1/companies', body: { name: 'Acme' }, config: CONFIG, fetchImpl: run.fetchImpl, sleep: run.sleep });
  assert.equal(run.calls.length, 3);
  const keys = run.calls.map(call => call.headers['Idempotency-Key']);
  assert.match(keys[0], UUID_V4);
  assert.equal(new Set(keys).size, 1);
  assert.equal(result.request.headers['Idempotency-Key'], keys[0]);
  for (const method of ['PATCH', 'DELETE', 'PUT']) {
    const write = scripted([200]);
    await requestFolk({ method, path: '/v1/people/per_1', config: CONFIG, fetchImpl: write.fetchImpl, sleep: write.sleep });
    assert.match(write.calls[0].headers['Idempotency-Key'], UUID_V4, method);
  }
  const read = scripted([200]);
  await requestFolk({ method: 'GET', path: '/v1/people', config: CONFIG, fetchImpl: read.fetchImpl, flags: { 'idempotency-key': 'ignored-on-reads' } });
  assert.equal(read.calls[0].headers['Idempotency-Key'], undefined);
});

test('explicit idempotency keys are used verbatim, and invalid keys fail before any request', async () => {
  const run = scripted([200]);
  const result = await requestFolk({ method: 'POST', path: '/v1/notes', body: {}, config: CONFIG, flags: { 'idempotency-key': 'import-2026-10-22-batch-1' }, fetchImpl: run.fetchImpl });
  assert.equal(run.calls[0].headers['Idempotency-Key'], 'import-2026-10-22-batch-1');
  assert.equal(result.request.headers['Idempotency-Key'], 'import-2026-10-22-batch-1');
  for (const key of ['', 'has space', 'x'.repeat(256), 'café']) {
    const invalid = scripted([200]);
    await assert.rejects(
      requestFolk({ method: 'POST', path: '/v1/notes', body: {}, config: CONFIG, flags: { 'idempotency-key': key }, fetchImpl: invalid.fetchImpl }),
      (error) => error instanceof CliError && error.exitCode === 2 && /Invalid --idempotency-key/.test(error.message),
    );
    assert.equal(invalid.calls.length, 0, JSON.stringify(key));
  }
  await assert.rejects(
    requestFolk({ method: 'POST', path: '/v1/notes', body: {}, config: CONFIG, flags: { 'idempotency-key': ['abc', false], 'no-idempotency-key': true }, fetchImpl: run.fetchImpl }),
    /not both/,
  );
});

test('writes without a key retry only rate limits, unless --retries opts in', async () => {
  const flags = { 'idempotency-key': false, 'no-idempotency-key': true };
  for (const failure of [new TypeError('fetch failed'), 503, 500]) {
    const run = scripted([failure, 200]);
    await assert.rejects(requestFolk({ method: 'POST', path: '/v1/companies', body: { name: 'Acme' }, config: CONFIG, flags, fetchImpl: run.fetchImpl, sleep: run.sleep }));
    assert.equal(run.calls.length, 1, String(failure));
    assert.equal(run.calls[0].headers['Idempotency-Key'], undefined);
  }
  const limited = scripted([new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }), 200]);
  await requestFolk({ method: 'POST', path: '/v1/companies', body: { name: 'Acme' }, config: CONFIG, flags, fetchImpl: limited.fetchImpl, sleep: limited.sleep });
  assert.equal(limited.calls.length, 2);
  assert.deepEqual(limited.sleeps, [1000]);
  const optedIn = scripted([new TypeError('fetch failed'), 200]);
  await requestFolk({ method: 'POST', path: '/v1/companies', body: { name: 'Acme' }, config: CONFIG, flags: { ...flags, retries: '2' }, fetchImpl: optedIn.fetchImpl, sleep: optedIn.sleep });
  assert.equal(optedIn.calls.length, 2);
});

test('keyed writes retry 409/502/503/504 but not a stored 500, while reads retry 500', async () => {
  for (const status of [409, 502, 503, 504]) {
    const run = scripted([status, 200]);
    await requestFolk({ method: 'POST', path: '/v1/people/batch/create', body: { records: [] }, config: CONFIG, fetchImpl: run.fetchImpl, sleep: run.sleep });
    assert.equal(run.calls.length, 2, String(status));
  }
  const stored = scripted([500, 200]);
  const error = await requestFolk({ method: 'POST', path: '/v1/people', body: {}, config: CONFIG, fetchImpl: stored.fetchImpl, sleep: stored.sleep }).catch(caught => caught);
  assert.equal(stored.calls.length, 1);
  assert.ok(error instanceof FolkApiError);
  assert.match(formatError(error), /Folk keeps this error for the idempotency key/);
  assert.match(formatError(error), /idempotencyKey=[0-9a-f-]{36}/);
  const read = scripted([500, 500, 200]);
  await requestFolk({ method: 'GET', path: '/v1/people', config: CONFIG, fetchImpl: read.fetchImpl, sleep: read.sleep });
  assert.equal(read.calls.length, 3);
  const disabled = scripted([500, 200]);
  await assert.rejects(requestFolk({ method: 'GET', path: '/v1/people', config: CONFIG, flags: { 'no-retry': true }, fetchImpl: disabled.fetchImpl, sleep: disabled.sleep }));
  assert.equal(disabled.calls.length, 1);
});

test('a write that keeps failing at the network level reports its key for a safe re-run', async () => {
  const run = scripted([new TypeError('fetch failed', { cause: new Error('ECONNRESET') })]);
  const error = await requestFolk({ method: 'POST', path: '/v1/people', body: {}, config: CONFIG, flags: { 'idempotency-key': 'retry-me-1' }, fetchImpl: run.fetchImpl, sleep: run.sleep }).catch(caught => caught);
  assert.equal(run.calls.length, 4);
  assert.ok(error instanceof CliError);
  assert.equal(error.idempotencyKey, 'retry-me-1');
  const text = formatError(error);
  assert.match(text, /fetch failed: ECONNRESET/);
  assert.match(text, /re-run the same command with --idempotency-key/);
  assert.match(text, /idempotencyKey=retry-me-1/);
});

test('rejects invalid retry counts before sending mutations', async () => {
  let calls = 0;
  await assert.rejects(
    requestFolk({
      method: 'POST',
      path: '/v1/companies',
      body: { name: 'Retry test' },
      config: CONFIG,
      flags: { retries: 'abc' },
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}', { status: 200 });
      },
    }),
    /Invalid --retries/,
  );
  assert.equal(calls, 0);
});

test('Retry-After is honored up to the one-minute rate limit window', async () => {
  for (const [retryAfter, expected] of [['2', 2000], ['0', 0], ['120', 60000]]) {
    const run = scripted([new Response('{}', { status: 429, headers: { 'Retry-After': retryAfter } }), 200]);
    await requestFolk({ method: 'GET', path: '/v1/people', config: CONFIG, fetchImpl: run.fetchImpl, sleep: run.sleep });
    assert.deepEqual(run.sleeps, [expected], retryAfter);
  }
  const backoff = scripted([503, 503, 200]);
  await requestFolk({ method: 'GET', path: '/v1/people', config: CONFIG, fetchImpl: backoff.fetchImpl, sleep: backoff.sleep });
  assert.ok(backoff.sleeps[0] >= 500 && backoff.sleeps[0] <= 1000, String(backoff.sleeps));
  assert.ok(backoff.sleeps[1] >= 1000 && backoff.sleeps[1] <= 2000, String(backoff.sleeps));
});

test('parses IETF RateLimit headers and the legacy burst headers', async () => {
  const headers = new Headers({
    'RateLimit-Policy': '"default";q=600;w=60, "burst";q=20;w=2',
    RateLimit: '"default";r=598;t=42, "burst";r=0;t=1',
    'X-RateLimit-Limit': '600', 'X-RateLimit-Remaining': '598', 'X-RateLimit-Reset': '1792668120',
    'X-RateLimit-Limit-Burst': '20', 'X-RateLimit-Remaining-Burst': '0', 'X-RateLimit-Reset-Burst': '1792668096',
    'Idempotent-Replayed': 'true',
  });
  assert.deepEqual(parseRateLimitHeaders(headers), {
    default: { quota: 600, windowSeconds: 60, remaining: 598, resetSeconds: 42 },
    burst: { quota: 20, windowSeconds: 2, remaining: 0, resetSeconds: 1 },
  });
  assert.equal(throttleDelayMs(headers), 1000);
  assert.equal(throttleDelayMs(new Headers({ RateLimit: '"burst";r=0;t=0' })), 1000);
  assert.equal(throttleDelayMs(new Headers({ RateLimit: '"default";r=5;t=10' })), 0);
  assert.equal(parseRateLimitHeaders(new Headers()), undefined);
  const result = await requestFolk({ method: 'POST', path: '/v1/people', body: {}, config: CONFIG, fetchImpl: async () => Response.json({ data: {} }, { headers }) });
  assert.equal(result.response.idempotentReplayed, true);
  assert.equal(result.response.rateLimit.burstRemaining, '0');
  assert.equal(result.response.rateLimit.policies.default.remaining, 598);
});

test('--all waits for an exhausted rate limit window between pages', async () => {
  const sleeps = [];
  let page = 0;
  const result = await requestFolk({
    method: 'GET', path: '/v1/people', config: CONFIG, flags: { all: true }, paginate: true,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchImpl: async () => {
      page += 1;
      return Response.json(
        { data: { items: [{ id: `per_${page}` }], pagination: { nextLink: page < 3 ? `https://api.folk.app/v1/people?cursor=${page}` : undefined } } },
        { headers: { RateLimit: page === 1 ? '"default";r=10;t=30, "burst";r=0;t=2' : '"default";r=9;t=29, "burst";r=5;t=1' } },
      );
    },
  });
  assert.equal(page, 3);
  assert.deepEqual(sleeps, [2000]);
  assert.deepEqual(result.data.data.items.map(item => item.id), ['per_1', 'per_2', 'per_3']);
});

test('API errors list validation issues, the exhausted rate limit policy, and recovery hints', () => {
  const validation = new FolkApiError('Invalid input', {
    status: 422, code: 'UNPROCESSABLE_ENTITY', requestId: 'req_1',
    details: { error: { code: 'UNPROCESSABLE_ENTITY', details: { issues: [
      { code: 'too_big', message: 'A batch accepts at most 100 records.', path: ['records'] },
      { code: 'custom', message: 'Unknown custom field "Stge". Valid names: "Stage", "Owner".', path: ['customFieldValues', 'Stge'] },
    ] } } },
  });
  const text = formatError(validation);
  assert.match(text, /folk API 422 UNPROCESSABLE_ENTITY: Invalid input/);
  assert.match(text, / {2}- records: A batch accepts at most 100 records\./);
  assert.match(text, / {2}- customFieldValues\.Stge: Unknown custom field/);
  assert.match(text, /requestId=req_1/);
  const limited = formatError(new FolkApiError('You have exceeded your rate limit.', {
    status: 429, code: 'TOO_MANY_REQUESTS',
    details: { error: { details: { policy: 'burst', limit: 20, remaining: 0, windowSeconds: 2, retryAfter: '2026-10-22T12:00:02.000Z' } } },
  }));
  assert.match(limited, /Rate limit: the burst policy \(20 requests per 2s\) is exhausted until 2026-10-22T12:00:02\.000Z\./);
  for (const [code, hint] of [
    ['IDEMPOTENCY_KEY_REUSED', /has already run\. Check its outcome/], ['IDEMPOTENCY_RESPONSE_NOT_STORED', /already ran/],
    ['IDEMPOTENCY_REQUEST_IN_PROGRESS', /still running/], ['IDEMPOTENCY_UNAVAILABLE', /did not process/],
    ['INSUFFICIENT_CREDITS', /folkctl credits/],
  ]) assert.match(formatError(new FolkApiError('x', { status: 422, code })), hint, code);
  const many = { error: { details: { issues: Array.from({ length: 12 }, (_, index) => ({ message: 'bad', path: ['records', index, 'id'] })) } } };
  assert.match(formatError(new FolkApiError('Invalid input', { status: 422, details: many })), /records\.0\.id: bad[\s\S]*2 more issues/);
});

test('ignores cwd dotenv base URL when using a stored token', async (t) => {
  const dir = await fsFixture(t);
  const configPath = `${dir}/config.json`;
  await writeConfig(configPath, { apiKey: 'fk_stored_secret' });
  await writeFile(`${dir}/.env.local`, 'FOLK_API_BASE_URL=https://attacker.example\n');

  const config = await getEffectiveConfig({
    env: { HOME: dir, FOLKCTL_CONFIG: configPath },
    cwd: dir,
  });

  assert.equal(config.apiKey, 'fk_stored_secret');
  assert.equal(config.baseUrl, 'https://api.folk.app');
});

async function fsFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'folkctl-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
