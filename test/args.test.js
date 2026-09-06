import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFlagArgs, flagValues, flagBoolean, flagBooleanStrict, flagString } from '../src/args.js';

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

test('task boolean flags accept separated values supported by strict validation', () => {
  for (const name of ['is-public', 'only-assigned-to-me']) {
    for (const [value, expected] of [
      ['true', true], ['1', true], ['yes', true], ['on', true],
      ['false', false], ['0', false], ['no', false], ['off', false],
      ['TRUE', true], [' FALSE ', false],
    ]) {
      const { flags, positionals } = parseFlagArgs(['tasks', 'list', `--${name}`, value, '--json']);
      assert.equal(flagBooleanStrict(flags, name), expected, `${name} ${JSON.stringify(value)}`);
      assert.equal(flagBoolean(flags, 'json'), true);
      assert.deepEqual(positionals, ['tasks', 'list']);
    }
  }
});

test('bare task boolean flags preserve following flags and the positional separator', () => {
  for (const name of ['is-public', 'only-assigned-to-me']) {
    for (const suffix of [[], ['--json'], ['-j'], ['--', 'maybe']]) {
      const { flags, positionals } = parseFlagArgs(['tasks', 'list', `--${name}`, ...suffix]);
      assert.equal(flagBooleanStrict(flags, name), true);
      assert.deepEqual(positionals, suffix[0] === '--' ? ['tasks', 'list', 'maybe'] : ['tasks', 'list']);
      if (['--json', '-j'].includes(suffix[0])) assert.equal(flagBoolean(flags, 'json'), true);
    }
  }
});

test('rejects missing values for non-boolean flags', () => {
  assert.throws(() => parseFlagArgs(['people', 'create', '--email', '--group-id', 'grp_123']), /Missing value for --email/);
  assert.throws(() => parseFlagArgs(['people', 'list', '--limit']), /Missing value for --limit/);
});
