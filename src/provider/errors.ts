import type { ErrorCode } from './types.js'

const BODY_SNIPPET_CHARS = 300

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function classifyError(status: number, body: string): ProviderError {
  const snippet = body.slice(0, BODY_SNIPPET_CHARS)
  if (status === 401 || status === 403) {
    return new ProviderError(`auth failed: ${snippet}`, 'auth', false, status)
  }
  if (status === 429) {
    return new ProviderError(`quota/rate limit: ${snippet}`, 'quota', true, status)
  }
  if (status >= 500) {
    return new ProviderError(`provider unavailable: ${snippet}`, 'transient', true, status)
  }
  if (status >= 400) {
    return new ProviderError(`invalid request: ${snippet}`, 'invalid', false, status)
  }
  return new ProviderError(`unknown provider error: ${snippet}`, 'unknown', false, status)
}