#!/usr/bin/env node
// Regenerates the independent endpoint contract used by test/endpoints.test.js from Folk's published
// OpenAPI document. Never generate it from src/endpoints.js: the point is to compare the two.
//
//   node scripts/openapi-snapshot.mjs > test/fixtures/folk-api-contract.json
//   node scripts/openapi-snapshot.mjs ./openapi.json > test/fixtures/folk-api-contract.json
//
// Diff the result against the committed fixture to see which operations Folk added, removed, or deprecated.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DEFAULT_SOURCE = 'https://developer.folk.app/schemas/2025-06-09.json';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const source = process.argv[2] || DEFAULT_SOURCE;
const text = /^https?:\/\//i.test(source) ? await fetchText(source) : await readFile(source, 'utf8');
const spec = JSON.parse(text);
const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], spec);

const operations = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const operation = item[method];
    // x-excluded marks internal routes, such as the search endpoints, that are not part of the public API.
    if (!operation || operation['x-excluded']) continue;
    const parameters = [...(item.parameters || []), ...(operation.parameters || [])].map((parameter) => (parameter.$ref ? resolve(parameter.$ref) : parameter));
    operations.push({
      method: method.toUpperCase(),
      path,
      operationId: operation.operationId,
      requiredQuery: parameters.filter((parameter) => parameter.in === 'query' && parameter.required).map((parameter) => parameter.name),
      ...(operation.deprecated ? { deprecated: true } : {}),
      ...(operation['x-mint']?.metadata?.tag === 'Beta' ? { beta: true } : {}),
    });
  }
}

process.stdout.write(`${JSON.stringify({
  source,
  retrievedAt: new Date().toISOString().slice(0, 10),
  apiVersion: spec.info?.version,
  sourceSha256: createHash('sha256').update(text).digest('hex'),
  operations,
}, null, 2)}\n`);

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.text();
}
