export class CliError extends Error {
  constructor(message, { exitCode = 1, cause, idempotencyKey, details } = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    if (cause) this.cause = cause;
    if (idempotencyKey) this.idempotencyKey = idempotencyKey;
    if (details !== undefined) this.details = details;
  }
}

export class FolkApiError extends Error {
  constructor(message, { status, code, requestId, details, response, idempotencyKey } = {}) {
    super(message);
    this.name = 'FolkApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    this.response = response;
    if (idempotencyKey) this.idempotencyKey = idempotencyKey;
    this.exitCode = status === 401 || status === 403 ? 4 : 1;
  }
}

const MAX_ISSUES = 10;

const HINTS = {
  IDEMPOTENCY_KEY_INVALID: 'Use 1 to 255 printable ASCII characters without spaces for --idempotency-key, such as a UUID.',
  IDEMPOTENCY_KEY_REUSED: 'This idempotency key was first used for a different request, which has already run. Check its outcome before sending this one with a new key (omit --idempotency-key to generate one).',
  IDEMPOTENCY_RESPONSE_NOT_STORED: 'The request already ran, but Folk did not keep its response. Check the outcome before sending it again with a new key.',
  IDEMPOTENCY_REQUEST_IN_PROGRESS: 'A request with this idempotency key is still running. Retry later with the same --idempotency-key.',
  IDEMPOTENCY_UNAVAILABLE: 'Folk did not process the request. Retry it with the same --idempotency-key.',
  INSUFFICIENT_CREDITS: 'Nothing was performed or charged. Check folkctl credits, then request fewer people or fields.',
};

export function errorToExitCode(error) {
  if (Number.isInteger(error?.exitCode)) return error.exitCode;
  return 1;
}

export function formatError(error, { verbose = false } = {}) {
  if (error instanceof FolkApiError) {
    const parts = [`folk API ${error.status}${error.code ? ` ${error.code}` : ''}: ${error.message}`];
    parts.push(...issueLines(error.details));
    const rateLimit = rateLimitLine(error.details);
    if (rateLimit) parts.push(rateLimit);
    const hint = errorHint(error);
    if (hint) parts.push(hint);
    if (error.requestId) parts.push(`requestId=${error.requestId}`);
    if (error.idempotencyKey) parts.push(`idempotencyKey=${error.idempotencyKey}`);
    if (verbose && error.details) parts.push(JSON.stringify(error.details, null, 2));
    return parts.join('\n');
  }
  if (error instanceof CliError) {
    const parts = [error.message];
    if (error.idempotencyKey) parts.push(`idempotencyKey=${error.idempotencyKey}`);
    if (verbose && error.details !== undefined) parts.push(JSON.stringify(error.details, null, 2));
    return parts.join('\n');
  }
  if (verbose && error?.stack) return error.stack;
  return error?.message || String(error);
}

// Validation errors list each failed rule with the path of the input, such as customFieldValues.Stage.
function issueLines(payload) {
  const issues = payload?.error?.details?.issues;
  if (!Array.isArray(issues)) return [];
  const lines = issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = Array.isArray(issue?.path) && issue.path.length ? issue.path.join('.') : '(request)';
    return `  - ${path}: ${issue?.message || issue?.code || 'invalid value'}`;
  });
  if (issues.length > MAX_ISSUES) lines.push(`  - ${issues.length - MAX_ISSUES} more issues (use --verbose to see all)`);
  return lines;
}

function rateLimitLine(payload) {
  const details = payload?.error?.details;
  if (!details?.policy) return undefined;
  const window = details.windowSeconds ? ` (${details.limit} requests per ${details.windowSeconds}s)` : '';
  return `Rate limit: the ${details.policy} policy${window} is exhausted${details.retryAfter ? ` until ${details.retryAfter}` : ''}.`;
}

function errorHint(error) {
  if (HINTS[error.code]) return HINTS[error.code];
  if (error.status === 500 && error.idempotencyKey) {
    return 'Folk keeps this error for the idempotency key, so retrying with the same key returns it again. Check whether the write took effect before sending it with a new key.';
  }
  return undefined;
}
