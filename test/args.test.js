import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFlagArgs, flagValues, flagBoolean, flagString } from '../src/args.js';

test('parses repeat flags, booleans, and positionals', () => {
  const { flags, positionals } = parseFlagArgs(['people', 'list', '--json', '--email', 'a@example.com', '--email=b@example.com', '-y']);
  assert.deepEqual(positionals, ['people', 'list']);
  assert.equal(flagBoolean(flags, 'json'), true);
  assert.equal(flagBoolean(flags, 'yes'), true);
  assert.deepEqual(flagValues(flags, 'email'), ['a@example.com', 'b@example.com']);
});

test('parses --no-* flags and dash stdin value', () => {
  const { flags } = parseFlagArgs(['api', 'request', 'POST', '/v1/people', '--data', '-', '--no-retry']);
  assert.equal(flagString(flags, 'data'), '-');
  assert.equal(flagBoolean(flags, 'retry'), false);
  assert.equal(flagBoolean(flags, 'no-retry'), true);
});

test('coerces explicit boolean string values', () => {
  const { flags } = parseFlagArgs(['people', 'delete', 'per_123', '--yes=false', '--force=0', '--json=true']);
  assert.equal(flagBoolean(flags, 'yes'), false);
  assert.equal(flagBoolean(flags, 'force'), false);
  assert.equal(flagBoolean(flags, 'json'), true);
});

test('rejects missing values for non-boolean flags', () => {
  assert.throws(() => parseFlagArgs(['people', 'create', '--email', '--group-id', 'grp_123']), /Missing value for --email/);
  assert.throws(() => parseFlagArgs(['people', 'list', '--limit']), /Missing value for --limit/);
});
