import { randomUUID } from 'node:crypto';
import { CliError, FolkApiError } from './errors.js';
import { flagBoolean, flagInteger, flagValues, hasFlag } from './args.js';
import { redact, stripTrailingSlash } from './util.js';
import { VERSION } from './version.js';

const DEFAULT_RETRIES = 3;
// Folk's longest rate limit window is one minute, so Retry-After never needs a longer wait.
const MAX_WAIT_MS = 60_000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isWriteMethod(method) {
  return WRITE_METHODS.has(String(method).toUpperCase());
}

// Every write gets an Idempotency-Key so a retry replays the first response instead of running the write again.
export function resolveIdempotencyKey(method, flags = {}) {
  if (!isWriteMethod(method)) return undefined;
  // --no-idempotency-key also records idempotency-key=false, so keep only string values.
  const explicitValues = flagValues(flags, 'idempotency-key').filter((value) => typeof value === 'string');
  const explicit = explicitValues.at(-1);
  if (flagBoolean(flags, 'no-idempotency-key')) {
    if (explicitValues.length) throw new CliError('Use either --idempotency-key or --no-idempotency-key, not both.', { exitCode: 2 });
    return undefined;
  }
  if (explicit !== undefined) {
    if (!IDEMPOTENCY_KEY_PATTERN.test(explicit)) {
      throw new CliError('Invalid --idempotency-key. Use 1 to 255 printable ASCII characters without spaces, such as a UUID.', { exitCode: 2 });
    }
    return explicit;
  }
  return randomUUID();
}

export function buildUrl(baseUrl, pathOrUrl, query) {
  let url;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    url = new URL(pathOrUrl);
  } else {
    url = new URL(`${stripTrailingSlash(baseUrl)}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`);
  }
  if (query) {
    const params = query instanceof URLSearchParams ? query : new URLSearchParams(query);
    for (const [key, value] of params.entries()) url.searchParams.append(key, value);
  }
  return url;
}

export function makeHeaders(config, { hasBody = false, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
    'User-Agent': `folkctl/${config.version || VERSION}`,
  };
  if (config.apiVersion) headers['X-API-Version'] = config.apiVersion;
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return headers;
}

export function redactHeaders(headers) {
  const redacted = { ...headers };
  if (redacted.Authorization) redacted.Authorization = `Bearer ${redact(String(redacted.Authorization).replace(/^Bearer\s+/i, ''))}`;
  return redacted;
}

export async function requestFolk({
  method = 'GET',
  path,
  query,
  body,
  config,
  flags = {},
  fetchImpl = globalThis.fetch,
  paginate = false,
  sleep = defaultSleep,
} = {}) {
  if (!path) throw new CliError('Internal error: request path is required.', { exitCode: 2 });
  if (!config?.apiKey && !flagBoolean(flags, 'dry-run')) {
    throw new CliError('Missing folk API key. Set FOLK_API_KEY or run: folkctl auth login --token-stdin', { exitCode: 4 });
  }

  const normalizedMethod = method.toUpperCase();
  const idempotencyKey = resolveIdempotencyKey(normalizedMethod, flags);
  const policy = retryPolicy(normalizedMethod, flags, { keyed: Boolean(idempotencyKey) });
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const headers = makeHeaders({ ...config, apiKey: config?.apiKey || 'dry-run-token' }, { hasBody: requestBody !== undefined, idempotencyKey });
  const url = buildUrl(config.baseUrl, path, query);
  assertAllowedOrigin(config.baseUrl, url);
  const request = {
    method: normalizedMethod,
    url: url.toString(),
    headers: redactHeaders(headers),
    body,
  };

  if (flagBoolean(flags, 'dry-run')) {
    return { dryRun: true, request };
  }

  if (typeof fetchImpl !== 'function') {
    throw new CliError('No fetch implementation found. Use Node.js 20+ or provide a fetch polyfill.', { exitCode: 2 });
  }

  const send = { fetchImpl, policy, sleep, idempotencyKey };
  if (paginate && flagBoolean(flags, 'all')) {
    return requestAllPages({ ...send, method: normalizedMethod, baseUrl: config.baseUrl, firstUrl: url, headers, requestBody, request });
  }

  const response = await fetchWithRetry(send, url, { method: normalizedMethod, headers, body: requestBody });
  const payload = await parseResponse(response);
  if (!response.ok) throw apiErrorFromResponse(response, payload, idempotencyKey);
  return {
    request,
    response: responseMeta(response),
    data: payload,
  };
}

