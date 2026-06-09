import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getEffectiveConfig, writeConfig } from '../src/config.js';
import { requestFolk } from '../src/http.js';

const CONFIG = {
  apiKey: 'fk_test_secret',
  baseUrl: 'https://api.folk.app',
  apiVersion: '2025-06-09',
};

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

test('does not retry non-idempotent requests unless --retries is explicit', async () => {
  let calls = 0;
  await assert.rejects(
    requestFolk({
      method: 'POST',
      path: '/v1/companies',
      body: { name: 'Retry test' },
      config: CONFIG,
      fetchImpl: async () => {
        calls += 1;
        throw new Error('network down');
      },
    }),
    /Network error calling folk API/,
  );
  assert.equal(calls, 1);
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
