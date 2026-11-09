export async function withRetry(fn, opts, signal) {
    const attempts = Math.max(1, Math.floor(opts.retries) + 1);
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (signal.aborted)
            throw abortedError();
        try {
            return await fn(attempt);
        }
        catch (err) {
            last = err;
            if (!isRetryable(err) || attempt === attempts - 1)
                throw err;
            await sleep(opts.baseDelayMs * 2 ** attempt, signal);
        }
    }
    throw last;
}
export async function mapLimit(items, limit, fn) {
    if (items.length === 0)
        return [];
    const width = Math.max(1, Math.min(Math.floor(limit), items.length));
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (true) {
            const index = next++;
            if (index >= items.length)
                return;
            results[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: width }, () => worker()));
    return results;
}
function isRetryable(err) {
    if (typeof err !== 'object' || err === null)
        return false;
    return err.retryable === true;
}
function abortedError() {
    return new Error('aborted');
}
async function sleep(ms, signal) {
    if (signal.aborted)
        throw abortedError();
    await new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortedError());
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
//# sourceMappingURL=retry.js.map