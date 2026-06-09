import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFlagArgs } from '../src/args.js';
import { buildQuery, parseFilter } from '../src/query.js';

test('builds folk filter query syntax', () => {
  const { flags } = parseFlagArgs(['--limit', '5', '--filter', 'fullName:like:Ada', '--filter', 'groups:in:id:grp_123', '--or']);
  const query = buildQuery(flags);
  assert.equal(query.get('limit'), '5');
  assert.equal(query.get('combinator'), 'or');
  assert.equal(query.get('filter[fullName][like]'), 'Ada');
  assert.equal(query.get('filter[groups][in][id]'), 'grp_123');
});

test('parses reference-key filters', () => {
  assert.deepEqual(parseFilter('groups:in:id:grp_123'), {
    field: 'groups',
    operator: 'in',
    referenceKey: 'id',
    value: 'grp_123',
  });
});

test('keeps colon-bearing filter values intact', () => {
  assert.deepEqual(parseFilter('urls:not_eq:https://example.com'), {
    field: 'urls',
    operator: 'not_eq',
    value: 'https://example.com',
  });
});

test('normalizes common filter operator aliases', () => {
  assert.deepEqual(parseFilter('emails:contains:ada@example.com'), {
    field: 'emails',
    operator: 'like',
    value: 'ada@example.com',
  });
  assert.deepEqual(parseFilter('groups:is:grp_123'), {
    field: 'groups',
    operator: 'in',
    referenceKey: 'id',
    value: 'grp_123',
  });
});
