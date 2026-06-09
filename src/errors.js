export class CliError extends Error {
  constructor(message, { exitCode = 1, cause } = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    if (cause) this.cause = cause;
  }
}

export class FolkApiError extends Error {
  constructor(message, { status, code, requestId, details, response } = {}) {
    super(message);
    this.name = 'FolkApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    this.response = response;
    this.exitCode = status === 401 || status === 403 ? 4 : 1;
  }
}

export function errorToExitCode(error) {
  if (Number.isInteger(error?.exitCode)) return error.exitCode;
  return 1;
}

export function formatError(error, { verbose = false } = {}) {
  if (error instanceof FolkApiError) {
    const parts = [];
    parts.push(`folk API ${error.status}${error.code ? ` ${error.code}` : ''}: ${error.message}`);
    if (error.requestId) parts.push(`requestId=${error.requestId}`);
    if (verbose && error.details) parts.push(JSON.stringify(error.details, null, 2));
    return parts.join('\n');
  }
  if (error instanceof CliError) return error.message;
  if (verbose && error?.stack) return error.stack;
  return error?.message || String(error);
}
