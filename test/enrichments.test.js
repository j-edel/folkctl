import assert from 'node:assert/strict';
import test from 'node:test';
import { preview, run } from './helpers.js';

const ID = 'enr_3f2a6c1e-8b1d-4f0a-9c2e-5d7b8a9e0f11';

function enrichment(status, extra = {}) {
  return {
    id: ID, status, fields: ['emails'], createdAt: '2026-10-22T12:00:00.000Z',
    finishedAt: null, errorReason: null, summary: null, items: null, ...extra,
  };
}

const completed = enrichment('completed', {
  finishedAt: '2026-10-22T12:01:00.000Z',
  summary: { total: 2, enriched: 1, partiallyEnriched: 0, notEnriched: 1, skipped: 0, error: 0 },
  items: [
    { id: 'per_1', status: 'enriched', enrichedFields: ['emails'], missingInputs: [] },
    { id: 'per_2', status: 'not_enriched', enrichedFields: [], missingInputs: ['linkedinUrl', 'company'] },
  ],
});

// Answers the POST with 202 and each later GET with the next status in the sequence.
function lifecycle(...states) {
  return async (url, init, call) => {
    const state = states[Math.min(call - 1, states.length - 1)];
    return Response.json({ data: state }, { status: init.method === 'POST' ? 202 : 200 });
  };
}

test('enrichment requests need fields and IDs, send unique IDs, and stay within 500 people', async () => {
  const request = await preview(['people', 'enrich', 'per_1', 'per_2', 'per_1', '--fields', 'email,phones']);
  assert.equal(request.method, 'POST');
  assert.equal(request.url.pathname, '/v1/person-enrichments');
  assert.ok(request.headers['Idempotency-Key']);
  assert.deepEqual(request.body, { fields: ['emails', 'phones'], ids: ['per_1', 'per_2'] });
  const merged = await preview(['enrichments', 'create', 'per_1', '--id', 'per_3', '--fields', 'phones', '--data', '{"ids":["per_0"],"fields":["phones"]}']);
  assert.deepEqual(merged.body, { ids: ['per_0', 'per_3', 'per_1'], fields: ['phones'] });
  for (const [argv, message] of [
    [['people', 'enrich', 'per_1'], /requires --fields/],
    [['enrichments', 'create', '--fields', 'emails'], /at least one person ID/],
    [['people', 'enrich', ...Array.from({ length: 501 }, (_, index) => `per_${index}`), '--fields', 'emails', '--yes'], /at most 500 people; got 501/],
    [['companies', 'enrich', 'com_1', '--fields', 'emails'], /Only people can be enriched/],
    [['people', 'enrich', 'per_1', '--fields', 'emails', '--wait', '--wait-interval', '0', '--yes'], /Invalid --wait-interval/],
  ]) {
    const result = await run(argv);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(result.calls.length, 0);
  }
});

test('enrichment spends credits only after confirmation, and points to the follow-up command', async () => {
  const refused = await run(['people', 'enrich', 'per_1', '--fields', 'emails']);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /Refusing to spend enrichment credits on 1 person without confirmation\. Pass --yes/);
  assert.equal(refused.calls.length, 0);
  const started = await run(['people', 'enrich', 'per_1', 'per_2', '--fields', 'emails', '--yes', '--json'], { fetchImpl: lifecycle(enrichment('pending')) });
  assert.equal(started.code, 0, started.stderr);
  assert.equal(started.calls.length, 1);
  assert.equal(JSON.parse(started.stdout).data.data.status, 'pending');
  assert.equal(JSON.parse(started.stdout).response.status, 202);
  assert.match(started.stderr, new RegExp(`Enrichment ${ID} is pending \\(emails\\)\\. Follow it with: folkctl enrichments get ${ID} --wait`));
  const raw = await run(['api', 'request', 'POST', '/v1/person-enrichments', '--data', '{"fields":["emails"],"ids":["per_1"]}']);
  assert.equal(raw.code, 3);
  assert.match(raw.stderr, /Refusing to spend enrichment credits with POST \/v1\/person-enrichments/);
  assert.equal(raw.calls.length, 0);
  const rawConfirmed = await run(['api', 'request', 'POST', 'https://api.folk.app/v1/person-enrichments', '--data', '{"fields":["emails"],"ids":["per_1"]}', '--yes', '--json'], { fetchImpl: lifecycle(enrichment('pending')) });
  assert.equal(rawConfirmed.code, 0, rawConfirmed.stderr);
  assert.equal(rawConfirmed.calls.length, 1);
});

