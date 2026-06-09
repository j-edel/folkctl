import { CliError, FolkApiError } from './errors.js';
import { flagBoolean, flagInteger, hasFlag } from './args.js';
import { redact, stripTrailingSlash } from './util.js';

const DEFAULT_RETRIES = 3;

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

export function makeHeaders(config, { hasBody = false } = {}) {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
    'User-Agent': `folkctl/${config.version || '0.1.0'}`,
  };
  if (config.apiVersion) headers['X-API-Version'] = config.apiVersion;
  if (hasBody) headers['Content-Type'] = 'application/json';
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
} = {}) {
  if (!path) throw new CliError('Internal error: request path is required.', { exitCode: 2 });
  if (!config?.apiKey && !flagBoolean(flags, 'dry-run')) {
    throw new CliError('Missing folk API key. Set FOLK_API_KEY or run: folkctl auth login --token-stdin', { exitCode: 4 });
  }

  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const headers = makeHeaders({ ...config, apiKey: config?.apiKey || 'dry-run-token' }, { hasBody: requestBody !== undefined });
  const url = buildUrl(config.baseUrl, path, query);
  assertAllowedOrigin(config.baseUrl, url);
  const request = {
    method: method.toUpperCase(),
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

  const normalizedMethod = method.toUpperCase();
  const maxRetries = retryCountForMethod(normalizedMethod, flags);
  if (paginate && flagBoolean(flags, 'all')) {
    return requestAllPages({ method: normalizedMethod, baseUrl: config.baseUrl, firstUrl: url, headers, requestBody, request, fetchImpl, maxRetries });
  }

  const response = await fetchWithRetry(fetchImpl, url, { method: normalizedMethod, headers, body: requestBody }, maxRetries);
  const payload = await parseResponse(response);
  if (!response.ok) throw apiErrorFromResponse(response, payload);
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

function retryCountForMethod(method, flags) {
  if (flagBoolean(flags, 'no-retry')) return 0;
  if (hasFlag(flags, 'retries')) {
    const retries = flagInteger(flags, 'retries');
    if (retries === undefined || retries < 0) throw new CliError('Invalid --retries. Expected a non-negative integer.', { exitCode: 2 });
    return retries;
  }
  return isRetrySafeMethod(method) ? DEFAULT_RETRIES : 0;
}

function isRetrySafeMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method);
}

async function requestAllPages({ method, baseUrl, firstUrl, headers, requestBody, request, fetchImpl, maxRetries }) {
  const items = [];
  const pages = [];
  let url = firstUrl;
  let lastResponse;
  let lastPayload;

  while (url) {
    const response = await fetchWithRetry(fetchImpl, url, { method, headers, body: requestBody }, maxRetries);
    const payload = await parseResponse(response);
    lastResponse = response;
    lastPayload = payload;
    if (!response.ok) throw apiErrorFromResponse(response, payload);
    pages.push({ url: url.toString(), status: response.status });

    const pageItems = payload?.data?.items;
    if (Array.isArray(pageItems)) items.push(...pageItems);

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

  return {
    request: { ...request, paginated: true },
    response: responseMeta(lastResponse),
    pages,
    data: mergedPayload,
  };
}

async function fetchWithRetry(fetchImpl, url, init, maxRetries) {
  let attempt = 0;
  let lastResponse;
  let lastError;
  while (attempt <= maxRetries) {
    try {
      const response = await fetchImpl(url, init);
      lastResponse = response;
      if (!shouldRetry(response) || attempt === maxRetries) return response;
      await delay(retryDelayMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      await delay(Math.min(1000 * 2 ** attempt, 8000));
    }
    attempt += 1;
  }
  if (lastResponse) return lastResponse;
  throw new CliError(`Network error calling folk API: ${lastError?.message || lastError}`, { exitCode: 1, cause: lastError });
}

function shouldRetry(response) {
  return response.status === 429 || response.status === 500 || response.status === 503;
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30000));
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function apiErrorFromResponse(response, payload) {
  const message = payload?.error?.message || payload?.message || payload?.raw || response.statusText || 'Request failed';
  return new FolkApiError(message, {
    status: response.status,
    code: payload?.error?.code || payload?.code,
    requestId: response.headers?.get?.('x-request-id') || payload?.requestId,
    details: payload,
    response: responseMeta(response),
  });
}

function responseMeta(response) {
  if (!response) return undefined;
  return {
    status: response.status,
    statusText: response.statusText,
    requestId: response.headers?.get?.('x-request-id') || undefined,
    rateLimit: {
      limit: response.headers?.get?.('x-ratelimit-limit') || undefined,
      remaining: response.headers?.get?.('x-ratelimit-remaining') || undefined,
      reset: response.headers?.get?.('x-ratelimit-reset') || undefined,
    },
  };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
