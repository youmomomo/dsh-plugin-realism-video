import type { ErrorCode } from './types.js';
export declare class ProviderError extends Error {
    readonly code: ErrorCode;
    readonly retryable: boolean;
    readonly status?: number | undefined;
    constructor(message: string, code: ErrorCode, retryable: boolean, status?: number | undefined);
}
export declare function classifyError(status: number, body: string): ProviderError;