function assertAllowedOrigin(baseUrl, url) {
  const base = new URL(`${stripTrailingSlash(baseUrl)}/`);
  if (url.origin !== base.origin) {
    throw new CliError(`Refusing to send folk credentials to ${url.origin}. Expected ${base.origin}.`, { exitCode: 2 });
  }
}

// Reads retry transient failures. Writes with an Idempotency-Key retry the failures Folk documents as safe
// to retry with the same key. A 500 on a write is not retried: Folk stores it, so a retry would replay it.
// A 429 is always retried, because Folk rejects rate-limited requests before running them.
export function retryPolicy(method, flags = {}, { keyed = false } = {}) {
  // --no-retries also records retries=false, which is not an explicit count.
  const disabled = flagBoolean(flags, 'no-retry') || flagBoolean(flags, 'no-retries');
  const explicit = hasFlag(flags, 'retries') && !flagBoolean(flags, 'no-retries');
  let retries = DEFAULT_RETRIES;
  if (disabled) retries = 0;
  else if (explicit) {
    retries = flagInteger(flags, 'retries');
    if (retries === undefined || retries < 0) throw new CliError('Invalid --retries. Expected a non-negative integer.', { exitCode: 2 });
  }
  const read = !isWriteMethod(method);
  // Without a key, a write retries only on 429 unless --retries opts into the legacy behavior.
  const unkeyedOptIn = !read && !keyed && explicit;
  return {
    retries,
    retryStatus(status) {
      if (status === 429) return true;
      if (read || unkeyedOptIn) return [500, 502, 503, 504].includes(status);
      if (keyed) return [409, 502, 503, 504].includes(status);
      return false;
    },
    retryNetworkError: read || keyed || unkeyedOptIn,
  };
}

async function requestAllPages({ fetchImpl, policy, sleep, idempotencyKey, method, baseUrl, firstUrl, headers, requestBody, request }) {
  const items = [];
  const pages = [];
  const deprecations = new Set();
  let url = firstUrl;
  let lastResponse;
  let lastPayload;

  while (url) {
    if (lastResponse) {
      const wait = throttleDelayMs(lastResponse.headers);
      if (wait) await sleep(wait);
    }
    const response = await fetchWithRetry({ fetchImpl, policy, sleep, idempotencyKey }, url, { method, headers, body: requestBody });
    const payload = await parseResponse(response);
    lastResponse = response;
    lastPayload = payload;
    if (!response.ok) throw apiErrorFromResponse(response, payload, idempotencyKey);
    pages.push({ url: url.toString(), status: response.status });

    const pageItems = payload?.data?.items;
    if (Array.isArray(pageItems)) items.push(...pageItems);
    if (Array.isArray(payload?.deprecations)) for (const message of payload.deprecations) deprecations.add(message);

    const nextLink = payload?.data?.pagination?.nextLink;
    if (nextLink) {
      url = buildUrl(baseUrl, nextLink);
      assertAllowedOrigin(baseUrl, url);
    } else {
      url = undefined;
    }
    if (requestBody !== undefined && url) break;
  }

  const mergedPayload = structuredCloneSafe(lastPayload ?? {});
  if (mergedPayload?.data && Array.isArray(mergedPayload.data.items)) {
    mergedPayload.data.items = items;
    mergedPayload.data.pagination = { nextLink: null };
    mergedPayload.data.pageCount = pages.length;
    mergedPayload.data.itemCount = items.length;
  }
  // Keep every page's deprecation notices, not only the last page's.
  if (deprecations.size && mergedPayload && typeof mergedPayload === 'object') mergedPayload.deprecations = [...deprecations];

  return {
    request: { ...request, paginated: true },
    response: responseMeta(lastResponse),
    pages,
    data: mergedPayload,
  };
}

async function fetchWithRetry({ fetchImpl, policy, sleep, idempotencyKey }, url, init) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (attempt >= policy.retries || !policy.retryNetworkError) throw networkError(error, idempotencyKey);
      await sleep(backoffMs(attempt));
      continue;
    }
    if (attempt >= policy.retries || !policy.retryStatus(response.status)) return response;
    await discardBody(response);
    await sleep(retryDelayMs(response, attempt));
  }
}

