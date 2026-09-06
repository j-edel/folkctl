import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ENDPOINTS } from '../src/endpoints.js';
import { DEFAULT_API_VERSION } from '../src/config.js';

// Independent operation snapshot from Folk's published OpenAPI, not generated from CLI metadata.
const contract = JSON.parse(readFileSync(new URL('./fixtures/folk-api-contract.json', import.meta.url), 'utf8'));
const signature = ({ method, path }) => `${method} ${path.replace(/\{[^}]+\}/g, '{}')}`;

test('every public OpenAPI operation has a CLI wrapper, excluding internal search endpoints', () => {
  const supported = new Set(ENDPOINTS.map(signature));
  for (const operation of contract.operations) assert.ok(supported.has(signature(operation)), operation.operationId);
  assert.equal(DEFAULT_API_VERSION, contract.apiVersion);
});

test('every wrapper matches a published route and declares required query parameters', () => {
  const operations = new Map(contract.operations.map(operation => [signature(operation), operation]));
  for (const endpoint of ENDPOINTS) {
    const operation = operations.get(signature(endpoint));
    assert.ok(operation, endpoint.key);
    assert.deepEqual(endpoint.requiredQuery || [], operation.requiredQuery, endpoint.key);
  }
  assert.equal(new Set(ENDPOINTS.map(endpoint => endpoint.key)).size, ENDPOINTS.length);
});

test('package, lockfile, and companion skill release versions agree', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const skill = readFileSync(new URL('../skills/folk-cli/SKILL.md', import.meta.url), 'utf8');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(skill.match(/^version: (.+)$/m)?.[1], pkg.version);
});
