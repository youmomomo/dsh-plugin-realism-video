export interface RetryOptions {
    retries: number;
    baseDelayMs: number;
}
export declare function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions, signal: AbortSignal): Promise<T>;
export declare function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