function networkError(error, idempotencyKey) {
  const detail = [error?.message || String(error), error?.cause?.message].filter(Boolean).join(': ');
  const hint = idempotencyKey
    ? ' The write may or may not have run. To retry it without running it twice, re-run the same command with --idempotency-key within 24 hours.'
    : '';
  const failure = new CliError(`Network error calling folk API: ${detail}.${hint}`, { exitCode: 1, cause: error, idempotencyKey });
  failure.network = true;
  return failure;
}

async function discardBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // The body may already be consumed or closed.
  }
}

function retryDelayMs(response, attempt) {
  return parseRetryAfter(response.headers?.get?.('retry-after')) ?? backoffMs(attempt);
}

// Retry-After is either seconds or an HTTP date. Returns milliseconds, capped at the one-minute window.
export function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, MAX_WAIT_MS));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), MAX_WAIT_MS));
  return undefined;
}

// Exponential backoff with jitter, as Folk recommends, so parallel clients do not retry in step.
function backoffMs(attempt) {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

// Parses the IETF RateLimit-Policy and RateLimit headers, for example:
//   RateLimit-Policy: "default";q=600;w=60, "burst";q=20;w=2
//   RateLimit: "default";r=598;t=42, "burst";r=18;t=1
export function parseRateLimitHeaders(headers) {
  const policies = {};
  for (const { name, params } of parseStructuredList(headers?.get?.('ratelimit-policy'))) {
    policies[name] = { ...policies[name], quota: toNumber(params.q), windowSeconds: toNumber(params.w) };
  }
  for (const { name, params } of parseStructuredList(headers?.get?.('ratelimit'))) {
    policies[name] = { ...policies[name], remaining: toNumber(params.r), resetSeconds: toNumber(params.t) };
  }
  return Object.keys(policies).length ? policies : undefined;
}

function parseStructuredList(value) {
  if (!value) return [];
  return String(value).split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [rawName, ...rawParams] = part.split(';').map((segment) => segment.trim());
    const params = {};
    for (const param of rawParams) {
      const index = param.indexOf('=');
      if (index > 0) params[param.slice(0, index)] = unquote(param.slice(index + 1));
    }
    return { name: unquote(rawName), params };
  }).filter((item) => item.name);
}

function unquote(value) {
  return String(value).replace(/^"(.*)"$/, '$1');
}

function toNumber(value) {
  const number = Number(value);
  return value === undefined || !Number.isFinite(number) ? undefined : number;
}

// When a policy has no requests left, wait for its window to reset before the next sequential request.
export function throttleDelayMs(headers) {
  return delayForPolicies(parseRateLimitHeaders(headers));
}

export function delayForPolicies(policies) {
  let wait = 0;
  for (const policy of Object.values(policies || {})) {
    if (policy.remaining === 0) wait = Math.max(wait, Math.max(policy.resetSeconds ?? 1, 1) * 1000);
  }
  return Math.min(wait, MAX_WAIT_MS);
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('application/json') || /^[\s\r\n]*[{[]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  return { raw: text };
}

function apiErrorFromResponse(response, payload, idempotencyKey) {
  const message = payload?.error?.message || payload?.message || payload?.raw || response.statusText || 'Request failed';
  return new FolkApiError(message, {
    status: response.status,
    code: payload?.error?.code || payload?.code,
    requestId: response.headers?.get?.('x-request-id') || payload?.error?.requestId || payload?.requestId,
    details: payload,
    response: responseMeta(response),
    idempotencyKey,
  });
}

function responseMeta(response) {
  if (!response) return undefined;
  const header = (name) => response.headers?.get?.(name) || undefined;
  return {
    status: response.status,
    statusText: response.statusText,
    requestId: header('x-request-id'),
    deprecation: header('deprecation'),
    sunset: header('sunset'),
    retryAfter: header('retry-after'),
    ...(header('idempotent-replayed') === 'true' ? { idempotentReplayed: true } : {}),
    rateLimit: {
      limit: header('x-ratelimit-limit'),
      remaining: header('x-ratelimit-remaining'),
      reset: header('x-ratelimit-reset'),
      burstLimit: header('x-ratelimit-limit-burst'),
      burstRemaining: header('x-ratelimit-remaining-burst'),
      burstReset: header('x-ratelimit-reset-burst'),
      policies: parseRateLimitHeaders(response.headers),
    },
  };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