test('--wait polls until the enrichment completes, then prints each person and a summary', async () => {
  const result = await run(['people', 'enrich', 'per_1', 'per_2', '--fields', 'emails', '--yes', '--wait', '--wait-interval', '2'], {
    fetchImpl: lifecycle(enrichment('pending'), enrichment('in_progress'), completed),
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.calls.map(call => `${call.method} ${call.url.pathname}`), [
    'POST /v1/person-enrichments', `GET /v1/person-enrichments/${ID}`, `GET /v1/person-enrichments/${ID}`,
  ]);
  assert.deepEqual(result.sleeps, [2000, 2000]);
  assert.equal(result.calls[1].headers['Idempotency-Key'], undefined);
  const lines = result.stdout.trim().split('\n');
  assert.match(lines[0], /^id\s+status\s+enrichedFields\s+missingInputs$/);
  assert.match(lines[3], /^per_2\s+not_enriched\s+linkedinUrl, company$/);
  assert.match(result.stderr, new RegExp(`Waiting for enrichment ${ID} \\(pending\\)…\\nWaiting for enrichment ${ID} \\(in_progress\\)…`));
  assert.match(result.stderr, /completed \(emails\): 2 people; 1 enriched, 0 partially enriched, 1 not enriched, 0 skipped, 0 errors\./);
});

test('a waited enrichment that fails exits 5, and a timeout explains how to resume', async () => {
  const failed = await run(['enrichments', 'get', ID, '--wait'], { fetchImpl: lifecycle(enrichment('in_progress'), enrichment('failed', { errorReason: 'insufficient_credits' })) });
  assert.equal(failed.code, 5, failed.stderr);
  assert.match(failed.stderr, new RegExp(`Enrichment ${ID} failed: insufficient_credits\\.`));
  const notWaited = await run(['enrichments', 'get', ID], { fetchImpl: lifecycle(enrichment('failed', { errorReason: 'internal_error' })) });
  assert.equal(notWaited.code, 0);

  const stuck = await run(['enrichments', 'get', ID, '--wait', '--wait-timeout', '4', '--wait-interval', '2'], { fetchImpl: lifecycle(enrichment('in_progress')) });
  assert.equal(stuck.code, 1);
  assert.equal(stuck.stdout, '');
  assert.equal(stuck.calls.length, 3);
  assert.match(stuck.stderr, new RegExp(`Timed out after 4s waiting for enrichment ${ID}; it is still in_progress\\. Resume with: folkctl enrichments get ${ID} --wait`));

  const throttled = await run(['enrichments', 'get', ID, '--wait'], {
    fetchImpl: async (url, init, call) => Response.json({ data: call === 1 ? enrichment('pending') : completed }, { headers: { RateLimit: '"default";r=0;t=7' } }),
  });
  assert.equal(throttled.code, 0, throttled.stderr);
  assert.deepEqual(throttled.sleeps, [7000]);

  // A timeout shorter than the interval still polls once, without sleeping past the deadline.
  const short = await run(['enrichments', 'get', ID, '--wait', '--wait-timeout', '3'], { fetchImpl: lifecycle(enrichment('in_progress')) });
  assert.equal(short.code, 1);
  assert.equal(short.calls.length, 2);
  assert.deepEqual(short.sleeps, [3000]);
  assert.match(short.stderr, /Timed out after 3s/);

  for (const flags of [['--wait-interval', '0.5'], ['--wait-timeout', '0'], ['--wait-timeout', 'soon']]) {
    const invalid = await run(['enrichments', 'get', ID, '--wait', ...flags], { fetchImpl: lifecycle(enrichment('pending')) });
    assert.equal(invalid.code, 2, flags.join(' '));
  }
});

test('a failed status check after starting an enrichment points to it instead of inviting a paid re-run', async () => {
  const pollFails = async (url, init) => (init.method === 'POST'
    ? Response.json({ data: enrichment('pending') }, { status: 202 })
    : Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is currently unavailable.' } }, { status: 503 }));
  const result = await run(['people', 'enrich', 'per_1', '--fields', 'emails', '--yes', '--wait', '--quiet', '--json'], { fetchImpl: pollFails });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.calls.length, 2);
  const postKey = result.calls[0].headers['Idempotency-Key'];
  assert.match(result.stderr, new RegExp(`Enrichment ${ID} started, but checking its status failed\\.`));
  assert.match(result.stderr, /folk API 503 SERVICE_UNAVAILABLE/);
  assert.match(result.stderr, new RegExp(`Resume with: folkctl enrichments get ${ID} --wait`));
  assert.ok(result.stderr.includes(`idempotencyKey=${postKey}`));
  const get = await run(['enrichments', 'get', ID, '--wait'], { fetchImpl: async (url, init, call) => (call === 1 ? Response.json({ data: enrichment('pending') }) : new Response('{}', { status: 404 })) });
  assert.equal(get.code, 1);
  assert.match(get.stderr, new RegExp(`Checking enrichment ${ID} failed\\.`));
  assert.doesNotMatch(get.stderr, /idempotencyKey=/);
});

test('enrichment lists filter by status, and gets read one enrichment', async () => {
  const list = await preview(['enrichments', 'list', '--status', 'pending,in_progress', '--limit', '10', '--filter', 'createdAt:gt:2026-10-01']);
  assert.equal(list.url.pathname, '/v1/person-enrichments');
  assert.deepEqual(list.url.searchParams.getAll('filter[status][in]'), ['pending', 'in_progress']);
  assert.equal(list.url.searchParams.get('filter[createdAt][gt]'), '2026-10-01');
  assert.equal(list.url.searchParams.get('limit'), '10');
  const get = await preview(['person-enrichments', 'get', ID]);
  assert.equal(get.method, 'GET');
  assert.equal(get.url.pathname, `/v1/person-enrichments/${ID}`);
  assert.equal(get.headers['Idempotency-Key'], undefined);
  const table = await run(['enrichments', 'list'], { fetchImpl: async () => Response.json({ data: { items: [completed], pagination: {} } }) });
  assert.match(table.stdout.split('\n')[0], /^id\s+status\s+fields\s+createdAt\s+finishedAt\s*$/);
  const missing = await run(['enrichments', 'get']);
  assert.equal(missing.code, 2);
});

test('credits reads GET /v1/credits and renders one row per feature', async () => {
  const request = await preview(['credits']);
  assert.equal(request.method, 'GET');
  assert.equal(request.url.pathname, '/v1/credits');
  const result = await run(['credits'], {
    fetchImpl: async () => Response.json({ data: { items: [
      { feature: 'person_enrichment', scope: 'workspace', used: 12, limit: 1000, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' },
      { feature: 'messages', scope: 'user', used: 0, limit: null, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' },
    ] } }),
  });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.match(lines[0], /^feature\s+scope\s+used\s+limit\s+periodStart\s+periodEnd$/);
  assert.match(lines[2], /^person_enrichment\s+workspace\s+12\s+1000\s/);
  const invalid = await run(['credits', 'buy']);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.calls.length, 0);
});

test('server deprecation notices reach stderr once, and --quiet hides them', async () => {
  const deprecated = async () => Response.json({ data: { id: 'usr_1' }, deprecations: ['This endpoint is deprecated since November 1, 2026 and will be removed on May 1, 2027.'] });
  const warned = await run(['users', 'me', '--json'], { fetchImpl: deprecated });
  assert.equal(warned.code, 0);
  assert.equal(warned.stderr, 'Warning: This endpoint is deprecated since November 1, 2026 and will be removed on May 1, 2027.\n');
  const quiet = await run(['users', 'me', '--json', '--quiet'], { fetchImpl: deprecated });
  assert.equal(quiet.stderr, '');
  const header = await run(['api', 'request', 'GET', '/v1/users/me', '--json'], { fetchImpl: async () => Response.json({ data: {} }, { headers: { Deprecation: 'Sun, 01 Nov 2026 00:00:00 GMT', Sunset: 'Sat, 01 May 2027 00:00:00 GMT' } }) });
  assert.match(header.stderr, /Folk marks this endpoint as deprecated \(sunset Sat, 01 May 2027 00:00:00 GMT\)\./);
});

test('for endpoints with a bundled notice, Folk\'s own notice wins, and the bundled one covers the rest', async () => {
  const bundled = 'Warning: Reminders are deprecated. Use tasks instead; Folk lists February 13, 2027 as the sunset date.';
  const reminders = (fetchImpl) => run(['reminders', 'list', '--json'], { fetchImpl });
  const fromFolk = await reminders(async () => Response.json({ data: { items: [] }, deprecations: ['Removed on March 1, 2027. Use the Tasks endpoints.'] }, { headers: { Sunset: 'Mon, 01 Mar 2027 00:00:00 GMT' } }));
  assert.equal(fromFolk.stderr, 'Warning: Removed on March 1, 2027. Use the Tasks endpoints.\n');
  const silent = await reminders(async () => Response.json({ data: { items: [] } }));
  assert.equal(silent.stderr, `${bundled}\n`);
  const sameDate = await reminders(async () => Response.json({ data: { items: [] } }, { headers: { Sunset: 'Sat, 13 Feb 2027 00:00:00 GMT' } }));
  assert.equal(sameDate.stderr, `${bundled}\n`);
  const moved = await reminders(async () => Response.json({ data: { items: [] } }, { headers: { Sunset: 'Thu, 11 Feb 2027 00:00:00 GMT' } }));
  assert.equal(moved.stderr, `${bundled} Folk's Sunset header now says 2027-02-11.\n`);
  const removed = await reminders(async () => Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }));
  assert.equal(removed.code, 1);
  assert.match(removed.stderr, new RegExp(`^${bundled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nfolk API 404 NOT_FOUND`));
  const pages = await run(['reminders', 'list', '--all', '--ndjson'], {
    fetchImpl: async (url, init, call) => Response.json({ data: { items: [{ id: `rmd_${call}` }], pagination: { nextLink: call === 1 ? 'https://api.folk.app/v1/reminders?cursor=2' : undefined } }, deprecations: ['Use the Tasks endpoints.'] }),
  });
  assert.equal(pages.stderr, 'Warning: Use the Tasks endpoints.\n');
});

test('company payloads use documented fields, and webhooks accept the enrichment event', async () => {
  const company = await preview(['companies', 'create', '--name', 'Acme', '--foundation-year', '2015', '--employee-range', '11-50', '--last-funding-date', '2026-03-01']);
  assert.deepEqual(company.body, { name: 'Acme', employeeRange: '11-50', foundationYear: '2015', lastFundingDate: '2026-03-01' });
  const legacy = await run(['companies', 'create', '--name', 'Acme', '--foundation-date', '2015-01-01']);
  assert.equal(legacy.code, 2);
  assert.match(legacy.stderr, /--foundation-date is not a Folk company field\. Use --foundation-year/);
  const webhook = await preview(['webhooks', 'create', '--name', 'Enrichment', '--target-url', 'https://example.com/hook', '--event', 'person_enrichment.finished']);
  assert.deepEqual(webhook.body.subscribedEvents, [{ eventType: 'person_enrichment.finished' }]);
});
