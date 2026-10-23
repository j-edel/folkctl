// Shared helpers for command tests. Requests go to a fake fetch; nothing reaches the network.
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';

export async function run(argv, { fetchImpl, env = {}, stdin, retries = false, abortAfter } = {}) {
  let stdout = '';
  let stderr = '';
  const calls = [];
  const sleeps = [];
  const code = await main({
    argv: retries ? argv : [...argv, '--no-retry'],
    env: { FOLKCTL_CONFIG: fileURLToPath(new URL('./fixtures/no-config.json', import.meta.url)), FOLK_API_KEY: 'fk_test_secret', ...env },
    cwd: fileURLToPath(new URL('./fixtures/empty', import.meta.url)),
    stdin: stdin ?? Readable.from([]),
    stdout: new Writable({ write(chunk, _encoding, cb) { stdout += chunk; cb(); } }),
    stderr: new Writable({ write(chunk, _encoding, cb) { stderr += chunk; cb(); } }),
    sleep: async (ms) => { sleeps.push(ms); },
    ...(abortAfter ? { abortAfter } : {}),
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), ...init, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      assert.ok(fetchImpl, 'Unexpected network request');
      return fetchImpl(url, init, calls.length);
    },
  });
  return { code, stdout, stderr, calls, sleeps };
}

// Runs a command with --dry-run --json and returns the request it would send.
export async function preview(argv, options) {
  const result = await run([...argv, '--dry-run', '--json'], options);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.calls.length, 0);
  assert.ok(!result.stdout.includes('fk_test_secret'));
  const payload = JSON.parse(result.stdout);
  return { ...payload.request, url: new URL(payload.request.url), stderr: result.stderr };
}

// An interactive terminal whose user types the given answer at a confirmation prompt.
export function tty(answer) {
  return Object.assign(Readable.from([`${answer}\n`]), { isTTY: true });
}

export function stdinText(text) {
  return Readable.from([text]);
}
