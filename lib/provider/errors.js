const BODY_SNIPPET_CHARS = 300;
export class ProviderError extends Error {
    code;
    retryable;
    status;
    constructor(message, code, retryable, status) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.status = status;
        this.name = 'ProviderError';
    }
}
export function classifyError(status, body) {
    const snippet = body.slice(0, BODY_SNIPPET_CHARS);
    if (status === 401 || status === 403) {
        return new ProviderError(`auth failed: ${snippet}`, 'auth', false, status);
    }
    if (status === 429) {
        return new ProviderError(`quota/rate limit: ${snippet}`, 'quota', true, status);
    }
    if (status >= 500) {
        return new ProviderError(`provider unavailable: ${snippet}`, 'transient', true, status);
    }
    if (status >= 400) {
        return new ProviderError(`invalid request: ${snippet}`, 'invalid', false, status);
    }
    return new ProviderError(`unknown provider error: ${snippet}`, 'unknown', false, status);
}
//# sourceMappingURL=errors.js.map